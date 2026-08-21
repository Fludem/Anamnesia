/**
 * Fetches game-icons/icons into vendor/game-icons at the commit pinned in game-icons.lock.json.
 *
 * The vendored tree is committed to this repo as plain files (no nested .git), so a fresh
 * checkout already has it and this script is a no-op. Run with `--refresh` after bumping the
 * lock to replace the tree with the newly pinned commit; commit the result.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
export const VENDOR_DIR = resolve(ROOT, 'vendor/game-icons');

export type IconLock = { repo: string; commit: string; commitDate: string };
export function readLock(): IconLock {
  return JSON.parse(
    readFileSync(resolve(ROOT, 'scripts/game-icons.lock.json'), 'utf8'),
  ) as IconLock;
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function main(): void {
  const lock = readLock();
  const refresh = process.argv.includes('--refresh');
  if (existsSync(resolve(VENDOR_DIR, 'license.txt')) && !refresh) {
    console.log(
      `vendor/game-icons is checked in (pinned ${lock.commit.slice(0, 12)}); pass --refresh to re-fetch`,
    );
    return;
  }
  rmSync(VENDOR_DIR, { recursive: true, force: true });
  mkdirSync(VENDOR_DIR, { recursive: true });
  git(['init', '-q'], VENDOR_DIR);
  git(['remote', 'add', 'origin', lock.repo], VENDOR_DIR);
  // Fetching a bare SHA keeps the clone shallow and exactly reproducible.
  git(['fetch', '-q', '--depth', '1', 'origin', lock.commit], VENDOR_DIR);
  git(['checkout', '-q', 'FETCH_HEAD'], VENDOR_DIR);
  // Plain files, not an embedded repository: the outer repo tracks the tree itself.
  rmSync(resolve(VENDOR_DIR, '.git'), { recursive: true, force: true });
  console.log(`vendor/game-icons refreshed to ${lock.commit.slice(0, 12)} (${lock.commitDate})`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
