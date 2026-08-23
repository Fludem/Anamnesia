/**
 * Print what Phase 14 does to the fight: the melee climb and the sorcery climb side by side
 * (which monster each picks at every level and whether it is weak to them), the inscribing
 * climb and what it eats, and what casting costs in marks, ore and ash an hour. Read-only —
 * staff and mark stats are tuned by hand against this.
 *
 *   npx tsx scripts/tune-sorcery.ts
 */
import { content, simContext as ctx } from '../src/content/index.ts';
import { WEAKNESS_BONUS } from '../src/sim/combat.ts';
import {
  combatClimb,
  GEAR_LADDER,
  hoursToCap,
  STAFF_BY_TIER,
  type CombatClimb,
} from '../src/sim/progression.ts';

const eaten = (c: CombatClimb) => {
  let hp = 0;
  for (const s of c.steps) {
    const need = ctx.xp.xpForLevel(s.level + 1) - ctx.xp.xpForLevel(s.level);
    hp += (need / s.rate) * s.damagePerHour;
  }
  return hp;
};
const ms = (c: CombatClimb) =>
  Object.entries(c.milestones)
    .map(([l, h]) => `${l}:${h.toFixed(1)}h`)
    .join(' ');

const melee = combatClimb(ctx);
const sorcery = combatClimb(ctx, { style: 'sorcery' });
console.log(`weakness bonus ${(WEAKNESS_BONUS * 100).toFixed(0)}% on the max hit`);
console.log(
  `melee    ${melee.hours.toFixed(1)} h, ${eaten(melee).toFixed(0)} hp eaten · ${ms(melee)}`,
);
console.log(
  `sorcery  ${sorcery.hours.toFixed(1)} h, ${eaten(sorcery).toFixed(0)} hp eaten · ${ms(sorcery)}`,
);

const inscribing = hoursToCap('sorcery', ctx);
let ore = 0;
let ash = 0;
let marks = 0;
for (const [id, cycles] of Object.entries(inscribing.actions)) {
  const r = content.recipe(id);
  for (const i of r.inputs) {
    if (i.item === 'ash') ash += i.qty * cycles;
    else ore += i.qty * cycles;
  }
  marks += r.outputs[0]!.qty * cycles;
}
console.log(
  `inscribing ${inscribing.hours.toFixed(1)} h to 99 on marks · ${ore.toFixed(0)} ore, ${ash.toFixed(0)} ash → ${marks.toFixed(0)} marks`,
);
console.log('');
console.log(
  'level  melee picks          *weak   xp/h   | sorcery picks        *weak   xp/h   marks/h  ore/h  ash/h',
);
let last = '';
for (const m of melee.steps) {
  const s = sorcery.steps.find((x) => x.level === m.level)!;
  const key = `${m.monster}|${s.monster}`;
  if (key === last) continue;
  last = key;
  let tier = GEAR_LADDER[0]!.tier;
  for (const step of GEAR_LADDER) if (m.level >= step.level) tier = step.tier;
  const recipe = content.recipe(`${tier}-marks`);
  const perRecipe = recipe.outputs[0]!.qty;
  const recipes = s.hitsPerHour / perRecipe;
  const ashPer = recipe.inputs.find((i) => i.item === 'ash')?.qty ?? 0;
  const orePer = recipe.inputs.filter((i) => i.item !== 'ash').reduce((n, i) => n + i.qty, 0);
  console.log(
    `${String(m.level).padStart(5)}  ${m.monster.padEnd(20)} ${m.weak ? '*' : ' '} ${Math.round(m.rate).toString().padStart(7)}  | ${s.monster.padEnd(20)} ${s.weak ? '*' : ' '} ${Math.round(s.rate).toString().padStart(7)} ${s.hitsPerHour.toFixed(0).padStart(8)} ${(recipes * orePer).toFixed(0).padStart(6)} ${(recipes * ashPer).toFixed(0).padStart(6)}`,
  );
}
console.log('');
console.log('tier     staff              sword stats        staff stats');
for (const step of GEAR_LADDER) {
  const sword = content.item(`${step.tier}-sword`);
  const staff = content.item(STAFF_BY_TIER[step.tier]!);
  console.log(
    `${step.tier.padEnd(8)} ${staff.id.padEnd(18)} ${JSON.stringify(sword.stats).padEnd(30)} ${JSON.stringify(staff.stats)}`,
  );
}
