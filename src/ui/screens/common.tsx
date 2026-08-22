/** Pieces Screen A's layout is built from, shared by every skill screen. */
import type { ReactNode } from 'react';
import { content, simContext } from '../../content/index.ts';
import { godOf, xpMultiplier } from '../../sim/perks.ts';
import type { SimState } from '../../sim/save.ts';
import {
  activeView,
  dropFeed,
  recentGains,
  recentLevelUp,
  recentRareDrop,
  recentStop,
  type ActiveView,
  type SkillView,
} from '../derive.ts';
import { formatAge, formatDuration, formatInt, formatSeconds, ticksToMs } from '../format.ts';
import { ItemIconTile, Label, Pops, RarityTag, TileBox, UiIcon } from '../parts.tsx';
import { popX, useNow } from '../util.ts';
import type { Juice } from '../theme/theme.ts';

export function ScreenHead({
  icon,
  title,
  level,
  rate,
  chip,
  skill,
  sim,
}: {
  icon: string;
  title: string;
  level?: SkillView;
  rate?: string | null;
  chip?: string;
  /** With `sim`, shows the sworn god's bonus for this skill when there is one. */
  skill?: string;
  sim?: SimState;
}) {
  const bonus = skill !== undefined && sim !== undefined ? xpMultiplier(sim, skill, simContext) : 1;
  const god = bonus > 1 && sim !== undefined ? godOf(sim, simContext) : null;
  return (
    <div className="screen-head">
      <UiIcon id={icon} size={20} />
      <span className="screen-title">{title}</span>
      {level && (
        <span className="chip" title={`${formatInt(level.xp)} xp total`}>
          Lv {String(level.level)} / 99
        </span>
      )}
      {chip && <span className="chip">{chip}</span>}
      {god && (
        <span className="chip sworn" title={`sworn to ${god.name} ${god.title}`}>
          <UiIcon id={god.icon} size={11} />+{String(Math.round((bonus - 1) * 100))}% xp
        </span>
      )}
      <span className="spacer" />
      {rate && <span className="rate">{rate}</span>}
    </div>
  );
}

export function XpRow({ view, sim }: { view: SkillView; sim: SimState }) {
  const lit = recentLevelUp(sim, 40)?.skill === view.id;
  return (
    <div className="xp-row">
      <Label>XP</Label>
      <div className="xp-bar" role="progressbar" aria-valuenow={Math.round(view.frac * 100)}>
        <div
          className={lit ? 'xp-fill lit' : 'xp-fill'}
          style={{ width: `${(view.frac * 100).toFixed(2)}%` }}
        />
      </div>
      <span className="xp-text">
        {view.need === null
          ? `${formatInt(view.xp)} xp · max`
          : `${formatInt(view.into)} / ${formatInt(view.need)}`}
      </span>
    </div>
  );
}

/** The active-action card: tile, name, sub line, STOP, the big bar, xp pops, and the tool row. */
export function ActiveCard({
  sim,
  juice,
  skill,
  active,
  icon,
  sub,
  idleHint,
  onStop,
  tool,
}: {
  sim: SimState;
  juice: Juice;
  skill: string;
  /** The current action if it belongs to this screen's skill. */
  active: ActiveView | null;
  icon: ReactNode;
  sub: string | null;
  idleHint: string;
  onStop: () => void;
  tool?: ReactNode;
}) {
  const stop = active === null ? recentStop(sim, 600, skill) : null;
  // Another skill's action is running: say so, since starting here would replace it.
  const elsewhere = active === null ? activeView(sim, simContext) : null;
  const pops =
    juice === 'deadpan'
      ? []
      : recentGains(sim, 11, skill)
          .filter((g) => g.xp > 0)
          .map((g) => ({
            key: String(g.tick),
            text: `+${formatInt(g.xp)} xp`,
            x: popX(g.tick),
          }));
  // Keyed on the lifetime cycle count so a new cycle remounts the fill instead of sliding back.
  const cycle = sim.stats.actions[skill] ?? 0;
  return (
    <div className="card">
      <div className="active-head">
        <TileBox size="xl" dim={active === null}>
          {icon}
        </TileBox>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="title">{active ? active.name : 'Idle'}</div>
          <div className="sub">
            {active && sub ? (
              sub
            ) : elsewhere ? (
              <span className="idle-hint">
                {content.skill(elsewhere.skill).name} is running ({elsewhere.name}). Starting here
                replaces it.
              </span>
            ) : stop ? (
              <span style={{ color: 'var(--gold)' }}>stopped · {stop.reason}</span>
            ) : (
              <span className="idle-hint">{idleHint}</span>
            )}
          </div>
        </div>
        {active && (
          <button className="btn stop" onClick={onStop}>
            Stop
          </button>
        )}
      </div>
      <div className="bar-wrap">
        <div
          className="bar"
          role="progressbar"
          aria-valuenow={Math.round((active?.frac ?? 0) * 100)}
        >
          {active && (
            <div
              key={cycle}
              className="bar-fill"
              style={{ width: `${(active.frac * 100).toFixed(1)}%` }}
            />
          )}
          <span className="bar-text">
            {active
              ? active.remaining === null
                ? formatSeconds(active.remainingMs)
                : `${formatSeconds(active.remainingMs)} · ${String(active.remaining)} left`
              : '—'}
          </span>
        </div>
        <Pops pops={pops} />
      </div>
      {tool}
    </div>
  );
}

const RARE_TOAST_MIN_RANK = 2; // epic and up
const RARE_TOAST_TICKS = 26;

/** Screen A's right column: the drop feed with its rare-drop toast and session footer. */
export function DropFeed({ sim, skill, juice }: { sim: SimState; skill: string; juice: Juice }) {
  const rows = dropFeed(sim, content, { skill, limit: 14 });
  const toast =
    juice === 'juicy'
      ? recentRareDrop(sim, content, {
          minRank: RARE_TOAST_MIN_RANK,
          withinTicks: RARE_TOAST_TICKS,
          skill,
        })
      : null;
  const actions = sim.stats.actions[skill] ?? 0;
  const session = useSessionMs();
  return (
    <div className="card feed">
      <div className="card-head" style={{ padding: '8px 14px 6px' }}>
        <Label>Drops</Label>
        <span className="spacer" />
        <span className="hint">{formatInt(actions)} actions</span>
      </div>
      {toast && (
        <div className={`toast ${toast.item.rarity}`}>
          <UiIcon id={toast.item.icon} size={16} />
          <span className="kind">
            {toast.item.rarity === 'legendary' ? 'LEGENDARY DROP' : 'RARE DROP'}
          </span>
          <span className="name">{toast.item.name}</span>
        </div>
      )}
      {rows.length === 0 && (
        <div className="feed-empty">Nothing yet. Drops land here as they happen.</div>
      )}
      {rows.map((r) => {
        const fresh = Math.max(0, 1 - ticksToMs(r.ageTicks) / 900);
        return (
          <div
            key={r.key}
            className="feed-row"
            style={{
              background:
                fresh > 0 ? `rgba(var(--accent-rgb), ${(fresh * 0.07).toFixed(3)})` : undefined,
            }}
          >
            <ItemIconTile item={r.item} size="sm" juice={juice} feed={fresh > 0} />
            <span className="name">{r.item.name}</span>
            <RarityTag rarity={r.item.rarity} />
            <span className="qty">+{String(r.qty)}</span>
            <span className="age">{formatAge(ticksToMs(r.ageTicks))}</span>
          </div>
        );
      })}
      <div className="feed-foot">
        {formatInt(actions)} actions · {formatDuration(session)} this session
      </div>
    </div>
  );
}

const SESSION_START = Date.now();
function useSessionMs(): number {
  return useNow(1000) - SESSION_START;
}
