import * as THREE from 'three';
import { girth, N, PULSE_AMP, PULSE_WIDTH, RADII } from './constants';

/** The visible worm: balls, eyes on the head, a name tag. */
export type WormView = {
  group: THREE.Group;
  segs: THREE.Mesh[];
  mats: THREE.MeshStandardMaterial[];
  label?: THREE.Sprite;
  // victory extras, hidden until the worm wins
  wings: THREE.Object3D[];
  antennae: THREE.Object3D;
};

const ballGeo = new THREE.SphereGeometry(1, 24, 16);
// eyes: big white eyeballs with dark pupils looking forward (sizes are in head-radius units)
const eyeGeo = new THREE.SphereGeometry(0.3, 16, 12);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
const pupilGeo = new THREE.SphereGeometry(0.13, 12, 8);
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.15 });

// victory wings (a rounded leaf shape) and antennae, in ball-radius units
const wingGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.6, 1.4, 3.2, 1.6, 3.6, 0.4);
  s.bezierCurveTo(3.8, -0.6, 1.4, -0.9, 0, 0);
  return new THREE.ShapeGeometry(s, 24).scale(1.8, 2.3, 1); // long and tall
})();
const wingMat = new THREE.MeshStandardMaterial({
  color: 0xdcefff, roughness: 0.15, transparent: true, opacity: 0.88, side: THREE.DoubleSide, emissive: 0x2a3b4c,
});
const antennaGeo = new THREE.CylinderGeometry(0.05, 0.07, 1.3, 6).translate(0, 0.65, 0);
const antennaTipGeo = new THREE.SphereGeometry(0.16, 10, 8);
const antennaMat = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.5 });

export function makeWormView(color: number, scene: THREE.Scene): WormView {
  const group = new THREE.Group();
  const base = new THREE.MeshStandardMaterial({ color, roughness: 0.42 });
  const alt = base.clone();
  alt.color.offsetHSL(0, -0.05, -0.07);
  const segs: THREE.Mesh[] = [];
  for (let k = 0; k < N; k++) {
    const m = new THREE.Mesh(ballGeo, k % 2 ? alt : base);
    group.add(m);
    segs.push(m);
  }
  for (const sx of [-0.4, 0.4]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(sx, 0.45, 0.62);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(sx * 0.12, 0.02, 0.22); // on the front of the eyeball, slightly cross-eyed
    e.add(pupil);
    segs[N - 1].add(e);
  }
  // two pairs of wings grow out of the back: big ones up front, smaller ones behind, tilted down a bit.
  // Each pivot flaps around the body axis.
  const wings: THREE.Object3D[] = [];
  for (const pair of [
    { seg: N - 3, size: 1, tilt: 0.25 },
    { seg: N - 5, size: 0.75, tilt: -0.35 },
  ]) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.3 * side, -0.75, 0);
      // the left wing is a mirror image of the right one, so the pair is symmetric
      const mirror = new THREE.Group();
      mirror.scale.set(side * pair.size, pair.size, pair.size);
      const wing = new THREE.Mesh(wingGeo, wingMat);
      wing.rotation.set(Math.PI / 2, pair.tilt, 0); // lie in the side-to-side plane
      mirror.add(wing);
      pivot.add(mirror);
      pivot.visible = false;
      pivot.userData = { side, rear: pair.size < 1 };
      segs[pair.seg].add(pivot);
      wings.push(pivot);
    }
  }
  // antennae on the head, pointing forward and up
  const antennae = new THREE.Group();
  for (const side of [-1, 1]) {
    const a = new THREE.Mesh(antennaGeo, antennaMat);
    a.position.set(0.22 * side, -0.05, 0.85); // on the crown, behind the eyes
    a.rotation.set(2.0, 0, -0.55 * side); // shown only in flight: up over the head, spread apart
    const tip = new THREE.Mesh(antennaTipGeo, antennaMat);
    tip.position.set(0, 1.3, 0);
    a.add(tip);
    antennae.add(a);
  }
  antennae.visible = false;
  segs[N - 1].add(antennae);
  scene.add(group);
  return { group, segs, mats: [base, alt], wings, antennae };
}

export function disposeWormView(v: WormView) {
  v.group.removeFromParent();
  v.mats.forEach((m) => m.dispose());
  disposeLabel(v);
}

/** Bitten: the worm pulses red until `until` (performance.now() ms). */
export function setStunGlow(v: WormView, until: number) {
  const left = until - performance.now();
  const k = left > 0 ? 0.35 + 0.3 * Math.sin(performance.now() / 90) : 0;
  for (const m of v.mats) m.emissive.setRGB(k, 0, 0);
}

export function setWormColor(v: WormView, color: number) {
  v.mats[0].color.setHex(color);
  v.mats[1].color.setHex(color).offsetHSL(0, -0.05, -0.07);
}

// ---------- name tag ----------

/** Name tag above a worm: fixed size on screen, readable through the fruit. */
function makeLabel(text: string, color: number): THREE.Sprite {
  const font = 'bold 44px system-ui, sans-serif';
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  const h = 64;
  c.width = w;
  c.height = h;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 18);
  ctx.fill();
  ctx.fillStyle = '#' + new THREE.Color(color).offsetHSL(0, 0.1, 0.08).getHexString();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true, fog: false });
  const sp = new THREE.Sprite(mat);
  const H = 0.04; // ~3.5% of screen height
  sp.scale.set((H * w) / h, H, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 100;
  return sp;
}

function disposeLabel(v: WormView) {
  if (!v.label) return;
  v.group.remove(v.label);
  v.label.material.map?.dispose();
  v.label.material.dispose();
  v.label = undefined;
}

export function setLabel(v: WormView, text: string, color: number) {
  disposeLabel(v);
  v.label = makeLabel(text, color);
  v.group.add(v.label);
}

export function placeLabel(v: WormView, head: THREE.Vector3, up: THREE.Vector3, size = 1) {
  v.label?.position.copy(head).addScaledVector(up, 0.32 * size);
}

// ---------- pose ----------

/** Swallowing wave: wave = position in balls counted from the head (-1 = no wave). */
export function pulseAt(k: number, wave: number): number {
  if (wave < 0) return 1;
  const local = wave - (N - 1 - k);
  if (local <= 0 || local >= PULSE_WIDTH) return 1;
  // soft in, soft out (zero speed at both ends)
  return 1 + PULSE_AMP * (0.5 - 0.5 * Math.cos((2 * Math.PI * local) / PULSE_WIDTH));
}

const mtx = new THREE.Matrix4();
const ZERO = new THREE.Vector3();
const tan = new THREE.Vector3();
const radialUp = new THREE.Vector3();

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Overshoots a little past 1, then settles: a springy pop. */
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

/** Victory: fx = seconds since the win (-1 = none). Wings and antennae pop out, two big flaps, then fast flapping. */
function poseVictory(v: WormView, fx: number) {
  const on = fx >= 0;
  v.antennae.visible = on;
  for (const w of v.wings) w.visible = on;
  if (!on) return;
  v.antennae.scale.setScalar(Math.max(0.001, easeOutBack(clamp01((fx - 0.9) / 0.35))));
  // wings spring out from behind the back: folded along the back, then unfold sideways with an overshoot
  const POP_START = 1.0;
  const POP_TIME = 0.5;
  const flapAt = (t: number) => {
    if (t < POP_START + POP_TIME) return 0.25;
    if (t < 3.2) return 0.3 + 0.7 * Math.sin((t - POP_START - POP_TIME) * Math.PI * 2 * 7); // fast flapping
    return 0.3 + 0.6 * Math.sin(t * Math.PI * 2 * 14); // whirring take-off
  };
  for (const w of v.wings) {
    const { side, rear } = w.userData as { side: number; rear: boolean };
    const t = rear ? fx - 0.08 : fx; // the rear pair is a beat behind
    w.visible = t >= POP_START; // hidden behind the back until they spring out
    const p = clamp01((t - POP_START) / POP_TIME);
    const e = easeOutBack(p);
    const folded = -side * (Math.PI / 2); // pointing straight back
    w.scale.setScalar(Math.max(0.001, 0.25 + 0.75 * e));
    w.rotation.set(0, 0, folded + (side * flapAt(t) - folded) * e);
  }
}

/** Places the balls along pos[]; ups[] are their "up" directions (null → away from the fruit center). */
export function poseWorm(v: WormView, pos: THREE.Vector3[], ups: THREE.Vector3[] | null, size = 1, wave = -1, fx = -1) {
  poseVictory(v, fx);
  for (let k = 0; k < N; k++) {
    const m = v.segs[k];
    tan.subVectors(pos[Math.min(k + 1, N - 1)], pos[Math.max(k - 1, 0)]);
    if (tan.lengthSq() > 1e-12) {
      const up = ups ? ups[k] : radialUp.copy(pos[k]).normalize();
      mtx.lookAt(tan, ZERO, up);
      m.quaternion.setFromRotationMatrix(mtx);
    }
    m.position.copy(pos[k]);
    // round balls overlap along the body
    m.scale.setScalar(RADII[k] * girth(size) * pulseAt(k, wave));
  }
}
