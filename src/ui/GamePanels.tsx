import { useState } from 'react';
import { content, simContext } from '../content/index.ts';
import { icons } from '../icons/registry.ts';
import { canStartAction, type ActionRequest } from '../sim/actions.ts';
import type { Command } from '../sim/commands.ts';
import type { GatherNodeDef, RecipeDef } from '../sim/content/schema.ts';
import { countItem } from '../sim/items.ts';
import { skillLevel, skillXp } from '../sim/progress.ts';
import type { SimState } from '../sim/save.ts';
import { EQUIPMENT_SLOTS, TOOL_SLOTS, type ToolSlot } from '../sim/slots.ts';
import { toolAdjustedTicks } from '../sim/skills/gathering.ts';
import { formatDuration, formatInt } from './format.ts';
import { BareIcon, ItemTile } from './items/ItemTile.tsx';
import { itemTileSpec, rockIconSpec, tileSpec } from './items/spec.ts';
import { color } from './theme/theme.ts';

function skillIcon(iconId: string) {
  const e = icons.get(iconId);
  return { layers: [{ id: e.id, d: e.d, fill: { kind: 'flat' as const, color: color.accent } }] };
}

interface PanelProps {
  sim: SimState;
  /** Null while this tab cannot act (follower / stale / error). */
  dispatch: ((cmd: Command) => void) | null;
}

/**
 * Phase 1–3 panels: enough UI to play every shipped skill and watch the numbers move. The real
 * layout and styling arrive in Phase 4; these read sim state and draw it, nothing more.
 */
export function SkillsPanel({ sim }: { sim: SimState }) {
  const curve = simContext.xp;
  return (
    <section className="panel">
      <h2>Skills</h2>
      <ul className="skills">
        {content.skills.map((skill) => {
          const xp = skillXp(sim, skill.id);
          const level = curve.levelForXp(xp);
          const floor = curve.xpForLevel(level);
          const next = level < curve.maxLevel ? curve.xpForLevel(level + 1) : null;
          const frac = next === null ? 1 : (xp - floor) / (next - floor);
          return (
            <li key={skill.id}>
              <BareIcon spec={skillIcon(skill.icon)} size={20} />
              <div className="grow">
                <div className="row">
                  <span className="name">{skill.name}</span>
                  <span className="mono">Lv {level}</span>
                </div>
                <div className="progress">
                  <div style={{ width: `${String(Math.round(frac * 100))}%` }} />
                </div>
                <div className="detail mono">
                  {formatInt(Math.floor(xp))} xp
                  {next !== null
                    ? ` · ${formatInt(next - Math.floor(xp))} to ${String(level + 1)}`
                    : ' · max'}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The one gathering panel: mining over rocks, woodcutting over trees. */
interface GatherSkill {
  skill: string;
  title: string;
  toolSlot: ToolSlot;
  nodes: readonly GatherNodeDef[];
  request(nodeId: string): ActionRequest;
  verb: string;
  active: string;
}

const GATHER_SKILLS: readonly GatherSkill[] = [
  {
    skill: 'mining',
    title: 'Mining',
    toolSlot: 'pickaxe',
    nodes: content.rocks,
    request: (rock) => ({ kind: 'mining', rock, count: null }),
    verb: 'Mine',
    active: 'Mining',
  },
  {
    skill: 'woodcutting',
    title: 'Woodcutting',
    toolSlot: 'axe',
    nodes: content.trees,
    request: (tree) => ({ kind: 'woodcutting', tree, count: null }),
    verb: 'Cut',
    active: 'Cutting',
  },
];

function requestNode(req: ActionRequest): string | null {
  switch (req.kind) {
    case 'mining':
      return req.rock;
    case 'woodcutting':
      return req.tree;
    case 'crafting':
      return null;
  }
}

export function GatherPanel({ sim, dispatch, def }: PanelProps & { def: GatherSkill }) {
  const current = sim.action.current;
  const level = skillLevel(sim, def.skill, simContext);
  const tool = sim.equipment[def.toolSlot];
  return (
    <section className="panel">
      <div className="row">
        <h2>{def.title}</h2>
        <span className="detail">
          Tool: {tool === null ? 'none' : content.item(tool).name}
          {tool !== null && ` · −${String(content.item(tool).stats.gather ?? 0)}% time`}
        </span>
        {current?.request.kind === def.skill && dispatch && (
          <button onClick={() => dispatch({ type: 'action:stop' })}>Stop</button>
        )}
      </div>
      <ul className="rocks">
        {def.nodes.map((node) => {
          const request = def.request(node.id);
          const active =
            current !== null &&
            current.request.kind === def.skill &&
            requestNode(current.request) === node.id;
          const check = canStartAction(sim, request, simContext);
          const chance = Math.min(
            1,
            node.success.base + node.success.perLevel * (level - node.level),
          );
          const ticks = toolAdjustedTicks(sim, def.toolSlot, node.durationTicks, simContext);
          return (
            <li key={node.id} className={active ? 'active' : undefined}>
              <ItemTile
                spec={tileSpec(content, rockIconSpec(content, node, !check.ok), 'common', [])}
              />
              <div className="grow">
                <div className="row">
                  <span className="name">{node.name}</span>
                  <span className="detail mono">
                    Lv {node.level} · {formatDuration(ticks * 100)} · {formatInt(node.xp)} xp
                    {check.ok ? ` · ${String(Math.round(chance * 100))}%` : ''}
                  </span>
                </div>
                {active && current && (
                  <div className="progress">
                    <div
                      style={{
                        width: `${String(Math.round((current.elapsedTicks / current.durationTicks) * 100))}%`,
                      }}
                    />
                  </div>
                )}
                {!check.ok && <div className="detail">{check.reason}</div>}
              </div>
              <button
                disabled={!dispatch || !check.ok || active}
                onClick={() => dispatch?.({ type: 'action:start', request })}
              >
                {active ? def.active : def.verb}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function GatherPanels(props: PanelProps) {
  return (
    <>
      {GATHER_SKILLS.map((def) => (
        <GatherPanel key={def.skill} {...props} def={def} />
      ))}
    </>
  );
}

function recipeLine(sim: SimState, recipe: RecipeDef): string {
  const inputs = recipe.inputs
    .map(
      (i) =>
        `${String(i.qty)} ${content.item(i.item).name} (${formatInt(countItem(sim.bank, i.item))})`,
    )
    .join(' + ');
  return `Lv ${String(recipe.level)} · ${formatDuration(recipe.durationTicks * 100)} · ${formatInt(recipe.xp)} xp · ${inputs}`;
}

export function SmithingPanel({ sim, dispatch }: PanelProps) {
  const [category, setCategory] = useState<string>('bars');
  const recipes = content.recipesFor('smithing');
  const categories = [...new Set(recipes.map((r) => r.category))];
  const current = sim.action.current;
  return (
    <section className="panel">
      <div className="row">
        <h2>Smithing</h2>
        {current?.request.kind === 'crafting' && dispatch && (
          <button onClick={() => dispatch({ type: 'action:stop' })}>Stop</button>
        )}
      </div>
      <div className="row tabs">
        {categories.map((c) => (
          <button
            key={c}
            className={c === category ? 'primary' : undefined}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <ul className="rocks">
        {recipes
          .filter((r) => r.category === category)
          .map((recipe) => {
            const request: ActionRequest = { kind: 'crafting', recipe: recipe.id, count: null };
            const active =
              current?.request.kind === 'crafting' && current.request.recipe === recipe.id;
            const check = canStartAction(sim, request, simContext);
            const output = content.item(recipe.outputs[0]!.item);
            return (
              <li key={recipe.id} className={active ? 'active' : undefined}>
                <ItemTile spec={itemTileSpec(content, output)} rarity={output.rarity} />
                <div className="grow">
                  <div className="row">
                    <span className="name">{recipe.name}</span>
                    <span className="detail mono">{recipeLine(sim, recipe)}</span>
                  </div>
                  {active && current && (
                    <div className="progress">
                      <div
                        style={{
                          width: `${String(Math.round((current.elapsedTicks / current.durationTicks) * 100))}%`,
                        }}
                      />
                    </div>
                  )}
                  {!check.ok && !active && <div className="detail">{check.reason}</div>}
                </div>
                <button
                  disabled={!dispatch || !check.ok || active}
                  onClick={() => dispatch?.({ type: 'action:start', request })}
                >
                  {active ? 'Smithing' : 'Smith'}
                </button>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

export function EquipmentPanel({ sim, dispatch }: PanelProps) {
  const worn = EQUIPMENT_SLOTS.filter((slot) => sim.equipment[slot] !== null);
  return (
    <section className="panel">
      <h2>Equipment</h2>
      {worn.length === 0 ? (
        <p className="detail">Nothing equipped. Smith a tool and equip it from the bank.</p>
      ) : (
        <ul className="rocks">
          {worn.map((slot) => {
            const item = content.item(sim.equipment[slot]!);
            const stats = Object.entries(item.stats)
              .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${String(v)}${k === 'gather' ? '%' : ''}`)
              .join(' · ');
            return (
              <li key={slot}>
                <ItemTile spec={itemTileSpec(content, item)} rarity={item.rarity} />
                <div className="grow">
                  <div className="row">
                    <span className="name">{item.name}</span>
                    <span className="detail mono">
                      {slot in TOOL_SLOTS ? `${slot} · ${TOOL_SLOTS[slot as ToolSlot]}` : slot}
                      {stats && ` · ${stats}`}
                    </span>
                  </div>
                  <div className="detail">{item.description}</div>
                </div>
                <button disabled={!dispatch} onClick={() => dispatch?.({ type: 'unequip', slot })}>
                  Unequip
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function BankPanel({ sim, dispatch }: PanelProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedItem =
    selected !== null && content.hasItem(selected) ? content.item(selected) : null;
  const selectedQty = selected === null ? 0 : countItem(sim.bank, selected);
  return (
    <section className="panel">
      <div className="row">
        <h2>Bank</h2>
        <span className="detail mono">
          {formatInt(sim.bank.length)} stacks ·{' '}
          {formatInt(sim.bank.reduce((s, st) => s + content.item(st.item).value * st.qty, 0))} gp
        </span>
      </div>
      {sim.bank.length === 0 ? (
        <p className="detail">Nothing yet. Mine something.</p>
      ) : (
        <ul className="bank">
          {sim.bank.map((stack) => {
            const item = content.item(stack.item);
            return (
              <li
                key={stack.item}
                className={stack.item === selected ? 'selected' : undefined}
                title={`${item.name} · worth ${formatInt(item.value)} each`}
                onClick={() => setSelected(stack.item === selected ? null : stack.item)}
              >
                <ItemTile
                  spec={itemTileSpec(content, item, { size: 'bank' })}
                  rarity={item.rarity}
                  title={item.name}
                />
                <span className="qty mono">{formatInt(stack.qty)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {selectedItem && selectedQty > 0 && (
        <div className="selected-item">
          <ItemTile spec={itemTileSpec(content, selectedItem)} rarity={selectedItem.rarity} />
          <div className="grow">
            <div className="row">
              <span className="name">{selectedItem.name}</span>
              <span className="detail mono">
                {content.rarity(selectedItem.rarity).name} · {selectedItem.class} ·{' '}
                {formatInt(selectedQty)} × {formatInt(selectedItem.value)} gp
              </span>
            </div>
            <div className="detail">{selectedItem.description}</div>
            {Object.keys(selectedItem.stats).length > 0 && (
              <div className="detail mono">
                {Object.entries(selectedItem.stats)
                  .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${String(v)}`)
                  .join(' · ')}
              </div>
            )}
          </div>
          {selectedItem.slot !== null && (
            <button
              disabled={!dispatch}
              onClick={() => dispatch?.({ type: 'equip', item: selectedItem.id })}
            >
              Equip
            </button>
          )}
          {selectedItem.opens !== null && (
            <>
              <button
                disabled={!dispatch}
                onClick={() => dispatch?.({ type: 'open', item: selectedItem.id, qty: 1 })}
              >
                Open
              </button>
              <button
                disabled={!dispatch || selectedQty < 2}
                onClick={() =>
                  dispatch?.({ type: 'open', item: selectedItem.id, qty: selectedQty })
                }
              >
                Open all
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
