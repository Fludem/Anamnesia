import { describe, expect, it } from 'vitest';
import { GameChannel } from './channel.ts';
import { FakeChannelHub } from './testing/fake-channel.ts';
import { flushMicrotasks } from './testing/fake-scheduler.ts';

describe('GameChannel', () => {
  it('delivers typed messages to peers but not to itself, and drops malformed ones', async () => {
    const hub = new FakeChannelHub();
    const a = new GameChannel(hub.open('g'));
    const b = new GameChannel(hub.open('g'));
    const seenByA: string[] = [];
    const seenByB: string[] = [];
    a.on('hello', (m) => seenByA.push(m.tabId));
    b.on('hello', (m) => seenByB.push(m.tabId));

    a.post({ type: 'hello', tabId: 'A' });
    hub.open('g').postMessage({ type: 'hello' }); // missing tabId
    hub.open('g').postMessage('garbage');
    await flushMicrotasks();

    expect(seenByB).toEqual(['A']);
    expect(seenByA).toEqual([]);
  });

  it('unsubscribes and closes', async () => {
    const hub = new FakeChannelHub();
    const a = new GameChannel(hub.open('g'));
    const b = new GameChannel(hub.open('g'));
    let count = 0;
    const off = b.on('takeover-request', () => count++);
    a.post({ type: 'takeover-request', tabId: 'A' });
    await flushMicrotasks();
    off();
    a.post({ type: 'takeover-request', tabId: 'A' });
    await flushMicrotasks();
    expect(count).toBe(1);
    b.close();
    expect(() => b.post({ type: 'hello', tabId: 'B' })).toThrow();
  });
});
