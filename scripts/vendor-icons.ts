/**
 * Clones game-icons/icons into vendor/game-icons at the commit pinned in game-icons.lock.json.
 * Idempotent: a checkout already at the pinned commit is left alone.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
export const VENDOR_DIR = resolve(ROOT, 'vendor/game-icons');

export type IconLock = { repo: string; commit: string; commitDate: string };
export function readLock(): IconLock {
  return JSON.parse(readFileSync(resolve(ROOT, 'scripts/game-icons.lock.json'), 'utf8')) as IconLock;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function main(): void {
  const lock = readLock();
  if (existsSync(resolve(VENDOR_DIR, '.git'))) {
    const head = git(['rev-parse', 'HEAD'], VENDOR_DIR);
    if (head === lock.commit) {
      console.log(`vendor/game-icons already at ${lock.commit.slice(0, 12)}`);
      return;
    }
    console.log(`vendor/game-icons at ${head.slice(0, 12)}, want ${lock.commit.slice(0, 12)}; re-fetching`);
    rmSync(VENDOR_DIR, { recursive: true, force: true });
  }
  mkdirSync(VENDOR_DIR, { recursive: true });
  git(['init', '-q'], VENDOR_DIR);
  git(['remote', 'add', 'origin', lock.repo], VENDOR_DIR);
  // Fetching a bare SHA keeps the clone shallow and exactly reproducible.
  git(['fetch', '-q', '--depth', '1', 'origin', lock.commit], VENDOR_DIR);
  git(['checkout', '-q', 'FETCH_HEAD'], VENDOR_DIR);
  console.log(`vendor/game-icons checked out at ${lock.commit.slice(0, 12)} (${lock.commitDate})`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
