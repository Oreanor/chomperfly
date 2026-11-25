import * as THREE from 'three';
import { SILK_POINTS } from '@/lib/worm/Ants';

type Thread = { total: number; pts: THREE.Vector3[]; line: THREE.LineSegments; goal?: THREE.Vector3[] };

/** A point at the origin is a break in a thread (it was torn there). */
const isGap = (p: THREE.Vector3) => p.lengthSq() < 1e-9;

/**
 * Spiders' silk threads on the skin: drawn as white lines; a worm touching one gets stuck.
 * The host sends them in full now and then (set) and just the new bits in between (add).
 * Each entry: [spider id, points ever spun, x, y, z, x, y, z, …]; a point (0, 0, 0) is a break.
 */
export class Webs {
  private group = new THREE.Group();
  private mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false });
  private threads = new Map<number, Thread>();
  private segs: [THREE.Vector3, THREE.Vector3][] = [];
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** All the threads (any not listed are gone). */
  set(webs: number[][]) {
    const alive = new Set<number>();
    for (const w of webs) {
      alive.add(w[0]);
      const t = this.thread(w[0]);
      const pts = points(w);
      // the same thread, only moved a little (a worm tugged at it): glide there, don't jump
      if (t.total === w[1] && t.pts.length === pts.length && pts.length > 1 && pts.every((p, i) => isGap(p) === isGap(t.pts[i]))) {
        t.goal = pts;
        continue;
      }
      t.total = w[1];
      t.pts = pts;
      t.goal = undefined;
      this.redraw(t);
    }
    for (const id of [...this.threads.keys()]) if (!alive.has(id)) this.remove(id);
    this.rebuildSegs();
  }

  /** New bits of silk. A bit that doesn't follow on (one got lost) waits for the next full set. */
  add(delta: number[][]) {
    let changed = false;
    for (const w of delta) {
      const fresh = points(w);
      let t = this.threads.get(w[0]);
      if (!t) {
        if (w[1] !== fresh.length) continue; // we missed its start
        t = this.thread(w[0]);
      } else if (t.total + fresh.length !== w[1]) continue;
      if (t.goal) {
        t.pts = t.goal;
        t.goal = undefined;
      }
      t.total = w[1];
      t.pts.push(...fresh);
      if (t.pts.length > SILK_POINTS) t.pts.splice(0, t.pts.length - SILK_POINTS);
      this.redraw(t);
      changed = true;
    }
    if (changed) this.rebuildSegs();
  }

  /** Threads gliding to where the host says they are now. */
  update(dt: number) {
    const k = 1 - Math.exp(-12 * dt);
    for (const t of this.threads.values()) {
      if (!t.goal) continue;
      let far = 0;
      for (let i = 0; i < t.pts.length; i++) {
        t.pts[i].lerp(t.goal[i], k);
        far = Math.max(far, t.pts[i].distanceToSquared(t.goal[i]));
      }
      if (far < 1e-6) t.goal = undefined;
      this.redraw(t);
    }
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  /** Does any of these balls (centers + radii) touch a thread? */
  touches(balls: THREE.Vector3[], radius: (i: number) => number) {
    for (const [a, b] of this.segs) {
      for (let i = 0; i < balls.length; i++) {
        if (distToSegment(balls[i], a, b, this.tmp) < radius(i)) return true;
      }
    }
    return false;
  }

  dispose() {
    this.set([]);
    this.group.removeFromParent();
    this.mat.dispose();
  }

  private thread(id: number) {
    let t = this.threads.get(id);
    if (!t) {
      const line = new THREE.LineSegments(new THREE.BufferGeometry(), this.mat);
      line.frustumCulled = false;
      this.group.add(line);
      t = { total: 0, pts: [], line };
      this.threads.set(id, t);
    }
    return t;
  }

  private remove(id: number) {
    const t = this.threads.get(id);
    if (!t) return;
    t.line.removeFromParent();
    t.line.geometry.dispose();
    this.threads.delete(id);
  }

  /** The thread as separate segments (none across a break); the buffer is reused while its size holds. */
  private redraw(t: Thread) {
    let n = 0;
    for (let i = 1; i < t.pts.length; i++) if (!isGap(t.pts[i - 1]) && !isGap(t.pts[i])) n++;
    let attr = t.line.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attr || attr.count !== n * 2) {
      t.line.geometry.dispose();
      t.line.geometry = new THREE.BufferGeometry();
      attr = new THREE.BufferAttribute(new Float32Array(n * 6), 3);
      t.line.geometry.setAttribute('position', attr);
    }
    let k = 0;
    for (let i = 1; i < t.pts.length; i++) {
      const a = t.pts[i - 1];
      const b = t.pts[i];
      if (isGap(a) || isGap(b)) continue;
      attr.setXYZ(k++, a.x, a.y, a.z);
      attr.setXYZ(k++, b.x, b.y, b.z);
    }
    attr.needsUpdate = true;
    t.line.geometry.computeBoundingSphere();
  }

  private rebuildSegs() {
    this.segs = [];
    for (const t of this.threads.values()) {
      for (let i = 1; i < t.pts.length; i++) {
        if (!isGap(t.pts[i - 1]) && !isGap(t.pts[i])) this.segs.push([t.pts[i - 1], t.pts[i]]);
      }
    }
  }
}

/** The points of an entry, lifted just off the skin (a break stays at the origin). */
function points(w: number[]) {
  const pts: THREE.Vector3[] = [];
  for (let i = 2; i + 2 < w.length; i += 3) {
    const p = new THREE.Vector3(w[i], w[i + 1], w[i + 2]);
    pts.push(p.addScaledVector(p.clone().normalize(), 0.02));
  }
  return pts;
}

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, tmp: THREE.Vector3) {
  tmp.subVectors(b, a);
  const len2 = tmp.lengthSq() || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * tmp.x + (p.y - a.y) * tmp.y + (p.z - a.z) * tmp.z) / len2));
  return Math.hypot(a.x + tmp.x * t - p.x, a.y + tmp.y * t - p.y, a.z + tmp.z * t - p.z);
}
