import { describe, expect, it } from 'vitest';
import { beginAction } from './actions.ts';
import {
  BASE_BANK_SLOTS,
  bankCapacity,
  bankFull,
  bankSlotCost,
  bankWorth,
  roomFor,
} from './bank.ts';
import { applyCommand } from './commands.ts';
import { eventsOfType } from './events.ts';
import { addItem, countItem } from './items.ts';
import { createSimState, type SimState } from './save.ts';
import { stepTick } from './step.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';

const run = (s: SimState, ticks: number): SimState => {
  for (let i = 0; i < ticks; i++) s = stepTick(s, ctx);
  return s;
};

/** A state whose bank holds `n` distinct filler items (ids the content does not know). */
function filled(n: number, extra: [string, number][] = []): SimState {
  let s = createSimState(3);
  for (let i = 0; i < n; i++) s = { ...s, bank: addItem(s.bank, `filler-${String(i)}`, 1) };
  for (const [item, qty] of extra) s = { ...s, bank: addItem(s.bank, item, qty) };
  return s;
}

describe('bank capacity', () => {
  it('starts at the base and grows with bought slots', () => {
    const s = createSimState(1);
    expect(bankCapacity(s)).toBe(BASE_BANK_SLOTS);
    expect(bankCapacity({ ...s, bankSlotsBought: 4 })).toBe(BASE_BANK_SLOTS + 4);
    expect(bankFull(filled(BASE_BANK_SLOTS - 1))).toBe(false);
    expect(bankFull(filled(BASE_BANK_SLOTS))).toBe(true);
  });

  it("prices slots on the design's curve: 500, 590, 700, … rounded to 10 gp", () => {
    expect([0, 1, 2, 3, 10].map(bankSlotCost)).toEqual([500, 590, 700, 820, 2620]);
  });

  it('a full bank still has room for items it already holds', () => {
    const s = filled(BASE_BANK_SLOTS - 1, [['ore', 5]]);
    expect(roomFor(s, ['ore'])).toEqual({ ok: true });
    expect(roomFor(s, ['ore', 'gem'])).toEqual({ ok: false, item: 'gem' });
    expect(roomFor(filled(3), ['gem'])).toEqual({ ok: true });
  });

  it('worth sums value × qty over the bank', () => {
    const s = filled(0, [
      ['ore', 3],
      ['gem', 2],
    ]);
    expect(bankWorth(s, (id) => ctx.content.item(id).value)).toBe(3 * 5 + 2 * 50);
  });
});

describe('bank full stops actions instead of losing drops', () => {
  it('refuses to start gathering when a possible drop has no slot', () => {
    const s = filled(BASE_BANK_SLOTS);
    const r = applyCommand(
      s,
      { type: 'action:start', request: { kind: 'mining', rock: 'sure-rock', count: null } },
      ctx,
    );
    expect(r).toMatchObject({ ok: false, reason: 'bank is full (no slot for Stone)' });
  });

  it('keeps gathering into an existing stack, then stops with a logged reason once a new slot is needed', () => {
    // 29 fillers + stone = 30 = full, but stone stacks, so sure-rock keeps going.
    let s = filled(BASE_BANK_SLOTS - 1, [['stone', 1]]);
    s = beginAction(s, { kind: 'mining', rock: 'sure-rock', count: null }, ctx);
    s = run(s, 6);
    expect(countItem(s.bank, 'stone')).toBe(3);
    expect(s.action.current).not.toBeNull();

    // flaky-rock can drop ore / gem / rare-gem, none held: it stops after its first cycle
    // — the ore from that cycle lands (capacity is checked before a cycle, never after).
    let t = filled(BASE_BANK_SLOTS - 1, [['stone', 1]]);
    t = beginAction(t, { kind: 'mining', rock: 'flaky-rock', count: null }, ctx);
    expect(t.action.current).not.toBeNull();
    t = run(t, 4);
    expect(t.action.current).toBeNull();
    const stopped = eventsOfType(t, 'stopped');
    expect(stopped.length).toBe(1);
    expect(stopped[0]?.reason).toMatch(/^bank is full \(no slot for /);
  });

  it('crafting counts the slot an emptied input frees', () => {
    // 29 fillers + exactly 2 ore = full. Smelting takes both ore, so the bar fits.
    const s = filled(BASE_BANK_SLOTS - 1, [['ore', 2]]);
    const ok = applyCommand(
      s,
      { type: 'action:start', request: { kind: 'crafting', recipe: 'bar', count: null } },
      ctx,
    );
    expect(ok.ok).toBe(true);
    // With 3 ore the stack survives and the bar needs a slot that does not exist.
    const t = filled(BASE_BANK_SLOTS - 1, [['ore', 3]]);
    const no = applyCommand(
      t,
      { type: 'action:start', request: { kind: 'crafting', recipe: 'bar', count: null } },
      ctx,
    );
    expect(no).toMatchObject({ ok: false, reason: 'bank is full (no slot for Bar)' });
  });
});

describe('sell / buy slot / rename', () => {
  it('sell removes the items and pays value × qty in coins', () => {
    const s = filled(0, [['gem', 3]]);
    const r = applyCommand(s, { type: 'sell', item: 'gem', qty: 2 }, ctx);
    expect(r.ok).toBe(true);
    expect(r.state.coins).toBe(100);
    expect(countItem(r.state.bank, 'gem')).toBe(1);
    expect(applyCommand(r.state, { type: 'sell', item: 'gem', qty: 2 }, ctx)).toMatchObject({
      ok: false,
      reason: 'only 1 Gem in the bank',
    });
    expect(applyCommand(s, { type: 'sell', item: 'nope', qty: 1 }, ctx)).toMatchObject({
      ok: false,
    });
  });

  it('buying a slot charges the current price and raises capacity', () => {
    const s = { ...createSimState(1), coins: 1000 };
    const r = applyCommand(s, { type: 'bank:buy-slot' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.state.coins).toBe(500);
    expect(bankCapacity(r.state)).toBe(BASE_BANK_SLOTS + 1);
    expect(applyCommand(r.state, { type: 'bank:buy-slot' }, ctx)).toMatchObject({
      ok: false,
      reason: 'a bank slot costs 590 gp (you have 500)',
    });
  });

  it('rename sets the player name', () => {
    const r = applyCommand(createSimState(1), { type: 'player:rename', name: 'Sisyphus' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.state.player.name).toBe('Sisyphus');
  });
});
