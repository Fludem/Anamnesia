import { describe, expect, it } from 'vitest';
import {
  bands,
  cellAt,
  emptyLook,
  emptyPaint,
  FAMILIES,
  flood,
  GRID,
  inside,
  isBlank,
  letterOf,
  LookSchema,
  marks,
  MAX_SHAPES,
  PALETTE,
  parseLook,
  ShapeSchema,
  stamp,
  withCell,
  type Shape,
} from './look.ts';

const box = (s: Partial<Shape>): Shape => ({ k: 'box', x: 0, y: 0, w: 4, h: 4, c: 1, r: 0, ...s });

/** The paint as rows of letters, for reading a stamp at a glance. */
const rows = (paint: string, from: number, to: number): string[] =>
  Array.from({ length: to - from }, (_, i) =>
    paint.slice((from + i) * GRID, (from + i + 1) * GRID),
  );

describe('the palette', () => {
  it('is only the design and the materials, every hex well-formed and distinct', () => {
    const hexes = PALETTE.map((s) => s.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
    for (const h of hexes) expect(h).toMatch(/^#[0-9a-f]{6}$/);
    // The accent, the gold, the hurt and the text: the hill's own colours are all there.
    expect(hexes).toContain('#56c39a');
    expect(hexes).toContain('#d2a04c');
    expect(hexes).toContain('#c96a5a');
    expect(hexes).toContain('#e8e6df');
    expect(PALETTE.length).toBeLessThanOrEqual(36);
  });

  it('splits into bands that cover it once each, in the order a look stores', () => {
    const got = bands();
    expect(got.map((b) => b.name)).toEqual(FAMILIES.map((f) => f.name));
    const seen = got.flatMap((b) => b.swatches);
    expect(seen.map((s) => s.index)).toEqual(PALETTE.map((_, i) => i));
    for (const { index, swatch } of seen) expect(swatch).toBe(PALETTE[index]);
  });
});

describe('the schema', () => {
  it('takes an empty look and a full one', () => {
    expect(LookSchema.safeParse(emptyLook()).success).toBe(true);
    const full = {
      v: 1,
      bg: 3,
      shapes: [box({ k: 'disc', x: 2, y: 2, w: 12, h: 12, c: 11 }), box({ k: 'line', r: 1 })],
      paint: letterOf(PALETTE.length - 1).repeat(GRID * GRID),
    };
    expect(LookSchema.safeParse(full).success).toBe(true);
  });

  it('refuses paint of the wrong length or with letters past the palette', () => {
    expect(LookSchema.safeParse({ ...emptyLook(), paint: emptyPaint().slice(1) }).success).toBe(
      false,
    );
    expect(
      LookSchema.safeParse({ ...emptyLook(), paint: `z${emptyPaint().slice(1)}` }).success,
    ).toBe(PALETTE.length === 36);
    expect(
      LookSchema.safeParse({ ...emptyLook(), paint: `#${emptyPaint().slice(1)}` }).success,
    ).toBe(false);
  });

  it('keeps every shape on the grid, with a palette colour and a quarter turn', () => {
    expect(ShapeSchema.safeParse(box({ x: 12, w: 4 })).success).toBe(true);
    expect(ShapeSchema.safeParse(box({ x: 13, w: 4 })).success).toBe(false);
    expect(ShapeSchema.safeParse(box({ w: 0 })).success).toBe(false);
    expect(ShapeSchema.safeParse(box({ c: PALETTE.length })).success).toBe(false);
    expect(ShapeSchema.safeParse(box({ r: 4 })).success).toBe(false);
    expect(ShapeSchema.safeParse(box({ x: 0.5 })).success).toBe(false);
    const many = { ...emptyLook(), shapes: Array.from({ length: MAX_SHAPES + 1 }, () => box({})) };
    expect(LookSchema.safeParse(many).success).toBe(false);
  });

  it('reads what the register stored, and nothing it cannot', () => {
    const look = { ...emptyLook(), bg: 2 };
    expect(parseLook(JSON.stringify(look))).toEqual(look);
    expect(parseLook(null)).toBeNull();
    expect(parseLook('not json')).toBeNull();
    expect(parseLook(JSON.stringify({ v: 2 }))).toBeNull();
    // A blank look stored by mistake counts as none.
    expect(parseLook(JSON.stringify(emptyLook()))).toBeNull();
  });
});

describe('paint', () => {
  it('sets, reads and clears one cell, returning the same string when nothing changes', () => {
    const p0 = emptyPaint();
    const p1 = withCell(p0, 3, 2, 5);
    expect(cellAt(p1, 3, 2)).toBe(5);
    expect(cellAt(p1, 2, 3)).toBeNull();
    expect(withCell(p1, 3, 2, 5)).toBe(p1);
    expect(withCell(p1, 3, 2, null)).toBe(p0);
    expect(withCell(p1, -1, 0, 5)).toBe(p1);
    expect(withCell(p1, GRID, 0, 5)).toBe(p1);
  });

  it('floods only what is joined, four ways', () => {
    // A wall of 1s across row 4 splits the grid; fill above it.
    let p = emptyPaint();
    for (let x = 0; x < GRID; x++) p = withCell(p, x, 4, 1);
    const filled = flood(p, 0, 0, 2);
    expect(cellAt(filled, 15, 3)).toBe(2);
    expect(cellAt(filled, 0, 4)).toBe(1);
    expect(cellAt(filled, 0, 5)).toBeNull();
    // A diagonal touch is not a join.
    let q = emptyPaint();
    q = withCell(q, 1, 0, 1);
    q = withCell(q, 0, 1, 1);
    const corner = flood(q, 0, 0, 3);
    expect(cellAt(corner, 0, 0)).toBe(3);
    expect(cellAt(corner, 1, 1)).toBeNull();
    // The same colour again is no change at all.
    expect(flood(p, 0, 4, 1)).toBe(p);
  });

  it('counts marks and knows a blank', () => {
    expect(isBlank(emptyLook())).toBe(true);
    expect(marks(emptyLook())).toBe(0);
    const some = { ...emptyLook(), paint: withCell(emptyPaint(), 0, 0, 1), shapes: [box({})] };
    expect(isBlank(some)).toBe(false);
    expect(marks(some)).toBe(2);
    expect(isBlank({ ...emptyLook(), bg: 0 })).toBe(false);
  });
});

describe('shapes pressed into the paint', () => {
  it('a box covers exactly its cells', () => {
    const p = stamp(emptyPaint(), box({ x: 1, y: 1, w: 3, h: 2, c: 4 }));
    expect(rows(p, 0, 4)).toEqual([
      '................',
      '.444............',
      '.444............',
      '................',
    ]);
  });

  it('a disc rounds its corners off', () => {
    const p = stamp(emptyPaint(), box({ k: 'disc', x: 0, y: 0, w: 6, h: 6, c: 1 }));
    expect(rows(p, 0, 6)).toEqual([
      '.1111...........',
      '111111..........',
      '111111..........',
      '111111..........',
      '111111..........',
      '.1111...........',
    ]);
  });

  it('a triangle points the way it is turned', () => {
    const up = stamp(emptyPaint(), box({ k: 'tri', x: 0, y: 0, w: 5, h: 3, c: 1, r: 0 }));
    expect(rows(up, 0, 3)).toEqual(['..1.............', '.111............', '11111...........']);
    const down = stamp(emptyPaint(), box({ k: 'tri', x: 0, y: 0, w: 5, h: 3, c: 1, r: 2 }));
    expect(rows(down, 0, 3)).toEqual(['11111...........', '.111............', '..1.............']);
    const right = stamp(emptyPaint(), box({ k: 'tri', x: 0, y: 0, w: 3, h: 5, c: 1, r: 1 }));
    expect(rows(right, 0, 5)).toEqual([
      '1...............',
      '11..............',
      '111.............',
      '11..............',
      '1...............',
    ]);
  });

  it('a diamond is the disc with corners', () => {
    const p = stamp(emptyPaint(), box({ k: 'diamond', x: 0, y: 0, w: 5, h: 5, c: 1 }));
    expect(rows(p, 0, 5)).toEqual([
      '..1.............',
      '.111............',
      '11111...........',
      '.111............',
      '..1.............',
    ]);
  });

  it('a line runs corner to corner, and the other way when turned', () => {
    const down = stamp(emptyPaint(), box({ k: 'line', x: 0, y: 0, w: 4, h: 4, c: 1, r: 0 }));
    expect(rows(down, 0, 4)).toEqual([
      '1...............',
      '.1..............',
      '..1.............',
      '...1............',
    ]);
    const up = stamp(emptyPaint(), box({ k: 'line', x: 0, y: 0, w: 4, h: 4, c: 1, r: 1 }));
    expect(rows(up, 0, 4)).toEqual([
      '...1............',
      '..1.............',
      '.1..............',
      '1...............',
    ]);
    const flat = stamp(emptyPaint(), box({ k: 'line', x: 2, y: 0, w: 5, h: 1, c: 1 }));
    expect(rows(flat, 0, 2)).toEqual(['..11111.........', '................']);
  });

  it('a shape pressed keeps the paint already there outside it', () => {
    const p = withCell(emptyPaint(), 0, 0, 7);
    const out = stamp(p, box({ x: 1, y: 0, w: 2, h: 1, c: 1 }));
    expect(rows(out, 0, 1)).toEqual(['711.............']);
    expect(inside(box({ x: 1, y: 0, w: 2, h: 1 }), 0.5, 0.5)).toBe(false);
  });
});
