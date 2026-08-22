import { describe, expect, it } from 'vitest';

import { renderIcon, type Palette } from '../render.ts';
import { swordSpec, SWORD_TRANSFORM, type SwordPartsLike } from './sword.ts';

const METAL: Palette = { highlight: '#cdd1d6', primary: '#8f959d', shadow: '#52575e' };
const GRIP: Palette = { highlight: '#d8b184', primary: '#a37a4a', shadow: '#5e4426' };
const GEM: Palette = { highlight: '#d8f6ff', primary: '#8fd0e6', shadow: '#4d8ba3' };
const base: SwordPartsLike = {
  blade: 'straight',
  guard: 'bar',
  grip: 'plain',
  pommel: 'round',
  gem: false,
};

describe('swordSpec', () => {
  it('lays parts out in draw order with the metal palette on blade, pommel and guard', () => {
    const spec = swordSpec(base, { metal: METAL, grip: GRIP, gem: null });
    expect(spec.transform).toBe(SWORD_TRANSFORM);
    expect(spec.layers.map((l) => l.id)).toEqual([
      'sword:blade:straight',
      'sword:fuller:straight',
      'sword:edge:straight',
      'sword:grip:plain',
      'sword:pommel:round:500',
      'sword:guard:bar',
    ]);
    const fills = spec.layers.map((l) => l.fill);
    expect(fills[0]).toEqual({ kind: 'palette', palette: METAL });
    expect(fills[3]).toEqual({ kind: 'palette', palette: GRIP });
    expect(fills[5]).toEqual({ kind: 'palette', palette: METAL });
  });

  it('adds wrap stripes, a longer grip, and a gem when asked', () => {
    const spec = swordSpec(
      { blade: 'curved', guard: 'disc', grip: 'long', pommel: 'diamond', gem: true },
      { metal: METAL, grip: GRIP, gem: GEM },
    );
    const ids = spec.layers.map((l) => l.id);
    expect(ids).not.toContain('sword:fuller:curved'); // single-edged blades have no fuller
    expect(ids).toContain('sword:pommel:diamond:530');
    expect(ids.slice(-2)).toEqual(['sword:gem', 'sword:gem:glint']);
    const wrapped = swordSpec(
      { ...base, grip: 'wrapped' },
      { metal: METAL, grip: GRIP, gem: null },
    );
    expect(wrapped.layers.map((l) => l.id)).toContain('sword:grip:wrap');
  });

  it('omits the gem when no gem palette is supplied', () => {
    const spec = swordSpec({ ...base, gem: true }, { metal: METAL, grip: GRIP, gem: null });
    expect(spec.layers.map((l) => l.id)).not.toContain('sword:gem');
  });

  it('renders every combination to well-formed markup with a single gradient per palette', () => {
    const blades = ['straight', 'broad', 'curved', 'rapier', 'leaf'] as const;
    const guards = ['bar', 'crescent', 'disc', 'wings'] as const;
    for (const blade of blades) {
      for (const guard of guards) {
        const svg = renderIcon(
          swordSpec({ ...base, blade, guard, gem: true }, { metal: METAL, grip: GRIP, gem: GEM }),
          32,
        );
        expect(svg.startsWith('<svg ')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg.match(/<linearGradient /g)).toHaveLength(3);
      }
    }
  });
});
