/**
 * The hill's register: SQLite through node's own binding, one file, no daemon. Who has a name,
 * who is logged in, each name's last save, what that save scores on every board — and, since
 * Phase 12, the halls; since Phase 13, what was said; since Phase 14, the wheel; since the
 * looks, the small painted picture a name or a hall shows. The schema is versioned with
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
  /**
   * Phase 14: the wheel. Per name, what the wheel owes and the lifetime ledger (`wheel_purses`;
   * since Screen H, `coins` holds only winnings and take-backs until the next save flushes them),
   * the buy-ins old saves carried in (`wheel_buyins`, one per cart id), the payouts waiting for a
   * save to take them (`wheel_payouts`, numbered per name), each round the table has turned
   * (`wheel_rounds`, pocket null until it has) and every bet on it.
   */
  `
  CREATE TABLE wheel_purses (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    coins INTEGER NOT NULL,
    staked INTEGER NOT NULL DEFAULT 0,
    returned INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE wheel_buyins (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    buyin_id INTEGER NOT NULL,
    coins INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, buyin_id)
  );
  CREATE TABLE wheel_payouts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    coins INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, seq)
  );
  CREATE TABLE wheel_rounds (
    id INTEGER PRIMARY KEY,
    pocket INTEGER,
    settled_at INTEGER
  );
  CREATE TABLE wheel_bets (
    round_id INTEGER NOT NULL REFERENCES wheel_rounds(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spot TEXT NOT NULL,
    stake INTEGER NOT NULL,
    won INTEGER,
    PRIMARY KEY (round_id, user_id, spot)
  );
  CREATE INDEX wheel_bets_user ON wheel_bets(user_id, round_id);
  `,
  /**
   * Looks: the picture a name paints for itself, and the mark over a hall's door, as the JSON
   * of src/look/look.ts's Look; null for the first letter.
   */
  `
  ALTER TABLE users ADD COLUMN look TEXT;
  ALTER TABLE halls ADD COLUMN look TEXT;
  `,
  /**
   * Phase 19: the ring. `bouts` is every fight the register has held, keeping both sides'
   * resolved numbers and the seed it drew, so a bout replays for ever exactly as it was paid
   * out — and so an impossible fighter stays findable long after the save that fielded it
   * changed. `bout_settlements` is what each name has coming or owing, numbered per name like
   * `wheel_payouts`, with `settled` the register's own record that it has collected — never
   * the client's word for it. `bout_ledger` holds the two things the register must not take a
   * save's word on: how far it has settled a name, and what that name still owes.
   * `bout_escrow` pins a slot while a bout is open on it, so two callers cannot win one helm.
   */
  `
  CREATE TABLE bouts (
    id INTEGER PRIMARY KEY,
    caller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    called_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    caller TEXT NOT NULL,
    called TEXT NOT NULL,
    caller_fighter TEXT NOT NULL,
    called_fighter TEXT NOT NULL,
    seed INTEGER NOT NULL,
    slot TEXT NOT NULL,
    prize TEXT NOT NULL,
    stake TEXT NOT NULL,
    winner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    on_points INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX bouts_caller ON bouts(caller_id, created_at DESC);
  CREATE INDEX bouts_called ON bouts(called_id, created_at DESC);
  CREATE TABLE bout_settlements (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    bout_id INTEGER NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
    won INTEGER NOT NULL,
    opponent TEXT NOT NULL,
    item TEXT NOT NULL,
    slot TEXT NOT NULL,
    settled INTEGER NOT NULL DEFAULT 0,
    collected_item INTEGER NOT NULL DEFAULT 0,
    collected_coins INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, seq)
  );
  CREATE TABLE bout_ledger (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settled_through INTEGER NOT NULL DEFAULT 0,
    owed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE bout_escrow (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot TEXT NOT NULL,
    bout_id INTEGER NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, slot)
  );
  `,
  /**
   * The ceiling (sim/ceiling.ts): where a name's clock starts. A save's tick count is weighed
   * against the age of the name carrying it, but the first save an account ever makes cannot
   * be weighed against anything — a browser adopting a save it played before there were names
   * (runtime/adopt.ts) honestly arrives with forty hours on it. So the first one is taken on
   * trust and remembered here, and everything after is measured from it. Every save already
   * stored is grandfathered at exactly the tick it stands at, which is the same promise.
   */
  `
  ALTER TABLE saves ADD COLUMN tick_base INTEGER NOT NULL DEFAULT 0;
  UPDATE saves SET tick_base = COALESCE(json_extract(record, '$.sim.tick'), 0);
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
