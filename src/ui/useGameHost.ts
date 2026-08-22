import { useEffect, useState, useSyncExternalStore } from 'react';
import type { User } from '../api/protocol.ts';
import { simContext } from '../content/index.ts';
import { adoptLocalSave } from '../runtime/adopt.ts';
import { browserEnv, localSaveStore, serverSaveStore, type Env } from '../runtime/env.ts';
import { GameHost, type HostSnapshot } from '../runtime/game-host.ts';
import { reconcileWithContent } from '../sim/reconcile.ts';

export interface GameRuntime {
  env: Env;
  host: GameHost;
}

const BOOTING: HostSnapshot = {
  role: 'booting',
  tabId: '',
  leaderId: null,
  sim: null,
  wallMs: null,
  saveCounter: 0,
  lastSavedAtMs: null,
  catchUp: null,
  offline: null,
  takeoverPending: false,
  warning: null,
  commandError: null,
  saveProblem: null,
  error: null,
};

const noop = () => {
  /* no runtime yet */
};

/**
 * Owns the GameHost for this tab, for one name. The host is created inside the effect (not in
 * render or useMemo) because React StrictMode mounts, unmounts and remounts in development —
 * a host that has been stopped must not be restarted, so every mount gets a fresh one. Before
 * it starts, a save left in this browser from before there were names is offered to the
 * register (runtime/adopt.ts).
 */
export function useGameRuntime(user: User): {
  runtime: GameRuntime | null;
  snapshot: HostSnapshot;
} {
  const [runtime, setRuntime] = useState<GameRuntime | null>(null);
  useEffect(() => {
    let host: GameHost | null = null;
    let gone = false;
    const server = serverSaveStore();
    const boot = async () => {
      try {
        await adoptLocalSave(
          localSaveStore(),
          server,
          (sim) => reconcileWithContent(sim, simContext.content).sim,
        );
      } catch (e) {
        console.warn('the browser’s old save could not be offered to the register:', e);
      }
      if (gone) return;
      const env = browserEnv(server);
      host = new GameHost(env, { playerName: user.name, onStale: 'hold' });
      host.start();
      setRuntime({ env, host });
    };
    void boot();
    return () => {
      gone = true;
      host?.stop();
      setRuntime(null);
    };
  }, [user.id, user.name]);

  const snapshot = useSyncExternalStore(
    (cb) => (runtime ? runtime.host.subscribe(cb) : noop),
    () => (runtime ? runtime.host.getSnapshot() : BOOTING),
    () => BOOTING,
  );
  return { runtime, snapshot };
}
