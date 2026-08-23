/**
 * Prints what the trader's prices and the ferryman's fees mean in hours of work: coins per
 * hour by skill at each milestone level (selling everything the best standard method lands),
 * each ware as hours of the best gathering income at a few levels, and the ferryman's fee for
 * each tier's set piece. Run: `npx tsx scripts/tune-trader.ts`
 */
import { simContext as ctx } from '../src/content/index.ts';
import { coinsPerHour, GEAR_LADDER, SET_PIECES } from '../src/sim/progression.ts';
import { ferrymanFee } from '../src/sim/skills/combat.ts';
import { warePrice } from '../src/sim/trader.ts';
import { createSimState } from '../src/sim/save.ts';

const LEVELS = [1, 10, 20, 30, 45, 60, 75, 90];
const SKILLS = ['mining', 'woodcutting', 'fishing', 'foraging', 'smithing', 'cooking'];
const GATHERING = SKILLS.slice(0, 4);
const k = (n: number) => (n >= 10_000 ? `${String(Math.round(n / 1000))}k` : String(Math.round(n)));
const best = (level: number) => Math.max(...GATHERING.map((s) => coinsPerHour(s, level, ctx)));

console.log('coins per hour, best standard method, selling everything');
console.log(`${'skill'.padEnd(12)}${LEVELS.map((l) => `L${String(l)}`.padStart(8)).join('')}`);
for (const skill of SKILLS) {
  const row = LEVELS.map((l) => k(coinsPerHour(skill, l, ctx)).padStart(8)).join('');
  console.log(`${skill.padEnd(12)}${row}`);
}

console.log('\nwares as hours of the best gathering income');
console.log(
  `${'ware'.padEnd(24)}${'price'.padStart(9)}${[20, 45, 75].map((l) => `L${String(l)}`.padStart(8)).join('')}`,
);
const fresh = createSimState(1);
for (const w of ctx.content.wares) {
  const price = warePrice(w, fresh);
  const hours = [20, 45, 75].map((l) => (price / best(l)).toFixed(2).padStart(8)).join('');
  console.log(`${w.name.padEnd(24)}${k(price).padStart(9)}${hours}`);
}

console.log("\nthe ferryman's fee (twice the worth) per set piece, and a full set");
console.log(
  `${'tier'.padEnd(8)}${SET_PIECES.map((p) => p.padStart(10)).join('')}${'set'.padStart(10)}`,
);
for (const step of GEAR_LADDER) {
  const fees = SET_PIECES.map((p) =>
    ferrymanFee(ctx.content.item(`${step.tier}-${p}`), fresh, ctx),
  );
  const row = fees.map((f) => k(f).padStart(10)).join('');
  console.log(`${step.tier.padEnd(8)}${row}${k(fees.reduce((a, b) => a + b, 0)).padStart(10)}`);
}
