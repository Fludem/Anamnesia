import type { LockManagerLike, LockRequestOptions } from './env.ts';

export const LOCK_NAME = 'anamnesia:leader';

export type ElectionState = 'idle' | 'queued' | 'held';

export interface WarmableLockManager extends LockManagerLike {
  query(): Promise<unknown>;
}

/**
 * Work around a Chromium quirk (observed in Chrome 151): an AbortSignal aborted before the
 * page's LockManager connection is established is silently lost and the request stays pending
 * forever. Awaiting one `query()` first binds the connection; requests issued after that abort
 * correctly. As a bonus, a request cancelled before it was ever issued is simply never sent —
 * which is exactly what React StrictMode's mount → unmount → mount does to the first host.
 */
export function warmLockManager(locks: WarmableLockManager): LockManagerLike {
  let ready: Promise<void> | null = null;
  return {
    async request<T>(
      name: string,
      options: LockRequestOptions,
      callback: () => Promise<T>,
    ): Promise<T> {
      ready ??= locks.query().then(
        () => undefined,
        () => undefined,
      );
      await ready;
      if (options.signal?.aborted) throw new DOMException('lock request aborted', 'AbortError');
      return locks.request(name, options, callback);
    },
  };
}

/**
 * Leader election over the Web Locks API.
 *
 * `acquire()` queues a request and resolves when this instance holds the lock; the lock is
 * held until `release()` (or the page dies, which releases it automatically — no heartbeat).
 * `acquire({ steal: true })` takes the lock from the current holder, whose outer request
 * promise rejects with AbortError; we surface that as `onLost`. The holder's callback is never
 * interrupted by the browser, so callers must gate their own work on `isLeader`.
 */
export class LeaderElection {
  private state: ElectionState = 'idle';
  private holdResolve: (() => void) | null = null;
  private abort: AbortController | null = null;
  private lostListeners = new Set<() => void>();

  constructor(
    private readonly locks: LockManagerLike,
    private readonly name: string = LOCK_NAME,
  ) {}

  get isLeader(): boolean {
    return this.state === 'held';
  }
  get electionState(): ElectionState {
    return this.state;
  }

  onLost(cb: () => void): () => void {
    this.lostListeners.add(cb);
    return () => this.lostListeners.delete(cb);
  }

  /** Resolves once the lock is held. Rejects with AbortError if `cancel()` is called first. */
  acquire(options: { steal?: boolean } = {}): Promise<void> {
    if (this.state !== 'idle') {
      return Promise.reject(new Error(`acquire() called while ${this.state}`));
    }
    this.state = 'queued';
    const abort = new AbortController();
    this.abort = abort;

    return new Promise<void>((resolveAcquired, rejectAcquired) => {
      let granted = false;
      const held = new Promise<void>((resolve) => {
        this.holdResolve = resolve;
      });
      // The spec forbids combining `signal` with `steal`; a steal is granted immediately anyway.
      const request = this.locks.request(
        this.name,
        options.steal ? { steal: true } : { signal: abort.signal },
        () => {
          // The spec ignores an abort that arrives after the grant: the callback still runs.
          // If we were cancelled in that window, give the lock straight back.
          if (abort !== this.abort || abort.signal.aborted) return Promise.resolve();
          granted = true;
          this.state = 'held';
          resolveAcquired();
          return held;
        },
      );
      request.then(
        () => {
          // Normal release via release(), or a cancelled-after-grant request that released itself.
          this.reset(abort);
          if (!granted) rejectAcquired(new DOMException('lock request cancelled', 'AbortError'));
        },
        (e: unknown) => {
          const wasHeld = this.state === 'held';
          this.reset(abort);
          if (wasHeld) {
            // Stolen (AbortError) or the lock manager failed under us: either way we no longer lead.
            for (const cb of this.lostListeners) cb();
          } else {
            rejectAcquired(e instanceof Error ? e : new Error(String(e)));
          }
        },
      );
    });
  }

  /** Give the lock up voluntarily (e.g. on pagehide). No-op unless held. */
  release(): void {
    if (this.state !== 'held') return;
    this.holdResolve?.();
  }

  /** Leave the queue. No-op unless queued. */
  cancel(): void {
    if (this.state !== 'queued') return;
    this.abort?.abort();
  }

  private reset(abort: AbortController): void {
    if (abort !== this.abort) return;
    const resolve = this.holdResolve;
    this.state = 'idle';
    this.holdResolve = null;
    this.abort = null;
    resolve?.();
  }
}
