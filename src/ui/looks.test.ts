import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Looks } from '../api/protocol.ts';
import { emptyLook, type Look } from '../look/look.ts';
import { askLook, LOOK_TTL_MS, peekLook, putLook, resetLooks } from './looks.ts';

const LOOK: Look = { ...emptyLook(), bg: 3 };

describe('the looks this tab has seen', () => {
  let now = 1_000_000;
  let calls: { names: string[]; halls: string[] }[];
  let answer: (names: readonly string[], halls: readonly string[]) => Promise<Looks>;

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    answer = (names, halls) =>
      Promise.resolve({
        names: Object.fromEntries(names.map((n) => [n, n === 'Painted' ? LOOK : null])),
        halls: Object.fromEntries(halls.map((h) => [h, h === 'The Quiet Hall' ? LOOK : null])),
      });
    resetLooks({
      clock: () => now,
      fetcher: (names, halls) => {
        calls.push({ names: [...names], halls: [...halls] });
        return answer(names, halls);
      },
    });
  });
  afterEach(() => {
    resetLooks();
    vi.useRealTimers();
  });

  it('asks once for everything wanted in the same moment, by name and by hall', async () => {
    askLook('name', 'Painted');
    askLook('name', 'Plain');
    askLook('name', 'painted'); // the same name, another case
    askLook('hall', 'The Quiet Hall');
    expect(peekLook('name', 'Painted')).toBeUndefined();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([{ names: ['Painted', 'Plain'], halls: ['The Quiet Hall'] }]);
    expect(peekLook('name', 'Painted')).toEqual(LOOK);
    expect(peekLook('name', 'PAINTED')).toEqual(LOOK);
    expect(peekLook('name', 'Plain')).toBeNull();
    expect(peekLook('hall', 'The Quiet Hall')).toEqual(LOOK);
    // Fresh: asking again costs nothing.
    askLook('name', 'Painted');
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
  });

  it('asks again once a look is old, showing the old one meanwhile', async () => {
    askLook('name', 'Painted');
    await vi.runAllTimersAsync();
    now += LOOK_TTL_MS + 1;
    askLook('name', 'Painted');
    expect(peekLook('name', 'Painted')).toEqual(LOOK);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(2);
  });

  it('keeps what it knew when the register refuses, and waits before asking again', async () => {
    askLook('name', 'Painted');
    await vi.runAllTimersAsync();
    answer = () => Promise.reject(new Error('down'));
    now += LOOK_TTL_MS + 1;
    askLook('name', 'Painted');
    askLook('name', 'Plain');
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(2);
    expect(peekLook('name', 'Painted')).toEqual(LOOK);
    expect(peekLook('name', 'Plain')).toBeUndefined();
    askLook('name', 'Plain');
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(2);
    now += 31_000;
    askLook('name', 'Plain');
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(3);
  });

  it('shows a look painted here at once', async () => {
    putLook('name', 'Me', LOOK);
    expect(peekLook('name', 'Me')).toEqual(LOOK);
    askLook('name', 'Me');
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(0);
    putLook('name', 'Me', null);
    expect(peekLook('name', 'Me')).toBeNull();
  });
});
