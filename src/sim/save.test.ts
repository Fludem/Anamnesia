import { describe, expect, it } from 'vitest';
import { createNewSave, SaveRecordSchema } from './save.ts';

describe('save schema', () => {
  it('a fresh save validates and starts at tick 0 / counter 0', () => {
    const save = createNewSave({ seed: 5, nowMs: 123, writerId: 'tab' });
    expect(SaveRecordSchema.parse(save)).toEqual(save);
    expect(save.sim.tick).toBe(0);
    expect(save.saveCounter).toBe(0);
    expect(save.wallMs).toBe(123);
  });

  it('rejects non-integer ticks and out-of-range rng words', () => {
    const save = createNewSave({ seed: 5, nowMs: 123, writerId: 'tab' });
    expect(SaveRecordSchema.safeParse({ ...save, sim: { ...save.sim, tick: 1.5 } }).success).toBe(
      false,
    );
    expect(
      SaveRecordSchema.safeParse({ ...save, sim: { ...save.sim, rng: [1, 2, 3, 2 ** 32] } })
        .success,
    ).toBe(false);
  });
});
