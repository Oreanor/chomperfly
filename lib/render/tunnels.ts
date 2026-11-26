import * as THREE from 'three';
import { HOLE_R0, TUNNEL_R0, TUNNEL_STEP } from '@/lib/worm/constants';
import { appleShapeR } from '@/lib/apple';
import { makeBiteGeometry, makeBiteMaterial, makeGlassMaterial } from './materials';

const CHUNK = 80; // tunnel points per tube mesh
const RADIAL = 10;
const RING = RADIAL + 1; // vertices per ring (the seam is doubled)
const SKIN_GAP = 0.03; // passages stay this far under the skin
const BUILD_EVERY = 1 / 30; // s: how often a growing passage gets its new rings
const RECUT_EVERY = 0.1; // s: how often walls another passage has since cut into are redone
const FADE_S = 0.8; // a new round: the old passages and holes fade out this long

// spatial hash of all passage points: cells of CELL units
const CELL = 0.5;
const cellOf = (v: number) => Math.floor(v / CELL);
const cellKey = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);

export type Tunnel = {
  r: number; // tube radius (the digger's size when it started)
  pts: THREE.Vector3[];
  frames: THREE.Vector3[]; // ring "normal" per point, fixed once computed (parallel transport)
  built: number; // points already in meshes
  chunks: THREE.Mesh[];
  lastBuild: number;
  lastCut: number;
  dirty: Set<number>; // chunks another passage has cut into since they were built
};

// the points of a disc that hollowAt() checks: the centre, a ring at ½ and one at 0.85 of its radius
const DISC: [number, number][] = [[0, 0]];
for (let i = 0; i < 6; i++) DISC.push([0.5 * Math.cos((i * Math.PI) / 3), 0.5 * Math.sin((i * Math.PI) / 3)]);
for (let i = 0; i < 8; i++) DISC.push([0.85 * Math.cos((i * Math.PI) / 4 + 0.4), 0.85 * Math.sin((i * Math.PI) / 4 + 0.4)]);
const dU = new THREE.Vector3();
const dV = new THREE.Vector3();
const dP = new THREE.Vector3();

/**
 * All gnawed passages of the fruit, drawn as glass tubes. Each tube has one ring of vertices exactly
 * at each point; ring frames never change, so appending points only adds rings at the end.
 * Where passages cross, each one's wall inside the other is cut away (a per-vertex "clip" distance,
 * < 0 = inside another passage), so crossings look like one hollow space, not tubes through tubes.
 */
export class TunnelStore {
  private tunnels = new Map<string, Tunnel>();
  private mat = makeClippedGlass();
  private fT = new THREE.Vector3();
  private fB = new THREE.Vector3();
  private grid = new Map<number, { t: Tunnel; i: number }[]>();
  private maxR = TUNNEL_R0; // the widest passage so far (how far to look around a point)
  private tmpV = new THREE.Vector3();
  private listCache: { id: string; pts: THREE.Vector3[] }[] | null = null;
  private cand: { p: THREE.Vector3; r: number }[] = []; // other passages' points near the ring being built
  private fading: { meshes: THREE.Mesh[]; mat: THREE.Material; at: number } | null = null;

  constructor(private scene: THREE.Scene) {}

  warmShaders(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    // Both sides of the glass are compiled with the room's lighting before the first tunnel appears.
    renderer.compile(new THREE.Mesh(undefined, this.mat), camera, this.scene);
  }

  get size() {
    return this.tunnels.size;
  }

  /** One passage's points, if we have it. */
  points(id: string) {
    return this.tunnels.get(id)?.pts;
  }

  /** Every passage as a polyline (ants walk along them). Cached until a passage is added. */
  list() {
    if (!this.listCache) this.listCache = [...this.tunnels].map(([id, t]) => ({ id, pts: t.pts }));
    return this.listCache;
  }

  has(id: string) {
    return this.tunnels.has(id);
  }

  get(id: string, r = TUNNEL_R0): Tunnel {
    let t = this.tunnels.get(id);
    if (!t) {
      t = { r, pts: [], frames: [], built: 0, chunks: [], lastBuild: -1, lastCut: -1, dirty: new Set() };
      this.maxR = Math.max(this.maxR, r);
      this.tunnels.set(id, t);
      this.listCache = null;
    }
    return t;
  }

  /** Last point of a tunnel, if any. */
  last(id: string) {
    const t = this.tunnels.get(id);
    return t?.pts[t.pts.length - 1];
  }

  append(id: string, v: THREE.Vector3) {
    this.addPoint(this.get(id), v.clone());
  }

  appendFlat(id: string, pts: number[], r?: number) {
    const t = this.get(id, r);
    for (let i = 0; i + 2 < pts.length; i += 3) this.addPoint(t, new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
  }

  /** Stores a point and marks the walls of other passages it now cuts into (every 4th point is enough). */
  private addPoint(t: Tunnel, p: THREE.Vector3) {
    const i = t.pts.length;
    t.pts.push(p);
    const key = cellKey(cellOf(p.x), cellOf(p.y), cellOf(p.z));
    let cell = this.grid.get(key);
    if (!cell) this.grid.set(key, (cell = []));
    cell.push({ t, i });
    if (i % 4) return;
    const reach = t.r + this.maxR + 0.05;
    this.near(p, reach, (o, j) => {
      if (o === t && Math.abs(j - i) * TUNNEL_STEP < 3 * t.r) return; // its own wall just behind
      const c = Math.floor(j / CHUNK);
      if (c < o.chunks.length && !o.dirty.has(c) && o.pts[j].distanceToSquared(p) < reach * reach) o.dirty.add(c);
    });
  }

  /**
   * How much of a disc (centre p, radius r, facing n) is already hollow: 0…1. Points of passage
   * `skip` near its end (the one being gnawed right now) don't count.
   */
  hollowAt(p: THREE.Vector3, r: number, n: THREE.Vector3, skip = '') {
    const own = skip ? this.tunnels.get(skip) : undefined;
    const ownFrom = own ? own.pts.length - Math.ceil((3 * own.r) / TUNNEL_STEP) : 0;
    const u = dU.set(0, 1, 0).cross(n);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0).cross(n);
    u.normalize();
    const v = dV.crossVectors(n, u);
    let hollow = 0;
    for (const [a, b] of DISC) {
      const q = dP.copy(p).addScaledVector(u, a * r).addScaledVector(v, b * r);
      let inside = false;
      this.near(q, this.maxR, (t, i) => {
        if (inside || (t === own && i >= ownFrom)) return;
        if (t.pts[i].distanceToSquared(q) < t.r * t.r) inside = true;
      });
      if (inside) hollow++;
    }
    return hollow / DISC.length;
  }

  /** Calls fn for every stored point in the cells within `reach` of p. */
  private near(p: THREE.Vector3, reach: number, fn: (t: Tunnel, i: number) => void) {
    const n = Math.ceil(reach / CELL);
    const cx = cellOf(p.x);
    const cy = cellOf(p.y);
    const cz = cellOf(p.z);
    for (let x = cx - n; x <= cx + n; x++) {
      for (let y = cy - n; y <= cy + n; y++) {
        for (let z = cz - n; z <= cz + n; z++) {
          const cell = this.grid.get(cellKey(x, y, z));
          if (cell) for (const e of cell) fn(e.t, e.i);
        }
      }
    }
  }

  /** Other passages' points that could cut the ring at point i of t (into `cand`). */
  private gather(t: Tunnel, i: number) {
    const cand = this.cand;
    cand.length = 0;
    const p = t.pts[i];
    this.near(p, t.r + this.maxR + 0.02, (o, j) => {
      if (o === t && Math.abs(j - i) * TUNNEL_STEP < 3 * t.r) return;
      const d = t.r + o.r + 0.02;
      if (o.pts[j].distanceToSquared(p) < d * d) cand.push({ p: o.pts[j], r: o.r * 0.97 });
    });
  }

  /** The clip value of a wall vertex: its distance outside the nearest gathered passage (< 0 = inside). */
  private clipAt(v: THREE.Vector3) {
    let d = 1;
    for (const c of this.cand) {
      const s = v.distanceTo(c.p) - c.r;
      if (s < d) d = s;
    }
    return d;
  }

  /** Redoes the clip values of chunk c of t (another passage came through it). */
  private recut(t: Tunnel, c: number) {
    const mesh = t.chunks[c];
    if (!mesh) return;
    const pos = mesh.geometry.getAttribute('position');
    const clip = mesh.geometry.getAttribute('clip') as THREE.BufferAttribute;
    const a = c * CHUNK;
    for (let k = 0; k < pos.count; k++) {
      if (k % RING === 0) this.gather(t, a + k / RING);
      this.tmpV.fromBufferAttribute(pos, k);
      clip.setX(k, this.clipAt(this.tmpV));
    }
    clip.needsUpdate = true;
  }

  clear() {
    for (const t of this.tunnels.values()) {
      for (const c of t.chunks) {
        this.scene.remove(c);
        c.geometry.dispose();
      }
    }
    this.tunnels.clear();
    this.grid.clear();
    this.maxR = TUNNEL_R0;
    this.listCache = null;
  }

  dispose() {
    this.clear();
    this.mat.dispose();
  }

  /** A new round: the passages fade out (and are forgotten at once). */
  fadeAll() {
    if (this.fading) this.dropFading();
    const mat = this.mat.clone();
    const meshes: THREE.Mesh[] = [];
    for (const t of this.tunnels.values()) {
      for (const c of t.chunks) {
        if (!c) continue;
        c.material = mat;
        meshes.push(c);
      }
    }
    this.fading = { meshes, mat, at: performance.now() };
    this.tunnels.clear();
    this.grid.clear();
    this.maxR = TUNNEL_R0;
    this.listCache = null;
  }

  private dropFading() {
    if (!this.fading) return;
    for (const m of this.fading.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.fading.mat.dispose();
    this.fading = null;
  }

  /** Builds meshes for new points (a passage only once it's a little longer than wide), redoes cut walls. */
  update(time: number) {
    if (this.fading) {
      const f = (performance.now() - this.fading.at) / 1000 / FADE_S;
      this.fading.mat.opacity = Math.max(0, 1 - f);
      this.fading.mat.transparent = true;
      if (f >= 1) this.dropFading();
    }
    for (const t of this.tunnels.values()) {
      const k = t.pts.length;
      if (k >= 2 && k > t.built && time - t.lastBuild >= BUILD_EVERY && (t.built || t.pts[0].distanceTo(t.pts[k - 1]) >= 2 * t.r)) {
        this.rebuild(t, k, time);
      }
      if (t.dirty.size && time - t.lastCut >= RECUT_EVERY) {
        for (const c of t.dirty) this.recut(t, c);
        t.dirty.clear();
        t.lastCut = time;
      }
    }
  }

  private rebuild(t: Tunnel, upTo: number, time: number) {
    const first = Math.floor(Math.max(0, t.built - 1) / CHUNK);
    const last = Math.floor((upTo - 2) / CHUNK);
    for (let c = first; c <= last; c++) {
      const a = c * CHUNK;
      const b = Math.min(a + CHUNK, upTo - 1);
      if (b - a < 1) continue;
      // the rings it already had keep their clip values (unless something cut into them since)
      const prev = t.chunks[c] && !t.dirty.has(c) ? t.chunks[c].geometry : undefined;
      const geo = this.buildChunk(t, a, b, prev);
      t.dirty.delete(c);
      if (t.chunks[c]) {
        t.chunks[c].geometry.dispose();
        t.chunks[c].geometry = geo;
      } else {
        const m = new THREE.Mesh(geo, this.mat);
        m.renderOrder = 5; // after the worm, before the fruit skin
        this.scene.add(m);
        t.chunks[c] = m;
      }
    }
    t.built = upTo;
    t.lastBuild = time;
  }

  private ensureFrames(t: Tunnel, upTo: number) {
    const P = t.pts;
    const fT = this.fT;
    for (let i = t.frames.length; i <= upTo && i < P.length; i++) {
      fT.subVectors(P[Math.min(P.length - 1, i + 1)], P[Math.max(0, i - 1)]);
      if (fT.lengthSq() < 1e-12) fT.set(0, 0, 1);
      fT.normalize();
      const nrm = i > 0 ? t.frames[i - 1].clone() : new THREE.Vector3(0, 1, 0);
      nrm.addScaledVector(fT, -nrm.dot(fT));
      if (nrm.lengthSq() < 1e-8) nrm.set(1, 0, 0).addScaledVector(fT, -fT.x);
      t.frames.push(nrm.normalize());
    }
  }

  private buildChunk(t: Tunnel, a: number, b: number, prev?: THREE.BufferGeometry) {
    const prevClip = prev?.getAttribute('clip') as THREE.BufferAttribute | undefined;
    const keepRings = prevClip ? prevClip.count / RING - 1 : 0; // the last old ring is redone (its tangent changed)
    this.ensureFrames(t, b);
    const { fT, fB } = this;
    const P = t.pts;
    const rings = b - a + 1;
    const pos = new Float32Array(rings * RING * 3);
    const nor = new Float32Array(rings * RING * 3);
    const clip = new Float32Array(rings * RING);
    for (let r = 0; r < rings; r++) {
      const i = a + r;
      fT.subVectors(P[Math.min(P.length - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
      const nrm = t.frames[i];
      fB.crossVectors(fT, nrm).normalize();
      const keep = r < keepRings;
      if (!keep) this.gather(t, i);
      for (let j = 0; j <= RADIAL; j++) {
        const th = (j / RADIAL) * Math.PI * 2;
        const cx = Math.cos(th);
        const sx = Math.sin(th);
        const nx = nrm.x * cx + fB.x * sx;
        const ny = nrm.y * cx + fB.y * sx;
        const nz = nrm.z * cx + fB.z * sx;
        const o = (r * RING + j) * 3;
        let x = P[i].x + nx * t.r;
        let y = P[i].y + ny * t.r;
        let z = P[i].z + nz * t.r;
        // clip to the fruit: a wall that would poke out through the skin is pressed just under it
        const len = Math.hypot(x, y, z);
        const inner = appleShapeR(x, y, z) - SKIN_GAP;
        if (len > inner) {
          const k = inner / len;
          x *= k;
          y *= k;
          z *= k;
        }
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
        clip[o / 3] = keep ? prevClip!.getX(o / 3) : this.clipAt(this.tmpV.set(x, y, z));
        nor[o] = nx;
        nor[o + 1] = ny;
        nor[o + 2] = nz;
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rings - 1; r++) {
      for (let j = 0; j < RADIAL; j++) {
        const v0 = r * RING + j;
        const v1 = v0 + RING;
        idx.push(v0, v1, v0 + 1, v1, v1 + 1, v0 + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('clip', new THREE.BufferAttribute(clip, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

/** The glass with the clip attribute: wall inside another passage is not drawn. */
function makeClippedGlass() {
  const mat = makeGlassMaterial();
  const glass = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float clip;\nvarying float vClip;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvClip = clip;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vClip;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vClip < 0.0) discard;');
    glass.call(mat, sh, r);
  };
  return mat;
}

/** Bite marks where passages enter and leave the skin: each one pops open, a little springy. */
export class HoleLayer {
  private group = new THREE.Group();
  private geo = makeBiteGeometry();
  private mat: THREE.MeshStandardMaterial;
  private fading: { group: THREE.Group; mat: THREE.Material; at: number } | null = null;
  private static Z = new THREE.Vector3(0, 0, 1);

  constructor(private scene: THREE.Scene, night: THREE.IUniform<number>) {
    this.mat = makeBiteMaterial(night);
    scene.add(this.group);
  }

  warmShaders(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    renderer.compile(new THREE.Mesh(this.geo, this.mat), camera, this.scene);
  }

  /** h = [x, y, z, nx, ny, nz, radius?] */
  place(h: number[]) {
    const [px, py, pz, nx, ny, nz] = h;
    const r = h[6] || HOLE_R0;
    const n = new THREE.Vector3(nx, ny, nz).normalize();
    const g = new THREE.Group();
    const bite = new THREE.Mesh(this.geo, this.mat);
    bite.rotation.z = Math.sin(px * 12.9898 + py * 78.233 + pz * 37.719) * Math.PI; // vary the edge
    g.add(bite);
    g.position.set(px, py, pz).addScaledVector(n, 0.004);
    g.quaternion.setFromUnitVectors(HoleLayer.Z, n);
    g.scale.setScalar(0.001);
    g.userData = { full: r / HOLE_R0, born: performance.now() };
    this.group.add(g);
  }

  /** Opens new holes (0.35 s, a little overshoot) and fades the old round's. */
  update() {
    const now = performance.now();
    for (const g of this.group.children) {
      const u = g.userData as { full: number; born: number; done?: boolean };
      if (u.done) continue;
      const t = Math.min(1, (now - u.born) / 1000 / 0.35);
      const e = 1 - (1 - t) ** 3;
      g.scale.setScalar(Math.max(0.001, u.full * (e + 0.12 * Math.sin(Math.PI * t))));
      if (t >= 1) {
        g.scale.setScalar(u.full);
        u.done = true;
      }
    }
    if (this.fading) {
      const f = (now - this.fading.at) / 1000 / FADE_S;
      this.fading.mat.opacity = Math.max(0, 1 - f);
      if (f >= 1) {
        this.fading.group.removeFromParent();
        this.fading.mat.dispose();
        this.fading = null;
      }
    }
  }

  /** A new round: these holes fade out, new ones go into a fresh group. */
  fadeAll() {
    if (this.fading) {
      this.fading.group.removeFromParent();
      this.fading.mat.dispose();
    }
    const old = this.group;
    const mat = this.mat.clone();
    mat.transparent = true;
    old.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mat;
    });
    this.fading = { group: old, mat, at: performance.now() };
    this.group = new THREE.Group();
    old.parent?.add(this.group);
  }

  get count() {
    return this.group.children.length;
  }

  clear() {
    this.group.clear();
  }

  dispose() {
    this.group.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
