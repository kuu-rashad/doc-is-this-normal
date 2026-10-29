import { DurableObject } from "cloudflare:workers";
import config from "../assets/gameconfig.json";

const AVATARS = ["blue", "brown", "green", "lime", "orange", "pink", "purple", "red", "yellow"];
const MAX_NICKNAME_LENGTH = 16;
const MAX_TREATMENT_LENGTH = 150;
const TREATMENTS_PER_SYMPTOM = 2;
const MAX_POINTS_PER_TREATMENT = 2;
// How long a symptom stays reserved for the player asked to treat it.
const ASSIGNMENT_MS = 5 * 60 * 1000;
// Later this will change during the game; for now only tier 1 is used.
const CURRENT_RISK_LEVEL = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEMPLATES = new Map(
  config.categories.flatMap((category) =>
    category.templates.map((template) => [template.id, { ...template, riskLevel: category.risk_level }]),
  ),
);

function fillTemplate(template, slots) {
  return template.text.replace(/\{\{(\w+)\}\}/g, (_, key) => slots[key]);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// There are no rooms: every player belongs to the one shared game, so a single
// Durable Object instance holds all game state.
export class Game extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // nickname_key is the lowercased nickname, so "Duck" and "duck" count as the same name.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        nickname_key TEXT NOT NULL UNIQUE,
        avatar TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS symptoms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id TEXT,
        premade_id TEXT UNIQUE,
        template_id TEXT NOT NULL,
        risk_level INTEGER NOT NULL,
        slots TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS treatments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symptom_id INTEGER NOT NULL,
        author_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (symptom_id, author_id)
      );
      CREATE TABLE IF NOT EXISTS assignments (
        player_id TEXT PRIMARY KEY,
        symptom_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS votes (
        player_id TEXT NOT NULL,
        symptom_id INTEGER NOT NULL,
        treatment_id INTEGER NOT NULL,
        points INTEGER NOT NULL,
        PRIMARY KEY (player_id, treatment_id)
      );
    `);
    this.seedPremadeSymptoms();
  }

  // Premade symptoms join the pool like any other, so early players always have something to treat.
  seedPremadeSymptoms() {
    // Premade symptoms that were removed from the config leave the pool, unless they're already
    // finished (2 treatments): those stay so their votes and homepage spot aren't lost.
    const premadeIds = config.categories.flatMap((category) => (category.premade_symptoms ?? []).map((p) => p.id));
    const stale = this.sql.exec(
      `SELECT id FROM symptoms s
       WHERE premade_id IS NOT NULL
         AND premade_id NOT IN (SELECT value FROM json_each(?))
         AND (SELECT COUNT(*) FROM treatments t WHERE t.symptom_id = s.id) < ?`,
      JSON.stringify(premadeIds), TREATMENTS_PER_SYMPTOM,
    ).toArray();
    for (const { id } of stale) {
      this.sql.exec("DELETE FROM treatments WHERE symptom_id = ?", id);
      this.sql.exec("DELETE FROM assignments WHERE symptom_id = ?", id);
      this.sql.exec("DELETE FROM symptoms WHERE id = ?", id);
    }

    for (const category of config.categories) {
      for (const premade of category.premade_symptoms ?? []) {
        const template = TEMPLATES.get(premade.template_id);
        this.sql.exec(
          `INSERT OR IGNORE INTO symptoms (author_id, premade_id, template_id, risk_level, slots, text, created_at)
           VALUES (NULL, ?, ?, ?, ?, ?, 0)`,
          premade.id, template.id, category.risk_level, JSON.stringify(premade.slots), fillTemplate(template, premade.slots),
        );
      }
    }
  }

  // Single entry point for the Worker. Custom error classes don't survive the trip out of a
  // Durable Object, so the HTTP status is returned as plain data instead.
  run(action, playerId, body) {
    try {
      const result = playerId === undefined ? this[action]() : this[action](playerId, body);
      return result === null ? { status: 404, data: { error: "Not found" } } : { status: 200, data: result };
    } catch (error) {
      if (error instanceof HttpError) return { status: error.status, data: { error: error.message } };
      throw error;
    }
  }

  one(query, ...params) {
    return this.sql.exec(query, ...params).toArray()[0] ?? null;
  }

  requirePlayer(id) {
    const player = this.getPlayer(id);
    if (!player) throw new HttpError(403, "Join the game first");
    return player;
  }

  getPlayer(id) {
    return this.one("SELECT nickname, avatar FROM players WHERE id = ?", id);
  }

  savePlayer(id, { nickname, avatar }) {
    const key = nickname.toLowerCase();
    if (this.one("SELECT 1 FROM players WHERE nickname_key = ? AND id != ?", key, id)) {
      throw new HttpError(409, `Dr. ${nickname} is already in the game. Pick another name!`);
    }

    this.sql.exec(
      `INSERT INTO players (id, nickname, nickname_key, avatar) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET nickname = excluded.nickname, nickname_key = excluded.nickname_key, avatar = excluded.avatar`,
      id, nickname, key, avatar,
    );
    return { nickname, avatar };
  }

  randomTemplate() {
    const templates = [...TEMPLATES.values()].filter((t) => t.riskLevel === CURRENT_RISK_LEVEL);
    const { id, text, slots } = templates[Math.floor(Math.random() * templates.length)];
    return { id, text, slots };
  }

  addSymptom(playerId, { templateId, slots }) {
    this.requirePlayer(playerId);
    const template = TEMPLATES.get(templateId);
    if (!template || template.riskLevel !== CURRENT_RISK_LEVEL) throw new HttpError(400, "Unknown symptom");

    const filled = {};
    for (const [key, slot] of Object.entries(template.slots)) {
      if (!slot.options?.includes(slots?.[key])) throw new HttpError(400, "Pick an option for every blank");
      filled[key] = slots[key];
    }

    this.sql.exec(
      `INSERT INTO symptoms (author_id, template_id, risk_level, slots, text, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      playerId, template.id, template.riskLevel, JSON.stringify(filled), fillTemplate(template, filled), Date.now(),
    );
    return { ok: true };
  }

  // Reserves a symptom for this player to treat. Asking again returns the same one until it expires,
  // so reloading the page doesn't hand out a new symptom.
  getTreatmentTask(playerId) {
    this.requirePlayer(playerId);
    const now = Date.now();
    this.sql.exec("DELETE FROM assignments WHERE expires_at < ?", now);

    const current = this.one(
      `SELECT s.id, s.text FROM assignments a JOIN symptoms s ON s.id = a.symptom_id WHERE a.player_id = ?`,
      playerId,
    );
    if (current) return current;

    // Prefer real players' symptoms over premade ones, then ones already halfway done.
    const symptom = this.one(
      `SELECT s.id, s.text,
              (SELECT COUNT(*) FROM treatments t WHERE t.symptom_id = s.id) AS treated,
              (SELECT COUNT(*) FROM assignments a WHERE a.symptom_id = s.id) AS reserved
       FROM symptoms s
       WHERE s.risk_level = ?
         AND (s.author_id IS NULL OR s.author_id != ?)
         AND NOT EXISTS (SELECT 1 FROM treatments t WHERE t.symptom_id = s.id AND t.author_id = ?)
         AND treated + reserved < ?
       ORDER BY s.author_id IS NULL, treated DESC, RANDOM()
       LIMIT 1`,
      CURRENT_RISK_LEVEL, playerId, playerId, TREATMENTS_PER_SYMPTOM,
    );
    if (!symptom) return null;

    this.sql.exec(
      "INSERT INTO assignments (player_id, symptom_id, expires_at) VALUES (?, ?, ?)",
      playerId, symptom.id, now + ASSIGNMENT_MS,
    );
    return { id: symptom.id, text: symptom.text };
  }

  addTreatment(playerId, { symptomId, text }) {
    this.requirePlayer(playerId);
    const treatment = String(text ?? "").trim().replace(/\s+/g, " ");
    if (!treatment || treatment.length > MAX_TREATMENT_LENGTH) {
      throw new HttpError(400, `Treatment must be 1–${MAX_TREATMENT_LENGTH} characters`);
    }

    const symptom = this.one("SELECT id, author_id FROM symptoms WHERE id = ?", symptomId);
    if (!symptom || symptom.author_id === playerId) throw new HttpError(400, "Unknown symptom");

    const { treated } = this.one("SELECT COUNT(*) AS treated FROM treatments WHERE symptom_id = ?", symptom.id);
    if (treated >= TREATMENTS_PER_SYMPTOM) throw new HttpError(409, "Other doctors already treated this patient");

    this.sql.exec(
      "INSERT OR IGNORE INTO treatments (symptom_id, author_id, text, created_at) VALUES (?, ?, ?, ?)",
      symptom.id, playerId, treatment, Date.now(),
    );
    this.sql.exec("DELETE FROM assignments WHERE player_id = ?", playerId);
    return { ok: true };
  }

  // A random finished symptom this player had no part in and hasn't voted on yet.
  getVoteTask(playerId) {
    this.requirePlayer(playerId);
    const symptom = this.one(
      `SELECT s.id, s.text FROM symptoms s
       WHERE (s.author_id IS NULL OR s.author_id != ?)
         AND (SELECT COUNT(*) FROM treatments t WHERE t.symptom_id = s.id) >= ?
         AND NOT EXISTS (SELECT 1 FROM treatments t WHERE t.symptom_id = s.id AND t.author_id = ?)
         AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.symptom_id = s.id AND v.player_id = ?)
       ORDER BY RANDOM()
       LIMIT 1`,
      playerId, TREATMENTS_PER_SYMPTOM, playerId, playerId,
    );
    if (!symptom) return null;

    const treatments = this.sql.exec(
      "SELECT id, text FROM treatments WHERE symptom_id = ? ORDER BY id LIMIT ?",
      symptom.id, TREATMENTS_PER_SYMPTOM,
    ).toArray();
    return { ...symptom, treatments };
  }

  // points maps treatment id → 0, 1 or 2 thumbs up. All zeros means the player skipped.
  addVotes(playerId, { symptomId, points }) {
    this.requirePlayer(playerId);
    if (this.one("SELECT 1 FROM votes WHERE player_id = ? AND symptom_id = ?", playerId, symptomId)) throw new HttpError(409, "You already voted on this one");

    const treatments = this.sql.exec(
      "SELECT id, author_id FROM treatments WHERE symptom_id = ? ORDER BY id LIMIT ?", symptomId, TREATMENTS_PER_SYMPTOM,
    ).toArray();
    if (treatments.length < TREATMENTS_PER_SYMPTOM || treatments.some((t) => t.author_id === playerId)) {
      throw new HttpError(400, "Unknown symptom");
    }

    for (const { id } of treatments) {
      const value = Number(points?.[id] ?? 0);
      if (!Number.isInteger(value) || value < 0 || value > MAX_POINTS_PER_TREATMENT) {
        throw new HttpError(400, "Invalid vote");
      }
      this.sql.exec(
        "INSERT INTO votes (player_id, symptom_id, treatment_id, points) VALUES (?, ?, ?, ?)",
        playerId, symptomId, id, value,
      );
    }
    return { ok: true };
  }

  // Finished symptoms for the big screen, newest first, each with its best treatment.
  // Ties go to the treatment that was submitted first.
  // Starts a fresh game: wipes symptoms, treatments and votes but keeps players and their names.
  resetGame() {
    this.sql.exec(`
      DELETE FROM votes;
      DELETE FROM assignments;
      DELETE FROM treatments;
      DELETE FROM symptoms;
    `);
    this.seedPremadeSymptoms();
    return { ok: true };
  }

  getShowcase() {
    const rows = this.sql.exec(
      `SELECT s.id AS symptom_id, s.text AS symptom, t.id AS treatment_id, t.text AS treatment,
              t.created_at, p.nickname, p.avatar,
              COALESCE((SELECT SUM(points) FROM votes v WHERE v.treatment_id = t.id), 0) AS score
       FROM symptoms s
       JOIN treatments t ON t.symptom_id = s.id
       JOIN players p ON p.id = t.author_id
       WHERE (SELECT COUNT(*) FROM treatments t2 WHERE t2.symptom_id = s.id) >= ?
       ORDER BY s.id, t.id`,
      TREATMENTS_PER_SYMPTOM,
    ).toArray();

    const best = new Map();
    for (const row of rows) {
      const current = best.get(row.symptom_id);
      if (!current) {
        best.set(row.symptom_id, { ...row, completedAt: row.created_at });
      } else {
        current.completedAt = Math.max(current.completedAt, row.created_at);
        if (row.score > current.score) Object.assign(current, { ...row, completedAt: current.completedAt });
      }
    }

    return [...best.values()]
      .sort((a, b) => b.completedAt - a.completedAt)
      .map(({ symptom, treatment, score, nickname, avatar }) => ({
        symptom,
        treatment,
        score,
        doctor: { nickname, avatar },
      }));
  }
}

const routes = [
  ["GET", /^\/api\/showcase$/, "getShowcase"],
  ["POST", /^\/api\/admin\/login$/, "adminLogin"],
  ["POST", /^\/api\/reset$/, "resetGame"],
  ["GET", /^\/api\/players\/([^/]+)$/, "getPlayer"],
  ["PUT", /^\/api\/players\/([^/]+)$/, "savePlayer"],
  ["GET", /^\/api\/players\/([^/]+)\/symptom-template$/, "randomTemplate"],
  ["POST", /^\/api\/players\/([^/]+)\/symptoms$/, "addSymptom"],
  ["GET", /^\/api\/players\/([^/]+)\/treatment-task$/, "getTreatmentTask"],
  ["POST", /^\/api\/players\/([^/]+)\/treatments$/, "addTreatment"],
  ["GET", /^\/api\/players\/([^/]+)\/vote-task$/, "getVoteTask"],
  ["POST", /^\/api\/players\/([^/]+)\/votes$/, "addVotes"],
];

// Routes that need the admin password (the ADMIN_PASSWORD secret) in the X-Admin-Password header.
const ADMIN_ACTIONS = new Set(["adminLogin", "resetGame"]);

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
  // Every name is shown as "Dr. <nickname>", so drop a "Dr." the player typed themselves.
  const nickname = String(body?.nickname ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^dr(\.\s*|\s+)/i, "");
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
