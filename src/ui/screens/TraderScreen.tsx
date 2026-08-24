/**
 * The trader, from Screen F: the night as a three-rung ladder with a rail, the other wares
 * below it, the ferryman's terms and the spent ledger down the side. A ware that cannot be
 * afforded yet shows how far the coins have got (the gap bar); Release from the Oath, the one
 * repeatable ware, arms to "Sure?" before it takes anything — it doubles and it moves the hero
 * to the shrine, so it earns the pause the lamps do not.
 */
import { useState } from 'react';
import { simContext } from '../../content/index.ts';
import { FERRYMAN_MULTIPLIER } from '../../sim/skills/combat.ts';
import {
  BASE_NIGHT_HOURS,
  deathLine,
  ferrymanView,
  nightHours,
  wareRows,
  type WareRow,
} from '../derive-trader.ts';
import { lastDeath } from '../derive-combat.ts';
import { formatInt } from '../format.ts';
import { Label, Pops, StatRow, TileBox, UiIcon } from '../parts.tsx';
import type { View } from '../prefs.ts';
import { TRADER_ICON } from '../Shell.tsx';
import { popX } from '../util.ts';
import { ScreenHead } from './common.tsx';
import type { ScreenProps } from './defs.ts';

export const OBOL_ICON = 'lorc/crown-coin';
/** How long the armed "Sure?" on Release holds before falling back to Buy (~4 s). */
const ARM_TICKS = 40;

type Card = 'night' | 'extras';

export function TraderScreen({
  sim,
  dispatch,
  juice,
  onGo,
}: ScreenProps & { onGo: (view: View) => void }) {
  const rows = wareRows(sim, simContext);
  const night = rows.filter((r) => r.ware.effect.kind === 'offline-cap');
  const extras = rows.filter((r) => r.ware.effect.kind !== 'offline-cap');
  const ferry = ferrymanView(sim, simContext);
  const hours = nightHours(sim, simContext);
  const death = lastDeath(sim);
  const [pops, setPops] = useState<
    { key: string; card: Card; text: string; x: number; at: number }[]
  >([]);
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const armed = armedAt !== null && sim.tick - armedAt < ARM_TICKS;
  const livePops = pops.filter((p) => sim.tick - p.at < 11);
  const pop = (card: Card, text: string) => {
    if (juice === 'deadpan') return;
    const at = sim.tick;
    setPops((p) => [
      ...p.filter((x) => at - x.at < 11),
      { key: `${String(at)}:${String(p.length)}`, card, text, x: popX(at + p.length), at },
    ]);
  };
  const buy = (row: WareRow, card: Card) => {
    if (row.ware.effect.kind === 'release-oath') {
      // The doubled price and the walk to the shrine earn a second click; the lamps stay instant.
      if (!armed) {
        setArmedAt(sim.tick);
        return;
      }
      setArmedAt(null);
    }
    dispatch({ type: 'trader:buy', ware: row.ware.id });
    pop(card, `−${formatInt(row.price)} gp`);
  };

  return (
    <>
      <ScreenHead
        icon={TRADER_ICON}
        title="Trader"
        chip={`the night lasts ${String(hours)} h`}
        rate={`${formatInt(sim.coins)} gp`}
      />
      <div className="columns">
        <div className="col-main">
          <div className="card list wares">
            <div className="card-head">
              <Label>The Night</Label>
              <span className="spacer" />
              <span className="hint">starts bare at {String(BASE_NIGHT_HOURS)} h</span>
            </div>
            <div className="card-note">The Trader comes up when it suits.</div>
            {night.map((row, i) => (
              <WareLine
                key={row.ware.id}
                row={row}
                coins={sim.coins}
                armed={false}
                rail={{
                  top: i === 0 ? 'blank' : row.status === 'owned' ? 'on' : 'off',
                  node:
                    row.status === 'owned' ? 'owned' : row.status === 'for-sale' ? 'next' : 'off',
                  bot:
                    i === night.length - 1
                      ? 'blank'
                      : night[i + 1]?.status === 'owned'
                        ? 'on'
                        : 'off',
                }}
                onBuy={() => buy(row, 'night')}
              />
            ))}
            <Pops pops={livePops.filter((p) => p.card === 'night')} gold />
          </div>
          <div className="card list wares">
            <div className="card-head">
              <Label>Other Wares</Label>
            </div>
            {extras.map((row) => (
              <WareLine
                key={row.ware.id}
                row={row}
                coins={sim.coins}
                armed={armed && row.ware.effect.kind === 'release-oath'}
                onBuy={() => buy(row, 'extras')}
              />
            ))}
            <Pops pops={livePops.filter((p) => p.card === 'extras')} gold />
          </div>
        </div>
        <div className="col-side">
          <div className="card ferryman-card">
            <div className="card-head">
              <UiIcon id={OBOL_ICON} size={14} />
              <Label style={{ marginLeft: 8 }}>The Ferryman</Label>
              <span className="spacer" />
              <span className="hint">not for sale</span>
            </div>
            <div className="ferry-terms">
              <TileBox size="md">
                <UiIcon id={OBOL_ICON} size={20} />
              </TileBox>
              <div className="sel-flavour">
                He charges {String(FERRYMAN_MULTIPLIER)}× what the thing is worth, and the thing
                stays on. An obol settles it outright.
              </div>
            </div>
            <div className="stat-block">
              <StatRow k="paying" v={ferry.paying ? 'yes' : 'no'} accent={ferry.paying} />
              <StatRow k="obols in the bank" v={formatInt(ferry.obols)} gold={ferry.obols > 0} />
              <StatRow
                k="a death could cost"
                v={ferry.worst === null ? 'nothing worn' : `up to ${formatInt(ferry.worstFee)} gp`}
                gold={ferry.worst !== null}
              />
              {ferry.worst !== null && <StatRow k="for the" v={ferry.worst.name} />}
            </div>
            {death && (
              <div className="card-foot">last time · {deathLine(death, simContext.content)}</div>
            )}
            <div className="card-foot">
              <button className="linkish" onClick={() => onGo({ kind: 'skill', id: 'combat' })}>
                tell him no on the fight screen →
              </button>
            </div>
          </div>
          <div className="card ferryman-card">
            <div className="card-head">
              <Label>Spent</Label>
            </div>
            <div className="stat-block">
              <StatRow k="coins ever spent" v={`${formatInt(sim.stats.spent)} gp`} />
              <StatRow k="crossings paid" v={formatInt(sim.stats.ferried)} />
              <StatRow k="bank slots bought" v={formatInt(sim.bankSlotsBought)} />
            </div>
            <div className="card-foot">bank slots are bought at the bank's + cell</div>
          </div>
        </div>
      </div>
    </>
  );
}

interface Rail {
  top: 'blank' | 'on' | 'off';
  node: 'owned' | 'next' | 'off';
  bot: 'blank' | 'on' | 'off';
}

function WareLine({
  row,
  coins,
  armed,
  rail,
  onBuy,
}: {
  row: WareRow;
  coins: number;
  armed: boolean;
  rail?: Rail;
  onBuy: () => void;
}) {
  const { ware, status } = row;
  const locked = status === 'locked';
  const dim = locked || row.inert;
  return (
    <div className={`row ware-row${dim ? ' locked' : ''}${status === 'owned' ? ' owned' : ''}`}>
      {rail && (
        <span className="ware-rail" aria-hidden="true">
          <i className={`seg ${rail.top}`} />
          <i className={`node ${rail.node}`} />
          <i className={`seg ${rail.bot}`} />
        </span>
      )}
      <TileBox size="md" dim={dim}>
        <UiIcon id={ware.icon} size={20} />
      </TileBox>
      <span className="body">
        <span className="name">
          {ware.name}
          {status === 'owned' && <span className="tag-active">Owned</span>}
          {row.bought > 0 && !ware.once && (
            <span className="tag-gold">Released ×{String(row.bought)}</span>
          )}
        </span>
        <span className="sub line">{ware.line}</span>
        <span className={`sub effect ${row.tone}`}>{row.sub}</span>
      </span>
      {locked && row.needs !== null ? (
        <span className="lock needs">
          <UiIcon id="lorc/padlock" size={12} className="icon" />
          after {row.needs.name}
        </span>
      ) : status === 'owned' ? null : row.inert ? (
        <span className="ware-buy">
          <span className="ware-note">nothing to release</span>
        </span>
      ) : (
        <span className="ware-buy">
          <span className={row.affordable ? 'price' : 'price short'}>
            {formatInt(row.price)} gp
          </span>
          {!row.affordable && (
            <span className="gap-wrap">
              <span
                className="gap-bar"
                role="progressbar"
                aria-valuenow={Math.round((coins / row.price) * 100)}
              >
                <i
                  className="gap-fill"
                  style={{ width: `${Math.min(100, (coins / row.price) * 100).toFixed(1)}%` }}
                />
              </span>
              <span className="ware-note">{formatInt(row.price - coins)} gp short</span>
            </span>
          )}
          <button
            className={armed ? 'btn sm arm' : 'btn sm primary'}
            disabled={!row.affordable}
            title={
              row.affordable
                ? `buy ${ware.name}`
                : `${ware.name} costs ${formatInt(row.price)} gp; you have ${formatInt(coins)}`
            }
            onClick={onBuy}
          >
            {armed ? `Sure? −${formatInt(row.price)}` : 'Buy'}
          </button>
          {row.nextPrice !== null && (
            <span className="ware-note">next time · {formatInt(row.nextPrice)} gp</span>
          )}
        </span>
      )}
    </div>
  );
}
