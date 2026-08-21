/**
 * Pure search over icon entries. Slug words are the primary signal ("broad-sword" → broad, sword);
 * curated tags and author name are secondary. No upstream tag data exists, see DECISIONS.md.
 */

import type { IconEntry, License } from './types.ts';

export type SearchableIcon = Pick<
  IconEntry,
  'id' | 'slug' | 'author' | 'authorName' | 'tags' | 'license'
>;

export function tokenize(slug: string): string[] {
  return slug.split('-').filter((t) => t.length > 0);
}

export type SearchOptions = {
  query: string;
  author?: string | undefined;
  license?: License | undefined;
};

/**
 * Returns matching icons, best first. Scoring: exact slug match > exact token match >
 * token prefix > tag match > token substring > tag prefix > author name match. Ties keep index order (sorted by id).
 */
export function searchIcons<T extends SearchableIcon>(
  entries: readonly T[],
  opts: SearchOptions,
): T[] {
  const queryTokens = opts.query
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((t) => t.length > 0);
  const scored: { entry: T; score: number }[] = [];

  for (const entry of entries) {
    if (opts.author && entry.author !== opts.author) continue;
    if (opts.license && entry.license !== opts.license) continue;
    if (queryTokens.length === 0) {
      scored.push({ entry, score: 0 });
      continue;
    }
    const score = scoreEntry(entry, queryTokens);
    if (score > 0) scored.push({ entry, score });
  }

  if (queryTokens.length > 0) scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}

function scoreEntry(entry: SearchableIcon, queryTokens: string[]): number {
  const slugTokens = tokenize(entry.slug);
  const tags = entry.tags.map((t) => t.toLowerCase());
  const authorKey = entry.authorName.toLowerCase();
  let total = 0;
  for (const q of queryTokens) {
    let best = 0;
    if (entry.slug === q) best = 100;
    else if (slugTokens.includes(q)) best = 50;
    else if (slugTokens.some((t) => t.startsWith(q))) best = 25;
    else if (tags.includes(q)) best = 20;
    else if (slugTokens.some((t) => t.includes(q)))
      best = 15; // "sword" in "broadsword"
    else if (tags.some((t) => t.startsWith(q))) best = 10;
    else if (authorKey.startsWith(q) || entry.author.startsWith(q)) best = 5;
    if (best === 0) return 0; // every query token must match something
    total += best;
  }
  return total;
}
