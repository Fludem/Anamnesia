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

/** Screen D, step "Name your hero". */
export function Onboarding({ onName }: { onName: (name: string) => void }) {
  const [name, setName] = useState('');
  const parsed = PlayerNameSchema.safeParse(name);
  const letter = name.trim().slice(0, 1).toUpperCase() || '?';
  return (
    <CalmPage>
      <h2>Name your hero</h2>
      <div className="lead">This is what the hill will call you.</div>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.success) onName(parsed.data);
        }}
      >
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
        <div className="note">3–16 characters. You can change it later in settings.</div>
        <button className="btn solid" type="submit" disabled={!parsed.success}>
          Begin the climb
        </button>
      </form>
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
