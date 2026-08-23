/**
 * The fire: what the names say to each other, kept here because it is shared and because a
 * word is nothing the sim needs to know. A word said in a room is heard by every name in it —
 * the fire is the room everyone is in, the wheel is table talk — and a word said to a name is
 * between the two of them. Delivery is a long poll: a tab asks for anything newer than the
 * last word it heard and the register holds the question open until there is one or the wait
 * runs out. That is plain HTTP and asks nothing of the proxies in front of the box. Who is
 * asking right now is the nearest thing to presence. SQL for words lives here and nowhere
 * else.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  ROOMS,
  type ChatMessage,
  type ChatName,
  type ChatOverview,
  type ChatPoll,
  type ChatRoom,
  type ChatThread,
  type Room,
  type Talk,
  type User,
} from '../src/api/protocol.ts';
import { RateLimiter } from './auth.ts';
import { nameKey } from './register.ts';

/** How long a poll is held open for a word before it is answered empty. */
export const POLL_WAIT_MS = 25_000;
/** Words answered at once to a poll, and a room's or a talk's recent past. */
export const POLL_ROWS = 100;
export const ROOM_ROWS = 100;
export const THREAD_ROWS = 100;
/** How many names a name's list of talks shows. */
export const NAME_ROWS = 50;
/** Words per name in a minute. */
export const SAY_LIMIT = { max: 20, windowMs: 60_000 };
/** Words in a room older than this are gone with the smoke. */
export const ROOM_KEEP_MS = 30 * 24 * 3_600_000;

/** A refusal with the status the route should answer. */
export class ChatError extends Error {
  override readonly name = 'ChatError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface MessageRow {
  id: number;
  from_id: number;
  to_id: number | null;
  room: string | null;
  body: string;
  created_at: number;
}

interface Waiter {
  userId: number;
  wake: () => void;
}

const COLS = 'id, from_id, to_id, room, body, created_at';
const isRoom = (s: string | null): s is Room => s !== null && (ROOMS as string[]).includes(s);
/** The key of a talk in chat_reads. */
const talkKey = (t: { room: Room } | { userId: number }): string =>
  'room' in t ? `room:${t.room}` : `user:${String(t.userId)}`;

export class Chat {
  private readonly waiters = new Set<Waiter>();
  private readonly said = new RateLimiter(SAY_LIMIT.max, SAY_LIMIT.windowMs);
  private readonly names = new Map<number, string>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly waitMs = POLL_WAIT_MS,
  ) {}

  // ---- lookups ----------------------------------------------------------------------------

  userByName(name: string): User | null {
    const row = this.db
      .prepare('SELECT id, name, created_at FROM users WHERE name_key = ?')
      .get(nameKey(name)) as { id: number; name: string; created_at: number } | undefined;
    if (!row) return null;
    this.names.set(row.id, row.name);
    return { id: row.id, name: row.name, createdAt: row.created_at };
  }

  /** A name other than the caller's, or the refusal. */
  private other(user: User, name: string): User {
    const peer = this.userByName(name);
    if (!peer) throw new ChatError(404, 'No one by that name on the hill.');
    if (peer.id === user.id) throw new ChatError(400, 'You know what you think.');
    return peer;
  }

  private nameOf(id: number): string {
    const known = this.names.get(id);
    if (known !== undefined) return known;
    const row = this.db.prepare('SELECT name FROM users WHERE id = ?').get(id) as
      { name: string } | undefined;
    const name = row?.name ?? 'a name that is gone';
    this.names.set(id, name);
    return name;
  }

  private message(r: MessageRow): ChatMessage {
    return {
      id: r.id,
      from: this.nameOf(r.from_id),
      room: isRoom(r.room) ? r.room : null,
      to: r.to_id === null ? null : this.nameOf(r.to_id),
      body: r.body,
      atMs: r.created_at,
    };
  }

  private blocks(userId: number, otherId: number): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?')
        .get(userId, otherId) !== undefined
    );
  }

  private readUpTo(userId: number, talk: string): number {
    const row = this.db
      .prepare('SELECT last_id FROM chat_reads WHERE user_id = ? AND talk = ?')
      .get(userId, talk) as { last_id: number } | undefined;
    return row?.last_id ?? 0;
  }

  /** The newest word the register holds, whoever it was for. */
  private newest(): number {
    const row = this.db.prepare('SELECT MAX(id) AS id FROM messages').get() as {
      id: number | null;
    };
    return row.id ?? 0;
  }

  /** Distinct names with a poll open, counting the caller. */
  private here(userId: number): number {
    const ids = new Set<number>([userId]);
    for (const w of this.waiters) ids.add(w.userId);
    return ids.size;
  }

  // ---- saying -----------------------------------------------------------------------------

  /** Say something in a room or to a name. */
  say(user: User, talk: Talk, body: string, nowMs: number): ChatMessage {
    if (!this.said.allows(String(user.id), nowMs))
      throw new ChatError(429, 'You have said enough for a minute.');
    let toId: number | null = null;
    let room: Room | null = null;
    if (talk.kind === 'room') room = talk.room;
    else {
      const target = this.other(user, talk.name);
      if (this.blocks(target.id, user.id)) throw new ChatError(403, 'That name has turned away.');
      if (this.blocks(user.id, target.id))
        throw new ChatError(400, 'You turned away from that name. Turn back first.');
      toId = target.id;
    }
    this.said.hit(String(user.id), nowMs);
    this.names.set(user.id, user.name);
    const row = this.db
      .prepare(
        `INSERT INTO messages (from_id, to_id, room, body, created_at) VALUES (?, ?, ?, ?, ?)
         RETURNING ${COLS}`,
      )
      .get(user.id, toId, room, body, nowMs) as MessageRow;
    if (room !== null) {
      this.db
        .prepare('DELETE FROM messages WHERE room IS NOT NULL AND created_at < ?')
        .run(nowMs - ROOM_KEEP_MS);
      for (const w of this.waiters) w.wake();
    } else {
      for (const w of this.waiters) if (w.userId === user.id || w.userId === toId) w.wake();
    }
    return this.message(row);
  }

  // ---- hearing ----------------------------------------------------------------------------

  /** Words newer than `after` the caller can hear: the rooms (less the names turned from) and their own talks. */
  private since(userId: number, after: number, limit: number): MessageRow[] {
    return this.db
      .prepare(
        `SELECT ${COLS} FROM messages
         WHERE id > ? AND (room IS NOT NULL OR to_id = ? OR from_id = ?)
           AND from_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?)
         ORDER BY id LIMIT ?`,
      )
      .all(after, userId, userId, userId, limit) as MessageRow[];
  }

  private inRoom(userId: number, room: Room): MessageRow[] {
    return (
      this.db
        .prepare(
          `SELECT ${COLS} FROM messages
           WHERE room = ? AND from_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?)
           ORDER BY id DESC LIMIT ?`,
        )
        .all(room, userId, ROOM_ROWS) as MessageRow[]
    ).reverse();
  }

  private between(userId: number, peerId: number): MessageRow[] {
    return (
      this.db
        .prepare(
          `SELECT ${COLS} FROM messages
           WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
           ORDER BY id DESC LIMIT ?`,
        )
        .all(userId, peerId, peerId, userId, THREAD_ROWS) as MessageRow[]
    ).reverse();
  }

  private unreadFrom(userId: number, peerId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE from_id = ? AND to_id = ? AND id > ?')
      .get(peerId, userId, this.readUpTo(userId, talkKey({ userId: peerId }))) as { n: number };
    return row.n;
  }

  private unreadIn(userId: number, room: Room): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM messages WHERE room = ? AND id > ? AND from_id != ?
           AND from_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = ?)`,
      )
      .get(room, this.readUpTo(userId, talkKey({ room })), userId, userId) as { n: number };
    return row.n;
  }

  /** The names the caller has exchanged words with, newest talk first. */
  private talks(userId: number): ChatName[] {
    const rows = this.db
      .prepare(
        `SELECT peer, MAX(id) AS last_id FROM (
           SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS peer, id FROM messages
           WHERE to_id = ? OR (from_id = ? AND to_id IS NOT NULL)
         ) GROUP BY peer ORDER BY last_id DESC LIMIT ?`,
      )
      .all(userId, userId, userId, NAME_ROWS) as { peer: number; last_id: number }[];
    const last = this.db.prepare(`SELECT ${COLS} FROM messages WHERE id = ?`);
    return rows.map((r) => ({
      name: this.nameOf(r.peer),
      last: this.message(last.get(r.last_id) as MessageRow),
      unread: this.unreadFrom(userId, r.peer),
      blocked: this.blocks(userId, r.peer),
    }));
  }

  overview(user: User): ChatOverview {
    const rooms: ChatRoom[] = ROOMS.map((room) => ({
      room,
      messages: this.inRoom(user.id, room).map((r) => this.message(r)),
      unread: this.unreadIn(user.id, room),
    }));
    return { latest: this.newest(), here: this.here(user.id), rooms, names: this.talks(user.id) };
  }

  /** The words between the caller and a name, marked read up to the last of them. */
  thread(user: User, name: string): ChatThread {
    const peer = this.other(user, name);
    const rows = this.between(user.id, peer.id);
    const lastId = rows.at(-1)?.id;
    if (lastId !== undefined) this.markRead(user.id, talkKey({ userId: peer.id }), lastId);
    return {
      name: peer.name,
      blocked: this.blocks(user.id, peer.id),
      messages: rows.map((r) => this.message(r)),
    };
  }

  /** How far the caller has read in a talk; never moves back. */
  read(user: User, talk: Talk, id: number): void {
    const key =
      talk.kind === 'room'
        ? talkKey({ room: talk.room })
        : talkKey({ userId: this.other(user, talk.name).id });
    this.markRead(user.id, key, id);
  }

  private markRead(userId: number, talk: string, id: number): void {
    this.db
      .prepare(
        `INSERT INTO chat_reads (user_id, talk, last_id) VALUES (?, ?, ?)
         ON CONFLICT (user_id, talk) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`,
      )
      .run(userId, talk, id);
  }

  /**
   * Words newer than `after`, at once if there are any, else when one arrives or the wait
   * runs out. `latest` is where to poll from next: past everything the caller cannot hear.
   */
  async poll(user: User, after: number, signal?: AbortSignal): Promise<ChatPoll> {
    let rows = this.since(user.id, after, POLL_ROWS);
    if (rows.length === 0 && !signal?.aborted) {
      await this.wait(user.id, signal);
      rows = this.since(user.id, after, POLL_ROWS);
    }
    const latest = rows.length === POLL_ROWS ? rows[rows.length - 1]!.id : this.newest();
    return { latest, here: this.here(user.id), messages: rows.map((r) => this.message(r)) };
  }

  private wait(userId: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const waiter: Waiter = { userId, wake: done };
      const timer = setTimeout(done, this.waitMs);
      timer.unref();
      this.waiters.add(waiter);
      signal?.addEventListener('abort', done);
    });
  }

  // ---- turning away -----------------------------------------------------------------------

  /** Turn away from a name (their words in the rooms go unheard, their words to you unsent), or back. */
  block(user: User, name: string, blocked: boolean, nowMs: number): void {
    const target = this.other(user, name);
    if (blocked)
      this.db
        .prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)')
        .run(user.id, target.id, nowMs);
    else
      this.db
        .prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?')
        .run(user.id, target.id);
  }

  /** Names with a poll open right now. */
  listening(): number {
    return this.here(0) - 1;
  }
}
