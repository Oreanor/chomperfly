import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Critter bodies, built from shaped parts (lathed segments, ellipsoids) merged into one mesh each, coloured
// by vertex (gradients, bands, patterns), with a shared chitin texture for fine relief and glossy
// variation. Units: × body length; z forward, y up (as the legs in AntView expect).

// ---------- textures ----------

/** Tileable value noise, a few octaves, 0…1. */
function noiseCanvas(size: number, seed: number, octaves: number[], contrast = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const layers = octaves.map((cells) => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return { cells, g };
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let w = 0;
      let amp = 1;
      for (const { cells, g } of layers) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const at = (i: number, j: number) => g[((j + cells) % cells) * cells + ((i + cells) % cells)];
        const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
        const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
        v += (a + (b - a) * sy) * amp;
        w += amp;
        amp *= 0.55;
      }
      v = 0.5 + (v / w - 0.5) * contrast;
      const k = (y * size + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.max(0, Math.min(255, v * 255));
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

let chitinTex: THREE.CanvasTexture | null = null;
/** Fine pitting and tiny ridges of an insect's armour (a bump map; repeats). */
export function chitinBump() {
  if (!chitinTex) {
    chitinTex = new THREE.CanvasTexture(noiseCanvas(256, 7, [64, 32, 16], 1.6));
    chitinTex.wrapS = chitinTex.wrapT = THREE.RepeatWrapping;
    chitinTex.repeat.set(3, 3);
  }
  return chitinTex;
}

let roughTex: THREE.CanvasTexture | null = null;
/** Patchy gloss: worn and polished spots (a roughness map). */
function glossPatches() {
  if (!roughTex) {
    roughTex = new THREE.CanvasTexture(noiseCanvas(128, 19, [8, 16], 1.3));
    roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
  }
  return roughTex;
}

/** A glossy insect material (colours from the vertices). */
function chitin(opts: THREE.MeshPhysicalMaterialParameters = {}) {
  return new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.42,
    roughnessMap: glossPatches(),
    bumpMap: chitinBump(),
    bumpScale: 0.6,
    clearcoat: 0.6,
    clearcoatRoughness: 0.22,
    ...opts,
  });
}

// ---------- parts ----------

type Paint = (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color;
const tV = new THREE.Vector3();
const tN = new THREE.Vector3();
const tColor = new THREE.Color();

/** Colours a geometry's vertices with paint(position, normal) (in the body's frame), and places it there. */
function part(geo: THREE.BufferGeometry, m: THREE.Matrix4, paint: Paint) {
  geo.applyMatrix4(m);
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    tV.fromBufferAttribute(pos, i);
    tN.fromBufferAttribute(nor, i);
    paint(tV, tN).toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (geo.index) return geo.toNonIndexed();
  return geo;
}

const mtx = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

/** An ellipsoid with radii (rx, ry, rz). */
const ellipsoid = (rx: number, ry: number, rz: number, w = 24, h = 16) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);

/**
 * A body segment lathed along z: radius(t) for t 0 (back) … 1 (front), over `len`; flat: y squash.
 * Its back end at z = −len/2.
 */
function lathed(len: number, radius: (t: number) => number, flat = 1, seg = 28, rings = 24) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    pts.push(new THREE.Vector2(Math.max(1e-4, radius(t)), (t - 0.5) * len));
  }
  // lathe round y, then lay it along z
  return new THREE.LatheGeometry(pts, seg).rotateX(Math.PI / 2).scale(1, flat, 1);
}

/** A tapering spike (a mandible, a claw) from (0,0,0) along +z. */
const spike = (r: number, len: number) => new THREE.ConeGeometry(r, len, 8, 1).rotateX(Math.PI / 2).translate(0, 0, len / 2);

const col = (hex: number) => new THREE.Color(hex);
const mix = (a: THREE.Color, b: THREE.Color, k: number) => tColor.copy(a).lerp(b, Math.max(0, Math.min(1, k)));
/** A little hash noise from a position (for speckles and uneven colour). */
const hash = (p: THREE.Vector3, s = 1) => {
  const v = Math.sin(p.x * 127.1 * s + p.y * 311.7 * s + p.z * 74.7 * s) * 43758.5453;
  return v - Math.floor(v);
};

function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
  g.computeBoundingSphere();
  return g;
}

// ---------- the ant ----------

let antGeo: THREE.BufferGeometry | null = null;
/** An ant: a heart-ish head with jaws and eyes, a humped thorax, a waist node, a banded gaster. */
function antGeometry() {
  if (antGeo) return antGeo;
  const dark = col(0x1a0c07);
  const body = col(0x3a1a0d);
  const shine = col(0x5a2c16);
  // darker on top, a warm sheen on the sides
  const skin: Paint = (_p, n) => mix(body, dark, 0.5 + 0.5 * n.y).lerp(shine, Math.max(0, 0.35 - Math.abs(n.y)) * 0.8);
  const parts = [
    part(ellipsoid(0.088, 0.07, 0.086), mtx(0, 0.13, 0.32, 0.25), skin), // head, a bit nodding
    part(ellipsoid(0.03, 0.03, 0.04), mtx(0, 0.12, 0.245), skin), // neck
    part(ellipsoid(0.022, 0.018, 0.022, 12, 8), mtx(0.072, 0.15, 0.335), () => col(0x050403)), // eyes
    part(ellipsoid(0.022, 0.018, 0.022, 12, 8), mtx(-0.072, 0.15, 0.335), () => col(0x050403)),
    part(spike(0.016, 0.075), mtx(0.035, 0.095, 0.385, 0, -0.55), () => col(0x241008)), // jaws
    part(spike(0.016, 0.075), mtx(-0.035, 0.095, 0.385, 0, 0.55), () => col(0x241008)),
    // the thorax: a long hump, higher in front
    part(
      lathed(0.24, (t) => 0.055 * Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92)) ** 0.6 * (0.8 + 0.25 * t), 1.05),
      mtx(0, 0.12, 0.08, -0.12),
      skin,
    ),
    part(ellipsoid(0.032, 0.048, 0.03), mtx(0, 0.13, -0.065, 0.2), skin), // the waist node
    // the gaster: a teardrop with darker seams between its segments, hairier towards the tip
    part(
      lathed(0.32, (t) => 0.125 * Math.sin(Math.PI * Math.min(1, t * 1.02)) ** 0.75 * (1 - 0.12 * t)),
      mtx(0, 0.135, -0.24, 0.16),
      (p, n) => {
        const z = (p.z + 0.4) / 0.32; // 0 back … 1 front
        const seam = Math.min(...[0.32, 0.52, 0.7].map((s) => Math.abs(z - s)));
        return skin(p, n).multiplyScalar(seam < 0.025 ? 0.55 : 1 + 0.08 * hash(p, 3));
      },
    ),
  ];
  antGeo = merge(parts);
  return antGeo;
}

// ---------- the spider ----------

let spiderGeo: THREE.BufferGeometry | null = null;
/** A garden spider: a brown head-chest with a dark stripe, eight little eyes, fangs; a big abdomen with a leaf pattern. */
function spiderGeometry() {
  if (spiderGeo) return spiderGeo;
  const base = col(0x6a4a2e);
  const dark = col(0x2a1a10);
  const light = col(0xc9a77a);
  const ceph: Paint = (p, n) => {
    const stripe = Math.abs(p.x) < 0.035 ? 0.6 : 0; // a dark band down the middle
    return mix(base, dark, 0.35 + stripe + 0.25 * Math.max(0, -n.y)).multiplyScalar(0.92 + 0.16 * hash(p, 5));
  };
  const abdomen: Paint = (p, n) => {
    // the folium: a dark leaf down the back, scalloped (chevrons), with a pale rim and a pale cross
    const zz = (p.z + 0.19) / 0.23; // −1 back … 1 front
    const xx = Math.abs(p.x) / 0.17;
    const leafW = 0.55 * (1 - 0.6 * ((1 - zz) / 2)) + 0.07 * Math.sin(zz * 14);
    const onTop = n.y > -0.1;
    let c = mix(base, light, 0.15 + 0.2 * hash(p, 4));
    if (onTop && xx < leafW) c = mix(dark, base, 0.25 + 0.3 * ((Math.sin(zz * 22 + xx * 9) + 1) / 2));
    if (onTop && Math.abs(xx - leafW) < 0.06) c = light.clone().multiplyScalar(0.85);
    // the cross: a pale line down the middle and one across, near the front
    if (onTop && ((xx < 0.05 && zz > 0.15) || (Math.abs(zz - 0.45) < 0.05 && xx < 0.3))) c = light.clone();
    if (n.y < -0.4) c = mix(dark, base, 0.4); // the belly
    return c.clone();
  };
  const parts = [
    part(ellipsoid(0.12, 0.08, 0.14, 28, 18), mtx(0, 0.17, 0.11), ceph), // head-chest
    part(ellipsoid(0.03, 0.03, 0.03, 10, 8), mtx(0, 0.17, -0.03), ceph), // the waist
    part(ellipsoid(0.17, 0.15, 0.23, 40, 28), mtx(0, 0.21, -0.19, -0.12), abdomen),
    part(ellipsoid(0.022, 0.03, 0.026, 10, 8), mtx(0.028, 0.13, 0.245, 0.4), () => col(0x1c120b)), // fangs
    part(ellipsoid(0.022, 0.03, 0.026, 10, 8), mtx(-0.028, 0.13, 0.245, 0.4), () => col(0x1c120b)),
  ];
  // eight eyes: two rows on the front of the head
  for (const [x, y, z, r] of [
    [0.018, 0.215, 0.235, 0.014],
    [-0.018, 0.215, 0.235, 0.014],
    [0.045, 0.205, 0.225, 0.011],
    [-0.045, 0.205, 0.225, 0.011],
    [0.02, 0.235, 0.215, 0.012],
    [-0.02, 0.235, 0.215, 0.012],
    [0.05, 0.225, 0.2, 0.009],
    [-0.05, 0.225, 0.2, 0.009],
  ]) {
    parts.push(part(ellipsoid(r, r, r, 10, 8), mtx(x, y, z), () => col(0x060403)));
  }
  spiderGeo = merge(parts);
  return spiderGeo;
}

// ---------- the rose chafer ----------

let chaferGeo: THREE.BufferGeometry | null = null;
/** The chafer's white flecks: |x|, z, radius (mirrored on both wing cases). */
const FLECKS: [number, number, number][] = [
  [0.09, -0.06, 0.022],
  [0.15, -0.14, 0.018],
  [0.2, -0.24, 0.02],
  [0.08, -0.25, 0.016],
  [0.13, -0.32, 0.02],
  [0.22, -0.05, 0.015],
  [0.06, -0.36, 0.014],
  [0.18, -0.36, 0.013],
];
/** A rose chafer: broad, flat-topped wing cases with a seam and white flecks, a trapezoid neck shield, a small head. */
function chaferGeometry() {
  if (chaferGeo) return chaferGeo;
  const green = col(0x3aa043);
  const deep = col(0x165c22);
  const gold = col(0x9aa83a);
  const fleckC = col(0xf0eee2);
  const under = col(0x1b3a1e);
  // metallic green, golden where it faces the light, deep in the hollows
  const shell: Paint = (p, n) => mix(deep, green, 0.45 + 0.55 * n.y).lerp(gold, Math.max(0, n.z) * 0.35);
  const elytra: Paint = (p, n) => {
    const c = shell(p, n).clone();
    if (Math.abs(p.x) < 0.008 && n.y > 0.3) return c.multiplyScalar(0.35); // the seam
    // small white flecks on the back half and the sides: round blobs round scattered centres
    if (n.y > -0.2 && p.z < 0.05 && Math.abs(p.x) > 0.05) {
      for (const [fx, fz, fr] of FLECKS) {
        const d = Math.hypot(Math.abs(p.x) - fx, p.z - fz) / fr;
        if (d < 1) return mix(fleckC, c, d * d * d);
      }
    }
    return c.multiplyScalar(0.95 + 0.1 * hash(p, 7));
  };
  const parts = [
    // the wing cases: broad and flat-topped, square-shouldered, rounded behind
    part(
      lathed(
        0.62,
        // closed at both ends (it was open behind): a round end at the back, square shoulders in front
        (t) => 0.26 * (0.93 + 0.07 * Math.sin(Math.PI * t)) * (t < 0.35 ? Math.sqrt(1 - ((0.35 - t) / 0.35) ** 2) : t > 0.9 ? Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2)) : 1),
        0.42,
        112,
        56,
      ),
      mtx(0, 0.17, -0.1),
      elytra,
    ),
    part(ellipsoid(0.24, 0.07, 0.34, 28, 14), mtx(0, 0.1, -0.05), () => under.clone()), // the underside
    // the neck shield: a low, wide dome, sloping down to the head
    part(ellipsoid(0.2, 0.085, 0.12, 32, 16), mtx(0, 0.2, 0.22, 0.25), shell),
    part(ellipsoid(0.05, 0.018, 0.07, 12, 8), mtx(0, 0.235, 0.12, -0.1), shell), // the little shield between the cases
    part(ellipsoid(0.07, 0.045, 0.07, 18, 12), mtx(0, 0.14, 0.34, 0.35), shell), // head, half under the shield
    part(ellipsoid(0.055, 0.018, 0.045, 12, 8), mtx(0, 0.11, 0.4, 0.5), shell), // its front plate
  ];
  chaferGeo = merge(parts);
  return chaferGeo;
}

// ---------- materials ----------

// made on first use (textures need a document: not while rendering on the server)
const mats: Partial<Record<'ant' | 'spider' | 'chafer', THREE.Material>> = {};
const bodyMat = (kind: 'ant' | 'spider' | 'chafer') =>
  (mats[kind] ??=
    kind === 'ant'
      ? chitin({ roughness: 0.38, clearcoat: 0.55 })
      : kind === 'spider'
        ? chitin({ roughness: 0.75, clearcoat: 0.1, bumpScale: 1.2 }) // hairy, dull
        : chitin({ metalness: 0.65, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.6, iridescenceIOR: 1.6, envMapIntensity: 1.6, bumpScale: 0.35 }));

/** The body mesh of an ant / spider / chafer, sized to the critter (its body length). */
export function critterBody(kind: 'ant' | 'spider' | 'chafer', L: number) {
  const geo = kind === 'ant' ? antGeometry() : kind === 'spider' ? spiderGeometry() : chaferGeometry();
  const m = new THREE.Mesh(geo, bodyMat(kind));
  m.scale.setScalar(L);
  m.castShadow = true;
  return m;
}

/** Leg colours (the legs and feelers are drawn by AntView). */
export const LEG_MATS = {
  ant: new THREE.MeshStandardMaterial({ color: 0x2a140b, roughness: 0.45, metalness: 0.05 }),
  ladybug: new THREE.MeshStandardMaterial({ color: 0x110c0a, roughness: 0.35 }),
  spider: new THREE.MeshStandardMaterial({ color: 0x5a3e27, roughness: 0.7 }),
  chafer: new THREE.MeshStandardMaterial({ color: 0x173a1c, roughness: 0.3, metalness: 0.5 }),
};

// ---------- the ladybug ----------

/**
 * A ladybug's wing case texture (one side): glossy red with an even sheen, black spots (in this half's
 * uv: u along the half's longitude, v from the top to the rim), a little darker towards the rim.
 * spots: [x, z, r] on the dome (the dome is 0.35 wide, 0.38 long, centred at z = −0.08), side: −1 left / 1 right.
 */
export function ladybugShellTexture(side: number, spots: readonly (readonly [number, number, number])[]) {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#d8261a');
  g.addColorStop(0.75, '#c11a10');
  g.addColorStop(1, '#8e1009');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // faint blotchy variation
  const n = noiseCanvas(128, side > 0 ? 3 : 5, [6, 12], 1);
  ctx.globalAlpha = 0.12;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(n, 0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const phiStart = side < 0 ? -Math.PI / 2 : Math.PI / 2;
  for (const [sx, z, r] of spots) {
    const x = (sx * side) / 0.35;
    const zz = (z + 0.08) / 0.38;
    const y = Math.sqrt(Math.max(0, 1 - x * x - zz * zz));
    const theta = Math.acos(Math.min(1, y));
    let phi = Math.atan2(zz, -x);
    while (phi < phiStart) phi += Math.PI * 2;
    while (phi > phiStart + Math.PI * 2) phi -= Math.PI * 2;
    const u = (phi - phiStart) / Math.PI;
    const v = theta / (Math.PI / 2);
    const ang = r / 0.36; // its angular radius
    const ry = (ang / (Math.PI / 2)) * H;
    const rx = (ang / Math.max(0.2, Math.sin(theta)) / Math.PI) * W;
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    sg.addColorStop(0, 'rgba(12,8,8,1)');
    sg.addColorStop(0.86, 'rgba(12,8,8,1)');
    sg.addColorStop(1, 'rgba(12,8,8,0)');
    ctx.save();
    ctx.translate(u * W, v * H);
    ctx.scale(rx, ry);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let ladyGeo: THREE.BufferGeometry | null = null;
/** A ladybug's black parts under and before the shell: head with pale eyes, the neck shield with white patches, the belly. */
export function ladybugBodyGeometry() {
  if (ladyGeo) return ladyGeo;
  const black = col(0x0f0b0a);
  const white = col(0xf1ece0);
  const parts = [
    // the neck shield: black, a white patch at each front corner
    part(ellipsoid(0.22, 0.12, 0.12, 32, 18), mtx(0, 0.15, 0.27, -0.25), (p) => (Math.abs(p.x) > 0.14 && p.z > 0.3 && p.y > 0.14 ? white.clone() : black.clone())),
    part(ellipsoid(0.1, 0.075, 0.08, 20, 14), mtx(0, 0.09, 0.38, 0.35), (p) => (Math.abs(p.x) > 0.035 && p.y > 0.1 && p.z > 0.4 ? white.clone() : black.clone())), // head
    part(ellipsoid(0.32, 0.06, 0.37, 32, 12), mtx(0, 0.05, -0.06), () => black.clone()), // underside
    part(ellipsoid(0.27, 0.14, 0.33, 32, 16), mtx(0, 0.11, -0.07), () => black.clone()), // body under the dome
  ];
  ladyGeo = merge(parts);
  return ladyGeo;
}

/** The ladybug's body material (black, glossy; its own copy: it fades in as it flies in). */
export const ladybugBodyMat = () => chitin({ roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.08, bumpScale: 0.25 });
/** Its shell material, with the side's texture. */
export const ladybugShellMat = (map: THREE.Texture) =>
  new THREE.MeshPhysicalMaterial({ map, roughness: 0.22, roughnessMap: glossPatches(), clearcoat: 1, clearcoatRoughness: 0.05, bumpMap: chitinBump(), bumpScale: 0.15 });
