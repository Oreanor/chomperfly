import * as THREE from 'three';

const tU = new THREE.Vector3();
const tV = new THREE.Vector3();

/**
 * Cartoon stars circling over a stunned worm's head. Each frame: begin(dt), show() for every worm
 * that should have them, end() drops the rings nobody showed.
 */
export class StunStars {
  private group = new THREE.Group();
  private mat: THREE.SpriteMaterial;
  private rings = new Map<string, THREE.Sprite[]>();
  private seen = new Set<string>();
  private time = 0;

  constructor(scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 12 : 29;
      ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffd84a';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#8a5a00';
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false });
    this.group.renderOrder = 60;
    scene.add(this.group);
  }

  begin(dt: number) {
    this.time += dt;
    this.seen.clear();
  }

  /** Three stars round the head (up = away from the fruit), sized to the worm (its body length). */
  show(id: string, head: THREE.Vector3, up: THREE.Vector3, size: number, visible: boolean) {
    this.seen.add(id);
    let ring = this.rings.get(id);
    if (!ring) {
      ring = [0, 1, 2].map(() => {
        const s = new THREE.Sprite(this.mat);
        s.renderOrder = 60;
        this.group.add(s);
        return s;
      });
      this.rings.set(id, ring);
    }
    tU.set(0, 1, 0).cross(up);
    if (tU.lengthSq() < 1e-6) tU.set(1, 0, 0);
    tU.normalize();
    tV.crossVectors(up, tU);
    const r = 0.28 * size;
    ring.forEach((s, i) => {
      const a = this.time * 4 + (i * Math.PI * 2) / 3;
      s.visible = visible;
      s.position
        .copy(head)
        .addScaledVector(up, 0.32 * size + 0.03 * Math.sin(a * 2) * size)
        .addScaledVector(tU, Math.cos(a) * r)
        .addScaledVector(tV, Math.sin(a) * r);
      s.scale.setScalar(0.14 * size * (0.85 + 0.15 * Math.sin(a * 3)));
    });
  }

  end() {
    for (const [id, ring] of this.rings) {
      if (this.seen.has(id)) continue;
      for (const s of ring) s.removeFromParent();
      this.rings.delete(id);
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.mat.map?.dispose();
    this.mat.dispose();
  }
}
