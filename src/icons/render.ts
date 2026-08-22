/**
 * Composes item icons at runtime. Pure string-in, string-out: geometry (`d` in the 512 icon
 * space) + fills (flat colour or material palette) + optional tile chrome (background, rarity
 * border, tag letter, corner badges) → inline `<svg>` markup. No DOM, no React, no content
 * imports — callers (src/ui/items) map game data onto these plain inputs.
 */

import { ICON_VIEWBOX } from './types.ts';

export interface Palette {
  highlight: string;
  primary: string;
  shadow: string;
}

export type Fill = { kind: 'flat'; color: string } | { kind: 'palette'; palette: Palette };

/** One drawn path. `d` is in the 512×512 icon space. */
export interface Layer {
  /** Stable identity used for cache keys (icon id or procedural part id), never the path data. */
  id: string;
  d: string;
  fill?: Fill | undefined;
  stroke?: string | undefined;
  strokeWidth?: number | undefined;
  opacity?: number | undefined;
}

export interface IconSpec {
  layers: readonly Layer[];
  /** Applied to the whole icon group, e.g. the sword rotation. */
  transform?: string | undefined;
}

/** A corner badge: glyph path in a 256×256 space drawn on a disc. */
export interface BadgeMark {
  id: string;
  d: string;
  color: string;
}

export interface TileSpec extends IconSpec {
  /** Outer size in CSS px; the viewBox matches so a 1px border stays 1px. */
  size: number;
  iconSize: number;
  radius: number;
  background: string;
  border: string;
  /** Rarity letter at the top-right, or null. */
  tag?: { text: string; color: string } | null | undefined;
  badges?: readonly BadgeMark[] | undefined;
  /** Disc colour behind badge glyphs (normally the panel background). */
  badgeBackground?: string | undefined;
}

/**
 * CSS `linear-gradient(150deg, …)` over a square, expressed in the 512 icon space. For a square
 * the gradient line is |sin θ| + |cos θ| = 1.366 long through the centre along (sin θ, −cos θ).
 */
const GRADIENT_LINE = (() => {
  const theta = (150 * Math.PI) / 180;
  const dx = Math.sin(theta);
  const dy = -Math.cos(theta);
  const half = (Math.abs(dx) + Math.abs(dy)) / 2;
  const c = 256;
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    x1: r(c - dx * half * 512),
    y1: r(c - dy * half * 512),
    x2: r(c + dx * half * 512),
    y2: r(c + dy * half * 512),
  };
})();
export const GRADIENT_STOPS = [
  ['8%', 'highlight'],
  ['50%', 'primary'],
  ['96%', 'shadow'],
] as const;

function attr(v: string | number): string {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function gradientId(p: Palette): string {
  return `g-${[p.highlight, p.primary, p.shadow].map((c) => c.replace(/[^0-9a-z]/gi, '')).join('-')}`;
}

function gradientDef(p: Palette): string {
  const { x1, y1, x2, y2 } = GRADIENT_LINE;
  const stops = GRADIENT_STOPS.map(
    ([offset, key]) => `<stop offset="${offset}" stop-color="${attr(p[key])}"/>`,
  ).join('');
  return `<linearGradient id="${gradientId(p)}" gradientUnits="userSpaceOnUse" x1="${String(x1)}" y1="${String(y1)}" x2="${String(x2)}" y2="${String(y2)}">${stops}</linearGradient>`;
}

function fillAttr(fill: Fill | undefined): string {
  if (!fill) return 'none';
  return fill.kind === 'flat' ? fill.color : `url(#${gradientId(fill.palette)})`;
}

function layersMarkup(spec: IconSpec): { defs: string; body: string } {
  const defs = new Map<string, string>();
  const paths: string[] = [];
  for (const layer of spec.layers) {
    if (layer.fill?.kind === 'palette') {
      const id = gradientId(layer.fill.palette);
      if (!defs.has(id)) defs.set(id, gradientDef(layer.fill.palette));
    }
    let a = `d="${attr(layer.d)}" fill="${attr(fillAttr(layer.fill))}"`;
    if (layer.stroke !== undefined) {
      a += ` stroke="${attr(layer.stroke)}" stroke-width="${String(layer.strokeWidth ?? 1)}" stroke-linecap="round" stroke-linejoin="round"`;
    }
    if (layer.opacity !== undefined) a += ` opacity="${String(layer.opacity)}"`;
    paths.push(`<path ${a}/>`);
  }
  const inner = paths.join('');
  const body = spec.transform ? `<g transform="${attr(spec.transform)}">${inner}</g>` : inner;
  return { defs: [...defs.values()].join(''), body };
}

/** A bare icon: viewBox is the 512 icon space, sized by `size` CSS px. */
export function renderIcon(spec: IconSpec, size: number): string {
  const { defs, body } = layersMarkup(spec);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ICON_VIEWBOX}" width="${String(size)}" height="${String(size)}" aria-hidden="true">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    body +
    '</svg>'
  );
}

/** Badge geometry: disc radius 128 in a 256 space, ring at r=101 (stroke 18), glyph on top. */
const BADGE_PX = 12;
const BADGE_INSET = 3;
const BADGE_GAP = 2;

/** An icon inside its tile: background, border, tag, badges. viewBox == CSS px. */
export function renderTile(spec: TileSpec): string {
  const { defs, body } = layersMarkup(spec);
  const s = spec.size;
  const scale = spec.iconSize / 512;
  const offset = (s - spec.iconSize) / 2;
  const parts: string[] = [];
  parts.push(
    `<rect x="0.5" y="0.5" width="${String(s - 1)}" height="${String(s - 1)}" rx="${String(spec.radius)}" fill="${attr(spec.background)}" stroke="${attr(spec.border)}"/>`,
  );
  parts.push(
    `<g transform="translate(${String(offset)} ${String(offset)}) scale(${String(scale)})">${body}</g>`,
  );
  if (spec.tag) {
    parts.push(
      `<text x="${String(s - 5)}" y="11" text-anchor="end" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="8" font-weight="600" fill="${attr(spec.tag.color)}">${attr(spec.tag.text)}</text>`,
    );
  }
  const badges = spec.badges ?? [];
  badges.forEach((b, i) => {
    const x = BADGE_INSET + i * (BADGE_PX + BADGE_GAP);
    const y = s - BADGE_INSET - BADGE_PX;
    const k = BADGE_PX / 256;
    parts.push(
      `<g transform="translate(${String(x)} ${String(y)}) scale(${String(k)})" data-badge="${attr(b.id)}">` +
        `<circle cx="128" cy="128" r="128" fill="${attr(spec.badgeBackground ?? spec.background)}"/>` +
        `<circle cx="128" cy="128" r="101" fill="none" stroke="${attr(b.color)}" stroke-width="18"/>` +
        `<path d="${attr(b.d)}" fill="${attr(b.color)}"/>` +
        '</g>',
    );
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(s)} ${String(s)}" width="${String(s)}" height="${String(s)}" aria-hidden="true">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    parts.join('') +
    '</svg>'
  );
}

/**
 * Cache key for a spec: every input that affects the output, with path data replaced by layer
 * ids. Two specs with the same key render byte-identical markup.
 */
export function specKey(spec: TileSpec | (IconSpec & { size: number })): string {
  const layers = spec.layers.map((l) => [
    l.id,
    l.fill ? (l.fill.kind === 'flat' ? l.fill.color : gradientId(l.fill.palette)) : '',
    l.stroke ?? '',
    l.strokeWidth ?? '',
    l.opacity ?? '',
  ]);
  const rest: Record<string, unknown> = { ...spec };
  delete rest['layers'];
  if ('badges' in rest) rest['badges'] = (spec as TileSpec).badges?.map((b) => [b.id, b.color]);
  return JSON.stringify([layers, rest]);
}

/** Bounded memo: insertion-ordered Map, oldest entry evicted first. */
export class RenderCache {
  private readonly map = new Map<string, string>();
  hits = 0;
  misses = 0;
  constructor(readonly max = 4096) {}

  get(key: string, render: () => string): string {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.hits++;
      return hit;
    }
    this.misses++;
    const out = render();
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, out);
    return out;
  }

  get size(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

export const renderCache: RenderCache = new RenderCache();

export function renderTileCached(spec: TileSpec): string {
  return renderCache.get(specKey(spec), () => renderTile(spec));
}
export function renderIconCached(spec: IconSpec, size: number): string {
  return renderCache.get(specKey({ ...spec, size }), () => renderIcon(spec, size));
}
