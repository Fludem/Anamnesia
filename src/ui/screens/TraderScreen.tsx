/**
 * The trader: what the hill takes coins for. Left, the wares in content order — price, a buy
 * button or an owned mark, a lock on the rungs that wait on another. Right, the ferryman's
 * terms and what a death would cost now. No design screen exists for this; it is Screen A's
 * rows and Screen E's columns, like the highscores.
 */
import { useState } from 'react';
import { simContext } from '../../content/index.ts';
import { FERRYMAN_MULTIPLIER } from '../../sim/skills/combat.ts';
import { deathLine, ferrymanView, nightHours, wareRows, type WareRow } from '../derive-trader.ts';
import { lastDeath } from '../derive-combat.ts';
import { formatInt } from '../format.ts';
import { Label, Pops, TileBox, UiIcon } from '../parts.tsx';
import { TRADER_ICON } from '../Shell.tsx';
import { popX } from '../util.ts';
import { ScreenHead } from './common.tsx';
import type { ScreenProps } from './defs.ts';

export const OBOL_ICON = 'lorc/crown-coin';

export function TraderScreen({ sim, dispatch, juice }: ScreenProps) {
  const rows = wareRows(sim, simContext);
  const ferry = ferrymanView(sim, simContext);
  const night = nightHours(sim, simContext);
  const death = lastDeath(sim);
  const [pops, setPops] = useState<{ key: string; text: string; x: number; at: number }[]>([]);
  const livePops = pops.filter((p) => sim.tick - p.at < 11);
  const pop = (text: string) => {
    if (juice === 'deadpan') return;
    const at = sim.tick;
    setPops((p) => [
      ...p.filter((x) => at - x.at < 11),
      { key: `${String(at)}:${String(p.length)}`, text, x: popX(at + p.length), at },
    ]);
  };
  const buy = (row: WareRow) => {
    dispatch({ type: 'trader:buy', ware: row.ware.id });
    pop(`−${formatInt(row.price)} gp`);
  };

  return (
    <>
      <ScreenHead
        icon={TRADER_ICON}
        title="Trader"
        chip={`the night lasts ${String(night)} h`}
        rate={`${formatInt(sim.coins)} gp`}
      />
      <div className="columns">
        <div className="col-main">
          <div className="card list wares">
            <div className="card-head">
              <Label>Wares</Label>
              <span className="spacer" />
              <span className="hint">
                The Trader comes up when it suits. The prices do not move.
              </span>
            </div>
            {rows.map((row) => (
              <WareLine key={row.ware.id} row={row} coins={sim.coins} onBuy={() => buy(row)} />
            ))}
            <Pops pops={livePops} gold />
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
            <div className="sel-flavour">
              He charges {String(FERRYMAN_MULTIPLIER)}× what the thing is worth, and the thing stays
              on. An obol settles it outright. Tell him no on the fight screen.
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
          </div>
        </div>
      </div>
    </>
  );
}

function WareLine({ row, coins, onBuy }: { row: WareRow; coins: number; onBuy: () => void }) {
  const { ware, status } = row;
  const locked = status === 'locked';
  return (
    <div className={`row ware-row${locked ? ' locked' : ''}${status === 'owned' ? ' owned' : ''}`}>
      <TileBox size="md" dim={locked}>
        <UiIcon id={ware.icon} size={20} />
      </TileBox>
      <span className="body">
        <span className="name">
          {ware.name}
          {status === 'owned' && <span className="tag-active">Owned</span>}
        </span>
        <span className="sub">{ware.line}</span>
        <span className="sub">{row.sub}</span>
      </span>
      {locked && row.needs !== null ? (
        <span className="lock needs">
          <UiIcon id="lorc/padlock" size={12} className="icon" />
          after {row.needs.name}
        </span>
      ) : status === 'owned' ? null : (
        <span className="ware-buy">
          <span className={row.affordable ? 'price' : 'price short'}>
            {formatInt(row.price)} gp
          </span>
          <button
            className="btn sm primary"
            disabled={!row.affordable}
            title={
              row.affordable
                ? `buy ${ware.name}`
                : `${ware.name} costs ${formatInt(row.price)} gp; you have ${formatInt(coins)}`
            }
            onClick={onBuy}
          >
            Buy
          </button>
        </span>
      )}
    </div>
  );
}

function StatRow({
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
