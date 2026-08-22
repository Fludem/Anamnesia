import type { ActionHandler } from '../actions.ts';
import type { RecipeDef } from '../content/schema.ts';
import type { Container } from '../items.ts';
import { addItem, countItem, removeItem } from '../items.ts';
import { addXp, skillLevel } from '../progress.ts';

/**
 * Crafting: consume a recipe's inputs from the bank, wait, receive its outputs and XP. The
 * recipe names the skill, so smithing (and any later crafting skill) is this one handler.
 * Inputs are taken when the cycle completes, not when it starts, so stopping early costs
 * nothing; `canStart` is re-checked before every cycle, so the action ends when inputs run out.
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
    const short = missingInput(state.bank, recipe, ctx.content.item.bind(ctx.content));
    if (short !== null) return { ok: false, reason: short };
    return { ok: true };
  },

  durationTicks(_state, req, ctx) {
    return ctx.content.recipe(req.recipe).durationTicks;
  },

  successChance() {
    return 1;
  },

  resolve(state, req, _success, ctx) {
    const recipe = ctx.content.recipe(req.recipe);
    let bank: Container | null = state.bank;
    for (const input of recipe.inputs) {
      bank = removeItem(bank, input.item, input.qty);
      // Inputs vanished mid-cycle (a follower command, say): the cycle simply yields nothing.
      if (bank === null) return state;
    }
    for (const output of recipe.outputs) bank = addItem(bank, output.item, output.qty);
    return addXp({ ...state, bank }, recipe.skill, recipe.xp);
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
