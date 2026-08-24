import { describe, expect, it } from 'vitest';
import { bestXpPerHour, overreach, type Elapsed } from './ceiling.ts';
import { createSimState, type SimState } from './save.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';

const HOUR_MS = 3_600_000;
const HOUR_TICKS = 36_000;
const fresh = createSimState(3);
const at = (tick: number, over: Partial<SimState> = {}): SimState => ({ ...fresh, tick, ...over });
const mining = (xp: number) => ({ mining: { xp } });
/** A register that wrote an hour ago, for a name that has been on the hill a fortnight. */
const settled = (sinceWrite = HOUR_MS): Elapsed => ({
  sinceWrite,
  sinceName: 14 * 24 * HOUR_MS,
  tickBase: 0,
});

describe('what an hour on the hill can be worth', () => {
  it('lets the best hour there is through, and six times over, but not seven', () => {
    // The fixture's best rock pays 900,000 an hour from level 20 up; the ceiling allows six.
    expect(bestXpPerHour('mining', 20, ctx)).toBe(900_000);
    const before = at(0);
    expect(
      overreach(before, at(HOUR_TICKS, { skills: mining(5_400_000) }), settled(), ctx),
    ).toBeNull();
    expect(
      overreach(before, at(HOUR_TICKS, { skills: mining(5_400_001) }), settled(), ctx),
    ).toEqual({
      what: 'mining',
      gained: 5_400_001,
      ceiling: 5_400_000,
      windowMs: HOUR_MS,
    });
  });

  it('refuses xp with no ticks behind it, however little of it there is', () => {
    // The hijacked save request in its plainest form: the same hero, the same moment, more xp.
    // Nothing on the hill pays outside a tick, so one point of this is as impossible as a million.
    const standing = at(HOUR_TICKS, { skills: mining(4_000) });
    expect(overreach(standing, at(HOUR_TICKS, { skills: mining(4_001) }), settled(), ctx)).toEqual({
      what: 'mining',
      gained: 1,
      ceiling: 0,
      windowMs: 0,
    });
  });

  it('measures the window in ticks, so a night caught up in one save is honest', () => {
    // A tab claims the slot, catches up the four hours it was away, and saves: a moment later
    // by the register's clock, four hours later by the hill's. The clock must not be the judge.
    const blink: Elapsed = { sinceWrite: 200, sinceName: 30 * 24 * HOUR_MS, tickBase: 0 };
    const night = at(4 * HOUR_TICKS, { skills: mining(21_600_000) });
    expect(overreach(at(0), night, blink, ctx)).toBeNull();
  });

  it('will not let the tick count buy its own allowance', () => {
    // Ticks are the window, but never more of it than the register's own clock and the offline
    // cap together can account for — otherwise a save could claim a year and be believed.
    // An old name, so the years are its own to spend; the jump still buys only the four hours
    // the register waited and the cap allow, which is 21,600,000 of the best rock there is.
    const blink: Elapsed = { sinceWrite: 0, sinceName: 2 * 365 * 24 * HOUR_MS, tickBase: 0 };
    const year = at(24 * 365 * HOUR_TICKS, { skills: mining(900_000_000) });
    expect(overreach(at(0), year, blink, ctx)).toEqual({
      what: 'mining',
      gained: 900_000_000,
      ceiling: 21_600_000,
      windowMs: 4 * HOUR_MS,
    });
  });
});

describe('how long a name has been on the hill', () => {
  it('takes a first save on trust, and measures every one after it from there', () => {
    // A browser that played before there were names adopts what it has: forty hours on a name
    // made a minute ago (runtime/adopt.ts). Nothing can weigh that, so it is believed once and
    // the tick it came in on becomes the mark everything after is measured from.
    const adopting: Elapsed = { sinceWrite: 0, sinceName: 60_000, tickBase: 40 * HOUR_TICKS };
    const adopted = at(40 * HOUR_TICKS, { skills: mining(3_000_000) });
    expect(overreach(null, adopted, adopting, ctx)).toBeNull();
    // And never again: the next forty hours would have to have actually been lived.
    const again = at(80 * HOUR_TICKS, { skills: mining(3_000_000) });
    expect(overreach(adopted, again, adopting, ctx)).toMatchObject({ what: 'time' });
  });

  it('will not be played for longer than the name has existed, less the cap for a jumped clock', () => {
    const young: Elapsed = { sinceWrite: 0, sinceName: HOUR_MS, tickBase: 0 };
    expect(overreach(null, at(5 * HOUR_TICKS), young, ctx)).toBeNull();
    expect(overreach(null, at(5 * HOUR_TICKS + 1), young, ctx)).toMatchObject({
      what: 'time',
      ceiling: 5 * HOUR_MS,
    });
  });
});

describe('what the fight pays', () => {
  it('measures hitpoints and either style on the climb, not on a list of their own', () => {
    // Nothing in the content trains hitpoints directly. Weighed on its own methods it would
    // have no ceiling at all, and every point of it would read as a lie.
    const combat = { xp: ctx.xp.xpForLevel(20) };
    const before = at(0, { skills: { combat } });
    const rate = bestXpPerHour('hitpoints', 20, ctx);
    expect(rate).toBe(bestXpPerHour('combat', 20, ctx));
    const fair = at(HOUR_TICKS, { skills: { combat, hitpoints: { xp: rate * 6 } } });
    expect(overreach(before, fair, settled(), ctx)).toBeNull();
    const not = at(HOUR_TICKS, { skills: { combat, hitpoints: { xp: rate * 6 + 1 } } });
    expect(overreach(before, not, settled(), ctx)).toMatchObject({ what: 'hitpoints' });
  });
});

describe('what a save is worth', () => {
  it('lets one dearest thing land in no time at all, and no more than that', () => {
    const before = at(HOUR_TICKS);
    const lucky = at(HOUR_TICKS, { bank: [{ item: 'rare-gem', qty: 1 }] });
    expect(overreach(before, lucky, settled(), ctx)).toBeNull();
    const hoard = at(HOUR_TICKS, { bank: [{ item: 'rare-gem', qty: 2 }] });
    expect(overreach(before, hoard, settled(), ctx)).toEqual({
      what: 'wealth',
      gained: 1_000,
      ceiling: 500,
      windowMs: 0,
    });
  });

  it('says nothing about what a save gives up', () => {
    // Gear lost in the ring, goods on the hall's cart, coins staked at the wheel: all of it
    // makes these numbers smaller, and a smaller number is never a lie worth telling.
    const rich = at(HOUR_TICKS, { coins: 10_000, skills: mining(4_000) });
    const spent = at(2 * HOUR_TICKS, { coins: 0, skills: mining(4_000) });
    expect(overreach(rich, spent, settled(), ctx)).toBeNull();
  });
});
