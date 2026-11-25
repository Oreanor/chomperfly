import * as THREE from 'three';

/** The fruit's radius in a room for four. The worm is ~1 long, so that fruit is ~17 worm lengths across. */
export const R_BASE = 12.5 / 1.5;
/** This room's fruit radius (set when entering a room; a bigger room has a bigger fruit). */
export let R0 = R_BASE;

/**
 * A room's fruit: small (as for 4 players), standard (6), large (8); an old room without a size: by
 * its player count. The radius grows gently: × (players / 4)^0.4.
 */
export function setFruitSize(size: string | undefined, maxPlayers: number) {
  const players = size === 'small' ? 4 : size === 'large' ? 8 : size === 'standard' ? 6 : maxPlayers;
  R0 = R_BASE * (Math.max(2, players) / 4) ** 0.4;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// Optional radius table baked from the GLB model: rows = polar angle, columns = longitude.
let TABLE: Float32Array | null = null;
let TW = 0;
let TH = 0;
// the table's mean radius at the two poles: near a pole the cells get thin and the bicubic patch
// starts to wobble, so the surface eases into this one value there
let POLE_N = 0;
let POLE_S = 0;
export function setAppleTable(t: Float32Array, w: number, h: number) {
  TABLE = t;
  TW = w;
  TH = h;
  let n = 0;
  let s = 0;
  for (let i = 0; i < w; i++) {
    n += t[i];
    s += t[(h - 1) * w + i];
  }
  POLE_N = n / w;
  POLE_S = s / w;
}

/** Catmull-Rom value and its derivative (per cell). */
const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
const crD = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (p2 - p0) + t * (2 * p0 - 5 * p1 + 4 * p2 - p3) + 1.5 * t * t * (3 * (p1 - p2) + p3 - p0);

// the 4×4 patch of cells round the last looked-up point, and where in its middle cell the point is
const patch = new Float64Array(16);
let fu = 0;
let fv = 0;

/** Loads `patch` for the direction (th, phi). */
function loadPatch(th: number, phi: number) {
  const u = ((phi + Math.PI) / (Math.PI * 2)) * TW - 0.5;
  const v = (th / Math.PI) * TH - 0.5;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  fu = u - iu;
  fv = v - iv;
  const T = TABLE!;
  // the usual case: well inside the table, four straight rows
  if (iv >= 1 && iv + 2 < TH && iu >= 1 && iu + 2 < TW) {
    let k = (iv - 1) * TW + iu - 1;
    for (let m = 0; m < 16; m += 4, k += TW) {
      patch[m] = T[k];
      patch[m + 1] = T[k + 1];
      patch[m + 2] = T[k + 2];
      patch[m + 3] = T[k + 3];
    }
    return;
  }
  for (let m = 0; m < 4; m++) {
    for (let n = 0; n < 4; n++) {
      let row = iv - 1 + m;
      let col = iu - 1 + n;
      // rows past a pole continue on the opposite side
      if (row < 0) {
        row = -row - 1;
        col += TW / 2;
      } else if (row >= TH) {
        row = 2 * TH - row - 1;
        col += TW / 2;
      }
      col = ((col % TW) + TW) % TW;
      patch[m * 4 + n] = T[row * TW + col];
    }
  }
}

const rowAt = (m: number) => cr(patch[m], patch[m + 1], patch[m + 2], patch[m + 3], fu);
const rowD = (m: number) => crD(patch[m], patch[m + 1], patch[m + 2], patch[m + 3], fu);

/** How much of the table to trust at this distance from the axis (sin of the polar angle). */
const poleWeight = (sth: number) => {
  const t = clamp((sth - 0.02) / 0.13, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Surface radius along the direction (x, y, z). The apple is star-shaped around its center. */
export function appleShapeR(x: number, y: number, z: number): number {
  const len = Math.hypot(x, y, z) || 1e-9;
  const cy = clamp(y / len, -1, 1);
  const th = Math.acos(cy);
  if (TABLE) {
    // smooth (bicubic) lookup so surface normals don't look faceted
    loadPatch(th, Math.atan2(z, x));
    const r = cr(rowAt(0), rowAt(4), rowAt(8), rowAt(12), fv);
    const w = poleWeight(Math.sin(th));
    return w >= 1 ? r : (cy > 0 ? POLE_N : POLE_S) * (1 - w) + r * w;
  }
  const sth = Math.sin(th);
  const phi = Math.atan2(z, x);
  let r = 1 + 0.07 * cy - 0.1 * cy * cy; // wide shoulders
  if (cy < 0) r *= 1 - 0.1 * cy * cy; // narrower bottom
  r -= 0.3 * Math.exp(-((th / 0.38) ** 2)); // stem dimple
  r -= 0.12 * Math.exp(-(((Math.PI - th) / 0.3) ** 2)); // calyx dimple
  r *= 1 + 0.022 * Math.cos(5 * phi) * sth * sth + 0.012 * Math.cos(2 * phi + 0.7) * sth; // lobes
  return r * R0;
}

/** Signed "distance-like" value: < 0 inside the apple. */
export function appleF(p: THREE.Vector3): number {
  return p.length() - appleShapeR(p.x, p.y, p.z);
}

/** Move p onto the surface (radially). */
export function appleProject(p: THREE.Vector3): THREE.Vector3 {
  const r = appleShapeR(p.x, p.y, p.z);
  return p.normalize().multiplyScalar(r);
}

const tA = new THREE.Vector3();
/** Outward surface normal near p. */
export function appleNormal(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  if (TABLE) {
    // exact, from the bicubic patch: n ∝ radial − (dr/dθ)/r·θ̂ − (dr/dφ)/(r·sinθ)·φ̂
    const len = Math.hypot(p.x, p.y, p.z) || 1e-9;
    const cy = clamp(p.y / len, -1, 1);
    const th = Math.acos(cy);
    const sth = Math.sin(th);
    if (sth > 1e-6) {
      const phi = Math.atan2(p.z, p.x);
      loadPatch(th, phi);
      const r0 = rowAt(0), r1 = rowAt(4), r2 = rowAt(8), r3 = rowAt(12);
      const r = cr(r0, r1, r2, r3, fv);
      let dTh = crD(r0, r1, r2, r3, fv) * (TH / Math.PI);
      let dPhi = cr(rowD(0), rowD(4), rowD(8), rowD(12), fv) * (TW / (Math.PI * 2));
      // near a pole the radius eases into the pole's value (as in appleShapeR)
      const h = (sth - 0.02) / 0.13;
      if (h < 1) {
        const pole = cy > 0 ? POLE_N : POLE_S;
        const w = poleWeight(sth);
        // d(weight)/dθ = 6h(1−h)·cosθ/0.13
        dTh = (r - pole) * (h > 0 ? 6 * h * (1 - h) * (cy / 0.13) : 0) + w * dTh;
        dPhi = w * dPhi;
      }
      const cp = Math.cos(phi);
      const sp = Math.sin(phi);
      const a = dTh / len;
      const b = dPhi / (sth * len);
      out.set(sth * cp - a * cy * cp + b * sp, cy + a * sth, sth * sp - a * cy * sp - b * cp);
      return out.normalize();
    }
  }
  const h = 0.003;
  const f = (x: number, y: number, z: number) => appleF(tA.set(x, y, z));
  out.set(
    f(p.x + h, p.y, p.z) - f(p.x - h, p.y, p.z),
    f(p.x, p.y + h, p.z) - f(p.x, p.y - h, p.z),
    f(p.x, p.y, p.z + h) - f(p.x, p.y, p.z - h),
  );
  return out.normalize();
}

// ---------- a pit inside the fruit: an obstacle the worm can't gnaw through ----------

let PIT: { c: THREE.Vector3; r: THREE.Vector3 } | null = null; // ellipsoid: center, radii

export function setPit(pit: { c: THREE.Vector3; r: THREE.Vector3 } | null) {
  PIT = pit;
}

/** Keeps p (a ball of radius `margin`) outside the pit; true if it had to be pushed. */
export function pushOutOfPit(p: THREE.Vector3, margin: number) {
  if (!PIT) return false;
  const { c, r } = PIT;
  const x = (p.x - c.x) / (r.x + margin);
  const y = (p.y - c.y) / (r.y + margin);
  const z = (p.z - c.z) / (r.z + margin);
  const k = Math.hypot(x, y, z);
  if (k >= 1 || k === 0) return false;
  // out along the same direction in the ellipsoid's own scale (a good enough slide)
  p.set(c.x + (x / k) * (r.x + margin), c.y + (y / k) * (r.y + margin), c.z + (z / k) * (r.z + margin));
  return true;
}
