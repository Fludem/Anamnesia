import { content, simContext } from '../content/index.ts';
import { Icon } from '../icons/Icon.tsx';
import { icons } from '../icons/registry.ts';
import { canStartAction } from '../sim/actions.ts';
import type { Command } from '../sim/commands.ts';
import { skillLevel, skillXp } from '../sim/progress.ts';
import type { SimState } from '../sim/save.ts';
import { formatDuration, formatInt } from './format.ts';

interface PanelProps {
  sim: SimState;
  /** Null while this tab cannot act (follower / stale / error). */
  dispatch: ((cmd: Command) => void) | null;
}

/**
 * Phase 1 panels: enough UI to play mining end to end and watch the numbers move. The real
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
              <Icon icon={icons.get(skill.icon)} size={22} />
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

export function MiningPanel({ sim, dispatch }: PanelProps) {
  const current = sim.action.current;
  const level = skillLevel(sim, 'mining', simContext);
  return (
    <section className="panel">
      <div className="row">
        <h2>Mining</h2>
        {current && dispatch && (
          <button onClick={() => dispatch({ type: 'action:stop' })}>Stop</button>
        )}
      </div>
      <ul className="rocks">
        {content.rocks.map((rock) => {
          const request = { kind: 'mining', rock: rock.id, count: null } as const;
          const active = current?.request.kind === 'mining' && current.request.rock === rock.id;
          const check = canStartAction(sim, request, simContext);
          const chance = Math.min(
            1,
            rock.success.base + rock.success.perLevel * (level - rock.level),
          );
          return (
            <li key={rock.id} className={active ? 'active' : undefined}>
              <Icon icon={icons.get(rock.icon)} size={28} />
              <div className="grow">
                <div className="row">
                  <span className="name">{rock.name}</span>
                  <span className="detail mono">
                    Lv {rock.level} · {formatDuration(rock.durationTicks * 100)} ·{' '}
                    {formatInt(rock.xp)} xp
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
                {active ? 'Mining' : 'Mine'}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function BankPanel({ sim }: { sim: SimState }) {
  return (
    <section className="panel">
      <h2>Bank</h2>
      {sim.bank.length === 0 ? (
        <p className="detail">Nothing yet. Mine something.</p>
      ) : (
        <ul className="bank">
          {sim.bank.map((stack) => {
            const item = content.item(stack.item);
            return (
              <li key={stack.item} title={`${item.name} · worth ${formatInt(item.value)} each`}>
                <Icon icon={icons.get(item.icon)} size={26} />
                <span className="name">{item.name}</span>
                <span className="qty mono">{formatInt(stack.qty)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
