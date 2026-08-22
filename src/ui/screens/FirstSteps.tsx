/**
 * The first-steps card: one step at a time, above whatever screen is open, until the walk is
 * done or put away. Built from Screen A's pieces (a card, a row, the ACTIVE tag's treatment)
 * since the design drew no tutorial; the copy is the hill's.
 */
import { content } from '../../content/index.ts';
import type { Command } from '../../sim/commands.ts';
import type { SimState } from '../../sim/save.ts';
import { currentTutorialStep, TUTORIAL_STEPS, tutorialStep } from '../../sim/tutorial.ts';
import { recentTutorialDone } from '../derive.ts';
import { formatInt } from '../format.ts';
import { Label, UiIcon } from '../parts.tsx';
import { BANK_ICON } from '../Shell.tsx';
import type { View } from '../prefs.ts';
import type { Juice } from '../theme/theme.ts';

const DONE_FLASH_TICKS = 30;

export function FirstSteps({
  sim,
  view,
  onGo,
  dispatch,
  juice,
}: {
  sim: SimState;
  view: View;
  onGo: (view: View) => void;
  dispatch: (cmd: Command) => void;
  juice: Juice;
}) {
  const step = currentTutorialStep(sim);
  const flash = juice === 'deadpan' ? null : recentTutorialDone(sim, DONE_FLASH_TICKS);
  const n = sim.tutorial.done.length;
  const total = TUTORIAL_STEPS.length;

  if (step === null) {
    return (
      <div className="card steps done">
        <div className="steps-row">
          <span className="steps-tile on">
            <UiIcon id="lorc/footprint" size={18} />
          </span>
          <div className="body">
            <div className="name">You know the hill now</div>
            <div className="sub">
              Every skill tried, something sold, a slot bought. The rest is repetition.
            </div>
          </div>
          <button className="btn quiet sm" onClick={() => dispatch({ type: 'tutorial:dismiss' })}>
            Put away
          </button>
        </div>
      </div>
    );
  }

  const [done, of] = step.progress(sim);
  const here =
    view.kind === 'skill' ? step.where === view.id : view.kind === 'bank' && step.where === 'bank';
  const target: View = step.where === 'bank' ? { kind: 'bank' } : { kind: 'skill', id: step.where };
  const whereName = step.where === 'bank' ? 'Bank' : content.skill(step.where).name;
  const icon = step.where === 'bank' ? BANK_ICON : content.skill(step.where).icon;
  const justDone = flash ? tutorialStep(flash.step) : null;

  return (
    <div className={flash ? 'card steps flash' : 'card steps'}>
      <div className="card-head">
        <Label>First steps</Label>
        <span className="hint">
          {String(n)} / {String(total)}
        </span>
        <span className="spacer" />
        {justDone && (
          <span className="steps-done">
            done · {justDone.title}
            {justDone.reward > 0 ? ` · +${formatInt(justDone.reward)} gp` : ''}
          </span>
        )}
        <button className="linkish dim" onClick={() => dispatch({ type: 'tutorial:dismiss' })}>
          skip
        </button>
      </div>
      <div className="steps-row">
        <button
          className={here ? 'steps-tile on' : 'steps-tile'}
          title={here ? whereName : `Go to ${whereName}`}
          onClick={() => onGo(target)}
          disabled={here}
        >
          <UiIcon id={icon} size={18} />
        </button>
        <div className="body">
          <div className="name">
            {step.title}
            {!here && (
              <button className="chip go" onClick={() => onGo(target)}>
                in {whereName} →
              </button>
            )}
          </div>
          <div className="sub">{step.hint}</div>
        </div>
        <div className="steps-count">
          <span className="n">
            {String(done)} / {String(of)}
          </span>
          {step.reward > 0 && <span className="reward">+{formatInt(step.reward)} gp</span>}
        </div>
      </div>
      <div className="steps-bar">
        <div className="steps-fill" style={{ width: `${((done / of) * 100).toFixed(0)}%` }} />
      </div>
    </div>
  );
}
