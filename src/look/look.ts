/**
 * A look: the small picture a name — or a hall — shows the hill instead of its first letter.
 * Sixteen cells by sixteen, painted by hand in the design's colours, over a stack of plain
 * shapes (a disc, a box, a triangle, a diamond, a line) laid on a backdrop. The shapes stay
 * shapes, so a look is crisp at any size; the paint lies over them. It is kept on the
 * register, not in the save: it belongs to the name, not the hero.
 *
 * The wire shape is small and plain — the paint is one string of 256 palette letters, the
 * shapes a short list — and both ends check it with `LookSchema`. The palette is append-only:
 * a stored look is a list of indices into it.
 */
import { z } from 'zod';

/** Cells across and down. */
export const GRID = 16;
/** Shapes a look may stack. */
export const MAX_SHAPES = 24;
/** The paint letter of an empty cell. */
export const EMPTY = '.';
/** Palette indices as one letter each: 0–9 then a–z. */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export interface Swatch {
  /** A plain material word, the way the hill names things. */
  name: string;
  hex: string;
}

/**
 * Every colour the design uses: the chrome's greys, the accent greens, the gold, the hurt red
 * and the material tiers from materials.json. Append only — indices are what a look stores.
 */
export const PALETTE: readonly Swatch[] = [
  // greys, dark to light — the chrome
  { name: 'Ink', hex: '#101214' },
  { name: 'Soot', hex: '#24272c' },
  { name: 'Slate', hex: '#4b4d52' },
  { name: 'Ash', hex: '#67655e' },
  { name: 'Smoke', hex: '#8b887f' },
  { name: 'Linen', hex: '#a09d94' },
  { name: 'Bone', hex: '#d0cdc4' },
  { name: 'Chalk', hex: '#e8e6df' },
  // greens — the accent, pine and willow
  { name: 'Moss', hex: '#2b5a3c' },
  { name: 'Pine', hex: '#4f9a68' },
  { name: 'Verdigris', hex: '#3da581' },
  { name: 'Jade', hex: '#56c39a' },
  { name: 'Mint', hex: '#74dcb4' },
  { name: 'Sage', hex: '#a8e0c2' },
  // golds and browns — gold, oak
  { name: 'Ochre', hex: '#8a6524' },
  { name: 'Honey', hex: '#d2a04c' },
  { name: 'Straw', hex: '#f5d98a' },
  { name: 'Umber', hex: '#5e4426' },
  { name: 'Oak', hex: '#a37a4a' },
  { name: 'Tan', hex: '#d8b184' },
  // reds — copper and the hurt
  { name: 'Bark', hex: '#6e4023' },
  { name: 'Copper', hex: '#bd6f3f' },
  { name: 'Rust', hex: '#c96a5a' },
  { name: 'Peach', hex: '#f0a06a' },
  // blues — basalt, silver, gem
  { name: 'Night', hex: '#333a4e' },
  { name: 'Basalt', hex: '#596484' },
  { name: 'Dusk', hex: '#93a0c0' },
  { name: 'Steel', hex: '#7089a3' },
  { name: 'Silver', hex: '#b2c9e0' },
  { name: 'Sea', hex: '#4d8ba3' },
  { name: 'Sky', hex: '#8fd0e6' },
  { name: 'Ice', hex: '#d8f6ff' },
  // purples — blight and aether
  { name: 'Plum', hex: '#3d3650' },
  { name: 'Violet', hex: '#53398f' },
  { name: 'Aether', hex: '#8f63e8' },
  { name: 'Lilac', hex: '#c9a4ff' },
];

if (PALETTE.length > DIGITS.length) throw new Error('the palette outgrew its letters');

/**
 * The palette in bands, in palette order. Thirty-six dots of the same size is a wall; the
 * brush shows them as six families with the family's word in the gutter. Append only, like
 * the palette: a colour added to the end must be counted into the last band (or a band added
 * for it), which the check below insists on.
 */
export const FAMILIES: readonly { name: string; count: number }[] = [
  { name: 'chrome', count: 8 },
  { name: 'moss', count: 6 },
  { name: 'gold', count: 6 },
  { name: 'rust', count: 4 },
  { name: 'basalt', count: 8 },
  { name: 'aether', count: 4 },
];

if (FAMILIES.reduce((n, f) => n + f.count, 0) !== PALETTE.length)
  throw new Error('the families do not cover the palette');

export interface Band {
  name: string;
  /** Each swatch with the index a look stores it by. */
  swatches: { index: number; swatch: Swatch }[];
}

/** The palette split into its families. */
export function bands(): Band[] {
  let at = 0;
  return FAMILIES.map((f) => {
    const from = at;
    at += f.count;
    return {
      name: f.name,
      swatches: PALETTE.slice(from, at).map((swatch, j) => ({ index: from + j, swatch })),
    };
  });
}

export const SHAPE_KINDS = ['disc', 'box', 'tri', 'diamond', 'line'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

const Cell = z.number().int().min(0).max(GRID);
const Span = z.number().int().min(1).max(GRID);

/**
 * One shape in its box of cells: `x, y` the top-left cell, `w, h` cells across and down,
 * `c` the palette index, `r` quarter turns (the way a triangle points; which diagonal a line
 * takes). A line runs between the centres of the box's corner cells.
 */
export const ShapeSchema = z
  .object({
    k: z.enum(SHAPE_KINDS),
    x: Cell,
    y: Cell,
    w: Span,
    h: Span,
    c: z
      .number()
      .int()
      .min(0)
      .max(PALETTE.length - 1),
    r: z.number().int().min(0).max(3),
  })
  .refine((s) => s.x + s.w <= GRID && s.y + s.h <= GRID, 'a shape must fit the grid');
export type Shape = z.infer<typeof ShapeSchema>;

const PAINT_RE = new RegExp(`^[.${DIGITS.slice(0, PALETTE.length)}]{${String(GRID * GRID)}}$`);

export const LookSchema = z.object({
  v: z.literal(1),
  /** The backdrop colour, or null for none. */
  bg: z
    .number()
    .int()
    .min(0)
    .max(PALETTE.length - 1)
    .nullable(),
  /** Under the paint, first at the bottom. */
  shapes: z.array(ShapeSchema).max(MAX_SHAPES),
  /** Row by row, one palette letter per cell; `.` is empty. */
  paint: z.string().regex(PAINT_RE, 'paint must be 256 palette letters'),
});
export type Look = z.infer<typeof LookSchema>;

export const emptyPaint = (): string => EMPTY.repeat(GRID * GRID);

export const emptyLook = (): Look => ({ v: 1, bg: null, shapes: [], paint: emptyPaint() });

/** A look with nothing in it shows nothing; the hill falls back to the letter. */
export function isBlank(look: Look): boolean {
  return look.bg === null && look.shapes.length === 0 && !/[^.]/.test(look.paint);
}

// ---- paint letters ------------------------------------------------------------------------

export const letterOf = (index: number): string => DIGITS[index]!;

/** The palette index a letter stands for, or null for the empty cell. */
export function indexOf(letter: string): number | null {
  if (letter === EMPTY) return null;
  const i = DIGITS.indexOf(letter);
  return i >= 0 && i < PALETTE.length ? i : null;
}

export const cellAt = (paint: string, x: number, y: number): number | null =>
  indexOf(paint[y * GRID + x] ?? EMPTY);

/** The paint with one cell set (`null` clears it); the same string when nothing changes. */
export function withCell(paint: string, x: number, y: number, c: number | null): string {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return paint;
  const i = y * GRID + x;
  const letter = c === null ? EMPTY : letterOf(c);
  if (paint[i] === letter) return paint;
  return paint.slice(0, i) + letter + paint.slice(i + 1);
}

/** Every cell joined to (x, y) by cells of the same colour takes colour `c`. */
export function flood(paint: string, x: number, y: number, c: number | null): string {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return paint;
  const from = paint[y * GRID + x]!;
  const to = c === null ? EMPTY : letterOf(c);
  if (from === to) return paint;
  const cells = paint.split('');
  const stack = [y * GRID + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (cells[i] !== from) continue;
    cells[i] = to;
    const cx = i % GRID;
    if (cx > 0) stack.push(i - 1);
    if (cx < GRID - 1) stack.push(i + 1);
    if (i >= GRID) stack.push(i - GRID);
    if (i < GRID * (GRID - 1)) stack.push(i + GRID);
  }
  return cells.join('');
}

// ---- shapes -----------------------------------------------------------------------------------

/** The corners of a triangle pointing the way `r` says, clockwise from the apex. */
export function triPoints(s: Shape): [number, number][] {
  const { x, y, w, h } = s;
  switch (s.r) {
    case 0:
      return [
        [x + w / 2, y],
        [x + w, y + h],
        [x, y + h],
      ];
    case 1:
      return [
        [x + w, y + h / 2],
        [x, y + h],
        [x, y],
      ];
    case 2:
      return [
        [x + w / 2, y + h],
        [x, y],
        [x + w, y],
      ];
    default:
      return [
        [x, y + h / 2],
        [x + w, y],
        [x + w, y + h],
      ];
  }
}

export function diamondPoints(s: Shape): [number, number][] {
  const { x, y, w, h } = s;
  return [
    [x + w / 2, y],
    [x + w, y + h / 2],
    [x + w / 2, y + h],
    [x, y + h / 2],
  ];
}

/** A line's two ends, at the centres of the box's corner cells; `r` odd takes the other diagonal. */
export function lineEnds(s: Shape): [number, number, number, number] {
  const { x, y, w, h } = s;
  return s.r % 2 === 0
    ? [x + 0.5, y + 0.5, x + w - 0.5, y + h - 0.5]
    : [x + w - 0.5, y + 0.5, x + 0.5, y + h - 0.5];
}

const LINE_WIDTH = 1;

function inPolygon(px: number, py: number, pts: [number, number][]): boolean {
  // The point is inside when it is on the same side of every edge.
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[(i + 1) % pts.length]!;
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const here = cross > 1e-9 ? 1 : cross < -1e-9 ? -1 : 0;
    if (here === 0) continue;
    if (sign === 0) sign = here;
    else if (sign !== here) return false;
  }
  return true;
}

/** Whether the point (px, py) in grid units lies inside the shape. */
export function inside(s: Shape, px: number, py: number): boolean {
  const { x, y, w, h } = s;
  switch (s.k) {
    case 'box':
      return px >= x && px <= x + w && py >= y && py <= y + h;
    case 'disc': {
      const dx = (px - x - w / 2) / (w / 2);
      const dy = (py - y - h / 2) / (h / 2);
      return dx * dx + dy * dy <= 1 + 1e-9;
    }
    case 'diamond':
      return inPolygon(px, py, diamondPoints(s));
    case 'tri':
      return inPolygon(px, py, triPoints(s));
    case 'line': {
      const [ax, ay, bx, by] = lineEnds(s);
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
      const dx = px - (ax + t * vx);
      const dy = py - (ay + t * vy);
      return dx * dx + dy * dy <= (LINE_WIDTH / 2) ** 2 + 1e-9;
    }
  }
}

/** The paint with a shape pressed into it: every cell whose centre the shape covers. */
export function stamp(paint: string, s: Shape): string {
  let out = paint;
  for (let y = s.y; y < s.y + s.h; y++)
    for (let x = s.x; x < s.x + s.w; x++)
      if (inside(s, x + 0.5, y + 0.5)) out = withCell(out, x, y, s.c);
  return out;
}

/** Cells painted and shapes placed — what the editor calls "nothing yet" when zero. */
export function marks(look: Look): number {
  return look.shapes.length + (look.paint.match(/[^.]/g)?.length ?? 0);
}

/** A look as the register stores it: the JSON, or null for none or for one it no longer reads. */
export function parseLook(stored: string | null): Look | null {
  if (stored === null) return null;
  try {
    const parsed = LookSchema.safeParse(JSON.parse(stored));
    return parsed.success && !isBlank(parsed.data) ? parsed.data : null;
  } catch {
    return null;
  }
}
