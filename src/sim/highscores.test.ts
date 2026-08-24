import { describe, expect, it } from 'vitest';
import { boardIds, heroWealth, standingsOf } from './highscores.ts';
import { addItem } from './items.ts';
import { createSimState, type SimState } from './save.ts';
import { fixtureContext as ctx } from './testing/fixture.ts';

const hero = (patch: Partial<SimState> = {}): SimState => ({
  ...createSimState(1),
  player: { name: 'Tester', god: null },
  ...patch,
});

describe('wealth', () => {
  it('is coins plus the bank at sale value plus everything worn', () => {
    let s = hero({ coins: 5 });
    s = {
      ...s,
      bank: addItem(s.bank, 'stone', 10),
      equipment: { ...s.equipment, pickaxe: 'pick' },
    };
    expect(heroWealth(s, ctx.content)).toBe(5 + 10 + 20);
  });

  it('counts nothing for an item the content no longer has', () => {
    const s = hero({ equipment: { ...hero().equipment, pickaxe: 'gone' } });
    expect(heroWealth(s, ctx.content)).toBe(0);
  });
});

describe('standings', () => {
  it('cover total, wealth and every skill in content order', () => {
    const s = standingsOf(hero({ coins: 150 }), ctx);
    expect(s.map((x) => x.board)).toEqual(boardIds(ctx.content));
    expect(s.map((x) => x.board)).toEqual([
      'total',
      'wealth',
      'ring',
      ...ctx.content.skills.map((x) => x.id),
    ]);
    expect(s[1]).toEqual({ board: 'wealth', level: null, score: 150, keys: [150, 0] });
    expect(s[2]).toEqual({ board: 'ring', level: null, score: 0, keys: [0, 0] });
    expect(s[3]).toEqual({ board: 'mining', level: 1, score: 0, keys: [0, 0] });
  });

  it('total level sums every skill, hitpoints included, with total xp as the second key', () => {
    const skills = ctx.content.skills.length;
    const fresh = standingsOf(hero(), ctx)[0]!;
    expect(fresh).toEqual({ board: 'total', level: skills, score: 0, keys: [skills, 0] });
    const xp = ctx.xp.xpForLevel(10);
    const up = standingsOf(hero({ skills: { mining: { xp }, fishing: { xp: 1 } } }), ctx)[0]!;
    expect(up.level).toBe(skills + 9);
    expect(up.score).toBe(xp + 1);
    expect(up.keys).toEqual([skills + 9, xp + 1]);
  });

  it('a skill board ranks by xp alone', () => {
    const s = standingsOf(hero({ skills: { mining: { xp: 500 } } }), ctx);
    expect(s.find((x) => x.board === 'mining')).toEqual({
      board: 'mining',
      level: ctx.xp.levelForXp(500),
      score: 500,
      keys: [500, 0],
    });
  });
});
