import * as THREE from 'three';

const LIFE = 0.8; // seconds

/** Little steam clouds puffing out of a worm (spider venom): soft white blobs that swell, rise and fade. */
export class Puffs {
  private group = new THREE.Group();
  private tex: THREE.CanvasTexture;
  private items: { sprite: THREE.Sprite; age: number; size: number; vel: THREE.Vector3 }[] = [];

  constructor(scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    scene.add(this.group);
  }

  /** A puff at p, drifting along `drift` (e.g. up off the skin and backwards), sized to the worm. */
  emit(p: THREE.Vector3, drift: THREE.Vector3, size: number) {
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(p);
    sprite.renderOrder = 80;
    this.group.add(sprite);
    const jitter = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.3 * size);
    this.items.push({ sprite, age: 0, size, vel: drift.clone().add(jitter) });
  }

  update(dt: number) {
    for (const it of this.items) {
      it.age += dt;
      const t = Math.min(1, it.age / LIFE);
      it.sprite.position.addScaledVector(it.vel, dt * (1 - t * 0.7));
      const s = it.size * (0.12 + 0.35 * Math.sqrt(t));
      it.sprite.scale.set(s, s, 1);
      it.sprite.material.opacity = 0.7 * (1 - t) * Math.min(1, it.age / 0.08);
    }
    this.items = this.items.filter((it) => {
      if (it.age < LIFE) return true;
      it.sprite.removeFromParent();
      it.sprite.material.dispose();
      return false;
    });
  }

  dispose() {
    for (const it of this.items) it.sprite.material.dispose();
    this.items = [];
    this.group.removeFromParent();
    this.tex.dispose();
  }
}
