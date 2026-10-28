import { DurableObject } from "cloudflare:workers";

const AVATARS = ["blue", "brown", "green", "lime", "orange", "pink", "purple", "red", "yellow"];
const MAX_NICKNAME_LENGTH = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      )
    `);
  }

  getPlayer(id) {
    const [player] = this.sql.exec("SELECT nickname, avatar FROM players WHERE id = ?", id).toArray();
    return player ?? null;
  }

  // Returns null if another player already has this nickname.
  savePlayer(id, { nickname, avatar }) {
    const key = nickname.toLowerCase();
    const taken = this.sql.exec("SELECT 1 FROM players WHERE nickname_key = ? AND id != ?", key, id).toArray();
    if (taken.length) return null;

    this.sql.exec(
      `INSERT INTO players (id, nickname, nickname_key, avatar) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET nickname = excluded.nickname, nickname_key = excluded.nickname_key, avatar = excluded.avatar`,
      id, nickname, key, avatar,
    );
    return { nickname, avatar };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/players\/([^/]+)$/);
    if (!match || !UUID.test(match[1])) {
      return json({ error: "Not found" }, 404);
    }

    const id = match[1].toLowerCase();
    const game = env.GAME.get(env.GAME.idFromName("game"));

    if (request.method === "GET") {
      const player = await game.getPlayer(id);
      return player ? json(player) : json({ error: "Player not found" }, 404);
    }

    if (request.method === "PUT") {
      const body = await request.json().catch(() => null);
      // Every name is shown as "Dr. <nickname>", so drop a "Dr." the player typed themselves.
      const nickname = String(body?.nickname ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .replace(/^dr(\.\s*|\s+)/i, "");
      const avatar = body?.avatar;

      if (nickname.length < 1 || nickname.length > MAX_NICKNAME_LENGTH) {
        return json({ error: `Nickname must be 1–${MAX_NICKNAME_LENGTH} characters` }, 400);
      }
      if (!AVATARS.includes(avatar)) {
        return json({ error: "Unknown avatar" }, 400);
      }

      const player = await game.savePlayer(id, { nickname, avatar });
      return player
        ? json(player)
        : json({ error: `Dr. ${nickname} is already in the game. Pick another name!` }, 409);
    }

    return json({ error: "Method not allowed" }, 405, { Allow: "GET, PUT" });
  },
};

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}
