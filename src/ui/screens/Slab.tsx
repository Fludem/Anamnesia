/**
 * The slab — the flat stone by the water a fish is laid on to be measured. One row per kind
 * the hill gives: the biggest ever landed, drawn against the whole band that kind comes in,
 * with the trophy line marked on it. It sits under the drop feed on the Fishing screen, so
 * the collection lives beside the fishing rather than in a room of its own.
 */
import { content, simContext } from '../../content/index.ts';
import type { SimState } from '../../sim/save.ts';
import { slabView, type SlabRow } from '../derive-slab.ts';
import { formatGrams, formatInt } from '../format.ts';
import { BareIcon } from '../items/ItemTile.tsx';
import { itemIconSpec } from '../items/spec.ts';
import { Label, TileBox, UiIcon } from '../parts.tsx';

export const TROPHY_ICON = 'delapouite/trophy-cup';

export function Slab({ sim }: { sim: SimState }) {
  const view = slabView(sim, content, simContext);
  return (
    <div className="card slab">
      <div className="card-head" style={{ padding: '8px 14px 6px' }}>
        <Label>The Slab</Label>
        <span className="spacer" />
        <span className="hint">
          {String(view.weighed)} / {String(view.kinds)} weighed
        </span>
      </div>
      <div className="slab-note">
        Every catch is weighed. The biggest of each stays here — and the trader pays for the first
        one worth talking about.
      </div>
      {view.rows.map((row) => (
        <SlabLine key={row.fish.id} row={row} />
      ))}
      <div className="slab-foot">
        {view.won === view.kinds ? (
          <>the slab is full · nothing left to weigh</>
        ) : (
          <>
            {String(view.won)} of {String(view.kinds)} trophies · {formatInt(view.owed)} gp still
            unclaimed
          </>
        )}
      </div>
    </div>
  );
}

/** One kind: the tile, the best, the band it was drawn from, and the line to beat. */
function SlabLine({ row }: { row: SlabRow }) {
  const name = row.fish.name.replace(/^Raw /, '');
  const empty = row.best === 0;
  return (
    <div
      className={`slab-row${row.won ? ' won' : ''}${row.locked ? ' locked' : ''}`}
      title={`${name} · ${row.water.name} · ${formatGrams(row.band.min)}–${formatGrams(row.band.max)}`}
    >
      <TileBox size="sm" dim={empty}>
        <BareIcon spec={itemIconSpec(content, row.fish, empty)} size={16} />
      </TileBox>
      <div className="body">
        <div className="slab-line">
          <span className="name">{name}</span>
          <span className="spacer" />
          <span className={empty ? 'best none' : 'best'}>
            {empty ? '—' : formatGrams(row.best)}
          </span>
        </div>
        <div
          className="band"
          role="img"
          aria-label={
            empty
              ? `${name}: never landed; the trophy is ${formatGrams(row.trophy)}`
              : `${name}: best ${formatGrams(row.best)} of a band to ${formatGrams(row.band.max)}`
          }
        >
          <div className="band-fill" style={{ width: `${(row.into * 100).toFixed(1)}%` }} />
          <div
            className={`band-line${row.won ? ' won' : ''}`}
            style={{ left: `${(row.trophyInto * 100).toFixed(1)}%` }}
          />
        </div>
        <div className="slab-sub">{subLine(row)}</div>
      </div>
      {row.won && (
        <span className="slab-trophy" title={`paid ${formatInt(row.bounty)} gp`}>
          <UiIcon id={TROPHY_ICON} size={13} />
        </span>
      )}
    </div>
  );
}

/** What the row still wants: the water, the level, or the coins waiting on the line. */
function subLine(row: SlabRow): string {
  const trophy = formatGrams(row.trophy);
  if (row.won) return `trophy ${trophy} · paid ${formatInt(row.bounty)} gp`;
  if (row.locked) return `${row.water.name} · Lv ${String(row.water.level)} to fish it`;
  if (row.outOfReach) {
    return `trophy ${trophy} · out of reach until Lv ${String(row.opensAt)}`;
  }
  return `trophy ${trophy} · ${formatInt(row.bounty)} gp`;
}
