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
 *   GET  /api/hall                → HallGet        (the caller's hall, invites, requests)
 *   POST /api/hall                { name } → HallGet        (201; 409 taken or already in one)
 *   POST /api/hall/invite         { name } → HallGet        (invite a name; a waiting request joins)
 *   POST /api/hall/request        { hall } → HallGet        (ask at a door; a waiting invite joins)
 *   POST /api/hall/petitions/:id  { accept } → HallGet      (the invited, or the founder, answers)
 *   POST /api/hall/leave          → HallGet
 *   POST /api/hall/expel          { name } → HallGet        (founder only)
 *   GET  /api/halls               → HallSummary[]  (every hall on the hill, best first)
 *
 * Every error is `{ error: string }` in the hill's register. State-changing requests must be
 * JSON (`Content-Type: application/json`), which with a SameSite=Lax cookie is the CSRF guard.
 */
import { z } from 'zod';
import { PlayerNameSchema } from '../sim/commands.ts';
import { HallSyncSchema } from '../sim/hall.ts';
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
  z.object({
    ok: z.literal(true),
    saveCounter: z.number().int().min(1),
    /** Where this name stands with the hall and what it took of the gifts on the cart. */
    hall: HallSyncSchema,
  }),
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

// ---- the hall ---------------------------------------------------------------------------

/** A hall's name: the same letters a hero's name allows, a little longer. */
export const HallNameSchema = z
  .string()
  .trim()
  .min(3, 'at least 3 characters')
  .max(24, 'at most 24 characters')
  .regex(/^[\p{L}\p{N} '._-]+$/u, 'letters, numbers, spaces and a few marks');

export const HallMemberSchema = z.object({
  name: z.string(),
  god: z.string().nullable(),
  /** Milliseconds since this name last saved; null before its first save. */
  seenAgoMs: z.number().min(0).nullable(),
  /** Gp worth the hall has taken from this name. */
  given: z.number().min(0),
  founder: z.boolean(),
  you: z.boolean(),
});
export type HallMember = z.infer<typeof HallMemberSchema>;

/** What the next tier still needs: an item id or `$gp`, what is in so far, and the whole. */
export const HallNeedSchema = z.object({
  what: z.string(),
  have: z.number().int().min(0),
  need: z.number().int().min(1),
});
export type HallNeed = z.infer<typeof HallNeedSchema>;

export const HallRoomSchema = z.object({
  room: z.string(),
  tier: z.number().int().min(0),
  /** Toward the next tier; empty at the top. */
  progress: z.array(HallNeedSchema),
});
export type HallRoom = z.infer<typeof HallRoomSchema>;

export const HallLedgerRowSchema = z.object({
  name: z.string(),
  room: z.string(),
  what: z.string(),
  qty: z.number().int().min(1),
  agoMs: z.number().min(0),
});
export type HallLedgerRow = z.infer<typeof HallLedgerRowSchema>;

export const HallViewSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  founder: z.string(),
  foundedAt: z.number().int().min(0),
  members: z.array(HallMemberSchema),
  rooms: z.array(HallRoomSchema),
  /** The last gifts the hall took, newest first. */
  ledger: z.array(HallLedgerRowSchema),
});
export type HallView = z.infer<typeof HallViewSchema>;

/** An invite waiting for a name, or a request waiting at a hall's door. */
export const PetitionSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['invite', 'request']),
  hall: z.string(),
  /** Who asked: the inviting member, or the name asking to join. */
  name: z.string(),
  agoMs: z.number().min(0),
});
export type Petition = z.infer<typeof PetitionSchema>;

export const HallGetSchema = z.object({
  hall: HallViewSchema.nullable(),
  /** Invites waiting for the caller (only while they have no hall). */
  invites: z.array(PetitionSchema),
  /** At a founder's door, the names asking; without a hall, where this name is asking. */
  requests: z.array(PetitionSchema),
});
export type HallGet = z.infer<typeof HallGetSchema>;

export const HallSummarySchema = z.object({
  name: z.string(),
  members: z.number().int().min(0),
  /** Tiers raised across every room. */
  raised: z.number().int().min(0),
  /** Gp worth taken in all. */
  given: z.number().min(0),
  foundedAt: z.number().int().min(0),
});
export type HallSummary = z.infer<typeof HallSummarySchema>;

export const HallsSchema = z.array(HallSummarySchema);

export const FoundHallSchema = z.object({ name: HallNameSchema });
export const InviteSchema = z.object({ name: PlayerNameSchema });
export const RequestJoinSchema = z.object({ hall: HallNameSchema });
export const AnswerSchema = z.object({ accept: z.boolean() });
export const ExpelSchema = z.object({ name: PlayerNameSchema });
