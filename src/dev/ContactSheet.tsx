/**
 * Dev-only contact sheet for Phase 2: the material × rarity matrix at bank-cell size and at
 * feed size, ~50 seeded procedural swords, badges, the part catalogue, and the shipped content.
 * The point is to judge the icon system at the sizes it will actually be seen at.
 */

import { useMemo, useState, type ReactNode } from 'react';

import { content } from '../content/index.ts';
import { icons } from '../icons/registry.ts';
import { renderCache, type IconSpec } from '../icons/render.ts';
import type { BadgeKind, ItemStats, MaterialDef } from '../sim/content/schema.ts';
import {
  BLADES,
  GRIPS,
  GUARDS,
  POMMELS,
  rollSword,
  swordPartsKey,
  type SwordParts,
} from '../sim/procedural/sword.ts';
import { ItemTile } from '../ui/items/ItemTile.tsx';
import {
  itemTileSpec,
  rockIconSpec,
  swordIconSpec,
  tileSpec,
  type TileSize,
} from '../ui/items/spec.ts';
import type { Juice } from '../ui/theme/theme.ts';

/** Weapon tier ladder for the sheet: the design's mining tiers, in order. Placeholder until Phase 3. */
const WEAPON_LADDER = ['copper', 'iron', 'basalt', 'silver', 'gold', 'aether'] as const;
const SAMPLE_ICONS = ['faithtoken/ore', 'lorc/broadsword'] as const;
const BADGE_KINDS: BadgeKind[] = ['enchanted', 'upgraded', 'burning', 'locked', 'cursed'];

function iconSpec(iconId: string, material: MaterialDef | null): IconSpec {
  const e = icons.get(iconId);
  return {
    layers: [
      {
        id: e.id,
        d: e.d,
        fill: material
          ? { kind: 'palette', palette: material.palette }
          : { kind: 'flat', color: '#8b887f' },
      },
    ],
  };
}

function statLine(stats: ItemStats): string {
  return Object.entries(stats)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k.slice(0, 3)} ${v > 0 ? '+' : ''}${String(v)}`)
    .join(' ');
}

function Swatch({ m }: { m: MaterialDef }) {
  return (
    <span
      className="swatch"
      title={`${m.palette.highlight} ${m.palette.primary} ${m.palette.shadow}`}
    >
      <i style={{ background: m.palette.highlight }} />
      <i style={{ background: m.palette.primary }} />
      <i style={{ background: m.palette.shadow }} />
    </span>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <>
      <h2>{title}</h2>
      <p className="sub">{sub}</p>
      <div className="panel">{children}</div>
    </>
  );
}

export function ContactSheet() {
  const [juice, setJuice] = useState<Juice>('juicy');
  const [size, setSize] = useState<TileSize>('bank');
  const [, bump] = useState(0);

  const rarities = content.rarities;
  const materials = content.materials;

  const swords = useMemo(() => {
    const out: {
      seed: number;
      parts: SwordParts;
      stats: ItemStats;
      material: string;
      rarity: string;
    }[] = [];
    for (let seed = 1; seed <= 50; seed++) {
      const material = WEAPON_LADDER[(seed - 1) % WEAPON_LADDER.length] ?? 'copper';
      const rarityId = seed % 9 === 0 ? 'epic' : seed % 4 === 0 ? 'rare' : 'common';
      const roll = rollSword(seed, {
        materialRank: WEAPON_LADDER.indexOf(material),
        rarityRank: content.rarity(rarityId).rank,
      });
      out.push({ seed, parts: roll.parts, stats: roll.stats, material, rarity: rarityId });
    }
    return out;
  }, []);

  const matrixCols = `120px repeat(${String(rarities.length * SAMPLE_ICONS.length)}, auto)`;

  return (
    <div className="sheet">
      <h1>Item contact sheet</h1>
      <p className="sub">
        Phase 2 — derived icons: geometry × material palette × rarity treatment × badges. Judge at
        the size you will actually see them.
      </p>
      <div className="controls">
        <span className="label">feel</span>
        <span className="seg">
          {(['deadpan', 'quiet', 'juicy'] as const).map((j) => (
            <button key={j} aria-pressed={juice === j} onClick={() => setJuice(j)}>
              {j}
            </button>
          ))}
        </span>
        <span className="label">tile</span>
        <span className="seg">
          {(['sm', 'md', 'lg', 'xl', 'bank'] as const).map((s) => (
            <button key={s} aria-pressed={size === s} onClick={() => setSize(s)}>
              {s}
            </button>
          ))}
        </span>
        <button
          onClick={() => {
            renderCache.clear();
            bump((n) => n + 1);
          }}
        >
          clear cache
        </button>
      </div>

      <Section
        title="Material × rarity"
        sub={`${String(materials.length)} materials × ${String(rarities.length)} rarities, two base icons, at the ${size} tile. Rarity must read without colour: tag letter + gem.`}
      >
        <div className="matrix" style={{ gridTemplateColumns: matrixCols }}>
          <span />
          {rarities.map((r) =>
            SAMPLE_ICONS.map((ic) => (
              <span key={`${r.id}${ic}`} className="head">
                {r.id}
              </span>
            )),
          )}
          {materials.map((m) => (
            <MatrixRow key={m.id} m={m} juice={juice} size={size} />
          ))}
        </div>
      </Section>

      <Section
        title="Material × rarity at feed size"
        sub="The same matrix at the 30px drop-feed tile (20px icon). This is the smallest the icons appear."
      >
        <div className="matrix" style={{ gridTemplateColumns: matrixCols }}>
          <span />
          {rarities.map((r) =>
            SAMPLE_ICONS.map((ic) => (
              <span key={`${r.id}${ic}`} className="head">
                {r.id}
              </span>
            )),
          )}
          {materials.map((m) => (
            <MatrixRow key={m.id} m={m} juice={juice} size="sm" />
          ))}
        </div>
      </Section>

      <Section
        title="50 procedural swords"
        sub="Seeds 1–50. Material cycles copper → iron → basalt → silver → gold → aether; every 4th is rare, every 9th epic. Stats derive from the same parts as the picture."
      >
        <div className="grid">
          {swords.map((s) => (
            <div className="card" key={s.seed}>
              <ItemTile
                spec={tileSpec(
                  content,
                  swordIconSpec(content, s.parts, s.material, s.rarity),
                  s.rarity,
                  [],
                  { size },
                )}
                rarity={s.rarity}
                juice={juice}
                title={`#${String(s.seed)} ${s.material} ${swordPartsKey(s.parts)}`}
              />
              <span className="name">
                #{s.seed} {s.material}
              </span>
              <span className="stats">{statLine(s.stats)}</span>
            </div>
          ))}
        </div>
        <p className="sub" style={{ marginTop: 16 }}>
          The same fifty at feed size:
        </p>
        <div className="grid dense">
          {swords.map((s) => (
            <ItemTile
              key={s.seed}
              spec={tileSpec(
                content,
                swordIconSpec(content, s.parts, s.material, s.rarity),
                s.rarity,
                [],
                { size: 'sm' },
              )}
              rarity={s.rarity}
              juice={juice}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Sword parts"
        sub="Every blade × guard in iron (top), every grip × pommel on a straight blade (bottom)."
      >
        <div className="grid dense">
          {BLADES.flatMap((blade) =>
            GUARDS.map((guard) => {
              const parts: SwordParts = {
                blade,
                guard,
                grip: 'plain',
                pommel: 'round',
                gem: false,
              };
              return (
                <ItemTile
                  key={`${blade}${guard}`}
                  spec={tileSpec(
                    content,
                    swordIconSpec(content, parts, 'iron', 'common'),
                    'common',
                    [],
                    { size },
                  )}
                  juice={juice}
                  title={swordPartsKey(parts)}
                />
              );
            }),
          )}
        </div>
        <div className="grid dense" style={{ marginTop: 8 }}>
          {GRIPS.flatMap((grip) =>
            POMMELS.map((pommel) => {
              const parts: SwordParts = {
                blade: 'straight',
                guard: 'bar',
                grip,
                pommel,
                gem: true,
              };
              return (
                <ItemTile
                  key={`${grip}${pommel}`}
                  spec={tileSpec(
                    content,
                    swordIconSpec(content, parts, 'silver', 'rare'),
                    'rare',
                    [],
                    { size },
                  )}
                  rarity="rare"
                  juice={juice}
                  title={swordPartsKey(parts)}
                />
              );
            }),
          )}
        </div>
      </Section>

      <Section
        title="Badges"
        sub="Corner marks at 12px on the bottom-left, stacking left to right. Each kind, then combinations."
      >
        <div className="grid dense">
          {BADGE_KINDS.map((b) => (
            <div className="card" key={b}>
              <ItemTile
                spec={tileSpec(
                  content,
                  iconSpec('lorc/broadsword', content.material('iron')),
                  'common',
                  [b],
                  { size },
                )}
                juice={juice}
              />
              <span className="name">{b}</span>
            </div>
          ))}
          <div className="card">
            <ItemTile
              spec={tileSpec(
                content,
                iconSpec('lorc/broadsword', content.material('aether')),
                'epic',
                ['enchanted', 'upgraded'],
                { size },
              )}
              rarity="epic"
              juice={juice}
            />
            <span className="name">epic + 2</span>
          </div>
          <div className="card">
            <ItemTile
              spec={tileSpec(
                content,
                iconSpec('lorc/broadsword', content.material('silver')),
                'rare',
                ['burning', 'cursed', 'locked'],
                { size },
              )}
              rarity="rare"
              juice={juice}
            />
            <span className="name">rare + 3</span>
          </div>
        </div>
      </Section>

      <Section
        title="Shipped content"
        sub="Every item and rock in src/content, rendered from its own material and rarity."
      >
        <div className="grid">
          {content.items.map((item) => (
            <div className="card" key={item.id}>
              <ItemTile
                spec={itemTileSpec(content, item, { size })}
                rarity={item.rarity}
                juice={juice}
                title={item.name}
              />
              <span className="name">{item.name}</span>
            </div>
          ))}
          {content.rocks.map((rock) => (
            <div className="card" key={rock.id}>
              <ItemTile
                spec={tileSpec(content, rockIconSpec(content, rock), 'common', [], { size })}
                juice={juice}
                title={rock.name}
              />
              <span className="name">{rock.name}</span>
            </div>
          ))}
          {content.rocks.slice(0, 2).map((rock) => (
            <div className="card" key={`${rock.id}-locked`}>
              <ItemTile
                spec={tileSpec(content, rockIconSpec(content, rock, true), 'common', [], { size })}
                juice={juice}
              />
              <span className="name">{rock.name} (locked)</span>
            </div>
          ))}
        </div>
      </Section>

      <p className="stat">
        render cache: {renderCache.size} entries · {renderCache.hits} hits · {renderCache.misses}{' '}
        misses
      </p>
    </div>
  );
}

function MatrixRow({ m, juice, size }: { m: MaterialDef; juice: Juice; size: TileSize }) {
  return (
    <>
      <span className="rowhead">
        {m.name}
        <Swatch m={m} />
      </span>
      {content.rarities.map((r) =>
        SAMPLE_ICONS.map((ic) => (
          <ItemTile
            key={`${r.id}${ic}`}
            spec={tileSpec(content, iconSpec(ic, m), r.id, [], { size })}
            rarity={r.id}
            juice={juice}
            title={`${m.id} / ${r.id}`}
          />
        )),
      )}
    </>
  );
}
