/**
 * The wheel, as Screen H drew it: one table for the hill, turned by the register every thirty
 * seconds. Left, the table — the house column, three rows of twelve, the outside bets — every
 * spot a button with everyone's chips pilled on it (mine gold, at a glance), a drain bar
 * counting the open seconds down, the stake row, and the strip of last pockets. Bets are staked
 * straight from the purse and can be taken back (right-click a spot, or all of them) until the
 * bets close; what the wheel gives comes home with the next save. Right, this name's ledger,
 * who is at the table, and the table talk. Between rounds the drawn pocket stands over the
 * table for a few seconds — the reveal — unless the juice is deadpan.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import type { WheelGet } from '../../api/protocol.ts';
import {
  BETS_MS,
  payout,
  pocketColour,
  pocketLabel,
  spotWins,
  type Spot,
} from '../../sim/wheel.ts';
import {
  CHIP_VALUES,
  COLUMN_SPOTS,
  GRID_ROWS,
  OUTSIDE_ROW_1,
  OUTSIDE_ROW_2,
  REVEAL_MS,
  chipText,
  closing,
  colourWord,
  myStake,
  phaseAt,
  revealAt,
  spinLine,
  spotTip,
  stacks,
  strip,
  type Phase,
} from '../derive-wheel.ts';
import { Face } from '../Face.tsx';
import { formatInt } from '../format.ts';
import { Label, StatRow } from '../parts.tsx';
import { useWheel } from '../useWheel.ts';
import { useNow } from '../util.ts';
import type { ChatState } from '../useChat.ts';
import { ChatPanel } from './ChatScreen.tsx';
import { ScreenHead } from './common.tsx';
import type { ScreenProps } from './defs.ts';
import { spotLabel } from '../../sim/wheel.ts';

export const WHEEL_ICON = 'lorc/cartwheel';

/** Stop taking clicks a touch before the register does, so an honest click is never refused. */
const GRACE_MS = 400;

/** The outside row wears its short names; the labels never lean on colour alone. */
const SHORT_LABELS: Record<string, string> = {
  low: '1–18',
  even: 'even',
  red: 'red',
  black: 'black',
  odd: 'odd',
  high: 'high',
};

const kindOf = (spot: Spot): 'red' | 'black' | 'house' | 'out' => {
  if (spot.startsWith('straight:')) return pocketColour(Number(spot.slice(9)));
  return spot === 'red' || spot === 'black' ? spot : 'out';
};

export function WheelScreen({
  sim,
  dispatch,
  juice,
  savedAtMs,
  onSaved,
  chat,
}: ScreenProps & {
  savedAtMs: number | null;
  /** Ask the host to save now, so what the wheel owes comes home without waiting. */
  onSaved: () => Promise<void>;
  /** The hill's talk; the table has a room of its own. */
  chat: ChatState;
}) {
  const wheel = useWheel(savedAtMs);
  const localNow = useNow(250);
  const nowMs = localNow + wheel.offsetMs;
  const [chip, setChip] = useState(CHIP_VALUES[1]!);
  const me = sim.player.name;

  // Winnings and take-backs sit at the register until a save carries them home; ask for one
  // the moment a settled round shows this name won something.
  const paidRound = useRef(-1);
  const data = wheel.data;
  useEffect(() => {
    if (data === null || data.round.pocket === null || paidRound.current === data.round.id) return;
    paidRound.current = data.round.id;
    const got = data.table
      .filter((p) => p.name === me)
      .flatMap((p) => p.bets)
      .reduce((n, b) => n + payout(b.stake, b.spot, data.round.pocket!), 0);
    if (got > 0) void onSaved();
  }, [data, me, onSaved]);

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
  const isClosing = closing(phase);
  const down = myStake(data, me);
  const owed = data.purse?.coins ?? 0;
  const open = phase.kind === 'open' && phase.leftMs > GRACE_MS;
  const place = (spot: Spot) => {
    void wheel
      .act(() => api.bet(data.round.id, spot, chip))
      .then((refused) => {
        if (refused === null) dispatch({ type: 'wheel:stake', coins: chip });
      });
  };
  const takeBack = (spot?: Spot) => {
    void wheel
      .act(() => api.takeBack(data.round.id, spot))
      .then((refused) => {
        if (refused === null) void onSaved();
      });
  };
  const last = data.last[0] ?? null;

  return (
    <>
      <ScreenHead
        icon={WHEEL_ICON}
        title="The Wheel"
        chip={chipFor(phase)}
        chipGold={isClosing}
        rate={
          <>
            <span className={down > 0 ? 'gold' : ''}>{formatInt(down)}</span> gp down this spin
          </>
        }
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
            <div className="wheel-drain">
              {phase.kind === 'open' && (
                <span
                  className={isClosing ? 'fill closing' : 'fill'}
                  style={{ width: `${((phase.leftMs / BETS_MS) * 100).toFixed(2)}%` }}
                />
              )}
            </div>
            <div className="card-head">
              <Label>The table</Label>
              <span className="hint">
                {down > 0 ? `${formatInt(down)} gp down this spin` : 'nothing down this spin'}
              </span>
              <span className="spacer" />
              <span className={`wheel-count${isClosing ? ' closing' : ''}`}>
                <span className="cl">
                  {phase.kind === 'open'
                    ? 'bets close in'
                    : phase.kind === 'turning'
                      ? 'the wheel turns'
                      : 'next spin in'}
                </span>
                {phase.kind !== 'turning' && (
                  <>
                    <span className="big">
                      {String(Math.max(0, Math.ceil(phase.leftMs / 1000)))}
                    </span>
                    <span className="unit">s</span>
                  </>
                )}
              </span>
            </div>
            <Table
              data={data}
              phase={phase}
              open={open}
              canPlace={open && chip <= sim.coins}
              me={me}
              onPlace={place}
              onTakeBack={takeBack}
            />
            <div className="chip-row">
              <span className="hint">a chip is</span>
              {CHIP_VALUES.map((v) => (
                <button
                  key={v}
                  className={`stake${v === chip ? ' active' : ''}`}
                  disabled={v > sim.coins}
                  title={v > sim.coins ? 'more than the purse holds' : `${formatInt(v)} gp a click`}
                  onClick={() => setChip(v)}
                >
                  {chipText(v)}
                </button>
              ))}
              <span className="spacer" />
              <span className={`hint${sim.coins === 0 ? ' gold' : ''}`}>
                {sim.coins === 0
                  ? 'the purse is empty'
                  : open
                    ? 'a click places · right-click takes it back'
                    : 'the table is closed'}
              </span>
            </div>
            <Strip data={data} />
          </div>
        </div>
        <div className="col-side">
          <div className="card">
            <div className="card-head">
              <Label>Your stake</Label>
              <span className="spacer" />
              <span className="hint">straight from the purse</span>
            </div>
            <div className="sel-flavour">
              The house keeps two pockets in thirty-eight; the rest is the wheel's to give. What it
              gives comes home with the next save.
            </div>
            <div className="stat-block">
              <StatRow k="down this spin" v={`${formatInt(down)} gp`} gold={down > 0} />
              <StatRow k="in the purse" v={`${formatInt(sim.coins)} gp`} />
              {owed > 0 && <StatRow k="coming home" v={`${formatInt(owed)} gp`} accent />}
              <StatRow k="ever staked" v={`${formatInt(data.purse?.staked ?? 0)} gp`} />
              <StatRow
                k="ever taken back"
                v={`${formatInt(data.purse?.returned ?? 0)} gp`}
                accent={(data.purse?.returned ?? 0) > (data.purse?.staked ?? 0)}
              />
            </div>
            <div className="wheel-takeall">
              <button className="btn sm" disabled={!(down > 0 && open)} onClick={() => takeBack()}>
                Take it all back
              </button>
              <span className="hint">until bets close</span>
            </div>
          </div>
          <div className="card">
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
                  <div key={p.name} className={`stat-row seat${p.name === me ? ' you' : ''}`}>
                    <Face name={p.name} size={18} />
                    <span className="k">{p.name === me ? 'You' : p.name}</span>
                    <span className={p.name === me ? 'v gold' : 'v'}>
                      {formatInt(p.bets.reduce((n, b) => n + b.stake, 0))} gp
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="card-foot">
              last spin · {last ? spinLine(last, me) : 'nobody had a bet down'}
            </div>
          </div>
          <div className="wheel-talk">
            <ChatPanel chat={chat} talk={{ kind: 'room', room: 'wheel' }} title="Table talk" />
          </div>
        </div>
      </div>
      {juice !== 'deadpan' &&
        phase.kind !== 'open' &&
        nowMs < data.round.closesAt + REVEAL_MS + 250 && (
          <SpinOverlay data={data} me={me} offsetMs={wheel.offsetMs} />
        )}
    </>
  );
}

function chipFor(phase: Phase): string {
  const s = Math.max(0, Math.ceil(phase.leftMs / 1000));
  if (phase.kind === 'open') return `bets close in ${String(s)} s`;
  if (phase.kind === 'turning') return 'the wheel turns';
  return `${pocketLabel(phase.pocket)} · next spin in ${String(s)} s`;
}

// ---- the table ------------------------------------------------------------------------------

function Table({
  data,
  phase,
  open,
  canPlace,
  me,
  onPlace,
  onTakeBack,
}: {
  data: WheelGet;
  phase: Phase;
  open: boolean;
  canPlace: boolean;
  me: string;
  onPlace: (spot: Spot) => void;
  onTakeBack: (spot: Spot) => void;
}) {
  const piles = stacks(data, me);
  const pocket = phase.kind === 'shown' ? phase.pocket : null;
  const cell = (
    spot: Spot,
    label: string,
    col: string,
    row: string,
    style: '' | ' small' | ' small inline' = '',
  ) => {
    const kind = kindOf(spot);
    const pile = piles.get(spot);
    const mine = pile?.mine ?? 0;
    const others = (pile?.all ?? 0) - mine;
    const hit = pocket !== null && spot === `straight:${String(pocket)}`;
    const win = pocket !== null && !hit && spotWins(spot, pocket);
    const dim = !open && !hit && !win;
    return (
      <button
        key={spot}
        type="button"
        className={`spot ${kind}${style}${dim ? ' dim' : ''}${hit ? ' hit' : ''}${win ? ' win' : ''}`}
        style={{ gridColumn: col, gridRow: row }}
        aria-disabled={!canPlace}
        title={spotTip(spot, mine)}
        onClick={() => {
          if (canPlace) onPlace(spot);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (open && mine > 0) onTakeBack(spot);
        }}
      >
        {kind !== 'out' && <span className="mark" />}
        <span className="lbl">{label}</span>
        {(mine > 0 || others > 0) && (
          <span className="stack">
            {others > 0 && (
              <span className={`pill others${mine > 0 ? ' tucked' : ''}`}>{chipText(others)}</span>
            )}
            {mine > 0 && <span className="pill mine">{chipText(mine)}</span>}
          </span>
        )}
      </button>
    );
  };
  return (
    <div className="wheel-grid" role="group" aria-label="the table">
      {cell('straight:0', '0', '1', '1 / span 3')}
      {cell('straight:37', '00', '1', '4 / span 3')}
      {GRID_ROWS.flatMap((rowNums, r) =>
        rowNums.map((n, i) =>
          cell(
            `straight:${String(n)}`,
            pocketLabel(n),
            String(i + 2),
            `${String(r * 2 + 1)} / span 2`,
          ),
        ),
      )}
      {COLUMN_SPOTS.map((s, i) => cell(s, '2:1', '14', `${String(i * 2 + 1)} / span 2`, ' small'))}
      {OUTSIDE_ROW_1.map((s, i) =>
        cell(s, spotLabel(s), `${String(2 + i * 4)} / span 4`, '7', ' small inline'),
      )}
      {OUTSIDE_ROW_2.map((s, i) =>
        cell(
          s,
          SHORT_LABELS[s] ?? spotLabel(s),
          `${String(2 + i * 2)} / span 2`,
          '8',
          ' small inline',
        ),
      )}
    </div>
  );
}

function Strip({ data }: { data: WheelGet }) {
  const pockets = strip(data);
  return (
    <div className="wheel-strip">
      <Label>Last spins</Label>
      {pockets.length === 0 && <span className="hint">none yet</span>}
      {pockets.map((p, i) => (
        <span key={p.id} className={`pocket ${p.colour}${i === 0 ? ' latest' : ''}`} title={p.word}>
          <span className="mark" />
          {p.label}
        </span>
      ))}
    </div>
  );
}

// ---- the reveal -----------------------------------------------------------------------------

/**
 * Between the close and the next round, the drawn pocket stands over the table: a turning face
 * while the register has not answered, the pocket with its weight once it has, then out. Runs
 * its own quick clock — it lives a few seconds at a time.
 */
function SpinOverlay({ data, me, offsetMs }: { data: WheelGet; me: string; offsetMs: number }) {
  const now = useNow(90) + offsetMs;
  const r = revealAt(data, me, now);
  if (r === null) return null;
  const landed = r.pocket !== null;
  const face = landed ? r.pocket! : (Math.floor(now / 80) * 7) % 38;
  const colour = pocketColour(face);
  return (
    <div className={`spin-scrim${r.fading ? ' fading' : ''}`}>
      <div className={`spin-panel${landed ? ` landed ${colour}` : ''}`}>
        <div className="spin-label">
          {landed ? `${pocketLabel(r.pocket!)} · ${colourWord(r.pocket!)}` : 'the wheel turns'}
        </div>
        <div className={`spin-face ${colour}${landed ? ' landed' : ''}`}>
          {landed && <span className="mark" />}
          <span className="num">{pocketLabel(face)}</span>
        </div>
        <div className="spin-sub">
          {landed ? `next spin in ${String(r.leftS)} s` : 'the register draws'}
        </div>
        {landed && (r.got > 0 || r.put > 0) && (
          <div className={`spin-outcome${r.got > 0 ? ' gold' : ''}`}>
            {r.got > 0
              ? `you took ${formatInt(r.got)} gp for ${formatInt(r.put)}`
              : `the house took ${formatInt(r.put)} gp`}
          </div>
        )}
      </div>
    </div>
  );
}
