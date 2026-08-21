import type { LockManagerLike, LockRequestOptions } from '../env.ts';

interface Waiter {
  name: string;
  callback: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  signal: AbortSignal | undefined;
}

interface Held {
  name: string;
  reject: (e: unknown) => void;
  released: boolean;
}

function abortError(msg: string): DOMException {
  return new DOMException(msg, 'AbortError');
}

/**
 * In-memory Web Locks with the spec semantics we depend on:
 * - plain requests queue in order and are granted when the holder's callback settles;
 * - `steal: true` releases the current holder, rejects its outer request promise with
 *   AbortError, and grants the stealer immediately (prepended to the queue);
 * - aborting a queued request's signal removes it from the queue with AbortError.
 * The holder's callback is never interrupted — exactly like the real API.
 */
export class FakeLocks implements LockManagerLike {
  private held = new Map<string, Held>();
  private queues = new Map<string, Waiter[]>();

  request<T>(name: string, options: LockRequestOptions, callback: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        name,
        callback,
        resolve: resolve as (v: unknown) => void,
        reject,
        signal: options.signal,
      };
      if (options.steal && options.signal) {
        reject(
          new DOMException(
            "The 'signal' and 'steal' options cannot be used together.",
            'NotSupportedError',
          ),
        );
        return;
      }
      if (options.signal?.aborted) {
        reject(abortError('request aborted'));
        return;
      }
      if (options.steal) {
        const current = this.held.get(name);
        if (current && !current.released) {
          current.released = true;
          this.held.delete(name);
          current.reject(abortError('lock stolen'));
        }
        this.grant(waiter);
        return;
      }
      options.signal?.addEventListener('abort', () => {
        const q = this.queues.get(name) ?? [];
        const i = q.indexOf(waiter);
        if (i >= 0) {
          q.splice(i, 1);
          reject(abortError('request aborted'));
        }
      });
      if (this.held.has(name)) {
        const q = this.queues.get(name) ?? [];
        q.push(waiter);
        this.queues.set(name, q);
      } else {
        this.grant(waiter);
      }
    });
  }

  private grant(w: Waiter): void {
    const held: Held = { name: w.name, reject: w.reject, released: false };
    this.held.set(w.name, held);
    // Callback runs asynchronously, as in the real API.
    void Promise.resolve()
      .then(() => w.callback())
      .then(
        (v) => {
          if (!held.released) w.resolve(v);
          this.release(held);
        },
        (e: unknown) => {
          if (!held.released) w.reject(e);
          this.release(held);
        },
      );
  }

  private release(held: Held): void {
    // A stolen lock was already released by the thief; its callback settling later must not
    // touch the queue (the thief now holds the lock and will promote the next waiter).
    if (held.released) return;
    held.released = true;
    this.held.delete(held.name);
    const next = this.queues.get(held.name)?.shift();
    if (next) this.grant(next);
  }

  isHeld(name: string): boolean {
    return this.held.has(name);
  }
  queueLength(name: string): number {
    return this.queues.get(name)?.length ?? 0;
  }
}
