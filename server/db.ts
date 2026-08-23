/**
 * The hill's register: SQLite through node's own binding, one file, no daemon. Who has a name,
 * who is logged in, each name's last save, what that save scores on every board — and, since
 * Phase 12, the halls; since Phase 13, what was said. The schema is versioned with
 * `user_version`; bumps append to MIGRATIONS.
 */
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE saves (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    counter INTEGER NOT NULL,
    writer_id TEXT NOT NULL,
    god TEXT,
    record TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE standings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board TEXT NOT NULL,
    level INTEGER,
    score REAL NOT NULL,
    key1 REAL NOT NULL,
    key2 REAL NOT NULL,
    PRIMARY KEY (user_id, board)
  );
  CREATE INDEX standings_board ON standings(board, key1 DESC, key2 DESC);
  `,
  /** Phase 12: halls — who founded what, who is in it, who is asking, what stands, what was given. */
  `
  CREATE TABLE halls (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    founder_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE members (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL
  );
  CREATE INDEX members_hall ON members(hall_id);
  CREATE TABLE petitions (
    id INTEGER PRIMARY KEY,
    hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('invite', 'request')),
    by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    UNIQUE (hall_id, user_id)
  );
  CREATE INDEX petitions_user ON petitions(user_id);
  CREATE TABLE hall_rooms (
    hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
    room TEXT NOT NULL,
    tier INTEGER NOT NULL,
    PRIMARY KEY (hall_id, room)
  );
  CREATE TABLE hall_progress (
    hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
    room TEXT NOT NULL,
    what TEXT NOT NULL,
    qty INTEGER NOT NULL,
    PRIMARY KEY (hall_id, room, what)
  );
  CREATE TABLE gifts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gift_id INTEGER NOT NULL,
    hall_id INTEGER REFERENCES halls(id) ON DELETE SET NULL,
    room TEXT NOT NULL,
    what TEXT NOT NULL,
    qty INTEGER NOT NULL,
    taken INTEGER NOT NULL,
    value INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, gift_id)
  );
  CREATE INDEX gifts_hall ON gifts(hall_id, created_at DESC);
  `,
  /**
   * Phase 13: words. A message said in a room (`room` set, `to_id` null) is heard by every
   * name there — the fire is the room everyone is in; one with a `to_id` is a word between
   * two names. Ids only ever climb: a tab asks for what is newer than the last it heard.
   * `chat_reads` is how far each name has read in each talk (`room:fire`, `user:12`);
   * `blocks` is who has turned away from whom.
   */
  `
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    room TEXT,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    CHECK ((to_id IS NULL) != (room IS NULL))
  );
  CREATE INDEX messages_room ON messages(room, id);
  CREATE INDEX messages_to ON messages(to_id, id);
  CREATE INDEX messages_from ON messages(from_id, id);
  CREATE TABLE chat_reads (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    talk TEXT NOT NULL,
    last_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, talk)
  );
  CREATE TABLE blocks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, blocked_id)
  );
  `,
];

/** Open (creating if needed) and bring up to date. `':memory:'` for tests. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    db.exec(MIGRATIONS[v]!);
    db.exec(`PRAGMA user_version = ${String(v + 1)}`);
    db.exec('COMMIT');
  }
  return db;
}

/** Run `fn` in one transaction; a throw rolls back and rethrows. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
