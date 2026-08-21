import type { Env } from '../env.ts';
import { MemorySaveStore } from '../store.ts';
import { FakeChannelHub } from './fake-channel.ts';
import { FakeClock } from './fake-clock.ts';
import { FakeLifecycle } from './fake-lifecycle.ts';
import { FakeLocks } from './fake-locks.ts';
import { FakeScheduler, flushMicrotasks } from './fake-scheduler.ts';

/** Everything shared between simulated tabs: the lock manager, the channel hub, storage. */
export class FakeWorld {
  readonly locks = new FakeLocks();
  readonly hub = new FakeChannelHub();
  readonly store = new MemorySaveStore();
  readonly clock: FakeClock;
  private seed = 1;

  constructor(startMs = 1_700_000_000_000) {
    this.clock = new FakeClock(startMs);
  }

  /** A new simulated tab. Each has its own scheduler, lifecycle, reload spy and id. */
  tab(id: string, overrides: Partial<Env> = {}): FakeTab {
    return new FakeTab(this, id, overrides, () => this.seed++);
  }
}

export class FakeTab {
  readonly env: Env;
  readonly scheduler = new FakeScheduler();
  readonly lifecycle = new FakeLifecycle();
  reloads = 0;

  constructor(world: FakeWorld, id: string, overrides: Partial<Env>, nextSeed: () => number) {
    this.env = {
      clock: world.clock,
      locks: world.locks,
      openChannel: (name) => world.hub.open(name),
      store: world.store,
      lifecycle: this.lifecycle,
      scheduler: this.scheduler,
      yieldToEventLoop: () => Promise.resolve(),
      reloadPage: () => {
        this.reloads++;
      },
      randomSeed: nextSeed,
      tabId: id,
      ...overrides,
    };
  }

  /** Advance this tab's timers by `ms` (the shared clock must be advanced separately). */
  async runTimers(ms: number): Promise<void> {
    await this.scheduler.tick(ms);
    await flushMicrotasks();
  }
}

export { flushMicrotasks };
