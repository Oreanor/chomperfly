import * as THREE from 'three';
import { R0 } from '@/lib/apple';

const SIZE = 0.29; // a gnat's sprite, far away
const COUNT = 3;

type Gnat = {
  sprite: THREE.Sprite;
  p: THREE.Vector3;
  // away: not around; cross: zigzags across the view (past the fruit or in front of the camera);
  // loop / pause: a little loop or a hover on the way; flyby: whizzes right past the lens, blurred
  mode: 'away' | 'cross' | 'loop' | 'pause' | 'flyby';
  left: number; // s left in this mode
  from: THREE.Vector3;
  to: THREE.Vector3;
  path?: THREE.CatmullRomCurve3;
  k: number; // 0…1 along the way
  speed: number;
  len: number;
  stopAt: number; // where along a crossing it stops for a loop or a hover (−1: it doesn't)
  at: THREE.Vector3; // where it stopped
  loopA: THREE.Vector3;
  loopB: THREE.Vector3;
  near?: boolean; // the fly-by: close to the lens
  seed: number; // its own firefly blink
  spurt: number; // speed factor: gnats fly in bursts
  spurtT: number;
  jink: THREE.Vector3; // a little jitter off the path
  jinkTo: THREE.Vector3;
  jinkT: number;
};

const tSide = new THREE.Vector3();
const tFwd = new THREE.Vector3();
const tMid = new THREE.Vector3();
const tRay = new THREE.Vector3();
const tClosest = new THREE.Vector3();

/**
 * Gnats in the orchard air, just for life: now and then one zigzags across the view, sometimes
 * stopping for a loop; once in a while one whizzes right past the camera. At night they're fireflies.
 */
export class Gnats {
  private gnats: Gnat[] = [];
  private tex: THREE.CanvasTexture[] = []; // wings up, wings down, the fly-by blur
  private glow: THREE.CanvasTexture;
  private night = false;
  private time = 0;
  private flick = 0; // frame counter: the wings flap every frame
  private flybyIn = 15 + Math.random() * 20; // s to the next fly-by

  constructor(private scene: THREE.Scene) {
    this.tex = [this.texture(false), this.texture(true), this.blur()];
    this.glow = this.firefly();
    for (let i = 0; i < COUNT; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[0], transparent: true, depthWrite: false, fog: false }));
      sprite.scale.setScalar(SIZE);
      sprite.renderOrder = 51;
      sprite.visible = false;
      scene.add(sprite);
      this.gnats.push({
        sprite,
        p: new THREE.Vector3(),
        mode: 'away',
        left: 1 + i * 6 + Math.random() * 6,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        k: 0,
        speed: 1,
        len: 1,
        stopAt: -1,
        at: new THREE.Vector3(),
        loopA: new THREE.Vector3(),
        loopB: new THREE.Vector3(),
        seed: Math.random() * 100,
        spurt: 1,
        spurtT: 0,
        jink: new THREE.Vector3(),
        jinkTo: new THREE.Vector3(),
        jinkT: 0,
      });
    }
  }

  setNight(on: boolean) {
    this.night = on;
  }

  /** hidden: none shown (and none start) — inside the fruit, say. */
  update(dt: number, hidden: boolean, camera: THREE.PerspectiveCamera) {
    this.time += dt;
    this.flick++;
    this.flybyIn -= dt;
    if (this.flybyIn <= 0 && !hidden) {
      this.flybyIn = 70 + Math.random() * 70;
      const g = this.gnats.find((g) => g.mode === 'away');
      if (g) this.flyBy(g, camera);
    }
    for (const g of this.gnats) {
      g.left -= dt;
      if (g.mode === 'away') {
        g.sprite.visible = false;
        if (g.left > 0 || hidden) continue;
        // at most two about at once
        if (this.gnats.filter((o) => o.mode !== 'away').length >= 2) g.left = 2 + Math.random() * 4;
        else this.cross(g, camera);
        continue;
      }
      // bursts of speed and short slow bits
      g.spurtT -= dt;
      if (g.spurtT <= 0) {
        const fast = g.spurt < 1;
        g.spurt = fast ? 1.3 + Math.random() * 0.4 : 0.35;
        g.spurtT = fast ? 0.4 + Math.random() * 0.6 : 0.1 + Math.random() * 0.2;
      }
      g.jinkT -= dt;
      if (g.jinkT <= 0) {
        g.jinkTo.randomDirection().multiplyScalar(0.04 + Math.random() * 0.1);
        g.jinkT = 0.3 + Math.random() * 0.5;
      }
      g.jink.lerp(g.jinkTo, 1 - Math.exp(-12 * dt));
      if (g.mode === 'cross' || g.mode === 'flyby') {
        const pace = g.mode === 'cross' ? g.spurt : 1;
        g.k += (g.speed * pace * dt) / Math.max(0.1, g.mode === 'cross' ? g.len : g.from.distanceTo(g.to));
        if (g.mode === 'cross' && g.stopAt >= 0 && g.k >= g.stopAt) {
          g.stopAt = -1;
          g.at.copy(g.p);
          g.mode = Math.random() < 0.5 ? 'loop' : 'pause';
          g.left = g.mode === 'loop' ? 1.1 : 0.6 + Math.random();
          g.loopA.randomDirection();
          g.loopB.randomDirection().cross(g.loopA).normalize();
        }
        if (g.k >= 1) {
          g.mode = 'away';
          g.left = 4 + Math.random() * 14;
          g.sprite.visible = false;
          continue;
        }
        if (g.mode === 'flyby') g.p.lerpVectors(g.from, g.to, g.k);
        else if (g.mode === 'cross' && g.path) g.path.getPointAt(Math.min(1, g.k), g.p).add(g.jink);
      } else if (g.mode === 'loop') {
        const a = Math.min(1, 1 - g.left / 1.1) * Math.PI * 2;
        g.p.copy(g.at).addScaledVector(g.loopA, (Math.cos(a) - 1) * 0.3).addScaledVector(g.loopB, Math.sin(a) * 0.3);
        if (g.left <= 0) this.resume(g);
      } else if (g.mode === 'pause') {
        g.p.copy(g.at).add(g.jink);
        if (g.left <= 0) this.resume(g);
      }
      g.sprite.position.copy(g.p);
      g.sprite.visible = !hidden;
      const mat = g.sprite.material;
      const close = g.mode === 'flyby' && g.near;
      if (this.night) {
        // a firefly: slow glow in and out, additive
        const b = 0.5 + 0.5 * Math.sin(this.time * 3.2 + g.seed);
        const glow = b * b;
        mat.map = this.glow;
        mat.blending = THREE.AdditiveBlending;
        mat.opacity = close ? 0.9 : 0.2 + 0.8 * glow;
        g.sprite.scale.setScalar(SIZE * (close ? 3.2 : 2.4) * (0.75 + 0.45 * glow));
      } else {
        mat.map = close ? this.tex[2] : this.tex[(this.flick + this.gnats.indexOf(g)) % 2];
        mat.blending = THREE.NormalBlending;
        g.sprite.scale.setScalar(close ? SIZE * 1.6 : SIZE);
        mat.opacity = close ? 0.55 : 1;
      }
    }
  }

  dispose() {
    for (const g of this.gnats) {
      this.scene.remove(g.sprite);
      g.sprite.material.dispose();
    }
    for (const t of this.tex) t.dispose();
    this.glow.dispose();
  }

  /** A zigzag across the view: mostly in the air beyond the fruit, else a few units in front of the camera. */
  private cross(g: Gnat, camera: THREE.PerspectiveCamera) {
    const fwd = camera.getWorldDirection(tFwd);
    const side = tSide.crossVectors(fwd, camera.up).normalize();
    const camDist = camera.position.length();
    const beyond = Math.random() < 0.75 ? this.pastTheFruit(camera) : null;
    const dist = beyond ? camDist + R0 * (0.3 + Math.random() * 1.1) : 3 + Math.random() * 3;
    const half = dist * 0.85 + 1; // half the crossing
    const tilt = Math.random() * Math.PI * 2;
    const cx = Math.cos(tilt);
    const cy = Math.sin(tilt) * 0.55;
    const off = (Math.random() - 0.5) * half * 0.8;
    const depth = (Math.random() - 0.5) * 3;
    const mid = beyond
      ? tMid.copy(camera.position).addScaledVector(beyond, dist)
      : tMid.copy(camera.position).addScaledVector(fwd, dist).addScaledVector(side, -cy * off).addScaledVector(camera.up, cx * off * 0.5);
    g.from.copy(mid).addScaledVector(side, -cx * half).addScaledVector(camera.up, -cy * half).addScaledVector(fwd, -depth / 2);
    g.to.copy(mid).addScaledVector(side, cx * half).addScaledVector(camera.up, cy * half).addScaledVector(fwd, depth / 2);
    // the zigzag: a few points off the straight line, to one side and the other
    const pts = [g.from.clone()];
    const n = 3 + Math.floor(Math.random() * 3);
    let way = Math.random() < 0.5 ? 1 : -1;
    for (let i = 1; i <= n; i++) {
      const d = half * (0.25 + Math.random() * 0.3) * way;
      pts.push(
        new THREE.Vector3()
          .lerpVectors(g.from, g.to, (i + (Math.random() - 0.5) * 0.4) / (n + 1))
          .addScaledVector(side, -cy * d)
          .addScaledVector(camera.up, cx * d * 0.6)
          .addScaledVector(fwd, (Math.random() - 0.5) * 1.5),
      );
      way = -way;
    }
    pts.push(g.to.clone());
    g.path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    g.len = g.path.getLength();
    g.p.copy(g.from);
    g.k = 0;
    g.speed = (1.6 + Math.random() * 1.2) * Math.max(1, dist / 5);
    g.stopAt = Math.random() < 0.5 ? 0.3 + Math.random() * 0.4 : -1;
    g.mode = 'cross';
    g.near = false;
  }

  /** A direction from the camera into the view that misses the fruit (sky behind it), or null. */
  private pastTheFruit(camera: THREE.PerspectiveCamera) {
    for (let i = 0; i < 12; i++) {
      const dir = tRay
        .set(Math.random() * 1.8 - 0.9, Math.random() * 1.25 - 0.3, 0.5)
        .unproject(camera)
        .sub(camera.position)
        .normalize();
      const t = -camera.position.dot(dir); // nearest approach to the fruit's centre
      if (t < 0 || tClosest.copy(camera.position).addScaledVector(dir, t).length() > R0 * 1.15) return dir;
    }
    return null;
  }

  private resume(g: Gnat) {
    g.mode = 'cross';
  }

  /** Right past the lens, side to side, blurred. */
  private flyBy(g: Gnat, camera: THREE.PerspectiveCamera) {
    const fwd = camera.getWorldDirection(tFwd);
    const side = tSide.crossVectors(fwd, camera.up).normalize();
    const way = Math.random() < 0.5 ? 1 : -1;
    const d = 0.5 + Math.random() * 0.4;
    g.mode = 'flyby';
    g.near = true;
    g.from.copy(camera.position).addScaledVector(fwd, d).addScaledVector(side, 1.5 * way).addScaledVector(camera.up, (Math.random() - 0.5) * 0.5);
    g.to.copy(camera.position).addScaledVector(fwd, d + 0.3).addScaledVector(side, -1.5 * way).addScaledVector(camera.up, (Math.random() - 0.5) * 0.5);
    g.p.copy(g.from);
    g.k = 0;
    g.speed = 6;
  }

  private firefly() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,230,1)');
    g.addColorStop(0.12, 'rgba(230,255,120,0.95)');
    g.addColorStop(0.4, 'rgba(140,210,40,0.35)');
    g.addColorStop(1, 'rgba(80,140,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return this.toTexture(c);
  }

  /** The fly-by: a dark smudge. */
  private blur() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(20,16,14,0.7)');
    g.addColorStop(0.4, 'rgba(30,25,22,0.35)');
    g.addColorStop(1, 'rgba(40,35,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return this.toTexture(c);
  }

  /** A gnat: dark body, two pale wings (up or down). */
  private texture(wingsUp: boolean) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.translate(32, 32);
    ctx.fillStyle = 'rgba(225,232,240,0.55)';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(9 * s, wingsUp ? -9 : -3, 9, wingsUp ? 5 : 4, s * (wingsUp ? 0.5 : 0.2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(18,14,12,1)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 4.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -6, 3, 0, Math.PI * 2);
    ctx.fill();
    return this.toTexture(c);
  }

  private toTexture(c: HTMLCanvasElement) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
}
