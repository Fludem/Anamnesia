import { describe, expect, it } from 'vitest';
import { ContentDb } from '../sim/content/db.ts';
import type { SimContext } from '../sim/context.ts';
import { FIXTURE_PACK, fixtureContext as ctx } from '../sim/testing/fixture.ts';
import { runescapeCurve } from '../sim/xp.ts';
import { itemUses, itemUseTip } from './derive-uses.ts';

describe('what a thing is for', () => {
  it('names every bench that eats it, the soonest first, with what one turn takes', () => {
    const lines = itemUses('ore', ctx).filter((l) => l.kind === 'bench');
    expect(lines.map((l) => l.name)).toEqual(['Bar', 'Gated bar']);
    expect(lines[0]!.where).toBe('Smithing Lv 1');
    // Two ore a bar, one a gated bar: the count is the recipe's, not the bank's.
    expect(lines[0]!.qty).toBe('×2');
    expect(lines[1]!.qty).toBe('');
  });

  it('wears what the bench makes, and the skill where a bench makes nothing', () => {
    const bar = itemUses('ore', ctx).find((l) => l.name === 'Bar')!;
    expect(bar.icon).toBe(ctx.content.item('bar').icon);
    // Burning a log pays xp and leaves nothing; the fire's own icon stands in.
    const burn = itemUses('log', ctx).find((l) => l.name === 'Burn log')!;
    expect(burn.icon).toBe(ctx.content.skill('firemaking').icon);
  });

  it('says what it does in hand: worn, thrown, burnt, eaten, offered', () => {
    expect(itemUses('helm', ctx)[0]).toMatchObject({ kind: 'wear', where: 'the head slot' });
    expect(itemUses('pick', ctx)[0]).toMatchObject({
      kind: 'wear',
      name: 'Worn as a tool',
      where: 'Mining, the pickaxe slot',
    });
    expect(itemUses('javelin', ctx)[0]!.name).toBe('Thrown');
    expect(itemUses('mark', ctx)[0]!.name).toBe('Burnt as a mark');
    expect(itemUses('cooked-fish', ctx)[0]).toMatchObject({ kind: 'eat', where: 'heals 5' });
    expect(itemUses('sprig', ctx)[0]).toMatchObject({
      kind: 'offer',
      where: '5 favour the offering',
    });
  });

  it('knows the ferryman takes an obol', () => {
    expect(itemUses('obol', ctx)[0]).toMatchObject({
      kind: 'ferry',
      where: 'one settles a death',
    });
  });

  it('counts what is inside a thing that opens', () => {
    const pack = {
      ...FIXTURE_PACK,
      items: [
        ...FIXTURE_PACK.items,
        {
          id: 'nest',
          name: 'Nest',
          icon: 'lorc/rock',
          class: 'container',
          value: 0,
          opens: {
            entries: [
              { item: 'gem', weight: 1 },
              { item: 'rare-gem', weight: 1 },
            ],
          },
        },
      ],
    };
    const boxed: SimContext = { content: ContentDb.fromPack(pack), xp: runescapeCurve() };
    expect(itemUses('nest', boxed)[0]).toMatchObject({
      kind: 'open',
      where: '2 things inside',
    });
  });

  it('names every room the hall would take it for, tier by tier', () => {
    const gifts = itemUses('log', ctx).filter((l) => l.kind === 'gift');
    expect(gifts.map((l) => `${l.name} ${l.where} ${l.qty}`)).toEqual([
      'Hearth tier 1 ×10',
      'Pyre tier 1 ×3',
      'Hearth tier 2 ×20',
    ]);
  });

  it('puts what it does in hand before the benches, and the benches before the hall', () => {
    const groups = itemUseTip('log', ctx).map((s) => s.group);
    expect(groups).toEqual(['bench', 'hall']);
    const fish = itemUseTip('bar', ctx).map((s) => s.group);
    expect(fish).toEqual(['hall']);
    // A cooked fish is eaten and nothing else wants it.
    expect(itemUseTip('cooked-fish', ctx).map((s) => s.title)).toEqual(['In hand']);
  });

  it('trims the long lists and counts what it left off, but never what it does in hand', () => {
    const [bench] = itemUseTip('ore', ctx, 1);
    expect(bench!.lines).toHaveLength(1);
    expect(bench!.more).toBe(1);
    const hand = itemUseTip('helm', ctx, 1)[0]!;
    expect(hand.more).toBe(0);
  });

  it('says nothing it cannot say: a thing nothing wants has no uses', () => {
    expect(itemUses('burnt', ctx)).toEqual([]);
    expect(itemUseTip('burnt', ctx)).toEqual([]);
    expect(itemUses('no-such-thing', ctx)).toEqual([]);
  });
});
