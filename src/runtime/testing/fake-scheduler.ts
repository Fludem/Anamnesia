import type { Scheduler } from '../env.ts';

interface Timer {
  id: number;
  cb: () => void;
  ms: number;
  repeat: boolean;
  due: number;
}

/**
 * Deterministic timers. Time only moves when a test calls `tick(ms)`; timers due within that
 * window fire in order. Pair with FakeClock and advance both.
 */
export class FakeScheduler implements Scheduler {
  private timers = new Map<number, Timer>();
  private nextId = 1;
  private now = 0;

  setInterval(cb: () => void, ms: number): number {
    return this.add(cb, ms, true);
  }
  clearInterval(handle: unknown): void {
    this.timers.delete(handle as number);
  }
  setTimeout(cb: () => void, ms: number): number {
    return this.add(cb, ms, false);
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  private add(cb: () => void, ms: number, repeat: boolean): number {
    const id = this.nextId++;
    this.timers.set(id, { id, cb, ms, repeat, due: this.now + ms });
    return id;
  }

  get pending(): number {
    return this.timers.size;
  }

  /** Advance fake time by `ms`, firing due timers in due-time order. Async callbacks are awaited per microtask hop. */
  async tick(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.timers.values()]
        .filter((t) => t.due <= target)
        .sort((a, b) => a.due - b.due)[0];
      if (!next) break;
      this.now = next.due;
      if (next.repeat) next.due += next.ms;
      else this.timers.delete(next.id);
      next.cb();
      await flushMicrotasks();
    }
    this.now = target;
  }
}

/** Let all currently-queued promise continuations run. */
export async function flushMicrotasks(rounds = 1_000): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
