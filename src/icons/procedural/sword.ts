/**
 * Sword geometry by component, authored in the 512 icon space with the blade pointing up and
 * rotated −45° at render (tip top-right, like the game-icons swords). Every part is a plain
 * path so the renderer treats a sword like any other icon — only the layer list differs.
 */

import type { IconSpec, Layer, Palette } from '../render.ts';

export interface SwordPartsLike {
  blade: 'straight' | 'broad' | 'curved' | 'rapier' | 'leaf';
  guard: 'bar' | 'crescent' | 'disc' | 'wings';
  grip: 'plain' | 'wrapped' | 'long';
  pommel: 'round' | 'diamond' | 'flat';
  gem: boolean;
}

export interface SwordPalettes {
  /** Blade, guard, pommel. */
  metal: Palette;
  grip: Palette;
  /** Gem in the guard; ignored when `parts.gem` is false. */
  gem: Palette | null;
}

const BLADE: Record<
  SwordPartsLike['blade'],
  { body: string; fuller: string | null; edge: string }
> = {
  straight: {
    body: 'M256 -90L296 30V330H216V30Z',
    fuller: 'M250 40h12v260h-12z',
    edge: 'M256 -90L216 30V330',
  },
  broad: {
    body: 'M256 -90L316 50V330H196V50Z',
    fuller: 'M246 60h20v240h-20z',
    edge: 'M256 -90L196 50V330',
  },
  curved: {
    body: 'M256 -90Q346 130 308 330H220Q236 130 256 -90Z',
    fuller: null,
    edge: 'M256 -90Q236 130 220 330',
  },
  rapier: {
    body: 'M256 -90L278 10V330H234V10Z',
    fuller: 'M252 30h8v280h-8z',
    edge: 'M256 -90L234 10V330',
  },
  leaf: {
    body: 'M256 -90C330 80 330 230 300 330H212C182 230 182 80 256 -90Z',
    fuller: 'M250 50h12v250h-12z',
    edge: 'M256 -90C182 80 182 230 212 330',
  },
};

const GUARD: Record<SwordPartsLike['guard'], string> = {
  bar: 'M162 330H350Q362 330 362 342V354Q362 366 350 366H162Q150 366 150 354V342Q150 330 162 330Z',
  crescent: 'M140 330H372V346C372 392 324 366 256 366C188 366 140 392 140 346Z',
  disc: 'M256 318A90 30 0 1 0 256 378A90 30 0 1 0 256 318Z',
  wings: 'M126 392L256 330L386 392L376 362L256 306L136 362Z',
};

function gripPath(bottom: number): string {
  const b = String(bottom);
  const b12 = String(bottom - 12);
  return `M240 366H272Q284 366 284 378V${b12}Q284 ${b} 272 ${b}H240Q228 ${b} 228 ${b12}V378Q228 366 240 366Z`;
}
const GRIP_BOTTOM: Record<SwordPartsLike['grip'], number> = { plain: 500, wrapped: 500, long: 530 };
const WRAP_STRIPES = 'M228 390L284 412M228 416L284 438M228 442L284 464M228 468L284 490';

function pommelPath(kind: SwordPartsLike['pommel'], y0: number): string {
  const y = (n: number) => String(y0 + n);
  switch (kind) {
    case 'round':
      return `M220 ${y(30)}a36 36 0 1 0 72 0a36 36 0 1 0 -72 0z`;
    case 'diamond':
      return `M256 ${y(-8)}L298 ${y(34)}L256 ${y(76)}L214 ${y(34)}Z`;
    case 'flat':
      return `M222 ${y(0)}H290Q302 ${y(0)} 302 ${y(12)}V${y(28)}Q302 ${y(40)} 290 ${y(40)}H222Q210 ${y(40)} 210 ${y(28)}V${y(12)}Q210 ${y(0)} 222 ${y(0)}Z`;
  }
}

const GEM = 'M238 348a18 18 0 1 0 36 0a18 18 0 1 0 -36 0z';
const GEM_GLINT = 'M246 340a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z';

/** Tip to the top-right; the sword is authored from y=−90 to ~596 so its midpoint is shifted onto the centre first. */
export const SWORD_TRANSFORM = 'rotate(45 256 256) translate(0 3)';

/** Layers in draw order: blade → grip → pommel → guard → gem. */
export function swordSpec(parts: SwordPartsLike, palettes: SwordPalettes): IconSpec {
  const metal: Layer['fill'] = { kind: 'palette', palette: palettes.metal };
  const blade = BLADE[parts.blade];
  const gripBottom = GRIP_BOTTOM[parts.grip];
  const layers: Layer[] = [{ id: `sword:blade:${parts.blade}`, d: blade.body, fill: metal }];
  if (blade.fuller) {
    layers.push({
      id: `sword:fuller:${parts.blade}`,
      d: blade.fuller,
      fill: { kind: 'flat', color: palettes.metal.shadow },
      opacity: 0.55,
    });
  }
  layers.push({
    id: `sword:edge:${parts.blade}`,
    d: blade.edge,
    stroke: palettes.metal.highlight,
    strokeWidth: 10,
    opacity: 0.8,
  });
  layers.push({
    id: `sword:grip:${parts.grip}`,
    d: gripPath(gripBottom),
    fill: { kind: 'palette', palette: palettes.grip },
  });
  if (parts.grip === 'wrapped') {
    layers.push({
      id: 'sword:grip:wrap',
      d: WRAP_STRIPES,
      stroke: palettes.grip.shadow,
      strokeWidth: 10,
      opacity: 0.7,
    });
  }
  layers.push({
    id: `sword:pommel:${parts.pommel}:${String(gripBottom)}`,
    d: pommelPath(parts.pommel, gripBottom),
    fill: metal,
  });
  layers.push({ id: `sword:guard:${parts.guard}`, d: GUARD[parts.guard], fill: metal });
  if (parts.gem && palettes.gem) {
    layers.push({ id: 'sword:gem', d: GEM, fill: { kind: 'palette', palette: palettes.gem } });
    layers.push({
      id: 'sword:gem:glint',
      d: GEM_GLINT,
      fill: { kind: 'flat', color: palettes.gem.highlight },
      opacity: 0.9,
    });
  }
  return { layers, transform: SWORD_TRANSFORM };
}
