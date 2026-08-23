import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands.ts';
import { eventsOfType } from './events.ts';
import { createSimState, type SimState } from './save.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';
import {
  DOUBLE_ZERO,
  MAX_PENDING_BUY_INS,
  POCKETS,
  RED,
  applyWheelSync,
  buyIn,
  isSpot,
  payout,
  pocketColour,
  roundAt,
  spotLabel,
  spotOdds,
  spotWins,
  type Spot,
} from './wheel.ts';

const rich = (coins: number, extra: Partial<SimState> = {}): SimState => ({
  ...createSimState(1),
  coins,
  ...extra,
});

describe('buying in', () => {
  it('takes the coins onto the cart, numbered from one, and logs it', () => {
    const r = applyCommand(rich(5000), { type: 'wheel:buy-in', coins: 1200 }, ctx);
    expect(r.ok).toBe(true);
    expect(r.state.coins).toBe(3800);
    expect(r.state.wheel).toEqual({ cart: [{ id: 1, coins: 1200 }], bought: 1, paidThrough: 0 });
    expect(r.state.stats.boughtIn).toBe(1200);
    expect(eventsOfType(r.state, 'bought-in')).toEqual([
      { type: 'bought-in', tick: 0, coins: 1200 },
    ]);
    const again = buyIn(r.state, 800);
    expect(again.ok && again.state.wheel.cart.map((b) => b.id)).toEqual([1, 2]);
    expect(again.ok && again.state.wheel.bought).toBe(2);
  });

  it('refuses more than the purse, less than one, and a full cart — leaving the state as it was', () => {
    const s = rich(100);
    for (const coins of [101, 0, -5, 1.5]) {
      const r = buyIn(s, coins);
      expect(r.ok).toBe(false);
    }
    const viaCommand = applyCommand(s, { type: 'wheel:buy-in', coins: 101 }, ctx);
    expect(viaCommand.ok).toBe(false);
    expect(viaCommand.state).toBe(s);
    let full = rich(1_000_000);
    for (let i = 0; i < MAX_PENDING_BUY_INS; i++) {
      const r = buyIn(full, 1);
      if (!r.ok) throw new Error(r.reason);
      full = r.state;
    }
    const over = buyIn(full, 1);
    expect(over.ok).toBe(false);
    expect(!over.ok && over.reason).toMatch(/not counted/);
  });

  it('numbers the next buy-in past whatever the register already knows', () => {
    const s = rich(10, { wheel: { cart: [], bought: 7, paidThrough: 0 } });
    const r = buyIn(s, 1);
    expect(r.ok && r.state.wheel.cart[0]?.id).toBe(8);
  });
});

describe('the register answering', () => {
  const carted = (): SimState =>
    rich(0, {
      wheel: {
        cart: [
          { id: 1, coins: 50 },
          { id: 2, coins: 70 },
        ],
        bought: 2,
        paidThrough: 0,
      },
    });

  it('clears only the buy-ins it took, and keeps the rest on the cart', () => {
    const s = applyWheelSync(carted(), { took: [1], paid: [], purse: 50, bought: 2 });
    expect(s.wheel.cart).toEqual([{ id: 2, coins: 70 }]);
    expect(s.coins).toBe(0);
  });

  it('brings payouts into the purse once, however often they are repeated', () => {
    const once = applyWheelSync(carted(), {
      took: [1, 2],
      paid: [
        { seq: 1, coins: 300 },
        { seq: 2, coins: 40 },
      ],
      purse: 0,
      bought: 2,
    });
    expect(once.coins).toBe(340);
    expect(once.wheel).toEqual({ cart: [], bought: 2, paidThrough: 2 });
    expect(once.stats.cashedOut).toBe(340);
    expect(eventsOfType(once, 'cashed-out').map((e) => e.coins)).toEqual([300, 40]);
    const repeated = applyWheelSync(once, {
      took: [1, 2],
      paid: [
        { seq: 1, coins: 300 },
        { seq: 2, coins: 40 },
      ],
      purse: 0,
      bought: 2,
    });
    expect(repeated).toBe(once);
    const newer = applyWheelSync(once, {
      took: [],
      paid: [{ seq: 3, coins: 5 }],
      purse: 0,
      bought: 2,
    });
    expect(newer.coins).toBe(345);
    expect(newer.wheel.paidThrough).toBe(3);
  });

  it('never lets the buy-in count fall behind the register', () => {
    const s = applyWheelSync(rich(0), { took: [], paid: [], purse: 0, bought: 9 });
    expect(s.wheel.bought).toBe(9);
    expect(applyWheelSync(s, { took: [], paid: [], purse: 0, bought: 4 })).toBe(s);
  });

  it('returns the very same state when there is nothing to do', () => {
    const s = carted();
    expect(applyWheelSync(s, { took: [], paid: [], purse: 120, bought: 2 })).toBe(s);
    expect(applyWheelSync(s, { took: [9], paid: [], purse: 120, bought: 1 })).toBe(s);
  });
});

describe('the table', () => {
  const outside: Spot[] = ['red', 'black', 'odd', 'even', 'low', 'high'];
  const thirds: Spot[] = ['dozen:1', 'dozen:2', 'dozen:3', 'column:1', 'column:2', 'column:3'];
  const straights: Spot[] = Array.from({ length: POCKETS }, (_, i) => `straight:${String(i)}`);

  it('knows its spots', () => {
    for (const s of [...outside, ...thirds, ...straights]) expect(isSpot(s)).toBe(true);
    for (const s of ['straight:38', 'straight:-1', 'dozen:4', 'column:0', 'green', '']) {
      expect(isSpot(s)).toBe(false);
    }
    expect(spotLabel('straight:37')).toBe('00');
    expect(spotLabel('straight:0')).toBe('0');
    expect(spotLabel('dozen:2')).toBe('2nd 12');
    expect(spotLabel('column:3')).toBe('3rd column');
    expect(spotLabel('low')).toBe('1 to 18');
  });

  it('has eighteen reds, eighteen blacks and two house pockets', () => {
    const colours = Array.from({ length: POCKETS }, (_, p) => pocketColour(p));
    expect(colours.filter((c) => c === 'red')).toHaveLength(18);
    expect(colours.filter((c) => c === 'black')).toHaveLength(18);
    expect(colours.filter((c) => c === 'house')).toHaveLength(2);
    expect(RED.has(1) && RED.has(36) && !RED.has(2) && !RED.has(10)).toBe(true);
  });

  it('the house pockets beat every bet but their own number', () => {
    for (const pocket of [0, DOUBLE_ZERO]) {
      for (const s of [...outside, ...thirds]) expect(spotWins(s, pocket)).toBe(false);
      expect(spotWins(`straight:${String(pocket)}`, pocket)).toBe(true);
    }
  });

  it('pays each spot its odds, and every spot the same edge: two pockets in thirty-eight', () => {
    const all: Spot[] = [...outside, ...thirds, ...straights];
    for (const spot of all) {
      let returned = 0;
      for (let pocket = 0; pocket < POCKETS; pocket++) returned += payout(38, spot, pocket);
      // Stake 38 on every pocket in turn: 36 × 38 comes back, whatever the spot.
      expect(returned).toBe(36 * 38);
    }
    expect(spotOdds('straight:5')).toBe(35);
    expect(spotOdds('dozen:1')).toBe(2);
    expect(spotOdds('red')).toBe(1);
    expect(payout(10, 'red', 1)).toBe(20);
    expect(payout(10, 'red', 2)).toBe(0);
    expect(payout(10, 'column:2', 5)).toBe(30);
    expect(payout(10, 'straight:17', 17)).toBe(360);
  });

  it('knows where the thirds and columns lie', () => {
    expect([1, 12].every((p) => spotWins('dozen:1', p))).toBe(true);
    expect([13, 24].every((p) => spotWins('dozen:2', p))).toBe(true);
    expect([25, 36].every((p) => spotWins('dozen:3', p))).toBe(true);
    expect([1, 4, 34].every((p) => spotWins('column:1', p))).toBe(true);
    expect([2, 5, 35].every((p) => spotWins('column:2', p))).toBe(true);
    expect([3, 6, 36].every((p) => spotWins('column:3', p))).toBe(true);
    expect(spotWins('low', 18) && spotWins('high', 19) && !spotWins('low', 19)).toBe(true);
  });

  it('rounds are thirty seconds of the clock, bets for twenty-four', () => {
    const r = roundAt(90_500);
    expect(r).toEqual({ id: 3, opensAt: 90_000, closesAt: 114_000, endsAt: 120_000 });
  });
});
