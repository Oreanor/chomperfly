import * as THREE from 'three';

const MAX = 600; // pieces alive at once per shape (all bursts together)
const PER_BURST = 180;
const ROUND_SHARE = 0.35; // part of the pieces that are little circles
const LIFE = 2.6; // seconds
const COLORS = [0xff4d6d, 0xffb703, 0x8ac926, 0x1982c4, 0x6a4c93, 0xff7eb6, 0x2ec4b6, 0xfff275];

type Piece = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  size: number;
  color: number;
  round: boolean;
  age: number;
};

/** Colourful paper confetti (strips and circles): burst() pops a cloud, update() moves it. */
export class Confetti {
  private strips: THREE.InstancedMesh;
  private circles: THREE.InstancedMesh;
  private pieces: Piece[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(private scene: THREE.Scene) {
    this.strips = this.makeMesh(new THREE.PlaneGeometry(1, 0.6));
    this.circles = this.makeMesh(new THREE.CircleGeometry(0.45, 14));
  }

  private makeMesh(geo: THREE.BufferGeometry) {
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, fog: false, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 50;
    this.scene.add(mesh);
    return mesh;
  }

  /** at = burst center, up = away from the fruit, scale = worm body length */
  burst(at: THREE.Vector3, up: THREE.Vector3, scale: number) {
    for (let i = 0; i < PER_BURST; i++) {
      if (this.pieces.length >= MAX) this.pieces.shift();
      const dir = new THREE.Vector3().randomDirection().addScaledVector(up, 0.7).normalize();
      this.pieces.push({
        pos: at.clone(),
        vel: dir.multiplyScalar((4 + Math.random() * 5) * scale), // flung far
        gravity: up.clone().multiplyScalar(-1.6 * scale),
        spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        size: (0.09 + Math.random() * 0.07) * scale,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        round: Math.random() < ROUND_SHARE,
        age: 0,
      });
    }
  }

  update(dt: number) {
    if (!this.pieces.length && !this.strips.count && !this.circles.count) return;
    const drag = Math.exp(-1.4 * dt); // paper slows down in the air
    this.pieces = this.pieces.filter((p) => (p.age += dt) < LIFE);
    let ns = 0;
    let nc = 0;
    for (const p of this.pieces) {
      p.vel.multiplyScalar(drag).addScaledVector(p.gravity, dt);
      p.pos.addScaledVector(p.vel, dt);
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      const fade = Math.min(1, (LIFE - p.age) / 0.6); // shrink away at the end
      this.q.setFromEuler(p.rot);
      this.s.setScalar(p.size * fade);
      this.m.compose(p.pos, this.q, this.s);
      const mesh = p.round ? this.circles : this.strips;
      const i = p.round ? nc++ : ns++;
      mesh.setMatrixAt(i, this.m);
      mesh.setColorAt(i, this.c.setHex(p.color));
    }
    for (const [mesh, n] of [[this.strips, ns], [this.circles, nc]] as const) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const mesh of [this.strips, this.circles]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
