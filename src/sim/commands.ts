import { z } from 'zod';
import { ActionRequestSchema, beginAction, canStartAction, startNextQueued } from './actions.ts';
import { IdSchema } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { rollDropTable } from './drops.ts';
import { addItem, addStacks, countItem, removeItem } from './items.ts';
import type { SimState } from './save.ts';
import { EquipmentSlotSchema } from './slots.ts';

/**
 * Player intents. Applied by the leader between ticks; followers send them over the channel.
 * Pure: a command either produces a new state or is rejected with a reason, never a throw.
 */
export const CommandSchema = z.discriminatedUnion('type', [
  /** Replace whatever is running (and the queue) with this request. */
  z.object({ type: z.literal('action:start'), request: ActionRequestSchema }),
  /** Run after the current action finishes its count; starts immediately if idle. */
  z.object({ type: z.literal('action:enqueue'), request: ActionRequestSchema }),
  /** Stop the current action and clear the queue. */
  z.object({ type: z.literal('action:stop') }),
  /** Move one of `item` from the bank into its slot; whatever was there goes back to the bank. */
  z.object({ type: z.literal('equip'), item: IdSchema }),
  z.object({ type: z.literal('unequip'), slot: EquipmentSlotSchema }),
  /** Open `qty` of a container item, rolling its table once per item. */
  z.object({ type: z.literal('open'), item: IdSchema, qty: z.number().int().min(1).default(1) }),
]);
export type Command = z.infer<typeof CommandSchema>;

export type CommandResult =
  { ok: true; state: SimState } | { ok: false; state: SimState; reason: string };

export function applyCommand(state: SimState, cmd: Command, ctx: SimContext): CommandResult {
  switch (cmd.type) {
    case 'action:start': {
      const check = canStartAction(state, cmd.request, ctx);
      if (!check.ok) return { ok: false, state, reason: check.reason };
      return {
        ok: true,
        state: beginAction({ ...state, action: { current: null, queue: [] } }, cmd.request, ctx),
      };
    }
    case 'action:enqueue': {
      const check = canStartAction(state, cmd.request, ctx);
      if (!check.ok) return { ok: false, state, reason: check.reason };
      const queued = {
        ...state,
        action: { ...state.action, queue: [...state.action.queue, cmd.request] },
      };
      return { ok: true, state: queued.action.current ? queued : startNextQueued(queued, ctx) };
    }
    case 'action:stop':
      return { ok: true, state: { ...state, action: { current: null, queue: [] } } };
    case 'equip': {
      if (!ctx.content.hasItem(cmd.item)) return reject(state, `unknown item "${cmd.item}"`);
      const item = ctx.content.item(cmd.item);
      if (item.slot === null) return reject(state, `${item.name} cannot be equipped`);
      const bank = removeItem(state.bank, cmd.item, 1);
      if (bank === null) return reject(state, `no ${item.name} in the bank`);
      const previous = state.equipment[item.slot];
      return {
        ok: true,
        state: {
          ...state,
          bank: previous === null ? bank : addItem(bank, previous, 1),
          equipment: { ...state.equipment, [item.slot]: cmd.item },
        },
      };
    }
    case 'unequip': {
      const worn = state.equipment[cmd.slot];
      if (worn === null) return reject(state, `nothing in the ${cmd.slot} slot`);
      return {
        ok: true,
        state: {
          ...state,
          bank: addItem(state.bank, worn, 1),
          equipment: { ...state.equipment, [cmd.slot]: null },
        },
      };
    }
    case 'open': {
      if (!ctx.content.hasItem(cmd.item)) return reject(state, `unknown item "${cmd.item}"`);
      const item = ctx.content.item(cmd.item);
      if (item.opens === null) return reject(state, `${item.name} cannot be opened`);
      const have = countItem(state.bank, cmd.item);
      if (have < cmd.qty) return reject(state, `only ${String(have)} ${item.name} in the bank`);
      let bank = removeItem(state.bank, cmd.item, cmd.qty) ?? state.bank;
      let rng = state.rng;
      for (let i = 0; i < cmd.qty; i++) {
        let stacks;
        [stacks, rng] = rollDropTable(item.opens, rng);
        bank = addStacks(bank, stacks);
      }
      return { ok: true, state: { ...state, bank, rng } };
    }
  }
}

function reject(state: SimState, reason: string): CommandResult {
  return { ok: false, state, reason };
}
