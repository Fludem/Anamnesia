import { describe, expect, it } from 'vitest';
import { fixtureContext as ctx } from '../sim/testing/fixture.ts';
import { itemSources, recipeSources } from './derive-sources.ts';

const content = ctx.content;

describe('where a thing comes from', () => {
  it('names every bench that makes it, the easiest first', () => {
    const lines = itemSources('bar', ctx).filter((l) => l.kind === 'bench');
    expect(lines.map((l) => l.name)).toEqual(['Bar', 'Gated bar']);
    expect(lines[0]!.where).toBe('Smithing Lv 1');
    expect(lines[1]!.where).toBe('Smithing Lv 20');
    // A bench pays out; there is nothing to roll, so there are no odds to say.
    expect(lines[0]!.odds).toBeNull();
  });

  it('names every node, with the odds the sim rolls with', () => {
    const lines = itemSources('ore', ctx).filter((l) => l.kind === 'gather');
    expect(lines.map((l) => l.name).sort()).toEqual(['Flaky rock', 'Gated rock']);
    const flaky = lines.find((l) => l.name === 'Flaky rock')!;
    expect(flaky.where).toBe('Mining Lv 1');
    expect(flaky.odds).toBe('always');
    // The ore table gives one to three; the tip says the band.
    expect(flaky.qty).toBe('×1–3');
  });

  it('names the beast and its zone, and knows a guaranteed drop from a rolled one', () => {
    const bone = itemSources('bone', ctx).find((l) => l.kind === 'monster')!;
    expect(bone.name).toBe('Goat');
    expect(bone.where).toBe('The Slope · Lv 1');
    expect(bone.odds).toBe('always');
    const hide = itemSources('hide', ctx).find((l) => l.kind === 'monster')!;
    expect(hide.odds).toBe('always');
    expect(hide.chance).toBe(1);
  });

  it('counts a god’s extra table as a way to come by the thing', () => {
    const seed = itemSources('seed', ctx).find((l) => l.kind === 'god');
    expect(seed).toBeDefined();
    expect(seed!.name).toBe('Sworn to Green god');
    expect(seed!.where).toBe('Woodcutting, every cycle');
  });

  it('folds several tables on one source into the chance either lands', () => {
    // The flaky rock rolls its own table and the gem table; a gem is 1 in 10 of the second.
    const gem = itemSources('gem', ctx).find((l) => l.name === 'Flaky rock')!;
    expect(gem.chance).toBeCloseTo(0.1, 6);
    expect(gem.odds).toBe('10%');
  });

  it('puts the bench before the hill, and the likelier way before the rarer', () => {
    const kinds = itemSources('ore', ctx).map((l) => l.kind);
    expect(kinds).toEqual([...kinds].sort((a, b) => (a === b ? 0 : a === 'gather' ? -1 : 1)));
    const gems = itemSources('gem', ctx);
    for (let i = 1; i < gems.length; i++) {
      expect(gems[i - 1]!.chance).toBeGreaterThanOrEqual(gems[i]!.chance);
    }
  });

  it('says nothing it cannot say: an item nothing hands out has no sources', () => {
    expect(itemSources('no-such-item', ctx)).toEqual([]);
  });
});

describe('a recipe’s inputs', () => {
  it('groups every input with what the recipe eats and where it is found', () => {
    const groups = recipeSources(content.recipe('bar'), ctx);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.item.id).toBe('ore');
    expect(groups[0]!.qty).toBe(2);
    expect(groups[0]!.lines.length).toBeGreaterThan(0);
  });

  it('trims each input to the first few ways and counts the rest', () => {
    const [ore] = recipeSources(content.recipe('bar'), ctx, 1);
    expect(ore!.lines).toHaveLength(1);
    expect(ore!.more).toBe(itemSources('ore', ctx).length - 1);
  });
});
