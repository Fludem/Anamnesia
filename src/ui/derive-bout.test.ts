import { describe, expect, it } from 'vitest';
import type { BoutRow } from '../api/protocol.ts';
import { fightBout, type Fighter } from '../sim/bout.ts';
import {
  boutView,
  callBar,
  oddsAgainst,
  playable,
  replay,
  restLine,
  statsLine,
} from './derive-bout.ts';

const fighter = (over: Partial<Fighter> = {}): Fighter => ({
  name: 'A',
  attack: 20,
  strength: 20,
  defence: 20,
  swingTicks: 30,
  maxHp: 40,
  style: 'melee',
  ...over,
});

const row = (over: Partial<BoutRow> = {}): BoutRow => ({
  id: 1,
  caller: 'Caller',
  called: 'Called',
  callerFighter: fighter({ name: 'Caller' }),
  calledFighter: fighter({ name: 'Called' }),
  seed: 99,
  slot: 'head',
  prize: 'helm',
  stake: 'helm',
  winner: 'Caller',
  onPoints: false,
  agoMs: 1_000,
  yours: true,
  ...over,
});

describe('replay', () => {
  it("re-runs the register's own fight, not a retelling of it", () => {
    const r = row();
    expect(replay(r)).toEqual(fightBout(r.callerFighter, r.calledFighter, r.seed));
  });

  it('gives the same blows every time it is drawn', () => {
    const r = row();
    const first = replay(r);
    for (let i = 0; i < 50; i++) expect(replay(r)).toEqual(first);
  });
});

describe('boutView', () => {
  it('at the end, the loser is at nothing and the winner is not', () => {
    const r = row();
    const v = boutView(r, 'Caller');
    const loser = v.caller.won ? v.called : v.caller;
    const winner = v.caller.won ? v.caller : v.called;
    if (!v.onPoints) {
      expect(loser.hp).toBe(0);
      expect(winner.hp).toBeGreaterThan(0);
    }
  });

  it('at tick 0 nobody has been hit yet', () => {
    const v = boutView(row(), 'Caller', 0);
    expect(v.caller.hp).toBe(v.caller.maxHp);
    expect(v.called.hp).toBe(v.called.maxHp);
    expect(v.caller.splat).toBe(null);
  });

  it('hitpoints only ever fall as the replay runs on', () => {
    const r = row();
    const end = boutView(r, 'Caller').ticks;
    let last = [Infinity, Infinity];
    for (let at = 0; at <= end; at += 3) {
      const v = boutView(r, 'Caller', at);
      expect(v.caller.hp).toBeLessThanOrEqual(last[0]!);
      expect(v.called.hp).toBeLessThanOrEqual(last[1]!);
      last = [v.caller.hp, v.called.hp];
    }
  });

  it('past the end is the same as the end', () => {
    const r = row();
    const end = boutView(r, 'Caller').ticks;
    expect(boutView(r, 'Caller', end + 10_000)).toEqual(boutView(r, 'Caller', end));
  });

  it('knows whether the reader won, whichever side they were on', () => {
    const won = boutView(row({ winner: 'Caller' }), 'Caller');
    expect(won.youWon).toBe(true);
    const lost = boutView(row({ winner: 'Called' }), 'Caller');
    expect(lost.youWon).toBe(false);
    // And from the other side of the same bout.
    const theirs = boutView(row({ winner: 'Called', yours: false }), 'Called');
    expect(theirs.youWon).toBe(true);
  });

  it('a swing bar never leaves 0..1', () => {
    const r = row({ callerFighter: fighter({ name: 'C', swingTicks: 11 }) });
    for (let at = 0; at <= boutView(r, 'Caller').ticks; at += 1) {
      const v = boutView(r, 'Caller', at);
      for (const side of [v.caller, v.called]) {
        expect(side.swingFrac).toBeGreaterThanOrEqual(0);
        expect(side.swingFrac).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('statsLine', () => {
  it('writes the numbers the card shows', () => {
    expect(statsLine(fighter({ attack: 105, strength: 24, defence: 10, swingTicks: 30 }))).toBe(
      'atk 105 · str 24 · def 10 · max 13 · 3.0s',
    );
  });
});

describe('oddsAgainst', () => {
  it('is even between equals', () => {
    expect(oddsAgainst(fighter(), fighter())).toBeCloseTo(0.5, 5);
  });

  it('rises with your numbers and falls with theirs', () => {
    const even = oddsAgainst(fighter(), fighter());
    expect(oddsAgainst(fighter({ strength: 60 }), fighter())).toBeGreaterThan(even);
    expect(oddsAgainst(fighter(), fighter({ defence: 200 }))).toBeLessThan(even);
  });

  it('stays a fraction however lopsided it gets', () => {
    const out = oddsAgainst(fighter({ attack: 999, strength: 999 }), fighter({ maxHp: 1 }));
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThanOrEqual(1);
  });
});

describe('what the screen says it cannot do', () => {
  const ring = { in: true, restMs: 0, owed: 0, names: [], bouts: [] };

  it('lets a name in the ring with nothing owed call', () => {
    expect(callBar(ring)).toBe(null);
  });

  it('asks a name outside it to step in first', () => {
    expect(callBar({ ...ring, in: false })).toMatch(/step into the ring/);
  });

  it('wants what is owed before anything else', () => {
    expect(callBar({ ...ring, owed: 1_200 })).toMatch(/1,200 gp/);
  });

  it('counts a rest out in minutes, then hours', () => {
    expect(restLine(60_000)).toBe('1 min');
    expect(restLine(45 * 60_000)).toBe('45 min');
    expect(restLine(120 * 60_000)).toBe('2 h');
    expect(restLine(90 * 60_000)).toBe('1 h 30 min');
  });
});

describe('playable', () => {
  it('puts what can be played for first, dearest first', () => {
    const worn = (over: Record<string, unknown>) => ({
      slot: 'head',
      item: 'helm',
      value: 10,
      stake: 'helm',
      stakeValue: 10,
      ok: true,
      refusal: null,
      ...over,
    });
    const out = playable({
      name: 'X',
      fighter: fighter(),
      restMs: 0,
      worn: [
        worn({ value: 5 }),
        worn({ value: 50, ok: false, refusal: 'no' }),
        worn({ value: 30 }),
      ],
    });
    expect(out.map((w) => w.value)).toEqual([30, 5, 50]);
  });
});
