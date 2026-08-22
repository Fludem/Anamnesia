/**
 * Every browser capability the runtime needs, as an injectable object.
 *
 * This is the ONLY file under src/runtime or src/sim allowed to touch `Date.now`, timers,
 * `navigator`, `indexedDB`, `BroadcastChannel`, `document`, `window` or `crypto` (enforced by
 * eslint.config.js). Tests pass fakes from src/runtime/testing.
 */
import { warmLockManager } from './leader.ts';
import { IndexedDbSaveStore, type SaveStore } from './store.ts';

export interface Clock {
  /** Milliseconds in the Date.now() domain. */
  now(): number;
}

/** The subset of the Web Locks `LockManager` we rely on. */
export interface LockRequestOptions {
  steal?: boolean;
  signal?: AbortSignal;
}
export interface LockManagerLike {
  request<T>(name: string, options: LockRequestOptions, callback: () => Promise<T>): Promise<T>;
}

/** The subset of BroadcastChannel we rely on. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  /** Register a listener; returns an unsubscribe function. */
  subscribe(listener: (data: unknown) => void): () => void;
  close(): void;
}

export interface Lifecycle {
  onHidden(cb: () => void): () => void;
  onPageHide(cb: () => void): () => void;
  onPageShow(cb: (persisted: boolean) => void): () => void;
  isHidden(): boolean;
}

export interface Scheduler {
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface Env {
  clock: Clock;
  /** `null` when Web Locks is unavailable (insecure context). The host then runs guard-only. */
  locks: LockManagerLike | null;
  openChannel(name: string): ChannelLike;
  store: SaveStore;
  lifecycle: Lifecycle;
  scheduler: Scheduler;
  /** Yield to the event loop between catch-up batches. Must not be throttled in hidden tabs. */
  yieldToEventLoop(): Promise<void>;
  reloadPage(): void;
  randomSeed(): number;
  /** Unique id for this tab/host instance. */
  tabId: string;
}

function browserYield(): Promise<void> {
  // scheduler.yield() where available; otherwise a MessageChannel hop. setTimeout(0) is NOT
  // used: Chrome throttles chained timers in hidden tabs to once a minute, which would turn a
  // 12-hour catch-up into hours of wall time.
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched && typeof sched.yield === 'function') return sched.yield();
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

/** `crypto.randomUUID` is secure-context only; `getRandomValues` works over plain http on a LAN. */
function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function browserEnv(): Env {
  const locks =
    typeof navigator !== 'undefined' && 'locks' in navigator
      ? warmLockManager(navigator.locks)
      : null;
  return {
    clock: { now: () => Date.now() },
    locks,
    openChannel: (name) => {
      const bc = new BroadcastChannel(name);
      return {
        postMessage: (m) => bc.postMessage(m),
        subscribe(listener) {
          const handler = (e: MessageEvent<unknown>) => listener(e.data);
          bc.addEventListener('message', handler);
          return () => bc.removeEventListener('message', handler);
        },
        close: () => bc.close(),
      };
    },
    store: new IndexedDbSaveStore(indexedDB),
    lifecycle: {
      onHidden(cb) {
        const handler = () => {
          if (document.visibilityState === 'hidden') cb();
        };
        document.addEventListener('visibilitychange', handler);
        return () => document.removeEventListener('visibilitychange', handler);
      },
      onPageHide(cb) {
        window.addEventListener('pagehide', cb);
        return () => window.removeEventListener('pagehide', cb);
      },
      onPageShow(cb) {
        const handler = (e: PageTransitionEvent) => cb(e.persisted);
        window.addEventListener('pageshow', handler);
        return () => window.removeEventListener('pageshow', handler);
      },
      isHidden: () => document.visibilityState === 'hidden',
    },
    scheduler: {
      setInterval: (cb, ms) => setInterval(cb, ms),
      clearInterval: (h) => clearInterval(h as number),
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as number),
    },
    yieldToEventLoop: browserYield,
    reloadPage: () => location.reload(),
    randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
    tabId: randomId(),
  };
}
