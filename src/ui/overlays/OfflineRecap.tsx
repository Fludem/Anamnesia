/** "WELCOME BACK" — Screen A's offline recap, with an honest line when the catch-up was capped. */
import { content, simContext } from '../../content/index.ts';
import type { OfflineRecap as RecapInfo } from '../../runtime/game-host.ts';
import type { SimState } from '../../sim/save.ts';
import { recap } from '../derive.ts';
import { formatDuration, formatInt } from '../format.ts';
import { ItemIconTile, Label, RarityTag, SkillIcon } from '../parts.tsx';
import type { Juice } from '../theme/theme.ts';
import { Modal } from './Modal.tsx';

const VERB: Record<string, string> = {
  mining: 'mined',
  woodcutting: 'cut',
  smithing: 'smithed',
};

export function OfflineRecap({
  info,
  sim,
  juice,
  onCollect,
}: {
  info: RecapInfo;
  sim: SimState;
  juice: Juice;
  onCollect: () => void;
}) {
  const r = recap(info.before, sim, simContext);
  const top = r.skills[0];
  const verb = top ? (VERB[top.skill] ?? 'trained') : null;
  const capped = info.skippedTicks > 0;
  const uncounted = info.awayMs - info.capMs;
  return (
    <Modal tone="accent" wide dim>
      <Label className="accent">Welcome back</Label>
      <div className="lead">
        You were away for {formatDuration(info.awayMs)}
        {top ? ` — you ${verb ?? 'trained'}:` : '. Nothing was running.'}
      </div>
      {r.skills.map((s) => (
        <div key={s.skill} className="recap-main">
          <SkillIcon skill={s.skill} size={26} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="big">+{formatInt(s.xp)} xp</div>
            <div className="sub">
              {content.skill(s.skill).name} · {formatInt(s.actions)} actions
            </div>
          </div>
          {s.to > s.from && (
            <span className="tag-active" style={{ fontSize: 11, letterSpacing: 0 }}>
              Lv {String(s.from)} → {String(s.to)}
            </span>
          )}
        </div>
      ))}
      {r.items.length > 0 && (
        <>
          <div style={{ marginTop: 14 }}>
            <Label>Gathered</Label>
          </div>
          <div className="rows recap-scroll">
            {r.items.map((s) => {
              const item = content.item(s.item);
              return (
                <div key={s.item} className="recap-row">
                  <ItemIconTile item={item} size="sm" juice={juice} />
                  <span className="name">{item.name}</span>
                  <RarityTag rarity={item.rarity} />
                  <span className="n">×{formatInt(s.qty)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {capped && (
        <div className="recap-note">
          Offline progress is capped at {formatDuration(info.capMs)}. The other{' '}
          {formatDuration(uncounted)} did not count.
        </div>
      )}
      <button
        className="btn primary"
        style={{ width: '100%', marginTop: 16, padding: '10px 0' }}
        onClick={onCollect}
      >
        Collect
      </button>
    </Modal>
  );
}
