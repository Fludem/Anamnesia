/**
 * The wheel: one table for the hill, turned by the register every thirty seconds. Left, the
 * table — the house pockets, three rows of twelve, the outside bets — with everyone's chips
 * stacked on it, a chip row to pick a stake, and the strip of last pockets. Right, this name's
 * chips (buy in from the purse, cash out to it), who is at the table, what the last spin did,
 * and the table talk (a room of the hill's chat). The register's clock runs the countdown; this tab's only tells how far
 * off it is. No design screen exists for this either: Screen A's rows and Screen E's columns.
 */
import { useState } from 'react';
import { api } from '../../api/client.ts';
import type { WheelGet } from '../../api/protocol.ts';
import { MAX_BUY_IN, spotOdds, type Spot } from '../../sim/wheel.ts';
import {
  CHIP_VALUES,
  COLUMN_SPOTS,
  GRID_ROWS,
  OUTSIDE_ROW_1,
  OUTSIDE_ROW_2,
  chipText,
  myStake,
  phaseAt,
  spinLine,
  stacks,
  strip,
  wouldPay,
  type Phase,
} from '../derive-wheel.ts';
import { formatInt } from '../format.ts';
import { Modal } from '../overlays/Modal.tsx';
import { Face } from '../Face.tsx';
import { Label, Pops, StatRow } from '../parts.tsx';
import { useWheel } from '../useWheel.ts';
import { popX, useNow } from '../util.ts';
import type { ChatState } from '../useChat.ts';
import { ChatPanel } from './ChatScreen.tsx';
import { ScreenHead } from './common.tsx';
import type { ScreenProps } from './defs.ts';
import { pocketColour, pocketLabel, spotLabel } from '../../sim/wheel.ts';

export const WHEEL_ICON = 'lorc/cartwheel';

/** Stop taking clicks a touch before the register does, so an honest click is never refused. */
const GRACE_MS = 400;

export function WheelScreen({
  sim,
  dispatch,
  juice,
  savedAtMs,
  onSaved,
  chat,
}: ScreenProps & {
  savedAtMs: number | null;
  /** Ask the host to save now, so a cash-out comes home without waiting for the next one. */
  onSaved: () => Promise<void>;
  /** The hill's talk; the table has a room of its own. */
  chat: ChatState;
}) {
  const wheel = useWheel(savedAtMs);
  const localNow = useNow(250);
  const nowMs = localNow + wheel.offsetMs;
  const [chip, setChip] = useState(CHIP_VALUES[1]!);
  const [buying, setBuying] = useState(false);
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
  const onCart = sim.wheel.cart.reduce((n, b) => n + b.coins, 0);
  const buyIn = (coins: number) => {
    dispatch({ type: 'wheel:buy-in', coins });
    pop(`−${formatInt(coins)} gp`);
    setBuying(false);
  };
  const cashOut = async () => {
    const refused = await wheel.act(() => api.cashOut());
    if (refused === null) void onSaved();
  };

  const data = wheel.data;
  if (data === null) {
    return (
      <>
        <ScreenHead icon={WHEEL_ICON} title="The Wheel" chip="reading the register" />
        <div className="card list" style={{ marginTop: 18 }}>
          <div
            className={`row board-note${wheel.error ? ' warn' : ''}`}
            role={wheel.error ? 'alert' : undefined}
          >
            {wheel.error ?? 'reading the register…'}
          </div>
        </div>
      </>
    );
  }

  const phase = phaseAt(data, nowMs);
  const purse = data.purse?.coins ?? 0;
  const piles = stacks(data, sim.player.name);
  const down = myStake(data, sim.player.name);
  const open = phase.kind === 'open' && phase.leftMs > GRACE_MS;
  const canBet = open && purse >= chip;
  const place = (spot: Spot) => {
    if (!canBet) return;
    void wheel.act(() => api.bet(data.round.id, spot, chip));
  };
  const last = data.last[0] ?? null;

  return (
    <>
      <ScreenHead
        icon={WHEEL_ICON}
        title="The Wheel"
        chip={chipFor(phase)}
        rate={`${formatInt(purse)} gp at the table`}
      />
      <div className="columns">
        <div className="col-main">
          {wheel.error && (
            <div className="card list">
              <div className="row board-note warn" role="alert">
                {wheel.error}
              </div>
            </div>
          )}
          <div className={`card wheel-card${open ? '' : ' closed'}`}>
            <div className="card-head">
              <Label>The table</Label>
              <span className="spacer" />
              <span className="hint">
                {down > 0 ? `${formatInt(down)} gp down this spin` : 'nothing down this spin'}
              </span>
            </div>
            <Table piles={piles} phase={phase} chip={chip} canBet={canBet} onPlace={place} />
            <div className="chip-row">
              <span className="hint">a chip is</span>
              {CHIP_VALUES.map((v) => (
                <button
                  key={v}
                  className={`btn sm${v === chip ? ' active' : ''}`}
                  disabled={v > purse}
                  title={v > purse ? `you have ${formatInt(purse)} gp at the table` : undefined}
                  onClick={() => setChip(v)}
                >
                  {chipText(v)}
                </button>
              ))}
            </div>
            <Strip data={data} />
            <Pops pops={livePops} gold />
          </div>
        </div>
        <div className="col-side">
          <div className="card ferryman-card">
            <div className="card-head">
              <Label>Your chips</Label>
              <span className="spacer" />
              <span className="hint">{formatInt(sim.coins)} gp in the purse</span>
            </div>
            <div className="sel-flavour">
              Coins become chips here and nowhere else. The house keeps two pockets in thirty-eight;
              the rest is the wheel's to give.
            </div>
            <div className="stat-block">
              <StatRow k="at the table" v={`${formatInt(purse)} gp`} gold={purse > 0} />
              {onCart > 0 && <StatRow k="being counted" v={`${formatInt(onCart)} gp`} />}
              <StatRow k="ever staked" v={`${formatInt(data.purse?.staked ?? 0)} gp`} />
              <StatRow
                k="ever taken back"
                v={`${formatInt(data.purse?.returned ?? 0)} gp`}
                accent={(data.purse?.returned ?? 0) > (data.purse?.staked ?? 0)}
              />
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                className="btn primary"
                disabled={sim.coins < 1}
                onClick={() => setBuying(true)}
              >
                Buy in…
              </button>
              <button className="btn gold" disabled={purse < 1} onClick={() => void cashOut()}>
                Cash out
              </button>
            </div>
          </div>
          <div className="card ferryman-card">
            <div className="card-head">
              <Label>At the table</Label>
              <span className="spacer" />
              <span className="hint">
                {data.table.length === 0
                  ? 'nobody yet'
                  : `${String(data.table.length)} ${data.table.length === 1 ? 'name' : 'names'}`}
              </span>
            </div>
            {data.table.length > 0 && (
              <div className="stat-block">
                {data.table.map((p) => (
                  <div key={p.name} className="stat-row seat">
                    <Face name={p.name} size={18} />
                    <span className="k">{p.name}</span>
                    <span className={p.name === sim.player.name ? 'v gold' : 'v'}>
                      {formatInt(p.bets.reduce((n, b) => n + b.stake, 0))} gp
                    </span>
                  </div>
                ))}
              </div>
            )}
            {last && <div className="card-foot">last spin · {spinLine(last)}</div>}
          </div>
          <div className="wheel-talk">
            <ChatPanel chat={chat} talk={{ kind: 'room', room: 'wheel' }} title="Table talk" />
          </div>
        </div>
      </div>
      {buying && <BuyIn coins={sim.coins} onCancel={() => setBuying(false)} onBuy={buyIn} />}
    </>
  );
}

function chipFor(phase: Phase): string {
  const s = Math.ceil(phase.leftMs / 1000);
  if (phase.kind === 'open') return `bets close in ${String(s)} s`;
  if (phase.kind === 'turning') return 'the wheel turns';
  return `${pocketLabel(phase.pocket)} · next spin in ${String(s)} s`;
}

// ---- the table ------------------------------------------------------------------------------

function Table({
  piles,
  phase,
  chip,
  canBet,
  onPlace,
}: {
  piles: Map<Spot, { mine: number; all: number }>;
  phase: Phase;
  chip: number;
  canBet: boolean;
  onPlace: (spot: Spot) => void;
}) {
  const hit = phase.kind === 'shown' ? phase.pocket : null;
  const cell = (spot: Spot, label: string, extra = '') => {
    const pile = piles.get(spot);
    return (
      <button
        key={spot}
        className={`spot ${extra}${pile ? ' staked' : ''}${pile?.mine ? ' mine' : ''}`}
        disabled={!canBet}
        title={wouldPay(spot, chip, spotOdds(spot))}
        onClick={() => onPlace(spot)}
      >
        <span className="lbl">{label}</span>
        {pile && <span className={pile.mine ? 'stack mine' : 'stack'}>{chipText(pile.all)}</span>}
      </button>
    );
  };
  const number = (n: number) =>
    cell(
      `straight:${String(n)}`,
      pocketLabel(n),
      `num ${pocketColour(n)}${hit === n ? ' hit' : ''}`,
    );
  return (
    <div className="wheel-table" role="group" aria-label="the table">
      <div className="house">
        {number(0)}
        {number(37)}
      </div>
      <div className="numbers">
        {GRID_ROWS.map((row, i) => (
          <div key={i} className="num-row">
            {row.map(number)}
            {cell(COLUMN_SPOTS[i]!, '2:1', 'outside col')}
          </div>
        ))}
      </div>
      <div className="outside-rows">
        <div className="out-row">{OUTSIDE_ROW_1.map((s) => cell(s, spotLabel(s), 'outside'))}</div>
        <div className="out-row">
          {OUTSIDE_ROW_2.map((s) =>
            cell(s, spotLabel(s), `outside${s === 'red' || s === 'black' ? ` ${s}` : ''}`),
          )}
        </div>
      </div>
    </div>
  );
}

function Strip({ data }: { data: WheelGet }) {
  const pockets = strip(data);
  return (
    <div className="wheel-strip">
      <span className="hint">last spins</span>
      {pockets.length === 0 && <span className="hint">none yet</span>}
      {pockets.map((p) => (
        <span key={p.id} className={`pocket ${p.colour}`} title={`spin ${String(p.id)}`}>
          {p.label}
        </span>
      ))}
    </div>
  );
}

// ---- buying in --------------------------------------------------------------------------------

function BuyIn({
  coins,
  onCancel,
  onBuy,
}: {
  coins: number;
  onCancel: () => void;
  onBuy: (n: number) => void;
}) {
  const max = Math.min(coins, MAX_BUY_IN);
  const [raw, setRaw] = useState(String(Math.min(10_000, max) || 1));
  const n = Math.min(parseInt(raw, 10) || 0, max);
  return (
    <Modal onClose={onCancel}>
      <Label>Buy in</Label>
      <div className="sel-flavour" style={{ marginTop: 10 }}>
        {formatInt(coins)} gp in the purse. What goes to the table comes back only by cashing out,
        and only as much as the wheel left.
      </div>
      <input
        className="amount"
        inputMode="numeric"
        value={raw}
        autoFocus
        onChange={(e) => setRaw(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && n > 0) onBuy(n);
          if (e.key === 'Escape') onCancel();
        }}
        aria-label="Coins to take to the table"
      />
      <div className="chips">
        {[1_000, 10_000, 100_000, 1_000_000].map((v) => (
          <button
            key={v}
            className="btn sm"
            disabled={v > max}
            onClick={() => setRaw(String(Math.min(v, max)))}
          >
            {chipText(v)}
          </button>
        ))}
        <button className="btn sm" onClick={() => setRaw(String(max))}>
          ALL
        </button>
      </div>
      <div className="total">{n > 0 ? `= ${formatInt(n)} gp to the table` : '—'}</div>
      <div className="foot" style={{ marginTop: 12 }}>
        <button className="btn quiet" style={{ flex: 1 }} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn primary"
          style={{ flex: 1 }}
          disabled={n <= 0}
          onClick={() => onBuy(n)}
        >
          Buy in
        </button>
      </div>
    </Modal>
  );
}
