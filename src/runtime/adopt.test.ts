import { describe, expect, it } from 'vitest';
import { createNewSave, type SaveRecord } from '../sim/save.ts';
import { adoptLocalSave } from './adopt.ts';
import { MemorySaveStore } from './store.ts';

const keep = (sim: SaveRecord['sim']) => sim;
const save = (tick: number): SaveRecord => {
  const s = createNewSave({ seed: 1, nowMs: 1000, writerId: 'old-tab' });
  return { ...s, sim: { ...s.sim, tick } };
};

describe('adopting the browser’s old save', () => {
  it('moves a local save to a name that has none, and clears it locally', async () => {
    const local = new MemorySaveStore();
    const server = new MemorySaveStore();
    await local.write('main', save(500), 0);
    expect(await adoptLocalSave(local, server, keep)).toBe('adopted');
    expect(server.peek('main')?.sim.tick).toBe(500);
    expect(server.peek('main')?.saveCounter).toBe(1);
    expect(local.peek('main')).toBeUndefined();
    expect(await adoptLocalSave(local, server, keep)).toBe('nothing-local');
  });

  it('leaves both alone when the name already has a save', async () => {
    const local = new MemorySaveStore();
    const server = new MemorySaveStore();
    await local.write('main', save(500), 0);
    await server.write('main', save(9), 0);
    expect(await adoptLocalSave(local, server, keep)).toBe('name-has-save');
    expect(server.peek('main')?.sim.tick).toBe(9);
    expect(local.peek('main')?.sim.tick).toBe(500);
  });

  it('reconciles on the way and never touches a save it cannot read', async () => {
    const local = new MemorySaveStore();
    const server = new MemorySaveStore();
    await local.write('main', save(500), 0);
    const marked = await adoptLocalSave(local, server, (sim) => ({ ...sim, coins: 77 }));
    expect(marked).toBe('adopted');
    expect(server.peek('main')?.sim.coins).toBe(77);

    const broken = new MemorySaveStore();
    broken['slots'].set('main', { version: 'x' } as unknown as SaveRecord);
    expect(await adoptLocalSave(broken, new MemorySaveStore(), keep)).toBe('unreadable');
    expect(broken.peek('main')).toBeDefined();
  });
});
