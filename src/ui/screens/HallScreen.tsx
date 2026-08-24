/**
 * The hall: a clan's place on the hill. Without one, a door — found a hall, ask at one, answer
 * the invites waiting, see the other halls. With one, the rooms in content order (tier, what
 * the next tier needs, a bar, a Give), the names in it, the door (invite, the founder's
 * requests, leave) and the ledger. What the register knows comes through useHall; what this
 * name holds and has on the cart is the sim's. Layout from Claude Design Screen G. The discs
 * are first letters until the painted likenesses (the avatars branch's Face) land.
 */
import { useState, type FormEvent } from 'react';
import type { ZodType } from 'zod';
import { api } from '../../api/client.ts';
import type { HallGet, HallSummary, HallView, Petition } from '../../api/protocol.ts';
import { content, simContext } from '../../content/index.ts';
import { HallNameSchema } from '../../api/protocol.ts';
import { PlayerNameSchema } from '../../sim/commands.ts';
import type { SimState } from '../../sim/save.ts';
import {
  agoLine,
  cartLines,
  GP,
  numeral,
  perkLine,
  roomRows,
  type NeedRow,
  type RoomRow,
} from '../derive-hall.ts';
import { Face } from '../Face.tsx';
import { formatInt } from '../format.ts';
import type { Look } from '../../look/look.ts';
import { peekLook, putLook } from '../looks.ts';
import { Label, Pops, TileBox, UiIcon } from '../parts.tsx';
import { LookEditor } from '../overlays/LookEditor.tsx';
import { Modal } from '../overlays/Modal.tsx';
import { HALL_ICON } from '../Shell.tsx';
import { useHall } from '../useHall.ts';
import { popX } from '../util.ts';
import { ScreenHead } from './common.tsx';
import type { ScreenProps } from './defs.ts';

export function HallScreen({
  sim,
  dispatch,
  juice,
  savedAtMs,
}: ScreenProps & { savedAtMs: number | null }) {
  const hall = useHall(savedAtMs);
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
  const give = (room: RoomRow, item: string | null, qty: number) => {
    dispatch({ type: 'hall:give', room: room.room.id, item, qty });
    pop(`−${formatInt(qty)} ${item === null ? 'gp' : content.item(item).name}`);
  };

  if (hall.data === null) {
    return (
      <>
        <ScreenHead icon={HALL_ICON} title="Hall" chip="reading the register" />
        <div className="hall-warn" role={hall.error ? 'alert' : undefined}>
          {hall.error ?? 'reading the register…'}
        </div>
      </>
    );
  }
  if (hall.data.hall === null) {
    return <Door sim={sim} data={hall.data} halls={hall.halls} error={hall.error} act={hall.act} />;
  }
  return (
    <>
      <Inside
        sim={sim}
        view={hall.data.hall}
        requests={hall.data.requests}
        error={hall.error}
        act={hall.act}
        onGive={give}
      />
      <Pops pops={livePops} gold />
    </>
  );
}

type Act = (change: () => Promise<HallGet>) => Promise<string | null>;

/** The card footer for gifts still riding: "on the cart, not yet taken: …". */
function CartFoot({ lead, lines }: { lead: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="card-foot hall-cart">
      <UiIcon id="delapouite/hand-truck" size={13} />
      <span>
        {lead} {lines.join(' · ')}
      </span>
    </div>
  );
}

// ---- no hall: the door -----------------------------------------------------------------------

function Door({
  sim,
  data,
  halls,
  error,
  act,
}: {
  sim: SimState;
  data: HallGet;
  halls: HallSummary[];
  error: string | null;
  act: Act;
}) {
  const cart = cartLines(sim.hall.gifts, simContext);
  return (
    <>
      <ScreenHead icon={HALL_ICON} title="Hall" chip="no hall yet" />
      {error && (
        <div className="hall-warn" role="alert">
          {error}
        </div>
      )}
      <div className="columns">
        <div className="col-main">
          {data.invites.length > 0 && (
            <div className="card list">
              <div className="card-head">
                <Label>Waiting for you</Label>
                <span className="spacer" />
                <span className="hint">someone held a door open</span>
              </div>
              {data.invites.map((p) => (
                <PetitionRow key={p.id} p={p} act={act} />
              ))}
            </div>
          )}
          {data.requests.length > 0 && (
            <div className="card list">
              <div className="card-head">
                <Label>Where you asked</Label>
                <span className="spacer" />
                <span className="hint">the founder decides</span>
              </div>
              {data.requests.map((p) => (
                <PetitionRow key={p.id} p={p} act={act} mine />
              ))}
            </div>
          )}
          <NameForm
            label="Found a hall"
            hint="A hall may be one name. The rooms are raised with what its names give."
            placeholder="e.g. The Quiet Hall"
            button="Found it"
            schema={HallNameSchema}
            maxLength={24}
            submit={(name) => act(() => api.foundHall(name))}
          />
          <NameForm
            label="Ask at a door"
            hint="The founder decides. An invite already waiting lets you straight in."
            placeholder="The hall's name"
            button="Ask"
            schema={HallNameSchema}
            maxLength={24}
            submit={(name) => act(() => api.requestJoin(name))}
          />
          <CartFoot lead="still on the cart, coming back:" lines={cart} />
        </div>
        <div className="col-side">
          <div className="card list">
            <div className="card-head">
              <Label>The halls</Label>
              <span className="spacer" />
              <span className="hint">
                {halls.length === 1 ? 'one on the hill' : `${String(halls.length)} on the hill`}
              </span>
            </div>
            {halls.length === 0 && <div className="row board-note">nobody has founded one yet</div>}
            {halls.map((h) => (
              <div key={h.name} className="row hall-row">
                <Face kind="hall" name={h.name} />
                <span className="body">
                  <span className="name">{h.name}</span>
                  <span className="sub">
                    {h.members === 1 ? 'one name' : `${String(h.members)} names`} ·{' '}
                    {h.raised === 0 ? 'nothing raised yet' : `${String(h.raised)} raised`}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function NameForm({
  label,
  hint,
  placeholder,
  button,
  schema,
  maxLength,
  submit,
}: {
  label?: string;
  hint: string;
  placeholder: string;
  button: string;
  schema: ZodType<string>;
  maxLength: number;
  submit: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = schema.safeParse(name);
  const canSubmit = !busy && ok.success;
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const failed = await submit(name.trim());
    setBusy(false);
    if (failed !== null) setError(failed);
    else setName('');
  };
  return (
    <form className="card hall-form" onSubmit={(e) => void go(e)}>
      {label !== undefined && (
        <div className="card-head">
          <Label>{label}</Label>
        </div>
      )}
      <div className="sel-flavour">{hint}</div>
      <div className="hall-form-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-label={label ?? button}
        />
        <button className="btn solid" type="submit" disabled={!canSubmit}>
          {busy ? 'One moment' : button}
        </button>
      </div>
      {error && (
        <div className="note-line warn" role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

/** An invite for the caller, a name asking at the founder's door, or (`mine`) where the caller asked. */
function PetitionRow({ p, act, mine = false }: { p: Petition; act: Act; mine?: boolean }) {
  const [busy, setBusy] = useState(false);
  const shown = p.kind === 'invite' || mine ? p.hall : p.name;
  const answer = async (accept: boolean) => {
    setBusy(true);
    await act(() => api.answerPetition(p.id, accept));
    setBusy(false);
  };
  return (
    <div className="row hall-row">
      <Face name={shown} size={24} />
      <span className="body">
        <span className="name">{shown}</span>
        <span className="sub">
          {p.kind === 'invite'
            ? `${p.name} holds the door · `
            : mine
              ? 'you asked at the door · '
              : 'asks at the door · '}
          {agoLine(p.agoMs)}
        </span>
      </span>
      <span className="btn-row hall-answer">
        <button className="btn sm" disabled={busy} onClick={() => void answer(false)}>
          {mine ? 'Withdraw' : 'Decline'}
        </button>
        {!mine && (
          <button className="btn sm solid" disabled={busy} onClick={() => void answer(true)}>
            Accept
          </button>
        )}
      </span>
    </div>
  );
}

// ---- in a hall ---------------------------------------------------------------------------------

function Inside({
  sim,
  view,
  requests,
  error,
  act,
  onGive,
}: {
  sim: SimState;
  view: HallView;
  requests: Petition[];
  error: string | null;
  act: Act;
  onGive: (room: RoomRow, item: string | null, qty: number) => void;
}) {
  const rows = roomRows(view, sim, simContext);
  const raised = rows.reduce((n, r) => n + r.tier, 0);
  const cart = cartLines(sim.hall.gifts, simContext);
  const me = view.members.find((m) => m.you);
  const founder = me?.founder ?? false;
  const [giving, setGiving] = useState<RoomRow | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [turnArm, setTurnArm] = useState<string | null>(null);
  const [doorError, setDoorError] = useState<string | null>(null);
  const [painting, setPainting] = useState(false);
  const paintMark = async (look: Look | null): Promise<string | null> => {
    try {
      await api.setHallLook(look);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    putLook('hall', view.name, look);
    setPainting(false);
    return null;
  };

  const leave = async () => {
    if (!leaving) {
      setLeaving(true);
      return;
    }
    const failed = await act(() => api.leaveHall());
    setLeaving(false);
    setDoorError(failed);
  };
  const expel = async (name: string) => {
    setTurnArm(null);
    setDoorError(await act(() => api.expel(name)));
  };

  return (
    <>
      <ScreenHead
        icon={HALL_ICON}
        face={<Face kind="hall" name={view.name} size={28} />}
        title={view.name}
        chip={`${view.members.length === 1 ? 'one name' : `${String(view.members.length)} names`} · ${raised === 0 ? 'nothing raised yet' : `${String(raised)} raised`}`}
        rate={
          <span className="hall-gave">
            <span className="k">gave</span>
            <UiIcon id="delapouite/coins" size={14} />
            <span className="v">{formatInt(me?.given ?? 0)}</span>
            <span className="k">gp</span>
          </span>
        }
      />
      {error && (
        <div className="hall-warn" role="alert">
          the hall could not be re-read: {error}
        </div>
      )}
      <div className="columns">
        <div className="col-main">
          <div className="card list rooms">
            <div className="card-head">
              <Label>Rooms</Label>
              <span className="spacer" />
              <span className="hint">raised with what its names give</span>
            </div>
            <div className="card-note">
              Six rooms, three tiers each. A raised room stands for every name in the hall.
            </div>
            {rows.map((row) => (
              <RoomLine key={row.room.id} row={row} onGive={() => setGiving(row)} />
            ))}
            <CartFoot lead="on the cart, not yet taken:" lines={cart} />
          </div>
        </div>
        <div className="col-side">
          <div className="card list perks">
            <div className="card-head">
              <Label>The hall gives you</Label>
            </div>
            {rows.map((r) => (
              <div key={r.room.id} className="perk-row">
                <span className={r.now !== null ? 'tier tag-active' : 'tier off'}>
                  {r.now !== null ? numeral(r.tier) : '—'}
                </span>
                <span className={r.now !== null ? 'text' : 'text off'}>
                  {r.now !== null ? perkLine(r.now, simContext) : `${r.room.name} — not yet raised`}
                </span>
              </div>
            ))}
          </div>
          <div className="card list">
            <div className="card-head">
              <Label>Names</Label>
              <span className="spacer" />
              <span className="hint">founded by {view.founder}</span>
            </div>
            {view.members.map((m) => {
              const god = m.god !== null && content.hasGod(m.god) ? content.god(m.god) : null;
              const on = m.seenAgoMs !== null && m.seenAgoMs < 90_000;
              const armed = turnArm === m.name;
              return (
                <div key={m.name} className={`row hall-row${m.you ? ' you' : ''}`}>
                  <Face name={m.name} size={26} />
                  <span className="body">
                    <span className="name">
                      {m.name}
                      {m.founder && <span className="hall-tag">Founder</span>}
                      {m.you && !m.founder && <span className="hall-tag">You</span>}
                    </span>
                    <span className="sub meta">
                      {god && (
                        <>
                          <UiIcon id={god.icon} size={11} />
                          <span>{god.name}</span>
                          <span className="dot">·</span>
                        </>
                      )}
                      <span className={on ? 'on' : undefined}>
                        {on ? 'on the hill now' : `seen ${agoLine(m.seenAgoMs)}`}
                      </span>
                      <span className="dot">·</span>
                      <span>gave {formatInt(m.given)} gp</span>
                    </span>
                  </span>
                  {founder && !m.you && (
                    <button
                      className={armed ? 'turn-out armed' : 'turn-out'}
                      onClick={() => (armed ? void expel(m.name) : setTurnArm(m.name))}
                      title={armed ? `show ${m.name} the door` : undefined}
                    >
                      {armed ? 'Turn out?' : 'Turn out'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="card list">
            <div className="card-head">
              <Label>The door</Label>
              <span className="spacer" />
              <span className="hint">{founder ? 'you keep it' : `${view.founder} keeps it`}</span>
              {founder && (
                <button
                  className="btn sm"
                  style={{ marginLeft: 10 }}
                  onClick={() => setPainting(true)}
                  title="the mark over the door, beside every name in the hall"
                >
                  Paint the mark
                </button>
              )}
            </div>
            {requests.map((p) => (
              <PetitionRow key={p.id} p={p} act={act} />
            ))}
            <div className="hall-door">
              <NameForm
                hint="Anyone here may hold the door. A name already asking comes straight in."
                placeholder="A name on the hill"
                button="Invite"
                schema={PlayerNameSchema}
                maxLength={16}
                submit={(name) => act(() => api.invite(name))}
              />
              <div className="hall-leave">
                {!leaving ? (
                  <button className="linkish leave" onClick={() => void leave()}>
                    Leave the hall
                  </button>
                ) : (
                  <>
                    <span className="really">Really leave?</span>
                    <span className="spacer" />
                    <button className="linkish leave" onClick={() => setLeaving(false)}>
                      Stay
                    </button>
                    <button className="btn sm leave-go" onClick={() => void leave()}>
                      Leave
                    </button>
                  </>
                )}
              </div>
              {doorError && (
                <div className="note-line warn" role="alert">
                  {doorError}
                </div>
              )}
            </div>
            {founder && (
              <div className="keys-hint">
                leaving hands the keys to whoever has been here longest
              </div>
            )}
          </div>
          <div className="card list">
            <div className="card-head">
              <Label>The ledger</Label>
              <span className="spacer" />
              <span className="hint">what the hall took</span>
            </div>
            {view.ledger.length === 0 && <div className="row board-note">nothing yet</div>}
            {view.ledger.map((l, i) => {
              const you = me !== undefined && l.name === me.name;
              return (
                <div key={i} className="row hall-row ledger">
                  <Face name={l.name} size={20} />
                  <span className="body">
                    <span className="sub text">
                      <b className={you ? 'you' : undefined}>{you ? 'You' : l.name}</b> gave{' '}
                      <span className="qty">
                        {formatInt(l.qty)}{' '}
                        {l.what === GP
                          ? 'gp'
                          : content.hasItem(l.what)
                            ? content.item(l.what).name
                            : l.what}
                      </span>{' '}
                      to {content.hasRoom(l.room) ? content.room(l.room).name : l.room}
                    </span>
                  </span>
                  <span className="when">{agoLine(l.agoMs)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {painting && (
        <LookEditor
          kind="hall"
          name={view.name}
          initial={peekLook('hall', view.name) ?? null}
          onSave={paintMark}
          onClose={() => setPainting(false)}
        />
      )}
      {giving && (
        <GiveModal
          row={giving}
          onCancel={() => setGiving(null)}
          onGive={(item, qty) => {
            onGive(giving, item, qty);
            setGiving(null);
          }}
        />
      )}
    </>
  );
}

function RoomLine({ row, onGive }: { row: RoomRow; onGive: () => void }) {
  const top = row.next === null;
  // Hovering a segment lights its term and back; met terms fold behind "N settled".
  const [hot, setHot] = useState<number | null>(null);
  const [showMet, setShowMet] = useState(false);
  const settled = row.needs.filter((n) => n.met).length;
  const shown = showMet ? row.needs : row.needs.filter((n) => !n.met);
  return (
    <div className={`row room-row${row.tier > 0 ? ' raised' : ''}${top ? ' finished' : ''}`}>
      <TileBox size="md" dim={row.tier === 0}>
        <UiIcon id={row.room.icon} size={20} />
      </TileBox>
      <span className="body">
        <span className="name">
          {row.room.name}
          {row.tier > 0 && <span className="tag-active">{numeral(row.tier)}</span>}
          {top && <span className="done-note">finished</span>}
        </span>
        <span className="sub line">{row.room.line}</span>
        <span className="sub">{row.sub}</span>
        {!top && row.needs.length > 0 && (
          <>
            <span className="terms-track">
              <span className="terms-bar">
                {row.needs.map((n, i) => {
                  const f = Math.min(1, n.have / n.need);
                  const ghost = n.cart > 0 ? Math.min(1 - f, n.cart / n.need) : 0;
                  return (
                    <span
                      key={n.what}
                      className={hot === i ? 'seg hot' : 'seg'}
                      onMouseEnter={() => setHot(i)}
                      onMouseLeave={() => setHot(null)}
                    >
                      <span
                        className={n.what === GP ? 'fill gp' : 'fill'}
                        style={{ width: `${(f * 100).toFixed(1)}%` }}
                      />
                      {ghost > 0 && (
                        <span
                          className={n.what === GP ? 'cart gp' : 'cart'}
                          style={{
                            left: `${(f * 100).toFixed(1)}%`,
                            width: `${(ghost * 100).toFixed(1)}%`,
                          }}
                        />
                      )}
                    </span>
                  );
                })}
              </span>
              <span className="pct">{Math.round(row.fraction * 100)}%</span>
            </span>
            <span className="sub needs">
              {shown.map((n) => {
                const i = row.needs.indexOf(n);
                return (
                  <span
                    key={n.what}
                    className={`need${n.met ? ' met' : ''}${hot === i ? ' hot' : ''}`}
                    onMouseEnter={() => setHot(i)}
                    onMouseLeave={() => setHot(null)}
                  >
                    <span className={n.what === GP && !n.met ? 'n gp' : 'n'}>
                      {n.met ? formatInt(n.need) : `${formatInt(n.have)}/${formatInt(n.need)}`}
                    </span>
                    {n.met ? `${n.name} ✓` : n.name}
                  </span>
                );
              })}
              {settled > 0 && (
                <button className="linkish fold" onClick={() => setShowMet(!showMet)}>
                  {showMet ? `hide ${String(settled)} settled` : `${String(settled)} settled`}
                </button>
              )}
            </span>
          </>
        )}
      </span>
      {!top && (
        <span className="room-give">
          <button
            className="btn solid"
            disabled={!row.canGive}
            onClick={onGive}
            title={row.canGive ? `give to ${row.room.name}` : 'you hold nothing it still needs'}
          >
            Give
          </button>
          {row.lastGiver !== null && (
            <span className="last-in" title={`${row.lastGiver} brought the last cart in`}>
              <Face name={row.lastGiver} size={15} />
              <span>{row.lastGiver}</span>
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function GiveModal({
  row,
  onCancel,
  onGive,
}: {
  row: RoomRow;
  onCancel: () => void;
  onGive: (item: string | null, qty: number) => void;
}) {
  const options = row.needs.filter((n) => !n.met && n.held > 0);
  const [pick, setPick] = useState<NeedRow | null>(options[0] ?? null);
  const most = pick === null ? 0 : Math.min(pick.held, pick.need - pick.have);
  const [raw, setRaw] = useState(String(Math.min(10, most) || 1));
  const n = Math.min(parseInt(raw, 10) || 0, most);
  const choose = (o: NeedRow) => {
    setPick(o);
    setRaw(String(Math.min(10, Math.min(o.held, o.need - o.have)) || 1));
  };
  const worth = pick === null ? 0 : pick.what === GP ? n : content.item(pick.what).value * n;
  const submit = () => {
    if (pick !== null && n > 0) onGive(pick.what === GP ? null : pick.what, n);
  };
  return (
    <Modal onClose={onCancel}>
      <Label>Give to {row.room.name}</Label>
      <div className="sel-flavour" style={{ marginTop: 8 }}>
        {row.next === null
          ? 'Finished.'
          : `Toward ${numeral(row.tier + 1)}: ${perkLine(row.next, simContext)}.`}
      </div>
      <div className="chips give-what">
        {options.map((o) => (
          <button
            key={o.what}
            className={pick?.what === o.what ? 'btn sm on' : 'btn sm'}
            onClick={() => choose(o)}
          >
            {o.what === GP ? 'gp' : o.name}
          </button>
        ))}
      </div>
      {pick !== null && (
        <>
          <div className="hint" style={{ marginTop: 8 }}>
            {formatInt(pick.held)} {pick.what === GP ? 'gp' : pick.name} held · the room still needs{' '}
            {formatInt(pick.need - pick.have)}
          </div>
          <input
            className="amount"
            inputMode="numeric"
            value={raw}
            autoFocus
            onChange={(e) => setRaw(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onCancel();
            }}
            aria-label="Amount to give"
          />
          <div className="chips">
            {[10, 100, 1000].map((v) => (
              <button key={v} className="btn sm" onClick={() => setRaw(String(Math.min(v, most)))}>
                {String(v)}
              </button>
            ))}
            <button className="btn sm" onClick={() => setRaw(String(most))}>
              ALL
            </button>
          </div>
          <div className="total">{n > 0 ? `worth ${formatInt(worth)} gp` : '—'}</div>
        </>
      )}
      <div className="foot" style={{ marginTop: 12 }}>
        <button className="btn quiet" style={{ flex: 1 }} onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" style={{ flex: 1 }} disabled={n <= 0} onClick={submit}>
          Give
        </button>
      </div>
    </Modal>
  );
}
