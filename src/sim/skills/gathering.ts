import type { ActionHandler, ActionKind, RequestOf } from '../actions.ts';
import { roomFor } from '../bank.ts';
import type { GatherNodeDef } from '../content/schema.ts';
import type { SimContext } from '../context.ts';
import { rollDropTable } from '../drops.ts';
import { pushEvent } from '../events.ts';
import { addStacks, type ItemStack } from '../items.ts';
import { awardXp, doubleYieldChance, extraDropTables, recordItems } from '../perks.ts';
import { skillLevel } from '../progress.ts';
import type { Weighed } from '../records.ts';
import { nextFloat } from '../rng.ts';
import type { SimState } from '../save.ts';
import type { ToolSlot } from '../slots.ts';

/**
 * The gathering primitive: pick a node, wait out its duration (shortened by the equipped
 * tool), roll success, then roll every drop table into the bank and award XP. Mining,
 * woodcutting and fishing are this with different content; foraging is the same call with no
 * tool. The sworn god may add a table, double the haul, or pay more xp (perks.ts).
 */
export interface GatheringSkill<K extends ActionKind> {
  skill: string;
  /** Human label for the "requires level" message. */
  skillName: string;
  /** The slot whose tool shortens the action, or null for a skill done by hand. */
  toolSlot: ToolSlot | null;
  nodeKind: string;
  nodeId(req: RequestOf<K>): string;
  hasNode(ctx: SimContext, id: string): boolean;
  node(ctx: SimContext, id: string): GatherNodeDef;
  /**
   * Run over the haul once it is decided: fishing weighs what it landed and keeps the biggest
   * (records.ts). A skill without one draws nothing extra, so mining, woodcutting and foraging
   * take exactly the draws they always took and every old save replays unchanged.
   */
  weigh?(
    state: SimState,
    landed: readonly ItemStack[],
    node: GatherNodeDef,
    ctx: SimContext,
  ): Weighed;
}

/** Action time after the tool's `gather` cut: `base × (1 − gather/100)`, never below one tick. */
export function toolAdjustedTicks(
  state: SimState,
  slot: ToolSlot | null,
  base: number,
  ctx: SimContext,
) {
  if (slot === null) return base;
  const equipped = state.equipment[slot];
  if (equipped === null || !ctx.content.hasItem(equipped)) return base;
  const gather = ctx.content.item(equipped).stats.gather ?? 0;
  return Math.max(1, Math.round(base * (1 - gather / 100)));
}

export function gatheringHandler<K extends ActionKind>(def: GatheringSkill<K>): ActionHandler<K> {
  return {
    canStart(state, req, ctx) {
      const id = def.nodeId(req);
      if (!def.hasNode(ctx, id)) return { ok: false, reason: `unknown ${def.nodeKind} "${id}"` };
      const node = def.node(ctx, id);
      const level = skillLevel(state, def.skill, ctx);
      if (level < node.level) {
        return {
          ok: false,
          reason: `requires ${def.skillName} level ${String(node.level)} (you are ${String(level)})`,
        };
      }
      // A full bank stops the action before a drop that would need a new slot, never after.
      const tables = [...node.drops, ...extraDropTables(state, def.skill, ctx)];
      const room = roomFor(
        state,
        tables.flatMap((t) => t.entries.map((e) => e.item)),
        ctx,
      );
      if (!room.ok) {
        return {
          ok: false,
          reason: `bank is full (no slot for ${ctx.content.item(room.item).name})`,
        };
      }
      return { ok: true };
    },

    durationTicks(state, req, ctx) {
      const node = def.node(ctx, def.nodeId(req));
      return toolAdjustedTicks(state, def.toolSlot, node.durationTicks, ctx);
    },

    successChance(state, req, ctx) {
      const node = def.node(ctx, def.nodeId(req));
      const level = skillLevel(state, def.skill, ctx);
      const chance = node.success.base + node.success.perLevel * (level - node.level);
      return Math.max(0, Math.min(1, chance));
    },

    resolve(state, req, success, ctx) {
      if (!success) return state;
      const node = def.node(ctx, def.nodeId(req));
      let rng = state.rng;
      let landed: ItemStack[] = [];
      for (const table of node.drops) {
        let stacks;
        [stacks, rng] = rollDropTable(table, rng);
        landed = addStacks(landed, stacks);
      }
      // The god's double: the node's own haul twice, rolled once per cycle.
      const twice = doubleYieldChance(state, def.skill, ctx);
      if (twice > 0) {
        let f;
        [f, rng] = nextFloat(rng);
        if (f < twice) landed = landed.map((s) => ({ ...s, qty: s.qty * 2 }));
      }
      for (const table of extraDropTables(state, def.skill, ctx)) {
        let stacks;
        [stacks, rng] = rollDropTable(table, rng);
        landed = addStacks(landed, stacks);
      }
      const bank = addStacks(state.bank, landed);
      const counted = recordItems({ ...state, rng, bank }, landed);
      // Weighed before the xp is paid, so a new best pays inside the same cycle's award.
      const weighed = def.weigh?.(counted, landed, node, ctx);
      const paid = awardXp(weighed?.state ?? counted, def.skill, node.xp + (weighed?.xp ?? 0), ctx);
      return pushEvent(paid.state, {
        type: 'gain',
        tick: paid.state.tick,
        skill: def.skill,
        xp: paid.xp,
        items: landed,
        sizes: weighed?.weighings ?? [],
      });
    },
  };
}
