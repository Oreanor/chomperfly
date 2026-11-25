import * as THREE from 'three';
import { appleNormal, appleProject } from '@/lib/apple';

const SIZE = 0.3; // a drop's radius

type Drop = {
  mesh: THREE.Mesh;
  glint: THREE.Sprite; // the sun in it
  caustic: THREE.Mesh; // the light it focuses on the skin (on the side away from the sun)
  shadow: THREE.Mesh;
  at: THREE.Vector3; // on the skin
  n: THREE.Vector3; // the skin's normal there
  seed: number;
  born: number; // its clock when it appeared (it plops down)
  gone?: number; // …when it was drunk (it bursts and fades)
};

const UP = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const tView = new THREE.Vector3();
const tHalf = new THREE.Vector3();
const tSun = new THREE.Vector3();

/**
 * Water drops on the skin (the server places them: { id, d: direction from the centre }).
 * Glassy domes that wobble, with the sun's glint, a caustic and a shadow. Drinking one is the only
 * speed boost.
 */
export class Drops {
  private group = new THREE.Group();
  private geo: THREE.LatheGeometry;
  private mat: THREE.MeshPhysicalMaterial;
  private glintMat: THREE.SpriteMaterial;
  private causticGeo = new THREE.CircleGeometry(1, 24);
  private causticMat: THREE.MeshBasicMaterial;
  private shadowMat: THREE.MeshBasicMaterial;
  private drops = new Map<number, Drop>();
  private time = 0;

  constructor(scene: THREE.Scene) {
    // a flattened dome: a little bulgy at the edge
    const prof = [new THREE.Vector2(0, 0)];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2);
      prof.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) ** 0.7), 0.62 * Math.sin(a)));
    }
    this.geo = new THREE.LatheGeometry(prof, 28);
    this.mat = new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      roughness: 0.03,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0,
      ior: 1.33,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      envMapIntensity: 4,
    });
    this.mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        /* glsl */ `#include <dithering_fragment>
        vec3 nV = normalize(normal);
        vec3 vV = normalize(vViewPosition);
        float fres = pow(1.0 - abs(dot(nV, vV)), 2.0);
        vec3 refl = gl_FragColor.rgb * (1.5 + 2.5 * fres); // the sky in it, strongest towards the rim
        #if NUM_DIR_LIGHTS > 0
          // the sun: a small, very bright glint
          vec3 hV = normalize(directionalLights[0].direction + vV);
          refl += directionalLights[0].color * 0.35 * pow(max(dot(nV, hV), 0.0), 350.0);
          refl += directionalLights[0].color * 0.04 * pow(max(dot(nV, hV), 0.0), 40.0);
        #endif
        gl_FragColor = vec4(refl, 0.04 + 0.7 * fres);`,
      );
    };
    // the glint: a soft dot with a little cross
    const g = canvas64();
    const gc = g.getContext('2d')!;
    const gg = gc.createRadialGradient(32, 32, 0, 32, 32, 32);
    gg.addColorStop(0, 'rgba(255,255,255,1)');
    gg.addColorStop(0.15, 'rgba(255,255,255,0.6)');
    gg.addColorStop(1, 'rgba(255,255,255,0)');
    gc.fillStyle = gg;
    gc.fillRect(0, 0, 64, 64);
    gc.fillStyle = 'rgba(255,255,255,0.9)';
    gc.fillRect(31, 2, 2, 60);
    gc.fillRect(2, 31, 60, 2);
    this.glintMat = new THREE.SpriteMaterial({ map: srgb(g), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    // the caustic: warm light
    const c = canvas64();
    const cc = c.getContext('2d')!;
    const cg = cc.createRadialGradient(32, 32, 0, 32, 32, 32);
    cg.addColorStop(0, 'rgba(255,250,225,1)');
    cg.addColorStop(0.35, 'rgba(255,245,215,0.55)');
    cg.addColorStop(1, 'rgba(255,240,200,0)');
    cc.fillStyle = cg;
    cc.fillRect(0, 0, 64, 64);
    this.causticMat = new THREE.MeshBasicMaterial({ map: srgb(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.8 });
    // the shadow: a dark rim, light in the middle (the drop lets light through)
    const s = canvas64();
    const sc = s.getContext('2d')!;
    const sg = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
    sg.addColorStop(0, 'rgba(0,0,0,0)');
    sg.addColorStop(0.55, 'rgba(0,0,0,0.15)');
    sg.addColorStop(0.8, 'rgba(0,0,0,0.5)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    sc.fillStyle = sg;
    sc.fillRect(0, 0, 64, 64);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(s), transparent: true, depthWrite: false, fog: false, opacity: 0.7 });
    scene.add(this.group);
  }

  /** All the drops there are (joining a room): no plop. */
  set(list: { id: number; d: number[] }[]) {
    for (const id of [...this.drops.keys()]) this.remove(id);
    for (const d of list) this.add(d, false);
  }

  /** A new drop; fresh: it plops down. */
  add(d: { id: number; d: number[] }, fresh = true) {
    if (this.drops.has(d.id)) return;
    const at = appleProject(new THREE.Vector3(...(d.d as [number, number, number])).normalize());
    const n = appleNormal(at, new THREE.Vector3());
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.renderOrder = 12;
    mesh.castShadow = true;
    this.group.add(mesh);
    const glint = new THREE.Sprite(this.glintMat.clone());
    glint.renderOrder = 13;
    this.group.add(glint);
    const caustic = new THREE.Mesh(this.causticGeo, this.causticMat);
    caustic.renderOrder = 11;
    this.group.add(caustic);
    const shadow = new THREE.Mesh(this.causticGeo, this.shadowMat);
    shadow.renderOrder = 10;
    this.group.add(shadow);
    this.drops.set(d.id, { mesh, glint, caustic, shadow, at, n, seed: Math.random() * 10, born: fresh ? this.time : -99 });
  }

  /** Someone drank it: it bursts and goes. */
  pick(id: number) {
    const d = this.drops.get(id);
    if (d && d.gone === undefined) d.gone = this.time;
  }

  remove(id: number) {
    const d = this.drops.get(id);
    if (!d) return;
    d.mesh.removeFromParent();
    d.glint.removeFromParent();
    d.glint.material.dispose();
    d.caustic.removeFromParent();
    d.shadow.removeFromParent();
    this.drops.delete(id);
  }

  /** The drop a head at p (radius r) touches, or −1. */
  hit(p: THREE.Vector3, r: number) {
    for (const [id, d] of this.drops) if (d.gone === undefined && d.at.distanceTo(p) < r + SIZE) return id;
    return -1;
  }

  where(id: number) {
    return this.drops.get(id)?.at;
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  /** At night the caustic is moonlight. */
  setMoon(on: boolean) {
    this.causticMat.color.set(on ? 0xc5d8ff : 0xffffff);
  }

  update(dt: number, camPos: THREE.Vector3, sunDir: THREE.Vector3) {
    this.time += dt;
    for (const [id, d] of this.drops) {
      const wob = 0.05 * Math.sin(this.time * 6 + d.seed);
      // a new one plops: grows past its size and settles
      const b = Math.min(1, (this.time - d.born) / 0.9);
      let s = b >= 1 ? 1 : 1 + 2.4 * (b - 1) ** 3 + 1.4 * (b - 1) ** 2;
      let a = 1;
      if (d.gone !== undefined) {
        const t = (this.time - d.gone) / 0.25;
        if (t >= 1) {
          this.remove(id);
          continue;
        }
        a = 1 - t;
        s *= 1 + 0.5 * Math.sin(Math.PI * t * 0.5);
      }
      d.mesh.position.copy(d.at).addScaledVector(d.n, -0.012);
      d.mesh.quaternion.setFromUnitVectors(UP, d.n);
      d.mesh.scale.set(SIZE * (1 + wob) * s, SIZE * (1 - 1.5 * wob) * s * s * a * a, SIZE * (1 + wob) * s);
      // the glint: where the sun reflects towards the camera
      tView.subVectors(camPos, d.mesh.position).normalize();
      tHalf.addVectors(tView, sunDir).normalize();
      const lit = +(sunDir.dot(d.n) > 0);
      const glint = lit * Math.max(0, (tHalf.dot(d.n) - 0.9) / 0.1) ** 3;
      d.glint.visible = glint > 0.01;
      d.glint.position.copy(d.mesh.position).addScaledVector(d.n, 0.09).addScaledVector(tHalf, 0.135);
      d.glint.scale.setScalar(SIZE * (0.5 + 2.8 * glint));
      d.glint.material.opacity = glint;
      d.glint.material.rotation = d.seed;
      // caustic and shadow on the skin, away from the sun (further the lower it is)
      tSun.copy(sunDir).addScaledVector(d.n, -sunDir.dot(d.n));
      const low = tSun.length();
      if (low > 1e-4) tSun.divideScalar(low);
      d.caustic.visible = lit > 0;
      d.caustic.position.copy(d.at).addScaledVector(d.n, 0.004).addScaledVector(tSun, -SIZE * (0.15 + 0.5 * low));
      d.caustic.quaternion.setFromUnitVectors(Z, d.n);
      d.caustic.scale.set(SIZE * 0.55 * s, SIZE * 0.55 * s, 1);
      d.shadow.visible = lit > 0;
      d.shadow.position.copy(d.at).addScaledVector(d.n, 0.003).addScaledVector(tSun, -SIZE * (0.1 + 0.45 * low));
      d.shadow.quaternion.copy(d.caustic.quaternion);
      d.shadow.scale.set(SIZE * 1.25 * s, SIZE * 1.25 * s, 1);
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const id of [...this.drops.keys()]) this.remove(id);
    this.geo.dispose();
    this.mat.dispose();
    this.glintMat.map?.dispose();
    this.glintMat.dispose();
    this.causticGeo.dispose();
    this.causticMat.map?.dispose();
    this.causticMat.dispose();
    this.shadowMat.map?.dispose();
    this.shadowMat.dispose();
  }
}

function canvas64() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  return c;
}

function srgb(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
