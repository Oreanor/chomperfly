// Worm tuning. Sizes are at growth 1; the game scales them by the worm's current growth.
// The rules the server checks too live in lib/rules.json (one place for both).
import RULES from '../rules.json';

export const N = 10; // balls, index 0 = tail, N-1 = head
/** Ball radii, tail → head (lib/rules.json; the server's bite check uses them too). */
export const RADII: readonly number[] = RULES.radii;

export const L0 = 1; // relaxed body length; camera and labels are sized by it
export const LC0 = 0.56; // body length when the back is pulled up (inchworm)
export const SEG_R0 = 0.14; // body center height above the skin

export const CYCLE = 0.52; // seconds per inchworm step (shorter = faster crawl)
export const STRAIGHT_HOLD = 0.2; // part of each step spent lying straight
export const DIG_SPEED = 0.5; // units/s while gnawing at growth 1

export const GROWTH_PER_DIAMETER = 0.5; // gnawing a path as long as the fruit's diameter: +50% size
export const GROWTH_MAX = 3;
export const WIN_OPTIONS: readonly number[] = RULES.winOptions; // a room's goal in points
export const WIN_DEFAULT: number = RULES.winDefault;
export const WIN_SIZE_GAIN: number = RULES.winSizeGain; // by the win the worm is 1 + this times its starting size, whatever the goal
export const WIN_GROWTH = 1 + WIN_SIZE_GAIN;
export const SEED_BONUS_MS: number = RULES.seedBonusMs; // how long one eaten seed speeds you up
const FAT_AT_WIN = 1.6; // and plumper too: by the win its thickness grows this much more than its length
/** Thickness scale of a worm of this size (grows a bit faster than the length). */
export const girth = (size: number) => size * (1 + ((FAT_AT_WIN - 1) * Math.max(0, size - 1)) / WIN_SIZE_GAIN);

export const PULSE_TIME = 0.15; // seconds per ball in the "swallowing" wave
export const PULSE_AMP = 0.2; // +20% at the peak
export const PULSE_WIDTH = 2.4; // each ball's swell lasts 2.4 steps, so neighbours overlap

export const TUNNEL_R0 = 0.15;
export const HOLE_R0 = 0.17;
export const TUNNEL_STEP = 0.03; // distance between stored tunnel points

export const DEFAULT_NAME = 'worm'; // a nameless player (names are always sent; just in case)

export const ease = (x: number) => x * x * (3 - 2 * x);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent smoothing factor. */
export const damp = (dt: number, k: number) => 1 - Math.exp(-k * dt);
export const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Spider-venom panic: the speed factor, ×2 at any size. */
export const amokBoost = (_growth: number) => 2;
