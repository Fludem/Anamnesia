/**
 * Everything the server knows, behind one object: names, sessions, each name's last save, and
 * the boards. SQL lives here and nowhere else. The save write is the compare-and-swap the
 * game's SaveStore contract promises (src/runtime/store.ts), with one allowance: a writer
 * whose previous write landed but whose reply was lost may write again against the counter it
 * last knew, since the record it holds is newer than the one it wrote.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  nameKey,
  SESSION_TTL_MS,
  type Board,
  type BoardRow,
  type SavePut,
  type SavePutResult,
  type StandingRow,
  type User,
} from '../src/api/protocol.ts';
import { isBlank, parseLook, type Look } from '../src/look/look.ts';
import type { SimContext } from '../src/sim/context.ts';
import { boardIds, standingsOf, type BoardId } from '../src/sim/highscores.ts';
import type { SaveRecord } from '../src/sim/save.ts';
import { hashToken } from './auth.ts';
import { transaction } from './db.ts';
import type { Halls } from './hall.ts';
import type { Wheel } from './wheel.ts';

export { nameKey };

/** How many rows a board answers with, besides the caller's own. */
export const BOARD_TOP = 100;
/** A session used within this long of expiry is not extended — saves a write per request. */
const SLIDE_SLACK_MS = 24 * 3_600_000;

interface UserRow {
  id: number;
  name: string;
  created_at: number;
}

interface StandingKeys {
  level: number | null;
  score: number;
  key1: number;
  key2: number;
}

const asUser = (r: UserRow): User => ({ id: r.id, name: r.name, createdAt: r.created_at });

export class Register {
  constructor(
    private readonly db: DatabaseSync,
    private readonly ctx: SimContext,
    private readonly halls: Halls,
    private readonly wheel: Wheel,
  ) {}

  // ---- names ------------------------------------------------------------------------------

  /** The stored password hash alongside the user, for the login door. */
  findByName(name: string): (User & { password: string }) | null {
    const row = this.db
      .prepare('SELECT id, name, created_at, password FROM users WHERE name_key = ?')
      .get(nameKey(name)) as (UserRow & { password: string }) | undefined;
    return row ? { ...asUser(row), password: row.password } : null;
  }

  /** Null when the name is taken. */
  createUser(name: string, passwordHash: string, nowMs: number): User | null {
    const key = nameKey(name);
    const taken = this.db.prepare('SELECT 1 FROM users WHERE name_key = ?').get(key);
    if (taken) return null;
    const r = this.db
      .prepare(
        'INSERT INTO users (name, name_key, password, created_at) VALUES (?, ?, ?, ?) RETURNING id',
      )
      .get(name, key, passwordHash, nowMs) as { id: number };
    return { id: r.id, name, createdAt: nowMs };
  }

  // ---- looks ------------------------------------------------------------------------------

  /** The look a name shows the hill; null takes it down. */
  setLook(userId: number, look: Look | null): void {
    this.db
      .prepare('UPDATE users SET look = ? WHERE id = ?')
      .run(look === null || isBlank(look) ? null : JSON.stringify(look), userId);
  }

  /** The looks of some names, keyed by the name as asked; a name without one, or unknown, is null. */
  looksOf(names: readonly string[]): Record<string, Look | null> {
    const out: Record<string, Look | null> = {};
    const find = this.db.prepare('SELECT look FROM users WHERE name_key = ?');
    for (const name of names) {
      const row = find.get(nameKey(name)) as { look: string | null } | undefined;
      out[name] = row ? parseLook(row.look) : null;
    }
    return out;
  }

  // ---- sessions ---------------------------------------------------------------------------

  /** Opens a session and returns the token the browser keeps. */
  createSession(userId: number, token: string, nowMs: number): void {
    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(hashToken(token), userId, nowMs, nowMs + SESSION_TTL_MS);
  }

  /** Who holds this token, or null; a live session slides its expiry forward. */
  userForSession(token: string, nowMs: number): User | null {
    const hash = hashToken(token);
    const row = this.db
      .prepare(
        `SELECT u.id, u.name, u.created_at, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      )
      .get(hash) as (UserRow & { expires_at: number }) | undefined;
    if (!row) return null;
    if (row.expires_at <= nowMs) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      return null;
    }
    if (row.expires_at - nowMs < SESSION_TTL_MS - SLIDE_SLACK_MS) {
      this.db
        .prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
        .run(nowMs + SESSION_TTL_MS, hash);
    }
    return asUser(row);
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  // ---- saves ------------------------------------------------------------------------------

  loadSave(userId: number): SaveRecord | null {
    const row = this.db.prepare('SELECT record FROM saves WHERE user_id = ?').get(userId) as
      { record: string } | undefined;
    return row ? (JSON.parse(row.record) as SaveRecord) : null;
  }

  /**
   * The compare-and-swap write; also rescores the name on every board, settles the gifts on
   * its cart with the hall and its coins with the wheel. The save is stored carrying the
   * account's name, whatever the hero was called where it came from, the hall as the register
   * knows it, and the wheel's payouts already added — coins and `paidThrough` stamped together,
   * so a tab that reloads onto the stored record is neither owed twice nor short. The gifts and
   * buy-ins stay in the stored record until the name's own next save, so a reply that never
   * arrives loses nothing (see sim/hall.ts, sim/wheel.ts).
   */
  writeSave(user: User, put: SavePut, nowMs: number): SavePutResult {
    const userId = user.id;
    return transaction(this.db, () => {
      const stored = this.db
        .prepare('SELECT counter, writer_id, record FROM saves WHERE user_id = ?')
        .get(userId) as { counter: number; writer_id: string; record: string } | undefined;
      const current = stored?.counter ?? 0;
      const retry =
        stored !== undefined &&
        stored.writer_id === put.record.writerId &&
        current === put.expectedCounter + 1;
      if (current !== put.expectedCounter && !retry) {
        return {
          ok: false,
          reason: 'stale',
          stored: stored ? (JSON.parse(stored.record) as SaveRecord) : null,
        };
      }
      const next = current + 1;
      const sim = put.record.sim;
      const hall = this.halls.applyGifts(userId, sim.hall.gifts, sim.hall.given, nowMs);
      const wheel = this.wheel.applyCart(userId, sim.wheel.cart, sim.wheel.paidThrough, nowMs);
      const paid = wheel.paid.reduce((n, p) => n + p.coins, 0);
      const paidThrough = wheel.paid.reduce((n, p) => Math.max(n, p.seq), sim.wheel.paidThrough);
      const record: SaveRecord = {
        ...put.record,
        saveCounter: next,
        sim: {
          ...sim,
          coins: sim.coins + paid,
          player: { ...sim.player, name: user.name },
          hall: { ...sim.hall, id: hall.id, rooms: hall.rooms, given: hall.given },
          wheel: {
            ...sim.wheel,
            bought: Math.max(sim.wheel.bought, wheel.bought),
            paidThrough,
          },
        },
      };
      this.db
        .prepare(
          `INSERT INTO saves (user_id, counter, writer_id, god, record, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET counter = excluded.counter,
             writer_id = excluded.writer_id, god = excluded.god, record = excluded.record,
             updated_at = excluded.updated_at`,
        )
        .run(userId, next, record.writerId, record.sim.player.god, JSON.stringify(record), nowMs);
      const upsert = this.db.prepare(
        `INSERT INTO standings (user_id, board, level, score, key1, key2) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, board) DO UPDATE SET level = excluded.level, score = excluded.score,
           key1 = excluded.key1, key2 = excluded.key2`,
      );
      for (const s of standingsOf(record.sim, this.ctx)) {
        upsert.run(userId, s.board, s.level, s.score, s.keys[0], s.keys[1]);
      }
      return { ok: true, saveCounter: next, hall, wheel };
    });
  }

  // ---- boards -----------------------------------------------------------------------------

  hasBoard(board: string): boolean {
    return boardIds(this.ctx.content).includes(board);
  }

  /**
   * One board, best first: the top `BOARD_TOP` names plus the caller's own row if it is
   * further down, and the caller's standing on every board. Ties go to whoever made their
   * name first.
   */
  board(board: BoardId, userId: number | null, nowMs: number): Board {
    const rows = this.db
      .prepare(
        `SELECT u.id, u.name, s.god, s.updated_at, st.level, st.score
         FROM standings st
         JOIN users u ON u.id = st.user_id
         JOIN saves s ON s.user_id = st.user_id
         WHERE st.board = ?
         ORDER BY st.key1 DESC, st.key2 DESC, u.id ASC
         LIMIT ?`,
      )
      .all(board, BOARD_TOP) as {
      id: number;
      name: string;
      god: string | null;
      updated_at: number;
      level: number | null;
      score: number;
    }[];
    const out: BoardRow[] = rows.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      god: r.god,
      level: r.level,
      score: r.score,
      seenAgoMs: Math.max(0, nowMs - r.updated_at),
      you: r.id === userId,
    }));
    if (userId !== null && !out.some((r) => r.you)) {
      const mine = this.standing(board, userId);
      if (mine) {
        const me = this.db
          .prepare(
            `SELECT u.name, s.god, s.updated_at FROM users u JOIN saves s ON s.user_id = u.id
             WHERE u.id = ?`,
          )
          .get(userId) as { name: string; god: string | null; updated_at: number };
        out.push({
          rank: mine.rank,
          name: me.name,
          god: me.god,
          level: mine.level,
          score: mine.score,
          seenAgoMs: Math.max(0, nowMs - me.updated_at),
          you: true,
        });
      }
    }
    const players = (
      this.db.prepare('SELECT COUNT(*) AS n FROM standings WHERE board = ?').get(board) as {
        n: number;
      }
    ).n;
    const standings: StandingRow[] = [];
    if (userId !== null) {
      for (const id of boardIds(this.ctx.content)) {
        const s = this.standing(id, userId);
        if (s) standings.push(s);
      }
    }
    return { board, players, rows: out, standings };
  }

  /** The caller's rank on one board, or null before their first save. */
  standing(board: BoardId, userId: number): StandingRow | null {
    const mine = this.db
      .prepare('SELECT level, score, key1, key2 FROM standings WHERE user_id = ? AND board = ?')
      .get(userId, board) as StandingKeys | undefined;
    if (!mine) return null;
    const better = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM standings st JOIN users u ON u.id = st.user_id
           WHERE st.board = ? AND (
             st.key1 > ? OR (st.key1 = ? AND st.key2 > ?)
             OR (st.key1 = ? AND st.key2 = ? AND u.id < ?))`,
        )
        .get(board, mine.key1, mine.key1, mine.key2, mine.key1, mine.key2, userId) as {
        n: number;
      }
    ).n;
    const of = (
      this.db.prepare('SELECT COUNT(*) AS n FROM standings WHERE board = ?').get(board) as {
        n: number;
      }
    ).n;
    return { board, rank: better + 1, of, level: mine.level, score: mine.score };
  }
}
