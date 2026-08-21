/**
 * Runtime access to the icons that ship with the game. Only the shipped subset is imported here —
 * the full index is dev-only and must never be referenced from game code.
 */

import shippedJson from '../assets/icons.shipped.json';
import { IconIndexSchema, type IconEntry, type IconIndex } from './types.ts';

export class IconRegistry {
  private readonly byId: ReadonlyMap<string, IconEntry>;
  readonly source: IconIndex['source'];

  constructor(index: unknown) {
    const parsed = IconIndexSchema.parse(index);
    this.byId = new Map(parsed.icons.map((i) => [i.id, i] as const));
    this.source = parsed.source;
  }

  get size(): number {
    return this.byId.size;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Throws on an unknown id: a missing icon is a content bug, not a render-time fallback. */
  get(id: string): IconEntry {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`icon "${id}" is not in the shipped icon set`);
    return entry;
  }

  all(): IconEntry[] {
    return [...this.byId.values()];
  }
}

export const icons: IconRegistry = new IconRegistry(shippedJson);
