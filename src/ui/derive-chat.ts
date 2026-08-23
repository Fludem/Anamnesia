/**
 * Pure helpers for the talk screen: where a word belongs from one name's point of view, how
 * a list of words grows without repeating itself, and how a time reads next to one.
 */
import { nameKey, type ChatMessage, type Room, type Talk } from '../api/protocol.ts';

/** A talk's key in maps: `room:fire`, `name:old hand`. */
export function talkKey(talk: Talk): string {
  return talk.kind === 'room' ? `room:${talk.room}` : `name:${nameKey(talk.name)}`;
}

export const sameTalk = (a: Talk | null, b: Talk | null): boolean =>
  a !== null && b !== null && talkKey(a) === talkKey(b);

/** The talk a word belongs to, seen by `me`: its room, or the other name in it. */
export function talkOf(m: ChatMessage, me: string): Talk {
  if (m.room !== null) return { kind: 'room', room: m.room };
  const other = nameKey(m.from) === nameKey(me) ? (m.to ?? m.from) : m.from;
  return { kind: 'name', name: other };
}

/** The rooms the talk screen lists; the wheel's table talk lives on the wheel's own screen. */
export const LISTED_ROOMS: readonly Room[] = ['fire'];

export const ROOM_INFO: Record<Room, { name: string; line: string; icon: string }> = {
  fire: { name: 'The Fire', line: 'everyone on the hill', icon: 'lorc/campfire' },
  wheel: { name: 'The Wheel', line: 'heard by whoever is at the table', icon: 'lorc/cartwheel' },
};

/** How many words a talk keeps in memory. */
export const KEEP = 200;

/** `list` with `m` in id order, once, the oldest dropped past KEEP; the same list if nothing changed. */
export function appendWord(list: readonly ChatMessage[], m: ChatMessage): readonly ChatMessage[] {
  const last = list[list.length - 1];
  if (last !== undefined && m.id <= last.id) {
    if (list.some((x) => x.id === m.id)) return list;
    const out = [...list, m].sort((a, b) => a.id - b.id);
    return out.length > KEEP ? out.slice(out.length - KEEP) : out;
  }
  const out = [...list, m];
  return out.length > KEEP ? out.slice(out.length - KEEP) : out;
}

/** "14:05", the local clock. */
export function timeLabel(atMs: number): string {
  const d = new Date(atMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dayStart = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** "today" / "yesterday" / "Tue 3 Mar" / "Tue 3 Mar 2025" when it is not this year. */
export function dayLabel(atMs: number, nowMs: number): string {
  const today = dayStart(nowMs);
  const day = dayStart(atMs);
  if (day === today) return 'today';
  if (today - day > 0 && today - day <= 36 * 3_600_000) return 'yesterday';
  const d = new Date(atMs);
  const base = `${DAYS[d.getDay()]!} ${String(d.getDate())} ${MONTHS[d.getMonth()]!}`;
  return d.getFullYear() === new Date(nowMs).getFullYear()
    ? base
    : `${base} ${String(d.getFullYear())}`;
}

export interface DayGroup {
  day: string;
  messages: ChatMessage[];
}

/** Words grouped under the day they were said, oldest first. */
export function byDay(messages: readonly ChatMessage[], nowMs: number): DayGroup[] {
  const out: DayGroup[] = [];
  for (const m of messages) {
    const day = dayLabel(m.atMs, nowMs);
    const last = out[out.length - 1];
    if (last && last.day === day) last.messages.push(m);
    else out.push({ day, messages: [m] });
  }
  return out;
}

/** One line of a word for a list row, cut short with an ellipsis. */
export function preview(body: string, max = 48): string {
  const line = body.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** "you: " ahead of the caller's own last word in a list row. */
export function previewLine(m: ChatMessage, me: string, max = 48): string {
  const mine = nameKey(m.from) === nameKey(me);
  return mine ? `you: ${preview(m.body, max - 5)}` : preview(m.body, max);
}
