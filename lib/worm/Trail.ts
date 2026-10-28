import * as THREE from 'three';

/** Polyline of past head positions with up-vectors, indexed by travelled distance. */
export class Trail {
  p: THREE.Vector3[] = [];
  n: THREE.Vector3[] = [];
  d: number[] = [];

  get head() {
    return this.d.length ? this.d[this.d.length - 1] : 0;
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
    if (s <= d[0]) {
      outP.copy(this.p[0]);
      outN.copy(this.n[0]);
      return;
    }
    if (s >= d[k - 1]) {
      outP.copy(this.p[k - 1]);
      outN.copy(this.n[k - 1]);
      return;
    }
    let lo = 0;
    let hi = k - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (d[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = (s - d[lo]) / (d[hi] - d[lo] || 1);
    outP.lerpVectors(this.p[lo], this.p[hi], t);
    outN.lerpVectors(this.n[lo], this.n[hi], t).normalize();
  }
}
