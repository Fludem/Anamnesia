/**
 * The ring: the one place on the hill where a name's loss is another name's doing. You step
 * in, you call somebody out for a thing they are wearing, and the register — not this tab and
 * not theirs — fights the two saves and says who kept it. Neither of you has to be there.
 *
 * The card in the middle is the bout replayed. It is not a retelling the screen is asked to
 * trust: the row carries both fighters and the seed, so `boutView` re-runs the very same
 * `fightBout` the register decided it with, and the blows drawn here are the blows that were
 * paid out. What changes hands arrives with this name's next save, not with the answer.
 */
import { useEffect, useRef, useState } from 'react';
import { content, simContext } from '../../content/index.ts';
import type { BoutRow, RingCard, RingName, RingWorn } from '../../api/protocol.ts';
import { fighterFrom } from '../../sim/bout.ts';
import { TICK_MS } from '../../sim/constants.ts';
import { Modal } from '../overlays/Modal.tsx';
import {
  boutView,
  callBar,
  oddsAgainst,
  playable,
  restLine,
  statsLine,
  type BoutSideView,
} from '../derive-bout.ts';
import { formatAge, formatInt } from '../format.ts';
import { Face } from '../Face.tsx';
import { Label, TileBox, UiIcon } from '../parts.tsx';
import { itemIconSpec } from '../items/spec.ts';
import { BareIcon } from '../items/ItemTile.tsx';
import { useRing } from '../useRing.ts';
import { ScreenHead } from './common.tsx';
import type { ScreenProps } from './defs.ts';

export const RING_ICON = 'sbed/duel';

/** Ticks of the replay drawn per animation frame step; a bout runs at the sim's own pace. */
const REPLAY_STEP_MS = TICK_MS;

export interface RingScreenProps extends ScreenProps {
  savedAtMs: number | null;
}

export function RingScreen({ sim, dispatch, juice, savedAtMs }: RingScreenProps) {
  const ring = useRing(savedAtMs);
  const [target, setTarget] = useState<{ name: string; card: RingCard } | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const me = fighterFrom(sim, simContext, sim.player.name);
  const stepped = sim.combat.bouts.open;
  const bar = ring.data ? callBar(ring.data) : null;

  const open = async (name: string) => {
    setAsking(name);
    setRefusal(null);
    const got = await ring.card(name);
    setAsking(null);
    if (typeof got === 'string') setRefusal(got);
    else setTarget({ name, card: got });
  };

  const callOut = async (name: string, item: string) => {
    const said = await ring.call(name, item);
    setTarget(null);
    if (said !== null) setRefusal(said);
  };

  return (
    <>
      <ScreenHead
        icon={RING_ICON}
        title="The Ring"
        chip={stepped ? 'stepped in' : 'barred'}
        chipGold={stepped}
        rate={
          ring.data
            ? `${formatInt(ring.data.names.length)} in the ring · ${formatInt(sim.stats.taken)} taken, ${formatInt(sim.stats.lost)} lost`
            : 'reading the register'
        }
      />
      <div className="columns">
        <div className="col-main">
          <StepRow sim={sim} dispatch={dispatch} owed={ring.data?.owed ?? 0} />
          {refusal !== null && (
            <div className="card list">
              <div className="row board-note warn" role="alert">
                {refusal}
              </div>
            </div>
          )}
          {ring.fought !== null && (
            <BoutCard
              key={ring.fought.bout.id}
              row={ring.fought.bout}
              you={sim.player.name}
              juice={juice}
              onClose={ring.forget}
            />
          )}
          <div className="card list">
            <div className="card-head">
              <Label>Who is in</Label>
              <span className="spacer" />
              <span className="hint">{bar ?? 'call one out for something they are wearing'}</span>
            </div>
            {ring.data === null && (
              <div className="row">{ring.error ?? 'reading the register…'}</div>
            )}
            {ring.data?.names.length === 0 && (
              <div className="row">
                <div className="body">
                  <div className="name">Nobody else has stepped in</div>
                  <div className="sub">
                    The ring is empty but for you. It fills when other names step in.
                  </div>
                </div>
              </div>
            )}
            {ring.data?.names.map((n) => (
              <NameRow
                key={n.name}
                name={n}
                odds={oddsAgainst(me, me)}
                busy={asking === n.name}
                barred={bar}
                onOpen={() => void open(n.name)}
              />
            ))}
          </div>
        </div>
        <BoutFeed bouts={ring.data?.bouts ?? []} you={sim.player.name} />
      </div>
      {target !== null && (
        <PickModal
          card={target.card}
          onClose={() => setTarget(null)}
          onCall={(item) => void callOut(target.name, item)}
        />
      )}
    </>
  );
}

/** Step into the ring, or out of it. Barred is where every name starts. */
function StepRow({
  sim,
  dispatch,
  owed,
}: {
  sim: ScreenProps['sim'];
  dispatch: ScreenProps['dispatch'];
  owed: number;
}) {
  const open = sim.combat.bouts.open;
  const fought = sim.stats.bouts;
  return (
    <div className="card food-row">
      <Label>The ring</Label>
      <TileBox size="md" dim={!open}>
        <UiIcon id={RING_ICON} size={18} />
      </TileBox>
      <div style={{ minWidth: 0 }}>
        <div className="name">{open ? 'Stepped In' : 'Out Of The Ring'}</div>
        <div className="sub">
          {open
            ? 'any name in the ring may call you out for something you are wearing, and you them'
            : 'Nobody may call you out, and you may call nobody. The ring is opt in, both ways.'}
          {fought > 0
            ? ` · ${formatInt(fought)} fought, ${formatInt(sim.stats.taken)} taken, ${formatInt(sim.stats.lost)} lost`
            : ''}
          {owed > 0 ? ` · you owe the ring ${formatInt(owed)} gp` : ''}
        </div>
      </div>
      <span className="spacer" />
      <button
        className="btn sm"
        style={{ padding: '6px 12px' }}
        title={
          open
            ? 'step out: nobody may call you out, and you may call nobody'
            : 'step in: what you are wearing is what you are playing for'
        }
        onClick={() => dispatch({ type: 'combat:bouts', open: !open })}
      >
        {open ? 'Step out' : 'Step in'}
      </button>
    </div>
  );
}

function NameRow({
  name,
  busy,
  barred,
  onOpen,
}: {
  name: RingName;
  odds: number;
  busy: boolean;
  barred: string | null;
  onOpen: () => void;
}) {
  const resting = name.restMs > 0;
  return (
    <div className={resting ? 'row locked' : 'row'}>
      <Face name={name.name} size={30} />
      <div className="body">
        <div className="name">{name.name}</div>
        <div className="sub">
          level {formatInt(name.level)} · {formatInt(name.bouts)} fought, {formatInt(name.taken)}{' '}
          taken ·{' '}
          {name.seenAgoMs < 90_000 ? 'on the hill now' : `seen ${formatAge(name.seenAgoMs)} ago`}
        </div>
      </div>
      <span className="spacer" />
      {resting ? (
        <span className="chip">rests {restLine(name.restMs)}</span>
      ) : (
        <button
          className="btn sm"
          disabled={busy || barred !== null}
          title={barred ?? `see what ${name.name} is wearing`}
          onClick={onOpen}
        >
          {busy ? '…' : 'Call out'}
        </button>
      )}
    </div>
  );
}

/** What they are wearing, and what each piece would cost you to play for. */
function PickModal({
  card,
  onClose,
  onCall,
}: {
  card: RingCard;
  onClose: () => void;
  onCall: (item: string) => void;
}) {
  return (
    <Modal onClose={onClose} tone="accent">
      <div className="card-head">
        <Label>Call out {card.name}</Label>
      </div>
      <div className="sub" style={{ padding: '0 16px 10px' }}>
        Play for one thing they are wearing. You put up what you wear in the same slot, and it must
        be worth at least as much — you can only play for a helm by wagering your helm. The register
        fights it the moment you ask.
      </div>
      <div className="sub" style={{ padding: '0 16px 12px', color: 'var(--fg-3)' }}>
        {statsLine(card.fighter)}
      </div>
      <div className="card list" style={{ margin: 0 }}>
        {playable(card).map((w) => (
          <WornRow key={w.slot} worn={w} onCall={() => onCall(w.item)} />
        ))}
        {card.worn.length === 0 && (
          <div className="row">
            <div className="body">
              <div className="name">{card.name} is wearing nothing that can be played for</div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function WornRow({ worn, onCall }: { worn: RingWorn; onCall: () => void }) {
  const prize = content.item(worn.item);
  const stake =
    worn.stake !== null && content.hasItem(worn.stake) ? content.item(worn.stake) : null;
  return (
    <div className={worn.ok ? 'row' : 'row locked'}>
      <TileBox size="md" dim={!worn.ok}>
        <BareIcon spec={itemIconSpec(content, prize)} size={22} />
      </TileBox>
      <div className="body">
        <div className="name">{prize.name}</div>
        <div className="sub">
          {worn.slot} · worth {formatInt(worn.value)} gp
          {stake ? ` · you put up your ${stake.name}` : ''}
        </div>
      </div>
      <span className="spacer" />
      {worn.ok ? (
        <button className="btn sm primary" onClick={onCall}>
          Play for it
        </button>
      ) : (
        <span className="hint">{worn.refusal}</span>
      )}
    </div>
  );
}

/** The bout, replayed at the sim's own pace from the seed the register drew. */
function BoutCard({
  row,
  you,
  juice,
  onClose,
}: {
  row: BoutRow;
  you: string;
  juice: ScreenProps['juice'];
  onClose: () => void;
}) {
  const whole = boutView(row, you);
  // The cursor starts where the juice says and only ever moves forward, so the card is keyed
  // by the bout's id at its call site: a new bout is a new card, not a card being rewound.
  const [at, setAt] = useState(() => (juice === 'deadpan' ? whole.ticks : 0));
  const frame = useRef(0);

  useEffect(() => {
    if (juice === 'deadpan') return;
    const started = Date.now();
    const step = () => {
      const ticks = Math.floor((Date.now() - started) / REPLAY_STEP_MS);
      setAt(Math.min(ticks, whole.ticks));
      if (ticks < whole.ticks) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame.current);
    };
  }, [whole.ticks, juice]);

  // The card draws the bout as it stood `at` ticks in; past the end that is simply the end.
  const view = boutView(row, you, at);
  const done = at >= whole.ticks;
  return (
    <div className="card">
      <div className="card-head">
        <Label>{view.yours ? 'You called them out' : 'You were called out'}</Label>
        <span className="spacer" />
        <button className="btn sm quiet" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="fight-sides">
        <Side view={view.caller} you={view.yours} juice={juice} />
        <Side view={view.called} you={!view.yours} juice={juice} />
      </div>
      <div className="fight-foot" style={{ marginTop: 12 }}>
        <span className={view.youWon ? 'tag-active' : 'chip'}>
          {view.youWon ? 'You won' : 'You lost'}
        </span>
        <span className="spacer" />
        <span className="hint">
          {done
            ? `${view.winner} takes the ${content.hasItem(view.prize) ? content.item(view.prize).name : view.prize}` +
              (view.onPoints ? ' — on points, neither fell' : '') +
              ' · it changes hands on your next save'
            : 'fighting…'}
        </span>
      </div>
    </div>
  );
}

function Side({
  view,
  you,
  juice,
}: {
  view: BoutSideView;
  you: boolean;
  juice: ScreenProps['juice'];
}) {
  const frac = view.maxHp > 0 ? view.hp / view.maxHp : 0;
  return (
    <div className="fight-side">
      <div className="who">
        <Face name={view.name} size={36} />
        <div style={{ minWidth: 0 }}>
          <div className="name">
            {view.name}
            {you && (
              <span className="tag-active" style={{ marginLeft: 6 }}>
                you
              </span>
            )}
          </div>
          <div className="sub">{view.fighter.style === 'sorcery' ? 'casts' : 'swings'}</div>
        </div>
      </div>
      <div className="hp-wrap">
        <div
          className="hp-bar"
          role="progressbar"
          aria-valuenow={view.hp}
          aria-valuemin={0}
          aria-valuemax={view.maxHp}
        >
          <div
            className={you ? 'hp-fill' : 'hp-fill them'}
            style={{ width: `${String(frac * 100)}%` }}
          />
          <span className="hp-text">
            {formatInt(view.hp)}/{formatInt(view.maxHp)}
          </span>
        </div>
        {juice !== 'deadpan' && view.splat !== null && (
          <span
            key={view.splat.at}
            className={view.splat.hit ? 'splat' : 'splat miss'}
            style={{ left: '50%' }}
          >
            {view.splat.hit ? `-${formatInt(view.splat.amount)}` : 'miss'}
          </span>
        )}
      </div>
      <div className="stats">{view.statsLine}</div>
      <div className="swing-row">
        <div className="swing-bar">
          <div className="swing-fill" style={{ width: `${String(view.swingFrac * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

/** Every bout this name has been in, newest first — what was played for, and who kept it. */
function BoutFeed({ bouts, you }: { bouts: readonly BoutRow[]; you: string }) {
  return (
    <div className="card feed col-side">
      <div className="card-head">
        <Label>Bouts</Label>
        <span className="spacer" />
        <span className="hint">{formatInt(bouts.length)} on the card</span>
      </div>
      {bouts.length === 0 && (
        <div className="row">
          <div className="body">
            <div className="sub">Nothing yet. A bout shows here the moment it is fought.</div>
          </div>
        </div>
      )}
      {bouts.map((row) => {
        const won = row.winner === you;
        const other = row.yours ? row.called : row.caller;
        const thing = content.hasItem(row.prize) ? content.item(row.prize).name : row.prize;
        return (
          <div key={row.id} className={won ? 'row' : 'row locked'}>
            <Face name={other} size={30} />
            <div className="body">
              <div className="name">
                {won ? 'Took' : 'Lost'} the {thing}
              </div>
              <div className="sub">
                {row.yours ? 'you called out' : 'called out by'} {other}
                {row.onPoints ? ' · on points' : ''} · {formatAge(row.agoMs)} ago
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
