/**
 * The HTTP face of the register: the routes in src/api/protocol.ts over node's own server,
 * and the built game's files when given a directory to serve. One function per route; the
 * data is all in Register, Halls and Chat, the hashing in auth. Built for one process on one machine, which
 * is what the hill is.
 */
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { ZodType } from 'zod';
import { simContext } from '../src/content/index.ts';
import {
  AnswerSchema,
  BlockSchema,
  CredentialsSchema,
  ExpelSchema,
  FoundHallSchema,
  InviteSchema,
  MarkReadSchema,
  MAX_BODY_BYTES,
  RequestJoinSchema,
  SavePutSchema,
  SaySchema,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type Session,
  type User,
} from '../src/api/protocol.ts';
import type { SimContext } from '../src/sim/context.ts';
import {
  clearedSessionCookie,
  hashPassword,
  newSessionToken,
  parseCookies,
  RateLimiter,
  sessionCookie,
  verifyPassword,
} from './auth.ts';
import { Chat, ChatError } from './chat.ts';
import { HallError, Halls } from './hall.ts';
import { Register } from './register.ts';

export interface AppOptions {
  db: DatabaseSync;
  /** Wall clock, ms. Injectable for tests. */
  now?: () => number;
  /** Serve the built game from here; null for the API alone (dev, where Vite serves it). */
  staticDir?: string | null;
  /** The content the saves are scored against. Defaults to the shipped pack. */
  ctx?: SimContext;
  /** How long a chat poll is held open; tests shorten it. */
  pollWaitMs?: number;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Failed logins allowed per name, and per address, in a quarter hour. */
const LOGIN_TRIES = { name: 10, address: 40, windowMs: 15 * 60_000 };
/** New names per address in an hour. */
const REGISTER_TRIES = { address: 10, windowMs: 3_600_000 };

export function createApp(options: AppOptions): Handler {
  const now = options.now ?? (() => Date.now());
  const halls = new Halls(options.db, options.ctx ?? simContext);
  const register = new Register(options.db, options.ctx ?? simContext, halls);
  const chat = new Chat(options.db, options.pollWaitMs);
  const staticDir = options.staticDir == null ? null : resolve(options.staticDir);
  const loginByName = new RateLimiter(LOGIN_TRIES.name, LOGIN_TRIES.windowMs);
  const loginByAddress = new RateLimiter(LOGIN_TRIES.address, LOGIN_TRIES.windowMs);
  const registerByAddress = new RateLimiter(REGISTER_TRIES.address, REGISTER_TRIES.windowMs);

  const isSecure = (req: IncomingMessage): boolean =>
    (req.socket as { encrypted?: boolean }).encrypted === true ||
    req.headers['x-forwarded-proto'] === 'https';

  const address = (req: IncomingMessage): string => {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    return first || req.socket.remoteAddress || 'unknown';
  };

  const sessionToken = (req: IncomingMessage): string | null =>
    parseCookies(req.headers.cookie).get(SESSION_COOKIE) ?? null;

  const currentUser = (req: IncomingMessage): User | null => {
    const token = sessionToken(req);
    return token ? register.userForSession(token, now()) : null;
  };

  const requireUser = (req: IncomingMessage): User => {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Not logged in.');
    return user;
  };

  async function readJson<T>(req: IncomingMessage, schema: ZodType<T>): Promise<T> {
    const type = req.headers['content-type'] ?? '';
    if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > MAX_BODY_BYTES) throw new HttpError(413, 'That is too large to be a save.');
      chunks.push(buf);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'That is not JSON.');
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.map(String).join('.') ?? '';
      throw new HttpError(400, where ? `${where}: ${issue?.message ?? 'invalid'}` : 'Invalid.');
    }
    return parsed.data;
  }

  function json(res: ServerResponse, status: number, body: unknown, headers: string[] = []): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (headers.length) res.setHeader('Set-Cookie', headers);
    res.end(JSON.stringify(body));
  }

  function openSession(res: ServerResponse, req: IncomingMessage, user: User): void {
    const token = newSessionToken();
    register.createSession(user.id, token, now());
    const session: Session = { user };
    json(res, req.method === 'POST' && req.url?.endsWith('/register') ? 201 : 200, session, [
      sessionCookie(token, { secure: isSecure(req), maxAgeMs: SESSION_TTL_MS }),
    ]);
  }

  // ---- routes -----------------------------------------------------------------------------

  async function api(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    query: URLSearchParams,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    const route = `${method} ${path}`;

    if (route === 'POST /api/register') {
      const who = address(req);
      if (!registerByAddress.allows(who, now()))
        throw new HttpError(429, 'Too many new names from here. Try later.');
      const creds = await readJson(req, CredentialsSchema);
      const hash = await hashPassword(creds.password);
      const user = register.createUser(creds.name, hash, now());
      if (!user) throw new HttpError(409, 'That name is already on the hill.');
      registerByAddress.hit(who, now());
      openSession(res, req, user);
      return;
    }

    if (route === 'POST /api/login') {
      const creds = await readJson(req, CredentialsSchema);
      const who = address(req);
      const nameKey = creds.name.toLowerCase();
      if (!loginByName.allows(nameKey, now()) || !loginByAddress.allows(who, now()))
        throw new HttpError(429, 'Too many tries. The door is shut for a while.');
      const found = register.findByName(creds.name);
      const ok = found !== null && (await verifyPassword(creds.password, found.password));
      if (!ok) {
        loginByName.hit(nameKey, now());
        loginByAddress.hit(who, now());
        throw new HttpError(401, 'No one by that name with that password.');
      }
      loginByName.clear(nameKey);
      openSession(res, req, { id: found.id, name: found.name, createdAt: found.createdAt });
      return;
    }

    if (route === 'POST /api/logout') {
      const token = sessionToken(req);
      if (token) register.deleteSession(token);
      const session: Session = { user: null };
      json(res, 200, session, [clearedSessionCookie(isSecure(req))]);
      return;
    }

    if (route === 'GET /api/me') {
      const session: Session = { user: currentUser(req) };
      json(res, 200, session);
      return;
    }

    if (route === 'GET /api/save') {
      const user = requireUser(req);
      json(res, 200, { record: register.loadSave(user.id) });
      return;
    }

    if (route === 'PUT /api/save') {
      const user = requireUser(req);
      const put = await readJson(req, SavePutSchema);
      const result = register.writeSave(user, put, now());
      json(res, result.ok ? 200 : 409, result);
      return;
    }

    const boardMatch = /^GET \/api\/highscores\/([^/]+)$/.exec(route);
    if (boardMatch) {
      const board = decodeURIComponent(boardMatch[1]!);
      if (!register.hasBoard(board)) throw new HttpError(404, 'No board by that name.');
      json(res, 200, register.board(board, currentUser(req)?.id ?? null, now()));
      return;
    }

    // ---- the hall ---------------------------------------------------------------------

    if (route === 'GET /api/hall') {
      const user = requireUser(req);
      json(res, 200, halls.view(user.id, now()));
      return;
    }

    if (route === 'POST /api/hall') {
      const user = requireUser(req);
      const { name } = await readJson(req, FoundHallSchema);
      halls.found(user, name, now());
      json(res, 201, halls.view(user.id, now()));
      return;
    }

    if (route === 'POST /api/hall/invite') {
      const user = requireUser(req);
      const { name } = await readJson(req, InviteSchema);
      halls.invite(user, name, now());
      json(res, 200, halls.view(user.id, now()));
      return;
    }

    if (route === 'POST /api/hall/request') {
      const user = requireUser(req);
      const { hall } = await readJson(req, RequestJoinSchema);
      halls.request(user, hall, now());
      json(res, 200, halls.view(user.id, now()));
      return;
    }

    const petitionMatch = /^POST \/api\/hall\/petitions\/(\d+)$/.exec(route);
    if (petitionMatch) {
      const user = requireUser(req);
      const { accept } = await readJson(req, AnswerSchema);
      halls.answer(user, Number(petitionMatch[1]), accept, now());
      json(res, 200, halls.view(user.id, now()));
      return;
    }

    if (route === 'POST /api/hall/leave') {
      const user = requireUser(req);
      if (
        (req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json') === false
      )
        throw new HttpError(415, 'Send JSON.');
      halls.leave(user);
      json(res, 200, halls.view(user.id, now()));
      return;
    }

    if (route === 'POST /api/hall/expel') {
      const user = requireUser(req);
      const { name } = await readJson(req, ExpelSchema);
      halls.expel(user, name);
      json(res, 200, halls.view(user.id, now()));
      return;
    }

    if (route === 'GET /api/halls') {
      json(res, 200, halls.list());
      return;
    }

    // ---- the fire ---------------------------------------------------------------------

    if (route === 'GET /api/chat') {
      const user = requireUser(req);
      json(res, 200, chat.overview(user));
      return;
    }

    if (route === 'GET /api/chat/poll') {
      const user = requireUser(req);
      const after = Number(query.get('after') ?? '0');
      if (!Number.isInteger(after) || after < 0) throw new HttpError(400, 'after: a word id');
      // A tab that goes away takes its question with it.
      const gone = new AbortController();
      res.on('close', () => gone.abort());
      json(res, 200, await chat.poll(user, after, gone.signal));
      return;
    }

    const withMatch = /^GET \/api\/chat\/with\/([^/]+)$/.exec(route);
    if (withMatch) {
      const user = requireUser(req);
      json(res, 200, chat.thread(user, decodeURIComponent(withMatch[1]!)));
      return;
    }

    if (route === 'POST /api/chat') {
      const user = requireUser(req);
      const { talk, body } = await readJson(req, SaySchema);
      json(res, 201, { message: chat.say(user, talk, body, now()) });
      return;
    }

    if (route === 'POST /api/chat/read') {
      const user = requireUser(req);
      const mark = await readJson(req, MarkReadSchema);
      chat.read(user, mark.talk, mark.id);
      json(res, 200, {});
      return;
    }

    if (route === 'POST /api/chat/block') {
      const user = requireUser(req);
      const { name, blocked } = await readJson(req, BlockSchema);
      chat.block(user, name, blocked, now());
      json(res, 200, {});
      return;
    }

    throw new HttpError(404, 'Nothing here.');
  }

  // ---- files ------------------------------------------------------------------------------

  function serveFile(res: ServerResponse, file: string, cache: string): void {
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', cache);
    createReadStream(file).pipe(res);
  }

  function files(req: IncomingMessage, res: ServerResponse, path: string): void {
    if (staticDir === null) throw new HttpError(404, 'Nothing here.');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Nothing here.');
    let rel: string;
    try {
      rel = decodeURIComponent(path);
    } catch {
      throw new HttpError(400, 'Bad path.');
    }
    const wanted = resolve(staticDir, `.${rel.endsWith('/') ? `${rel}index.html` : rel}`);
    if (wanted !== staticDir && !wanted.startsWith(staticDir + sep))
      throw new HttpError(404, 'Nothing here.');
    const isFile = (f: string): boolean => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    };
    if (isFile(wanted)) {
      const immutable = rel.startsWith('/assets/');
      serveFile(res, wanted, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      return;
    }
    // The game is one page: any path without an extension is it.
    if (extname(rel) === '') {
      serveFile(res, resolve(staticDir, 'index.html'), 'no-cache');
      return;
    }
    throw new HttpError(404, 'Nothing here.');
  }

  // ---- dispatch ---------------------------------------------------------------------------

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (path === '/api' || path.startsWith('/api/')) await api(req, res, path, url.searchParams);
      else files(req, res, path);
    } catch (e) {
      if (e instanceof HttpError || e instanceof HallError || e instanceof ChatError) {
        json(res, e.status, { error: e.message });
        return;
      }
      console.error(`${req.method ?? ''} ${path}:`, e);
      json(res, 500, { error: 'The register fell over. Try again.' });
    }
  }

  return (req, res) => {
    void handle(req, res);
  };
}
