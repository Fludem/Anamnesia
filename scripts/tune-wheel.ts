/**
 * Prints what the wheel means in hours of work: the house's share of every kind of bet (the
 * same two pockets in thirty-eight, whatever the spot), each chip of the chip row as minutes
 * of the best gathering income at a few levels, and how many even-money spins a chip lasts on
 * average. Run: `npx tsx scripts/tune-wheel.ts`
 */
import { simContext as ctx } from '../src/content/index.ts';
import { coinsPerHour } from '../src/sim/progression.ts';
import { POCKETS, ROUND_MS, payout, spotOdds, type Spot } from '../src/sim/wheel.ts';
import { CHIP_VALUES } from '../src/ui/derive-wheel.ts';

const GATHERING = ['mining', 'woodcutting', 'fishing', 'foraging'];
const LEVELS = [20, 45, 75, 90];
const best = (level: number) => Math.max(...GATHERING.map((s) => coinsPerHour(s, level, ctx)));
const k = (n: number) => (n >= 10_000 ? `${String(Math.round(n / 1000))}k` : String(Math.round(n)));

console.log("the house's share by kind of bet (stake 1, every pocket once)");
const kinds: [string, Spot][] = [
  ['a number', 'straight:17'],
  ['a third', 'dozen:2'],
  ['a column', 'column:1'],
  ['even money', 'red'],
];
for (const [name, spot] of kinds) {
  let back = 0;
  for (let p = 0; p < POCKETS; p++) back += payout(1, spot, p);
  const edge = 1 - back / POCKETS;
  console.log(
    `${name.padEnd(12)}${`${String(spotOdds(spot))} to 1`.padStart(8)}${`${(edge * 100).toFixed(2)}%`.padStart(9)}`,
  );
}

console.log('\na chip as minutes of the best gathering income');
console.log(`${'chip'.padEnd(8)}${LEVELS.map((l) => `L${String(l)}`.padStart(9)).join('')}`);
for (const chip of CHIP_VALUES) {
  const row = LEVELS.map((l) => `${((chip / best(l)) * 60).toFixed(1)}m`.padStart(9)).join('');
  console.log(`${k(chip).padEnd(8)}${row}`);
}

const spinsAnHour = 3_600_000 / ROUND_MS;
const perSpin = 2 / POCKETS;
const spinsFor100 = Math.round(100 / perSpin);
console.log(
  `\n${String(spinsAnHour)} spins an hour; a chip on red every spin gives the house ` +
    `${(perSpin * spinsAnHour).toFixed(1)} chips an hour, so a stack of 100 is gone in about ` +
    `${String(spinsFor100)} spins — ${String(Math.round((spinsFor100 * ROUND_MS) / 3_600_000))} hours at the table.`,
);
