import * as THREE from 'three';
import { R0, appleF } from '@/lib/apple';

export const SEED_COUNT = 5;
const SEED_LEN = 0.9; // seed length (the worm is ~1 long)

/**
 * Seeds in the flesh, five in a star around the core like in a cut apple.
 * Gnawing into one gives a speed bonus; eaten seeds stay gone until the next round.
 */
export class Seeds {
  readonly positions: THREE.Vector3[] = [];
  private group = new THREE.Group();
  private meshes: THREE.Mesh[] = [];
  private eaten: boolean[] = new Array(SEED_COUNT).fill(false);
  private geo: THREE.LatheGeometry;
  private mat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
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

    // the star: around the fruit's axis a bit above the middle
    const core = new THREE.Vector3(0, 0.08 * R0, 0);
    for (let k = 0; k < SEED_COUNT; k++) {
      const a = (k / SEED_COUNT) * Math.PI * 2;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const p = core.clone().addScaledVector(out, 0.2 * R0);
      // keep it well inside, whatever the fruit's shape
      while (appleF(p) > -1.5 && p.distanceTo(core) > 0.5) p.lerp(core, 0.15);
      this.positions.push(p);
      const m = new THREE.Mesh(this.geo, this.mat);
      m.position.copy(p);
      // nearly upright like in a real apple: tip up towards the stem, leaning a little to the core
      const tip = core.clone().sub(p).normalize().multiplyScalar(0.3).add(new THREE.Vector3(0, 1, 0)).normalize();
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip);
      m.renderOrder = 6;
      this.group.add(m);
      this.meshes.push(m);
    }
    scene.add(this.group);
  }

  /** eaten[i] = true hides seed i */
  setEaten(i: number, eaten: boolean) {
    if (i < 0 || i >= SEED_COUNT) return;
    this.eaten[i] = eaten;
    this.meshes[i].visible = !eaten;
  }

  setAll(eaten: boolean[]) {
    for (let i = 0; i < SEED_COUNT; i++) this.setEaten(i, !!eaten[i]);
  }

  /** Index of an uneaten seed within `reach` of p, or -1. */
  hit(p: THREE.Vector3, reach: number) {
    for (let i = 0; i < SEED_COUNT; i++) {
      if (!this.eaten[i] && this.positions[i].distanceTo(p) < reach + SEED_LEN * 0.4) return i;
    }
    return -1;
  }

  dispose() {
    this.group.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
