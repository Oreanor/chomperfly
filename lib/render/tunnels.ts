import * as THREE from 'three';
import { HOLE_R0, TUNNEL_R0 } from '@/lib/worm/constants';
import { appleShapeR } from '@/lib/apple';
import { makeBiteGeometry, makeBiteMaterial, makeGlassMaterial } from './materials';

const CHUNK = 150; // tunnel points per tube mesh
const RADIAL = 10;
const SKIN_GAP = 0.03; // passages stay this far under the skin

export type Tunnel = {
  r: number; // tube radius (the digger's size when it started)
  pts: THREE.Vector3[];
  frames: THREE.Vector3[]; // ring "normal" per point, fixed once computed (parallel transport)
  built: number; // points already in meshes
  chunks: THREE.Mesh[];
  lastBuild: number;
};

/**
 * All gnawed passages of the fruit, drawn as glass tubes. Each tube has one ring of vertices exactly
 * at each point; ring frames never change, so appending points only adds rings at the end.
 */
export class TunnelStore {
  private tunnels = new Map<string, Tunnel>();
  private mat = makeGlassMaterial();
  private fT = new THREE.Vector3();
  private fB = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {}

  get size() {
    return this.tunnels.size;
  }

  /** One passage's points, if we have it. */
  points(id: string) {
    return this.tunnels.get(id)?.pts;
  }

  /** Every passage as a polyline (ants walk along them). */
  list() {
    return [...this.tunnels].map(([id, t]) => ({ id, pts: t.pts }));
  }

  has(id: string) {
    return this.tunnels.has(id);
  }

  get(id: string, r = TUNNEL_R0): Tunnel {
    let t = this.tunnels.get(id);
    if (!t) {
      t = { r, pts: [], frames: [], built: 0, chunks: [], lastBuild: -1 };
      this.tunnels.set(id, t);
    }
    return t;
  }

  /** Last point of a tunnel, if any. */
  last(id: string) {
    const t = this.tunnels.get(id);
    return t?.pts[t.pts.length - 1];
  }

  append(id: string, v: THREE.Vector3) {
    this.get(id).pts.push(v.clone());
  }

  appendFlat(id: string, pts: number[], r?: number) {
    const t = this.get(id, r);
    for (let i = 0; i + 2 < pts.length; i += 3) t.pts.push(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
  }

  clear() {
    for (const t of this.tunnels.values()) {
      for (const c of t.chunks) {
        this.scene.remove(c);
        c.geometry.dispose();
      }
    }
    this.tunnels.clear();
  }

  dispose() {
    this.clear();
    this.mat.dispose();
  }

  /** Builds meshes for new points, at most every 0.1 s per tunnel. */
  update(time: number) {
    for (const t of this.tunnels.values()) {
      const k = t.pts.length;
      if (k < 2 || k <= t.built || time - t.lastBuild < 0.1) continue;
      this.rebuild(t, k, time);
    }
  }

  private rebuild(t: Tunnel, upTo: number, time: number) {
    const first = Math.floor(Math.max(0, t.built - 1) / CHUNK);
    const last = Math.floor((upTo - 2) / CHUNK);
    for (let c = first; c <= last; c++) {
      const a = c * CHUNK;
      const b = Math.min(a + CHUNK, upTo - 1);
      if (b - a < 1) continue;
      const geo = this.buildChunk(t, a, b);
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

  private buildChunk(t: Tunnel, a: number, b: number) {
    this.ensureFrames(t, b);
    const { fT, fB } = this;
    const P = t.pts;
    const rings = b - a + 1;
    const pos = new Float32Array(rings * (RADIAL + 1) * 3);
    const nor = new Float32Array(rings * (RADIAL + 1) * 3);
    for (let r = 0; r < rings; r++) {
      const i = a + r;
      fT.subVectors(P[Math.min(P.length - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
      const nrm = t.frames[i];
      fB.crossVectors(fT, nrm).normalize();
      for (let j = 0; j <= RADIAL; j++) {
        const th = (j / RADIAL) * Math.PI * 2;
        const cx = Math.cos(th);
        const sx = Math.sin(th);
        const nx = nrm.x * cx + fB.x * sx;
        const ny = nrm.y * cx + fB.y * sx;
        const nz = nrm.z * cx + fB.z * sx;
        const o = (r * (RADIAL + 1) + j) * 3;
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
        nor[o] = nx;
        nor[o + 1] = ny;
        nor[o + 2] = nz;
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rings - 1; r++) {
      for (let j = 0; j < RADIAL; j++) {
        const v0 = r * (RADIAL + 1) + j;
        const v1 = v0 + RADIAL + 1;
        idx.push(v0, v1, v0 + 1, v1, v1 + 1, v0 + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }
}

/** Bite marks where passages enter and leave the skin. */
export class HoleLayer {
  private group = new THREE.Group();
  private geo = makeBiteGeometry();
  private mat = makeBiteMaterial();
  private static Z = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
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
    g.scale.setScalar(r / HOLE_R0);
    this.group.add(g);
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
