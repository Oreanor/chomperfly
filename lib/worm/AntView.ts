import * as THREE from 'three';
import { R0, appleF, appleNormal } from '@/lib/apple';
import { girth, N, RADII } from './constants';
import { makeEarwig, poseAbdomen, type EarwigModel } from './earwigModel';
import { LEG_MATS, critterBody, ladybugBodyGeometry, ladybugBodyMat, ladybugShellMat, ladybugShellTexture } from './critterBodies';
import {
  ANT, CARRIED, CARRY, CHAFER, CHASE, EARWIG, EARWIG_FLY_IN, FLEE, FLUNG, HOLD, KNOCKED, LADYBUG, LADYBUG_FLY_IN, QUARREL,
  SLAPPED, SPECS, SPIDER, UPTURNED, WANDER, type AntSnap, type Kind,
} from './Ants';

/** The balls an ant can't bite from: the worm's two ends. */
const atEnd = (seg: number) => seg <= 2 || seg >= 7;

const ORIGIN = new THREE.Vector3();
const tA = new THREE.Vector3();
const tB = new THREE.Vector3();
const tC = new THREE.Vector3();
const tFrom = new THREE.Vector3();
const tLocal = new THREE.Vector3();
const tPivot = new THREE.Vector3();
const tDir = new THREE.Vector3();
const tAxis = new THREE.Vector3();
const tNext = new THREE.Vector3();
const qFrom = new THREE.Quaternion();
const qTo = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
// leg bones (instanced cylinders)
const bDir = new THREE.Vector3();
const bMid = new THREE.Vector3();
const bScale = new THREE.Vector3();
const bQ = new THREE.Quaternion();
const bM = new THREE.Matrix4();
const bShade = new THREE.Color();
const lHip = new THREE.Vector3();
const lAnkle = new THREE.Vector3();
const lKnee = new THREE.Vector3();
const lReach = new THREE.Vector3();
const lFoot = new THREE.Vector3();
const lOut = new THREE.Vector3();

/** A gait's stride, × body length, per kind: legs step as far as the critter moves. */
const STRIDE: Record<Kind, number> = { [ANT]: 0.32, [LADYBUG]: 0.26, [SPIDER]: 0.4, [EARWIG]: 0.3, [CHAFER]: 0.22 };

/**
 * One leg (× body length): hip, where the foot rests, bone lengths, the stride and how high the foot
 * lifts, which way the knee bends out, its phase in the gait (0 / 0.5: two tripods), thickness.
 */
type LegSpec = { hip: [number, number, number]; foot: [number, number, number]; thigh: number; shin: number; tarsus: number; stride: number; lift: number; kneeOut: number; offset: number; r: number };
const ANT_LEGS: LegSpec[] = [
  { hip: [0.04, 0.1, 0.12], foot: [0.3, 0, 0.4], thigh: 0.24, shin: 0.28, tarsus: 0.05, stride: 0.13, lift: 0.07, kneeOut: 0.5, offset: 0, r: 0.016 },
  { hip: [0.05, 0.1, 0.03], foot: [0.42, 0, 0.03], thigh: 0.22, shin: 0.27, tarsus: 0.05, stride: 0.13, lift: 0.07, kneeOut: 0.5, offset: 0.5, r: 0.016 },
  { hip: [0.04, 0.1, -0.06], foot: [0.32, 0, -0.4], thigh: 0.26, shin: 0.3, tarsus: 0.05, stride: 0.13, lift: 0.07, kneeOut: 0.5, offset: 0, r: 0.016 },
];
const LADYBUG_LEGS: LegSpec[] = [
  { hip: [0.05, 0.05, 0.14], foot: [0.3, 0, 0.3], thigh: 0.14, shin: 0.17, tarsus: 0.04, stride: 0.09, lift: 0.035, kneeOut: 2.5, offset: 0, r: 0.014 },
  { hip: [0.07, 0.05, 0.02], foot: [0.36, 0, 0.02], thigh: 0.15, shin: 0.18, tarsus: 0.04, stride: 0.09, lift: 0.035, kneeOut: 2.5, offset: 0.5, r: 0.014 },
  { hip: [0.06, 0.05, -0.1], foot: [0.32, 0, -0.26], thigh: 0.15, shin: 0.18, tarsus: 0.04, stride: 0.09, lift: 0.035, kneeOut: 2.5, offset: 0, r: 0.014 },
];
const CHAFER_LEGS: LegSpec[] = [
  { hip: [0.08, 0.08, 0.2], foot: [0.36, 0, 0.42], thigh: 0.2, shin: 0.24, tarsus: 0.06, stride: 0.12, lift: 0.05, kneeOut: 1.6, offset: 0, r: 0.022 },
  { hip: [0.12, 0.08, 0.03], foot: [0.46, 0, 0.05], thigh: 0.22, shin: 0.26, tarsus: 0.06, stride: 0.12, lift: 0.05, kneeOut: 1.6, offset: 0.5, r: 0.022 },
  { hip: [0.1, 0.08, -0.12], foot: [0.42, 0, -0.36], thigh: 0.24, shin: 0.28, tarsus: 0.06, stride: 0.12, lift: 0.05, kneeOut: 1.6, offset: 0, r: 0.022 },
];
const SPIDER_LEGS: LegSpec[] = [
  { hip: [0.07, 0.16, 0.18], foot: [0.46, 0, 0.46], thigh: 0.36, shin: 0.4, tarsus: 0.07, stride: 0.18, lift: 0.1, kneeOut: 0.25, offset: 0, r: 0.013 },
  { hip: [0.09, 0.16, 0.13], foot: [0.6, 0, 0.16], thigh: 0.36, shin: 0.4, tarsus: 0.07, stride: 0.18, lift: 0.1, kneeOut: 0.25, offset: 0.5, r: 0.013 },
  { hip: [0.09, 0.16, 0.08], foot: [0.58, 0, -0.16], thigh: 0.36, shin: 0.4, tarsus: 0.07, stride: 0.18, lift: 0.1, kneeOut: 0.25, offset: 0, r: 0.013 },
  { hip: [0.07, 0.16, 0.03], foot: [0.44, 0, -0.44], thigh: 0.38, shin: 0.42, tarsus: 0.07, stride: 0.18, lift: 0.1, kneeOut: 0.25, offset: 0.5, r: 0.013 },
];

const sphere = new THREE.SphereGeometry(1, 14, 10);
const blackMat = new THREE.MeshStandardMaterial({ color: 0x0e0b0a, roughness: 0.3 });
// a ladybug's wing cases: the dome's left and right halves (they open to fly)
const domeLeft = new THREE.SphereGeometry(1, 32, 16, -Math.PI / 2, Math.PI, 0, Math.PI / 2);
const domeRight = new THREE.SphereGeometry(1, 32, 16, Math.PI / 2, Math.PI, 0, Math.PI / 2);
/** A ladybug's spots on each wing case: [x, z, radius] (× body length). */
const LADYBUG_SPOTS = [
  [0.12, 0.06, 0.06],
  [0.22, -0.1, 0.07],
  [0.12, -0.28, 0.055],
] as const;
let shellTex: THREE.Texture[] | null = null;
const shellTextures = () => (shellTex ??= [ladybugShellTexture(-1, LADYBUG_SPOTS), ladybugShellTexture(1, LADYBUG_SPOTS)]);
// its flying wing: a long rounded blade
const wingShape = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, -0.12);
  s.bezierCurveTo(0.35, -0.2, 0.8, -0.32, 1, -0.05);
  s.bezierCurveTo(1.04, 0.12, 0.7, 0.2, 0.3, 0.14);
  s.bezierCurveTo(0.1, 0.1, 0, 0.06, 0, -0.12);
  return new THREE.ShapeGeometry(s, 10).rotateX(-Math.PI / 2);
})();
const wingMat = new THREE.MeshStandardMaterial({ color: 0xd8c9b0, roughness: 0.25, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const legGeo = new THREE.CylinderGeometry(0.65, 1, 1, 8, 1);
// a ball at the start of every bone: closes the joints where two bones meet at an angle
const jointGeo = new THREE.SphereGeometry(1, 10, 8);
// a ladybug's seam: a thin black line arching over its shell from front to back, lying on the
// shell (the dome: center (0, 0.04, -0.08), radii 0.32 up, 0.38 along)
const seam = new THREE.TubeGeometry(
  new THREE.CatmullRomCurve3(
    Array.from({ length: 25 }, (_, i) => {
      const t = (i / 24) * Math.PI;
      return new THREE.Vector3(0, 0.04 + 0.32 * 1.004 * Math.sin(t), -0.08 + 0.38 * 1.004 * Math.cos(t));
    }),
  ),
  48,
  0.006,
  6,
);
const MAX_BONES = 26;

type AntMesh = {
  group: THREE.Group;
  legs: THREE.InstancedMesh;
  joints: THREE.InstancedMesh;
  /** On the fruit's skin: how far it is drawn sunk (its feet reach down to the curved skin). */
  skin?: number;
  p: THREE.Vector3; // drawn position
  f: THREE.Vector3;
  snap: AntSnap;
  phase: number; // gait phase, advanced by the distance actually moved
  feelers: number;
  tpos: number; // drawn position along its passage (follows the path, never cuts corners)
  tun?: string; // the passage it's drawn in
  born: number; // performance.now() when it appeared (flies in / pops up)
  fly?: { elytra: THREE.Group[]; wings: THREE.Group[]; seam: THREE.Mesh; mats: THREE.Material[] };
  earwig?: EarwigModel;
  fade?: THREE.Material[]; // its own materials, fading (flung off)
  leaving?: number;
  lastState?: number;
  attachFrom?: THREE.Vector3; // grabbing a worm: glides from here onto it
  attachT?: number;
  attachFace?: THREE.Vector3;
  holdF?: THREE.Vector3; // a ladybug holding: the way it stands (follows slowly)
  struck?: boolean;
  flungShown?: boolean;
  roll?: number; // 0…1 over onto its back
  spurShown?: number;
  spurAt?: number;
  bitAt?: number;
  lashShown?: boolean;
  bites?: number;
  // the earwig
  blown?: boolean;
  grabAt?: number;
  gripAt?: number;
  lift?: number;
  twistTo?: number;
  twist?: number;
  bank?: number;
  curl?: number;
  yaw?: number;
  reach?: number;
  sweepYaw?: number;
};

/** A body seen by this client: its balls as drawn, its size. */
type Body = { disp: THREE.Vector3[]; size: number };

/** Draws the critters from snapshots; one holding a worm sits on that worm's balls as each client sees them. */
export class AntView {
  private ants = new Map<number, AntMesh>();
  private group = new THREE.Group();
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private side = new THREE.Vector3();
  private up = new THREE.Vector3();
  private snaps: AntSnap[] = [];
  private inside = false;
  private primed = false; // critters already there when we joined don't fly in
  private cam = new THREE.Vector3(0, 0, 40); // where the viewer is: ladybugs fly in from behind it
  private flyFrom = new THREE.Vector3();
  /** A hit to show (a comic pop, or strokes): at p, its size, following a moving point. */
  onBite?: (p: THREE.Vector3, size: number, style: 'pop' | 'strokes', follow: THREE.Vector3) => void;

  /** The camera position (a new ladybug comes in from over the viewer's shoulder). */
  setCamera(p: THREE.Vector3) {
    this.cam.copy(p);
  }

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /**
   * For the sounds: each critter, what it's doing, whether its wings are out, whether it's inside the
   * fruit (the drilling earwig) and whether it's shown (one inside isn't, to a worm outside).
   */
  *heard(): Generator<{ id: number; kind: Kind; state: number; p: THREE.Vector3; flying: boolean; inside: boolean; shown: boolean }> {
    for (const [id, a] of this.ants) {
      const flying = !!(a.fly?.wings[0]?.visible || a.earwig?.wings[0]?.visible);
      yield { id, kind: a.snap[11], state: a.snap[1], p: a.group.position, flying, inside: !!a.snap[12], shown: a.group.visible };
    }
  }

  /**
   * Builds one critter of each kind and compiles their shaders (and paints their canvas textures) up
   * front, so the first earwig or ladybug to arrive doesn't stall a frame. Then throws them away.
   */
  warm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene) {
    const made = ([ANT, LADYBUG, SPIDER, EARWIG, CHAFER] as Kind[]).map((kind, i) =>
      this.make([-1 - i, 0, 0, 0, 0, 0, 0, 1, '', 0, 0, kind, 0, '', 0] as AntSnap),
    );
    for (const a of made) a.legs.count = a.joints.count = 1;
    renderer.compile(this.group, camera, scene);
    // and send their canvas textures (shells, chitin relief, wings) to the GPU now, not on first sight
    for (const a of made)
      a.group.traverse((o) => {
        const ms = (o as THREE.Mesh).material;
        for (const m of Array.isArray(ms) ? ms : ms ? [ms] : []) {
          const p = m as THREE.MeshPhysicalMaterial;
          for (const t of [p.map, p.bumpMap, p.roughnessMap]) if (t) renderer.initTexture(t);
        }
      });
    for (const a of made) {
      this.group.remove(a.group);
      a.legs.dispose();
      a.joints.dispose();
    }
  }

  apply(snaps: AntSnap[]) {
    this.snaps = snaps;
    const alive = new Set<number>();
    for (const s of snaps) {
      alive.add(s[0]);
      let a = this.ants.get(s[0]);
      if (!a) {
        a = this.make(s);
        if (!this.primed) a.born = -1e9;
        this.ants.set(s[0], a);
      }
      a.snap = s;
    }
    this.primed = true;
    for (const [id, a] of this.ants) {
      if (alive.has(id)) continue;
      this.group.remove(a.group);
      a.legs.dispose(); // legs are per critter, the rest is shared
      a.joints.dispose();
      for (const m of a.fade ?? []) m.dispose();
      this.ants.delete(id);
    }
  }

  clear() {
    this.apply([]);
  }

  /**
   * The earwig: flies in (wings whirring), flies off; a jaw snap (1) or a pincer snap (2) turns its head
   * or swings its tail; holding a worm (5) it lifts and sweeps its pincers over its back to the worm;
   * startled (6) it shudders. Pops show the hits.
   */
  private poseEarwig(a: AntMesh, len: number, s: AntSnap, wormBody: (id: string) => Body | null) {
    const e = a.earwig;
    if (!e) return;
    const now = performance.now();
    const t = (now - a.born) / 1000 / EARWIG_FLY_IN;
    const flying = (t < 0.92 && s[1] !== SLAPPED) || s[1] === SLAPPED;
    for (const w of e.wings) {
      w.visible = flying;
      if (flying) w.rotation.set(0, -0.5 * Math.sign(w.position.x), Math.sign(w.position.x) * Math.sin(a.feelers * 38) * 0.45);
    }
    if (t < 1 && s[1] !== SLAPPED) {
      // dropping in from above
      const k = 1 - t;
      a.group.translateY(k * k * len * 7);
      a.group.rotateZ(Math.sin(t * 9) * 0.15 * k);
      a.group.rotateX(-0.3 * k);
    }
    if (s[1] === SLAPPED) {
      a.leaving ??= now;
      const k = Math.min(1, (now - a.leaving) / 1000 / 1.6);
      a.group.translateY(k * k * len * 9);
      a.group.translateZ(-k * len * 3);
      a.group.rotateX(-0.6 * Math.min(1, k * 3));
      a.group.scale.setScalar(Math.max(0.001, 1 - Math.max(0, k - 0.6) / 0.4));
    }
    const act = s[9];
    const amount = Math.abs(s[10]);
    const sign = s[10] < 0 ? -1 : 1;
    const c = Math.min(1, amount);
    // a quick strike and a slower return
    const strike = c < 0.2 ? Math.sin((Math.PI / 2) * (c / 0.2)) : Math.cos((Math.PI / 2) * ((c - 0.2) / 0.8));
    e.head.rotation.set(act === 1 ? 0.35 * strike : 0, act === 1 ? 0.8 * sign * strike : 0.18 * Math.sin(a.feelers * 0.9), 0);
    e.head.position.z = (len / 1.06) * (0.28 + (act === 1 ? 0.14 * strike : 0));
    if (act === 1) a.group.translateZ(strike * len * 0.08);
    const hitting = (act === 1 || act === 2 || act === 5 || act === 6) && (amount > 0.15 || act === 6);
    if (hitting && !a.blown) {
      a.group.updateMatrixWorld(true);
      const at = act === 1 ? e.head.localToWorld(new THREE.Vector3(0, 0, (len / 1.06) * 0.12)) : e.pincers.localToWorld(new THREE.Vector3(0, 0, -((len / 1.06) * 0.2)));
      if (act === 6) this.onBite?.(a.group.position.clone().addScaledVector(this.up, 0.3 * len), len * 1.1, s[10] < 0 ? 'pop' : 'strokes', a.group.position);
      else this.onBite?.(at, len * (act === 5 ? 0.7 : 0.55), act === 1 ? 'pop' : 'strokes', a.group.position);
    }
    a.blown = hitting || (a.blown && act !== 0 && amount > 0.15);
    if (!act) a.blown = false;
    if (act === 2) e.pincers.rotation.set(0.9 * strike, 0.6 * sign * Math.sin(2 * Math.PI * amount), 0);
    else if (act === 3) e.pincers.rotation.set(+Math.max(0, s[10]), 0, 0);
    else if (act === 4) e.pincers.rotation.set(0.35, 0.08 * Math.sin(a.feelers * 20), 0);
    else if (act === 5) e.pincers.rotation.set(0.1, 0.05 * Math.sin(a.feelers * 6), 0);
    else e.pincers.rotation.set(0.05 + 0.04 * Math.sin(a.feelers * 1.3), 0, 0);
    if (act === 5) a.grabAt ??= now;
    else {
      a.grabAt = undefined;
      a.gripAt = undefined;
    }
    const sinceGrab = a.grabAt !== undefined ? (now - a.grabAt) / 1000 : -1;
    // holding: rises a little on its legs
    a.lift = (a.lift ?? 0) + (+(act === 5) - (a.lift ?? 0)) * (1 - Math.exp(-0.1));
    if (a.lift > 0.01) a.group.translateY(a.lift * len * 0.06);
    // just grabbed: turns to the worm, then sweeps its pincers over to it
    const prey = act === 5 && !a.gripAt ? wormBody(s[8]) : null;
    if (prey) {
      a.group.updateMatrixWorld(true);
      const local = a.group.worldToLocal(tLocal.copy(prey.disp[N >> 1]));
      const ang = Math.atan2(-local.x, -(local.z + (len / 1.06) * 0.1));
      a.twistTo = THREE.MathUtils.clamp(ang * 0.65, -1.05, 1.05);
    }
    const twist = act === 5 ? (a.twistTo ?? 0) * (a.gripAt ? 0.5 : 1) : 0;
    a.twist = (a.twist ?? 0) + (twist - (a.twist ?? 0)) * (1 - Math.exp(-(prey ? 40 : 5) / 60));
    const bank = act === 5 ? THREE.MathUtils.clamp((a.twistTo ?? 0) * 0.55, -0.5, 0.5) * (a.gripAt ? 0.5 : 1) : 0;
    a.bank = (a.bank ?? 0) + (bank - (a.bank ?? 0)) * (1 - Math.exp(-(prey ? 36 : 6) / 60));
    if (Math.abs(a.twist) > 0.002) a.group.rotateY(a.twist);
    if (Math.abs(a.bank) > 0.002) a.group.rotateZ(a.bank);
    if (prey) {
      this.sweepTo(a, e, len, prey.disp[N >> 1], sinceGrab);
      if (sinceGrab > 0.14) a.gripAt = now;
    } else {
      if (act === 5 && !a.gripAt) a.gripAt = now;
      const holding = act === 5;
      const settle = holding ? Math.min(1, (now - (a.gripAt ?? now)) / 1000 / 0.6) : 0;
      const curl = holding ? 0.32 * settle : act === 2 ? 0.55 * strike : act === 4 ? 0.4 : act === 3 ? 0.5 * Math.max(0, s[10]) : 0;
      const yaw = holding ? (a.sweepYaw ?? 0) * (1 - 0.4 * settle) + 0.35 * Math.sin(sinceGrab * 2.2) * settle : act === 2 ? 0.6 * sign * strike : 0;
      const k = 1 - Math.exp(-(holding ? 6 : 9) / 60);
      a.curl = (a.curl ?? 0) + (curl - (a.curl ?? 0)) * k;
      a.yaw = (a.yaw ?? 0) + (yaw - (a.yaw ?? 0)) * k;
      a.reach = (a.reach ?? 1) + ((holding ? Math.min(a.reach ?? 1, 1.4) : 1) - (a.reach ?? 1)) * k;
      poseAbdomen(e, a.curl, a.yaw, a.reach, a.skin !== undefined ? (0.07 * len) / 1.06 / R0 : 0);
    }
    if (act === 6) {
      const k = 1 - amount;
      a.group.rotateZ(Math.sin(a.feelers * 40) * 0.12 * k);
      a.group.rotateY(Math.sin(a.feelers * 23) * 0.08 * k);
      e.head.rotation.x = 0.35 * k;
    }
    e.feelers.forEach((f, i) => {
      const w = a.feelers * 1.9 + i * 1.9 + s[0];
      f.rotation.set(0.12 * Math.sin(w * 1.3), 0.18 * Math.sin(w), 0);
    });
    const ph = a.phase * Math.PI * 2;
    for (const leg of e.legs) {
      const w = ph + leg.tripod * Math.PI;
      const sw = Math.sin(w);
      const tilt = -(a.bank ?? 0) - leg.side * (a.lift ?? 0) * 0.25;
      leg.pivot.rotation.set(0, -leg.side * sw * 0.4, leg.side * Math.max(0, Math.cos(w)) * 0.3 + tilt);
    }
  }

  /** Swings the pincers round to `at` (a worm it just grabbed), over 0.14 s. */
  private sweepTo(a: AntMesh, e: EarwigModel, len: number, at: THREE.Vector3, since: number) {
    const s = len / 1.06;
    a.group.updateMatrixWorld(true);
    const local = a.group.worldToLocal(tLocal.copy(at));
    const base = tPivot.set(0, 0.052 * s, -0.1 * s);
    const dx = local.x - base.x;
    const dz = local.z - base.z;
    const yaw = THREE.MathUtils.clamp(Math.atan2(-dx, -dz), -2.2, 2.2);
    const dist = Math.hypot(dx, dz);
    const reach = THREE.MathUtils.clamp(dist / (0.55 * s), 0.8, 1.6);
    const k = Math.min(1, since / 0.14);
    const ease = k * k * (3 - 2 * k);
    a.sweepYaw = yaw;
    a.yaw = yaw * ease;
    a.curl = 0.04;
    a.reach = 1 + (reach - 1) * ease;
    poseAbdomen(e, a.curl, a.yaw, a.reach);
    e.pincers.rotation.set(0.05, 0, 0);
  }

  /** A ladybug knocked aside: a little hop with its wings half out. t: 0…1 */
  private hop(a: AntMesh, len: number, t: number) {
    const fly = a.fly;
    if (!fly) return;
    const open = Math.min(1, t / 0.15, (1 - t) / 0.2);
    this.poseWings(fly, Math.max(0, open), Math.max(0, open));
    a.group.translateY(Math.sin(Math.PI * Math.min(1, t)) * len * 1.1);
    a.group.rotateX(-0.45 * Math.max(0, open));
    for (const m of fly.mats) {
      m.transparent = m === fly.mats[2];
      m.opacity = m === fly.mats[2] ? 0.4 : 1;
    }
  }

  /** A ladybug flies away: opens up, lifts off, rises and fades. */
  private flyOff(a: AntMesh, len: number) {
    const fly = a.fly;
    if (!fly) return;
    a.leaving ??= performance.now();
    const t = Math.min(1, (performance.now() - a.leaving) / 1000 / 1.8);
    const open = smooth01(t / 0.2);
    this.poseWings(fly, open, smooth01((t - 0.08) / 0.2));
    const rise = Math.max(0, t - 0.15) / 0.85;
    a.group.position.addScaledVector(this.up, rise * rise * len * 14).addScaledVector(a.f, -rise * len * 6);
    a.group.rotateX(-0.55 * open);
    const alpha = 1 - smooth01((t - 0.7) / 0.3);
    for (const m of fly.mats) {
      m.transparent = true;
      m.opacity = m === fly.mats[2] ? 0.4 * alpha : alpha;
    }
  }

  /**
   * A new ladybug flies in from behind the viewer, wing cases open, wings whirring: an arc over the
   * fruit, turning along its path, down onto its spot; lands and folds them.
   */
  private flyIn(a: AntMesh) {
    const fly = a.fly;
    if (!fly) return;
    const len = SPECS[LADYBUG].len;
    const t = (performance.now() - a.born) / 1000 / LADYBUG_FLY_IN;
    if (t >= 1) {
      if (fly.wings[0].visible || !fly.seam.visible) {
        this.poseWings(fly, 0, 0);
        for (const m of fly.mats) {
          m.transparent = m === fly.mats[2];
          m.opacity = m === fly.mats[2] ? 0.4 : 1;
        }
      }
      return;
    }
    const LAND = 0.55; // touches down at this part of the time, then folds its wings
    const k = Math.min(1, t / LAND);
    const pos = a.group.position;
    const land = tA.copy(pos);
    const landQ = qFrom.copy(a.group.quaternion);
    this.flyFrom.subVectors(this.cam, land);
    const dist = this.flyFrom.length();
    this.flyFrom.multiplyScalar(1.25).add(land).addScaledVector(this.up, 0.15 * dist);
    const hover = 0.5 * len * (1 - smooth01((t - LAND) / 0.17));
    /** Where it is at k: round the fruit from the start to above its spot, along an arc. */
    const at = (k: number, out: THREE.Vector3) => {
      const e = 1 - (1 - Math.min(1, k)) ** 3; // fast in, slowing to land
      const r0 = this.flyFrom.length();
      const r1 = land.length() + hover;
      const dir = tB.copy(this.flyFrom).normalize();
      const ang = dir.angleTo(tC.copy(land).normalize());
      if (ang > 1e-4) dir.applyAxisAngle(tAxis.crossVectors(dir, tC).normalize(), ang * e);
      const r = r0 + (r1 - r0) * e + Math.sin(Math.PI * e) * Math.min(dist, land.length()) * 0.25 * (1 - 0.5 * e);
      return out.copy(dir).multiplyScalar(Math.max(r, e < 0.97 ? land.length() * 1.12 : 0));
    };
    at(k, pos);
    const air = 1 - smooth01((t - LAND) / 0.17);
    if (k < 1) {
      at(k + 0.02, tNext);
      tNext.sub(pos);
      if (tNext.lengthSq() > 1e-8) {
        const up = tB.copy(pos).normalize();
        this.m.lookAt(tNext.normalize(), ORIGIN, up);
        qTo.setFromRotationMatrix(this.m);
        a.group.quaternion.copy(qTo).slerp(landQ, smooth01((k - 0.7) / 0.3));
      }
    }
    // a little bob and tilt in the air
    a.group.translateY(Math.sin(t * 40) * len * 0.03 * air);
    a.group.rotateZ(Math.sin(t * 17) * 0.06 * air);
    a.group.rotateX(-0.55 * air);
    const wings = t < 0.72 ? 1 : 1 - smooth01((t - 0.72) / 0.14);
    const cases = t < 0.86 ? 1 : 1 - smooth01((t - 0.86) / 0.14);
    this.poseWings(fly, cases, wings);
    const alpha = smooth01(t / 0.1); // no sudden pop
    for (const m of fly.mats) {
      m.transparent = alpha < 1 || m === fly.mats[2];
      m.opacity = m === fly.mats[2] ? 0.4 * alpha : alpha;
    }
  }

  /** cases: the wing cases open 0…1 (they swing up and out from the seam); wings: the flying wings out and whirring. */
  private poseWings(fly: NonNullable<AntMesh['fly']>, cases: number, wings: number) {
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      fly.elytra[i].rotation.set(0.5 * cases, 0.25 * s * cases, 0.75 * s * cases);
    }
    fly.seam.visible = cases < 0.02;
    const now = performance.now();
    const flap = Math.sin(now * 0.09);
    const sweep = Math.cos(now * 0.09);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      const w = fly.wings[i];
      w.visible = wings > 0.03;
      w.rotation.set(0, s * (-1.3 * (1 - wings) + 0.25 * sweep * wings), s * (0.15 + 0.85 * flap) * wings);
      w.scale.set(Math.max(0.05, wings), 1, 1);
    }
  }

  /** Hide and seek: a worm inside sees only critters in the passages, a worm on the skin only those outside. */
  setInside(inside: boolean) {
    this.inside = inside;
  }

  /** How many critters of `kind` hold the worm `id`. */
  attachedTo(id: string, kind: Kind = ANT) {
    return this.snaps.filter((s) => s[1] === HOLD && s[8] === id && s[11] === kind).length;
  }

  /** Is a spider taunting worm `id` (legs up at it)? */
  spiderTaunting(id: string) {
    return this.snaps.some((s) => s[11] === SPIDER && s[1] === WANDER && s[10] === 1 && s[8] === id);
  }

  /** Ants on worm `id`'s ends: + those on the head end, − those on the tail (which way they drag). */
  dragBalance(id: string) {
    let n = 0;
    for (const s of this.snaps) if (s[1] === HOLD && s[8] === id && s[11] === ANT && atEnd(s[9])) n += s[9] >= N >> 1 ? 1 : -1;
    return n;
  }

  /** Critters on the skin a worm can bump into (not those holding worm `id`, not ones flying in or off, not the chafer). */
  critters(id: string) {
    const out: { p: THREE.Vector3; r: number; kind: Kind }[] = [];
    const now = performance.now();
    for (const a of this.ants.values()) {
      const s = a.snap;
      if (s[12] || s[1] === SLAPPED || s[1] === KNOCKED || s[1] === CARRIED || (s[1] === HOLD && s[8] === id)) continue;
      if ((s[11] === EARWIG && now - a.born < 1800) || s[11] === CHAFER || (s[11] === LADYBUG && now - a.born < 2200)) continue;
      out.push({ p: a.p, r: SPECS[s[11]].len * 0.42, kind: s[11] });
    }
    return out;
  }

  /** Ants on worm `id`'s head end. */
  antsOnHead(id: string) {
    return this.snaps.filter((s) => s[1] === HOLD && s[8] === id && s[11] === ANT && s[9] >= 7).length;
  }

  /** The earwig's pincer tip near p, while it holds a worm (to hang the worm from): tip, its side and up. */
  earwigGrip(p: THREE.Vector3) {
    let best: AntMesh | null = null;
    let bd = 8;
    for (const a of this.ants.values()) {
      if (a.snap[11] !== EARWIG || a.snap[9] !== 5 || !a.earwig || !a.gripAt) continue;
      const d = a.group.position.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (!best?.earwig) return null;
    const s = SPECS[EARWIG].len / 1.06;
    best.group.updateMatrixWorld(true);
    const tip = best.earwig.pincers.localToWorld(new THREE.Vector3(0, 0.02 * s, -0.19 * s));
    const up = best.group.position.clone().normalize();
    return { tip, side: new THREE.Vector3().crossVectors(up, best.f).normalize(), up };
  }

  /** Upturned ladybugs just flipped (dazed: stars over them). */
  dazed() {
    const out: { id: number; at: THREE.Vector3; up: THREE.Vector3; len: number }[] = [];
    for (const a of this.ants.values()) {
      const s = a.snap;
      if (s[11] === LADYBUG && s[1] === UPTURNED && s[9] === 1 && a.group.visible) out.push({ id: s[0], at: a.group.position, up: tA.copy(a.p).normalize().clone(), len: SPECS[LADYBUG].len });
    }
    return out;
  }

  chaferAt() {
    for (const a of this.ants.values()) if (a.snap[11] === CHAFER) return a.group.position;
    return null;
  }

  /** The chafer's id if it's free (no rider) and within d of p. */
  chaferNear(p: THREE.Vector3, d: number) {
    for (const a of this.ants.values()) if (a.snap[11] === CHAFER && !a.snap[8] && a.group.position.distanceTo(p) < d) return a.snap[0];
    return null;
  }

  /** Where the rider `id` sits on the chafer: the seat, its heading and up, and whether it's running. */
  chaferSeat(id: string) {
    for (const a of this.ants.values()) {
      if (a.snap[11] !== CHAFER || a.snap[8] !== id) continue;
      const len = SPECS[CHAFER].len;
      a.group.updateMatrixWorld(true);
      const at = a.group.localToWorld(new THREE.Vector3(0, 0.33 * len, 0.16 * len));
      const up = new THREE.Vector3(0, 1, 0).transformDirection(a.group.matrixWorld);
      return { at, f: new THREE.Vector3(0, 0, 1).transformDirection(a.group.matrixWorld), up, running: a.snap[1] === CHASE };
    }
    return null;
  }

  /** A ladybug holding `id` wagging it: which end, and how far (the stronger of two). */
  ladybugShake(id: string) {
    let best: AntSnap | null = null;
    for (const s of this.snaps) if (s[1] === HOLD && s[8] === id && s[11] === LADYBUG && (!best || Math.abs(s[10]) > Math.abs(best[10]))) best = s;
    return best ? { end: best[9] === 0 ? 'tail' : 'head', v: best[10] } : null;
  }

  /** Where the ladybug holding `id` by that end is drawn. */
  ladybugAt(id: string, end: 'head' | 'tail') {
    for (const a of this.ants.values()) {
      const s = a.snap;
      if (s[1] === HOLD && s[8] === id && s[11] === LADYBUG && (s[9] === 0 ? 'tail' : 'head') === end) return a.p;
    }
    return null;
  }

  /** Two ladybugs hold `id`, one at each end. */
  ladybugsBoth(id: string) {
    return this.snaps.filter((s) => s[1] === HOLD && s[8] === id && s[11] === LADYBUG).length >= 2;
  }

  /** Which end of worm `id` a ladybug holds: 'head', 'tail' or null. */
  ladybugGrip(id: string): 'head' | 'tail' | null {
    const s = this.snaps.find((x) => x[1] === HOLD && x[8] === id && x[11] === LADYBUG);
    return s ? (s[9] === 0 ? 'tail' : 'head') : null;
  }

  update(dt: number, wormBody: (id: string) => Body | null, passage: (id: string) => THREE.Vector3[] | undefined = () => undefined) {
    const k = 1 - Math.exp(-12 * dt);
    for (const a of this.ants.values()) {
      const s = a.snap;
      const len = SPECS[s[11]].len;
      const body = s[1] === HOLD ? wormBody(s[8]) : null;
      let sink = 0; // how far its middle sinks below the curved skin (a long body on a round fruit)
      let skin: number | undefined;
      if (s[1] === HOLD && a.lastState !== HOLD) {
        a.attachFrom = a.p.clone();
        a.attachT = 0;
        a.attachFace = a.f.clone();
      }
      if (s[1] !== HOLD) a.holdF = undefined;
      a.lastState = s[1];
      if (body) {
        const i = s[9];
        const ball = body.disp[i];
        this.up.copy(ball).normalize();
        this.side.subVectors(body.disp[Math.min(N - 1, i + 1)], body.disp[Math.max(0, i - 1)]).normalize();
        a.f.copy(this.side);
        const r = RADII[i] * girth(body.size);
        if (s[11] === LADYBUG) {
          // standing on the skin past the worm's end, facing it, the end ball in its jaws
          if (i === 0) a.f.negate(); // f: out of the body through that end
          a.f.addScaledVector(this.up, -a.f.dot(this.up)).normalize();
          // two ladybugs on one worm: each stands away from the other
          for (const b of this.ants.values()) {
            if (b === a || b.snap[1] !== HOLD || b.snap[8] !== s[8] || b.snap[11] !== LADYBUG) continue;
            tA.subVectors(ball, b.p).addScaledVector(this.up, -tA.dot(this.up));
            if (tA.lengthSq() > 1e-6) a.f.copy(tA.normalize());
          }
          const jaws = this.v.copy(ball).addScaledVector(this.up, -r).addScaledVector(a.f, r * 0.4 + 0.12 * len);
          a.holdF = a.holdF ? a.holdF.lerp(a.f, 1 - Math.exp(-2.5 * dt)).normalize() : a.attachFace ? a.attachFace.clone().negate() : a.f.clone();
          a.holdF.addScaledVector(this.up, -a.holdF.dot(this.up)).normalize();
          a.p.copy(jaws).addScaledVector(a.holdF, 0.28 * len);
          a.f.lerp(a.holdF, 0.5).normalize().negate(); // looks back at the worm
        } else if (atEnd(i)) {
          // an ant on an end: hanging on to it from the skin beyond it (or the passage floor), pulling
          const end = i >= N >> 1 ? body.disp[N - 1] : body.disp[0];
          const er = RADII[i >= N >> 1 ? N - 1 : 0] * girth(body.size);
          this.up.copy(end).normalize();
          a.f.subVectors(end, i >= N >> 1 ? body.disp[N - 2] : body.disp[1]);
          if (s[12]) {
            a.f.normalize();
            this.up.addScaledVector(a.f, -this.up.dot(a.f)).normalize();
          } else a.f.addScaledVector(this.up, -a.f.dot(this.up)).normalize();
          this.v.crossVectors(this.up, a.f).normalize();
          a.p
            .copy(end)
            .addScaledVector(this.up, s[12] ? -0.6 * er : -er)
            .addScaledVector(a.f, 0.45 * len + 0.5 * er)
            .addScaledVector(this.v, s[10] * len * (s[12] ? 0.2 : 0.45));
          a.f.negate().applyAxisAngle(this.up, -0.3 * s[10]);
        } else {
          // on the worm's back: around the ball, away from the fruit
          this.side.cross(this.up).normalize();
          this.v.copy(this.up).multiplyScalar(Math.cos(s[10])).addScaledVector(this.side, Math.sin(s[10]));
          a.p.copy(ball).addScaledVector(this.v, r + 0.05);
          this.up.copy(this.v);
        }
      } else if (s[12] && passage(s[13])) {
        // in a passage: slide along the passage itself, on its floor
        const pts = passage(s[13])!;
        // glide along the passage between snapshots; only a real jump (a new passage) snaps
        a.tpos = a.tun !== s[13] || Math.abs(s[14] - a.tpos) > 80 ? s[14] : a.tpos + (s[14] - a.tpos) * k;
        a.tun = s[13];
        const i = Math.max(0, Math.min(pts.length - 2, Math.floor(a.tpos)));
        a.p.lerpVectors(pts[i], pts[i + 1], Math.min(1, Math.max(0, a.tpos - i)));
        a.f.lerp(this.v.set(s[5], s[6], s[7]), k).normalize();
        this.up.copy(a.p).normalize();
        this.up.addScaledVector(a.f, -this.up.dot(a.f)).normalize();
        a.p.addScaledVector(this.up, -0.1);
      } else {
        this.v.set(s[2], s[3], s[4]);
        a.p.lerp(this.v, k);
        a.f.lerp(this.v.set(s[5], s[6], s[7]), k).normalize();
        this.up.copy(a.p).normalize();
        if (!s[12] && Math.abs(appleF(a.p)) < 0.3) {
          appleNormal(a.p, this.up);
          // a rigid body this long on a ball this round sinks a little in the middle (its ends touch);
          // the earwig bends its abdomen along the skin instead, so it stands just on its legs
          sink = s[11] === EARWIG ? 0.04 : (0.5 * len) ** 2 / (2 * R0);
          skin = sink;
        }
        if (s[12]) {
          // inside (the drilling earwig): walk on the floor (towards the fruit's center)
          this.up.addScaledVector(a.f, -this.up.dot(a.f)).normalize();
          sink = s[11] === EARWIG ? 0.07 * len + 0.03 : 0.1;
        }
      }
      if (body && a.attachFrom) {
        // grabbing: a quick glide (a ladybug: a little lunge) from where it was onto the worm
        a.attachT = Math.min(1, (a.attachT ?? 1) + dt / 0.3);
        const e = a.attachT * a.attachT * (3 - 2 * a.attachT);
        const to = tB.copy(a.p);
        a.p.lerpVectors(a.attachFrom, to, e);
        if (s[11] === LADYBUG) a.p.addScaledVector(a.f, 0.22 * len * Math.sin(Math.PI * a.attachT));
        if (a.attachT >= 1) a.attachFrom = undefined;
      }
      a.group.visible = s[12] === +!!this.inside;
      const knocked = s[1] === FLEE && s[10] > 0 && s[10] < 1 ? s[10] : 0; // swatted: flying through the air
      const feelersUp = s[11] === ANT && s[1] === WANDER && s[10] === 1; // milling / guarding
      a.group.position.copy(a.p).addScaledVector(this.up, 0.03 - sink);
      a.skin = s[12] ? undefined : skin;
      // legs step as far as the critter moves (still when it stops); holding on / carrying they scramble
      const moved = a.group.userData.prev ? a.group.position.distanceTo(a.group.userData.prev) : 0;
      a.group.userData.prev = a.group.position.clone();
      a.phase +=
        s[1] === HOLD || s[1] === CARRY ? dt * 4 : s[1] === CARRIED ? dt * 9 : s[1] === QUARREL && s[11] === ANT ? dt * 1.4 : Math.min(moved, 0.3) / (len * STRIDE[s[11]]);
      a.feelers += dt;
      this.m.lookAt(a.f, ORIGIN, this.up);
      a.group.quaternion.setFromRotationMatrix(this.m);
      // struck (swatted, a ladybug knocked, upturned, flying off its back): show the hit once
      const struck = knocked > 0 || (s[11] === LADYBUG && (s[1] === KNOCKED || s[1] === UPTURNED || (s[1] === SLAPPED && s[9] === 99)));
      if (struck && !a.struck) this.onBite?.(a.group.position.clone().addScaledVector(this.up, 0.25 * len), Math.max(len, 0.5) * 0.9, 'strokes', a.group.position);
      a.struck = struck;
      if (knocked) {
        // an arc through the air (an ant tumbles, spinning; in a passage only a little hop)
        const ant = s[11] === ANT;
        a.group.position.addScaledVector(this.up, Math.sin(knocked * Math.PI) * (ant ? len * (s[12] ? 0.4 : 2.2) : s[11] === SPIDER ? 0.5 * len : 0.12 * len));
        if (ant) a.group.rotateZ(knocked * Math.PI * 2);
        if (ant && s[12]) a.group.rotateX(knocked * Math.PI * 4);
      }
      if (s[1] === FLUNG) {
        // flung by the chafer: a pop, then it tumbles away and fades
        if (!a.flungShown) {
          this.onBite?.(a.group.position.clone(), len * 1.6, 'pop', a.group.position);
          a.fade = [];
          a.group.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mat = (mesh.material as THREE.Material).clone();
            mat.transparent = true;
            mesh.material = mat;
            mesh.castShadow = false;
            a.fade!.push(mat);
          });
        }
        a.flungShown = true;
        const t = s[10];
        const spin = 0.5 + (s[0] % 5) * 0.125;
        a.group.rotateX(t * Math.PI * 2 * spin);
        a.group.rotateZ(t * (s[0] % 2 ? 0.6 : -0.6));
        const f = Math.min(1, Math.max(0, (t - 0.2) / 0.8));
        const alpha = 1 - f * f * (3 - 2 * f);
        for (const m of a.fade ?? []) m.opacity = alpha;
      }
      // on its back: rolls over (and rocks, legs waving)
      const upturned = (s[11] === SPIDER || s[11] === LADYBUG) && s[1] === UPTURNED;
      a.roll = Math.max(0, Math.min(1, (a.roll ?? 0) + (upturned ? dt : -dt) / 0.25));
      if (a.roll > 0) {
        const e = a.roll * a.roll * (3 - 2 * a.roll);
        a.group.rotateZ(Math.PI * e + (upturned ? 0.15 * Math.sin(a.feelers * 6 + s[0]) * e : 0));
        a.group.translateY(-len * (s[11] === LADYBUG ? (s[10] === 1 ? 0.5 : 0.4) : 0.32) * e);
      }
      if (s[11] === SPIDER && s[1] === WANDER && s[10] === 1) {
        // a spider rearing up, front legs raised (taunted, sparring, scolding)
        const b = Math.abs(Math.sin(a.feelers * 9 + s[0]));
        a.group.translateY(b * len * 0.12);
        a.group.rotateX(-0.35 - 0.12 * b);
      }
      if (s[11] === ANT && s[1] === QUARREL) {
        // an ant quarrelling: up on its hind legs, bobbing
        const b = Math.abs(Math.sin(a.feelers * 7 + s[0]));
        a.group.translateY(len * (0.1 + 0.06 * b));
        a.group.rotateX(-0.5 - 0.12 * b);
      }
      if (feelersUp) {
        const b = Math.max(0, Math.sin(a.feelers * 11 + s[0]));
        a.group.translateY(b * b * len * 0.18);
        a.group.rotateX(-0.25 - 0.15 * b);
      }
      // a little bounce in the step
      if (moved > 1e-4 && s[1] !== HOLD && s[11] !== CHAFER) a.group.translateY(Math.abs(Math.sin(a.phase * Math.PI * 2)) * len * (s[11] === SPIDER ? 0.03 : 0.02));
      if (s[11] === CHAFER && s[1] === CHASE && moved > 1e-4) a.group.translateY(Math.abs(Math.sin(a.phase * 0.85)) * len * 0.05);
      this.poseLegs(a, len, s[11]);
      if ((s[11] === ANT || s[11] === SPIDER || s[11] === CHAFER) && a.born > 0) {
        // a new one pops up out of the skin
        const t = (performance.now() - a.born) / 1000 / 0.7;
        if (t < 1) {
          const e = 1 - (1 - t) ** 3;
          a.group.translateY(-(1 - e) * len * 0.35);
          a.group.scale.setScalar(Math.max(0.001, 0.25 + 0.75 * e));
          a.group.rotateZ(Math.sin(t * 18) * 0.12 * (1 - t));
        } else if (a.group.scale.x !== 1) a.group.scale.setScalar(1);
      }
      if (s[11] === EARWIG) this.poseEarwig(a, len, s, wormBody);
      if (s[11] === CHAFER) {
        // spurred (seg 4 / 5, flipping each time): strokes and a jolt
        const spur = s[9] === 4 || s[9] === 5 ? s[9] : 0;
        if (spur && a.spurShown !== spur) {
          this.onBite?.(a.group.position.clone().addScaledVector(this.up, 0.35 * len).addScaledVector(a.f, -(0.3 * len)), len * 0.9, 'strokes', a.group.position);
          a.spurAt = performance.now();
        }
        a.spurShown = spur;
        const j = a.spurAt !== undefined ? (performance.now() - a.spurAt) / 1000 / 0.25 : 1;
        if (j < 1) a.group.translateY(Math.sin(Math.PI * j) * len * 0.15);
        // bitten (it bolts): a pop and a rear-up
        if ((s[9] === 1 || spur) && a.bitAt === undefined) {
          a.bitAt = performance.now();
          this.onBite?.(a.group.position.clone().addScaledVector(this.up, 0.4 * len), len * 1.1, 'pop', a.group.position);
        }
        if (s[9] !== 1 && !spur) a.bitAt = undefined;
        // lashed (it moves off): strokes
        if (s[9] === 3 && !a.lashShown) this.onBite?.(a.group.position.clone().addScaledVector(this.up, 0.35 * len), len * 0.9, 'strokes', a.group.position);
        a.lashShown = s[9] === 3;
        const b = a.bitAt !== undefined ? (performance.now() - a.bitAt) / 1000 / 0.45 : 1;
        if (b < 1) {
          a.group.translateY(Math.sin(Math.PI * b) * len * 0.45);
          a.group.rotateX(-0.35 * Math.sin(Math.PI * b));
        }
      }
      if (s[1] === CARRIED) {
        // in the earwig's pincers: a spider twitches, a ladybug tugs (wings out)
        if (s[11] === SPIDER) a.group.translateY(Math.abs(Math.sin(a.feelers * 13)) * len * 0.08);
        if (s[11] === LADYBUG && a.fly) {
          const tug = Math.max(0, s[10]);
          a.group.translateY(tug * len * 0.7);
          a.group.rotateX(-0.4 * tug);
          this.poseWings(a.fly, tug > 0.05 ? 1 : 0.3, +(tug > 0.05));
        }
      }
      if (s[11] === LADYBUG) {
        if (s[1] === KNOCKED) this.hop(a, len, s[10]);
        else if (s[1] !== SLAPPED) this.flyIn(a);
        // quarrelling: each round it's had enough, a pop
        if (s[1] === QUARREL && s[9] > (a.bites ?? 0)) this.onBite?.(a.group.position.clone().addScaledVector(this.up, 0.3 * len), len * 0.7, 'pop', a.group.position);
        a.bites = s[1] === QUARREL ? s[9] : 0;
        if (s[1] === SLAPPED) this.flyOff(a, len);
      }
    }
  }

  private make(s: AntSnap): AntMesh {
    const group = new THREE.Group();
    let fly: AntMesh['fly'];
    let earwig: EarwigModel | undefined;
    const L = SPECS[s[11]].len;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x * L, y * L, z * L);
      m.scale.set(sx * L, sy * L, sz * L);
      group.add(m);
      return m;
    };
    if (s[11] === LADYBUG) {
      // its own materials (it fades in as it flies in): a textured shell for each wing case, a glossy black body
      const [texL, texR] = shellTextures();
      const shellL = ladybugShellMat(texL);
      const shellR = ladybugShellMat(texR);
      const black = ladybugBodyMat();
      const membrane = wingMat.clone();
      // two red wing cases (the dome's halves) hinged along the top seam, the spots painted on
      const elytra: THREE.Group[] = [];
      for (const sideX of [-1, 1]) {
        const hinge = new THREE.Group();
        hinge.position.set(0.02 * sideX * L, 0.3 * L, 0.2 * L);
        group.add(hinge);
        const half = new THREE.Mesh(sideX < 0 ? domeLeft : domeRight, sideX < 0 ? shellL : shellR);
        half.position.set(-0.016 * sideX * L, -0.26 * L, -0.28 * L); // a hair apart: the seam shows
        half.scale.set(0.35 * L, 0.32 * L, 0.38 * L);
        hinge.add(half);
        elytra.push(hinge);
      }
      const body = new THREE.Mesh(ladybugBodyGeometry(), black);
      body.scale.setScalar(L);
      group.add(body);
      const seamMesh = add(seam, black, 0, 0, 0, 1, 1, 1); // the seam between the wing cases
      // thin see-through flying wings, folded away under the cases
      const wings: THREE.Group[] = [];
      for (const sideX of [-1, 1]) {
        const root = new THREE.Group();
        root.position.set(sideX * 0.05 * L, 0.28 * L, 0.12 * L);
        group.add(root);
        const w = new THREE.Mesh(wingShape, membrane);
        w.scale.set(sideX * 0.85 * L, 1, 0.42 * L);
        w.rotation.y = -sideX * 0.35;
        root.add(w);
        root.visible = false;
        wings.push(root);
      }
      fly = { elytra, wings, seam: seamMesh, mats: [shellL, black, membrane, shellR] };
    } else if (s[11] === CHAFER) {
      // the rose chafer: metallic green, iridescent, white flecks on its wing cases
      group.add(critterBody('chafer', L));
    } else if (s[11] === EARWIG) {
      earwig = makeEarwig(L / 1.06);
      group.add(earwig.group);
    } else if (s[11] === SPIDER) {
      group.add(critterBody('spider', L));
    } else {
      group.add(critterBody('ant', L));
    }
    // legs (and feelers): instanced tapering bones
    const legMat = s[11] === LADYBUG ? LEG_MATS.ladybug : s[11] === SPIDER ? LEG_MATS.spider : s[11] === CHAFER ? LEG_MATS.chafer : LEG_MATS.ant;
    const legs = new THREE.InstancedMesh(legGeo, legMat, MAX_BONES);
    legs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // a shade per segment (from the start: the shader has to know there are instance colours)
    legs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BONES * 3).fill(1), 3);
    legs.frustumCulled = false;
    legs.count = 0;
    group.add(legs);
    const joints = new THREE.InstancedMesh(jointGeo, legMat, MAX_BONES);
    joints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    joints.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BONES * 3).fill(1), 3);
    joints.frustumCulled = false;
    joints.count = 0;
    group.add(joints);
    this.group.add(group);
    group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    return {
      group,
      legs,
      joints,
      p: new THREE.Vector3(s[2], s[3], s[4]),
      f: new THREE.Vector3(s[5], s[6], s[7]),
      snap: s,
      phase: Math.random() * 6,
      feelers: Math.random() * 6,
      tpos: s[14] ?? 0,
      born: performance.now(),
      fly,
      earwig,
    };
  }

  /**
   * Legs by inverse kinematics: each foot steps (stance, then a lifted swing) and the knee bends out
   * between hip and foot; plus the feelers. Special poses: on its back legs wave; a spider rearing up,
   * an ant quarrelling lift their front legs.
   */
  private poseLegs(a: AntMesh, L: number, kind: Kind) {
    if (kind === EARWIG) return; // its own legs (poseEarwig)
    let n = 0;
    /** One leg segment, its shade (× the leg colour: a spider's legs are banded, joints darker). */
    const bone = (from: THREE.Vector3, to: THREE.Vector3, r: number, shade = 1) => {
      bDir.subVectors(to, from);
      const len = bDir.length();
      if (len < 1e-6) return;
      bMid.addVectors(from, to).multiplyScalar(0.5);
      bQ.setFromUnitVectors(UP, bDir.divideScalar(len));
      bScale.set(r * L, len, r * L);
      a.legs.setMatrixAt(n, bM.compose(bMid, bQ, bScale));
      a.legs.setColorAt(n, bShade.setScalar(shade));
      a.joints.setMatrixAt(n, bM.compose(from, bQ, bScale.setScalar(r * L * 1.05)));
      a.joints.setColorAt(n++, bShade);
    };
    const spider = kind === SPIDER;
    const specs = spider ? SPIDER_LEGS : kind === LADYBUG ? LADYBUG_LEGS : kind === CHAFER ? CHAFER_LEGS : ANT_LEGS;
    const phase = a.phase;
    const antUp = kind === ANT && (a.snap[1] === QUARREL || (a.snap[1] === WANDER && a.snap[10] === 1));
    const frontUp = (spider && a.snap[10] === 1) || antUp;
    const onBack = (spider || kind === LADYBUG) && a.snap[1] === UPTURNED;
    const calm = onBack && kind === LADYBUG && a.snap[9] === 1; // just flipped: dazed, hardly moving
    for (const leg of specs) {
      for (const sd of [-1, 1]) {
        const p = (((phase + leg.offset + (sd > 0 ? 0 : 0.5)) % 1) + 1) % 1;
        let dz: number;
        let lift = 0;
        if (onBack) {
          const w = a.feelers * (calm ? 2.5 : 13 + specs.indexOf(leg) * 1.7) + (sd > 0 ? 0 : Math.PI) + specs.indexOf(leg) * 1.3;
          dz = Math.sin(w) * (calm ? 0.03 : 0.12);
          lift = (calm ? 0.18 : 0.3) + Math.sin(w * 1.4) * (calm ? 0.04 : 0.2);
        } else if (frontUp && (leg === specs[0] || (!antUp && leg === specs[1]))) {
          const first = leg === specs[0];
          const w = a.feelers * (first ? 15 : 11) + (sd > 0 ? 0 : Math.PI) + (first ? 0 : 1.7);
          dz = (first ? 0.16 : 0.02) + 0.15 * Math.sin(w);
          lift = (first ? 0.4 : 0.24) + 0.18 * Math.sin(w * 1.3);
        } else if (p < 0.55) dz = leg.stride * (0.5 - p / 0.55); // stance: the foot slides back
        else {
          const t = (p - 0.55) / 0.45; // swing: lifted and brought forward
          dz = leg.stride * (-0.5 + t);
          lift = Math.sin(Math.PI * t) * leg.lift;
        }
        const hip = lHip.set(sd * leg.hip[0], leg.hip[1], leg.hip[2]).multiplyScalar(L);
        const foot = lFoot.set(sd * leg.foot[0], lift, leg.foot[2] + dz).multiplyScalar(L);
        // on the round fruit the skin falls away from under its middle: the foot reaches down to it
        if (a.skin !== undefined) foot.y += a.skin - 0.03 - (foot.x * foot.x + foot.z * foot.z) / (2 * R0);
        const ankle = lAnkle.set(foot.x - sd * leg.tarsus * 0.35 * L, foot.y + leg.tarsus * L, foot.z);
        const a1 = leg.thigh * L;
        const a2 = leg.shin * L;
        lReach.subVectors(ankle, hip);
        let d = lReach.length();
        if (d > (a1 + a2) * 0.98) {
          lReach.multiplyScalar(((a1 + a2) * 0.98) / d);
          ankle.copy(hip).add(lReach);
          d = lReach.length();
        }
        lReach.divideScalar(d);
        const along = (a1 * a1 - a2 * a2 + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, a1 * a1 - along * along));
        lOut.set(sd * leg.kneeOut, 1, 0);
        lOut.addScaledVector(lReach, -lOut.dot(lReach)).normalize();
        const knee = lKnee.copy(hip).addScaledVector(lReach, along).addScaledVector(lOut, h);
        bone(hip, knee, leg.r, 1);
        bone(knee, ankle, leg.r * 0.75, spider ? 0.55 : 0.8);
        bone(ankle, foot, leg.r * 0.5, spider ? 0.85 : 0.65);
      }
    }
    if (!spider) {
      // feelers: a ladybug's and the chafer's are short and straight, an ant's elbowed
      const short = kind === LADYBUG || kind === CHAFER;
      for (const sd of [-1, 1]) {
        const w = a.feelers * (sd > 0 ? 9.3 : 7.7);
        const wig = 0.04 * Math.sin(w) + 0.02 * Math.sin(w * 2.3); // they always feel around
        if (short) {
          bone(lHip.set(0.05 * sd, 0.09, 0.42).multiplyScalar(L), lKnee.set(sd * (0.1 + 0.5 * wig), 0.1 + 0.3 * wig, 0.5).multiplyScalar(L), 0.006);
          continue;
        }
        const root = lHip.set(0.03 * sd, 0.13, 0.38).multiplyScalar(L);
        const elbow = lAnkle.set(0.07 * sd, 0.25, 0.43).multiplyScalar(L);
        const tip = lKnee.set(sd * (0.15 + wig), 0.22 + 0.5 * wig, 0.38 + 0.2 + 0.03 * Math.cos(w * 0.7)).multiplyScalar(L);
        bone(root, elbow, 0.009);
        bone(elbow, tip, 0.007);
      }
    }
    a.legs.count = a.joints.count = n;
    for (const m of [a.legs, a.joints]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
