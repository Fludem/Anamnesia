import { CURRENT_SAVE_VERSION, SaveRecordSchema, type SaveRecord } from './save.ts';

/** A step migrates a save from version N to N+1. Keyed by N. Input is untrusted JSON. */
export type MigrationStep = (raw: Record<string, unknown>) => Record<string, unknown>;
export type MigrationTable = Readonly<Record<number, MigrationStep>>;

/** No migrations yet — v1 is the first shipped format. Add `0: …` style steps here as it changes. */
export const MIGRATIONS: MigrationTable = {};

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
