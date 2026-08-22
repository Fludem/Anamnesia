/**
 * Screen D's card on the drifting backdrop — the calm full-page states: choosing a god on first
 * run, "running in another tab", the catch-up in progress, a stale tab, and a save error.
 * None of these show game panels: the point is one clear sentence and one button. Logging in
 * and making a name are on the same card (Auth.tsx).
 */
import { useState, type ReactNode } from 'react';
import { content, simContext } from '../../content/index.ts';
import type { HostSnapshot } from '../../runtime/game-host.ts';
import { skillOfRequest } from '../../sim/actions.ts';
import { formatInt } from '../format.ts';
import { Label, UiIcon } from '../parts.tsx';
import { boonText } from '../derive-combat.ts';
import { skillView } from '../derive.ts';

export function CalmPage({ children }: { children: ReactNode }) {
  return (
    <div className="calm">
      <span className="drift" style={{ top: '8%', left: '7%', animationDuration: '9s' }}>
        <UiIcon id="lorc/rune-stone" size={150} />
      </span>
      <span
        className="drift"
        style={{ bottom: '10%', right: '8%', animationDuration: '11s', animationDelay: '1.2s' }}
      >
        <UiIcon id="lorc/pine-tree" size={170} />
      </span>
      <span
        className="drift faint"
        style={{ top: '14%', right: '16%', animationDuration: '8s', animationDelay: '.6s' }}
      >
        <UiIcon id="lorc/mining" size={90} />
      </span>
      <span
        className="drift faint"
        style={{ bottom: '16%', left: '14%', animationDuration: '10s', animationDelay: '2s' }}
      >
        <UiIcon id="lorc/campfire" size={80} />
      </span>
      <div className="calm-brand">
        <div className="brand">ANAMNESIA</div>
        <div className="brand-sub">IDLE</div>
      </div>
      <div className="calm-card">{children}</div>
    </div>
  );
}

/**
 * Screen D's onboarding after the name is made: choose a god, and a last card that says what
 * the game does. The oath is sworn only on the final button, so Back works until then.
 */
export function Onboarding({
  heroName,
  nightHours = 12,
  onSwear,
}: {
  /** The name the register gave the hero. */
  heroName: string;
  /** How long the night is, in hours (12 unless the trader's lamp says otherwise). */
  nightHours?: number;
  onSwear: (god: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [god, setGod] = useState<string>(content.gods[0]?.id ?? '');
  const chosen = content.hasGod(god) ? content.god(god) : null;

  return (
    <CalmPage>
      <div className="dots">
        {[1, 2].map((n) => (
          <span key={n} className={n === step ? 'dot now' : n < step ? 'dot on' : 'dot'} />
        ))}
        <span className="step">STEP {String(step)} / 2</span>
      </div>

      {step === 1 && (
        <div key="god" className="fade">
          <h2>Choose your god</h2>
          <div className="lead">Devotion has perks. Pick who you kneel to.</div>
          <div className="god-list">
            {content.gods.map((g) => {
              const picked = g.id === god;
              return (
                <button
                  key={g.id}
                  type="button"
                  className={picked ? 'god-row picked' : 'god-row'}
                  onClick={() => setGod(g.id)}
                  aria-pressed={picked}
                >
                  <span className="god-tile">
                    <UiIcon id={g.icon} size={20} />
                  </span>
                  <span className="god-body">
                    <span className="god-name">
                      {g.name}
                      <span className="god-title">{g.title}</span>
                    </span>
                    <span className="god-sub">{g.description}</span>
                    <span className="god-boon">{g.boon}</span>
                    {g.perks.combat && (
                      <span className="god-fight">
                        in a fight · {g.perks.combat.name} · {boonText(g.perks.combat)} while favour
                        burns
                      </span>
                    )}
                  </span>
                  {picked && <span className="tag-active">SWORN</span>}
                </button>
              );
            })}
          </div>
          <div className="btn-row">
            <button
              className="btn solid grow"
              type="button"
              disabled={chosen === null}
              onClick={() => setStep(2)}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && chosen && (
        <div key="ready" className="fade centred">
          <span className="god-big">
            <UiIcon id={chosen.icon} size={30} />
          </span>
          <h2 style={{ marginTop: 16 }}>
            {heroName}, sworn to {chosen.name}
          </h2>
          <div className="lead tall">
            The hill keeps going when you close the tab.
            <br />
            Come back to loot, levels, and a smug feeling.
          </div>
          <div className="hint-list">
            <div className="hint-row">
              <UiIcon id="lorc/hourglass" size={15} className="gold" />
              Skills train offline, up to {String(nightHours)}h at a time
            </div>
            <div className="hint-row">
              <UiIcon id="delapouite/chest" size={15} className="gold" />
              Everything you gather lands in your bank
            </div>
            <div className="hint-row">
              <UiIcon id="delapouite/coins" size={15} className="gold" />
              Sell loot for gp · smith better tools
            </div>
          </div>
          <button
            className="btn solid"
            type="button"
            style={{ marginTop: 20 }}
            onClick={() => onSwear(chosen.id)}
          >
            Start the climb
          </button>
          <div className="link-row" style={{ marginTop: 12 }}>
            <button className="linkish" type="button" onClick={() => setStep(1)}>
              Back
            </button>
          </div>
        </div>
      )}
    </CalmPage>
  );
}

/** "This game only runs in one tab at a time." */
export function FollowerPage({
  snapshot,
  onTakeOver,
}: {
  snapshot: HostSnapshot;
  onTakeOver: () => void;
}) {
  const sim = snapshot.sim;
  const req = sim?.action.current?.request;
  const skill = req && sim ? skillOfRequest(req, simContext) : null;
  const status = sim
    ? skill
      ? `${content.skill(skill).name} · Lv ${String(skillView(sim, skill, simContext).level)} · ticking`
      : 'idle · ticking'
    : 'waiting for the other tab…';
  return (
    <CalmPage>
      <h2>Running in another tab</h2>
      <div className="lead">
        The hill is being climbed in another tab. Only one tab ticks and saves, so this one is
        standing still.
      </div>
      <div className="stat-block">
        <div className="stat-row">
          <span className="k">over there</span>
          <span className="v">{status}</span>
        </div>
        {sim && (
          <div className="stat-row">
            <span className="k">tick</span>
            <span className="v">{formatInt(sim.tick)}</span>
          </div>
        )}
      </div>
      <div className="form">
        <button className="btn solid" onClick={onTakeOver} disabled={snapshot.takeoverPending}>
          {snapshot.takeoverPending ? 'Taking over…' : 'Take over here'}
        </button>
      </div>
      <div className="note">
        The other tab will stop and mirror this one. Nothing is lost either way.
      </div>
    </CalmPage>
  );
}

export function CatchUpPage({ done, total }: { done: number; total: number }) {
  const frac = total > 0 ? done / total : 0;
  return (
    <CalmPage>
      <h2>Catching up</h2>
      <div className="lead">The hill kept going while you were away.</div>
      <div className="progress">
        <div className="bar" role="progressbar" aria-valuenow={Math.round(frac * 100)}>
          <div
            className="bar-fill"
            style={{ width: `${(frac * 100).toFixed(1)}%`, transition: 'none' }}
          />
          <span className="bar-text">
            {formatInt(done)} / {formatInt(total)} ticks
          </span>
        </div>
      </div>
    </CalmPage>
  );
}

export function HandingOverPage() {
  return (
    <CalmPage>
      <h2>Handing over</h2>
      <div className="lead">Another tab asked to take the game. Saving, then stepping back.</div>
    </CalmPage>
  );
}

export function StalePage({ onReload }: { onReload: () => void }) {
  return (
    <CalmPage>
      <h2>This tab stepped back</h2>
      <div className="lead">
        The save was taken up somewhere else — another browser, another device, or this tab coming
        back from the cache — so this one stopped rather than write over it. The hill is still being
        climbed there.
      </div>
      <div className="form">
        <button className="btn solid" onClick={onReload}>
          Play here instead
        </button>
      </div>
      <div className="note">Wherever it was playing will stop the same way.</div>
    </CalmPage>
  );
}

export function ErrorPage({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <CalmPage>
      <Label style={{ color: 'var(--gold)' }}>Save error</Label>
      <h2 style={{ marginTop: 8 }}>The save could not be loaded</h2>
      <div className="lead">{message}</div>
      <div className="note warn">
        Nothing has been overwritten. The stored save is exactly as it was; reloading will try
        again. If this keeps happening, export the save from settings before anything else.
      </div>
      <div className="form">
        <button className="btn solid" onClick={onReload}>
          Reload
        </button>
      </div>
    </CalmPage>
  );
}

export function BootingPage() {
  return (
    <CalmPage>
      <h2>Waking</h2>
      <div className="lead">Finding the save and checking which tab holds it.</div>
    </CalmPage>
  );
}
