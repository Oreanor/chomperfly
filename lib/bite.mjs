export const PENALTY_MS = 5000;
// ball radii at growth 1, same as RADII in lib/worm/constants.ts
const radii = [0.072, 0.092, 0.108, 0.12, 0.128, 0.132, 0.13, 0.124, 0.116, 0.112];

const xyz = (p, i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const cos = (a, b) => {
  const d = len(a) * len(b);
  return d ? dot(a, b) / d : 0;
};

// A bite is a head coming into the flank from the side.
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
  if (headGap < radii[9] * (attacker.g + victim.g)) return false;
  // In front of the other face. That meeting is head-on, not a side bite.
  if (cos(victimForward, betweenHeads) > 0.5) return false;

  for (let k = 2; k <= 6; k++) {
    const point = xyz(q, k);
    const delta = sub(point, aHead);
    const distance = len(delta);
    if (!distance || distance > radii[9] * attacker.g + radii[k] * victim.g) continue;
    if (headGap <= distance) continue;
    const tangent = sub(xyz(q, k + 1), xyz(q, k - 1));
    // Mouth aimed across the body, and the contact itself is on the side.
    if (Math.abs(cos(forward, tangent)) > 0.5) continue;
    if (Math.abs(cos(delta, tangent)) > 0.5) continue;
    if (dot(forward, delta) < 0) continue;
    return true;
  }
  return false;
}
