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
import { BankPanel, MiningPanel, SkillsPanel } from './ui/GamePanels.tsx';
import './ui/shell.css';

/** Phase 1 shell: the runtime banners plus just enough UI to play mining. Real UI is Phase 4. */
export function App() {
  const { runtime, snapshot } = useGameRuntime();
  const { sim, role } = snapshot;
  const canAct = runtime !== null && (role === 'leader' || role === 'follower');
  const dispatch = canAct
    ? (cmd: Parameters<typeof runtime.host.dispatch>[0]) => runtime.host.dispatch(cmd)
    : null;

  return (
    <main className="shell">
      <h1>Anamnesia Idle</h1>
      <p className="subtitle">Phase 1 — mining, end to end. One tab ticks; the rest watch.</p>

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
      {snapshot.commandError && <p className="command-error">{snapshot.commandError}</p>}

      {sim && (
        <>
          <SkillsPanel sim={sim} />
          <MiningPanel sim={sim} dispatch={dispatch} />
          <BankPanel sim={sim} />
        </>
      )}

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
