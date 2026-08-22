import { BADGE_GLYPHS, type BadgeGlyph } from '../../icons/badges.ts';
import type { BadgeMark } from '../../icons/render.ts';
import type { BadgeKind } from '../../sim/content/schema.ts';
import { color, rarity } from '../theme/theme.ts';

/** Which glyph and colour each badge kind draws with. Colours are theme tokens, not new hues. */
const BADGE_STYLE: Record<BadgeKind, { glyph: BadgeGlyph; color: string }> = {
  enchanted: { glyph: 'bolt', color: rarity['epic']?.color ?? color.accent },
  upgraded: { glyph: 'arrowUp', color: color.accent },
  burning: { glyph: 'fire', color: color.gold },
  locked: { glyph: 'lock', color: color.fg3 },
  cursed: { glyph: 'exclamation', color: color.fgSoft },
};

export function badgeMark(kind: BadgeKind): BadgeMark {
  const s = BADGE_STYLE[kind];
  return { id: kind, d: BADGE_GLYPHS[s.glyph], color: s.color };
}
