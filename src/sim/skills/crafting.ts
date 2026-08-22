import type { ActionHandler } from '../actions.ts';
import { roomFor } from '../bank.ts';
import type { RecipeDef } from '../content/schema.ts';
import { pushEvent } from '../events.ts';
import type { Container } from '../items.ts';
import { addItem, countItem, removeItem } from '../items.ts';
import { awardXp, recordItems } from '../perks.ts';
import { skillLevel } from '../progress.ts';

/**
 * Crafting: consume a recipe's inputs from the bank, wait, receive its outputs and XP. The
 * recipe names the skill, so smithing, firemaking and cooking are this one handler.
 * Inputs are taken when the cycle completes, not when it starts, so stopping early costs
 * nothing; `canStart` is re-checked before every cycle, so the action ends when inputs run out.
 * A recipe may fail (cooking burns): the inputs still go, `failOutputs` land, no xp is paid.
 */
export const craftingHandler: ActionHandler<'crafting'> = {
  canStart(state, req, ctx) {
    if (!ctx.content.hasRecipe(req.recipe))
      return { ok: false, reason: `unknown recipe "${req.recipe}"` };
    const recipe = ctx.content.recipe(req.recipe);
    const level = skillLevel(state, recipe.skill, ctx);
    if (level < recipe.level) {
      const skill = ctx.content.skill(recipe.skill).name;
      return {
        ok: false,
        reason: `requires ${skill} level ${String(recipe.level)} (you are ${String(level)})`,
      };
    }
    for (const r of recipe.requires) {
      const have = skillLevel(state, r.skill, ctx);
      if (have < r.level) {
        const skill = ctx.content.skill(r.skill).name;
        return {
          ok: false,
          reason: `needs ${skill} level ${String(r.level)} (you are ${String(have)})`,
        };
      }
    }
    const short = missingInput(state.bank, recipe, ctx.content.item.bind(ctx.content));
    if (short !== null) return { ok: false, reason: short };
    // Inputs leave before outputs arrive, so a recipe that empties a stack frees its slot.
    const freed = new Set(
      recipe.inputs.filter((i) => countItem(state.bank, i.item) === i.qty).map((i) => i.item),
    );
    const after = { ...state, bank: state.bank.filter((s) => !freed.has(s.item)) };
    const room = roomFor(
      after,
      [...recipe.outputs, ...recipe.failOutputs].map((o) => o.item),
    );
    if (!room.ok) {
      return {
        ok: false,
        reason: `bank is full (no slot for ${ctx.content.item(room.item).name})`,
      };
    }
    return { ok: true };
  },

  durationTicks(_state, req, ctx) {
    return ctx.content.recipe(req.recipe).durationTicks;
  },

  successChance(state, req, ctx) {
    const recipe = ctx.content.recipe(req.recipe);
    const level = skillLevel(state, recipe.skill, ctx);
    const chance = recipe.success.base + recipe.success.perLevel * (level - recipe.level);
    return Math.max(0, Math.min(1, chance));
  },

  resolve(state, req, success, ctx) {
    const recipe = ctx.content.recipe(req.recipe);
    let bank: Container | null = state.bank;
    for (const input of recipe.inputs) {
      bank = removeItem(bank, input.item, input.qty);
      // Inputs vanished mid-cycle (a follower command, say): the cycle simply yields nothing.
      if (bank === null) return state;
    }
    const outputs = (success ? recipe.outputs : recipe.failOutputs).map((o) => ({
      item: o.item,
      qty: o.qty,
    }));
    for (const output of outputs) bank = addItem(bank, output.item, output.qty);
    const landed = recordItems({ ...state, bank }, outputs);
    const paid = success ? awardXp(landed, recipe.skill, recipe.xp, ctx) : { state: landed, xp: 0 };
    return pushEvent(paid.state, {
      type: 'gain',
      tick: paid.state.tick,
      skill: recipe.skill,
      xp: paid.xp,
      items: outputs,
    });
  },
};

function missingInput(
  bank: Container,
  recipe: RecipeDef,
  item: (id: string) => { name: string },
): string | null {
  for (const input of recipe.inputs) {
    const have = countItem(bank, input.item);
    if (have < input.qty) {
      return `needs ${String(input.qty)} × ${item(input.item).name} (you have ${String(have)})`;
    }
  }
  return null;
}
