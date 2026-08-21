import type { LockManagerLike } from './env.ts';

export const LOCK_NAME = 'anamnesia:leader';

export type ElectionState = 'idle' | 'queued' | 'held';

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

  /** Resolves once the lock is held. Rejects only if `cancel()` is called while queued. */
  acquire(options: { steal?: boolean } = {}): Promise<void> {
    if (this.state !== 'idle') {
      return Promise.reject(new Error(`acquire() called while ${this.state}`));
    }
    this.state = 'queued';
    const abort = new AbortController();
    this.abort = abort;

    return new Promise<void>((resolveAcquired, rejectAcquired) => {
      const held = new Promise<void>((resolve) => {
        this.holdResolve = resolve;
      });
      const request = this.locks.request(
        this.name,
        { signal: abort.signal, ...(options.steal ? { steal: true } : {}) },
        () => {
          if (abort !== this.abort) return Promise.resolve(); // cancelled before grant
          this.state = 'held';
          resolveAcquired();
          return held;
        },
      );
      request.then(
        () => {
          // Normal release via release().
          this.reset(abort);
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
