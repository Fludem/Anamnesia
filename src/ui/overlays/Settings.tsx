/**
 * Settings: feel (how much the UI celebrates), rename, a save export, and — in dev builds — the
 * runtime inspection buttons from Phase 0.5 (simulate time away, reset).
 */
import { useState } from 'react';
import type { GameRuntime } from '../useGameHost.ts';
import { simContext } from '../../content/index.ts';
import type { HostSnapshot } from '../../runtime/game-host.ts';
import { PlayerNameSchema, type Command } from '../../sim/commands.ts';
import { godOf } from '../../sim/perks.ts';
import { nightHours } from '../derive-trader.ts';
import { formatInt } from '../format.ts';
import { Label, UiIcon } from '../parts.tsx';
import type { Juice } from '../theme/theme.ts';
import { Modal } from './Modal.tsx';
import { exportSave } from '../save-export.ts';

const HOUR = 3_600_000;
const FEELS: { id: Juice; label: string; hint: string }[] = [
  { id: 'deadpan', label: 'Deadpan', hint: 'No pops, no toasts, no level-up card.' },
  { id: 'quiet', label: 'Quiet', hint: 'Pops and the level-up card; no glow, no rare toast.' },
  { id: 'juicy', label: 'Juicy', hint: 'Everything. Rare drops announce themselves.' },
];

export function Settings({
  runtime,
  snapshot,
  juice,
  onJuice,
  onRename,
  dispatch,
  onClose,
}: {
  runtime: GameRuntime;
  snapshot: HostSnapshot;
  juice: Juice;
  onJuice: (j: Juice) => void;
  onRename: (name: string) => void;
  dispatch: (cmd: Command) => void;
  onClose: () => void;
}) {
  const sim = snapshot.sim;
  const god = sim ? godOf(sim, simContext) : null;
  const [name, setName] = useState(sim?.player.name ?? '');
  const parsed = PlayerNameSchema.safeParse(name);
  const leader = snapshot.role === 'leader';

  const simulateAway = async (hours: number) => {
    const { host } = runtime;
    const store = runtime.env.store;
    await host.saveNow();
    const stored = await store.load('main');
    if (!stored) return;
    const result = await store.write(
      'main',
      { ...stored, wallMs: stored.wallMs - hours * HOUR },
      stored.saveCounter,
    );
    if (result.ok) runtime.env.reloadPage();
  };
  const [confirmReset, setConfirmReset] = useState(false);
  const reset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    await runtime.env.store.clear('main');
    runtime.env.reloadPage();
  };

  return (
    <Modal onClose={onClose}>
      <Label>Settings</Label>

      <div className="settings-section">
        <Label>Feel</Label>
        <div className="settings-row">
          {FEELS.map((f) => (
            <button
              key={f.id}
              className={juice === f.id ? 'btn on' : 'btn'}
              onClick={() => onJuice(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="hint">{FEELS.find((f) => f.id === juice)?.hint}</div>
      </div>

      <div className="settings-section">
        <Label>Name</Label>
        <form
          className="settings-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed.success && sim && parsed.data !== sim.player.name) onRename(parsed.data);
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={16}
            style={{ flex: 1, minWidth: 0 }}
            aria-label="Hero name"
          />
          <button
            className="btn"
            type="submit"
            style={{ flex: 'none' }}
            disabled={!parsed.success || !sim || parsed.data === sim.player.name}
          >
            Rename
          </button>
        </form>
      </div>

      <div className="settings-section">
        <Label>Sworn to</Label>
        <div className="kv sworn-line">
          {god ? (
            <>
              <UiIcon id={god.icon} size={14} className="accent" />
              <span>
                {god.name} {god.title}
              </span>
              <span className="boon">{god.boon}</span>
            </>
          ) : (
            'nobody yet'
          )}
        </div>
        <div className="note-line">
          The hill does not take oaths back. The trader sells release from one.
        </div>
      </div>

      <div className="settings-section">
        <Label>First steps</Label>
        <div className="settings-row">
          <span className="kv" style={{ flex: 1 }}>
            {sim
              ? sim.tutorial.dismissed
                ? 'put away'
                : `${String(sim.tutorial.done.length)} done`
              : '—'}
          </span>
          {sim?.tutorial.dismissed ? (
            <button className="btn" onClick={() => dispatch({ type: 'tutorial:show' })}>
              Show again
            </button>
          ) : (
            <button className="btn" onClick={() => dispatch({ type: 'tutorial:dismiss' })}>
              Put away
            </button>
          )}
        </div>
      </div>

      <div className="settings-section">
        <Label>Save</Label>
        <div className="kv">
          this tab is <b>{snapshot.role}</b> · save #{formatInt(snapshot.saveCounter)}
          {snapshot.lastSavedAtMs !== null
            ? ` · saved ${new Date(snapshot.lastSavedAtMs).toLocaleTimeString()}`
            : ''}
          {sim ? ` · the night lasts ${String(nightHours(sim, simContext))} h` : ''}
        </div>
        {snapshot.warning && (
          <div className="kv" style={{ color: 'var(--gold)' }}>
            {snapshot.warning}
          </div>
        )}
        <div className="settings-row">
          <button className="btn" onClick={() => void runtime.host.saveNow()} disabled={!leader}>
            Save now
          </button>
          <button className="btn" onClick={() => void exportSave(runtime)}>
            Export JSON
          </button>
        </div>
      </div>

      {import.meta.env.DEV && (
        <div className="settings-section">
          <Label>Dev</Label>
          <div className="settings-row">
            <button className="btn" onClick={() => void simulateAway(13)} disabled={!leader}>
              13h away
            </button>
            <button className="btn" onClick={() => void simulateAway(0.5)} disabled={!leader}>
              30m away
            </button>
            <button className="btn gold" onClick={() => void reset()} disabled={!leader}>
              {confirmReset ? 'Really reset?' : 'Reset'}
            </button>
          </div>
          <div className="kv">
            tab <b>{snapshot.tabId.slice(0, 8)}</b> · tick <b>{sim ? formatInt(sim.tick) : '—'}</b>{' '}
            · rng <b>{sim ? sim.rng[0].toString(16) : '—'}</b>
          </div>
        </div>
      )}

      <div className="foot">
        <button className="btn quiet" style={{ flex: 1 }} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
