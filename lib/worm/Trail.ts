import * as THREE from 'three';

/** Polyline of past head positions with up-vectors, indexed by travelled distance. */
export class Trail {
  p: THREE.Vector3[] = [];
  n: THREE.Vector3[] = [];
  d: number[] = [];

  get head() {
    return this.d.length ? this.d[this.d.length - 1] : 0;
  }

  /** Distance at the oldest point kept. */
  get start() {
    return this.d.length ? this.d[0] : 0;
  }

  push(p: THREE.Vector3, n: THREE.Vector3) {
    const k = this.p.length;
    if (k) {
      const dd = this.p[k - 1].distanceTo(p);
      if (dd < 1e-4) {
        this.n[k - 1].copy(n);
        return;
      }
      this.d.push(this.d[k - 1] + dd);
    } else this.d.push(0);
    this.p.push(p.clone());
    this.n.push(n.clone());
    // forget the far past
    if (this.p.length > 4000 && this.d[1000] < this.head - 6) {
      this.p.splice(0, 1000);
      this.n.splice(0, 1000);
      this.d.splice(0, 1000);
    }
  }

  /** Forget everything before distance `s` (the first point is moved to exactly s). */
  dropBefore(s: number) {
    if (this.d.length < 2 || s <= this.d[0] || s >= this.head) return;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    this.sample(s, p, n);
    let k = 0;
    while (k < this.d.length - 1 && this.d[k + 1] <= s) k++;
    this.p.splice(0, k + 1, p);
    this.n.splice(0, k + 1, n);
    this.d.splice(0, k + 1, s);
  }

  /** Adds a point before the oldest one (dist: how far before it; else the straight distance). */
  prepend(p: THREE.Vector3, n: THREE.Vector3, dist?: number) {
    if (!this.p.length) return this.push(p, n);
    const dd = dist ?? this.p[0].distanceTo(p);
    if (dd < 1e-4) return;
    this.d.unshift(this.d[0] - dd);
    this.p.unshift(p.clone());
    this.n.unshift(n.clone());
  }

  /** Slide the head back to distance `s`: everything newer is dropped. */
  truncate(s: number) {
    if (this.d.length < 2 || s >= this.head || s <= this.d[0]) return;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    this.sample(s, p, n);
    let k = this.d.length;
    while (k > 1 && this.d[k - 1] > s) k--;
    this.p.length = this.n.length = this.d.length = k;
    this.push(p, n);
  }

  sample(s: number, outP: THREE.Vector3, outN: THREE.Vector3) {
    const d = this.d;
    const k = d.length;
    if (!k) return outP;
    if (s <= d[0]) {
      outN.copy(this.n[0]);
      return outP.copy(this.p[0]);
    }
    if (s >= d[k - 1]) {
      outN.copy(this.n[k - 1]);
      return outP.copy(this.p[k - 1]);
    }
    let lo = 0;
    let hi = k - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (d[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - d[lo]) / (d[hi] - d[lo] || 1);
    outN.lerpVectors(this.n[lo], this.n[hi], t).normalize();
    return outP.lerpVectors(this.p[lo], this.p[hi], t);
  }
}
