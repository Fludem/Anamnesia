/**
 * Passwords and sessions. Passwords are scrypt with a fresh salt each, stored as one string
 * that names its own parameters so they can change later without a migration. Sessions are
 * random tokens the browser holds in an HttpOnly cookie; the register keeps only their hash,
 * so a copy of the database logs nobody in.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE } from '../src/api/protocol.ts';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function derive(password: string, salt: Buffer, N: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT.keylen, { N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** `scrypt$N$salt$hash`, base64 for the byte parts. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N);
  return ['scrypt', String(SCRYPT.N), salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || n === undefined || salt === undefined || hash === undefined)
    return false;
  const N = Number(n);
  if (!Number.isInteger(N) || N < 2) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(password, Buffer.from(salt, 'base64'), N);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** 32 random bytes, url-safe; only its hash is stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out.set(name, decodeURIComponent(value));
  }
  return out;
}

export function sessionCookie(token: string, opts: { secure: boolean; maxAgeMs: number }): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${String(Math.floor(opts.maxAgeMs / 1000))}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearedSessionCookie(secure: boolean): string {
  return sessionCookie('', { secure, maxAgeMs: 0 });
}

/**
 * Attempts per key in a sliding window, for the login door: after `max` failures in
 * `windowMs` the key waits. Memory only — a restart forgives, which is fine.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Whether `key` may try now. */
  allows(key: string, nowMs: number): boolean {
    return this.recent(key, nowMs).length < this.max;
  }

  /** Record a failure. */
  hit(key: string, nowMs: number): void {
    const recent = this.recent(key, nowMs);
    recent.push(nowMs);
    this.hits.set(key, recent);
  }

  /** Forget a key: a success clears the slate. */
  clear(key: string): void {
    this.hits.delete(key);
  }

  private recent(key: string, nowMs: number): number[] {
    const from = nowMs - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (kept.length === 0) this.hits.delete(key);
    else this.hits.set(key, kept);
    return kept;
  }
}
