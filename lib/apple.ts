import * as THREE from 'three';

// Apple radius. The worm is ~0.5 long, so the apple is ~33 worm lengths across.
export const R0 = 12.5 / 1.5;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// Optional radius table baked from the GLB model: rows = polar angle, columns = longitude.
let TABLE: Float32Array | null = null;
let TW = 0;
let TH = 0;
export function setAppleTable(t: Float32Array, w: number, h: number) {
  TABLE = t;
  TW = w;
  TH = h;
}

function cell(row: number, col: number): number {
  // rows past a pole continue on the opposite side
  if (row < 0) {
    row = -row - 1;
    col += TW / 2;
  } else if (row >= TH) {
    row = 2 * TH - row - 1;
    col += TW / 2;
  }
  col = ((col % TW) + TW) % TW;
  return TABLE![row * TW + col];
}

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

/** Smooth (bicubic) lookup so surface normals don't look faceted. */
function tableR(th: number, phi: number): number {
  const u = ((phi + Math.PI) / (Math.PI * 2)) * TW - 0.5;
  const v = (th / Math.PI) * TH - 0.5;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = u - iu;
  const fv = v - iv;
  const r = [0, 0, 0, 0];
  for (let m = 0; m < 4; m++) {
    const row = iv - 1 + m;
    r[m] = cr(cell(row, iu - 1), cell(row, iu), cell(row, iu + 1), cell(row, iu + 2), fu);
  }
  return cr(r[0], r[1], r[2], r[3], fv);
}

/** Surface radius along the direction (x, y, z). The apple is star-shaped around its center. */
export function appleShapeR(x: number, y: number, z: number): number {
  const len = Math.hypot(x, y, z) || 1e-9;
  const cy = clamp(y / len, -1, 1);
  const th = Math.acos(cy);
  if (TABLE) return tableR(th, Math.atan2(z, x));
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
