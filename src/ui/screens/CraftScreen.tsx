/**
 * Smithing — Screen A's layout over recipes instead of veins. The design did not draw a crafting
 * screen; this keeps its skeleton (active card, list, drop feed) and swaps the list's rows for
 * recipes grouped by category tabs.
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
import type { ScreenProps } from './defs.ts';

const SKILL = 'smithing';

export function SmithingScreen({ sim, dispatch, juice }: ScreenProps) {
  const skill = content.skill(SKILL);
  const sv = skillView(sim, SKILL, simContext);
  const active = activeView(sim, simContext);
  const mine = active !== null && active.skill === SKILL ? active : null;
  const recipes = content.recipesFor(SKILL);
  const categories = [...new Set(recipes.map((r) => r.category))];
  const [category, setCategory] = useState(categories[0] ?? 'bars');
  const views = recipeViews(
    sim,
    recipes.filter((r) => r.category === category),
    simContext,
  );
  const activeRecipe =
    mine && mine.request.kind === 'crafting' ? content.recipe(mine.request.recipe) : null;
  const activeOutput = activeRecipe ? content.item(activeRecipe.outputs[0]!.item) : null;

  return (
    <>
      <ScreenHead
        icon={skill.icon}
        title={skill.name}
        level={sv}
        rate={mine ? `${formatInt(mine.xpHr)} xp/hr` : null}
      />
      <XpRow view={sv} sim={sim} />
      <div className="columns">
        <div className="col-main">
          <ActiveCard
            sim={sim}
            juice={juice}
            skill={SKILL}
            active={mine}
            icon={
              activeOutput ? (
                <BareIcon spec={itemIconSpec(content, activeOutput)} size={34} />
              ) : (
                <UiIcon id={skill.icon} size={30} />
              )
            }
            sub={
              mine && activeRecipe
                ? `${String(activeRecipe.xp)} xp · ${formatSeconds(mine.durationMs)} · ${inputsText(activeRecipe.inputs)}`
                : null
            }
            idleHint="Pick a recipe below. It runs until the inputs run out."
            onStop={() => dispatch({ type: 'action:stop' })}
          />

          <div className="card list">
            <div className="card-head">
              <Label>Recipes</Label>
              <span className="spacer" />
              <span className="hint">{String(recipes.length)} known</span>
            </div>
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
            {views.map((v) => {
              const out = content.item(v.recipe.outputs[0]!.item);
              const disabled = v.locked || (!v.active && !v.canAfford);
              return (
                <button
                  key={v.recipe.id}
                  className={`row${v.active ? ' active' : ''}${v.locked ? ' locked' : ''}`}
                  disabled={disabled}
                  title={out.description}
                  onClick={() => {
                    if (!v.active)
                      dispatch({
                        type: 'action:start',
                        request: { kind: 'crafting', recipe: v.recipe.id, count: null },
                      });
                  }}
                >
                  <TileBox size="md" dim={v.locked}>
                    <BareIcon spec={itemIconSpec(content, out, v.locked)} size={24} />
                  </TileBox>
                  <div className="body">
                    <div className="name">{v.recipe.name}</div>
                    <div className="sub">
                      {v.locked
                        ? `requires Lv ${String(v.recipe.level)}`
                        : `Lv ${String(v.recipe.level)}`}
                      {' · '}
                      {String(v.recipe.xp)} xp · {formatSeconds(ticksToMs(v.recipe.durationTicks))}
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
                  {!v.locked && !v.active && v.times > 0 && (
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
          <DropFeed sim={sim} skill={SKILL} juice={juice} />
        </div>
      </div>
    </>
  );
}

function inputsText(inputs: readonly { item: string; qty: number }[]): string {
  return inputs.map((i) => `${String(i.qty)} × ${content.item(i.item).name}`).join(' + ');
}
