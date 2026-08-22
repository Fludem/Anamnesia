import { describe, expect, it } from 'vitest';

import {
  gradientId,
  RenderCache,
  renderIcon,
  renderTile,
  specKey,
  type Layer,
  type Palette,
  type TileSpec,
} from './render.ts';

const COPPER: Palette = { highlight: '#f0a06a', primary: '#bd6f3f', shadow: '#6e4023' };
const IRON: Palette = { highlight: '#cdd1d6', primary: '#8f959d', shadow: '#52575e' };
const SQUARE = 'M64 64h384v384H64z';
const layer = (id: string, fill: Layer['fill']): Layer => ({ id, d: SQUARE, fill });

const tile = (over: Partial<TileSpec> = {}): TileSpec => ({
  layers: [layer('a', { kind: 'palette', palette: COPPER })],
  size: 72,
  iconSize: 26,
  radius: 7,
  background: '#101214',
  border: '#2c2f35',
  ...over,
});

describe('renderIcon', () => {
  it('reproduces the design gradient: 150deg over the 512 box, stops at 8/50/96%', () => {
    const svg = renderIcon({ layers: [layer('a', { kind: 'palette', palette: COPPER })] }, 32);
    expect(svg).toContain('viewBox="0 0 512 512" width="32" height="32"');
    expect(svg).toContain(
      'gradientUnits="userSpaceOnUse" x1="81.1" y1="-46.9" x2="430.9" y2="558.9"',
    );
    expect(svg).toContain('<stop offset="8%" stop-color="#f0a06a"/>');
    expect(svg).toContain('<stop offset="50%" stop-color="#bd6f3f"/>');
    expect(svg).toContain('<stop offset="96%" stop-color="#6e4023"/>');
    expect(svg).toContain(`fill="url(#${gradientId(COPPER)})"`);
  });

  it('emits one gradient def per distinct palette', () => {
    const svg = renderIcon(
      {
        layers: [
          layer('a', { kind: 'palette', palette: COPPER }),
          layer('b', { kind: 'palette', palette: COPPER }),
          layer('c', { kind: 'palette', palette: IRON }),
        ],
      },
      32,
    );
    expect(svg.match(/<linearGradient /g)).toHaveLength(2);
  });

  it('flat fills need no defs; strokes and opacity pass through; group transform wraps layers', () => {
    const svg = renderIcon(
      {
        layers: [
          {
            id: 'a',
            d: SQUARE,
            fill: { kind: 'flat', color: '#8b887f' },
            stroke: '#111111',
            strokeWidth: 4,
            opacity: 0.5,
          },
        ],
        transform: 'rotate(-45 256 256)',
      },
      20,
    );
    expect(svg).not.toContain('<defs>');
    expect(svg).toContain('fill="#8b887f" stroke="#111111" stroke-width="4"');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('<g transform="rotate(-45 256 256)"><path');
  });

  it('escapes attribute values', () => {
    const svg = renderIcon(
      { layers: [{ id: 'a', d: 'M0 0"<x', fill: { kind: 'flat', color: 'a&b' } }] },
      8,
    );
    expect(svg).toContain('d="M0 0&quot;&lt;x"');
    expect(svg).toContain('fill="a&amp;b"');
  });
});

describe('renderTile', () => {
  it('sizes the viewBox in CSS px and centres the icon', () => {
    const svg = renderTile(tile());
    expect(svg).toContain('viewBox="0 0 72 72" width="72" height="72"');
    expect(svg).toContain(
      '<rect x="0.5" y="0.5" width="71" height="71" rx="7" fill="#101214" stroke="#2c2f35"/>',
    );
    expect(svg).toContain(`<g transform="translate(23 23) scale(${String(26 / 512)})">`);
  });

  it('draws the rarity tag top-right and badges along the bottom-left', () => {
    const svg = renderTile(
      tile({
        tag: { text: 'E', color: '#c9a4ff' },
        badges: [
          { id: 'bolt', d: 'M0 0h10v10z', color: '#56c39a' },
          { id: 'fire', d: 'M0 0h10v10z', color: '#d2a04c' },
        ],
        badgeBackground: '#1b1d21',
      }),
    );
    expect(svg).toContain('<text x="67" y="11" text-anchor="end"');
    expect(svg).toContain('fill="#c9a4ff">E</text>');
    expect(svg).toContain('translate(3 57)');
    expect(svg).toContain('translate(17 57)');
    expect(svg.match(/data-badge=/g)).toHaveLength(2);
    expect(svg).toContain('r="128" fill="#1b1d21"');
  });

  it('omits tag and badges when absent', () => {
    const svg = renderTile(tile());
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('data-badge');
  });
});

describe('specKey + RenderCache', () => {
  it('keys on inputs, not path data', () => {
    const a = specKey(tile());
    const b = specKey(
      tile({ layers: [{ id: 'a', d: 'M1 1', fill: { kind: 'palette', palette: COPPER } }] }),
    );
    expect(a).toBe(b);
    expect(specKey(tile({ layers: [layer('a', { kind: 'palette', palette: IRON })] }))).not.toBe(a);
    expect(specKey(tile({ size: 36 }))).not.toBe(a);
    expect(specKey(tile({ tag: { text: 'R', color: '#8fd0e6' } }))).not.toBe(a);
    expect(specKey(tile({ badges: [{ id: 'bolt', d: '', color: '#56c39a' }] }))).not.toBe(a);
  });

  it('memoises and evicts the oldest entry', () => {
    const cache = new RenderCache(2);
    let renders = 0;
    const render = () => `r${String(++renders)}`;
    expect(cache.get('a', render)).toBe('r1');
    expect(cache.get('a', render)).toBe('r1');
    expect(cache.get('b', render)).toBe('r2');
    expect(cache.get('c', render)).toBe('r3'); // evicts a
    expect(cache.get('a', render)).toBe('r4');
    expect(cache.size).toBe(2);
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(4);
  });
});
