/**
 * Put one name just below another on every skill board.
 *
 *   node set-below.mjs "PPMan" "Dylan Harriett"           # look, change nothing
 *   node set-below.mjs "PPMan" "Dylan Harriett" --apply   # write it
 *
 * For each skill the first name's xp is set to one point under the second's, so it ranks
 * directly beneath it everywhere and nowhere above. Coins, bank, gear, hall, ring and wheel
 * are left exactly as they are. The save's counter and writer are bumped so any tab still
 * holding the old record is bounced onto this one the next time it saves.
 *
 * Nothing is written without --apply, and --apply copies the database first.
 */
import { DatabaseSync } from 'node:sqlite';

const DB = process.env.ANAMNESIA_DB ?? '/var/lib/anamnesia/anamnesia.sqlite';
const [, , belowName, aboveName, ...flags] = process.argv;
const apply = flags.includes('--apply');
if (!belowName || !aboveName) {
  console.error('usage: node set-below.mjs "<name to lower>" "<name to sit under>" [--apply]');
  process.exit(2);
}

const nameKey = (n) => n.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** The game's curve, inlined so this script needs nothing but node. */
function curve(maxLevel = 99) {
  const table = [0, 0];
  let points = 0;
  for (let level = 1; level < maxLevel; level++) {
    points += Math.floor(level + 300 * Math.pow(2, level / 7));
    table.push(Math.floor(points / 4));
  }
  return {
    levelForXp(xp) {
      if (!(xp >= 0)) return 1;
      let lo = 1,
        hi = maxLevel;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((table[mid] ?? Infinity) <= xp) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
  };
}
const xp = curve();

const db = new DatabaseSync(DB, { readOnly: !apply });
db.exec('PRAGMA busy_timeout = 10000');

if (apply) {
  // VACUUM INTO, not a file copy: the register runs in WAL mode, so a copy of the .sqlite
  // alone can be missing everything still in the -wal. This is safe while the game is up.
  const backup = `${DB}.before-set-below-${String(Date.now())}`;
  db.prepare('VACUUM INTO ?').run(backup);
  console.log(`register copied to ${backup}`);
}

function find(name) {
  const u = db
    .prepare('SELECT id, name, created_at FROM users WHERE name_key = ?')
    .get(nameKey(name));
  if (!u) return null;
  const s = db
    .prepare(
      'SELECT counter, writer_id, record, CAST(updated_at AS REAL) AS updated_at' +
        ' FROM saves WHERE user_id = ?',
    )
    .get(u.id);
  return { user: u, save: s ? { ...s, record: JSON.parse(s.record) } : null };
}

if (apply) db.exec('BEGIN IMMEDIATE');
const below = find(belowName);
const above = find(aboveName);
for (const [label, who, asked] of [
  ['below', below, belowName],
  ['above', above, aboveName],
]) {
  if (!who) {
    console.error(`no name on the hill reads "${asked}".`);
    const like = db
      .prepare('SELECT name FROM users WHERE name_key LIKE ? ORDER BY id')
      .all(`%${nameKey(asked).slice(0, 4)}%`);
    if (like.length) console.error('  closest: ' + like.map((r) => r.name).join(', '));
    if (apply) db.exec('ROLLBACK');
    process.exit(1);
  }
  if (!who.save) {
    console.error(
      `"${who.user.name}" has never saved, so there is nothing to ${label === 'below' ? 'lower' : 'measure against'}.`,
    );
    if (apply) db.exec('ROLLBACK');
    process.exit(1);
  }
}

const show = (who) => {
  const sim = who.save.record.sim;
  const rows = Object.entries(sim.skills ?? {})
    .map(([k, v]) => `${k} ${String(xp.levelForXp(v.xp))} (${String(Math.round(v.xp))})`)
    .sort();
  const ageH = (Date.now() - who.user.created_at) / 3_600_000;
  const playedH = (sim.tick * 100) / 3_600_000;
  console.log(`\n${who.user.name}  #${String(who.user.id)}  save ${String(who.save.counter)}`);
  console.log(`  name made ${ageH.toFixed(1)} h ago, save claims ${playedH.toFixed(1)} h played`);
  console.log(`  coins ${String(sim.coins)}, bank ${String((sim.bank ?? []).length)} kinds`);
  if (!(who.save.updated_at > 0 && who.save.updated_at <= Date.UTC(2200, 0, 1))) {
    console.log(
      `  last-written stamp is ${String(who.save.updated_at)}, which no clock made — writing fixes it`,
    );
  }
  console.log(`  ${rows.join('  ') || '(no xp)'}`);
};
show(below);
show(above);

const aboveSkills = above.save.record.sim.skills ?? {};
const nextSkills = {};
for (const [skill, v] of Object.entries(aboveSkills)) {
  nextSkills[skill] = { xp: Math.max(0, Math.round(v.xp) - 1) };
}

const sim = below.save.record.sim;
// A save may not claim more of the hill's time than its name has existed (sim/ceiling.ts); if
// the tick count is already past that, leave it where the register will accept it.
const ageMs = Date.now() - below.user.created_at;
const cappedTick = Math.min(sim.tick, Math.floor((ageMs + 4 * 3_600_000) / 100));

console.log(`\n${below.user.name} would become:`);
console.log(
  '  ' +
    Object.entries(nextSkills)
      .map(([k, v]) => `${k} ${String(xp.levelForXp(v.xp))} (${String(v.xp)})`)
      .sort()
      .join('  '),
);
if (cappedTick !== sim.tick) {
  console.log(
    `  tick ${String(sim.tick)} → ${String(cappedTick)} (a save cannot outrun its name's age)`,
  );
}

if (!apply) {
  console.log('\nnothing written. add --apply to write it.');
  process.exit(0);
}

const next = {
  ...below.save.record,
  saveCounter: below.save.counter + 1,
  writerId: 'register',
  sim: { ...sim, tick: cappedTick, skills: nextSkills },
};

try {
  db.prepare(
    'UPDATE saves SET counter = ?, writer_id = ?, record = ?, updated_at = ? WHERE user_id = ?',
  ).run(next.saveCounter, 'register', JSON.stringify(next), Date.now(), below.user.id);

  // Rescore only what changed: each skill's own board, and the total. Wealth and the ring read
  // nothing this touches, so their rows stay as the register last wrote them.
  const upsert = db.prepare(
    `INSERT INTO standings (user_id, board, level, score, key1, key2) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, board) DO UPDATE SET level = excluded.level, score = excluded.score,
       key1 = excluded.key1, key2 = excluded.key2`,
  );
  const boards = db
    .prepare("SELECT DISTINCT board FROM standings WHERE board NOT IN ('total','wealth','ring')")
    .all()
    .map((r) => r.board);
  let totalLevel = 0;
  let totalXp = 0;
  for (const board of boards) {
    const v = Math.round(nextSkills[board]?.xp ?? 0);
    const level = xp.levelForXp(v);
    totalLevel += level;
    totalXp += v;
    upsert.run(below.user.id, board, level, v, v, 0);
  }
  upsert.run(below.user.id, 'total', totalLevel, totalXp, totalLevel, totalXp);
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
console.log(
  `\nwritten. ${below.user.name} now sits under ${above.user.name} on every skill board.`,
);
console.log('their open tab will be bounced onto this record the next time it saves.');
