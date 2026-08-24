import {
  CURRENT_SAVE_VERSION,
  DEFAULT_EAT_AT,
  DEFAULT_PLAYER_NAME,
  emptyEquipment,
  STARTING_HP,
  SaveRecordSchema,
  type SaveRecord,
} from './save.ts';

/** A step migrates a save from version N to N+1. Keyed by N. Input is untrusted JSON. */
export type MigrationStep = (raw: Record<string, unknown>) => Record<string, unknown>;
export type MigrationTable = Readonly<Record<number, MigrationStep>>;

export const MIGRATIONS: MigrationTable = {
  /**
   * v1 (Phase 0.5 placeholder sim) → v2 (Phase 1 game state). Keeps tick and rng so the
   * envelope's wall-clock anchor stays valid; the placeholder checksum is dropped.
   */
  1: (raw) => {
    const sim = asObject(raw['sim']);
    return {
      ...raw,
      sim: {
        tick: sim['tick'],
        rng: sim['rng'],
        player: { name: DEFAULT_PLAYER_NAME },
        skills: {},
        inventory: [],
        equipment: emptyEquipment(),
        bank: [],
        action: { current: null, queue: [] },
      },
    };
  },
  /**
   * v2 → v3 (Phase 3): per-skill tool slots (`pickaxe`, `axe`) join the equipment record.
   * Every slot must be present, so fill the new ones with null and keep what was equipped.
   */
  2: (raw) => {
    const sim = asObject(raw['sim']);
    return {
      ...raw,
      sim: { ...sim, equipment: { ...emptyEquipment(), ...asObject(sim['equipment']) } },
    };
  },
  /** v3 → v4 (Phase 4): coins, bought bank slots, the event log and counters. All start empty. */
  3: (raw) => {
    const sim = asObject(raw['sim']);
    return {
      ...raw,
      sim: { bankSlotsBought: 0, coins: 0, log: [], stats: { actions: {} }, ...sim },
    };
  },
  /**
   * v4 → v5 (Phase 5): the rod slot, the sworn god (null: an old hero is asked on next load),
   * lifetime item and sale counters, and first-steps progress — started, not dismissed, so an
   * existing hero sees the card too and can put it away.
   */
  4: (raw) => {
    const sim = asObject(raw['sim']);
    const stats = asObject(sim['stats']);
    // `stopped` events gained a skill; v4 ones have none and there is no way to know it.
    const log = Array.isArray(sim['log'])
      ? sim['log'].filter((e: unknown) => {
          const ev = asObject(e);
          return ev['type'] !== 'stopped' || typeof ev['skill'] === 'string';
        })
      : [];
    return {
      ...raw,
      sim: {
        ...sim,
        player: { god: null, ...asObject(sim['player']) },
        equipment: { ...emptyEquipment(), ...asObject(sim['equipment']) },
        stats: { items: {}, sold: 0, ...stats, actions: stats['actions'] ?? {} },
        tutorial: { done: [], dismissed: false },
        log,
      },
    };
  },
  /**
   * v5 → v6 (Phase 6): combat state (full hitpoints, no food chosen, the design's 25% eat
   * threshold, no fight) and lifetime kill counters. Hitpoints xp starts at 0 like any skill.
   */
  5: (raw) => {
    const sim = asObject(raw['sim']);
    const stats = asObject(sim['stats']);
    return {
      ...raw,
      sim: {
        ...sim,
        stats: { kills: {}, deaths: 0, ...stats },
        combat: { hp: STARTING_HP, food: null, eatAt: DEFAULT_EAT_AT, fight: null },
      },
    };
  },
  /** v6 → v7 (Phase 7): no offering chosen, no favour, nothing ever burnt. */
  6: (raw) => {
    const sim = asObject(raw['sim']);
    return {
      ...raw,
      sim: {
        ...sim,
        stats: { offered: 0, ...asObject(sim['stats']) },
        combat: { offering: null, favour: 0, ...asObject(sim['combat']) },
      },
    };
  },
  /** v7 → v8 (Phase 8): nothing ever thrown. */
  7: (raw) => {
    const sim = asObject(raw['sim']);
    return { ...raw, sim: { ...sim, stats: { thrown: 0, ...asObject(sim['stats']) } } };
  },
  /** v8 → v9 (Phase 10): nothing bought, nothing spent, the ferryman paid by default. */
  8: (raw) => {
    const sim = asObject(raw['sim']);
    return {
      ...raw,
      sim: {
        ...sim,
        upgrades: {},
        stats: { spent: 0, ferried: 0, ...asObject(sim['stats']) },
        combat: { ferryman: true, ...asObject(sim['combat']) },
      },
    };
  },
  /** v9 → v10 (Phase 12): no hall, nothing given. */
  9: (raw) => {
    const sim = asObject(raw['sim']);
    return {
      ...raw,
      sim: {
        ...sim,
        hall: { id: null, rooms: {}, gifts: [], given: 0 },
        stats: { given: 0, ...asObject(sim['stats']) },
      },
    };
  },
  /** v10 → v11 (Phase 14): nothing at the wheel. */
  10: (raw) => {
    const sim = asObject(raw['sim']);
    return {
      ...raw,
      sim: {
        ...sim,
        wheel: { cart: [], bought: 0, paidThrough: 0 },
        stats: { boughtIn: 0, cashedOut: 0, ...asObject(sim['stats']) },
      },
    };
  },
  /** v11 → v12 (Phase 16): nothing ever cast. */
  11: (raw) => {
    const sim = asObject(raw['sim']);
    return { ...raw, sim: { ...sim, stats: { cast: 0, ...asObject(sim['stats']) } } };
  },
  /** v12 → v13 (Phase 17): an empty slab. Nothing caught before this was ever weighed. */
  12: (raw) => {
    const sim = asObject(raw['sim']);
    return { ...raw, sim: { ...sim, records: { fish: {}, trophies: [] } } };
  },
  /** v13 → v14 (Phase 18): the road barred, nothing tried, no one driven off. */
  13: (raw) => {
    const sim = asObject(raw['sim']);
    return {
      ...raw,
      sim: {
        ...sim,
        stats: { ambushes: 0, routed: 0, ...asObject(sim['stats']) },
        combat: { road: { open: false, ambushAt: null }, ...asObject(sim['combat']) },
      },
    };
  },
  /**
   * v14 → v15 (Phase 19): the ring. Barred, nothing settled, nothing owed — an old hero is on
   * nobody's card until they step in, and the register has never taken anything from them.
   */
  14: (raw) => {
    const sim = asObject(raw['sim']);
    return {
      ...raw,
      sim: {
        ...sim,
        bouts: { settledThrough: 0, owed: 0 },
        stats: { bouts: 0, taken: 0, lost: 0, ...asObject(sim['stats']) },
        combat: { bouts: { open: false }, ...asObject(sim['combat']) },
      },
    };
  },
};

function asObject(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export class SaveLoadError extends Error {
  override readonly name = 'SaveLoadError';
  constructor(
    message: string,
    readonly reason:
      'not-an-object' | 'bad-version' | 'future-version' | 'missing-migration' | 'invalid',
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/**
 * Bring an arbitrary stored value up to the current save version and validate it.
 * Never returns a default save: an unreadable save must surface, not be silently replaced.
 */
export function migrateSave(
  raw: unknown,
  migrations: MigrationTable = MIGRATIONS,
  targetVersion: number = CURRENT_SAVE_VERSION,
): SaveRecord {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SaveLoadError('save is not an object', 'not-an-object');
  }
  let record = raw as Record<string, unknown>;
  const version = record['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new SaveLoadError(`save has no usable version (${String(version)})`, 'bad-version');
  }
  if (version > targetVersion) {
    throw new SaveLoadError(
      `save version ${String(version)} is newer than this build supports (${String(targetVersion)})`,
      'future-version',
    );
  }
  for (let v = version; v < targetVersion; v++) {
    const step = migrations[v];
    if (!step) {
      throw new SaveLoadError(`no migration from save version ${String(v)}`, 'missing-migration');
    }
    record = { ...step(record), version: v + 1 };
  }
  const parsed = SaveRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new SaveLoadError(`save failed validation: ${parsed.error.message}`, 'invalid', {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
