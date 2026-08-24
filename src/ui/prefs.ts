/**
 * Per-browser UI preferences (which screen is open, how much the UI celebrates). These are
 * not game state: they live in localStorage, never in the save, and a missing or corrupt value
 * silently falls back to the default.
 */
import { useCallback, useState } from 'react';
import { z } from 'zod';

export const ViewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skill'), id: z.string().min(1) }),
  z.object({ kind: z.literal('bank') }),
  z.object({ kind: z.literal('equipment') }),
  z.object({ kind: z.literal('trader') }),
  z.object({ kind: z.literal('hall') }),
  z.object({ kind: z.literal('talk') }),
  z.object({ kind: z.literal('wheel') }),
  /** `board` is a highscores board id: total, wealth or a skill. */
  z.object({ kind: z.literal('highscores'), board: z.string().min(1).default('total') }),
]);
export type View = z.infer<typeof ViewSchema>;

export const JuiceSchema = z.enum(['deadpan', 'quiet', 'juicy']);

/** Whether a word said to this name alone rings the small bell. */
export const ChimeSchema = z.boolean();

const PREFIX = 'anamnesia:';

function read<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode, quota — the preference just does not stick */
  }
}

export function usePref<T>(key: string, schema: z.ZodType<T>, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, schema, fallback));
  const set = useCallback(
    (v: T) => {
      setValue(v);
      write(key, v);
    },
    [key],
  );
  return [value, set];
}
