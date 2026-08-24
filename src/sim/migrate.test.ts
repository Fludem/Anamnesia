import { describe, expect, it } from 'vitest';
import { migrateSave, SaveLoadError, type MigrationTable } from './migrate.ts';
import { createNewSave, CURRENT_SAVE_VERSION, emptyEquipment } from './save.ts';

const fresh = () => createNewSave({ seed: 1, nowMs: 1_000, writerId: 'tab-a' });

/** A real Phase 0.5 record as IndexedDB held it: placeholder sim, version 1. */
const V1_RECORD = {
  version: 1,
  saveCounter: 17,
  writerId: 'old-tab',
  wallMs: 1_787_351_000_000,
  sim: {
    tick: 432_010,
    rng: [3681621431, 4250209148, 940641817, 1738069921],
    placeholder: { draws: 432_010, checksum: 0x1234abcd },
  },
};

describe('migrateSave', () => {
  it('passes a current-version save through unchanged', () => {
    const save = fresh();
    const raw: unknown = JSON.parse(JSON.stringify(save));
    expect(migrateSave(raw)).toEqual(save);
  });

  it('applies a chain of migration steps in order and stamps the version', () => {
    const applied: number[] = [];
    const migrations: MigrationTable = {
      0: (r) => {
        applied.push(0);
        return { ...r, writerId: 'migrated-from-v0' };
      },
      1: (r) => {
        applied.push(1);
        return r;
      },
      2: (r) => {
        applied.push(2);
        return r;
      },
      3: (r) => {
        applied.push(3);
        return r;
      },
      4: (r) => {
        applied.push(4);
        return r;
      },
      5: (r) => {
        applied.push(5);
        return r;
      },
      6: (r) => {
        applied.push(6);
        return r;
      },
      7: (r) => {
        applied.push(7);
        return r;
      },
      8: (r) => {
        applied.push(8);
        return r;
      },
      9: (r) => {
        applied.push(9);
        return r;
      },
      10: (r) => {
        applied.push(10);
        return r;
      },
      11: (r) => {
        applied.push(11);
        return r;
      },
      12: (r) => {
        applied.push(12);
        return r;
      },
    };
    const v0 = { ...fresh(), version: 0, writerId: undefined };
    const out = migrateSave(v0, migrations, CURRENT_SAVE_VERSION);
    expect(applied).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.writerId).toBe('migrated-from-v0');
  });

  it('migrates a real v1 (placeholder sim) record forward, keeping tick, rng and the envelope', () => {
    const out = migrateSave(JSON.parse(JSON.stringify(V1_RECORD)));
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.saveCounter).toBe(17);
    expect(out.writerId).toBe('old-tab');
    expect(out.wallMs).toBe(V1_RECORD.wallMs);
    expect(out.sim).toEqual({
      tick: 432_010,
      rng: V1_RECORD.sim.rng,
      player: { name: 'Nameless', god: null },
      skills: {},
      inventory: [],
      equipment: emptyEquipment(),
      bank: [],
      bankSlotsBought: 0,
      coins: 0,
      action: { current: null, queue: [] },
      log: [],
      stats: {
        actions: {},
        items: {},
        sold: 0,
        kills: {},
        deaths: 0,
        offered: 0,
        thrown: 0,
        cast: 0,
        spent: 0,
        ferried: 0,
        given: 0,
        boughtIn: 0,
        cashedOut: 0,
      },
      upgrades: {},
      hall: { id: null, rooms: {}, gifts: [], given: 0 },
      wheel: { cart: [], bought: 0, paidThrough: 0 },
      records: { fish: {}, trophies: [] },
      tutorial: { done: [], dismissed: false },
      combat: {
        hp: 10,
        food: null,
        eatAt: 0.25,
        offering: null,
        favour: 0,
        ferryman: true,
        fight: null,
      },
    });
    expect('placeholder' in out.sim).toBe(false);
  });

  it('migrates a v2 record to v3 by adding the tool slots and keeping equipped items', () => {
    const v2 = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    const sim = v2['sim'] as Record<string, unknown>;
    const equipment = Object.fromEntries(
      Object.entries(sim['equipment'] as Record<string, null>).filter(
        ([slot]) => slot !== 'pickaxe' && slot !== 'axe',
      ),
    );
    v2['version'] = 2;
    sim['equipment'] = { ...equipment, weapon: 'copper-sword' };
    const out = migrateSave(v2);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.sim.equipment).toEqual({ ...emptyEquipment(), weapon: 'copper-sword' });
  });

  it('migrates a v3 record to v4 by adding coins, bought slots and an empty log', () => {
    const v3 = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    const sim = v3['sim'] as Record<string, unknown>;
    delete sim['coins'];
    delete sim['bankSlotsBought'];
    delete sim['log'];
    delete sim['stats'];
    v3['version'] = 3;
    sim['bank'] = [{ item: 'copper-ore', qty: 3 }];
    const out = migrateSave(v3);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.sim.coins).toBe(0);
    expect(out.sim.bankSlotsBought).toBe(0);
    expect(out.sim.log).toEqual([]);
    expect(out.sim.stats).toEqual({
      actions: {},
      items: {},
      sold: 0,
      kills: {},
      deaths: 0,
      offered: 0,
      thrown: 0,
      cast: 0,
      spent: 0,
      ferried: 0,
      given: 0,
      boughtIn: 0,
      cashedOut: 0,
    });
    expect(out.sim.bank).toEqual([{ item: 'copper-ore', qty: 3 }]);
  });

  it('migrates a v4 record to v5: rod slot, unsworn god, counters, first steps kept open', () => {
    const v4 = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    const sim = v4['sim'] as Record<string, unknown>;
    v4['version'] = 4;
    sim['player'] = { name: 'Elpis' };
    sim['stats'] = { actions: { mining: 12 } };
    sim['log'] = [
      { type: 'stopped', tick: 3, reason: 'bank is full' },
      { type: 'level', tick: 4, skill: 'mining', from: 1, to: 2 },
    ];
    delete sim['tutorial'];
    const equipment = sim['equipment'] as Record<string, unknown>;
    delete equipment['rod'];
    equipment['pickaxe'] = 'copper-pick';
    const out = migrateSave(v4);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.sim.player).toEqual({ name: 'Elpis', god: null });
    expect(out.sim.equipment).toEqual({ ...emptyEquipment(), pickaxe: 'copper-pick' });
    expect(out.sim.stats).toEqual({
      actions: { mining: 12 },
      items: {},
      sold: 0,
      kills: {},
      deaths: 0,
      offered: 0,
      thrown: 0,
      cast: 0,
      spent: 0,
      ferried: 0,
      given: 0,
      boughtIn: 0,
      cashedOut: 0,
    });
    expect(out.sim.tutorial).toEqual({ done: [], dismissed: false });
    // A v4 stop has no skill, so it is dropped; everything else in the log is kept.
    expect(out.sim.log).toEqual([{ type: 'level', tick: 4, skill: 'mining', from: 1, to: 2 }]);
  });

  it('migrates a v5 record to v6: full hitpoints, no food, kill counters', () => {
    const v5 = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    const sim = v5['sim'] as Record<string, unknown>;
    v5['version'] = 5;
    sim['stats'] = { actions: { mining: 3 }, items: { 'copper-ore': 3 }, sold: 1 };
    delete sim['combat'];
    const out = migrateSave(v5);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.sim.stats).toEqual({
      actions: { mining: 3 },
      items: { 'copper-ore': 3 },
      sold: 1,
      kills: {},
      deaths: 0,
      offered: 0,
      thrown: 0,
      cast: 0,
      spent: 0,
      ferried: 0,
      given: 0,
      boughtIn: 0,
      cashedOut: 0,
    });
    expect(out.sim.combat).toEqual({
      hp: 10,
      food: null,
      eatAt: 0.25,
      offering: null,
      favour: 0,
      ferryman: true,
      fight: null,
    });
  });

  it('migrates a v6 record to v7: no offering, no favour, nothing burnt; the fight survives', () => {
    const v6 = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    const sim = v6['sim'] as Record<string, unknown>;
    v6['version'] = 6;
    sim['stats'] = { actions: {}, items: {}, sold: 0, kills: { adder: 2 }, deaths: 1 };
    sim['combat'] = { hp: 4, food: 'minnow', eatAt: 0.5, fight: null };
    const out = migrateSave(v6);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.sim.stats.offered).toBe(0);
    expect(out.sim.stats.kills).toEqual({ adder: 2 });
    expect(out.sim.combat).toEqual({
      hp: 4,
      food: 'minnow',
      eatAt: 0.5,
      offering: null,
      favour: 0,
      ferryman: true,
      fight: null,
    });
  });

  it('migrates a v7 record to v8: nothing thrown; the rest is kept', () => {
    const v7 = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    const sim = v7['sim'] as Record<string, unknown>;
    v7['version'] = 7;
    sim['stats'] = { actions: {}, items: {}, sold: 0, kills: { adder: 2 }, deaths: 1, offered: 3 };
    const out = migrateSave(v7);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.sim.stats).toEqual({
      actions: {},
      items: {},
      sold: 0,
      kills: { adder: 2 },
      deaths: 1,
      offered: 3,
      thrown: 0,
      cast: 0,
      spent: 0,
      ferried: 0,
      given: 0,
      boughtIn: 0,
      cashedOut: 0,
    });
  });

  it('migrates a v8 record to v9: nothing bought or spent, the ferryman paid by default', () => {
    const v8 = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    const sim = v8['sim'] as Record<string, unknown>;
    v8['version'] = 8;
    delete sim['upgrades'];
    sim['stats'] = { actions: {}, items: {}, sold: 2, kills: {}, deaths: 1, offered: 0, thrown: 4 };
    sim['combat'] = { hp: 10, food: null, eatAt: 0.25, offering: null, favour: 7, fight: null };
    sim['log'] = [{ type: 'died', tick: 5, monster: 'adder', lost: 'copper-helm' }];
    const out = migrateSave(v8);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.sim.upgrades).toEqual({});
    expect(out.sim.stats).toMatchObject({ sold: 2, thrown: 4, spent: 0, ferried: 0 });
    expect(out.sim.combat).toMatchObject({ favour: 7, ferryman: true });
    expect(out.sim.log[0]).toEqual({
      type: 'died',
      tick: 5,
      monster: 'adder',
      lost: 'copper-helm',
      kept: null,
      paid: 0,
      obol: false,
    });
  });

  it('migrates a v9 record to v10: no hall, nothing given', () => {
    const v9 = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    const sim = v9['sim'] as Record<string, unknown>;
    v9['version'] = 9;
    delete sim['hall'];
    sim['stats'] = {
      actions: {},
      items: {},
      sold: 2,
      kills: {},
      deaths: 1,
      offered: 0,
      thrown: 4,
      spent: 9,
      ferried: 1,
    };
    const out = migrateSave(v9);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.sim.hall).toEqual({ id: null, rooms: {}, gifts: [], given: 0 });
    expect(out.sim.stats).toMatchObject({ spent: 9, ferried: 1, given: 0 });
  });

  it('migrates a v10 record to v11: nothing at the wheel', () => {
    const v10 = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    const sim = v10['sim'] as Record<string, unknown>;
    v10['version'] = 10;
    delete sim['wheel'];
    const stats = sim['stats'] as Record<string, unknown>;
    delete stats['boughtIn'];
    delete stats['cashedOut'];
    stats['given'] = 3;
    const out = migrateSave(v10);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.sim.wheel).toEqual({ cart: [], bought: 0, paidThrough: 0 });
    expect(out.sim.stats).toMatchObject({ given: 3, boughtIn: 0, cashedOut: 0 });
  });

  it('migrates a v11 record to v12: nothing cast; what was thrown is kept', () => {
    const v11 = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    const sim = v11['sim'] as Record<string, unknown>;
    v11['version'] = 11;
    sim['stats'] = {
      actions: {},
      items: {},
      sold: 0,
      kills: {},
      deaths: 0,
      offered: 0,
      thrown: 4,
      spent: 0,
      ferried: 0,
      given: 0,
      boughtIn: 0,
      cashedOut: 0,
    };
    const out = migrateSave(v11);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.sim.stats).toMatchObject({ thrown: 4, cast: 0 });
  });

  it('migrates a v12 record to v13: an empty slab, and the coins that were there are kept', () => {
    const v12 = JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
    const sim = v12['sim'] as Record<string, unknown>;
    v12['version'] = 12;
    delete sim['records'];
    sim['coins'] = 4_200;
    const out = migrateSave(v12);
    expect(out.version).toBe(CURRENT_SAVE_VERSION);
    expect(out.sim.records).toEqual({ fish: {}, trophies: [] });
    expect(out.sim.coins).toBe(4_200);
  });

  it('refuses a future version rather than guessing', () => {
    expect(() => migrateSave({ ...fresh(), version: 99 })).toThrow(SaveLoadError);
    expect(() => migrateSave({ ...fresh(), version: 99 })).toThrow(/newer/);
  });

  it('refuses when a migration step is missing', () => {
    let err: unknown;
    try {
      migrateSave({ ...fresh(), version: 0 }, {}, 1);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SaveLoadError);
    expect((err as SaveLoadError).reason).toBe('missing-migration');
  });

  it('refuses non-objects and structurally invalid saves', () => {
    for (const bad of [
      null,
      'x',
      42,
      [],
      { version: 'one' },
      { version: 2 },
      { version: 1, sim: { tick: 'soon' } },
      { ...fresh(), sim: { tick: -1 } },
      { ...fresh(), sim: { ...fresh().sim, bank: [{ item: 'ore', qty: 0 }] } },
      { ...fresh(), sim: { ...fresh().sim, equipment: {} } },
    ]) {
      expect(() => migrateSave(bad)).toThrow(SaveLoadError);
    }
  });
});
