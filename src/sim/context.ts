import type { ContentDb } from './content/db.ts';
import type { XpCurve } from './xp.ts';

/**
 * Everything the sim needs besides the state: validated content and the progression rules.
 * Passed explicitly (never imported as a singleton) so tests run against fixture content and
 * the curve is swappable in one place.
 */
export interface SimContext {
  readonly content: ContentDb;
  readonly xp: XpCurve;
}
