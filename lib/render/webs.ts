import * as THREE from 'three';
import { SILK_POINTS } from '@/lib/worm/Ants';

type Thread = { total: number; pts: THREE.Vector3[]; line: THREE.LineSegments; beads: THREE.Points; goal?: THREE.Vector3[] };

/** Samples drawn per spun segment (the thread is a smooth curve through the points). */
const SUB = 5;
/** How high a strand arches between two of its anchor points (× the span). */
const ARCH = 0.12;
const tUp = new THREE.Vector3();
const tA = new THREE.Vector3();

/**
 * Silk: a fine thread that is almost invisible except where it catches the light — glints that slide
 * along it as you look, brighter in spots. Alpha only, so it never reads as a solid white line.
 */
function silkMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float along;
      varying float vA;
      void main() {
        vA = along;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      varying float vA;
      void main() {
        float glint = pow(0.5 + 0.5 * sin(vA * 7.0 - uTime * 1.7), 10.0);
        float glint2 = pow(0.5 + 0.5 * sin(vA * 2.3 + uTime * 0.9 + 1.3), 16.0);
        float a = 0.55 + 0.45 * max(glint, glint2);
        // a faint rainbow in the sheen, as on real silk in the sun
        vec3 tint = 0.5 + 0.5 * cos(6.2832 * (vA * 0.35 + vec3(0.0, 0.33, 0.67)));
        gl_FragColor = vec4(mix(vec3(0.92), tint, 0.18 * glint), a);
      }`,
    transparent: true,
    depthWrite: false,
  });
}

/** A dew bead: a soft bright dot with a highlight. */
function beadTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(13, 13, 1, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(230,240,255,0.75)');
  g.addColorStop(0.8, 'rgba(200,220,240,0.18)');
  g.addColorStop(1, 'rgba(200,220,240,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A point at the origin is a break in a thread (it was torn there). */
const isGap = (p: THREE.Vector3) => p.lengthSq() < 1e-9;

/**
 * Spiders' silk threads on the skin: fine curving strands that glint in the light, dew on them; a worm
 * touching one gets stuck.
 * The host sends them in full now and then (set) and just the new bits in between (add).
 * Each entry: [spider id, points ever spun, x, y, z, x, y, z, …]; a point (0, 0, 0) is a break.
 */
export class Webs {
  private group = new THREE.Group();
  private mat = silkMaterial();
  private beadTex: THREE.CanvasTexture | null = null;
  private beadMat = new THREE.PointsMaterial({ size: 0.06, transparent: true, depthWrite: false, opacity: 0.95, sizeAttenuation: true });
  private time = 0;
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
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
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
    this.beadMat.dispose();
    this.beadTex?.dispose();
  }

  private thread(id: number) {
    let t = this.threads.get(id);
    if (!t) {
      const line = new THREE.LineSegments(new THREE.BufferGeometry(), this.mat);
      line.frustumCulled = false;
      line.renderOrder = 52;
      this.group.add(line);
      this.beadMat.map ??= this.beadTex ??= beadTexture();
      const beads = new THREE.Points(new THREE.BufferGeometry(), this.beadMat);
      beads.frustumCulled = false;
      beads.renderOrder = 53;
      this.group.add(beads);
      t = { total: 0, pts: [], line, beads };
      this.threads.set(id, t);
    }
    return t;
  }

  private remove(id: number) {
    const t = this.threads.get(id);
    if (!t) return;
    t.line.removeFromParent();
    t.line.geometry.dispose();
    t.beads.removeFromParent();
    t.beads.geometry.dispose();
    this.threads.delete(id);
  }

  /**
   * The thread as a smooth curve through its points, strung in little arches from one anchor point to
   * the next (none across a break), and dew beads on it here and there.
   */
  private redraw(t: Thread) {
    const pos: number[] = [];
    const along: number[] = [];
    const beads: number[] = [];
    // the runs between breaks
    let run: THREE.Vector3[] = [];
    let dist = 0;
    const flush = () => {
      if (run.length < 2) {
        run = [];
        return;
      }
      const curve = new THREE.CatmullRomCurve3(run, false, 'centripetal');
      const n = (run.length - 1) * SUB;
      let prev: THREE.Vector3 | null = null;
      for (let j = 0; j <= n; j++) {
        const seg = Math.min(run.length - 2, Math.floor(j / SUB));
        const u = j / SUB - seg;
        const span = run[seg].distanceTo(run[seg + 1]);
        const q = curve.getPoint(j / n, new THREE.Vector3());
        q.addScaledVector(tUp.copy(q).normalize(), Math.sin(Math.PI * u) * ARCH * span);
        if (prev) {
          pos.push(prev.x, prev.y, prev.z, q.x, q.y, q.z);
          along.push(dist);
          dist += prev.distanceTo(q);
          along.push(dist);
        }
        prev = q;
      }
      // dew: on every other anchor, and now and then hanging mid-span
      for (let i = 0; i < run.length; i++) {
        const h = Math.abs(Math.sin(i * 12.9898 + t.pts.length * 0.1) * 43758.5453) % 1;
        if (i % 2 === 0 || h < 0.3) {
          tA.copy(run[i]);
          if (i < run.length - 1 && h < 0.3) tA.lerp(run[i + 1], 0.5).addScaledVector(tUp.copy(tA).normalize(), ARCH * run[i].distanceTo(run[i + 1]));
          beads.push(tA.x, tA.y, tA.z);
        }
      }
      run = [];
    };
    for (const p of t.pts) {
      if (isGap(p)) flush();
      else run.push(p);
    }
    flush();
    t.line.geometry.dispose();
    t.line.geometry = new THREE.BufferGeometry();
    t.line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    t.line.geometry.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
    t.beads.geometry.dispose();
    t.beads.geometry = new THREE.BufferGeometry();
    t.beads.geometry.setAttribute('position', new THREE.Float32BufferAttribute(beads, 3));
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
