/**
 * Before there were names, the save lived in this browser's IndexedDB. The first time a name
 * plays here with no save of its own, that save becomes the name's: migrated, reconciled,
 * written to the register as the first save, and cleared locally so a second name on the same
 * browser does not inherit it too. A name that already has a save keeps it; the local one is
 * left alone.
 */
import { NO_HALL } from '../sim/hall.ts';
import { NO_WHEEL } from '../sim/wheel.ts';
import { migrateSave } from '../sim/migrate.ts';
import type { SimState } from '../sim/save.ts';
import type { SaveStore } from './store.ts';

export type Adoption = 'nothing-local' | 'adopted' | 'name-has-save' | 'unreadable' | 'refused';

export async function adoptLocalSave(
  local: SaveStore,
  server: SaveStore,
  reconcile: (sim: SimState) => SimState,
  slot = 'main',
): Promise<Adoption> {
  const raw = await local.load(slot);
  if (raw === null) return 'nothing-local';
  let record;
  try {
    record = migrateSave(raw);
  } catch {
    return 'unreadable';
  }
  if ((await server.load(slot)) !== null) return 'name-has-save';
  // A save from before names knows nothing of halls or the wheel; whatever it says is not this name's.
  const sim = { ...reconcile(record.sim), hall: NO_HALL, wheel: NO_WHEEL };
  const result = await server.write(slot, { ...record, sim }, 0);
  if (!result.ok) return 'refused';
  await local.clear(slot);
  return 'adopted';
}
