import * as THREE from 'three';

const MAX = 18;
const LIFE = 0.32; // seconds
const EVERY = 0.025; // s between new streaks while emitting

/** Speed lines: thin white streaks rushing back past a fast worm. */
export class SpeedLines {
  private mesh: THREE.InstancedMesh;
  private items: { p: THREE.Vector3; d: THREE.Vector3; age: number; len: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private spawnT = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, fog: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
    scene.add(this.mesh);
  }

  /** Every frame while fast: at = the worm's middle, dir = where it heads, len = body length, r = its thickness. */
  emit(dt: number, at: THREE.Vector3, dir: THREE.Vector3, len: number, r: number) {
    for (this.spawnT -= dt; this.spawnT <= 0; ) {
      this.spawnT += EVERY;
      if (this.items.length >= MAX) this.items.shift();
      const side = new THREE.Vector3().randomDirection();
      side.addScaledVector(dir, -side.dot(dir)).normalize().multiplyScalar(r * (1.3 + 1.2 * Math.random()));
      this.items.push({
        p: at.clone().add(side).addScaledVector(dir, Math.random() * len * 0.3),
        d: dir.clone(),
        age: 0,
        len: len * (0.35 + 0.3 * Math.random()),
      });
    }
  }

  update(dt: number) {
    let n = 0;
    for (const it of this.items) {
      it.age += dt;
      if (it.age >= LIFE) continue;
      it.p.addScaledVector(it.d, -4 * it.len * dt);
      const f = 1 - it.age / LIFE;
      this.q.setFromUnitVectors(this.up, it.d);
      this.s.set(0.012 * f + 0.004, it.len * (0.6 + 0.4 * f), 0.012 * f + 0.004);
      this.m.compose(it.p, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.items = this.items.filter((it) => it.age < LIFE);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
