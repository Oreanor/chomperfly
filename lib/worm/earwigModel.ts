import * as THREE from 'three';
import { chitinBump } from './critterBodies';

// The earwig: a long segmented body, a head with long feelers, pincers at the tail end that can
// swing forward over its back like a scorpion's, folded fan-wings (open in flight), six legs.
// Model units: the body is ~1.06 long; makeEarwig(s) scales it.

const sphere = new THREE.SphereGeometry(1, 20, 14);
/** A rounded box (a plate of armour). */
const plate = (() => {
  const g = new THREE.BoxGeometry(2, 2, 2, 6, 6, 6);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const round = v.clone().normalize().multiplyScalar(Math.SQRT2);
    v.lerp(round, 0.35).multiplyScalar(1 / 1.0875);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
})();
const segA = new THREE.MeshPhysicalMaterial({ color: 0x55220f, roughness: 0.34, clearcoat: 0.7, clearcoatRoughness: 0.2 });
const segB = new THREE.MeshPhysicalMaterial({ color: 0x481c0d, roughness: 0.34, clearcoat: 0.7, clearcoatRoughness: 0.2 });
const wingCase = new THREE.MeshPhysicalMaterial({ color: 0x6a4024, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.5 });
const pale = new THREE.MeshStandardMaterial({ color: 0x8c6a46, roughness: 0.5 });
const feelerDark = new THREE.MeshStandardMaterial({ color: 0x6a3418, roughness: 0.45 });
const legMat = new THREE.MeshStandardMaterial({ color: 0x8a5526, roughness: 0.42 }); // amber legs and feeler tips
const headMat = new THREE.MeshPhysicalMaterial({ color: 0x7a2a12, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
const thoraxMat = new THREE.MeshPhysicalMaterial({ color: 0x4a2a17, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 });
const pincerMat = new THREE.MeshPhysicalMaterial({ color: 0x7e3414, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
let wingTex: THREE.CanvasTexture | null = null;
const wingMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0605, roughness: 0.2 });

/** Fine relief of the armour on every hard part (once, on the first earwig: it needs a document). */
function addRelief() {
  if (segA.bumpMap) return;
  for (const m of [segA, segB, wingCase, headMat, thoraxMat, pincerMat]) {
    m.bumpMap = chitinBump();
    m.bumpScale = 0.5;
  }
}

const HEAD_AT = new THREE.Vector3(0, 0.07, 0.28); // the head's pivot
const PINCERS_AT = new THREE.Vector3(0, 0.055, -0.4); // the pincers' pivot
const ORIGIN = new THREE.Vector3();

export type EarwigModel = {
  group: THREE.Group;
  head: THREE.Group;
  pincers: THREE.Group;
  wings: THREE.Group[];
  legs: { pivot: THREE.Group; side: number; tripod: number }[];
  abdomen: THREE.Group[]; // its segments, front to back, each hung on the one before
  feelers: THREE.Group[];
};

/** The fan wing: a quarter circle, veined. */
function wingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(235,240,245,0.32)';
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.arc(0, 256, 250, -Math.PI / 2, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,45,35,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 14; i++) {
    const a = -Math.PI / 2 + (i / 14) * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 256);
    ctx.lineTo(Math.cos(a) * 248, 256 + Math.sin(a) * 248);
    ctx.stroke();
  }
  ctx.lineWidth = 1.2;
  for (const r of [120, 190, 245]) {
    ctx.beginPath();
    ctx.arc(0, 256, r, -Math.PI / 2, 0);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeEarwig(s = 1): EarwigModel {
  addRelief();
  const group = new THREE.Group();
  const head = new THREE.Group();
  head.position.copy(HEAD_AT).multiplyScalar(s);
  const pincers = new THREE.Group();
  group.add(head);
  // the abdomen: a chain of segments (z, half-width), each hung on the one before so it can curl
  const SEGS: [number, number][] = [
    [0.04, 0.085],
    [-0.03, 0.097],
    [-0.1, 0.105],
    [-0.17, 0.105],
    [-0.24, 0.097],
    [-0.3, 0.085],
    [-0.355, 0.072],
    [-0.4, 0.06],
  ];
  const abdomen: THREE.Group[] = [];
  let lastZ = 0;
  let parent: THREE.Object3D = group;
  for (const [z] of SEGS) {
    const g = new THREE.Group();
    g.position.set(0, parent === group ? 0.052 * s : 0, (z - lastZ) * s);
    parent.add(g);
    abdomen.push(g);
    parent = g;
    lastZ = z;
  }
  const tailZ = SEGS[SEGS.length - 1][0];
  pincers.position.set(0, (PINCERS_AT.y - 0.052) * s, (PINCERS_AT.z - tailZ) * s);
  abdomen[abdomen.length - 1].add(pincers);
  // parts are placed in model units, relative to the part they hang on
  let on: THREE.Object3D = group;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0) => {
    const m = new THREE.Mesh(geo, mat);
    const o = on === head ? HEAD_AT : on === pincers ? PINCERS_AT : ORIGIN;
    m.position.set((x - o.x) * s, (y - o.y) * s, (z - o.z) * s);
    m.scale.set(sx * s, sy * s, sz * s);
    m.rotation.y = rotY;
    m.castShadow = true;
    on.add(m);
    return m;
  };
  SEGS.forEach(([, w], i) => {
    const m = new THREE.Mesh(sphere, i % 2 ? segA : segB);
    m.position.set(0, -0.001 * i * s, -0.01 * s);
    m.scale.set(w * s, 0.036 * s, 0.07 * s);
    m.castShadow = true;
    abdomen[i].add(m);
  });
  // the short wing cases on its back, and the wings' pale tips peeping out
  for (const side of [-1, 1]) {
    add(plate, wingCase, 0.044 * side, 0.086, 0.115, 0.043, 0.01, 0.072, 0.04 * side);
    add(sphere, pale, 0.028 * side, 0.088, 0.035, 0.02, 0.01, 0.026, 0.35 * side);
  }
  add(plate, thoraxMat, 0, 0.097, 0.115, 0.004, 0.004, 0.072); // the seam between the cases
  add(sphere, thoraxMat, 0, 0.08, 0.235, 0.08, 0.03, 0.062); // the neck shield
  add(sphere, wingCase, 0, 0.074, 0.235, 0.088, 0.022, 0.066);
  // the head
  on = head;
  add(sphere, headMat, 0, 0.078, 0.33, 0.062, 0.045, 0.06);
  for (const side of [-1, 1]) add(sphere, headMat, 0.025 * side, 0.072, 0.31, 0.045, 0.04, 0.045);
  add(sphere, headMat, 0, 0.066, 0.37, 0.035, 0.028, 0.032);
  for (const side of [-1, 1]) add(sphere, eyeMat, 0.066 * side, 0.083, 0.34, 0.016, 0.016, 0.018);
  for (const side of [-1, 1]) add(sphere, segA, 0.015 * side, 0.055, 0.395, 0.012, 0.01, 0.02); // jaws
  // feelers: a curving row of beads, dark at the base, pale beyond
  const feelers: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const root = new THREE.Vector3(0.045 * side, 0.09, 0.37);
    const f = new THREE.Group();
    f.position.copy(root).sub(HEAD_AT).multiplyScalar(s);
    head.add(f);
    feelers.push(f);
    for (let i = 0; i < 28; i++) {
      const t = i / 27;
      const x = side * (0.045 + 0.12 * t + 0.07 * t * t);
      const z = 0.37 + 0.3 * t - 0.08 * t * t;
      const y = 0.09 + 0.05 * Math.sin(Math.PI * t * 0.8);
      const bead = new THREE.Mesh(sphere, i < 9 ? feelerDark : legMat);
      bead.position.set((x - root.x) * s, (y - root.y) * s, (z - root.z) * s);
      bead.scale.set((0.0042 - 0.0015 * t) * s, (0.0042 - 0.0015 * t) * s, 0.0115 * s);
      f.add(bead);
    }
  }
  // the pincers: two curved, tapering tubes
  on = pincers;
  for (const side of [-1, 1]) {
    const pts = [
      new THREE.Vector3(0.025 * side, 0.06, -0.4),
      new THREE.Vector3(0.06 * side, 0.07, -0.47),
      new THREE.Vector3(0.072 * side, 0.08, -0.56),
      new THREE.Vector3(0.048 * side, 0.09, -0.63),
      new THREE.Vector3(0.01 * side, 0.1, -0.665),
    ].map((p) => p.sub(PINCERS_AT).multiplyScalar(s));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 24, 0.018 * s, 8, false);
    const pos = tube.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.floor(i / 9) / 24;
      const c = curve.getPointAt(Math.min(1, t));
      v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(1 - 0.75 * t).add(c); // tapers to a point
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    tube.computeVertexNormals();
    const m = new THREE.Mesh(tube, pincerMat);
    m.castShadow = true;
    pincers.add(m);
    add(sphere, pincerMat, 0.055 * side, 0.072, -0.51, 0.013, 0.011, 0.02); // the tooth on its inner edge
  }
  on = group;
  // the fan wings (shown in flight)
  const wings: THREE.Group[] = [];
  wingMat.map ??= wingTex ??= wingTexture();
  for (const side of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(0.03 * side * s, 0.1 * s, 0.13 * s);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42 * s, 0.42 * s).translate(0.21 * s, 0.21 * s, 0), wingMat);
    m.rotation.set(-Math.PI / 2, 0, side < 0 ? Math.PI : 0);
    m.scale.set(1, side < 0 ? -1 : 1, 1);
    w.add(m);
    w.visible = false;
    group.add(w);
    wings.push(w);
  }
  // six legs: thigh and shin, each pair on a pivot (they step in two tripods)
  const legGeo = new THREE.CylinderGeometry(0.75, 1, 1, 8, 1, true).translate(0, 0.5, 0);
  const bone = (to: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const m = new THREE.Mesh(legGeo, legMat);
    const d = new THREE.Vector3().subVectors(b, a);
    m.position.copy(a);
    m.scale.set(r, d.length(), r);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.castShadow = true;
    to.add(m);
    // a ball at each end closes the joint
    for (const [p, k] of [[a, 1.05], [b, 0.8]] as const) {
      const j = new THREE.Mesh(sphere, legMat);
      j.position.copy(p);
      j.scale.setScalar(r * k);
      to.add(j);
    }
  };
  const legs: EarwigModel['legs'] = [];
  for (const side of [-1, 1]) {
    (
      [
        [0.21, 0.14, 0.06],
        [0.15, 0.16, -0.02],
        [0.09, 0.17, -0.09],
      ] as const
    ).forEach(([z, out, foot], i) => {
      const hip = new THREE.Vector3(0.05 * side, 0.05, z).multiplyScalar(s);
      const pivot = new THREE.Group();
      pivot.position.copy(hip);
      group.add(pivot);
      const knee = new THREE.Vector3(side * out * 0.6, 0.05, foot * 0.5).multiplyScalar(s);
      const toe = new THREE.Vector3(side * out, -0.05, foot).multiplyScalar(s);
      bone(pivot, new THREE.Vector3(), knee, 0.011 * s);
      bone(pivot, knee, toe, 0.008 * s);
      legs.push({ pivot, side, tripod: +(i === 1 ? !(side > 0) : !(side < 0)) });
    });
  }
  return { group, head, pincers, wings, legs, abdomen, feelers };
}

/**
 * Curls the abdomen: curl lifts it (and the pincers) up over the back, yaw swings it sideways,
 * reach stretches its rear segments (to reach out with the pincers).
 */
/** `droop`: how much each segment bends down (radians), to lie along the round fruit. */
export function poseAbdomen(m: EarwigModel, curl: number, yaw: number, reach: number, droop = 0) {
  const each = yaw / Math.max(1, m.abdomen.length - 2);
  m.abdomen.forEach((g, i) => {
    g.userData.z ??= g.position.z;
    if (i >= 2) g.position.z = g.userData.z * reach;
    if (i < 2) return g.rotation.set(i ? -droop : 0, 0, 0);
    g.rotation.set(curl * 0.52 - droop, each, 0);
  });
}
