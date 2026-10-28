import * as THREE from 'three';

/** Spiders' silk threads on the skin: drawn as white lines; a worm touching one gets stuck. */
export class Webs {
  private group = new THREE.Group();
  private mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false });
  private lines = new Map<number, THREE.Line>();
  private segs: [THREE.Vector3, THREE.Vector3][] = [];
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** webs = [spider id, x, y, z, x, y, z, …] each */
  set(webs: number[][]) {
    const alive = new Set<number>();
    this.segs = [];
    for (const w of webs) {
      const id = w[0];
      alive.add(id);
      const pts: THREE.Vector3[] = [];
      for (let i = 1; i + 2 < w.length; i += 3) {
        const p = new THREE.Vector3(w[i], w[i + 1], w[i + 2]);
        p.addScaledVector(this.tmp.copy(p).normalize(), 0.02); // just above the skin
        pts.push(p);
      }
      for (let i = 1; i < pts.length; i++) this.segs.push([pts[i - 1], pts[i]]);
      let line = this.lines.get(id);
      if (!line) {
        line = new THREE.Line(new THREE.BufferGeometry(), this.mat);
        line.frustumCulled = false;
        this.group.add(line);
        this.lines.set(id, line);
      }
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
    for (const [id, line] of this.lines) {
      if (alive.has(id)) continue;
      line.removeFromParent();
      line.geometry.dispose();
      this.lines.delete(id);
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
}

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, tmp: THREE.Vector3) {
  tmp.subVectors(b, a);
  const len2 = tmp.lengthSq() || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * tmp.x + (p.y - a.y) * tmp.y + (p.z - a.z) * tmp.z) / len2));
  const x = a.x + tmp.x * t - p.x;
  const y = a.y + tmp.y * t - p.y;
  const z = a.z + tmp.z * t - p.z;
  return Math.hypot(x, y, z);
}
