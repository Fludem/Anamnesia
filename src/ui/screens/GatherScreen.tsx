/**
 * Screen A — skill training for a gathering skill. Mining over veins, woodcutting over trees;
 * the same screen with different nouns (the design's Screen B is A with other data).
 */
import { content, simContext } from '../../content/index.ts';
import { activeView, nodeViews, skillView, toolCutPercent } from '../derive.ts';
import { formatInt, formatSeconds, ticksToMs } from '../format.ts';
import { BareIcon } from '../items/ItemTile.tsx';
import { itemIconSpec, rockIconSpec } from '../items/spec.ts';
import { Label, TileBox, UiIcon } from '../parts.tsx';
import { ActiveCard, DropFeed, ScreenHead, XpRow } from './common.tsx';
import { TOOL_ICON, type GatherSkillDef, type ScreenProps } from './defs.ts';

export function GatherScreen({ sim, dispatch, juice, def }: ScreenProps & { def: GatherSkillDef }) {
  const skill = content.skill(def.skill);
  const sv = skillView(sim, def.skill, simContext);
  const active = activeView(sim, simContext);
  const mine = active !== null && active.skill === def.skill ? active : null;
  const nodes = nodeViews(
    sim,
    def.nodes,
    { skill: def.skill, toolSlot: def.toolSlot, request: def.request },
    simContext,
  );
  const activeNode = mine ? (nodes.find((v) => v.active)?.node ?? null) : null;
  const toolId = def.toolSlot === null ? null : sim.equipment[def.toolSlot];
  const cut = def.toolSlot === null ? 0 : toolCutPercent(sim, def.toolSlot, content);

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
              activeNode ? (
                <BareIcon spec={rockIconSpec(content, activeNode)} size={34} />
              ) : (
                <UiIcon id={skill.icon} size={30} />
              )
            }
            sub={
              mine && activeNode
                ? `${formatInt(mine.xp)} xp · ${formatSeconds(mine.durationMs)} · ${formatInt(mine.xpHr)} xp/hr`
                : null
            }
            idleHint={`Pick a ${def.noun.toLowerCase().replace(/s$/, '')} below to start.`}
            onStop={() => dispatch({ type: 'action:stop' })}
            tool={
              def.toolSlot === null ? (
                <div className="tool-row">
                  <Label>Tool</Label>
                  <span className="none">none · this one is done by hand</span>
                </div>
              ) : (
                <div className="tool-row">
                  <Label>Tool</Label>
                  <TileBox size="tool" dim={toolId === null}>
                    {toolId !== null ? (
                      <BareIcon spec={itemIconSpec(content, content.item(toolId))} size={22} />
                    ) : (
                      <UiIcon id={TOOL_ICON[def.toolSlot]} size={20} />
                    )}
                  </TileBox>
                  {toolId !== null ? (
                    <>
                      <span className="name">{content.item(toolId).name}</span>
                      <span className="effect">−{String(cut)}% action time</span>
                    </>
                  ) : (
                    <span className="none">
                      none equipped · smith one, then equip it from the bank
                    </span>
                  )}
                </div>
              )
            }
          />

          <div className="card list">
            <div className="card-head">
              <Label>{def.noun}</Label>
              <span className="spacer" />
              <span className="hint">{String(nodes.length)} known</span>
            </div>
            {nodes.map((v) => (
              <button
                key={v.node.id}
                className={`row${v.active ? ' active' : ''}${v.locked ? ' locked' : ''}`}
                disabled={v.locked}
                title={v.node.description}
                onClick={() => {
                  if (!v.active)
                    dispatch({ type: 'action:start', request: def.request(v.node.id) });
                }}
              >
                <TileBox size="md" dim={v.locked}>
                  <BareIcon spec={rockIconSpec(content, v.node, v.locked)} size={24} />
                </TileBox>
                <div className="body">
                  <div className="name">{v.node.name}</div>
                  <div className="sub">
                    {v.locked
                      ? `requires Lv ${String(v.node.level)}`
                      : `Lv ${String(v.node.level)}`}
                    {' · '}
                    {formatInt(v.xp)} xp · {formatSeconds(ticksToMs(v.ticks))}
                    {!v.locked && v.chance < 1 ? ` · ${String(Math.round(v.chance * 100))}%` : ''}
                    {!v.locked ? ` · ${formatInt(v.xpHr)} xp/hr` : ''}
                  </div>
                </div>
                {v.node.quick && !v.locked && (
                  <span className="tag-quick" title={v.node.description}>
                    QUICK
                  </span>
                )}
                {v.active && <span className="tag-active">ACTIVE</span>}
                {v.locked && (
                  <span className="lock">
                    <UiIcon id="lorc/padlock" size={12} />
                    Lv {String(v.node.level)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="col-side">
          <DropFeed sim={sim} skill={def.skill} juice={juice} />
        </div>
      </div>
    </>
  );
}
