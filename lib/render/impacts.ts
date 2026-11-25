import * as THREE from 'three';

const LIFE = 0.22; // seconds

/**
 * Comic "pop" clouds: a soft white star-shaped puff bursting out of a hit point, then fading.
 * Four shapes (5–8 lobes); each burst takes one at random, turned at random.
 */
export class Impacts {
  private group = new THREE.Group();
  private popTex: THREE.CanvasTexture[];
  private items: { sprite: THREE.Sprite; age: number; size: number; follow?: THREE.Vector3; off?: THREE.Vector3 }[] = [];

  constructor(scene: THREE.Scene) {
    this.popTex = [5, 6, 7, 8].map(popTexture);
    scene.add(this.group);
  }

  /**
   * A burst at p, sized to the worm (its body length). follow: a point that moves (a body ball):
   * the burst moves with it. (The third argument is not used any more.)
   */
  burst(p: THREE.Vector3, size: number, _big = false, follow?: THREE.Vector3) {
    const tracking = follow ? { follow, off: p.clone().sub(follow) } : {};
    const mat = new THREE.SpriteMaterial({
      map: this.popTex[Math.floor(Math.random() * this.popTex.length)],
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    mat.rotation = Math.random() * Math.PI * 2;
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(p);
    sprite.renderOrder = 89;
    this.group.add(sprite);
    this.items.push({ sprite, age: 0, size, ...tracking });
  }

  update(dt: number) {
    for (const it of this.items) {
      it.age += dt;
      if (it.follow) it.sprite.position.copy(it.follow).add(it.off!);
      const t = Math.min(1, it.age / LIFE);
      const s = it.size * (0.55 + 0.35 * (1 - (1 - t) ** 2)); // pops out fast, then eases
      it.sprite.scale.set(s, s, 1);
      it.sprite.material.opacity = t < 0.35 ? 0.8 : 0.8 * (1 - (t - 0.35) / 0.65);
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
    for (const t of this.popTex) t.dispose();
  }
}

/** A white puff with `lobes` points, slightly uneven, the points joined by curves pinched in between. */
function popTexture(lobes: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.translate(128, 128);
  const pts = Array.from({ length: lobes }, (_, i) => ({
    a: ((i + (i % 2 ? 0.1 : -0.04)) / lobes) * Math.PI * 2,
    r: 118 * (i % 2 ? 0.8 : 0.95),
  }));
  const at = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
  ctx.beginPath();
  ctx.moveTo(...at(pts[0].a, pts[0].r));
  for (let i = 0; i < lobes; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % lobes];
    const qa = i + 1 === lobes ? q.a + Math.PI * 2 : q.a;
    const mid = at((p.a + qa) / 2, 23.6);
    ctx.quadraticCurveTo(mid[0], mid[1], ...at(q.a, q.r));
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 110);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0.6)');
  ctx.fillStyle = g;
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
