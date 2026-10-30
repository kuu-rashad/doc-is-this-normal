import { DurableObject } from "cloudflare:workers";
import config from "../assets/gameconfig.json";

const AVATARS = [
  "blue", "brown", "green", "lime", "orange", "pink", "purple", "red", "yellow",
  "green_patient", "purple_patient", "yellow_patient",
];
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

// Filled-in words are wrapped in these two private-use characters, so wherever the sentence is
// shown the screens can highlight what the player wrote. They travel with the text (into the
// Hall of Fame too); players can't type them (see cleanText).
const MARK_START = "\uE000";
const MARK_END = "\uE001";
const MARKS = /[\uE000\uE001]/g;
const unmarked = (text) => text.replace(MARKS, "");

// Fills the blanks, and capitalises the first letter in case the text starts with a blank
// ("{{cure}} should do it." → "A goat should do it.").
function fillTemplate(template, slots) {
  const text = template.text.replace(/\{\{(\w+)\}\}/g, (_, key) => MARK_START + slots[key] + MARK_END);
  const first = text.startsWith(MARK_START) ? 1 : 0;
  return text.slice(0, first) + text.charAt(first).toUpperCase() + text.slice(first + 1);
}

// Prescription frames; like symptom templates, each blank lists its own "Surprise me" options.
const PRESCRIPTION_TEMPLATES = new Map(config.prescriptions.templates.map((template) => [template.id, template]));

// Two prescriptions count as the same if they match ignoring case, spacing and punctuation.
function sameTextKey(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Checks a filled-in template and returns the finished text.
function fillChecked(template, slots, maxLength, what) {
  const filled = {};
  for (const key of Object.keys(template.slots)) {
    const value = cleanText(slots?.[key]);
    if (!value) throw new HttpError(400, "Fill in every blank");
    if (value.length > LIMITS.slot_characters) throw new HttpError(400, `Each blank can be at most ${LIMITS.slot_characters} characters`);
    filled[key] = value;
  }
  const text = fillTemplate(template, filled);
  if (unmarked(text).length > maxLength) throw new HttpError(400, `The whole ${what} can be at most ${maxLength} characters`);
  return text;
}

function cleanText(value) {
  return String(value ?? "").replace(MARKS, "").trim().replace(/\s+/g, " ");
}

// Players are only "Dr." when they're the one behind a prescription.
function doctorName(nickname) {
  return `Dr. ${nickname}`;
}

// Players are "Patient <nickname>" wherever they appear as the author of a symptom.
function patientName(nickname) {
  return `Patient ${nickname}`;
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
export class DocGame extends DurableObject {
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

    // Votes used to be thumbs up on two prescriptions for the same symptom; they're now a pick
    // between any two symptom + prescription pairs, kept in pair_votes.
    this.sql.exec("DROP TABLE IF EXISTS matchup_votes");

    // nickname_key is the lowercased nickname, so "Duck" and "duck" count as the same name.
    // A "pair" is a symptom with one of its prescriptions, identified by the prescription's id.
    // prescriptions.shown / .wins: how often the pair was in a vote, and how often it was picked.
    // pair_votes: one row per player per two pairs they were shown (a_id < b_id), with the pair they
    // picked (NULL = skipped) and the sentence they starred, if any.
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
        created_at INTEGER NOT NULL,
        stars INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS prescriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symptom_id INTEGER NOT NULL,
        author_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        shown INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        stars INTEGER NOT NULL DEFAULT 0,
        UNIQUE (symptom_id, author_id)
      );
      CREATE TABLE IF NOT EXISTS assignments (
        player_id TEXT PRIMARY KEY,
        symptom_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pair_votes (
        player_id TEXT NOT NULL,
        a_id INTEGER NOT NULL,
        b_id INTEGER NOT NULL,
        winner_id INTEGER,
        star_kind TEXT,
        star_id INTEGER,
        PRIMARY KEY (player_id, a_id, b_id)
      );
      CREATE TABLE IF NOT EXISTS finals_votes (
        player_id TEXT PRIMARY KEY,
        choice INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS points (
        player_id TEXT PRIMARY KEY,
        points INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hall_of_fame (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry TEXT NOT NULL
      );
      -- Pairs from finished rounds that were picked as funnier at least once, for the all-rounds
      -- list on the big screen. entry is the pair as the screen shows it (no player ids).
      CREATE TABLE IF NOT EXISTS voted_archive (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        round INTEGER NOT NULL,
        entry TEXT NOT NULL
      );
    `);

    // Columns added after the first release.
    const columnsOf = (table) => this.sql.exec(`PRAGMA table_info(${table})`).toArray().map((c) => c.name);
    const rxColumns = columnsOf("prescriptions");
    if (!rxColumns.includes("shown")) {
      this.sql.exec(`
        ALTER TABLE prescriptions ADD COLUMN shown INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE prescriptions ADD COLUMN wins INTEGER NOT NULL DEFAULT 0;
      `);
    }
    if (!rxColumns.includes("stars")) this.sql.exec("ALTER TABLE prescriptions ADD COLUMN stars INTEGER NOT NULL DEFAULT 0");
    if (!columnsOf("symptoms").includes("stars")) this.sql.exec("ALTER TABLE symptoms ADD COLUMN stars INTEGER NOT NULL DEFAULT 0");
    // points.stars: stars the player's lines have received in this game. new_wins / new_stars:
    // pair wins and stars their phone hasn't announced yet.
    if (!columnsOf("points").includes("stars")) {
      this.sql.exec(`
        ALTER TABLE points ADD COLUMN stars INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE points ADD COLUMN new_wins INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE points ADD COLUMN new_stars INTEGER NOT NULL DEFAULT 0;
      `);
    }

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

  // Points add up across rounds; see "points" in the config for what earns them.
  addPoints(playerId, amount) {
    if (!playerId || !amount) return;
    this.sql.exec(
      `INSERT INTO points (player_id, points) VALUES (?, ?)
       ON CONFLICT (player_id) DO UPDATE SET points = points + excluded.points`,
      playerId, amount,
    );
  }

  // Counts a pair win or a star for the player's phone to announce (and, for stars, their total).
  addNews(playerId, kind) {
    if (!playerId) return;
    this.sql.exec("INSERT INTO points (player_id, points) VALUES (?, 0) ON CONFLICT (player_id) DO NOTHING", playerId);
    if (kind === "win") this.sql.exec("UPDATE points SET new_wins = new_wins + 1 WHERE player_id = ?", playerId);
    else this.sql.exec("UPDATE points SET stars = stars + 1, new_stars = new_stars + 1 WHERE player_id = ?", playerId);
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

      this.endRound(finalsEnd, this.rankFinalists());
    }
  }

  // Everything from this round retires; only the winner lives on in the Hall of Fame.
  // ranked: the finalists, best first (or null when the finals were skipped). The top places
  // earn points for both the patient and the doctor behind the pair.
  // The round's most-starred sentences (symptoms and prescriptions alike), most stars first.
  mostStarred() {
    const playerName = (id) => this.getPlayer({ playerId: id })?.nickname;
    const symptoms = this.sql.exec("SELECT text, author_id, stars, id FROM symptoms WHERE stars > 0").toArray()
      .map((row) => ({ kind: "symptom", text: row.text, stars: row.stars, order: row.id,
        author: row.author_id ? patientName(playerName(row.author_id) ?? "") : config.premade_patient_name }));
    const prescriptions = this.sql.exec("SELECT text, author_id, stars, id FROM prescriptions WHERE stars > 0").toArray()
      .map((row) => ({ kind: "prescription", text: row.text, stars: row.stars, order: row.id,
        author: doctorName(playerName(row.author_id) ?? "") }));
    return [...symptoms, ...prescriptions]
      .sort((a, b) => b.stars - a.stars || a.order - b.order)
      .slice(0, config.most_starred_shown)
      .map(({ order, ...line }) => line);
  }

  endRound(at, ranked) {
    const starred = this.mostStarred();
    if (ranked?.length) {
      ranked.slice(0, config.points.final_places.length).forEach((entry, place) => {
        this.addPoints(entry.authors?.patient, config.points.final_places[place]);
        this.addPoints(entry.authors?.doctor, config.points.final_places[place]);
      });
      // Player ids double as their login, so they never leave the server.
      const { authors, ...winner } = ranked[0];
      this.sql.exec("INSERT INTO hall_of_fame (entry) VALUES (?)", JSON.stringify(winner));
      this.setSetting("reveal", { entry: winner, starred, until: at + this.timing().reveal * MINUTE });
    }
    const round = this.getSetting("round");
    for (const entry of this.votedThisRound()) {
      this.sql.exec("INSERT INTO voted_archive (round, entry) VALUES (?, ?)", round.number, JSON.stringify(entry));
    }
    this.clearRound();
    this.setSetting("round", { number: round.number + 1, startedAt: at });
  }

  clearRound() {
    this.sql.exec(`
      DELETE FROM symptoms;
      DELETE FROM prescriptions;
      DELETE FROM assignments;
      DELETE FROM pair_votes;
      DELETE FROM finals_votes;
    `);
    this.setSetting("finalists", null);
    this.seedPremadeSymptoms();
  }

  startGame(now) {
    this.sql.exec("DELETE FROM hall_of_fame");
    this.sql.exec("DELETE FROM voted_archive");
    this.sql.exec("DELETE FROM points");
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

  // Every pair (symptom + prescription) with how often it was in a vote and how often it won.
  // "approval" is its win rate.
  prescriptionStats() {
    return this.sql.exec(`
      SELECT p.id, p.symptom_id, p.text, p.author_id, p.shown, p.wins,
             s.text AS symptom, s.author_id AS patient_id
      FROM prescriptions p JOIN symptoms s ON s.id = p.symptom_id
    `).toArray().map((row) => ({ ...row, approval: row.shown ? row.wins / row.shown : 0 }));
  }

  // Higher win rate first, then more appearances, then whichever was written first.
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
      if (!current || DocGame.compareStats(row, current) < 0) best.set(row.symptom_id, row);
    }
    return [...best.values()].sort(DocGame.compareStats);
  }

  // Finalists also remember who wrote them (for points at the end); those ids stay on the server.
  pickFinalists() {
    return this.rankCandidates()
      .slice(0, config.finalists.count)
      .map((row) => ({ ...this.toEntry(row), authors: { patient: row.patient_id ?? null, doctor: row.author_id } }));
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
      // Premade (walk-in) symptoms have no player behind them; they get their own avatar,
      // which players can't pick.
      walkIn: !patient,
      patientAvatar: patient ? patient.avatar : config.premade_patient_avatar,
      wins: row.wins,
      doctor: { name: doctor ? doctorName(doctor.nickname) : "", avatar: doctor?.avatar ?? AVATARS[0] },
    };
  }

  // The finalists ranked by finals votes, best first; ties go to the higher approval rate, then
  // the earlier prescription.
  rankFinalists() {
    const entries = this.getSetting("finalists")?.entries ?? [];
    if (!entries.length) return null;
    const counts = entries.map(() => 0);
    for (const { choice } of this.sql.exec("SELECT choice FROM finals_votes").toArray()) {
      if (counts[choice] !== undefined) counts[choice]++;
    }
    const ranked = entries
      .map((entry, i) => ({ entry, votes: counts[i] }))
      .sort((a, b) => b.votes - a.votes || b.entry.approval - a.entry.approval || a.entry.prescriptionId - b.entry.prescriptionId);
    return ranked.map(({ entry, votes }) => ({ ...entry, finalsVotes: votes }));
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
      // Everything the screens show about each finalist; the authors' player ids stay here.
      finalists: finalists.map(({ authors, ...entry }) => entry),
      reveal: reveal && reveal.until > now ? reveal.entry : null,
      revealStarred: reveal && reveal.until > now ? reveal.starred ?? [] : [],
    };
  }

  // Every pair of this round picked as funnier at least once.
  votedThisRound() {
    return this.prescriptionStats()
      .filter((row) => row.wins > 0)
      .map((row) => ({ ...this.toEntry(row), shown: row.shown }));
  }

  // Those pairs from every round so far: most picks first, then the higher win rate, then
  // whichever came first.
  votedAllRounds(currentRound) {
    const past = this.sql.exec("SELECT round, entry FROM voted_archive ORDER BY id").toArray()
      .map((row) => ({ ...JSON.parse(row.entry), round: row.round }));
    const current = this.votedThisRound().map((entry) => ({ ...entry, round: currentRound }));
    return [...past, ...current].sort((a, b) =>
      b.wins - a.wins || b.approval - a.approval || a.round - b.round || a.prescriptionId - b.prescriptionId);
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
      voted: this.votedAllRounds(state.round),
      hallOfFame: this.sql.exec("SELECT entry FROM hall_of_fame ORDER BY id DESC").toArray().map((row) => JSON.parse(row.entry)),
      players: this.sql.exec("SELECT nickname, avatar FROM players ORDER BY rowid").toArray(),
      // Top 3 by points; ties go to whoever joined first.
      leaderboard: this.sql.exec(
        `SELECT p.nickname, p.avatar, s.points FROM points s JOIN players p ON p.id = s.player_id
         WHERE s.points > 0 ORDER BY s.points DESC, p.rowid LIMIT 3`,
      ).toArray(),
      scoring: config.points,
    };
  }

  // ---------- Players ----------

  getPlayer({ playerId }) {
    return this.one("SELECT nickname, avatar FROM players WHERE id = ?", playerId);
  }

  // The player's own card on their phone: profile, score, stars, leaderboard place (same order
  // as the big screen's TOP 3), wins and stars not announced yet, and the scoring rules.
  getMe({ playerId }) {
    const me = this.getPlayer({ playerId });
    if (!me) return null;
    const stats = this.one(
      `SELECT s.points, s.stars, s.new_wins, s.new_stars,
              (SELECT COUNT(*) FROM points o JOIN players q ON q.id = o.player_id
               WHERE o.points > s.points OR (o.points = s.points AND q.rowid < p.rowid)) + 1 AS place
       FROM points s JOIN players p ON p.id = s.player_id WHERE s.player_id = ?`,
      playerId,
    );
    return {
      ...me,
      points: stats?.points ?? 0,
      stars: stats?.stars ?? 0,
      // Only players with points are on the leaderboard.
      place: stats?.points > 0 ? stats.place : null,
      news: { wins: stats?.new_wins ?? 0, stars: stats?.new_stars ?? 0 },
      scoring: config.points,
    };
  }

  // The phone has announced these; newer ones that arrived meanwhile stay for next time.
  seenNews({ playerId, body }) {
    this.requirePlayer(playerId);
    const count = (value) => Math.max(0, Math.floor(Number(value) || 0));
    this.sql.exec(
      "UPDATE points SET new_wins = MAX(0, new_wins - ?), new_stars = MAX(0, new_stars - ?) WHERE player_id = ?",
      count(body?.wins), count(body?.stars), playerId,
    );
    return { ok: true };
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
    const text = fillChecked(template, body?.slots, LIMITS.symptom_characters, "symptom");

    this.sql.exec("INSERT INTO symptoms (author_id, text, created_at) VALUES (?, ?, ?)", playerId, text, Date.now());
    this.addPoints(playerId, config.points.symptom);
    return { ok: true };
  }

  // ---------- Doctor mode ----------

  // A random symptom that isn't the player's own and that they haven't treated yet, favouring
  // those with the fewest prescriptions (every prescription already makes a votable pair, so this
  // spreads them over as many patients as possible). Asking again returns the same one, so a
  // reload keeps it.
  getPrescriptionTask({ playerId }) {
    this.requirePlayer(playerId);
    this.requirePhase(["clinic_open"], PHASE_MESSAGES.clinic_open);

    const round = this.getSetting("round").number;
    const current = this.one(
      "SELECT s.id, s.text FROM assignments a JOIN symptoms s ON s.id = a.symptom_id WHERE a.player_id = ?",
      playerId,
    );
    const templates = [...PRESCRIPTION_TEMPLATES.values()];
    if (current) return { ...current, round, templates };

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
    return { ...symptom, round, templates };
  }

  addPrescription({ playerId, body }) {
    this.requirePlayer(playerId);
    this.requirePhase(["clinic_open"], PHASE_MESSAGES.clinic_open);
    this.requireRound(body?.round);
    // Either a filled-in frame ({ templateId, slots }) or the doctor's own words ({ text }).
    let text;
    if (body?.templateId) {
      const template = PRESCRIPTION_TEMPLATES.get(body.templateId);
      if (!template) throw new HttpError(400, "Unknown prescription");
      text = fillChecked(template, body.slots, LIMITS.prescription_characters, "prescription");
    } else {
      text = cleanText(body?.text);
      if (!text || text.length > LIMITS.prescription_characters) {
        throw new HttpError(400, `Prescriptions can be 1–${LIMITS.prescription_characters} characters`);
      }
    }
    const symptom = this.one("SELECT id, author_id FROM symptoms WHERE id = ?", body?.symptomId);
    if (!symptom || symptom.author_id === playerId) throw new HttpError(400, "Unknown symptom");

    const key = sameTextKey(text);
    const existing = this.sql.exec("SELECT text FROM prescriptions WHERE symptom_id = ?", symptom.id).toArray();
    if (existing.some((row) => sameTextKey(row.text) === key)) {
      throw new HttpError(409, "Another doctor already told me this.");
    }

    const { rowsWritten } = this.sql.exec(
      "INSERT OR IGNORE INTO prescriptions (symptom_id, author_id, text, created_at) VALUES (?, ?, ?, ?)",
      symptom.id, playerId, text, Date.now(),
    );
    if (rowsWritten) this.addPoints(playerId, config.points.prescription);
    this.sql.exec("DELETE FROM assignments WHERE player_id = ?", playerId);
    return { ok: true };
  }

  // ---------- Shortlist voting ----------

  pairFor(prescriptionId) {
    return this.one(
      `SELECT p.id, p.text AS prescription, p.author_id AS doctor_id, s.id AS symptom_id, s.text AS symptom, s.author_id AS patient_id
       FROM prescriptions p JOIN symptoms s ON s.id = p.symptom_id WHERE p.id = ?`,
      prescriptionId,
    );
  }

  // Two pairs this player hasn't been shown together yet, favouring pairs that have been shown
  // the least. They can share a symptom but don't have to; the player's own writing counts too.
  getVoteTask({ playerId }) {
    this.requirePlayer(playerId);
    this.requirePhase(["clinic_open", "second_opinions"], PHASE_MESSAGES.voting);
    const pairs = this.sql.exec("SELECT id FROM prescriptions ORDER BY shown, RANDOM()").toArray().map((row) => row.id);
    const seen = new Set(
      this.sql.exec("SELECT a_id, b_id FROM pair_votes WHERE player_id = ?", playerId).toArray().map((row) => `${row.a_id}-${row.b_id}`),
    );
    for (const a of pairs) {
      for (const b of pairs) {
        if (a === b || seen.has(`${Math.min(a, b)}-${Math.max(a, b)}`)) continue;
        const shown = [this.pairFor(a), this.pairFor(b)].map(({ id, symptom, prescription }) => ({ id, symptom, prescription }));
        return { round: this.getSetting("round").number, pairs: shown };
      }
    }
    return null;
  }

  // body: { ids: [two pair ids], winner: pair id or null, star: { kind: "symptom" | "prescription",
  // id: pair id } or null }. Skipping (no winner, no star) still counts as both pairs being shown.
  addVote({ playerId, body }) {
    this.requirePlayer(playerId);
    this.requirePhase(["clinic_open", "second_opinions"], PHASE_MESSAGES.voting);
    this.requireRound(body?.round);
    const [a, b] = (body?.ids ?? []).map(Number).sort((x, y) => x - y);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) throw new HttpError(400, "Unknown pairs");
    const pairs = [this.pairFor(a), this.pairFor(b)];
    if (pairs.some((pair) => !pair)) throw new HttpError(400, "Unknown pairs");
    if (this.one("SELECT 1 FROM pair_votes WHERE player_id = ? AND a_id = ? AND b_id = ?", playerId, a, b)) {
      throw new HttpError(409, "You already voted on these two");
    }

    const winner = body?.winner == null ? null : Number(body.winner);
    if (winner !== null && winner !== a && winner !== b) throw new HttpError(400, "Unknown pick");
    const star = body?.star ?? null;
    if (star && (!["symptom", "prescription"].includes(star.kind) || ![a, b].includes(Number(star.id)))) {
      throw new HttpError(400, "Unknown star");
    }

    this.sql.exec(
      "INSERT INTO pair_votes (player_id, a_id, b_id, winner_id, star_kind, star_id) VALUES (?, ?, ?, ?, ?, ?)",
      playerId, a, b, winner, star?.kind ?? null, star ? Number(star.id) : null,
    );
    this.sql.exec("UPDATE prescriptions SET shown = shown + 1 WHERE id IN (?, ?)", a, b);

    // Picking a favourite or starring a line counts as voting. The picked pair scores for its
    // patient and doctor; a star scores for whoever wrote that line (premade symptoms have no one).
    if (winner !== null || star) this.addPoints(playerId, config.points.vote);
    if (winner !== null) {
      this.sql.exec("UPDATE prescriptions SET wins = wins + 1 WHERE id = ?", winner);
      const won = pairs.find((pair) => pair.id === winner);
      for (const author of new Set([won.patient_id, won.doctor_id])) {
        this.addPoints(author, config.points.pair_win);
        this.addNews(author, "win");
      }
    }
    if (star) {
      const starred = pairs.find((pair) => pair.id === Number(star.id));
      if (star.kind === "symptom") this.sql.exec("UPDATE symptoms SET stars = stars + 1 WHERE id = ?", starred.symptom_id);
      else this.sql.exec("UPDATE prescriptions SET stars = stars + 1 WHERE id = ?", starred.id);
      const author = star.kind === "symptom" ? starred.patient_id : starred.doctor_id;
      this.addPoints(author, config.points.star_received);
      this.addNews(author, "star");
    }
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
    // The first pick each round scores; changing it later doesn't.
    const firstPick = !this.one("SELECT 1 FROM finals_votes WHERE player_id = ?", playerId);
    this.sql.exec("INSERT OR REPLACE INTO finals_votes (player_id, choice) VALUES (?, ?)", playerId, choice);
    if (firstPick) this.addPoints(playerId, config.points.vote);
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
  ["GET", /^\/api\/players\/([^/]+)$/, "getMe"],
  ["POST", /^\/api\/players\/([^/]+)\/news-seen$/, "seenNews"],
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
  // Every API answer is live game state: browsers (TV browsers especially) must never reuse one.
  async fetch(request, env) {
    const response = await handleApi(request, env);
    response.headers.set("Cache-Control", "no-store");
    return response;
  },
};

// Routes the request to the game, or answers it straight away (unknown routes, admin checks).
async function handleApi(request, env) {
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

  const game = env.DOC_GAME.get(env.DOC_GAME.idFromName("doc-game"));
  const { status, data } = await game.run(action, playerId, body);
  return Response.json(data, { status });
}
