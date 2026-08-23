/**
 * A face: how a name (or a hall) appears on the hill. The look it painted, if it has one,
 * else its first letter in the disc the design draws. The disc's size comes from where it
 * sits (`.avatar` in app.css) unless `size` pins it. `LookArt` is the picture alone, for the
 * editor's previews and swatches.
 */
import { useMemo, type CSSProperties } from 'react';
import {
  diamondPoints,
  GRID,
  indexOf,
  lineEnds,
  PALETTE,
  triPoints,
  type Look,
  type Shape,
} from '../look/look.ts';
import { useLook, type LookKind } from './looks.ts';

const hexOf = (c: number): string => PALETTE[c]?.hex ?? 'transparent';

function ShapeArt({ s }: { s: Shape }) {
  const fill = hexOf(s.c);
  switch (s.k) {
    case 'box':
      return <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={fill} />;
    case 'disc':
      return (
        <ellipse cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} fill={fill} />
      );
    case 'tri':
      return (
        <polygon
          points={triPoints(s)
            .map((p) => p.join(','))
            .join(' ')}
          fill={fill}
        />
      );
    case 'diamond':
      return (
        <polygon
          points={diamondPoints(s)
            .map((p) => p.join(','))
            .join(' ')}
          fill={fill}
        />
      );
    case 'line': {
      const [x1, y1, x2, y2] = lineEnds(s);
      return (
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={fill} strokeWidth={1} strokeLinecap="round" />
      );
    }
  }
}

/** One path per colour: every painted cell as a unit square. */
function paintPaths(paint: string): [string, string][] {
  const byColour = new Map<number, string[]>();
  for (let i = 0; i < paint.length; i++) {
    const c = indexOf(paint[i]!);
    if (c === null) continue;
    const x = i % GRID;
    const y = Math.floor(i / GRID);
    const list = byColour.get(c) ?? [];
    list.push(`M${String(x)} ${String(y)}h1v1h-1z`);
    byColour.set(c, list);
  }
  return [...byColour.entries()].map(([c, d]) => [hexOf(c), d.join('')]);
}

/** The picture alone, filling its box. */
export function LookArt({
  look,
  size,
  className,
}: {
  look: Look;
  size?: number;
  className?: string;
}) {
  const paths = useMemo(() => paintPaths(look.paint), [look.paint]);
  return (
    <svg
      viewBox={`0 0 ${String(GRID)} ${String(GRID)}`}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      {look.bg !== null && <rect x={0} y={0} width={GRID} height={GRID} fill={hexOf(look.bg)} />}
      {look.shapes.map((s, i) => (
        <ShapeArt key={i} s={s} />
      ))}
      {paths.map(([fill, d]) => (
        <path key={fill} d={d} fill={fill} shapeRendering="crispEdges" />
      ))}
    </svg>
  );
}

export interface FaceOfProps {
  name: string;
  /** A hall's mark sits in a square; a name's in the disc. */
  kind?: LookKind;
  /** Pixels across; otherwise the place it sits decides. */
  size?: number;
  className?: string;
  title?: string;
}

/** A face for a look already in hand (the editor's previews). */
export function FaceOf({
  look,
  name,
  kind = 'name',
  size,
  className,
  title,
}: FaceOfProps & { look: Look | null | undefined }) {
  const style: CSSProperties | undefined =
    size === undefined
      ? undefined
      : { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) };
  const classes = ['avatar', kind === 'hall' ? 'hall' : '', look ? 'look' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} style={style} title={title} aria-label={title}>
      {look ? <LookArt look={look} /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The face of a name or a hall on the hill, read from the register as needed. */
export function Face(props: FaceOfProps) {
  const look = useLook(props.kind ?? 'name', props.name);
  return <FaceOf {...props} look={look} />;
}
