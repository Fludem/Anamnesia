/**
 * The hill's register: SQLite through node's own binding, one file, no daemon. Four tables —
 * who has a name, who is logged in, each name's last save, and what that save scores on
 * every board. The schema is versioned with `user_version`; bumps append to MIGRATIONS.
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
