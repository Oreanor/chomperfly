import * as THREE from 'three';

const LIFE = 0.3; // seconds

/** Comic "pow" lines: a few soft white strokes bursting out of a hit point, then fading. */
export class Impacts {
  private group = new THREE.Group();
  private tex: THREE.CanvasTexture;
  private items: { sprite: THREE.Sprite; age: number; size: number }[] = [];

  constructor(scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.translate(128, 128);
    ctx.lineCap = 'butt'; // square-cut ends
    // a few fat, soft white strokes, no outline: light and airy
    const rays = 5;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + (i % 2) * 0.15;
      const r0 = 46 + (i % 3) * 6;
      const r1 = 108 - (i % 2) * 16;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    scene.add(this.group);
  }

  /** A burst at p, sized to the worm (its body length). */
  burst(p: THREE.Vector3, size: number) {
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    mat.rotation = Math.random() * Math.PI * 2;
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(p);
    sprite.renderOrder = 90;
    this.group.add(sprite);
    this.items.push({ sprite, age: 0, size });
  }

  update(dt: number) {
    for (const it of this.items) {
      it.age += dt;
      const t = Math.min(1, it.age / LIFE);
      const s = it.size * (0.45 + 0.75 * (1 - (1 - t) ** 3)); // pops out fast, then eases
      it.sprite.scale.set(s, s, 1);
      it.sprite.material.opacity = 0.75 * (t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6); // see-through, fading
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
