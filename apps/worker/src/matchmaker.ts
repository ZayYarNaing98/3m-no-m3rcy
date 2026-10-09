import { DurableObject } from 'cloudflare:workers';
import { MAX_PLAYERS, type OpenRoom } from '@nomercy/engine';

/** Listings a room hasn't refreshed in this long are treated as gone. */
const STALE_MS = 2 * 60 * 60_000;

/**
 * One global instance that keeps the public rooms still waiting in their lobby, for Quick play and
 * the open rooms list. Rooms keep their own listing up to date (see Room.syncListing).
 */
export class Matchmaker extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS rooms (
          code TEXT PRIMARY KEY, host TEXT NOT NULL, players INTEGER NOT NULL, bots INTEGER NOT NULL,
          quick INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`,
      );
    });
  }

  /** Adds or refreshes a room's listing. */
  async upsert(room: Omit<OpenRoom, 'createdAt'> & { quick: boolean }): Promise<void> {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO rooms (code, host, players, bots, quick, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET host = excluded.host, players = excluded.players, bots = excluded.bots,
         quick = excluded.quick, updated_at = excluded.updated_at`,
      room.code,
      room.host,
      room.players,
      room.bots,
      room.quick ? 1 : 0,
      now,
      now,
    );
  }

  async remove(code: string): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM rooms WHERE code = ?', code);
  }

  /** Public rooms with someone in them and a free seat, fullest first. */
  async list(): Promise<OpenRoom[]> {
    return this.rows().filter((r) => r.players > 0);
  }

  /**
   * The best open room for a Quick play player, or a new public room when there is none.
   * Runs one at a time, so two players tapping at once end up in the same new room.
   */
  async quickPlay(): Promise<string | null> {
    let code: string | null = null;
    await this.ctx.blockConcurrencyWhile(async () => {
      const best = this.rows()[0];
      if (best) {
        code = best.code;
        return;
      }
      for (let attempt = 0; attempt < 5 && !code; attempt++) {
        const candidate = newRoomCode();
        if (await this.env.ROOMS.getByName(candidate).create(candidate, { public: true, quick: true })) {
          // Listed straight away (empty), so the next Quick play player joins it instead of making another.
          await this.upsert({ code: candidate, host: '', players: 0, bots: 0, quick: true });
          code = candidate;
        }
      }
    });
    return code;
  }

  private rows(): OpenRoom[] {
    const cutoff = Date.now() - STALE_MS;
    this.ctx.storage.sql.exec('DELETE FROM rooms WHERE updated_at < ?', cutoff);
    return this.ctx.storage.sql
      .exec<{ code: string; host: string; players: number; bots: number; created_at: number }>(
        'SELECT code, host, players, bots, created_at FROM rooms WHERE players < ? ORDER BY players DESC, created_at ASC LIMIT 20',
        MAX_PLAYERS,
      )
      .toArray()
      .map((r) => ({ code: r.code, host: r.host, players: r.players, bots: r.bots, createdAt: r.created_at }));
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
