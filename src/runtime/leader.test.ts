import { describe, expect, it } from 'vitest';
import { LeaderElection } from './leader.ts';
import { FakeLocks } from './testing/fake-locks.ts';
import { flushMicrotasks } from './testing/fake-scheduler.ts';

describe('LeaderElection', () => {
  it('grants the first caller and queues the second', async () => {
    const locks = new FakeLocks();
    const a = new LeaderElection(locks);
    const b = new LeaderElection(locks);
    await a.acquire();
    expect(a.isLeader).toBe(true);
    const bAcquired = b.acquire();
    await flushMicrotasks();
    expect(b.isLeader).toBe(false);
    expect(b.electionState).toBe('queued');
    expect(locks.queueLength('anamnesia:leader')).toBe(1);

    a.release();
    await bAcquired;
    expect(a.isLeader).toBe(false);
    expect(b.isLeader).toBe(true);
  });

  it('steal demotes the holder via onLost and leaves other waiters queued', async () => {
    const locks = new FakeLocks();
    const a = new LeaderElection(locks);
    const b = new LeaderElection(locks);
    const c = new LeaderElection(locks);
    await a.acquire();
    const bAcquired = b.acquire();
    await flushMicrotasks();

    let aLost = 0;
    a.onLost(() => aLost++);
    await c.acquire({ steal: true });
    await flushMicrotasks();

    expect(c.isLeader).toBe(true);
    expect(a.isLeader).toBe(false);
    expect(aLost).toBe(1);
    expect(b.electionState).toBe('queued');

    // When the thief releases, the original queue order still applies.
    c.release();
    await bAcquired;
    expect(b.isLeader).toBe(true);
  });

  it('a stolen-from instance can re-queue and be promoted later', async () => {
    const locks = new FakeLocks();
    const a = new LeaderElection(locks);
    const b = new LeaderElection(locks);
    await a.acquire();
    await b.acquire({ steal: true });
    await flushMicrotasks();
    expect(a.electionState).toBe('idle');
    const again = a.acquire();
    await flushMicrotasks();
    expect(a.electionState).toBe('queued');
    b.release();
    await again;
    expect(a.isLeader).toBe(true);
  });

  it('cancel leaves the queue with an AbortError', async () => {
    const locks = new FakeLocks();
    const a = new LeaderElection(locks);
    const b = new LeaderElection(locks);
    await a.acquire();
    const bAcquired = b.acquire();
    await flushMicrotasks();
    b.cancel();
    await expect(bAcquired).rejects.toMatchObject({ name: 'AbortError' });
    expect(b.electionState).toBe('idle');
    expect(locks.queueLength('anamnesia:leader')).toBe(0);
  });

  it('release is a no-op when not held and acquire twice is an error', async () => {
    const a = new LeaderElection(new FakeLocks());
    a.release();
    await a.acquire();
    await expect(a.acquire()).rejects.toThrow(/while held/);
  });
});
