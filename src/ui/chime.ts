/**
 * The small bell. A word said to this name alone rings two soft notes, struck from the
 * browser's own oscillators so the hill ships no sound file. Rooms never ring; only names.
 * Browsers keep a tab silent until it has been clicked in, so the very first ring may be
 * swallowed — nothing here ever throws, and a browser with no audio at all simply stays quiet.
 */

/** One context for the tab, made the first time something rings. */
let ctx: AudioContext | null = null;
/** When the bell last rang: a handful of words landing together is still one sound. */
let lastRingMs = 0;

/** The quiet after a ring, in which nothing rings again. */
const GAP_MS = 2500;
/** Two notes, the second a moment later and a third above: a bell, not an alarm. */
const NOTES: readonly { hz: number; afterMs: number }[] = [
  { hz: 987.77, afterMs: 0 },
  { hz: 1244.51, afterMs: 90 },
];
/** How long a note takes to fall to nothing, in seconds, and how loud it gets on the way up. */
const FALL = 0.5;
const PEAK = 0.12;

function context(): AudioContext | null {
  if (ctx !== null) return ctx;
  if (typeof AudioContext === 'undefined') return null;
  ctx = new AudioContext();
  return ctx;
}

function strike(): void {
  try {
    const audio = context();
    if (audio === null) return;
    // A tab that was never clicked in keeps its context suspended; ask, and carry on either way.
    if (audio.state === 'suspended') void audio.resume();
    const start = audio.currentTime + 0.01;
    for (const note of NOTES) {
      const at = start + note.afterMs / 1000;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = note.hz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(PEAK, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + FALL);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + FALL + 0.02);
    }
  } catch {
    /* no audio in this browser, or not allowed yet: the bell is never worth an error */
  }
}

/** Ring, unless the bell rang a moment ago. */
export function ring(): void {
  const now = Date.now();
  if (now - lastRingMs < GAP_MS) return;
  lastRingMs = now;
  strike();
}

/** Ring whatever the quiet says — the settings button, so the player hears what they chose. */
export function ringNow(): void {
  lastRingMs = Date.now();
  strike();
}
