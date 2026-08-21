/**
 * Builds the production icon subset and ATTRIBUTION.md.
 *
 * Collects icon ids from content/icon-manifest.json plus every `"icon": "<id>"` string found in
 * src/content/**\/*.json, looks each up in the full index, and writes:
 *   - src/assets/icons.shipped.json   (same shape as the index, only shipped icons)
 *   - ATTRIBUTION.md                  (one line per author who made a shipped icon)
 * Runs before every `dev` and `build` so neither can drift from content.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { IconIndexSchema, type IconEntry, type IconIndex } from '../src/icons/types.ts';
import { generateAttribution } from './lib/attribution.ts';

const ROOT = resolve(import.meta.dirname, '..');
const INDEX = resolve(ROOT, 'src/assets/icon-index.json');
const MANIFEST = resolve(ROOT, 'content/icon-manifest.json');
const CONTENT_DIR = resolve(ROOT, 'src/content');
const OUT_JSON = resolve(ROOT, 'src/assets/icons.shipped.json');
const OUT_MD = resolve(ROOT, 'ATTRIBUTION.md');

function walkJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkJson(p));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

/** Every string value under a key named "icon", anywhere in the JSON tree. */
export function collectIconRefs(value: unknown, out: Map<string, string[]>, file: string): void {
  if (Array.isArray(value)) {
    for (const v of value) collectIconRefs(v, out, file);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'icon' && typeof v === 'string') {
        const refs = out.get(v) ?? [];
        refs.push(file);
        out.set(v, refs);
      } else {
        collectIconRefs(v, out, file);
      }
    }
  }
}

function main(): void {
  const index = IconIndexSchema.parse(JSON.parse(readFileSync(INDEX, 'utf8')));
  const byId = new Map(index.icons.map((i) => [i.id, i] as const));

  const refs = new Map<string, string[]>();
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { icons?: unknown };
  if (!Array.isArray(manifest.icons) || !manifest.icons.every((i) => typeof i === 'string')) {
    throw new Error('content/icon-manifest.json: "icons" must be an array of strings');
  }
  for (const id of manifest.icons)
    refs.set(id, [...(refs.get(id) ?? []), 'content/icon-manifest.json']);
  for (const file of walkJson(CONTENT_DIR)) {
    collectIconRefs(JSON.parse(readFileSync(file, 'utf8')), refs, file.slice(ROOT.length + 1));
  }

  const missing = [...refs].filter(([id]) => !byId.has(id));
  if (missing.length) {
    console.error('referenced icons not in index:');
    for (const [id, files] of missing)
      console.error(`  ${id}  (${[...new Set(files)].join(', ')})`);
    process.exit(1);
  }

  const icons: IconEntry[] = [...refs.keys()].sort().map((id) => byId.get(id)!);
  const shipped: IconIndex = { version: 1, source: index.source, icons };
  writeFileSync(OUT_JSON, JSON.stringify(shipped, null, 1) + '\n');
  writeFileSync(OUT_MD, generateAttribution({ icons, source: index.source }));
  const authors = new Set(icons.map((i) => i.author)).size;
  console.log(
    `shipping ${icons.length} icons from ${authors} author(s); wrote icons.shipped.json and ATTRIBUTION.md`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
