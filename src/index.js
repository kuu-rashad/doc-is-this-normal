import { DurableObject } from "cloudflare:workers";
import config from "../assets/gameconfig.json";

const AVATARS = ["blue", "brown", "green", "lime", "orange", "pink", "purple", "red", "yellow"];
const MAX_NICKNAME_LENGTH = 16;
const LIMITS = config.limits;
const MINUTE = 60 * 1000;
// How many of the current finals candidates the big screen lists.
const MAX_CANDIDATES_SHOWN = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEMPLATES = new Map(
  config.categories.flatMap((category) => category.templates.map((template) => [template.id, template])),
);

// Each round: Clinic open → Second opinions → Finals, then the next round starts straight away
// while the big screen shows the reveal.
const PHASES = ["clinic_open", "second_opinions", "finals"];
const TIMING_KEYS = ["first_clinic_open", "clinic_open", "second_opinions", "finals", "reveal"];

function fillTemplate(template, slots) {
  return template.text.replace(/\{\{(\w+)\}\}/g, (_, key) => slots[key]);
}

function cleanText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

// Players are only "Dr." when they're the one behind a prescription.
function doctorName(nickname) {
  return `Dr. ${nickname}`;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 423 tells the phone the action isn't open in the current phase, so it heads back home.
const PHASE_CLOSED = 423;
const PHASE_MESSAGES = {
  clinic_open: "The clinic is closed right now.",
  voting: "Voting is closed right now.",
  finals: "The finals aren't on right now.",
  roundOver: "That round is over. A new one has started!",
};

// There are no rooms: every player belongs to the one shared game, so a single
// Durable Object instance holds all game state.
export class Game extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Tables from the first version of the game (2 treatments per symptom, 0–2 point votes)
    // don't fit the round-based game, so they're dropped. Players are kept.
    if (this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'treatments'").toArray().length) {
      this.sql.exec(`
        DROP TABLE IF EXISTS treatments;
        DROP TABLE IF EXISTS votes;
        DROP TABLE IF EXISTS assignments;
        DROP TABLE IF EXISTS symptoms;
      `);
    }

    // nickname_key is the lowercased nickname, so "Duck" and "duck" count as the same name.
    // matchup_votes: one row per player per pair of prescriptions they were shown (a_id < b_id),
    // with a thumbs up (1) or not (0) for each. Rows double as the "times shown" count.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        nickname_key TEXT NOT NULL UNIQUE,
        avatar TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS symptoms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id TEXT,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS prescriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symptom_id INTEGER NOT NULL,
        author_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (symptom_id, author_id)
      );
      CREATE TABLE IF NOT EXISTS assignments (
        player_id TEXT PRIMARY KEY,
        symptom_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS matchup_votes (
        player_id TEXT NOT NULL,
        a_id INTEGER NOT NULL,
        b_id INTEGER NOT NULL,
        a_up INTEGER NOT NULL,
        b_up INTEGER NOT NULL,
        PRIMARY KEY (player_id, a_id, b_id)
      );
      CREATE TABLE IF NOT EXISTS finals_votes (
        player_id TEXT PRIMARY KEY,
        choice INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hall_of_fame (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry TEXT NOT NULL
      );
    `);

    if (!this.getSetting("round")) this.startGame(Date.now());
  }

  // ---------- Helpers ----------

  one(query, ...params) {
    return this.sql.exec(query, ...params).toArray()[0] ?? null;
  }

  getSetting(key) {
    const row = this.one("SELECT value FROM settings WHERE key = ?", key);
    return row ? JSON.parse(row.value) : null;
  }

  setSetting(key, value) {
    if (value === null) this.sql.exec("DELETE FROM settings WHERE key = ?", key);
    else this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, JSON.stringify(value));
  }

  requirePlayer(id) {
    const player = this.getPlayer({ playerId: id });
    if (!player) throw new HttpError(403, "Join the game first");
    return player;
  }

  requirePhase(allowed, message) {
    if (!allowed.includes(this.phase().name)) throw new HttpError(PHASE_CLOSED, message);
  }

  // Prescription and vote tasks belong to a round; answers to one from an earlier round are
  // turned away, since everything from that round is gone.
  requireRound(round) {
    if (round !== this.getSetting("round").number) throw new HttpError(PHASE_CLOSED, PHASE_MESSAGES.roundOver);
  }

  // Single entry point for the Worker. Custom error classes don't survive the trip out of a
  // Durable Object, so the HTTP status is returned as plain data instead.
  run(action, playerId, body) {
    try {
      this.advance(Date.now());
      const result = this[action]({ playerId, body });
      return result === null ? { status: 404, data: { error: "Not found" } } : { status: 200, data: result };
    } catch (error) {
      if (error instanceof HttpError) return { status: error.status, data: { error: error.message } };
      throw error;
    }
  }

  // ---------- Rounds and phases ----------

  timing() {
    return { ...config.timing_minutes, ...this.getSetting("timing") };
  }

  // Start and end times of each phase in the current round.
  schedule() {
    const round = this.getSetting("round");
    const timing = this.timing();
    const clinicMinutes = round.number === 1 ? timing.first_clinic_open : timing.clinic_open;
    const clinicEnd = round.startedAt + clinicMinutes * MINUTE;
    const secondEnd = clinicEnd + timing.second_opinions * MINUTE;
    const finalsEnd = secondEnd + timing.finals * MINUTE;
    return { round, starts: [round.startedAt, clinicEnd, secondEnd], ends: [clinicEnd, secondEnd, finalsEnd] };
  }

  phase(now = Date.now()) {
    const { round, ends } = this.schedule();
    const index = ends.findIndex((end) => now < end);
    return { round: round.number, name: PHASES[index === -1 ? 2 : index], endsAt: ends[index === -1 ? 2 : index] };
  }

  // Not realtime: the clock is just timestamps, and whatever happens at the end of a phase is
  // done on the next request after it. The loop catches up if nobody visited for a while.
  advance(now) {
    for (let step = 0; step < 50; step++) {
      const { round, ends } = this.schedule();
      const [, secondEnd, finalsEnd] = ends;
      if (now < secondEnd) return;

      const finalists = this.getSetting("finalists");
      if (finalists?.round !== round.number) {
        const picked = this.pickFinalists();
        this.setSetting("finalists", { round: round.number, entries: picked });
        // Nobody qualified for the finals: skip them and go straight to the next round.
        if (!picked.length) {
          this.endRound(secondEnd, null);
          continue;
        }
      }
      if (now < finalsEnd) return;

      this.endRound(finalsEnd, this.pickWinner());
    }
  }

  // Everything from this round retires; only the winner lives on in the Hall of Fame.
  endRound(at, winner) {
    if (winner) {
      this.sql.exec("INSERT INTO hall_of_fame (entry) VALUES (?)", JSON.stringify(winner));
      this.setSetting("reveal", { entry: winner, until: at + this.timing().reveal * MINUTE });
    }
    this.clearRound();
    const round = this.getSetting("round");
    this.setSetting("round", { number: round.number + 1, startedAt: at });
  }

  clearRound() {
    this.sql.exec(`
      DELETE FROM symptoms;
      DELETE FROM prescriptions;
      DELETE FROM assignments;
      DELETE FROM matchup_votes;
      DELETE FROM finals_votes;
    `);
    this.setSetting("finalists", null);
    this.seedPremadeSymptoms();
  }

  startGame(now) {
    this.sql.exec("DELETE FROM hall_of_fame");
    this.setSetting("reveal", null);
    this.clearRound();
    this.setSetting("round", { number: 1, startedAt: now });
  }

  // Premade symptoms join each round's pool, so early doctors always have something to treat.
  seedPremadeSymptoms() {
    for (const category of config.categories) {
      for (const premade of category.premade_symptoms ?? []) {
        const template = TEMPLATES.get(premade.template_id);
        this.sql.exec(
          "INSERT INTO symptoms (author_id, text, created_at) VALUES (NULL, ?, 0)",
          fillTemplate(template, premade.slots),
        );
      }
    }
  }

  // Every prescription with how often it was shown in a matchup and how many thumbs up it got.
  prescriptionStats() {
    return this.sql.exec(`
      SELECT p.id, p.symptom_id, p.text, p.author_id,
             s.text AS symptom, s.author_id AS patient_id,
             (SELECT COUNT(*) FROM matchup_votes v WHERE v.a_id = p.id OR v.b_id = p.id) AS shown,
             (SELECT COALESCE(SUM(CASE WHEN v.a_id = p.id THEN v.a_up ELSE v.b_up END), 0)
                FROM matchup_votes v WHERE v.a_id = p.id OR v.b_id = p.id) AS ups
      FROM prescriptions p JOIN symptoms s ON s.id = p.symptom_id
    `).toArray().map((row) => ({ ...row, approval: row.shown ? row.ups / row.shown : 0 }));
  }

  // Higher approval first, then more appearances, then whichever was written first.
  static compareStats(a, b) {
    return b.approval - a.approval || b.shown - a.shown || a.id - b.id;
  }

  // Each symptom is ranked by its best prescription (approval rate, with enough appearances to
  // count); the top symptoms become the finalists.
  // Every symptom whose best prescription has been shown often enough to count, ranked the same
  // way the finalists are picked. The top ones become the finalists.
  rankCandidates() {
    const best = new Map();
    for (const row of this.prescriptionStats()) {
      if (row.shown < config.finalists.min_appearances) continue;
      const current = best.get(row.symptom_id);
      if (!current || Game.compareStats(row, current) < 0) best.set(row.symptom_id, row);
    }
    return [...best.values()].sort(Game.compareStats);
  }

  pickFinalists() {
    return this.rankCandidates().slice(0, config.finalists.count).map((row) => this.toEntry(row));
  }

  toEntry(row) {
    const patient = row.patient_id && this.getPlayer({ playerId: row.patient_id });
    const doctor = this.getPlayer({ playerId: row.author_id });
    return {
      prescriptionId: row.id,
      approval: row.approval,
      symptom: row.symptom,
      prescription: row.text,
      patient: patient ? patient.nickname : config.premade_patient_name,
      // Premade symptoms have no patient avatar.
      patientAvatar: patient?.avatar ?? null,
      thumbsUp: row.ups,
      doctor: { name: doctor ? doctorName(doctor.nickname) : "", avatar: doctor?.avatar ?? AVATARS[0] },
    };
  }

  // Most finals votes wins; ties go to the higher approval rate, then the earlier prescription.
  pickWinner() {
    const entries = this.getSetting("finalists")?.entries ?? [];
    if (!entries.length) return null;
    const counts = entries.map(() => 0);
    for (const { choice } of this.sql.exec("SELECT choice FROM finals_votes").toArray()) {
      if (counts[choice] !== undefined) counts[choice]++;
    }
    const ranked = entries
      .map((entry, i) => ({ entry, votes: counts[i] }))
      .sort((a, b) => b.votes - a.votes || b.entry.approval - a.entry.approval || a.entry.prescriptionId - b.entry.prescriptionId);
    return { ...ranked[0].entry, finalsVotes: ranked[0].votes };
  }

  // What everyone may see: the phase and its end time, the finalists during the finals
  // (without names, so the vote stays anonymous) and the reveal while it's showing.
  publicState(now = Date.now()) {
    const phase = this.phase(now);
    const reveal = this.getSetting("reveal");
    const finalists = phase.name === "finals" ? this.getSetting("finalists")?.entries ?? [] : [];
    return {
      now,
      round: phase.round,
      phase: phase.name,
      phaseEndsAt: phase.endsAt,
      finalists: finalists.map(({ symptom, prescription, doctor }) => ({ symptom, prescription, doctor: { avatar: doctor.avatar } })),
      reveal: reveal && reveal.until > now ? reveal.entry : null,
    };
  }

  // ---------- Public ----------

  getState() {
    return this.publicState();
  }

  // Everything the big screen needs in one request.
  getScreen() {
    const state = this.publicState();
    const candidates = state.phase === "finals" ? [] : this.rankCandidates().slice(0, MAX_CANDIDATES_SHOWN);
    return {
      state,
      candidates: candidates.map((row) => this.toEntry(row)),
      hallOfFame: this.sql.exec("SELECT entry FROM hall_of_fame ORDER BY id DESC").toArray().map((row) => JSON.parse(row.entry)),
      players: this.sql.exec("SELECT nickname, avatar FROM players ORDER BY rowid").toArray(),
    };
  }

  // ---------- Players ----------

  getPlayer({ playerId }) {
    return this.one("SELECT nickname, avatar FROM players WHERE id = ?", playerId);
  }

  savePlayer({ playerId, body: { nickname, avatar } }) {
    const key = nickname.toLowerCase();
    if (this.one("SELECT 1 FROM players WHERE nickname_key = ? AND id != ?", key, playerId)) {
      throw new HttpError(409, `${nickname} is already in the game. Pick another name!`);
    }
    this.sql.exec(
      `INSERT INTO players (id, nickname, nickname_key, avatar) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET nickname = excluded.nickname, nickname_key = excluded.nickname_key, avatar = excluded.avatar`,
      playerId, nickname, key, avatar,
    );
    return { nickname, avatar };
  }

  // ---------- Patient mode ----------

  getSymptomTemplate({ playerId }) {
    this.requirePlayer(playerId);
    this.requirePhase(["clinic_open"], PHASE_MESSAGES.clinic_open);
    const templates = [...TEMPLATES.values()];
    const { id, text, slots } = templates[Math.floor(Math.random() * templates.length)];
    return { id, text, slots };
  }

  addSymptom({ playerId, body }) {
    this.requirePlayer(playerId);
    this.requirePhase(["clinic_open"], PHASE_MESSAGES.clinic_open);
    const template = TEMPLATES.get(body?.templateId);
    if (!template) throw new HttpError(400, "Unknown symptom");

    const filled = {};
    for (const key of Object.keys(template.slots)) {
      const value = cleanText(body?.slots?.[key]);
      if (!value) throw new HttpError(400, "Fill in every blank");
      if (value.length > LIMITS.slot_characters) throw new HttpError(400, `Each blank can be at most ${LIMITS.slot_characters} characters`);
      filled[key] = value;
    }
    const text = fillTemplate(template, filled);
    if (text.length > LIMITS.symptom_characters) {
      throw new HttpError(400, `The whole symptom can be at most ${LIMITS.symptom_characters} characters`);
    }

    this.sql.exec("INSERT INTO symptoms (author_id, text, created_at) VALUES (?, ?, ?)", playerId, text, Date.now());
    return { ok: true };
  }

  // ---------- Doctor mode ----------

  // A random symptom that isn't the player's own and that they haven't treated yet, favouring
  // ones with fewer prescriptions. Asking again returns the same one, so a reload keeps it.
  getPrescriptionTask({ playerId }) {
    this.requirePlayer(playerId);
    this.requirePhase(["clinic_open"], PHASE_MESSAGES.clinic_open);

    const round = this.getSetting("round").number;
    const current = this.one(
      "SELECT s.id, s.text FROM assignments a JOIN symptoms s ON s.id = a.symptom_id WHERE a.player_id = ?",
      playerId,
    );
    if (current) return { ...current, round };

    const symptom = this.one(
      `SELECT s.id, s.text FROM symptoms s
       WHERE (s.author_id IS NULL OR s.author_id != ?)
         AND NOT EXISTS (SELECT 1 FROM prescriptions p WHERE p.symptom_id = s.id AND p.author_id = ?)
       ORDER BY (SELECT COUNT(*) FROM prescriptions p WHERE p.symptom_id = s.id), RANDOM()
       LIMIT 1`,
      playerId, playerId,
    );
    if (!symptom) return null;
    this.sql.exec("INSERT OR REPLACE INTO assignments (player_id, symptom_id) VALUES (?, ?)", playerId, symptom.id);
    return { ...symptom, round };
  }

  addPrescription({ playerId, body }) {
    this.requirePlayer(playerId);
    this.requirePhase(["clinic_open"], PHASE_MESSAGES.clinic_open);
    this.requireRound(body?.round);
    const text = cleanText(body?.text);
    if (!text || text.length > LIMITS.prescription_characters) {
      throw new HttpError(400, `Prescriptions can be 1–${LIMITS.prescription_characters} characters`);
    }
    const symptom = this.one("SELECT id, author_id FROM symptoms WHERE id = ?", body?.symptomId);
    if (!symptom || symptom.author_id === playerId) throw new HttpError(400, "Unknown symptom");

    this.sql.exec(
      "INSERT OR IGNORE INTO prescriptions (symptom_id, author_id, text, created_at) VALUES (?, ?, ?, ?)",
      symptom.id, playerId, text, Date.now(),
    );
    this.sql.exec("DELETE FROM assignments WHERE player_id = ?", playerId);
    return { ok: true };
  }

  // ---------- Shortlist voting ----------

  // Two prescriptions for the same symptom that this player hasn't been shown together yet,
  // favouring prescriptions that have been shown the least. Own symptoms and prescriptions count.
  getVoteTask({ playerId }) {
    this.requirePlayer(playerId);
    this.requirePhase(["clinic_open", "second_opinions"], PHASE_MESSAGES.voting);
    const pair = this.one(
      `SELECT p1.id AS a, p2.id AS b, s.text AS symptom, p1.text AS a_text, p2.text AS b_text
       FROM prescriptions p1
       JOIN prescriptions p2 ON p2.symptom_id = p1.symptom_id AND p2.id > p1.id
       JOIN symptoms s ON s.id = p1.symptom_id
       WHERE NOT EXISTS (SELECT 1 FROM matchup_votes v WHERE v.player_id = ? AND v.a_id = p1.id AND v.b_id = p2.id)
       ORDER BY (SELECT COUNT(*) FROM matchup_votes v
                 WHERE v.a_id IN (p1.id, p2.id) OR v.b_id IN (p1.id, p2.id)), RANDOM()
       LIMIT 1`,
      playerId,
    );
    if (!pair) return null;
    const prescriptions = [{ id: pair.a, text: pair.a_text }, { id: pair.b, text: pair.b_text }];
    if (Math.random() < 0.5) prescriptions.reverse();
    return { round: this.getSetting("round").number, symptom: pair.symptom, prescriptions };
  }

  // body: { ids: [two prescription ids], up: [ids that got a thumbs up] }. No thumbs = skip,
  // which still counts as both prescriptions being shown once.
  addVote({ playerId, body }) {
    this.requirePlayer(playerId);
    this.requirePhase(["clinic_open", "second_opinions"], PHASE_MESSAGES.voting);
    this.requireRound(body?.round);
    const [a, b] = (body?.ids ?? []).map(Number).sort((x, y) => x - y);
    if (!Number.isInteger(a) || !Number.isInteger(b)) throw new HttpError(400, "Unknown prescriptions");
    const rows = this.sql.exec("SELECT id, symptom_id FROM prescriptions WHERE id IN (?, ?)", a, b).toArray();
    if (a === b || rows.length !== 2 || rows[0].symptom_id !== rows[1].symptom_id) {
      throw new HttpError(400, "Unknown prescriptions");
    }
    if (this.one("SELECT 1 FROM matchup_votes WHERE player_id = ? AND a_id = ? AND b_id = ?", playerId, a, b)) {
      throw new HttpError(409, "You already voted on this pair");
    }
    const up = new Set((body?.up ?? []).map(Number));
    this.sql.exec(
      "INSERT INTO matchup_votes (player_id, a_id, b_id, a_up, b_up) VALUES (?, ?, ?, ?, ?)",
      playerId, a, b, up.has(a) ? 1 : 0, up.has(b) ? 1 : 0,
    );
    return { ok: true };
  }

  // ---------- Finals ----------

  getFinalsBallot({ playerId }) {
    this.requirePlayer(playerId);
    this.requirePhase(["finals"], PHASE_MESSAGES.finals);
    const vote = this.one("SELECT choice FROM finals_votes WHERE player_id = ?", playerId);
    return { finalists: this.publicState().finalists, choice: vote?.choice ?? null };
  }

  // Players can change their pick until the finals end; the last one counts.
  addFinalsVote({ playerId, body }) {
    this.requirePlayer(playerId);
    this.requirePhase(["finals"], PHASE_MESSAGES.finals);
    const choice = Number(body?.choice);
    const count = this.getSetting("finalists")?.entries.length ?? 0;
    if (!Number.isInteger(choice) || choice < 0 || choice >= count) throw new HttpError(400, "Unknown finalist");
    this.sql.exec("INSERT OR REPLACE INTO finals_votes (player_id, choice) VALUES (?, ?)", playerId, choice);
    return { choice };
  }

  // ---------- Admin ----------

  getAdminSettings() {
    return { timing: this.timing() };
  }

  saveAdminSettings({ body }) {
    const timing = {};
    for (const key of TIMING_KEYS) {
      const minutes = Number(body?.timing?.[key]);
      if (!Number.isFinite(minutes) || minutes < 0.5 || minutes > 600) {
        throw new HttpError(400, "Phase lengths must be between 0.5 and 600 minutes");
      }
      timing[key] = minutes;
    }
    this.setSetting("timing", timing);
    this.advance(Date.now());
    return { timing };
  }

  // Ends the current phase now, with whatever normally happens at its end.
  skipPhase() {
    const now = Date.now();
    const { round } = this.schedule();
    const { endsAt } = this.phase(now);
    this.setSetting("round", { ...round, startedAt: round.startedAt - (endsAt - now) });
    this.advance(now);
    return this.publicState(now);
  }

  // Starts this round's clock again from Clinic open, keeping its symptoms and prescriptions.
  restartRound() {
    const round = this.getSetting("round");
    this.sql.exec("DELETE FROM finals_votes");
    this.setSetting("finalists", null);
    this.setSetting("round", { ...round, startedAt: Date.now() });
    return this.publicState();
  }

  // Starts a fresh game from round 1: wipes symptoms, prescriptions, votes and the Hall of Fame
  // but keeps players and their names.
  resetGame() {
    this.startGame(Date.now());
    return { ok: true };
  }

  // Wipes everything, players included. Their phones will ask them to join again.
  resetEverything() {
    this.sql.exec("DELETE FROM players");
    return this.resetGame();
  }
}

const routes = [
  ["GET", /^\/api\/state$/, "getState"],
  ["GET", /^\/api\/screen$/, "getScreen"],
  ["POST", /^\/api\/admin\/login$/, "adminLogin"],
  ["GET", /^\/api\/admin\/settings$/, "getAdminSettings"],
  ["PUT", /^\/api\/admin\/settings$/, "saveAdminSettings"],
  ["POST", /^\/api\/admin\/skip-phase$/, "skipPhase"],
  ["POST", /^\/api\/admin\/restart-round$/, "restartRound"],
  ["POST", /^\/api\/reset$/, "resetGame"],
  ["POST", /^\/api\/reset-everything$/, "resetEverything"],
  ["GET", /^\/api\/players\/([^/]+)$/, "getPlayer"],
  ["PUT", /^\/api\/players\/([^/]+)$/, "savePlayer"],
  ["GET", /^\/api\/players\/([^/]+)\/symptom-template$/, "getSymptomTemplate"],
  ["POST", /^\/api\/players\/([^/]+)\/symptoms$/, "addSymptom"],
  ["GET", /^\/api\/players\/([^/]+)\/prescription-task$/, "getPrescriptionTask"],
  ["POST", /^\/api\/players\/([^/]+)\/prescriptions$/, "addPrescription"],
  ["GET", /^\/api\/players\/([^/]+)\/vote-task$/, "getVoteTask"],
  ["POST", /^\/api\/players\/([^/]+)\/votes$/, "addVote"],
  ["GET", /^\/api\/players\/([^/]+)\/finals$/, "getFinalsBallot"],
  ["POST", /^\/api\/players\/([^/]+)\/finals$/, "addFinalsVote"],
];

// Routes that need the admin password (the ADMIN_PASSWORD secret) in the X-Admin-Password header.
const ADMIN_ACTIONS = new Set([
  "adminLogin", "getAdminSettings", "saveAdminSettings", "skipPhase", "restartRound", "resetGame", "resetEverything",
]);

async function sha256(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

// Returns an error response if the request doesn't carry the right admin password.
async function checkAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return Response.json({ error: "No admin password is set up on the server" }, { status: 503 });
  }
  // Compare hashes in constant time so the password can't be guessed from response timings.
  const given = await sha256(request.headers.get("X-Admin-Password") ?? "");
  const expected = await sha256(env.ADMIN_PASSWORD);
  if (!crypto.subtle.timingSafeEqual(given, expected)) {
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  return null;
}

function cleanPlayer(body) {
  const nickname = cleanText(body?.nickname);
  const avatar = body?.avatar;

  if (nickname.length < 1 || nickname.length > MAX_NICKNAME_LENGTH) {
    throw new HttpError(400, `Nickname must be 1–${MAX_NICKNAME_LENGTH} characters`);
  }
  if (!AVATARS.includes(avatar)) {
    throw new HttpError(400, "Unknown avatar");
  }
  return { nickname, avatar };
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const route = routes.find(([method, pattern]) => method === request.method && pattern.test(pathname));
    if (!route) return Response.json({ error: "Not found" }, { status: 404 });

    const [, pattern, action] = route;
    const playerId = pathname.match(pattern)[1]?.toLowerCase();
    if (playerId !== undefined && !UUID.test(playerId)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (ADMIN_ACTIONS.has(action)) {
      const denied = await checkAdmin(request, env);
      if (denied) return denied;
      if (action === "adminLogin") return Response.json({ ok: true });
    }

    let body = request.method === "GET" ? null : await request.json().catch(() => null);
    try {
      if (action === "savePlayer") body = cleanPlayer(body);
    } catch (error) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    const game = env.GAME.get(env.GAME.idFromName("game"));
    const { status, data } = await game.run(action, playerId, body);
    return Response.json(data, { status });
  },
};
