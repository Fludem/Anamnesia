import { z } from 'zod';
import { ActionRequestSchema, beginAction, canStartAction, startNextQueued } from './actions.ts';
import { bankFull, bankSlotCost, roomFor } from './bank.ts';
import { IdSchema } from './content/schema.ts';
import type { SimContext } from './context.ts';
import { rollDropTable } from './drops.ts';
import { pushEvent } from './events.ts';
import { addItem, addStacks, countItem, removeItem, type Container } from './items.ts';
import { heroStats } from './combat.ts';
import { recordItems } from './perks.ts';
import type { SimState } from './save.ts';
import { eat, offer } from './skills/combat.ts';
import { buyWare } from './trader.ts';
import { EquipmentSlotSchema } from './slots.ts';

/** 3–16 visible characters; trimmed by the UI, checked here so a save never holds junk. */
export const PlayerNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(16)
  .regex(/^[\p{L}\p{N} '._-]+$/u, "letters, numbers, spaces and ' . _ - only");

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
  /** Sell `qty` of `item` from the bank at its listed value. */
  z.object({ type: z.literal('sell'), item: IdSchema, qty: z.number().int().min(1).default(1) }),
  /** Buy one more bank slot at the current price. */
  z.object({ type: z.literal('bank:buy-slot') }),
  z.object({ type: z.literal('player:rename'), name: PlayerNameSchema }),
  /** Swear to a god. Once: the hill does not take oaths back. */
  z.object({ type: z.literal('player:swear'), god: IdSchema }),
  /** Put the first-steps card away (skipped or finished), or bring it back. */
  z.object({ type: z.literal('tutorial:dismiss') }),
  z.object({ type: z.literal('tutorial:show') }),
  /** Choose the bank item auto-eat draws from (null: none). */
  z.object({ type: z.literal('combat:food'), item: IdSchema.nullable() }),
  /** Eat below this fraction of max hitpoints. */
  z.object({ type: z.literal('combat:eat-at'), fraction: z.number().min(0).max(1) }),
  /** Eat one of the chosen food now. */
  z.object({ type: z.literal('combat:eat') }),
  /** Choose the bank item burnt for favour when it runs out in a fight (null: none). */
  z.object({ type: z.literal('combat:offering'), item: IdSchema.nullable() }),
  /** Burn one of the chosen offering now. */
  z.object({ type: z.literal('combat:offer') }),
  /** Pay the ferryman on death (twice the lost item's worth) rather than lose the item. */
  z.object({ type: z.literal('combat:ferryman'), pay: z.boolean() }),
  /** Buy one of the trader's wares at its current price. */
  z.object({ type: z.literal('trader:buy'), ware: IdSchema }),
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
        state: beginAction(
          {
            ...state,
            action: { current: null, queue: [] },
            combat: { ...state.combat, fight: null },
          },
          cmd.request,
          ctx,
        ),
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
      return {
        ok: true,
        state: {
          ...state,
          action: { current: null, queue: [] },
          combat: { ...state.combat, fight: null },
        },
      };
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
      // Opening the last one frees its slot; otherwise the container keeps it.
      const after =
        have === cmd.qty
          ? { ...state, bank: removeItem(state.bank, cmd.item, have) ?? state.bank }
          : state;
      const room = roomFor(
        after,
        item.opens.entries.map((e) => e.item),
      );
      if (!room.ok) {
        return reject(state, `bank is full (no slot for ${ctx.content.item(room.item).name})`);
      }
      let bank = removeItem(state.bank, cmd.item, cmd.qty) ?? state.bank;
      let rng = state.rng;
      let loot: Container = [];
      for (let i = 0; i < cmd.qty; i++) {
        let stacks;
        [stacks, rng] = rollDropTable(item.opens, rng);
        bank = addStacks(bank, stacks);
        loot = addStacks(loot, stacks);
      }
      return {
        ok: true,
        state: pushEvent(recordItems({ ...state, bank, rng }, loot), {
          type: 'opened',
          tick: state.tick,
          item: cmd.item,
          qty: cmd.qty,
          items: loot,
        }),
      };
    }
    case 'sell': {
      if (!ctx.content.hasItem(cmd.item)) return reject(state, `unknown item "${cmd.item}"`);
      const item = ctx.content.item(cmd.item);
      const have = countItem(state.bank, cmd.item);
      if (have < cmd.qty) return reject(state, `only ${String(have)} ${item.name} in the bank`);
      const bank = removeItem(state.bank, cmd.item, cmd.qty) ?? state.bank;
      return {
        ok: true,
        state: {
          ...state,
          bank,
          coins: state.coins + item.value * cmd.qty,
          stats: { ...state.stats, sold: state.stats.sold + cmd.qty },
        },
      };
    }
    case 'bank:buy-slot': {
      const cost = bankSlotCost(state.bankSlotsBought);
      if (state.coins < cost) {
        return reject(
          state,
          `a bank slot costs ${String(cost)} gp (you have ${String(state.coins)})`,
        );
      }
      return {
        ok: true,
        state: {
          ...state,
          coins: state.coins - cost,
          bankSlotsBought: state.bankSlotsBought + 1,
          stats: { ...state.stats, spent: state.stats.spent + cost },
        },
      };
    }
    case 'player:rename':
      return { ok: true, state: { ...state, player: { ...state.player, name: cmd.name } } };
    case 'player:swear': {
      if (!ctx.content.hasGod(cmd.god)) return reject(state, `unknown god "${cmd.god}"`);
      if (state.player.god !== null) {
        return reject(state, `already sworn to ${ctx.content.god(state.player.god).name}`);
      }
      return { ok: true, state: { ...state, player: { ...state.player, god: cmd.god } } };
    }
    case 'tutorial:dismiss':
      return { ok: true, state: { ...state, tutorial: { ...state.tutorial, dismissed: true } } };
    case 'tutorial:show':
      return { ok: true, state: { ...state, tutorial: { ...state.tutorial, dismissed: false } } };
    case 'combat:food': {
      if (cmd.item !== null) {
        if (!ctx.content.hasItem(cmd.item)) return reject(state, `unknown item "${cmd.item}"`);
        const item = ctx.content.item(cmd.item);
        if (!((item.stats.heal ?? 0) > 0)) return reject(state, `${item.name} is not food`);
      }
      return { ok: true, state: { ...state, combat: { ...state.combat, food: cmd.item } } };
    }
    case 'combat:eat-at':
      return { ok: true, state: { ...state, combat: { ...state.combat, eatAt: cmd.fraction } } };
    case 'combat:eat': {
      if (state.combat.food === null) return reject(state, 'no food chosen');
      const ate = eat(state, ctx);
      if (ate === null) {
        const food = ctx.content.item(state.combat.food).name;
        return reject(
          state,
          state.combat.hp >= heroStats(state, ctx).maxHp
            ? 'hitpoints are full'
            : `no ${food} left in the bank`,
        );
      }
      return { ok: true, state: ate };
    }
    case 'combat:offering': {
      if (cmd.item !== null) {
        if (!ctx.content.hasItem(cmd.item)) return reject(state, `unknown item "${cmd.item}"`);
        const item = ctx.content.item(cmd.item);
        if (!((item.stats.favour ?? 0) > 0)) return reject(state, `${item.name} is no offering`);
      }
      return { ok: true, state: { ...state, combat: { ...state.combat, offering: cmd.item } } };
    }
    case 'combat:offer': {
      if (state.combat.offering === null) return reject(state, 'no offering chosen');
      const burnt = offer(state, ctx);
      if (burnt === null) {
        return reject(state, `no ${ctx.content.item(state.combat.offering).name} left in the bank`);
      }
      return { ok: true, state: burnt };
    }
    case 'combat:ferryman':
      return { ok: true, state: { ...state, combat: { ...state.combat, ferryman: cmd.pay } } };
    case 'trader:buy': {
      const bought = buyWare(state, cmd.ware, ctx);
      return bought.ok ? bought : reject(state, bought.reason);
    }
  }
}

export { bankFull };

function reject(state: SimState, reason: string): CommandResult {
  return { ok: false, state, reason };
}
