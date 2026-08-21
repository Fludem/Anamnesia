import { formatDuration, formatInt } from './ui/format.ts';
import { useGameRuntime } from './ui/useGameHost.ts';
import {
  CappedNotice,
  CatchUpProgress,
  ErrorBanner,
  FollowerBanner,
  StaleBanner,
  WarningBanner,
} from './ui/Banners.tsx';
import { DebugPanel } from './ui/DebugPanel.tsx';
import './ui/shell.css';

/** Phase 0.5 shell: proves single-writer discipline end to end. The game UI arrives in Phase 4. */
export function App() {
  const { runtime, snapshot } = useGameRuntime();
  const { sim, role } = snapshot;

  return (
    <main className="shell">
      <h1>Anamnesia Idle</h1>
      <p className="subtitle">Phase 0.5 — single-writer runtime. One tab ticks; the rest watch.</p>

      {snapshot.error && <ErrorBanner message={snapshot.error} />}
      {snapshot.warning && <WarningBanner message={snapshot.warning} />}
      {role === 'stale' && <StaleBanner />}
      {role === 'follower' && (
        <FollowerBanner snapshot={snapshot} onTakeOver={() => runtime?.host.takeOver()} />
      )}
      {snapshot.catchUp && (
        <CatchUpProgress done={snapshot.catchUp.done} total={snapshot.catchUp.total} />
      )}
      {snapshot.cappedNotice && (
        <CappedNotice
          notice={snapshot.cappedNotice}
          onDismiss={() => runtime?.host.dismissCappedNotice()}
        />
      )}

      <p className="tick">
        {sim ? formatInt(sim.tick) : '—'}
        <small>ticks{sim ? ` · ${formatDuration(sim.tick * 100)} of game time` : ''}</small>
      </p>

      {import.meta.env.DEV && runtime && (
        <DebugPanel
          host={runtime.host}
          snapshot={snapshot}
          store={runtime.env.store}
          reload={() => runtime.env.reloadPage()}
        />
      )}
    </main>
  );
}
