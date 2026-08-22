/**
 * Print what the Phase 8 gear does to the combat climb: the set with gauntlets, the same
 * with the tier's javelin thrown on every landed swing, and what that costs in bars an hour.
 *
 *   npx tsx scripts/tune-gear.ts
 */
import { simContext as ctx } from '../src/content/index.ts';
import { combatClimb, GEAR_LADDER, type CombatClimb } from '../src/sim/progression.ts';

const JAVELINS_PER_BAR = 20;

const bare = combatClimb(ctx);
const armed = combatClimb(ctx, { ammo: true });
const eaten = (c: CombatClimb) => {
  let hp = 0;
  for (const s of c.steps) {
    const need = ctx.xp.xpForLevel(s.level + 1) - ctx.xp.xpForLevel(s.level);
    hp += (need / s.rate) * s.damagePerHour;
  }
  return hp;
};
const pct = (a: number, b: number) => `${(((a - b) / b) * 100).toFixed(0)}%`;

console.log(
  `climb: ${bare.hours.toFixed(1)} h, ${eaten(bare).toFixed(0)} hp eaten · with the tier's javelins ${armed.hours.toFixed(1)} h (${pct(armed.hours, bare.hours)}), ${eaten(armed).toFixed(0)} hp (${pct(eaten(armed), eaten(bare))})`,
);
console.log('');
console.log('level  tier     monster            javelins/h  bars/h');
for (const step of GEAR_LADDER) {
  const row =
    armed.steps.find((s) => s.level === step.level) ?? armed.steps[armed.steps.length - 1]!;
  const hits = row.hitsPerHour;
  console.log(
    `${String(step.level).padStart(5)}  ${step.tier.padEnd(8)} ${row.monster.padEnd(18)} ${hits.toFixed(0).padStart(10)}  ${(hits / JAVELINS_PER_BAR).toFixed(0).padStart(6)}`,
  );
}
