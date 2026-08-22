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
    };
    const v0 = { ...fresh(), version: 0, writerId: undefined };
    const out = migrateSave(v0, migrations, CURRENT_SAVE_VERSION);
    expect(applied).toEqual([0, 1, 2, 3]);
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
      player: { name: 'Nameless' },
      skills: {},
      inventory: [],
      equipment: emptyEquipment(),
      bank: [],
      bankSlotsBought: 0,
      coins: 0,
      action: { current: null, queue: [] },
      log: [],
      stats: { actions: {} },
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
    expect(out.version).toBe(4);
    expect(out.sim.coins).toBe(0);
    expect(out.sim.bankSlotsBought).toBe(0);
    expect(out.sim.log).toEqual([]);
    expect(out.sim.stats).toEqual({ actions: {} });
    expect(out.sim.bank).toEqual([{ item: 'copper-ore', qty: 3 }]);
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
