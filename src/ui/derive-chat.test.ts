import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../api/protocol.ts';
import {
  appendWord,
  byDay,
  dayLabel,
  KEEP,
  preview,
  previewLine,
  sameTalk,
  talkKey,
  talkOf,
  timeLabel,
} from './derive-chat.ts';

const word = (id: number, from: string, to: string | null, body = 'hm'): ChatMessage => ({
  id,
  from,
  room: to === null ? 'fire' : null,
  to,
  body,
  atMs: 1_700_000_000_000 + id * 1000,
});

describe('where a word belongs', () => {
  it('is its room, or the other name in it, keyed without regard to case', () => {
    expect(talkOf(word(1, 'Ash', null), 'Ash')).toEqual({ kind: 'room', room: 'fire' });
    expect(talkOf(word(2, 'Ash', 'Birch'), 'Ash')).toEqual({ kind: 'name', name: 'Birch' });
    expect(talkOf(word(3, 'Ash', 'Birch'), 'birch')).toEqual({ kind: 'name', name: 'Ash' });
    expect(talkKey({ kind: 'name', name: 'Old  Hand' })).toBe('name:old hand');
    expect(talkKey({ kind: 'room', room: 'fire' })).toBe('room:fire');
    expect(sameTalk({ kind: 'name', name: 'ash' }, { kind: 'name', name: 'ASH' })).toBe(true);
    expect(sameTalk({ kind: 'room', room: 'fire' }, null)).toBe(false);
  });
});

describe('a list of words', () => {
  it('grows in id order, never repeats a word, and keeps only the last KEEP', () => {
    let list = appendWord([], word(5, 'Ash', null));
    list = appendWord(list, word(7, 'Ash', null));
    const same = appendWord(list, word(7, 'Ash', null));
    expect(same).toBe(list);
    list = appendWord(list, word(6, 'Ash', null));
    expect(list.map((m) => m.id)).toEqual([5, 6, 7]);
    for (let i = 10; i < 10 + KEEP + 3; i++) list = appendWord(list, word(i, 'Ash', null));
    expect(list).toHaveLength(KEEP);
    expect(list[0]!.id).toBe(10 + 3);
  });

  it('reads in one line, cut short, with "you:" ahead of your own', () => {
    expect(preview('one\n\n  two   three')).toBe('one two three');
    expect(preview('a'.repeat(60), 10)).toBe('aaaaaaaaa…');
    expect(previewLine(word(1, 'Ash', 'Birch', 'coming?'), 'ash')).toBe('you: coming?');
    expect(previewLine(word(1, 'Ash', 'Birch', 'coming?'), 'Birch')).toBe('coming?');
  });
});

describe('the clock beside a word', () => {
  const at = (y: number, mo: number, d: number, h = 12, mi = 0) =>
    new Date(y, mo - 1, d, h, mi).getTime();

  it('reads as the local time of day', () => {
    expect(timeLabel(at(2026, 8, 23, 9, 5))).toBe('09:05');
    expect(timeLabel(at(2026, 8, 23, 23, 59))).toBe('23:59');
  });

  it('names the day relative to now, with the year only when it is another', () => {
    const now = at(2026, 8, 23, 15);
    expect(dayLabel(at(2026, 8, 23, 1), now)).toBe('today');
    expect(dayLabel(at(2026, 8, 22, 23, 30), now)).toBe('yesterday');
    expect(dayLabel(at(2026, 8, 21, 23, 30), now)).toBe('Fri 21 Aug');
    expect(dayLabel(at(2025, 12, 31), now)).toBe('Wed 31 Dec 2025');
  });

  it('groups words under their day, oldest first', () => {
    const now = at(2026, 8, 23, 15);
    const words: ChatMessage[] = [
      { ...word(1, 'Ash', null), atMs: at(2026, 8, 22, 9) },
      { ...word(2, 'Ash', null), atMs: at(2026, 8, 22, 10) },
      { ...word(3, 'Ash', null), atMs: at(2026, 8, 23, 8) },
    ];
    expect(byDay(words, now).map((g) => [g.day, g.messages.map((m) => m.id)])).toEqual([
      ['yesterday', [1, 2]],
      ['today', [3]],
    ]);
  });
});
