import { useEffect, useState, useSyncExternalStore } from 'react';
import { browserEnv, type Env } from '../runtime/env.ts';
import { GameHost, type HostSnapshot } from '../runtime/game-host.ts';

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
  error: null,
};

const noop = () => {
  /* no runtime yet */
};

/**
 * Owns the GameHost for this tab. The host is created inside the effect (not in render or
 * useMemo) because React StrictMode mounts, unmounts and remounts in development — a host that
 * has been stopped must not be restarted, so every mount gets a fresh one.
 */
export function useGameRuntime(): { runtime: GameRuntime | null; snapshot: HostSnapshot } {
  const [runtime, setRuntime] = useState<GameRuntime | null>(null);
  useEffect(() => {
    const env = browserEnv();
    const host = new GameHost(env);
    host.start();
    setRuntime({ env, host });
    return () => {
      host.stop();
      setRuntime(null);
    };
  }, []);

  const snapshot = useSyncExternalStore(
    (cb) => (runtime ? runtime.host.subscribe(cb) : noop),
    () => (runtime ? runtime.host.getSnapshot() : BOOTING),
    () => BOOTING,
  );
  return { runtime, snapshot };
}
