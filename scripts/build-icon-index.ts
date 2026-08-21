/**
 * Walks vendor/game-icons and emits src/assets/icon-index.json: every icon's id, author,
 * licence, curated tags, and inline path geometry. Fails (exit 1) if any SVG does not match
 * the expected shape or any author directory cannot be attributed.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { IconIndexSchema, type IconEntry, type IconIndex } from '../src/icons/types.ts';
import { EXCLUDED_DIRS, resolveAuthor } from './lib/authors.ts';
import { parseLicenseFile } from './lib/license-parse.ts';
import { extractIconPath } from './lib/svg-extract.ts';
import { readLock, VENDOR_DIR } from './vendor-icons.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'src/assets/icon-index.json');
const TAGS_FILE = resolve(ROOT, 'content/icon-tags.json');

function readTags(): Record<string, string[]> {
  const raw = JSON.parse(readFileSync(TAGS_FILE, 'utf8')) as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const [id, tags] of Object.entries(raw)) {
    if (id.startsWith('$')) continue; // "$comment" style keys
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) {
      throw new Error(`content/icon-tags.json: "${id}" must be an array of strings`);
    }
    out[id] = tags;
  }
  return out;
}

function main(): void {
  const lock = readLock();
  const licenseAuthors = parseLicenseFile(readFileSync(join(VENDOR_DIR, 'license.txt'), 'utf8'));
  const tags = readTags();

  const icons: IconEntry[] = [];
  const failures: string[] = [];
  const skipped: string[] = [];
  const perAuthor = new Map<string, number>();

  const dirs = readdirSync(VENDOR_DIR)
    .filter((name) => !name.startsWith('.') && statSync(join(VENDOR_DIR, name)).isDirectory())
    .sort();

  for (const dir of dirs) {
    if (EXCLUDED_DIRS.has(dir)) {
      skipped.push(dir);
      continue;
    }
    const author = resolveAuthor(dir, licenseAuthors);
    const files = readdirSync(join(VENDOR_DIR, dir)).filter((f) => f.endsWith('.svg')).sort();
    for (const file of files) {
      const slug = file.slice(0, -'.svg'.length);
      const id = `${dir}/${slug}`;
      const result = extractIconPath(readFileSync(join(VENDOR_DIR, dir, file), 'utf8'));
      if (!result.ok) {
        failures.push(`${id}: ${result.error}`);
        continue;
      }
      const entry: IconEntry = {
        id,
        slug,
        author: dir,
        authorName: author.name,
        license: author.license,
        tags: tags[id] ?? [],
        d: result.d,
      };
      if (author.url) entry.authorUrl = author.url;
      icons.push(entry);
      perAuthor.set(dir, (perAuthor.get(dir) ?? 0) + 1);
    }
  }

  const unknownTagIds = Object.keys(tags).filter((id) => !icons.some((i) => i.id === id));

  icons.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index: IconIndex = { version: 1, source: { repo: lock.repo, commit: lock.commit }, icons };
  IconIndexSchema.parse(index);

  console.log(`indexed ${icons.length} icons from ${perAuthor.size} authors`);
  for (const [dir, n] of [...perAuthor].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${dir}`);
  if (skipped.length) console.log(`skipped dirs: ${skipped.join(', ')}`);
  if (failures.length) {
    console.error(`\n${failures.length} icon(s) failed extraction:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }

  if (unknownTagIds.length) {
    console.error(`content/icon-tags.json references unknown icons:\n  ${unknownTagIds.join('\n  ')}`);
    process.exit(1);
  }
  // Compact single-line entries keep the file diffable per icon without bloating it.
  const json = `{"version":1,"source":${JSON.stringify(index.source)},"icons":[\n${icons
    .map((i) => JSON.stringify(i))
    .join(',\n')}\n]}\n`;
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT} (${(json.length / 1e6).toFixed(2)} MB)`);
}

main();
