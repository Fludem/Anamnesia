import { roomFor } from './bank.ts';
import type { SimContext } from './context.ts';
import { rollDropTable } from './drops.ts';
import { pushEvent } from './events.ts';
import { addStacks, type ItemStack } from './items.ts';
import { recordItems } from './perks.ts';
import type { SimState } from './save.ts';
import { findsRolls } from './trader.ts';

/**
 * What the hill leaves for someone who works it: a skill's `finds` table, rolled once per
 * successful cycle on top of whatever the cycle paid (twice with the trader's second look).
 * The roll is skipped, not wasted, when the bank has no room for what could land — a full
 * bank finds nothing, and the rng draw is not spent.
 */
export function rollFinds(state: SimState, skill: string, ctx: SimContext): SimState {
  if (!ctx.content.hasSkill(skill)) return state;
  const table = ctx.content.skill(skill).finds;
  if (table === null) return state;
  const room = roomFor(
    state,
    table.entries.map((e) => e.item),
    ctx,
  );
  if (!room.ok) return state;
  let rng = state.rng;
  let stacks: ItemStack[] = [];
  for (let i = findsRolls(state, ctx); i > 0; i--) {
    let rolled;
    [rolled, rng] = rollDropTable(table, rng);
    stacks = addStacks(stacks, rolled);
  }
  if (stacks.length === 0) return { ...state, rng };
  const s = recordItems({ ...state, rng, bank: addStacks(state.bank, stacks) }, stacks);
  return pushEvent(s, { type: 'found', tick: s.tick, skill, items: stacks });
}
