/** Fixed simulation tick length. Render frames are decoupled from this. */
export const TICK_MS = 100;
/** Ticks in an hour of wall time: what "the night lasts N h" and the rate models count in. */
export const TICKS_PER_HOUR = 3_600_000 / TICK_MS; // 36,000

/**
 * Offline catch-up is capped at this much wall time; anything beyond is discarded and reported.
 * Four hours bare; the trader's lamps take it to a day, the hall's watchtower adds a little.
 */
export const OFFLINE_CAP_MS = 4 * 60 * 60 * 1000;
export const OFFLINE_CAP_TICKS = OFFLINE_CAP_MS / TICK_MS; // 144,000
