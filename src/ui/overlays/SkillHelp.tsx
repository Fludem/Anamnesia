/**
 * The "?" on a skill screen, opened as a card over the page: what the skill is, how a cycle
 * actually resolves, what is lifting it right now — read from this save, not written down —
 * and how best to climb it. Three columns wide enough to be read in one go, stacking on a
 * phone. The prose is `screens/help.ts`; the numbers are `derive-help.ts`.
 */
import { simContext } from '../../content/index.ts';
import type { SimState } from '../../sim/save.ts';
import { FIGHT, helpView } from '../derive-help.ts';
import { formatInt } from '../format.ts';
import { Label, UiIcon } from '../parts.tsx';
import { HELP } from '../screens/help.ts';
import { Modal } from './Modal.tsx';

export function SkillHelp({
  sim,
  topic,
  onClose,
}: {
  sim: SimState;
  /** A skill id, or `FIGHT` for the combat screen, which covers both styles. */
  topic: string;
  onClose: () => void;
}) {
  const view = helpView(sim, topic, simContext);
  const copy = HELP[topic];
  if (!copy) return null;
  const title = topic === FIGHT ? 'The fight' : view.skill.name;
  const lift = Math.round((view.xp - 1) * 100);
  return (
    <Modal onClose={onClose} wide>
      <div className="skill-help">
        <div className="help-head">
          <UiIcon id={view.skill.icon} size={20} />
          <span className="help-title">{title}</span>
          <span className="chip" title={`${formatInt(view.level.xp)} xp total`}>
            Lv {String(view.level.level)} / 99
          </span>
          <span className="spacer" />
          <button className="help-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="help-cols">
          <div className="help-col wide">
            <p className="help-lead">{copy.lead}</p>
            <section className="help-section">
              <Label>How it works</Label>
              <Lines lines={copy.works} />
            </section>
          </div>

          <div className="help-col">
            <section className="help-section">
              <div className="help-section-head">
                <Label>What lifts it</Label>
                <span className="spacer" />
                <span className={lift > 0 ? 'help-total on' : 'help-total'}>
                  {lift > 0 ? `+${String(lift)}% xp in all` : 'nothing yet'}
                </span>
              </div>
              <div className="help-lifts">
                {view.lifts.map((l) => (
                  <div key={l.k} className={l.on ? 'help-lift on' : 'help-lift'}>
                    <span className="k">{l.k}</span>
                    <span className="v">{l.v}</span>
                    <span className="note">{l.note}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="help-col">
            <section className="help-section">
              <Label>The climb</Label>
              {view.best && (
                <div className="help-best">
                  <span className="k">Best now</span>
                  <span className="name">{view.best.name}</span>
                  {view.best.quick && <span className="tag-quick">QUICK</span>}
                  <span className="spacer" />
                  <span className="hr">{formatInt(view.best.xpHr)} xp/hr</span>
                </div>
              )}
              {view.best && !view.best.ready && (
                <div className="help-note">
                  Nothing in the bank for it — gather the inputs, or run the best you can afford.
                </div>
              )}
              {view.next && (
                <div className="help-note">
                  Next open at Lv {String(view.next.level)}: {view.next.name}
                  {view.level.need !== null &&
                    ` · ${formatInt(view.level.need - view.level.into)} xp to Lv ${String(view.level.level + 1)}`}
                </div>
              )}
              <Lines lines={copy.climb} />
            </section>
          </div>
        </div>

        <p className="help-chain">{copy.chain}</p>
      </div>
    </Modal>
  );
}

function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <ul className="help-list">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
