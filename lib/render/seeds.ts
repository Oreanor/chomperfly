import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { R0, appleF, appleShapeR } from '@/lib/apple';
import { fruitSpec } from '@/lib/fruits';



const SEED_LEN = 0.9; // an apple seed's length (the worm is ~1 long)
const ARIL_LEN = 0.42;
const CHAMBERS = 6; // pale membranes split a pomegranate into chambers

/**
 * Seeds to eat inside the fruit: an apple's or a pear's five dark seeds in a star round the core,
 * a pomegranate's hundreds of pearly arils packed between its membranes.
 * Each one eaten is a speed bonus; eaten seeds stay gone until the next round.
 */
export class Seeds {
  readonly positions: THREE.Vector3[] = [];
  private group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private matrices: THREE.Matrix4[] = [];
  private eaten: boolean[];
  private geo: THREE.BufferGeometry;
  private mat: THREE.Material;
  private reach: number;
  private membranes: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, fruit: string) {
    // what this fruit has: lib/fruits.json
    const spec = fruitSpec(fruit).seeds ?? { kind: 'star', count: 0, add: 0 };
    const pomegranate = spec.kind === 'arils';
    const n = spec.count;
    this.eaten = new Array(n).fill(false);
    if (pomegranate) {
      // an aril: a juicy, slightly faceted drop, white with a blush of pink, glossy
      this.geo = potato();
      this.mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.18,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        sheen: 0.6,
        sheenColor: new THREE.Color(0xffc8d2),
        emissive: 0x3a1018, // a faint inner glow in the dim flesh
        fog: false,
      });
      this.reach = ARIL_LEN * 0.5;
    } else {
      // teardrop profile: round bottom, pointed tip (+y)
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const r = Math.sin(Math.PI * t) * (1 - 0.55 * t) * 0.32;
        pts.push(new THREE.Vector2(Math.max(r, 0.001), (t - 0.5) * 1));
      }
      this.geo = new THREE.LatheGeometry(pts, 20).scale(SEED_LEN, SEED_LEN, SEED_LEN * 0.75);
      // dark and glossy: they stand out against the white flesh
      this.mat = new THREE.MeshStandardMaterial({ color: 0x24110a, roughness: 0.3, metalness: 0.05, fog: false });
      this.reach = SEED_LEN * 0.4;
    }
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
    if (pomegranate) this.layArils(n);
    else this.layStar(n);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.mesh);
    if (pomegranate) this.makeMembranes();
    scene.add(this.group);
  }

  /** Five seeds in a star round the fruit's axis, a bit above the middle, nearly upright. */
  private layStar(n: number) {
    // in the fruit's widest part (an apple: about the middle; a pear: its lower bulb)
    const core = new THREE.Vector3(0, widestHeight() + 0.05 * R0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p = core.clone().addScaledVector(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 0.2 * R0);
      while (appleF(p) > -1.5 && p.distanceTo(core) > 0.5) p.lerp(core, 0.15); // well inside, whatever the shape
      const tip = core.clone().sub(p).normalize().multiplyScalar(0.3).add(up).normalize();
      this.place(k, p, new THREE.Quaternion().setFromUnitVectors(up, tip), 1);
    }
  }

  /** Arils packed through the flesh, clear of the membranes and the white core, fanning out from the axis. */
  private layArils(n: number) {
    const rnd = mulberry32(0x9e3779b9); // the same arils for every player
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const minD2 = (ARIL_LEN * 1.15) ** 2;
    const cells = new Map<string, THREE.Vector3[]>(); // a coarse grid for the spacing test
    const cell = (v: THREE.Vector3) => `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`;
    let k = 0;
    for (let tries = 0; k < n && tries < 60000; tries++) {
      p.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      if (p.lengthSq() > 1) continue;
      p.multiplyScalar(R0);
      if (appleF(p) > -0.7) continue; // not in the rind
      const axial = Math.hypot(p.x, p.z);
      if (axial < 0.9) continue; // the white core
      if (membraneDistance(p) < 0.32) continue;
      let close = false;
      for (let dx = -1; dx <= 1 && !close; dx++)
        for (let dy = -1; dy <= 1 && !close; dy++)
          for (let dz = -1; dz <= 1 && !close; dz++) {
            const list = cells.get(`${Math.floor(p.x) + dx},${Math.floor(p.y) + dy},${Math.floor(p.z) + dz}`);
            if (list?.some((q) => q.distanceToSquared(p) < minD2)) close = true;
          }
      if (close) continue;
      const q = p.clone();
      const key = cell(q);
      cells.set(key, [...(cells.get(key) ?? []), q]);
      // hangs from the core outwards (its pointed end at the axis), a little askew
      const out = new THREE.Vector3(q.x, 0, q.z).normalize();
      out.y = (rnd() - 0.5) * 0.8;
      out.x += (rnd() - 0.5) * 0.4;
      out.z += (rnd() - 0.5) * 0.4;
      // each a bit its own shape: plumper, flatter, longer
      const sz = 0.85 + rnd() * 0.3;
      const squash = new THREE.Vector3(sz * (0.85 + rnd() * 0.3), sz, sz * (0.85 + rnd() * 0.3));
      this.place(k, q, new THREE.Quaternion().setFromUnitVectors(up, out.normalize()), squash);
      const tint = new THREE.Color().setHSL(0.97, 0.5 + rnd() * 0.3, 0.9 + rnd() * 0.06);
      this.mesh.setColorAt(k, tint);
      k++;
    }
    // (in the unlikely case of a cramped fruit, the rest sit hidden at the center)
    for (; k < n; k++) {
      this.place(k, new THREE.Vector3(), new THREE.Quaternion(), 0);
      this.eaten[k] = true;
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private place(i: number, p: THREE.Vector3, q: THREE.Quaternion, s: number | THREE.Vector3) {
    const m = new THREE.Matrix4().compose(p, q, typeof s === 'number' ? new THREE.Vector3(s, s, s) : s);
    this.positions[i] = p;
    this.matrices[i] = m;
    this.mesh.setMatrixAt(i, m);
  }

  /** Thin pale membranes from the axis to the rind: the pomegranate's chambers. Seen from inside. */
  private makeMembranes() {
    const pos: number[] = [];
    const idx: number[] = [];
    const ROWS = 24;
    const COLS = 12;
    for (let c = 0; c < CHAMBERS; c++) {
      const a = membraneAngle(c);
      const base = pos.length / 3;
      for (let i = 0; i <= ROWS; i++) {
        const th = 0.08 * Math.PI + (i / ROWS) * 0.84 * Math.PI;
        const d = new THREE.Vector3(Math.sin(th) * Math.cos(a), Math.cos(th), Math.sin(th) * Math.sin(a));
        const rMax = appleShapeR(d.x, d.y, d.z) - 0.35;
        for (let j = 0; j <= COLS; j++) {
          // from the axis (at this height) out to just under the rind
          const s = j / COLS;
          const axisPt = new THREE.Vector3(0, d.y * rMax, 0);
          const v = axisPt.lerp(d.clone().multiplyScalar(rMax), s);
          pos.push(v.x, v.y, v.z);
        }
      }
      for (let i = 0; i < ROWS; i++)
        for (let j = 0; j < COLS; j++) {
          const o = base + i * (COLS + 1) + j;
          idx.push(o, o + 1, o + COLS + 1, o + 1, o + COLS + 2, o + COLS + 1);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfff1df,
      roughness: 0.7,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    this.membranes = new THREE.Mesh(geo, mat);
    this.membranes.renderOrder = 7;
    this.membranes.visible = false;
    this.group.add(this.membranes);
  }

  /** Cut a see-through hole round the camera–worm line, like the skin (pomegranate insides). */
  useCutaway(apply: (m: THREE.Material) => void) {
    apply(this.mat);
    if (this.membranes) apply(this.membranes.material as THREE.Material);
  }

  /** The membranes show only while gnawing inside. */
  setInside(inside: boolean) {
    if (this.membranes) this.membranes.visible = inside;
  }

  /** eaten[i] = true hides seed i */
  setEaten(i: number, eaten: boolean) {
    if (i < 0 || i >= this.eaten.length || !this.matrices[i]) return;
    this.eaten[i] = eaten;
    this.mesh.setMatrixAt(i, eaten ? HIDDEN : this.matrices[i]);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setAll(eaten: boolean[]) {
    for (let i = 0; i < this.eaten.length; i++) this.setEaten(i, !!eaten[i]);
  }

  /** Index of an uneaten seed within `reach` of p, or -1. */
  hit(p: THREE.Vector3, reach: number) {
    for (let i = 0; i < this.eaten.length; i++) {
      if (!this.eaten[i] && this.positions[i].distanceTo(p) < reach + this.reach) return i;
    }
    return -1;
  }

  dispose() {
    this.group.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.dispose();
    if (this.membranes) {
      this.membranes.geometry.dispose();
      (this.membranes.material as THREE.Material).dispose();
    }
  }
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** The height of the fruit's widest horizontal slice (where seeds sit), from its shape. */
function widestHeight() {
  let bestY = 0;
  let bestW = 0;
  for (let i = 1; i < 90; i++) {
    const th = (i / 90) * Math.PI; // from the top down
    let w = 0;
    let y = 0;
    for (let j = 0; j < 8; j++) {
      const ph = (j / 8) * Math.PI * 2;
      const d = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      const r = appleShapeR(d.x, d.y, d.z);
      w += Math.hypot(d.x, d.z) * r;
      y += d.y * r;
    }
    if (w > bestW) {
      bestW = w;
      bestY = y / 8;
    }
  }
  return bestY;
}

/** An aril: a smooth, slightly lumpy little potato (rounded, a touch longer than wide). */
function potato() {
  const g = new THREE.IcosahedronGeometry(0.5, 3);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // gentle low bumps, no edges
    const bump = 1 + 0.07 * Math.sin(v.x * 7 + 1.3) * Math.sin(v.y * 6 + 0.4) + 0.05 * Math.sin(v.z * 8 + 2.1);
    v.multiplyScalar(bump);
    pos.setXYZ(i, v.x * ARIL_LEN * 0.82, v.y * ARIL_LEN, v.z * ARIL_LEN * 0.82);
  }
  g.deleteAttribute('normal'); // per-face normals and uvs would keep the corners apart
  g.deleteAttribute('uv');
  const smooth = mergeVertices(g); // shared corners: smooth normals, not facets
  smooth.computeVertexNormals();
  g.dispose();
  return smooth;
}

const membraneAngle = (c: number) => (c / CHAMBERS) * Math.PI * 2 + 0.3;

/** Distance from p to the nearest membrane (half-planes from the axis). */
function membraneDistance(p: THREE.Vector3) {
  let best = Infinity;
  for (let c = 0; c < CHAMBERS; c++) {
    const a = membraneAngle(c);
    const along = p.x * Math.cos(a) + p.z * Math.sin(a);
    const across = -p.x * Math.sin(a) + p.z * Math.cos(a);
    best = Math.min(best, along > 0 ? Math.abs(across) : Math.hypot(p.x, p.z));
  }
  return best;
}

/** A small seeded random generator: everyone gets the same layout. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
