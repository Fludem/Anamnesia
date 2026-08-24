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
 *   GET  /api/chat                → ChatOverview   (each room's last words, the names spoken with)
 *   GET  /api/chat/poll?after=N   → ChatPoll       (every new word since N; waits up to 25 s for one)
 *   GET  /api/chat/with/:name     → ChatThread     (the words between the caller and a name; marks them read)
 *   POST /api/chat                Say → Said       (201; 404 no such name, 403 they turned away, 429 enough)
 *   POST /api/chat/read           MarkRead → {}    (how far the caller has read in a talk)
 *   POST /api/chat/block          Block → {}       (turn away from a name, or back)
 *   GET  /api/wheel               → WheelGet       (the table: this round, who is at it, the last spins)
 *   POST /api/wheel/bet           { round, spot, stake } → WheelGet   (409 closed; staked from the purse)
 *   POST /api/wheel/take-back     { round, spot? } → WheelGet   (this round's bets return; 409 closed)
 *   GET  /api/looks?name=A&hall=H → Looks          (the looks of up to 100 names and halls)
 *   PUT  /api/look                SetLook → {}     (the caller's look; null takes it down)
 *   PUT  /api/hall/look           SetLook → {}     (the hall's mark; founder only)
 *
 * Every error is `{ error: string }` in the hill's register. State-changing requests must be
 * JSON (`Content-Type: application/json`), which with a SameSite=Lax cookie is the CSRF guard.
 */
import { z } from 'zod';
import { LookSchema } from '../look/look.ts';
import { PlayerNameSchema } from '../sim/commands.ts';
import { HallSyncSchema } from '../sim/hall.ts';
import { SpotSchema, WheelSyncSchema } from '../sim/wheel.ts';
import { SaveRecordSchema } from '../sim/save.ts';

export const SESSION_COOKIE = 'anamnesia_session';
/** A session lasts this long without being used. */
export const SESSION_TTL_MS = 90 * 24 * 3_600_000;
/** A save on the wire may be this large; the real ones are a few dozen kilobytes. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Names are unique without regard to case or the width of their letters. */
export function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

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
    /** What the table took of the cart, and what it paid out since the save last looked. */
    wheel: WheelSyncSchema,
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

// ---- the fire -------------------------------------------------------------------------------

/** What can be said at once: the server trims it the same way before it looks at the length. */
export const MAX_WORDS = 500;

/** Strip what a terminal would not print, keep newlines but not runs of them, trim. */
export function cleanWords(raw: string): string {
  return (
    raw
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- that is the point
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export const WordsSchema = z
  .string()
  .max(MAX_WORDS * 4)
  .transform(cleanWords)
  .pipe(z.string().min(1, 'say something').max(MAX_WORDS, 'at most 500 characters'));

/** The rooms: the fire is where every name is; the wheel is table talk (Phase 14). */
export const RoomSchema = z.enum(['fire', 'wheel']);
export type Room = z.infer<typeof RoomSchema>;
export const ROOMS: readonly Room[] = RoomSchema.options;

export const ChatMessageSchema = z.object({
  id: z.number().int().positive(),
  from: z.string(),
  /** The room it was said in, or null for a word between two names. */
  room: RoomSchema.nullable(),
  /** The name it was said to, or null for a room. */
  to: z.string().nullable(),
  body: z.string(),
  /** When it was said, ms since the epoch by the register's clock. */
  atMs: z.number().int().min(0),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Where a word goes: a room, or a name. */
export const TalkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('room'), room: RoomSchema }),
  z.object({ kind: z.literal('name'), name: PlayerNameSchema }),
]);
export type Talk = z.infer<typeof TalkSchema>;

/** A name the caller has exchanged words with, newest talk first. */
export const ChatNameSchema = z.object({
  name: z.string(),
  last: ChatMessageSchema,
  /** Words from this name the caller has not read. */
  unread: z.number().int().min(0),
  /** The caller has turned away from this name. */
  blocked: z.boolean(),
});
export type ChatName = z.infer<typeof ChatNameSchema>;

export const ChatRoomSchema = z.object({
  room: RoomSchema,
  /** The room's last words, oldest first. */
  messages: z.array(ChatMessageSchema),
  /** Words in the room the caller has not read. */
  unread: z.number().int().min(0),
});
export type ChatRoom = z.infer<typeof ChatRoomSchema>;

export const ChatOverviewSchema = z.object({
  /** The newest word the caller can hear; poll from here. */
  latest: z.number().int().min(0),
  /** Names listening right now, the caller among them. */
  here: z.number().int().min(0),
  rooms: z.array(ChatRoomSchema),
  names: z.array(ChatNameSchema),
});
export type ChatOverview = z.infer<typeof ChatOverviewSchema>;

export const ChatThreadSchema = z.object({
  name: z.string(),
  blocked: z.boolean(),
  /** Oldest first. */
  messages: z.array(ChatMessageSchema),
});
export type ChatThread = z.infer<typeof ChatThreadSchema>;

export const ChatPollSchema = z.object({
  latest: z.number().int().min(0),
  here: z.number().int().min(0),
  messages: z.array(ChatMessageSchema),
});
export type ChatPoll = z.infer<typeof ChatPollSchema>;

export const SaySchema = z.object({ talk: TalkSchema, body: WordsSchema });
export type Say = z.infer<typeof SaySchema>;
export const SaidSchema = z.object({ message: ChatMessageSchema });
export const MarkReadSchema = z.object({ talk: TalkSchema, id: z.number().int().min(0) });
export const BlockSchema = z.object({ name: PlayerNameSchema, blocked: z.boolean() });
export const EmptySchema = z.object({});
// ---- the wheel --------------------------------------------------------------------------

export const WheelRoundSchema = z.object({
  id: z.number().int().min(0),
  opensAt: z.number().int().min(0),
  /** Bets are taken until this moment of the register's clock. */
  closesAt: z.number().int().min(0),
  endsAt: z.number().int().min(0),
  /** Drawn the moment the bets close; null while they are open. */
  pocket: z.number().int().min(0).max(37).nullable(),
});

export const WheelBetSchema = z.object({ spot: SpotSchema, stake: z.number().int().min(1) });
export type WheelBet = z.infer<typeof WheelBetSchema>;

/** A name at the table this round and what it has down. */
export const WheelPlayerSchema = z.object({ name: z.string(), bets: z.array(WheelBetSchema) });

/** A finished round: the pocket, and what each name staked and took back. */
export const WheelSpinSchema = z.object({
  id: z.number().int().min(0),
  /** 0–36, or 37 for the double zero. */
  pocket: z.number().int().min(0).max(37),
  players: z.array(
    z.object({
      name: z.string(),
      staked: z.number().int().min(0),
      returned: z.number().int().min(0),
    }),
  ),
});
export type WheelSpin = z.infer<typeof WheelSpinSchema>;

export const WheelGetSchema = z.object({
  /** The register's clock, so the screen counts down on it and not its own. */
  now: z.number().int().min(0),
  round: WheelRoundSchema,
  /**
   * The caller's ledger; null before they ever bet. `coins` is only what the wheel owes and the
   * next save will bring home — winnings and take-backs the save has not carried in yet.
   */
  purse: z
    .object({
      coins: z.number().int().min(0),
      staked: z.number().int().min(0),
      returned: z.number().int().min(0),
    })
    .nullable(),
  /** Everyone with a bet down this round, the caller included. */
  table: z.array(WheelPlayerSchema),
  /** The last spins, newest first. */
  last: z.array(WheelSpinSchema),
});
export type WheelGet = z.infer<typeof WheelGetSchema>;

export const PlaceBetSchema = z.object({
  round: z.number().int().min(0),
  spot: SpotSchema,
  stake: z.number().int().min(1),
});
export type PlaceBet = z.infer<typeof PlaceBetSchema>;

/** Take back this round's bets while they are open — one spot's, or every one when omitted. */
export const TakeBackSchema = z.object({
  round: z.number().int().min(0),
  spot: SpotSchema.optional(),
});
export type TakeBack = z.infer<typeof TakeBackSchema>;

// ---- looks ----------------------------------------------------------------------------------

/** Names (or halls) one request may ask the looks of. */
export const MAX_LOOKS_ASKED = 100;

/** Keyed by the name as it was asked; a name the register has no look for is null. */
export const LooksSchema = z.object({
  names: z.record(z.string(), LookSchema.nullable()),
  halls: z.record(z.string(), LookSchema.nullable()),
});
export type Looks = z.infer<typeof LooksSchema>;

export const SetLookSchema = z.object({ look: LookSchema.nullable() });
export type SetLook = z.infer<typeof SetLookSchema>;
