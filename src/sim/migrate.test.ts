import { describe, expect, it } from 'vitest';
import { migrateSave, SaveLoadError, type MigrationTable } from './migrate.ts';
import { createNewSave } from './save.ts';

const fresh = () => createNewSave({ seed: 1, nowMs: 1_000, writerId: 'tab-a' });

describe('migrateSave', () => {
  it('passes a current-version save through unchanged', () => {
    const save = fresh();
    const raw: unknown = JSON.parse(JSON.stringify(save));
    expect(migrateSave(raw)).toEqual(save);
  });

  it('applies a chain of migration steps and stamps the version', () => {
    const migrations: MigrationTable = {
      0: (r) => ({ ...r, writerId: 'migrated-from-v0' }),
    };
    const v0 = { ...fresh(), version: 0, writerId: undefined };
    const out = migrateSave(v0, migrations, 1);
    expect(out.version).toBe(1);
    expect(out.writerId).toBe('migrated-from-v0');
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
      { version: 1 },
      { ...fresh(), sim: { tick: -1 } },
    ]) {
      expect(() => migrateSave(bad)).toThrow(SaveLoadError);
    }
  });
});
