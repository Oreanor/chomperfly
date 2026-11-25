import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';

const MOTES = 90;

/**
 * The sun's lens flare (at night the moon's soft glow) and motes of dust drifting in the light
 * round the fruit. `around`: the fruit's radius.
 */
export class SunFlare {
  private flare: Lensflare;
  private bits: LensflareElement[] = []; // the glow, then the ghosts along the line through the screen
  private textures: THREE.Texture[] = [];
  private sunGlow: THREE.Texture;
  private moonGlow: THREE.Texture;
  private motes: THREE.Points;
  private moteMat: THREE.ShaderMaterial;
  private moteVel: Float32Array;
  private time = 0;

  constructor(private scene: THREE.Scene, private around: number) {
    const glow = this.radial([
      [0, 'rgba(255,250,235,1)'],
      [0.12, 'rgba(255,236,190,0.85)'],
      [0.4, 'rgba(255,200,120,0.25)'],
      [1, 'rgba(255,180,90,0)'],
    ]);
    const ring = this.radial([
      [0, 'rgba(255,255,255,0.0)'],
      [0.6, 'rgba(255,255,255,0.08)'],
      [0.85, 'rgba(255,255,255,0.22)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    const dot = this.radial([
      [0, 'rgba(255,255,255,0.5)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    this.sunGlow = glow;
    this.moonGlow = this.radial([
      [0, 'rgba(255,255,255,1)'],
      [0.14, 'rgba(226,238,255,0.9)'],
      [0.42, 'rgba(170,200,255,0.28)'],
      [1, 'rgba(140,170,230,0)'],
    ]);
    this.flare = new Lensflare();
    const add = (tex: THREE.Texture, size: number, distance: number, color: THREE.Color) => {
      const el = new LensflareElement(tex, size, distance, color);
      this.bits.push(el);
      this.flare.addElement(el);
    };
    add(glow, 520, 0, new THREE.Color(1, 0.95, 0.85));
    add(dot, 60, 0.18, new THREE.Color(1, 0.85, 0.6));
    add(ring, 120, 0.42, new THREE.Color(0.75, 1, 0.8));
    add(dot, 40, 0.6, new THREE.Color(0.8, 0.85, 1));
    add(ring, 200, 0.85, new THREE.Color(1, 0.8, 0.6));
    add(dot, 90, 1.05, new THREE.Color(0.9, 1, 0.9));
    this.flare.visible = false;
    scene.add(this.flare);

    // dust motes in a shell round the fruit, drifting slowly up
    const pos = new Float32Array(MOTES * 3);
    const seed = new Float32Array(MOTES);
    this.moteVel = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) {
      const p = new THREE.Vector3().randomDirection().multiplyScalar(around * (1.15 + Math.random() * 1.6));
      pos.set([p.x, p.y, p.z], i * 3);
      this.moteVel.set([(Math.random() - 0.5) * 0.25, 0.05 + Math.random() * 0.12, (Math.random() - 0.5) * 0.25], i * 3);
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.moteMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uColor: { value: new THREE.Color(1, 0.92, 0.7) }, uGain: { value: 0.6 } },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime;
        uniform float uScale;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // twinkle, and a touch bigger up close
          vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.8 + fract(seed) * 1.5) + seed));
          gl_PointSize = uScale * (2.0 + 2.5 * fract(seed * 7.0)) * (30.0 / max(1.0, -mv.z));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uGain;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(uColor, a * a * vA * uGain);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(geo, this.moteMat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 50;
    scene.add(this.motes);
  }

  /** Night: just the moon's glow (no ghosts), bluish motes. */
  setMoon(on: boolean) {
    const b = this.bits;
    const motes = this.moteMat.uniforms;
    if (on) {
      b[0].texture = this.moonGlow;
      b[0].size = 180;
      b[0].color.setRGB(0.7, 0.82, 1);
      for (let i = 1; i < 6; i++) b[i].size = 0;
      motes.uColor.value.setRGB(0.75, 0.86, 1);
      motes.uGain.value = 0.32;
    } else {
      b[0].texture = this.sunGlow;
      b[0].size = 520;
      b[0].color.setRGB(1, 0.95, 0.85);
      b[1].size = 60;
      b[1].color.setRGB(1, 0.85, 0.6);
      b[2].size = 120;
      b[2].color.setRGB(0.75, 1, 0.8);
      b[3].size = 40;
      b[3].color.setRGB(0.8, 0.85, 1);
      b[4].size = 200;
      b[4].color.setRGB(1, 0.8, 0.6);
      b[5].size = 90;
      b[5].color.setRGB(0.9, 1, 0.9);
      motes.uColor.value.setRGB(1, 0.92, 0.7);
      motes.uGain.value = 0.6;
    }
  }

  /** dir: towards the sun (unit). */
  setSun(dir: THREE.Vector3) {
    this.flare.position.copy(dir).multiplyScalar(this.around * 3.5);
    this.flare.visible = true;
  }

  /** hidden: inside the fruit (no flare, no motes). scale: the motes' size (the pixel ratio). */
  update(dt: number, hidden: boolean, scale: number) {
    this.time += dt;
    this.flare.visible = !hidden && this.flare.position.lengthSq() > 0;
    this.motes.visible = !hidden;
    if (hidden) return;
    this.moteMat.uniforms.uTime.value = this.time;
    this.moteMat.uniforms.uScale.value = scale;
    const attr = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = attr.array as Float32Array;
    const v = this.moteVel;
    const inner = this.around * 1.1;
    const outer = this.around * 2.9;
    for (let i = 0; i < p.length; i += 3) {
      const w = this.time * 0.3 + i;
      p[i] += (v[i] + 0.05 * Math.sin(w)) * dt;
      p[i + 1] += v[i + 1] * dt;
      p[i + 2] += (v[i + 2] + 0.05 * Math.cos(w * 1.3)) * dt;
      // drifted out of the shell: comes back in on the far side
      const d = Math.hypot(p[i], p[i + 1], p[i + 2]);
      if (d > outer || d < inner) {
        const k = (d > outer ? inner * 1.05 : outer * 0.95) / (d || 1);
        p[i] *= -k;
        p[i + 1] *= -k;
        p[i + 2] *= -k;
      }
    }
    attr.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.flare, this.motes);
    this.flare.dispose();
    this.motes.geometry.dispose();
    this.moteMat.dispose();
    for (const t of this.textures) t.dispose();
  }

  private radial(stops: [number, string][]) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [at, col] of stops) g.addColorStop(at, col);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(t);
    return t;
  }
}
