/**
 * Screen D's card on the drifting backdrop — the calm full-page states: naming the hero on first
 * run, "running in another tab", the catch-up in progress, a stale tab, and a save error.
 * None of these show game panels: the point is one clear sentence and one button.
 */
import { useState, type ReactNode } from 'react';
import { content, simContext } from '../../content/index.ts';
import type { HostSnapshot } from '../../runtime/game-host.ts';
import { PlayerNameSchema } from '../../sim/commands.ts';
import { skillOfRequest } from '../../sim/actions.ts';
import { formatInt } from '../format.ts';
import { Label, UiIcon } from '../parts.tsx';
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
 * Screen D's onboarding: name the hero, choose a god, and a last card that says what the game
 * does. The name is written as soon as step 1 is done (a reload lands on step 2); the oath is
 * sworn only on the final button, so Back still works until then. An old save that has a name
 * but no god starts at step 2.
 */
export function Onboarding({
  name: savedName,
  onName,
  onSwear,
}: {
  /** The name already in the save, or null while the hero is still Nameless. */
  name: string | null;
  onName: (name: string) => void;
  onSwear: (god: string) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(savedName === null ? 1 : 2);
  const [name, setName] = useState(savedName ?? '');
  const [god, setGod] = useState<string>(content.gods[0]?.id ?? '');
  const parsed = PlayerNameSchema.safeParse(name);
  const letter = name.trim().slice(0, 1).toUpperCase() || '?';
  const chosen = content.hasGod(god) ? content.god(god) : null;
  const heroName = parsed.success ? parsed.data : (savedName ?? '');

  return (
    <CalmPage>
      <div className="dots">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n === step ? 'dot now' : n < step ? 'dot on' : 'dot'} />
        ))}
        <span className="step">STEP {String(step)} / 3</span>
      </div>

      {step === 1 && (
        <form
          key="name"
          className="fade"
          onSubmit={(e) => {
            e.preventDefault();
            if (!parsed.success) return;
            if (parsed.data !== savedName) onName(parsed.data);
            setStep(2);
          }}
        >
          <h2>Name your hero</h2>
          <div className="lead">This is what the hill will call you.</div>
          <div className="form">
            <div className="form-row">
              <span className="avatar big">{letter}</span>
              <input
                className="hero"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sisyphus"
                maxLength={16}
                autoFocus
                aria-label="Hero name"
              />
            </div>
          </div>
          <div className="note">3–16 characters. You can change it later in settings.</div>
          <button className="btn solid" type="submit" disabled={!parsed.success}>
            Continue
          </button>
        </form>
      )}

      {step === 2 && (
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
                  </span>
                  {picked && <span className="tag-active">SWORN</span>}
                </button>
              );
            })}
          </div>
          <div className="btn-row">
            <button className="btn quiet" type="button" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              className="btn solid grow"
              type="button"
              disabled={chosen === null}
              onClick={() => setStep(3)}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && chosen && (
        <div key="ready" className="fade centred">
          <span className="god-big">
            <UiIcon id={chosen.icon} size={30} />
          </span>
          <h2 style={{ marginTop: 16 }}>
            {heroName ? `${heroName}, sworn to ${chosen.name}` : `Sworn to ${chosen.name}`}
          </h2>
          <div className="lead tall">
            The hill keeps going when you close the tab.
            <br />
            Come back to loot, levels, and a smug feeling.
          </div>
          <div className="hint-list">
            <div className="hint-row">
              <UiIcon id="lorc/hourglass" size={15} className="gold" />
              Skills train offline, up to 12h at a time
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
            <button className="linkish" type="button" onClick={() => setStep(2)}>
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
        It was restored from the browser's cache after another tab had been writing the save. Reload
        to pick up where the game actually is.
      </div>
      <div className="form">
        <button className="btn solid" onClick={onReload}>
          Reload
        </button>
      </div>
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
