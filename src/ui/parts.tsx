/** Small presentational pieces shared by the screens. No sim logic lives here. */
import type { CSSProperties, ReactNode } from 'react';
import { content } from '../content/index.ts';
import type { BadgeKind, ItemDef } from '../sim/content/schema.ts';
import { badgeMark } from './items/badges.ts';
import { BareIcon, ItemTile } from './items/ItemTile.tsx';
import { itemIconSpec, itemTileSpec, type TileSize } from './items/spec.ts';
import type { Juice } from './theme/theme.ts';
import { uiIcon } from './util.ts';

export function UiIcon({ id, size, className }: { id: string; size: number; className?: string }) {
  return <BareIcon spec={uiIcon(id)} size={size} className={className} />;
}

export function SkillIcon({ skill, size }: { skill: string; size: number }) {
  return <UiIcon id={content.skill(skill).icon} size={size} />;
}

/** Uppercase mono section label. */
export function Label({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={className ? `label ${className}` : 'label'} style={style}>
      {children}
    </span>
  );
}

const RARITY_LABEL: Record<string, string> = { rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY' };

/** The RARE / EPIC chip; nothing for common. */
export function RarityTag({ rarity }: { rarity: string }) {
  const text = RARITY_LABEL[rarity];
  return text ? <span className={`rarity-tag ${rarity}`}>{text}</span> : null;
}

/** An item in its tile, at one of the design's sizes. */
export function ItemIconTile({
  item,
  size,
  juice,
  feed,
  title,
}: {
  item: ItemDef;
  size: TileSize;
  juice: Juice;
  feed?: boolean;
  title?: string;
}) {
  return (
    <ItemTile
      spec={itemTileSpec(content, item, { size, feed })}
      rarity={item.rarity}
      feed={feed}
      juice={juice}
      title={title ?? item.name}
    />
  );
}

/** The bare icon of an item (no tile) — for responsive bank cells. */
export function ItemGlyph({ item, size }: { item: ItemDef; size: number }) {
  return <BareIcon spec={itemIconSpec(content, item)} size={size} title={item.name} />;
}

/** Corner badges as tiny discs, for cells the renderer does not draw. */
export function Badges({ kinds, px = 12 }: { kinds: readonly BadgeKind[]; px?: number }) {
  if (kinds.length === 0) return null;
  return (
    <span className="badges">
      {kinds.map((k) => {
        const b = badgeMark(k);
        return (
          <svg key={k} viewBox="0 0 256 256" width={px} height={px} aria-hidden="true">
            <circle cx="128" cy="128" r="128" fill="var(--bg-panel)" />
            <circle cx="128" cy="128" r="101" fill="none" stroke={b.color} strokeWidth="18" />
            <path d={b.d} fill={b.color} />
          </svg>
        );
      })}
    </span>
  );
}

/** A boxed icon slot (the design's 52/36/34/30px tiles) holding any icon. */
export function TileBox({
  size,
  dim,
  children,
}: {
  size: 'xl' | 'md' | 'tool' | 'lg' | 'sm';
  dim?: boolean;
  children: ReactNode;
}) {
  return <div className={`tile-box ${size}${dim ? ' dim' : ''}`}>{children}</div>;
}

/** Floating "+68 xp" pops. `x` is px from the right edge. */
export function Pops({
  pops,
  gold,
}: {
  pops: readonly { key: string; text: string; x: number }[];
  gold?: boolean;
}) {
  return (
    <>
      {pops.map((p) => (
        <div key={p.key} className={gold ? 'pop gold' : 'pop'} style={{ right: p.x }}>
          {p.text}
        </div>
      ))}
    </>
  );
}

/** A label and a value in a `.stat-block`; gold for coins worth noting, accent for a yes. */
export function StatRow({
  k,
  v,
  gold,
  accent,
}: {
  k: string;
  v: string;
  gold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="stat-row">
      <span className="k">{k}</span>
      <span className={`v${gold ? ' gold' : ''}${accent ? ' accent' : ''}`}>{v}</span>
    </div>
  );
}
