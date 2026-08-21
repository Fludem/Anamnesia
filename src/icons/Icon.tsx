import type { CSSProperties } from 'react';

import { ICON_VIEWBOX, type IconEntry } from './types.ts';

export type IconProps = {
  icon: IconEntry;
  /** Rendered size in CSS px. Defaults to 1em so the icon follows the surrounding font size. */
  size?: number | string | undefined;
  /** Fill colour; defaults to currentColor. Phase 2 replaces this with material palettes. */
  color?: string | undefined;
  title?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
};

/**
 * Renders a game-icons entry as an inline <svg>. Monochrome for now — the material / rarity
 * renderer in Phase 2 builds on the same path data.
 */
export function Icon({
  icon,
  size = '1em',
  color = 'currentColor',
  title,
  className,
  style,
}: IconProps) {
  return (
    <svg
      viewBox={ICON_VIEWBOX}
      width={size}
      height={size}
      className={className}
      style={style}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      data-icon={icon.id}
    >
      {title ? <title>{title}</title> : null}
      <path d={icon.d} fill={color} />
    </svg>
  );
}
