import { describe, expect, it } from 'vitest';
import { LeaderElection, warmLockManager } from './leader.ts';
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

  it('cancel after the grant is in flight releases the lock instead of holding it forever', async () => {
    // React StrictMode does exactly this: start a host, stop it synchronously, start another.
    const locks = new FakeLocks();
    const a = new LeaderElection(locks);
    const b = new LeaderElection(locks);
    const p = a.acquire();
    a.cancel(); // already granted internally; the real API ignores the abort and runs the callback
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await flushMicrotasks();
    expect(a.electionState).toBe('idle');
    expect(locks.isHeld('anamnesia:leader')).toBe(false);
    await b.acquire();
    expect(b.isLeader).toBe(true);
  });

  it('release is a no-op when not held and acquire twice is an error', async () => {
    const a = new LeaderElection(new FakeLocks());
    a.release();
    await a.acquire();
    await expect(a.acquire()).rejects.toThrow(/while held/);
  });
});

describe('warmLockManager', () => {
  it('issues the first request only after query() resolves, and never issues a cancelled one', async () => {
    const locks = new FakeLocks();
    const calls: string[] = [];
    const warmed = warmLockManager({
      query: () => {
        calls.push('query');
        return Promise.resolve([]);
      },
      request: (name, options, cb) => {
        calls.push('request');
        return locks.request(name, options, cb);
      },
    });
    // StrictMode shape: request, cancel synchronously, request again.
    const ac = new AbortController();
    const dead = warmed.request('l', { signal: ac.signal }, () => Promise.resolve('dead'));
    ac.abort();
    const live = warmed.request('l', {}, () => Promise.resolve('live'));
    await expect(dead).rejects.toMatchObject({ name: 'AbortError' });
    await expect(live).resolves.toBe('live');
    expect(calls).toEqual(['query', 'request']);
    expect(locks.isHeld('l')).toBe(false);
  });

  it('works end to end with LeaderElection', async () => {
    const locks = new FakeLocks();
    const warmed = warmLockManager({
      query: () => Promise.resolve([]),
      request: (n, o, cb) => locks.request(n, o, cb),
    });
    const a = new LeaderElection(warmed);
    const b = new LeaderElection(warmed);
    const pa = a.acquire();
    a.cancel();
    await expect(pa).rejects.toMatchObject({ name: 'AbortError' });
    await b.acquire();
    expect(b.isLeader).toBe(true);
    expect(a.electionState).toBe('idle');
  });
});
