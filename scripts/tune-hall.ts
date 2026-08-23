/**
 * Where the hall's rooms sit against the progression model: each tier as hours of one name's
 * work at the level its materials open (20 / 55 / 80 for tiers I / II / III), need by need.
 * The content audit pins the totals; this is the piece to read when moving a number.
 * Run: `npx tsx scripts/tune-hall.ts`
 */
import { simContext as ctx } from '../src/content/index.ts';
import { hoursForTier, hoursToMake, ROOM_TIER_LEVELS } from '../src/sim/progression.ts';

const h = (n: number) => (Number.isFinite(n) ? n.toFixed(2).padStart(6) : '   ∞  ');

console.log('# Rooms: hours of one name at the tier level, per need and in all\n');
for (const room of ctx.content.rooms) {
  console.log(`## ${room.name}`);
  room.tiers.forEach((tier, i) => {
    const level = ROOM_TIER_LEVELS[i] ?? 99;
    const parts = tier.cost.map(
      (c) =>
        `${String(c.qty)} ${ctx.content.item(c.item).name} ${h(hoursToMake(c.item, c.qty, level, ctx))} h`,
    );
    if (tier.coins > 0) parts.push(`${String(tier.coins)} gp`);
    console.log(
      `  ${String(i + 1)} (L${String(level)})  ${h(hoursForTier(tier, level, ctx))} h  ←  ${parts.join(' · ')}`,
    );
  });
  console.log('');
}
