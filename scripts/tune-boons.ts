/**
 * Compare the four gods' combat boons against the bare climb. Not a tuner that writes content:
 * the boons are a handful of numbers in src/content/gods.json, and this prints what each one
 * is worth so they can be set by hand to about the same value — hours saved for the xp boons,
 * food saved for the others. `npx tsx scripts/tune-boons.ts`.
 */
import { content, simContext } from '../src/content/index.ts';
import { combatClimb } from '../src/sim/progression.ts';

const TICKS_PER_HOUR = 36_000;
type Climb = ReturnType<typeof combatClimb>;

/** Hitpoints eaten over the whole climb: each level's damage rate for the hours it takes. */
function foodOf(c: Climb): number {
  let hp = 0;
  for (const s of c.steps) {
    const need = simContext.xp.xpForLevel(s.level + 1) - simContext.xp.xpForLevel(s.level);
    hp += s.damagePerHour * (need / s.rate);
  }
  return hp;
}

const base = combatClimb(simContext);
const baseFood = foodOf(base);
console.log(
  `bare climb: ${base.hours.toFixed(1)} h, ${Math.round(baseFood).toLocaleString()} hp eaten`,
);
console.log('');
console.log('god       boon                        hours  Δhours   hp eaten  Δfood');
for (const g of content.gods) {
  const boon = g.perks.combat;
  if (boon === null) continue;
  const c = combatClimb(simContext, { boon });
  const food = foodOf(c);
  const what =
    boon.kind === 'regen'
      ? `${boon.name} (1 hp / ${String(boon.everyTicks / 10)} s)`
      : `${boon.name} (+${String(Math.round(boon.fraction * 100))}% ${boon.kind})`;
  console.log(
    `${g.name.padEnd(9)} ${what.padEnd(27)} ${c.hours.toFixed(1).padStart(6)}  ${(
      ((c.hours - base.hours) / base.hours) *
      100
    )
      .toFixed(0)
      .padStart(5)}%  ${Math.round(food).toLocaleString().padStart(9)}  ${(
      ((food - baseFood) / baseFood) *
      100
    )
      .toFixed(0)
      .padStart(5)}%`,
  );
}
console.log('');
console.log(
  `favour burns ${String(TICKS_PER_HOUR / 10).toLocaleString()} an hour in a fight; an hour of each standard patch buys:`,
);
for (const p of content.patches.filter((p) => !p.quick)) {
  const item = content.item(p.drops[0]!.entries[0]!.item);
  const perHour = (TICKS_PER_HOUR / p.durationTicks) * p.success.base * (item.stats.favour ?? 0);
  console.log(
    `  Lv ${String(p.level).padStart(2)} ${p.name.padEnd(22)} ${Math.round(perHour).toLocaleString().padStart(7)} favour → ${(perHour / 3600).toFixed(1)} h of fighting`,
  );
}
