/**
 * Prints what the slab asks and what it pays: each fish's band, the trophy line, the level at
 * which that line first comes into reach, the odds a catch crosses it at 99, roughly how long
 * that is at the water, and the trader's bounty as hours of the best gathering income.
 * Also the xp a record pays, which is the only number here that touches the climb.
 * Run: `npx tsx scripts/tune-slab.ts`
 */
import { simContext as ctx } from '../src/content/index.ts';
import type { SizeBand } from '../src/sim/content/schema.ts';
import { coinsPerHour } from '../src/sim/progression.ts';
import {
  bandCeiling,
  reachOf,
  SIZE_CURVE,
  TROPHY_FRACTION,
  trophyLevel,
  trophyWeight,
} from '../src/sim/records.ts';

const MAX = ctx.xp.maxLevel;
const GATHERING = ['mining', 'woodcutting', 'fishing', 'foraging'];
const best = (level: number) => Math.max(...GATHERING.map((s) => coinsPerHour(s, level, ctx)));
const k = (n: number) => (n >= 10_000 ? `${String(Math.round(n / 1000))}k` : String(Math.round(n)));
const kg = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(2)}kg` : `${String(Math.round(g))}g`);

/** Chance one catch at `level` beats `grams`, on the curve. */
const chanceOver = (
  band: SizeBand,
  level: number,
  nodeLevel: number,
  grams: number,
): number => {
  const ceiling = bandCeiling(band, reachOf(level, nodeLevel, MAX));
  if (grams > ceiling) return 0;
  const into = (grams - band.min) / (ceiling - band.min);
  return 1 - Math.pow(Math.max(0, into), 1 / SIZE_CURVE);
};

const waters = ctx.content.waters.flatMap((w) => {
  const fish = w.drops
    .flatMap((t) => t.entries.map((e) => ctx.content.item(e.item)))
    .find((i) => i.size !== null);
  return fish?.size ? [{ water: w, fish, band: fish.size }] : [];
});

console.log(
  `curve ${String(SIZE_CURVE)} · trophy at ${String(TROPHY_FRACTION * 100)}% of the band`,
);
console.log(
  `${'fish'.padEnd(16)}${'water'.padEnd(20)}${'lvl'.padStart(4)}${'band'.padStart(18)}` +
    `${'trophy'.padStart(9)}${'from'.padStart(6)}${'per catch @99'.padStart(15)}${'≈ catches'.padStart(11)}`,
);
for (const { water, fish, band } of waters) {
  const trophy = trophyWeight(band);
  const p = chanceOver(band, MAX, water.level, trophy);
  const tries = p > 0 ? Math.round(1 / p) : Infinity;
  console.log(
    fish.name.replace('Raw ', '').padEnd(16) +
      water.name.padEnd(20) +
      String(water.level).padStart(4) +
      `${kg(band.min)}–${kg(band.max)}`.padStart(18) +
      kg(trophy).padStart(9) +
      `L${String(trophyLevel(water.level, MAX))}`.padStart(6) +
      `${(p * 100).toFixed(2)}%`.padStart(15) +
      String(tries).padStart(11),
  );
}

console.log(
  "\nthe trader's bounty: hours of fishing at the level the line opens, and of the best skill at 99",
);
const gp99 = best(MAX);
let total = 0;
for (const { fish, band, water } of waters) {
  const paid = band.bounty;
  total += paid;
  console.log(
    fish.name.replace('Raw ', '').padEnd(16) +
      `L${String(trophyLevel(water.level, MAX))}`.padStart(6) +
      k(paid).padStart(10) +
      `${(paid / coinsPerHour('fishing', trophyLevel(water.level, MAX), ctx)).toFixed(1)} h fishing`.padStart(
        16,
      ) +
      `${(paid / gp99).toFixed(2)} h best`.padStart(14),
  );
}
console.log(
  `${'a full slab'.padEnd(16)}${''.padStart(6)}${k(total).padStart(10)}${''.padStart(16)}${(total / gp99).toFixed(2)} h best`.padEnd(
    10,
  ),
);

console.log('\nwhat a record pays, as a share of an hour at that water');
console.log(
  `${'water'.padEnd(20)}${'xp/cycle'.padStart(10)}${'top record'.padStart(12)}${'cycles/hr'.padStart(11)}`,
);
for (const { water } of waters) {
  const perHour = 36_000 / water.durationTicks;
  console.log(
    water.name.padEnd(20) +
      String(water.xp).padStart(10) +
      `+${String(water.xp)} xp`.padStart(12) +
      k(perHour).padStart(11),
  );
}
console.log(
  '\nA record is rare by construction: the nth catch beats every one before it about 1/n of\n' +
    'the time, so a whole climb is a handful of records — the xp is a moment, not a rate.',
);
