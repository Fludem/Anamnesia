/**
 * Talk: the fire, where every name on the hill can hear, and a word with one name at a time.
 * The left column lists the talks — the rooms first, then the names spoken with, newest
 * first, and a way to start on a new name; the right is the open talk: its words under the
 * day they were said, and a line to say something. `ChatPanel` is the open talk on its own,
 * so another screen can seat a room of its own beside whatever it does. No design screen
 * exists for this; it is Screen A's rows and cards, like the hall.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { MAX_WORDS, nameKey, type ChatMessage, type Talk } from '../../api/protocol.ts';
import { PlayerNameSchema } from '../../sim/commands.ts';
import {
  byDay,
  LISTED_ROOMS,
  previewLine,
  ROOM_INFO,
  sameTalk,
  talkKey,
  timeLabel,
} from '../derive-chat.ts';
import { Face } from '../Face.tsx';
import { formatInt } from '../format.ts';
import { Label, TileBox, UiIcon } from '../parts.tsx';
import type { ChatState } from '../useChat.ts';
import { useNow } from '../util.ts';
import { ScreenHead } from './common.tsx';

export const TALK_ICON = 'lorc/campfire';

const FIRE: Talk = { kind: 'room', room: 'fire' };

export function ChatScreen({ chat }: { chat: ChatState }) {
  const open = chat.open ?? FIRE;
  /** Narrow screens show the list or the talk; wide ones show both. */
  const [showing, setShowing] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [asking, setAsking] = useState('');
  const listening = chat.here === 1 ? 'only you listening' : `${String(chat.here)} listening`;

  const lookAt = (talk: Talk) => {
    chat.setOpen(talk);
    setShowing(true);
    setAskError(null);
  };
  const back = () => {
    chat.setOpen(null);
    setShowing(false);
  };
  const ask = (e: FormEvent) => {
    e.preventDefault();
    const parsed = PlayerNameSchema.safeParse(asking);
    if (!parsed.success) return;
    if (nameKey(parsed.data) === nameKey(chat.me)) {
      setAskError('You know what you think.');
      return;
    }
    lookAt({ kind: 'name', name: parsed.data });
    setAsking('');
  };
  const title = open.kind === 'room' ? ROOM_INFO[open.room].name : open.name;

  return (
    <>
      <ScreenHead
        icon={TALK_ICON}
        title="Talk"
        chip={chat.ready ? listening : 'reading the register'}
        rate={`words by the fire stay a month · ${formatInt(MAX_WORDS)} letters at a time`}
      />
      <div className={`chat${showing ? ' showing' : ''}`}>
        <div className="card list chat-list">
          <div className="card-head">
            <Label>Talks</Label>
            <span className="spacer" />
            {chat.unread > 0 && <span className="hint">{formatInt(chat.unread)} unread</span>}
          </div>
          {LISTED_ROOMS.map((room) => {
            const info = ROOM_INFO[room];
            const state = chat.rooms[room];
            const last = state.messages[state.messages.length - 1];
            const talk: Talk = { kind: 'room', room };
            return (
              <button
                key={room}
                className={`row chat-row${sameTalk(chat.open, talk) ? ' active' : ''}`}
                onClick={() => lookAt(talk)}
              >
                <TileBox size="md">
                  <UiIcon id={info.icon} size={18} />
                </TileBox>
                <span className="body">
                  <span className="name">{info.name}</span>
                  <span className="sub">{last ? previewLine(last, chat.me) : info.line}</span>
                </span>
                <Unread n={state.unread} />
              </button>
            );
          })}
          {chat.names.map((n) => {
            const talk: Talk = { kind: 'name', name: n.name };
            return (
              <button
                key={talkKey(talk)}
                className={`row chat-row${sameTalk(chat.open, talk) ? ' active' : ''}`}
                onClick={() => lookAt(talk)}
              >
                <Face name={n.name} />
                <span className="body">
                  <span className="name">
                    {n.name}
                    {n.blocked && <span className="tag-active dim">turned away</span>}
                  </span>
                  <span className="sub">{previewLine(n.last, chat.me)}</span>
                </span>
                <Unread n={n.unread} />
              </button>
            );
          })}
          <form className="chat-ask" onSubmit={ask}>
            <input
              value={asking}
              onChange={(e) => setAsking(e.target.value)}
              placeholder="A word with…"
              aria-label="A word with a name"
              maxLength={16}
            />
            <button
              className="btn sm"
              type="submit"
              disabled={!PlayerNameSchema.safeParse(asking).success}
            >
              Open
            </button>
          </form>
          {(askError ?? chat.error) && (
            <div className="row board-note warn" role="alert">
              {askError ?? chat.error}
            </div>
          )}
        </div>
        <ChatPanel chat={chat} talk={open} title={title} onBack={back} />
      </div>
    </>
  );
}

function Unread({ n }: { n: number }) {
  if (n === 0) return null;
  return <span className="chat-unread">{n > 99 ? '99+' : String(n)}</span>;
}

/**
 * One talk: its words, and a line to add to them. Opens the talk when shown so new words in
 * it count as read. `onBack` shows a way back to the list on a narrow screen.
 */
export function ChatPanel({
  chat,
  talk,
  title,
  onBack,
}: {
  chat: ChatState;
  talk: Talk;
  title?: string;
  onBack?: () => void;
}) {
  const key = talkKey(talk);
  const now = useNow(30_000);
  const thread = talk.kind === 'name' ? chat.threads[key] : undefined;
  const messages = talk.kind === 'room' ? chat.rooms[talk.room].messages : thread?.messages;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const lastId = messages?.[messages.length - 1]?.id ?? 0;

  // Looking at a talk reads it. A panel seated on another screen (no way back) always
  // counts as looked at; the talk screen's panel is hidden behind the list once `onBack`
  // has been pressed, and says so by opening nothing.
  const { setOpen, open } = chat;
  const embedded = onBack === undefined;
  useEffect(() => {
    if ((open !== null || embedded) && !sameTalk(open, talk)) setOpen(talk);
  }, [key, open, setOpen, talk, embedded]);

  // Stay at the bottom unless the reader has scrolled up to look at something.
  useLayoutEffect(() => {
    const el = log.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [key, lastId]);
  const onScroll = () => {
    const el = log.current;
    if (el) stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    const failed = await chat.say(talk, body);
    setBusy(false);
    setError(failed);
    if (failed === null) {
      setDraft('');
      stuck.current = true;
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };
  const turn = async () => {
    if (talk.kind !== 'name' || !thread) return;
    setBusy(true);
    setError(await chat.block(talk.name, !thread.blocked));
    setBusy(false);
  };

  const shown = title ?? (talk.kind === 'room' ? ROOM_INFO[talk.room].name : talk.name);
  const hint =
    talk.kind === 'room'
      ? ROOM_INFO[talk.room].line
      : thread?.blocked
        ? 'you turned away; their words do not reach you'
        : 'between the two of you';

  return (
    <div className="card chat-panel">
      <div className="card-head">
        {onBack && (
          <button className="chat-back" onClick={onBack} aria-label="Back to the talks">
            ‹
          </button>
        )}
        <Label>{shown}</Label>
        <span className="hint">{hint}</span>
        <span className="spacer" />
        {talk.kind === 'name' && thread && (
          <button className="btn sm" disabled={busy} onClick={() => void turn()}>
            {thread.blocked ? 'Turn back' : 'Turn away'}
          </button>
        )}
      </div>
      <div className="chat-log" ref={log} onScroll={onScroll}>
        {messages === undefined ? (
          <div className="chat-note">reading the register…</div>
        ) : messages.length === 0 ? (
          <div className="chat-note">
            {talk.kind === 'room' ? 'nobody has said anything yet' : 'nothing between you yet'}
          </div>
        ) : (
          byDay(messages, now).map((g) => (
            <div key={g.day} className="chat-day">
              <div className="chat-day-label">{g.day}</div>
              {g.messages.map((m) => (
                <Word
                  key={m.id}
                  m={m}
                  me={chat.me}
                  onName={
                    talk.kind === 'room' && nameKey(m.from) !== nameKey(chat.me)
                      ? () => chat.setOpen({ kind: 'name', name: m.from })
                      : undefined
                  }
                />
              ))}
            </div>
          ))
        )}
      </div>
      <form className="chat-compose" onSubmit={(e) => void send(e)}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={talk.kind === 'room' ? 'Say something' : `A word with ${shown}`}
          aria-label="Say something"
          maxLength={MAX_WORDS}
          rows={1}
          disabled={thread?.blocked === true}
        />
        <button
          className="btn primary"
          type="submit"
          disabled={busy || draft.trim().length === 0 || thread?.blocked === true}
        >
          Say
        </button>
      </form>
      {error && (
        <div className="note-line warn chat-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function Word({ m, me, onName }: { m: ChatMessage; me: string; onName: (() => void) | undefined }) {
  const mine = nameKey(m.from) === nameKey(me);
  return (
    <div className={mine ? 'chat-word mine' : 'chat-word'}>
      <Face name={m.from} size={22} className="chat-face" />
      <span className="chat-lines">
        <span className="chat-who">
          {onName ? (
            <button className="chat-name" onClick={onName} title={`A word with ${m.from}`}>
              {m.from}
            </button>
          ) : (
            <span className="chat-name">{mine ? 'you' : m.from}</span>
          )}
          <span className="chat-when">{timeLabel(m.atMs)}</span>
        </span>
        <span className="chat-what">{m.body}</span>
      </span>
    </div>
  );
}
