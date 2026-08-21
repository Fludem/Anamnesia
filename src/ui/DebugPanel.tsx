import type { GameHost, HostSnapshot } from '../runtime/game-host.ts';
import type { SaveStore } from '../runtime/store.ts';
import { formatInt } from './format.ts';

const HOUR = 3_600_000;

/**
 * Phase 0.5 inspection panel. Stays in dev builds only (App decides); the real UI is Phase 4.
 * "Simulate 13h away" rewinds the stored anchor and reloads so the cap path can be exercised
 * without waiting 13 hours — it writes through the guarded store like any other writer.
 */
export function DebugPanel({
  host,
  snapshot,
  store,
  reload,
}: {
  host: GameHost;
  snapshot: HostSnapshot;
  store: SaveStore;
  reload: () => void;
}) {
  const sim = snapshot.sim;
  const simulateAway = async (hours: number) => {
    await host.saveNow();
    const stored = await store.load('main');
    if (!stored) return;
    const result = await store.write(
      'main',
      { ...stored, wallMs: stored.wallMs - hours * HOUR },
      stored.saveCounter,
    );
    if (result.ok) reload();
  };
  const reset = async () => {
    await store.clear('main');
    reload();
  };

  return (
    <section className="panel">
      <h2>Runtime</h2>
      <dl className="kv">
        <dt>role</dt>
        <dd>
          <span className={`role ${snapshot.role}`}>{snapshot.role}</span>
        </dd>
        <dt>tab</dt>
        <dd>{snapshot.tabId}</dd>
        <dt>leader</dt>
        <dd>{snapshot.leaderId ?? '—'}</dd>
        <dt>tick</dt>
        <dd>{sim ? formatInt(sim.tick) : '—'}</dd>
        <dt>wall anchor</dt>
        <dd>{snapshot.wallMs === null ? '—' : new Date(snapshot.wallMs).toISOString()}</dd>
        <dt>saveCounter</dt>
        <dd>{snapshot.saveCounter}</dd>
        <dt>last saved</dt>
        <dd>
          {snapshot.lastSavedAtMs === null
            ? '—'
            : new Date(snapshot.lastSavedAtMs).toLocaleTimeString()}
        </dd>
        <dt>rng</dt>
        <dd>{sim ? sim.rng.map((w) => w.toString(16).padStart(8, '0')).join(' ') : '—'}</dd>
        <dt>draws / checksum</dt>
        <dd>
          {sim
            ? `${formatInt(sim.placeholder.draws)} / ${sim.placeholder.checksum.toString(16)}`
            : '—'}
        </dd>
      </dl>
      <div className="actions">
        <button onClick={() => void host.saveNow()} disabled={snapshot.role !== 'leader'}>
          Save now
        </button>
        <button onClick={() => void simulateAway(13)} disabled={snapshot.role !== 'leader'}>
          Simulate 13h away
        </button>
        <button onClick={() => void simulateAway(0.5)} disabled={snapshot.role !== 'leader'}>
          Simulate 30m away
        </button>
        <button onClick={() => void reset()} disabled={snapshot.role !== 'leader'}>
          Reset save
        </button>
      </div>
    </section>
  );
}
