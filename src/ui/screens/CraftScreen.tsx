/**
 * A crafting skill — Screen A's layout over recipes instead of veins. The design did not draw
 * a crafting screen; this keeps its skeleton (active card, list, drop feed) and swaps the
 * list's rows for recipes, grouped by category tabs where a skill has several. Smithing,
 * firemaking and cooking are this screen with different nouns.
 */
import { useState } from 'react';
import { content, simContext } from '../../content/index.ts';
import { countItem } from '../../sim/items.ts';
import { activeView, recipeViews, skillView } from '../derive.ts';
import { formatInt, formatSeconds, ticksToMs } from '../format.ts';
import { BareIcon } from '../items/ItemTile.tsx';
import { itemIconSpec } from '../items/spec.ts';
import { Label, TileBox, UiIcon } from '../parts.tsx';
import { ActiveCard, DropFeed, ScreenHead, XpRow } from './common.tsx';
import type { CraftSkillDef, ScreenProps } from './defs.ts';

export function CraftScreen({ sim, dispatch, juice, def }: ScreenProps & { def: CraftSkillDef }) {
  const skill = content.skill(def.skill);
  const sv = skillView(sim, def.skill, simContext);
  const active = activeView(sim, simContext);
  const mine = active !== null && active.skill === def.skill ? active : null;
  const recipes = content.recipesFor(def.skill);
  const categories = [...new Set(recipes.map((r) => r.category))];
  const [category, setCategory] = useState(categories[0] ?? '');
  const views = recipeViews(
    sim,
    def.tabs ? recipes.filter((r) => r.category === category) : recipes,
    simContext,
  );
  const activeRecipe =
    mine && mine.request.kind === 'crafting' ? content.recipe(mine.request.recipe) : null;
  const activeOutput = activeRecipe ? activeRecipe.outputs[0] : undefined;
  const activeItem = activeOutput ? content.item(activeOutput.item) : null;

  return (
    <>
      <ScreenHead
        icon={skill.icon}
        title={skill.name}
        skill={def.skill}
        sim={sim}
        level={sv}
        rate={mine ? `${formatInt(mine.xpHr)} xp/hr` : null}
      />
      <XpRow view={sv} sim={sim} />
      <div className="columns">
        <div className="col-main">
          <ActiveCard
            sim={sim}
            juice={juice}
            skill={def.skill}
            active={mine}
            icon={
              activeItem ? (
                <BareIcon spec={itemIconSpec(content, activeItem)} size={34} />
              ) : (
                <UiIcon id={skill.icon} size={30} />
              )
            }
            sub={
              mine && activeRecipe
                ? `${formatInt(mine.xp)} xp · ${formatSeconds(mine.durationMs)} · ${inputsText(activeRecipe.inputs)}`
                : null
            }
            idleHint={def.idleHint}
            onStop={() => dispatch({ type: 'action:stop' })}
          />

          <div className="card list">
            <div className="card-head">
              <Label>{def.noun}</Label>
              <span className="spacer" />
              <span className="hint">{String(recipes.length)} known</span>
            </div>
            {def.tabs && (
              <div className="tabs">
                {categories.map((c) => (
                  <button
                    key={c}
                    className={c === category ? 'filter active' : 'filter'}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            {views.map((v) => {
              const out = v.recipe.outputs[0];
              const shown = content.item(out ? out.item : v.recipe.inputs[0]!.item);
              const blocked = v.locked || v.needs !== null;
              const disabled = blocked || (!v.active && !v.canAfford);
              return (
                <button
                  key={v.recipe.id}
                  className={`row${v.active ? ' active' : ''}${blocked ? ' locked' : ''}`}
                  disabled={disabled}
                  title={shown.description}
                  onClick={() => {
                    if (!v.active)
                      dispatch({
                        type: 'action:start',
                        request: { kind: 'crafting', recipe: v.recipe.id, count: null },
                      });
                  }}
                >
                  <TileBox size="md" dim={blocked}>
                    <BareIcon spec={itemIconSpec(content, shown, blocked)} size={24} />
                  </TileBox>
                  <div className="body">
                    <div className="name">{v.recipe.name}</div>
                    <div className="sub">
                      {v.locked
                        ? `requires Lv ${String(v.recipe.level)}`
                        : `Lv ${String(v.recipe.level)}`}
                      {' · '}
                      {formatInt(v.xp)} xp · {formatSeconds(ticksToMs(v.recipe.durationTicks))}
                      {!v.locked && v.chance < 1 ? ` · ${String(Math.round(v.chance * 100))}%` : ''}
                      {' · '}
                      {v.recipe.inputs.map((i, n) => {
                        const have = countItem(sim.bank, i.item);
                        return (
                          <span key={i.item} className={have < i.qty ? 'short' : undefined}>
                            {n > 0 ? ' + ' : ''}
                            {String(i.qty)} × {content.item(i.item).name}
                            {` (${formatInt(have)})`}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  {v.active && <span className="tag-active">ACTIVE</span>}
                  {v.locked && (
                    <span className="lock">
                      <UiIcon id="lorc/padlock" size={12} />
                      Lv {String(v.recipe.level)}
                    </span>
                  )}
                  {!v.locked && v.needs !== null && (
                    <span className="lock needs" title="a level in another skill">
                      <UiIcon id="lorc/padlock" size={12} />
                      {v.needs}
                    </span>
                  )}
                  {!blocked && !v.active && v.times > 0 && (
                    <span
                      className="hint"
                      style={{ font: '500 11px var(--font-mono)', color: 'var(--fg-3)' }}
                    >
                      ×{formatInt(v.times)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="col-side">
          <DropFeed sim={sim} skill={def.skill} juice={juice} />
        </div>
      </div>
    </>
  );
}

function inputsText(inputs: readonly { item: string; qty: number }[]): string {
  return inputs.map((i) => `${String(i.qty)} × ${content.item(i.item).name}`).join(' + ');
}
