/**
 * Retunes monster hp and xp against the progression model. Kill time scales with the
 * monster's level (a goat goes in seconds, the Stone takes most of a minute, in ladder gear
 * at the monster's own level); xp per kill is then set so the combat climb takes about as
 * long as the gathering skills. Stats (attack, strength, defence, speed) are left alone —
 * they are the fight's character. Writes src/content/monsters.json in place.
 *
 *   npx tsx scripts/tune-combat.ts [--target 36] [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { content, simContext } from '../src/content/index.ts';
import { expectedHit } from '../src/sim/combat.ts';
import { TICK_MS } from '../src/sim/constants.ts';
import { ContentDb } from '../src/sim/content/db.ts';
import type { SimContext } from '../src/sim/context.ts';
import { combatClimb, modelHero } from '../src/sim/progression.ts';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const targetArg = args.indexOf('--target');
const TARGET_HOURS = targetArg >= 0 ? Number(args[targetArg + 1]) : 36;

/** Seconds per kill for a monster of `level`, fought at that level. */
const killSeconds = (level: number) => 8 + 0.45 * level;
/** Xp per hitpoint grows as `1 + level / this`. */
const XP_LEVEL_WEIGHT = 15;

const dir = resolve(import.meta.dirname, '../src/content');
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as unknown;
const monstersPath = resolve(dir, 'monsters.json');
const raw = load('monsters.json') as Record<string, unknown>[];

function contextWith(monsters: unknown): SimContext {
  const pack = {
    skills: load('skills.json'),
    materials: load('materials.json'),
    rarities: load('rarities.json'),
    items: load('items.json'),
    tables: load('drop-tables.json'),
    rocks: load('rocks.json'),
    trees: load('trees.json'),
    waters: load('waters.json'),
    recipes: load('recipes.json'),
    zones: load('zones.json'),
    monsters,
    gods: load('gods.json'),
  };
  return { ...simContext, content: ContentDb.fromPack(pack) };
}

// 1. hp from the target kill time with the model's hero at the monster's level.
const hp = new Map<string, number>();
for (const m of content.monsters) {
  const hero = modelHero(m.level, simContext);
  const perSwing = expectedHit(hero.attack, hero.strength, m.stats.defence);
  const swings = (killSeconds(m.level) * 1000) / TICK_MS / hero.swingTicks;
  hp.set(m.id, Math.max(1, Math.round(perSwing * swings)));
}

// 2. xp per kill proportional to hp (xp is paid per point of damage), weighted up by level so
//    the monster of your tier beats a one-swing goat; then scaled until the climb hits the
//    target. The weight is what stops "farm the weakest thing forever" from being optimal.
const xpPerHp = (level: number) => 1 + level / XP_LEVEL_WEIGHT;
const xp = new Map<string, number>();
for (const m of content.monsters) xp.set(m.id, hp.get(m.id)! * xpPerHp(m.level));

function apply(scale: number) {
  return raw.map((r) =>
    typeof r['id'] === 'string' && hp.has(r['id'])
      ? { ...r, hp: hp.get(r['id']), xp: Math.max(1, Math.round(xp.get(r['id'])! * scale)) }
      : r,
  );
}
const hoursWith = (scale: number) => combatClimb(contextWith(apply(scale))).hours;

let lo = 0.05;
let hi = 50;
for (let i = 0; i < 40; i++) {
  const mid = Math.sqrt(lo * hi);
  if (hoursWith(mid) > TARGET_HOURS) lo = mid;
  else hi = mid;
}
const scale = Math.sqrt(lo * hi);
const out = apply(scale);
const ctx = contextWith(out);
const climb = combatClimb(ctx);
console.log(`scale ${scale.toFixed(3)} → ${climb.hours.toFixed(1)} h to 99`);
console.log(
  'milestones',
  Object.entries(climb.milestones)
    .map(([l, h]) => `${l}:${h.toFixed(2)}h`)
    .join(' '),
);
for (const m of ctx.content.monsters) {
  console.log(
    `${m.id.padEnd(18)} L${String(m.level).padStart(2)} hp ${String(m.hp).padStart(4)} xp ${String(m.xp).padStart(5)}`,
  );
}
let last = '';
for (const s of climb.steps) {
  if (s.monster === last) continue;
  last = s.monster;
  console.log(
    `L${String(s.level).padStart(2)} → ${s.monster.padEnd(18)} ${Math.round(s.rate).toString().padStart(7)} xp/h ` +
      `kill ${s.killSeconds.toFixed(1)}s  dmg/h ${Math.round(s.damagePerHour)}  maxhit ${(s.maxHitFraction * 100).toFixed(0)}%`,
  );
}
if (!dry) {
  writeFileSync(monstersPath, JSON.stringify(out, null, 2) + '\n');
  console.log('wrote', monstersPath);
}
