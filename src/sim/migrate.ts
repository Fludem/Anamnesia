import {
  CURRENT_SAVE_VERSION,
  DEFAULT_PLAYER_NAME,
  emptyEquipment,
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
