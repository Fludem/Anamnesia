/**
 * The floating dock over every screen: the now-bar says what the hero is doing when the
 * screen being browsed is not the one doing it (tap to go there), and the gain ticker counts
 * what just landed against what the bank now holds. Fixed over the main column; above the
 * tab bar on narrow.
 */
import { content, simContext } from '../content/index.ts';
import type { SimState } from '../sim/save.ts';
import { actionScreen, activeView, gainTicker } from './derive.ts';
import { formatInt, formatSeconds } from './format.ts';
import { ItemIconTile, SkillIcon } from './parts.tsx';
import type { View } from './prefs.ts';
import type { Juice } from './theme/theme.ts';

/** How long a pill holds: past this the gain is old news and the drop feed's to tell. */
const TICKER_TICKS = 45;

export function NowDock({
  sim,
  view,
  juice,
  onView,
}: {
  sim: SimState;
  view: View;
  juice: Juice;
  onView: (view: View) => void;
}) {
  const active = activeView(sim, simContext);
  const screen = active === null ? null : actionScreen(active.request, simContext);
  const here = screen !== null && view.kind === 'skill' && view.id === screen;
  const gains = gainTicker(sim, content, TICKER_TICKS);
  const bar = active !== null && screen !== null && !here;
  if (!bar && gains.length === 0) return null;
  // Keyed on the lifetime cycle count so a new cycle remounts the fill instead of sliding back.
  const cycle = active === null ? 0 : (sim.stats.actions[active.skill] ?? 0);
  return (
    <div className="now-dock" aria-live="polite">
      {gains.length > 0 && (
        <div className="now-gains">
          {gains.map((g) => (
            <div key={g.key} className="now-pill">
              <ItemIconTile item={g.item} size="sm" juice={juice} />
              <span className="name">{g.item.name}</span>
              <span className="count">
                {formatInt(g.total)}
                <b className="plus">+{formatInt(g.gained)}</b>
              </span>
            </div>
          ))}
        </div>
      )}
      {bar && (
        <button
          className="now-bar"
          onClick={() => onView({ kind: 'skill', id: screen })}
          title={`Go to ${content.skill(screen).name}`}
        >
          <SkillIcon skill={screen} size={15} />
          <span className="doing">
            {screen === 'combat' ? 'Fighting' : content.skill(screen).name}
          </span>
          <span className="what">{active.name}</span>
          <span className="left">{formatSeconds(active.remainingMs)}</span>
          {active.remaining !== null && (
            <span className="left">· {String(active.remaining)} left</span>
          )}
          <span className="go" aria-hidden>
            ›
          </span>
          <span
            key={cycle}
            className="now-fill"
            style={{ width: `${(active.frac * 100).toFixed(1)}%` }}
          />
        </button>
      )}
    </div>
  );
}
