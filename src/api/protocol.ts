/**
 * The wire between the game and its server, as schemas both ends import. Names and saves are
 * the sim's own shapes; nothing here knows how either side stores them.
 *
 *   POST /api/register   Credentials → Session     (201; 409 name taken)
 *   POST /api/login      Credentials → Session     (200; 401 wrong name or password)
 *   POST /api/logout     → Session with user null
 *   GET  /api/me         → Session
 *   GET  /api/save       → SaveGet
 *   PUT  /api/save       SavePut → SavePutResult   (200 ok; 409 stale, with what is stored)
 *   GET  /api/highscores/:board → Board            (404 unknown board)
 *
 * Every error is `{ error: string }` in the hill's register. State-changing requests must be
 * JSON (`Content-Type: application/json`), which with a SameSite=Lax cookie is the CSRF guard.
 */
import { z } from 'zod';
import { PlayerNameSchema } from '../sim/commands.ts';
import { SaveRecordSchema } from '../sim/save.ts';

export const SESSION_COOKIE = 'anamnesia_session';
/** A session lasts this long without being used. */
export const SESSION_TTL_MS = 90 * 24 * 3_600_000;
/** A save on the wire may be this large; the real ones are a few dozen kilobytes. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const PasswordSchema = z.string().min(8, 'at least 8 characters').max(200);
export const CredentialsSchema = z.object({ name: PlayerNameSchema, password: PasswordSchema });
export type Credentials = z.infer<typeof CredentialsSchema>;

export const UserSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  /** When the name was made, ms since the epoch. */
  createdAt: z.number().int().min(0),
});
export type User = z.infer<typeof UserSchema>;

export const SessionSchema = z.object({ user: UserSchema.nullable() });
export type Session = z.infer<typeof SessionSchema>;

export const SaveGetSchema = z.object({ record: SaveRecordSchema.nullable() });
export const SavePutSchema = z.object({
  record: SaveRecordSchema,
  expectedCounter: z.number().int().min(0),
});
export type SavePut = z.infer<typeof SavePutSchema>;
export const SavePutResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), saveCounter: z.number().int().min(1) }),
  /** `stored` is what is there instead; null only if the save has gone entirely. */
  z.object({
    ok: z.literal(false),
    reason: z.literal('stale'),
    stored: SaveRecordSchema.nullable(),
  }),
]);
export type SavePutResult = z.infer<typeof SavePutResultSchema>;

export const BoardRowSchema = z.object({
  rank: z.number().int().positive(),
  name: z.string(),
  god: z.string().nullable(),
  /** Level in the skill or the total level; null on the wealth board. */
  level: z.number().int().nullable(),
  score: z.number(),
  /** Milliseconds since this name last saved. */
  seenAgoMs: z.number().min(0),
  you: z.boolean(),
});
export type BoardRow = z.infer<typeof BoardRowSchema>;

export const StandingRowSchema = z.object({
  board: z.string(),
  rank: z.number().int().positive(),
  /** How many names are on that board. */
  of: z.number().int().min(0),
  level: z.number().int().nullable(),
  score: z.number(),
});
export type StandingRow = z.infer<typeof StandingRowSchema>;

export const BoardSchema = z.object({
  board: z.string(),
  /** Names on this board. */
  players: z.number().int().min(0),
  /** Best first; the top of the board, plus the caller's own row if it is further down. */
  rows: z.array(BoardRowSchema),
  /** The caller's standing on every board, or empty before their first save. */
  standings: z.array(StandingRowSchema),
});
export type Board = z.infer<typeof BoardSchema>;

export const ApiErrorSchema = z.object({ error: z.string() });
