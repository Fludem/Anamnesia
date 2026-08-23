/**
 * The fire, kept in one place for the whole tab: one long poll to the register carries every
 * new word — in any room, to or from this name — and this hook sorts them into talks, counts
 * what has not been read, and tells the register how far the open talk has been read. The
 * screen and the nav badge both read from here; nothing about words touches the sim.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api, ApiError } from '../api/client.ts';
import {
  nameKey,
  ROOMS,
  type ChatMessage,
  type ChatName,
  type ChatOverview,
  type ChatThread,
  type Room,
  type Talk,
  type User,
} from '../api/protocol.ts';
import { appendWord, LISTED_ROOMS, sameTalk, talkKey, talkOf } from './derive-chat.ts';

export interface RoomState {
  messages: readonly ChatMessage[];
  unread: number;
}

export interface ThreadState {
  name: string;
  blocked: boolean;
  messages: readonly ChatMessage[];
}

export interface ChatState {
  /** The caller's own name, as the register spells it. */
  me: string;
  /** The first answer has come. */
  ready: boolean;
  /** What went wrong last, or null; the poll keeps trying by itself. */
  error: string | null;
  /** Names listening right now, this one among them. */
  here: number;
  rooms: Readonly<Record<Room, RoomState>>;
  /** Names spoken with, newest talk first. */
  names: readonly ChatName[];
  /** Talks with a name whose words have been read in, by talk key. */
  threads: Readonly<Record<string, ThreadState | undefined>>;
  /** The talk on screen: new words there count as read. */
  open: Talk | null;
  /** Unread words in the listed rooms and every talk with a name. */
  unread: number;
  /** Look at a talk; words with a name are read in the first time. */
  setOpen: (talk: Talk | null) => void;
  /** Say something; resolves to the register's refusal, or null. */
  say: (talk: Talk, body: string) => Promise<string | null>;
  /** Turn away from a name, or back. */
  block: (name: string, blocked: boolean) => Promise<string | null>;
}

type Inner = Omit<ChatState, 'setOpen' | 'say' | 'block' | 'unread'>;

type Action =
  | { type: 'overview'; data: ChatOverview }
  | { type: 'thread'; data: ChatThread }
  /** `here` below 0 means the count was not in this answer. */
  | { type: 'arrived'; messages: ChatMessage[]; here: number }
  | { type: 'open'; talk: Talk | null }
  | { type: 'error'; message: string | null };

const emptyRooms = (): Record<Room, RoomState> => {
  const out = {} as Record<Room, RoomState>;
  for (const r of ROOMS) out[r] = { messages: [], unread: 0 };
  return out;
};

const initial = (me: string): Inner => ({
  me,
  ready: false,
  error: null,
  here: 1,
  rooms: emptyRooms(),
  names: [],
  threads: {},
  open: { kind: 'room', room: 'fire' },
});

function reduce(s: Inner, a: Action): Inner {
  switch (a.type) {
    case 'overview': {
      const rooms = emptyRooms();
      for (const r of a.data.rooms) {
        const viewing = sameTalk(s.open, { kind: 'room', room: r.room });
        rooms[r.room] = { messages: r.messages, unread: viewing ? 0 : r.unread };
      }
      const names = a.data.names.map((n) =>
        sameTalk(s.open, { kind: 'name', name: n.name }) ? { ...n, unread: 0 } : n,
      );
      return { ...s, ready: true, error: null, here: a.data.here, rooms, names };
    }
    case 'thread': {
      const talk: Talk = { kind: 'name', name: a.data.name };
      const key = talkKey(talk);
      const names = s.names.map((n) =>
        talkKey({ kind: 'name', name: n.name }) === key
          ? { ...n, name: a.data.name, blocked: a.data.blocked, unread: 0 }
          : n,
      );
      return {
        ...s,
        names,
        threads: {
          ...s.threads,
          [key]: { name: a.data.name, blocked: a.data.blocked, messages: a.data.messages },
        },
      };
    }
    case 'arrived': {
      if (a.messages.length === 0) return s.here === a.here ? s : { ...s, here: a.here };
      const rooms = { ...s.rooms };
      const threads = { ...s.threads };
      let names = s.names;
      for (const m of a.messages) {
        const talk = talkOf(m, s.me);
        const mine = nameKey(m.from) === nameKey(s.me);
        const counts = !mine && !sameTalk(s.open, talk);
        if (talk.kind === 'room') {
          const room = rooms[talk.room];
          const messages = appendWord(room.messages, m);
          if (messages === room.messages) continue;
          rooms[talk.room] = { messages, unread: room.unread + (counts ? 1 : 0) };
        } else {
          const key = talkKey(talk);
          const thread = threads[key];
          if (thread) {
            const messages = appendWord(thread.messages, m);
            if (messages === thread.messages) continue;
            threads[key] = { ...thread, messages };
          }
          const row = names.find((n) => talkKey({ kind: 'name', name: n.name }) === key);
          if (row && row.last.id >= m.id) continue;
          const next: ChatName = {
            name: row?.name ?? talk.name,
            last: m,
            unread: (row?.unread ?? 0) + (counts ? 1 : 0),
            blocked: row?.blocked ?? false,
          };
          names = [next, ...names.filter((n) => n !== row)];
        }
      }
      return { ...s, here: a.here < 0 ? s.here : a.here, rooms, threads, names };
    }
    case 'open': {
      if (a.talk === null) return { ...s, open: null };
      const rooms = { ...s.rooms };
      let names = s.names;
      if (a.talk.kind === 'room') rooms[a.talk.room] = { ...rooms[a.talk.room], unread: 0 };
      else {
        const key = talkKey(a.talk);
        names = names.map((n) =>
          talkKey({ kind: 'name', name: n.name }) === key ? { ...n, unread: 0 } : n,
        );
      }
      return { ...s, open: a.talk, rooms, names };
    }
    case 'error':
      return s.error === a.message ? s : { ...s, error: a.message };
  }
}

const reason = (e: unknown): string => (e instanceof ApiError ? e.message : String(e));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The last word in a talk as this tab holds it, or 0. */
function lastIdOf(s: Inner, talk: Talk | null): number {
  if (talk === null) return 0;
  const list =
    talk.kind === 'room' ? s.rooms[talk.room].messages : (s.threads[talkKey(talk)]?.messages ?? []);
  return list[list.length - 1]?.id ?? 0;
}

export function useChat(user: User, enabled: boolean): ChatState {
  const [state, dispatch] = useReducer(reduce, user.name, initial);
  const open = useRef(state.open);
  open.current = state.open;

  // The poll: an overview, then one open question after another until the tab lets go.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const leaving = new AbortController();
    void (async () => {
      let after = 0;
      let backoff = 1000;
      let resync = true;
      while (live) {
        try {
          if (resync) {
            const data = await api.chat();
            if (!live) return;
            dispatch({ type: 'overview', data });
            after = Math.max(after, data.latest);
            resync = false;
          }
          const got = await api.chatPoll(after, leaving.signal);
          if (!live) return;
          after = got.latest;
          dispatch({ type: 'arrived', messages: got.messages, here: got.here });
          dispatch({ type: 'error', message: null });
          backoff = 1000;
        } catch (e) {
          if (!live) return;
          if (e instanceof ApiError && e.status === 401) {
            dispatch({ type: 'error', message: 'The register no longer knows this name here.' });
            return;
          }
          dispatch({ type: 'error', message: reason(e) });
          resync = true;
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 30_000);
        }
      }
    })();
    return () => {
      live = false;
      leaving.abort();
    };
  }, [enabled, user.id]);

  // Tell the register how far the open talk has been read, whenever its last word moves.
  const openKey = state.open === null ? null : talkKey(state.open);
  const lastId = lastIdOf(state, state.open);
  useEffect(() => {
    const talk = open.current;
    if (!enabled || talk === null || lastId === 0) return;
    api.chatRead(talk, lastId).catch(() => undefined);
  }, [enabled, openKey, lastId]);

  const setOpen = useCallback(
    (talk: Talk | null) => {
      dispatch({ type: 'open', talk });
      if (talk?.kind === 'name' && state.threads[talkKey(talk)] === undefined)
        api.chatWith(talk.name).then(
          (data) => dispatch({ type: 'thread', data }),
          (e: unknown) => dispatch({ type: 'error', message: reason(e) }),
        );
    },
    [state.threads],
  );

  const say = useCallback(async (talk: Talk, body: string): Promise<string | null> => {
    try {
      const m = await api.say(talk, body);
      dispatch({ type: 'arrived', messages: [m], here: -1 });
      return null;
    } catch (e) {
      return reason(e);
    }
  }, []);

  const block = useCallback(async (name: string, blocked: boolean): Promise<string | null> => {
    try {
      await api.chatBlock(name, blocked);
      const [data, thread] = await Promise.all([api.chat(), api.chatWith(name)]);
      dispatch({ type: 'overview', data });
      dispatch({ type: 'thread', data: thread });
      return null;
    } catch (e) {
      return reason(e);
    }
  }, []);

  let unread = 0;
  for (const r of LISTED_ROOMS) unread += state.rooms[r].unread;
  for (const n of state.names) unread += n.unread;

  return { ...state, unread, setOpen, say, block };
}
