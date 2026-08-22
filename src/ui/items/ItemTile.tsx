import type { CSSProperties } from 'react';

import {
  renderIconCached,
  renderTileCached,
  type IconSpec,
  type TileSpec,
} from '../../icons/render.ts';
import type { Juice } from '../theme/theme.ts';
import { tileGlow } from './spec.ts';

export interface ItemTileProps {
  spec: TileSpec;
  /** Rarity id, used only for the CSS glow (the border/tag are inside the SVG). */
  rarity?: string | undefined;
  feed?: boolean | undefined;
  juice?: Juice | undefined;
  title?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

/** An item in its tile. The SVG comes from the render cache; only the glow is CSS. */
export function ItemTile({
  spec,
  rarity,
  feed,
  juice = 'juicy',
  title,
  className,
  style,
}: ItemTileProps) {
  const glow = juice === 'juicy' && rarity ? tileGlow(rarity, feed) : null;
  return (
    <span
      className={className ? `tile ${className}` : 'tile'}
      title={title}
      style={{
        display: 'inline-block',
        width: spec.size,
        height: spec.size,
        borderRadius: spec.radius,
        boxShadow: glow ?? undefined,
        ...style,
      }}
      dangerouslySetInnerHTML={{ __html: renderTileCached(spec) }}
    />
  );
}

export interface BareIconProps {
  spec: IconSpec;
  size: number;
  title?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

/** An icon with no tile — navigation, headings, inline mentions. */
export function BareIcon({ spec, size, title, className, style }: BareIconProps) {
  return (
    <span
      className={className ? `icon ${className}` : 'icon'}
      title={title}
      style={{ display: 'inline-block', width: size, height: size, lineHeight: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: renderIconCached(spec, size) }}
    />
  );
}
