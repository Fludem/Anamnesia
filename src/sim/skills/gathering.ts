import type { ActionHandler, ActionKind, RequestOf } from '../actions.ts';
import type { GatherNodeDef } from '../content/schema.ts';
import type { SimContext } from '../context.ts';
import { rollDropTable } from '../drops.ts';
import { addStacks } from '../items.ts';
import { addXp, skillLevel } from '../progress.ts';
import type { SimState } from '../save.ts';
import type { ToolSlot } from '../slots.ts';

/**
 * The gathering primitive: pick a node, wait out its duration (shortened by the equipped
 * tool), roll success, then roll every drop table into the bank and award XP. Mining and
 * woodcutting are this with different content; a third gathering skill is one more call.
 */
export interface GatheringSkill<K extends ActionKind> {
  skill: string;
  /** Human label for the "requires level" message. */
  skillName: string;
  toolSlot: ToolSlot;
  nodeKind: string;
  nodeId(req: RequestOf<K>): string;
  hasNode(ctx: SimContext, id: string): boolean;
  node(ctx: SimContext, id: string): GatherNodeDef;
}

/** Action time after the tool's `gather` cut: `base × (1 − gather/100)`, never below one tick. */
export function toolAdjustedTicks(state: SimState, slot: ToolSlot, base: number, ctx: SimContext) {
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
      let bank = state.bank;
      for (const table of node.drops) {
        let stacks;
        [stacks, rng] = rollDropTable(table, rng);
        bank = addStacks(bank, stacks);
      }
      return addXp({ ...state, rng, bank }, def.skill, node.xp);
    },
  };
}
