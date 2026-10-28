import { readFileSync } from 'node:fs';

// the rules shared with the game (lib/rules.json): the stun and the worm's ball radii at growth 1
const RULES = JSON.parse(readFileSync(new URL('./rules.json', import.meta.url), 'utf8'));
export const PENALTY_MS = RULES.penaltyMs;
const radii = RULES.radii;
// a worm's thickness at its size (the same as girth() in lib/worm/constants.ts: plumper than it is long)
const FAT_AT_WIN = 1.6;
const girth = (g) => g * (1 + ((FAT_AT_WIN - 1) * Math.max(0, g - 1)) / RULES.winSizeGain);
const REACH = 1.3; // a little leeway: the states come ~15 times a second

const xyz = (p, i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const cos = (a, b) => {
  const d = len(a) * len(b);
  return d ? dot(a, b) / d : 0;
};

// A bite is a head coming into the other's body: into the flank from the side, or into the tail end.
// Head-to-head contact is not a hit: two mouths locked together cannot pull apart.
export function touchesFlank(attacker, victim) {
  if (attacker.m !== victim.m) return false;
  const p = attacker.p;
  const q = victim.p;
  const aHead = xyz(p, 9);
  const vHead = xyz(q, 9);
  const forward = sub(aHead, xyz(p, 8));
  const victimForward = sub(vHead, xyz(q, 8));
  if (!len(forward) || !len(victimForward)) return false;

  const betweenHeads = sub(aHead, vHead);
  const headGap = len(betweenHeads);
  const aR = girth(attacker.g);
  const vR = girth(victim.g);
  // Head-on (mouths meet): only when the other's head is close and right in front of its face; a big
  // worm's head is so large it often brushes a small one's head while biting its body, and that counts.
  if (headGap < radii[9] * (aR + vR) * 0.7 && cos(victimForward, betweenHeads) > 0.5) return false;

  for (let k = 0; k <= 7; k++) {
    const point = xyz(q, k);
    const delta = sub(point, aHead);
    const distance = len(delta);
    if (!distance || distance > (radii[9] * aR + radii[k] * vR) * REACH) continue;
    if (headGap <= distance) continue;
    if (dot(forward, delta) < 0) continue; // the mouth goes towards it
    if (k <= 1) return true; // the tail end: from any side, from behind too
    const tangent = sub(xyz(q, k + 1), xyz(q, k - 1));
    // the body: the mouth comes at it at an angle (not sliding along it), on its side
    if (Math.abs(cos(forward, tangent)) > 0.8) continue;
    if (Math.abs(cos(delta, tangent)) > 0.8) continue;
    return true;
  }
  return false;
}
