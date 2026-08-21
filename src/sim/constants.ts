/** Fixed simulation tick length. Render frames are decoupled from this. */
export const TICK_MS = 100;

/** Offline catch-up is capped at this much wall time; anything beyond is discarded and reported. */
export const OFFLINE_CAP_MS = 12 * 60 * 60 * 1000;
export const OFFLINE_CAP_TICKS = OFFLINE_CAP_MS / TICK_MS; // 432,000
