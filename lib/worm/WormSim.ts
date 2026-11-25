import * as THREE from 'three';
import { appleF, appleNormal, appleProject, pushOutOfPit, R0 } from '@/lib/apple';
import { Trail } from './Trail';
import {
  CYCLE, girth, DIG_SPEED, GROWTH_MAX, GROWTH_PER_DIAMETER, HOLE_R0, L0, LC0, N, PULSE_TIME, PULSE_WIDTH,
  SEG_R0, STRAIGHT_HOLD, TUNNEL_R0, TUNNEL_STEP, WIN_SIZE_GAIN, damp, ease, r3, winProgress,
} from './constants';

/** What drives a worm this frame (the player's keys or a bot's brain). */
export type SimInput = {
  turn: number; // radians this frame, + = left
  pitch: number; // radians this frame, + = up (inside only)
  forward: boolean;
  speed?: number; // extra speed factor (a water drop, panic…), 1 = normal
  rear: boolean; // stand up on the tail (on the skin only)
};

export type SimEvents = {
  tunnelStart?: (radius: number) => void;
  tunnelPoint?: (p: THREE.Vector3) => void;
  tunnelEnd?: () => void;
  hole?: (h: number[]) => void; // [x, y, z, nx, ny, nz, radius]
  flown?: () => void; // the victory flight is over, the worm starts again small
  /** A strike landed: at the tip of the lashing end (kind: 'slam', 'bite', 'swat'; none = a whip / a clap). */
  impact?: (at: THREE.Vector3, kind?: string) => void;
  down?: () => void; // arena: no life left
  pitCrash?: (at: THREE.Vector3) => void; // gnawed into a peach pit
};

/** Something holding this worm by an end and wagging it: which end, how far (−1…1), the pivot's distance, both ends held. */
export type Wag = { end: 'head' | 'tail'; v: number; reach?: number; both?: boolean };
/** Where the earwig's pincers hold it: their tip, sideways and up there. */
export type HeldAt = { tip: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3 };
/** Riding the chafer: the seat, its heading and up, and whether it's running. */
export type RideAt = { at: THREE.Vector3; f: THREE.Vector3; up: THREE.Vector3; running: boolean };

// victory flight timeline (seconds)
const FLY_RISE = 1.2; // rise above the fruit, straightening up
const FLY_GO = 3.2; // wings out + two flaps until here, then off it goes
const FLY_END = 4.4;
const SHAKE_TIME = 0.28;
const WHIP_TIME = 0.42;
const WHIP_HIT = 0.1596; // whipT when the lash lands
const SWIPE_TIME = 0.36;
const RUN = 2; // the worm's pace: what used to be the Shift boost
const JUMP_TIME = 0.64;
const JUMP_DIST = 1.5; // body lengths forward
const JUMP_H = 0.72; // body lengths up
const LAND_TIME = 0.4; // the bounce after a landing
const SQUEEZE_TIME = 0.3;
const HOP_TIME = 1; // a hop on the tail (standing)
const FLIP_TIME = 0.6; // a backflip off a jump
const SWAT_TIME = 0.34; // a swat from above with the tail (at a critter)
const LUNGE_TIME = 0.34; // a bite with a lunge of the head
const SLAM_TIME = 1.62; // slamming a ladybug against the skin (a big worm)
const SLAM_HIT = 0.446; // …when it hits
const CLAP_TIME = 0.45; // both ends held: clap them together
const LEAP_TIME = 1.3; // out of the fruit after a rocket: up, a pause, down head first
const LEAP_CALM = 1.05; // …a gentle one (it came up slowly)
const STRIKE_TIME = 0.45; // arena: up and down head first, straight through the fruit
const EMERGE_TIME = 0.8; // a new round: it comes up out of the skin
const RIDE_LASH = 0.35;
const RIDE_FLIP = 0.92; // the chafer stopped: the rider somersaults forward off its back onto it
const DIG_ANGLE = 0.7; // burrowing in: the head goes in at ~40°
const SWEEP_TIME = 0.42 + 0.9; // slamAt(): the strike, then holding

const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

// scratch vectors
const sPrev = new THREE.Vector3();
const sA = new THREE.Vector3();
const sB = new THREE.Vector3();
const sC = new THREE.Vector3();
const slamBase = new THREE.Vector3();
const slamUp = new THREE.Vector3();
const slamOut = new THREE.Vector3();
const slamSide = new THREE.Vector3();
const slamDir = new THREE.Vector3();
const slamTo = new THREE.Vector3();
const slamWas: THREE.Vector3[] = [];
const swRoot = new THREE.Vector3();
const swUp = new THREE.Vector3();
const swAim = new THREE.Vector3();
const swHigh = new THREE.Vector3();
const swHit = new THREE.Vector3();
const swTip = new THREE.Vector3();
const swN = new THREE.Vector3();
const swDir = new THREE.Vector3();
const swArm = new THREE.Vector3();
const swSide = new THREE.Vector3();
const swBow = new THREE.Vector3();
const swCtrl = new THREE.Vector3();
const flAxis = new THREE.Vector3();
const flN = new THREE.Vector3();
const flMid = new THREE.Vector3();
const flA = new THREE.Vector3();
const flB = new THREE.Vector3();
const flUp = new THREE.Vector3();

/**
 * One worm's body and movement on / inside the fruit:
 * inchworm crawl on the skin, snake-like gnawing inside, rearing up, growth and the swallowing wave;
 * jumps, hops on the tail, backflips, dives back into the fruit like a dolphin, rockets out of it;
 * lashes, swats, bites and slams; riding the chafer; held by the earwig.
 * disp[] / ups[] are the smoothed ball positions to draw.
 */
export class WormSim {
  mode: 'surface' | 'dig' | 'fly' = 'surface';
  /** seconds into the victory flight, -1 = not flying */
  fx = -1;
  private readonly flyBase = new THREE.Vector3();
  private readonly flyUp = new THREE.Vector3();
  private readonly flyDir = new THREE.Vector3();
  private readonly flyOff = new THREE.Vector3();
  growth: number;
  L = 0;
  LC = 0;
  SEG_R = 0;
  SPACING = 0;

  // skin
  readonly pS = new THREE.Vector3(); // contact point
  readonly n = new THREE.Vector3(); // skin normal
  readonly f = new THREE.Vector3(); // heading
  private phase = 0;
  private tailDist = 0;
  // inside
  readonly p = new THREE.Vector3(); // head center
  readonly d = new THREE.Vector3(); // heading
  readonly u = new THREE.Vector3(); // up
  private readonly right = new THREE.Vector3();
  private travel = 0;
  private entered = false;
  private sinceEntry = 0;
  private lastTunnelPt: THREE.Vector3 | null = null;

  wave = -1; // swallowing wave position (balls from the head), -1 = none
  private shakeT = 0; // a jerk to throw ants off: nose and tail swing to one side (a "C")
  private shakeSide = 1;
  private squeezeT = 0; // inside a passage: a jerk along the body, shrink and stretch back
  private jumpT = 0; // a spring hop forward off the tail
  private landT = 0; // the bounce after landing
  private landHump = false; // …after a backflip: the middle bounces
  private flipT = 0; // a backflip
  private readonly flipF = new THREE.Vector3();
  private readonly flipN = new THREE.Vector3();
  private hopT = 0; // standing on the tail: a hop
  private hopFwd = false;
  private pulledBack = false; // dragged back along its passage: a new tunnel if it then gnaws elsewhere
  private swipeT = 0; // a tail swipe to one side
  private swatT = 0; // a swat from above at a critter
  private readonly swatAim = new THREE.Vector3();
  private readonly swatQueue: THREE.Vector3[] = []; // more critters to swat, one after the other
  private lungeT = 0;
  private readonly lungeAt = new THREE.Vector3();
  private swipeSide = 1;
  private whipT = 0; // a lash at a ladybug: one end flies up and over to the other
  private whipSide = 0; // a wild lash (a small worm held): sideways, ±1 (0: over the back)
  private slamT = 0; // a big worm slams the ladybug it holds against the skin
  private slamEnd: 'head' | 'tail' = 'head';
  private slamAge = 0;
  private slamFrom = 0; // the end's direction round the held end, radians
  private slamTo = 0;
  private slamSide = Math.random() < 0.5 ? -1 : 1;
  private slamFresh = true;
  private whipEnd: 'head' | 'tail' = 'tail';
  private whipAim = 0; // sideways aim of this strike, radians
  private whipFold = 1; // how far it folds over
  private whipHit = true; // does this one land
  rear = 0; // 0 = lying, 1 = standing on the tail
  gnawing = false;

  readonly trail = new Trail();
  readonly disp = Array.from({ length: N }, () => new THREE.Vector3());
  readonly ups = Array.from({ length: N }, () => new THREE.Vector3(0, 1, 0));
  private readonly target = Array.from({ length: N }, () => new THREE.Vector3());
  private placed = false;

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly linkLens: number[] = new Array(N).fill(0);
  /** Lying still this long: it starts to look about (and sighs). */
  idleT = 0;
  private lookW = 0;
  /** 0…1: a sigh while looking about (the view shows it). */
  sigh = 0;
  private readonly tmpN = new THREE.Vector3();
  private readonly bendT = new THREE.Vector3();
  private readonly bendC = new THREE.Vector3();
  private readonly rearP = new THREE.Vector3();
  private readonly rearDir = new THREE.Vector3();
  private readonly rearUp = new THREE.Vector3();
  private readonly rearN = new THREE.Vector3();
  private readonly bendTmp = Array.from({ length: N }, () => new THREE.Vector3());
  private readonly bendVec = new THREE.Vector3();
  private readonly bendAxis = new THREE.Vector3();

  /** Size gained per gnawed distance: 100 / the room's goal (points come at the same pace, the size always doubles by the win). */
  growthRate = 1;
  /** × the points it loses (the room's level). */
  lossK = 1;
  /** How hollow it is ahead (passages already gnawed there): 0…1. Gnawing a hollow gives nothing. */
  hollow?: (p: THREE.Vector3, r: number, dir: THREE.Vector3) => number;
  private inHollow = false;
  private onPit = false;
  private bitterSlowT = 0; // a bitter seed: half speed a moment
  private bitterAt = -1; // …and a shiver runs down the body
  /** Riding the chafer: where (set every frame by the game), null = not. */
  rideAt: RideAt | null = null;
  private rideLift = 0;
  /** Rocketing out of the fruit: straight up and out, knocking everything aside. */
  rocketing = false;
  // arena
  arena = false;
  life = 0;
  lifeMax = 0;
  down = false; // no life left: lies there till the round ends
  private strikeT = 0; // arena: a strike down through the fruit
  through = false; // going straight through the fruit (the strike, a rocket in the arena)
  private readonly throughDir = new THREE.Vector3();
  // the leap out after a rocket, and the dolphin dive back in
  private leapT = 0;
  private leapCalm = false;
  private leapFlip = false;
  private diveT = 0;
  private diveLeft = 0; // after diving in: this much more it goes on its own, fast at first
  private diveFrom = 0;
  private diveYaw = 0; // steering in the air
  private diveBoost = 1;
  private readonly diveP = new THREE.Vector3();
  private readonly diveF = new THREE.Vector3();
  private diveBack = true; // alternate dives go back the way it came
  private diveFlip = false; // a somersault on the way down
  private readonly diveSide = new THREE.Vector3();
  private diveSpan = 0; // a dive straight from the skin (from a jump): its airtime
  private diveLift = 0;
  private diveGnaw = false; // …and it then gnaws on as usual
  private readonly divePath = new Trail();
  private readonly diveAt = new THREE.Vector3();
  private readonly diveCtrl = new THREE.Vector3();
  private readonly diveDir = new THREE.Vector3();
  private readonly leapP = new THREE.Vector3();
  private readonly leapN = new THREE.Vector3();
  private readonly leapF = new THREE.Vector3();
  private readonly leapLandAt = new THREE.Vector3();
  private emergeT = 0;
  private rideFlip = -1; // the somersault off the chafer: its clock, −1 = none
  private rideWasRunning = false;
  /** Held by an end and wagged (a ladybug): set every frame by the game. */
  wag: Wag | null = null;
  /** Held (lifted) by the earwig. heldAt: in its pincers; undefined: lifted where it is; null: not yet. */
  held = false;
  heldAt: HeldAt | null | undefined = null;
  private heldLift = 0;
  private brokenT = 0; // the body is in a broken shape this long: lay it straight
  private draggedT = 0;
  private clapT = 0;
  private rideLashT = 0;
  private rideLashSide = 0;
  private readonly heldLens: number[] = new Array(N).fill(0);

  constructor(
    private events: SimEvents = {},
    growth = 1,
  ) {
    this.growth = Math.min(GROWTH_MAX, Math.max(1, growth));
    this.applyGrowth();
    this.spawn();
  }

  get head() {
    return this.disp[N - 1];
  }

  private applyGrowth() {
    this.L = L0 * this.growth;
    this.LC = LC0 * this.growth;
    this.SEG_R = SEG_R0 * girth(this.growth);
    this.SPACING = this.L / (N - 1);
  }

  private grow(dist: number) {
    if (this.arena) return; // in the arena nobody grows by gnawing
    this.growth = Math.min(GROWTH_MAX, this.growth + (dist * GROWTH_PER_DIAMETER * this.growthRate) / (2 * R0));
    this.applyGrowth();
  }

  /** Ends any strike or swing in progress. */
  private stopStrikes() {
    this.whipT = this.slamT = this.shakeT = this.swipeT = this.lungeT = this.swatT = this.flipT = 0;
    this.swatQueue.length = 0;
  }

  /** On the skin in direction `dir` from the center (random if none), with a trail behind. */
  spawn(dir?: THREE.Vector3) {
    const { pS, n, f } = this;
    this.stopStrikes();
    this.trail.p.length = this.trail.n.length = this.trail.d.length = 0;
    if (dir) pS.copy(dir);
    else {
      const phi = Math.random() * Math.PI * 2;
      pS.set(Math.cos(phi), -0.3 + Math.random() * 0.7, Math.sin(phi));
    }
    appleProject(pS);
    appleNormal(pS, n);
    f.crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize();
    this.layTrail(pS, f, n);
    this.mode = 'surface';
    this.placed = false;
    this.rideFlip = -1;
    this.rideWasRunning = false;
  }

  /** A fresh trail behind (pS, f): a straight line on the skin, 1.4 lengths long. */
  private layTrail(at: THREE.Vector3, f: THREE.Vector3, n: THREE.Vector3) {
    const bp = at.clone();
    const bf = f.clone().negate();
    const bn = n.clone();
    const pts: THREE.Vector3[] = [];
    const nrm: THREE.Vector3[] = [];
    const steps = Math.ceil((1.4 * this.L + 0.3) / 0.01);
    for (let i = 0; i < steps; i++) {
      pts.push(bp.clone().addScaledVector(bn, this.SEG_R));
      nrm.push(bn.clone());
      bp.addScaledVector(bf, 0.01);
      appleProject(bp);
      appleNormal(bp, bn);
      bf.addScaledVector(bn, -bf.dot(bn)).normalize();
    }
    for (let i = pts.length - 1; i >= 0; i--) this.trail.push(pts[i], nrm[i]);
    this.tailDist = this.trail.head - this.L;
  }

  /** One jerk to throw ants off: head and tail swing to one side, the next jerk to the other. */
  shake() {
    this.shakeT = SHAKE_TIME;
    this.shakeSide = -this.shakeSide;
  }

  /** Space: spring forward off the tail (clears a spider thread); standing on the tail: a hop. */
  jump() {
    if (this.mode !== 'surface' || this.jumpT > 0 || this.hopT > 0 || this.flipT > 0) return;
    if (this.rear > 0.6) this.hopT = HOP_TIME;
    else if (this.rear < 0.05) this.jumpT = JUMP_TIME;
  }

  /** In the air (a jump or a hop): a backflip — a somersault backwards, the tail lashing whatever's behind. */
  backflip() {
    if (this.mode !== 'surface' || this.down || this.flipT > 0 || (this.jumpT <= 0 && this.hopHeight() < 0.02 * this.L)) return false;
    this.flipT = FLIP_TIME;
    this.flipF.copy(this.f);
    this.flipN.copy(this.n);
    this.jumpT = 0;
    this.hopT = 0;
    this.swatT = 0;
    this.swatQueue.length = 0;
    return true;
  }

  get airborne() {
    return this.jumpT > 0 || this.leapT > 0 || this.diveT > 0 || this.hopHeight() > 0 || this.strikeT > 0;
  }

  /** The arena: `life` points of life, no growing by gnawing (water drops make it bigger). */
  setArena(life: number) {
    this.arena = true;
    this.lifeMax = life;
    this.life = life;
    this.down = false;
    this.growth = 1;
    this.applyGrowth();
  }

  /** Arena: a water drop — a quarter of the way to the biggest size. */
  drink() {
    if (!this.arena || this.down) return;
    const k = Math.min(1, winProgress(this.growth) + 0.25);
    this.growth = 1 + k * WIN_SIZE_GAIN;
    this.applyGrowth();
  }

  /** Arena: loses life (× the level). */
  wound(points: number) {
    if (!this.arena || this.down || points <= 0) return;
    this.life = Math.max(0, this.life - points * this.lossK);
    if (this.life <= 0) this.knockOut();
  }

  /** Arena: out at once (the chafer ran it over). */
  slay() {
    if (!this.arena || this.down) return;
    this.life = 0;
    this.knockOut();
  }

  private knockOut() {
    if (this.down) return;
    this.down = true;
    this.life = 0;
    this.strikeT = 0;
    this.rocketing = false;
    this.through = false;
    this.gnawing = false;
    this.rear = 0;
    this.events.down?.();
  }

  /** The hop on the tail: [height, a bend of the body (+ forward / − back)] now. */
  private hopState(): [number, number] {
    if (this.hopT <= 0) return [0, 0];
    const t = 1 - this.hopT / HOP_TIME;
    if (t < 0.28) return [0, smooth01(t / 0.28)]; // crouch
    if (t < 0.6) {
      const k = (t - 0.28) / 0.32; // up and down
      return [2.4 * this.L * k * (1 - k), k < 0.15 ? 1 - 1.8 * smooth01(k / 0.15) : -0.8 * (1 - smooth01((k - 0.15) / 0.85))];
    }
    const k = (t - 0.6) / 0.4; // landing: give, and back
    return k < 0.5 ? [0, 0.9 * Math.sin((k / 0.5) * Math.PI)] : [0, -0.25 * Math.sin(((k - 0.5) / 0.5) * Math.PI)];
  }

  private hopHeight() {
    return this.hopState()[0];
  }

  /** Inside a passage there is no room to turn: shrink like an accordion and stretch back. */
  squeeze() {
    this.squeezeT = SQUEEZE_TIME;
  }

  /**
   * Dragged by ants: inside, back along its own passage; on the skin by its head end (headFirst)
   * or its tail end.
   */
  pullBack(dist: number, headFirst = true) {
    if (this.rocketing || (this.mode !== 'dig' && this.mode !== 'surface') || dist <= 0 || this.jumpT > 0) return;
    if (headFirst || this.mode === 'dig') this.draggedT = 0.5;
    if (this.mode === 'surface') {
      const end = headFirst ? this.disp[N - 1] : this.disp[0];
      const dir = this.tmp.copy(end).normalize();
      // not over a pole (where the fruit hangs and sits)
      if (Math.abs(dir.y) > 0.82 && this.tmp2.copy(this.f).multiplyScalar(headFirst ? 1 : -1).y * Math.sign(dir.y) > 0) return;
      if (headFirst) {
        this.stepSurface(dist);
        this.tailDist = this.trail.head - this.L;
      } else this.dragTailFirst(dist);
      return;
    }
    const to = Math.max(this.trail.head - dist, this.trail.start + this.L);
    if (to >= this.trail.head) return;
    this.trail.sample(to, this.tmp, this.tmpN);
    if (appleF(this.tmp) > -this.SEG_R) {
      // dragged back out of its hole
      this.events.tunnelEnd?.();
      this.toSurface();
      return;
    }
    this.trail.truncate(to);
    this.pulledBack = true;
    this.trail.sample(this.trail.head, this.p, this.tmpN);
  }

  /** Stopped mid-step: the tail catches up (it lies stretched out again), extending the trail behind if needed. */
  private extendTail(dist: number) {
    const { trail, n } = this;
    trail.dropBefore(this.tailDist);
    const end = trail.sample(this.tailDist, this.tmp, this.tmpN).clone();
    trail.sample(this.tailDist + Math.min(0.15, 0.25 * this.L), this.tmp2, this.tmpN);
    const back = this.tmp2.subVectors(end, this.tmp2);
    appleNormal(end, n);
    back.addScaledVector(n, -back.dot(n));
    if (back.lengthSq() < 1e-8) return;
    back.normalize();
    for (let s = 0; s < dist; s += 0.03) {
      const step = Math.min(0.03, dist - s);
      appleNormal(end, n);
      const q = this.tmp.copy(end).addScaledVector(n, -this.SEG_R).addScaledVector(back, step);
      appleProject(q);
      appleNormal(q, n);
      const was = sPrev.copy(end);
      end.copy(q).addScaledVector(n, this.SEG_R);
      trail.prepend(end, n, Math.max(step, end.distanceTo(was)));
      back.addScaledVector(n, -back.dot(n)).normalize();
    }
    this.tailDist = trail.start;
    appleNormal(this.pS, n);
  }

  /** Dragged by the tail: the body slides backwards along the skin. */
  private dragTailFirst(dist: number) {
    const { trail, n } = this;
    const L = this.L;
    this.tailDist = trail.head - L;
    trail.dropBefore(this.tailDist);
    const end = trail.sample(this.tailDist, this.tmp, this.tmpN).clone();
    trail.sample(this.tailDist + Math.min(0.2, 0.3 * L), this.tmp2, this.tmpN);
    const back = this.tmp2.subVectors(end, this.tmp2);
    appleNormal(end, n);
    back.addScaledVector(n, -back.dot(n));
    if (back.lengthSq() < 1e-8) return;
    back.normalize();
    for (let s = 0; s < dist; s += 0.03) {
      const step = Math.min(0.03, dist - s);
      appleNormal(end, n);
      const q = this.tmp.copy(end).addScaledVector(n, -this.SEG_R).addScaledVector(back, step);
      appleProject(q);
      appleNormal(q, n);
      const was = sPrev.copy(end);
      end.copy(q).addScaledVector(n, this.SEG_R);
      trail.prepend(end, n, Math.max(step, end.distanceTo(was)));
      back.addScaledVector(n, -back.dot(n)).normalize();
    }
    this.tailDist = trail.start;
    trail.truncate(this.tailDist + L);
    trail.sample(trail.head, this.pS, this.tmpN);
    appleProject(this.pS);
    appleNormal(this.pS, n);
    this.f.addScaledVector(n, -this.f.dot(n)).normalize();
  }

  /** Swats critters (at these points) from above with the tail, one after the other. */
  flySwat(at: THREE.Vector3[]) {
    if (this.mode !== 'surface' || this.down || this.swatT > 0 || !at.length) return false;
    this.swatQueue.length = 0;
    for (const p of at) this.swatQueue.push(p.clone());
    this.hopT = 0;
    return this.beginSwat();
  }

  private beginSwat() {
    const p = this.swatQueue.shift();
    if (!p) return false;
    this.swatAim.copy(p);
    this.swatT = SWAT_TIME;
    return true;
  }

  /** A swipe of the tail to one side, the next to the other: shoo critters away. */
  swipe() {
    this.swipeT = SWIPE_TIME;
    this.swipeSide = -this.swipeSide;
  }

  /** A bite: the head lunges at `at`. */
  lunge(at: THREE.Vector3) {
    if (this.lungeT > 0) return false;
    this.lungeT = LUNGE_TIME;
    this.lungeAt.copy(at);
    return true;
  }

  /** A big worm slams the ladybug on `end` against the skin: lifted up and over to one side, then down. */
  slam(end: 'head' | 'tail') {
    if (this.slamT > 0 && this.slamAge < SLAM_HIT) return false;
    const az = this.slamT > 0 ? this.slamAz(this.slamAge) : 0;
    this.slamFresh = this.slamT <= 0;
    this.slamFrom = Math.atan2(Math.sin(az), Math.cos(az));
    this.slamSide = -this.slamSide;
    this.slamTo = this.slamFrom + this.slamSide * (2.5 + Math.random() * 0.6);
    this.slamEnd = end;
    this.slamAge = 0;
    this.slamT = SLAM_TIME;
    return true;
  }

  /** The slam at time t: [lift angle, direction round the held end, how far back to lying (0…1)]. */
  private slamAt(t: number): [number, number, number] {
    const { slamFrom: from, slamTo: to } = this;
    if (t < 0) return [0, from, 0];
    if (t < 0.42) {
      const k = t / 0.42;
      const lift = k < 0.55 ? 1.52 * Math.sin((Math.PI / 2) * (k / 0.55)) : k < 0.8 ? 1.52 * (1 - ((k - 0.55) / 0.25) ** 2) : -0.06 * Math.sin(((k - 0.8) / 0.2) * Math.PI);
      const w = Math.min(1, Math.max(0, (k - 0.05) / 0.75));
      return [lift, from + (to - from) * w * w, 0];
    }
    if (t < SWEEP_TIME) return [0, to, 0];
    const back = smooth01((t - SWEEP_TIME) / 0.3);
    return [0, Math.atan2(Math.sin(to), Math.cos(to)) * (1 - back), back];
  }

  private slamAz(t: number) {
    return this.slamAt(t)[1];
  }

  /**
   * A lash with `end` at whatever holds the other end. wild: a small worm flails (it may miss:
   * sideways, short). Returns whether this one lands.
   */
  whip(end: 'head' | 'tail', wild = false) {
    this.whipT = WHIP_TIME;
    this.whipEnd = end;
    if (wild) {
      this.whipSide = Math.random() < 0.6 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      this.whipAim = (Math.random() * 2 - 1) * 1;
      this.whipFold = 0.8 + Math.random() * 0.35;
      this.whipHit = Math.abs(this.whipAim) < 0.6 && this.whipFold > 0.85;
    } else {
      this.whipSide = 0;
      this.whipAim = (Math.random() * 2 - 1) * 0.3; // each strike lands a bit left or right
      this.whipFold = 1;
      this.whipHit = true;
    }
    return this.whipHit;
  }

  /** Burrow in from the skin (head goes in at ~40°). */
  startDig() {
    if (this.mode !== 'surface' || this.diveT > 0) return;
    const { pS, n, f, p, d, u, right } = this;
    this.mode = 'dig';
    this.stopStrikes();
    p.copy(pS).addScaledVector(n, this.SEG_R);
    right.crossVectors(f, n).normalize();
    d.copy(f).multiplyScalar(Math.cos(DIG_ANGLE)).addScaledVector(n, -Math.sin(DIG_ANGLE)).normalize();
    u.crossVectors(right, d).normalize();
    this.travel = 0;
    this.entered = false;
    this.sinceEntry = 0;
    this.lastTunnelPt = null;
    this.pulledBack = false;
    this.events.tunnelStart?.(TUNNEL_R0 * girth(this.growth));
  }

  /** Direction the flying winner faces (towards the camera). */
  get flyFacing() {
    return this.flyDir;
  }

  /** "Up" at the take-off point. */
  get flyUpDir() {
    return this.flyUp;
  }

  /** Won the round: rise above the fruit, flap the wings and fly away. face = where to look (the camera). */
  startVictory(face?: THREE.Vector3) {
    if (this.mode === 'fly') return;
    if (this.mode === 'dig') this.events.tunnelEnd?.();
    this.wave = -1;
    this.bitterAt = -1;
    this.gnawing = false;
    const q = appleProject(this.head.clone());
    appleNormal(q, this.flyUp);
    this.flyBase.copy(q);
    if (face) this.flyDir.copy(face);
    else this.flyDir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    this.flyDir.addScaledVector(this.flyUp, -this.flyDir.dot(this.flyUp));
    if (this.flyDir.lengthSq() < 1e-6) this.flyDir.set(1, 0, 0).addScaledVector(this.flyUp, -this.flyUp.x);
    this.flyDir.normalize();
    this.mode = 'fly';
    this.fx = 0;
    this.gnawing = false;
    this.rear = 0;
  }

  /** New round: small again (full life), at a new spot on the skin, coming up out of it. */
  restart(dir?: THREE.Vector3) {
    if (this.mode === 'fly') return; // the winner restarts by itself after the flight
    if (this.mode === 'dig') this.events.tunnelEnd?.();
    this.resetGrowth();
    if (this.arena) {
      this.life = this.lifeMax;
      this.down = false;
      this.strikeT = 0;
      this.through = false;
      this.rocketing = false;
    }
    this.wave = -1;
    this.rear = 0;
    this.spawn(dir);
    this.emergeT = EMERGE_TIME;
  }

  /** Back to the starting size (someone else won the round). */
  resetGrowth() {
    this.growth = 1;
    this.applyGrowth();
  }

  /** Riding: the body follows the chafer's seat at once (called after the chafer moved). */
  followRide() {
    if (this.mode !== 'surface' || !this.rideAt || this.rideLift <= 0.002) return;
    this.ridePose(0);
    this.lookAbout(0);
    if (this.bitterAt >= 0) this.shiver(0);
    this.smoothBody();
    const a = this.rideLift > 0.85 ? 1 : damp(1 / 60, 22);
    for (let k = 0; k < N; k++) {
      if (a === 1) this.disp[k].copy(this.target[k]);
      else this.disp[k].lerp(this.target[k], a);
    }
  }

  /** The dive's airtime. */
  private diveAir() {
    return this.diveSpan > 0 ? this.diveSpan : this.diveFlip ? 0.75 : 0.55;
  }

  /** A bitter seed: half speed a moment, and a shiver. */
  bitter() {
    this.bitterAt = 0;
    this.bitterSlowT = 1;
    if (this.wave < 0) this.wave = 0;
  }

  /** Points gained (+) or lost (−; × the level) as size. In the arena a loss is life. */
  addPoints(points: number) {
    if (this.arena) {
      if (points < 0) this.wound(-points);
      return;
    }
    if (points < 0) points *= this.lossK;
    this.growth = Math.min(GROWTH_MAX, Math.max(1, this.growth + (points * this.growthRate) / 100));
    this.applyGrowth();
  }

  /** Loses this much size (× the level). In the arena: as much life as those points. */
  loseGrowth(g: number) {
    if (this.arena) {
      const points = this.growthRate > 0 ? (g * 100) / this.growthRate : 0;
      this.wound(points);
      return;
    }
    this.growth = Math.max(1, this.growth - g * this.lossK);
    this.applyGrowth();
  }

  private updateFlight(dt: number) {
    this.fx += dt;
    const t = this.fx;
    const { flyBase, flyUp, flyDir, flyOff } = this;
    const rise = ease(Math.min(1, t / FLY_RISE)) * (0.9 * this.growth + 0.6);
    const center = this.tmp.copy(flyBase).addScaledVector(flyUp, this.SEG_R + rise + this.L / 2);
    flyOff.set(0, 0, 0);
    if (t > FLY_GO) {
      const a = t - FLY_GO;
      // up into the sky and away from the camera
      flyOff.copy(flyUp).addScaledVector(flyDir, -0.35).normalize().multiplyScalar(a * a * 14 + a * 2);
    }
    for (let k = 0; k < N; k++) {
      const sway = Math.sin(t * 3 + k * 0.4) * 0.02 * this.growth;
      // the top balls curl towards the camera: the worm looks at us, wings stay behind its back
      const j = Math.max(0, k - (N - 4));
      const curl = 0.18 * j * j * this.SPACING * Math.min(1, t / FLY_RISE);
      this.target[k]
        .copy(center)
        .addScaledVector(flyUp, (k - (N - 1) / 2) * this.SPACING - curl * 0.4)
        .addScaledVector(flyDir, sway + curl)
        .add(flyOff);
      this.ups[k].copy(flyDir);
    }
    const a = damp(dt, 10);
    for (let k = 0; k < N; k++) this.disp[k].lerp(this.target[k], a);
    if (t > FLY_END) {
      this.fx = -1;
      this.resetGrowth();
      this.wave = -1;
      this.spawn();
      this.events.flown?.();
    }
  }

  update(dt: number, inp: SimInput) {
    if (this.mode === 'fly') {
      this.updateFlight(dt);
      return;
    }
    if (this.down) {
      inp = { turn: 0, pitch: 0, forward: false, rear: false, speed: 0 };
      this.strikeT = 0;
      this.rocketing = false;
      this.gnawing = false;
    }
    if (this.mode === 'surface' && this.rocketing && this.leapT <= 0 && this.strikeT <= 0) {
      this.rocketing = false;
      this.through = false;
    }
    if (this.strikeT > 0) {
      this.strikeT = Math.max(0, this.strikeT - dt);
      if (this.strikeT === 0) this.plunge();
    }
    let boost = RUN * (inp.speed ?? 1); // always at a run (no separate boost)
    if (this.bitterSlowT > 0) {
      this.bitterSlowT = Math.max(0, this.bitterSlowT - dt);
      boost *= 0.5;
    }
    const standing = this.mode === 'surface' && (inp.rear || this.hopT > 0 || this.swatT > 0);
    this.rear += (+standing - this.rear) * damp(dt, 5);
    this.hopT = Math.max(0, this.hopT - dt);
    this.hopFwd = inp.forward;
    if (this.mode === 'surface') this.updateSurface(dt, inp.turn, inp.forward && this.rear < 0.05, boost);
    else this.updateDig(dt, inp.turn, inp.pitch, inp.forward, boost);
    this.gnawing = this.mode === 'dig' && inp.forward && !this.inHollow;
    if (this.mode !== 'dig') this.inHollow = false;
    const still = this.mode === 'surface' && !inp.forward && Math.abs(inp.turn) < 1e-5 && !inp.rear && this.rear < 0.05;
    this.draggedT = Math.max(0, this.draggedT - dt);
    const busy =
      this.whipT > 0 ||
      this.slamT > 0 ||
      this.shakeT > 0 ||
      this.swipeT > 0 ||
      this.swatT > 0 ||
      this.flipT > 0 ||
      this.jumpT > 0 ||
      this.hopT > 0 ||
      this.lungeT > 0 ||
      this.draggedT > 0 ||
      this.held ||
      !!this.rideAt ||
      !!this.wag;
    this.idleT = still && !busy ? this.idleT + dt : 0;
    this.updateBody(dt);
    // swallowing wave runs head → tail while gnawing; a started wave always finishes
    if (this.wave < 0 && this.gnawing) this.wave = 0;
    if (this.wave >= 0) {
      this.wave += (dt / PULSE_TIME) * boost;
      const waveEnd = N - 1 + PULSE_WIDTH;
      if (this.wave >= waveEnd) this.wave = this.gnawing ? this.wave - waveEnd : -1;
    }
  }

  // ---------- skin ----------

  private updateSurface(dt: number, turn: number, forward: boolean, boost: number) {
    if (this.strikeT > 0) return;
    const { f, n, trail, L } = this;
    f.applyAxisAngle(n, turn).normalize();
    // a hop on the tail with the key held: forward through the air
    const hop = this.hopT > 0 ? 1 - this.hopT / HOP_TIME : -1;
    if (hop > 0.28 && hop < 0.6 && this.hopFwd) {
      this.stepSurface(((1.4 * L) / 0.32) * dt);
      this.tailDist = trail.head - L;
      return;
    }
    if (this.diveT > 0) {
      this.diveYaw += turn; // steering in the air
      this.diveT = Math.max(0, this.diveT - dt);
      if (this.diveT === 0) this.diveIn();
      return;
    }
    if (this.leapT > 0) {
      this.leapT = Math.max(0, this.leapT - dt);
      if (this.leapT === 0) this.landFromLeap();
      return;
    }
    if (this.flipT > 0) {
      // the backflip carries it forward a little
      this.stepSurface(((1.5 * L * 0.7) / FLIP_TIME) * dt);
      this.tailDist = trail.head - L;
      return;
    }
    if (this.jumpT > 0) {
      // in the air: carried forward, body straight
      this.jumpT = Math.max(0, this.jumpT - dt);
      if (this.jumpT === 0) this.landT = LAND_TIME;
      this.stepSurface(((JUMP_DIST * L) / JUMP_TIME) * dt);
      this.tailDist = trail.head - L;
      return;
    }
    if (!forward) {
      // stopped: the tail catches up, so it lies stretched out (no frozen hump)
      const gap = Math.max(0, this.tailDist - (trail.head - L));
      const step = gap < 0.02 * L ? gap : gap * Math.min(1, dt * 8);
      if (step > 1e-4) this.extendTail(step);
      if (Math.abs(this.tailDist - (trail.head - L)) < 0.01 * L) this.phase = 0;
      return;
    }
    // fast (a drop, panic): several small sub-steps, so no part of a step is skipped
    let left = (dt / CYCLE) * boost;
    while (left > 1e-6) {
      const d = Math.min(left, 0.04);
      left -= d;
      this.crawlPhase(d);
    }
  }

  /** Advance the inchworm cycle by `d` (a fraction of a step). */
  private crawlPhase(d: number) {
    const { trail, L, LC } = this;
    const before = this.phase;
    this.phase += d;
    if (this.phase >= 1) {
      // finish the stretch of this step before starting the next one
      if (before < 1) {
        const move = this.tailDist + L - trail.head;
        if (move > 0) this.stepSurface(move);
      }
      this.phase -= 1;
    }
    const half = (1 - STRAIGHT_HOLD) / 2;
    if (this.phase < STRAIGHT_HOLD) {
      this.tailDist = trail.head - L; // lie stretched out for a moment
    } else if (this.phase < STRAIGHT_HOLD + half) {
      // pull the back up, the middle humps
      this.tailDist = trail.head - (L - (L - LC) * ease((this.phase - STRAIGHT_HOLD) / half));
    } else {
      // tail holds, front stretches forward
      const g = LC + (L - LC) * ease((this.phase - STRAIGHT_HOLD - half) / half);
      const move = this.tailDist + g - trail.head;
      if (move > 0) this.stepSurface(move);
    }
  }

  private stepSurface(dist: number) {
    const { pS, f, n } = this;
    let rem = dist;
    while (rem > 1e-6) {
      const s = Math.min(rem, 0.01);
      rem -= s;
      pS.addScaledVector(f, s);
      appleProject(pS);
      appleNormal(pS, n);
      f.addScaledVector(n, -f.dot(n)).normalize();
    }
    this.trail.push(this.tmp.copy(pS).addScaledVector(n, this.SEG_R), n);
  }

  // ---------- inside ----------

  private updateDig(dt: number, turn: number, pitch: number, forward: boolean, boost: number) {
    const { d, u, right, p } = this;
    const pressed = forward;
    if (this.diveLeft > 0) {
      // just dived in: goes on by itself, levelling out under the skin, fast at first
      const out = this.tmp2.copy(p).normalize();
      out.copy(d).addScaledVector(out, -d.dot(out));
      if (out.lengthSq() > 1e-6) d.lerp(out.normalize(), Math.min(1, dt * 1.2)).normalize();
      right.crossVectors(d, u);
      if (right.lengthSq() < 1e-6) right.crossVectors(d, this.tmp2.set(0, 1, 0));
      right.normalize();
      u.crossVectors(right, d).normalize();
      forward = true;
      const k = this.diveLeft / (1.2 * this.L);
      boost = 1 + (this.diveBoost - 1) * k * k;
      this.diveLeft -= DIG_SPEED * this.growth * boost * dt;
    } else if (this.rocketing) {
      // a rocket: straight out (or straight through), fast
      if (this.through) d.copy(this.throughDir);
      else d.lerp(this.tmp2.copy(p).normalize(), Math.min(1, dt * 12)).normalize();
      right.crossVectors(d, u);
      if (right.lengthSq() < 1e-6) right.crossVectors(d, this.tmp2.set(0, 1, 0));
      right.normalize();
      u.crossVectors(right, d).normalize();
      forward = true;
      boost = this.through ? 10.5 : 7;
    } else {
      d.applyAxisAngle(u, turn);
      right.crossVectors(d, u).normalize();
      d.applyAxisAngle(right, pitch).normalize();
      u.crossVectors(right, d).normalize();
    }
    if (!forward) return;
    const before = this.rearDir.copy(p);
    p.addScaledVector(d, DIG_SPEED * this.growth * boost * dt);
    const pit = pushOutOfPit(p, this.SEG_R); // a pit stops the worm, it slides along
    const step = p.distanceTo(before); // only real progress counts (for growth too)
    if (pit && !this.onPit) this.events.pitCrash?.(p);
    this.onPit = pit;
    this.travel += step;
    const wig = Math.sin((this.travel * Math.PI * 2) / 0.6) * 0.012; // gentle snake wiggle
    const rec = this.tmp.copy(p).addScaledVector(right, wig);
    const F = appleF(p);
    if (!this.entered && F <= 0) {
      this.entered = true;
      this.sinceEntry = 0;
      this.emitHole();
    }
    if (this.entered) {
      this.sinceEntry += step;
      if (F < 0) {
        // through a passage already gnawed: no growth there (and no wave)
        const hollow = this.rocketing ? 1 : (this.hollow?.(p, TUNNEL_R0 * girth(this.growth), d) ?? 0);
        this.inHollow = hollow > 0.9;
        this.grow(step * (1 - hollow));
        if (this.pulledBack) {
          // dragged back, then gnawing on away from its passage's end: a new passage
          this.pulledBack = false;
          if (this.lastTunnelPt && this.lastTunnelPt.distanceTo(rec) > 0.12) {
            this.events.tunnelEnd?.();
            this.events.tunnelStart?.(TUNNEL_R0 * girth(this.growth));
            this.lastTunnelPt = null;
          }
        }
        if (!this.lastTunnelPt || this.lastTunnelPt.distanceTo(rec) >= TUNNEL_STEP) {
          this.lastTunnelPt = rec.clone();
          this.events.tunnelPoint?.(rec);
        }
      }
    }
    this.trail.push(rec, u);
    // out again; before getting in, only if it wandered off well above where it started (it starts a body-thickness up)
    if ((this.entered && F > 0 && this.sinceEntry > 0.3) || (!this.entered && F > this.SEG_R + 0.4)) {
      if (this.entered) this.emitHole();
      this.events.tunnelEnd?.();
      this.toSurface();
      if (this.rocketing) {
        // out of the fruit: a leap up and over (it came slowly, gently: a plop)
        const calm = this.through && !pressed;
        this.rocketing = false;
        this.through = false;
        this.leapCalm = calm;
        this.leapT = calm ? LEAP_CALM : LEAP_TIME;
        this.leapFlip = !calm && this.arena && Math.random() < 0.25;
        this.leapP.copy(this.pS);
        this.leapN.copy(this.n);
        this.leapF.copy(this.f);
      }
    }
  }

  /** The leap out of the fruit: shoots up, hangs a moment, bends over and comes down head first (maybe a somersault). */
  private leapPose() {
    const t = 1 - this.leapT / (this.leapCalm ? LEAP_CALM : LEAP_TIME);
    if (this.leapCalm) {
      this.plopPose(t);
      return;
    }
    const { leapP, leapN, leapF, L } = this;
    const high = 1.4 * L;
    const head = this.tmp;
    let tilt: number; // from straight up (0) to head down (π/2 and a bit)
    if (t < 0.32) {
      const k = 1 - (1 - t / 0.32) ** 2;
      tilt = 0;
      head.copy(leapP).addScaledVector(leapN, 0.25 * L + high * k);
    } else if (t < 0.55) {
      const k = (t - 0.32) / 0.23;
      tilt = k * k;
      head.copy(leapP).addScaledVector(leapN, 0.25 * L + high + Math.sin(Math.PI * k) * L * 0.08).addScaledVector(leapF, k * L * 0.25);
    } else {
      const k = (t - 0.55) / 0.45;
      const k2 = k * k;
      tilt = 1 + (Math.PI / 2 - 1 + 0.25 * Math.sin(Math.PI * k)) * k2;
      const land = this.leapLand();
      const top = this.tmp2.copy(leapP).addScaledVector(leapN, 0.25 * L + high).addScaledVector(leapF, 0.25 * L);
      head.lerpVectors(top, land, k2);
    }
    const along = this.rearDir.copy(leapN).multiplyScalar(Math.cos(tilt)).addScaledVector(leapF, Math.sin(tilt));
    const up = this.rearUp.copy(leapN).multiplyScalar(Math.sin(tilt)).addScaledVector(leapF, -Math.cos(tilt));
    const arch = 0.22 * L * (t < 0.9 ? 1 : (1 - t) / 0.1);
    for (let k = 0; k < N; k++) {
      const back = ((N - 1 - k) / (N - 1)) * L;
      const q = this.target[k].copy(head).addScaledVector(along, -back).addScaledVector(up, arch * Math.sin((Math.PI * back) / L));
      if (appleF(q) < 0.5 * this.SEG_R) appleProject(q).addScaledVector(appleNormal(q, this.tmpN), this.SEG_R);
      this.ups[k].copy(up);
    }
    if (!this.leapFlip) return;
    // a somersault on the way
    const s = Math.min(1, t / 0.85);
    const ang = -(Math.PI * 2) * s * s * (3 - 2 * s);
    const axis = this.tmpN.crossVectors(leapF, leapN);
    if (axis.lengthSq() < 1e-6) return;
    axis.normalize();
    const mid = this.tmp2.copy(this.target[N >> 1]);
    for (let k = 0; k < N; k++) {
      this.target[k].sub(mid).applyAxisAngle(axis, ang).add(mid);
      this.ups[k].applyAxisAngle(axis, ang);
      if (t < 0.9 && appleF(this.target[k]) < 0.5 * this.SEG_R) appleProject(this.target[k]).addScaledVector(appleNormal(this.target[k], this.tmp), 0.5 * this.SEG_R);
    }
  }

  /** A gentle leap: up a little, over, and a plop. */
  private plopPose(t: number) {
    const { leapP, leapN, leapF, L } = this;
    const high = 0.95 * L;
    const head = this.tmp;
    let tilt: number;
    if (t < 0.4) {
      const k = 1 - (1 - t / 0.4) ** 2;
      tilt = 0.15 + 0.25 * k;
      head.copy(leapP).addScaledVector(leapN, 0.22 * L + high * k);
    } else {
      const k = (t - 0.4) / 0.6;
      const k2 = k * k;
      tilt = 0.4 + (Math.PI / 2 - 0.15) * k2;
      const top = this.tmp2.copy(leapP).addScaledVector(leapN, 0.22 * L + high).addScaledVector(leapF, 0.2 * L);
      head.lerpVectors(top, this.leapLand(), k2);
    }
    const along = this.rearDir.copy(leapN).multiplyScalar(Math.cos(tilt)).addScaledVector(leapF, Math.sin(tilt));
    const up = this.rearUp.copy(leapN).multiplyScalar(Math.sin(tilt)).addScaledVector(leapF, -Math.cos(tilt));
    const arch = 0.16 * L * (t < 0.88 ? 1 : (1 - t) / 0.12);
    for (let k = 0; k < N; k++) {
      const back = ((N - 1 - k) / (N - 1)) * L;
      const q = this.target[k].copy(head).addScaledVector(along, -back).addScaledVector(up, arch * Math.sin((Math.PI * back) / L));
      if (appleF(q) < 0.5 * this.SEG_R) appleProject(q).addScaledVector(appleNormal(q, this.tmpN), this.SEG_R);
      this.ups[k].copy(up);
    }
  }

  /** Where the leap comes down: ahead of where it came out. */
  private leapLand() {
    const p = this.leapLandAt.copy(this.leapP).addScaledVector(this.leapF, this.L * (this.leapCalm ? 0.85 : 1.2));
    appleProject(p);
    return p.addScaledVector(appleNormal(p, this.tmpN), this.SEG_R);
  }

  private landFromLeap() {
    const at = this.leapLand();
    this.spawn(at);
    const n = appleNormal(this.pS, this.tmpN);
    const f = this.f.copy(this.leapF).addScaledVector(n, -this.leapF.dot(n));
    if (f.lengthSq() > 1e-6) {
      f.normalize();
      this.layStraight();
    }
    this.placed = true;
    this.landT = LAND_TIME;
  }

  /** A fresh straight trail behind it, along its heading. */
  private layStraight() {
    const n = appleNormal(this.pS, this.n);
    const f = this.f.addScaledVector(n, -this.f.dot(n));
    if (f.lengthSq() < 1e-8) return;
    f.normalize();
    this.trail.p.length = this.trail.n.length = this.trail.d.length = 0;
    this.layTrail(this.pS, f, n);
    this.phase = 0;
  }

  /** A body bent into a broken shape (links too long or short, a kink) for a while: laid straight again. */
  private unbreak(dt: number) {
    if (
      this.mode !== 'surface' ||
      this.jumpT > 0 ||
      this.hopT > 0 ||
      this.flipT > 0 ||
      this.leapT > 0 ||
      this.diveT > 0 ||
      this.strikeT > 0 ||
      this.heldLift > 0.002 ||
      this.rideLift > 0.002 ||
      this.rideFlip >= 0 ||
      (this.wag && this.wag.v) ||
      this.emergeT > 0
    ) {
      this.brokenT = 0;
      return;
    }
    const t = this.target;
    let broken = false;
    for (let k = 1; k < N && !broken; k++) {
      const r = t[k].distanceTo(t[k - 1]) / this.SPACING;
      if (r > 1.7 || r < 0.35) broken = true;
      if (k < N - 1) {
        const a = this.tmp.subVectors(t[k], t[k - 1]);
        const b = this.tmp2.subVectors(t[k + 1], t[k]);
        if (a.dot(b) < -0.2 * a.length() * b.length()) broken = true;
      }
    }
    this.brokenT = broken ? this.brokenT + dt : 0;
    const striking = this.whipT > 0 || this.slamT > 0 || this.shakeT > 0 || this.swipeT > 0 || this.swatT > 0 || this.flipT > 0 || this.lungeT > 0;
    if (this.brokenT > (striking ? 0.8 : 0.4)) {
      this.brokenT = 0;
      this.rear = 0;
      this.stopStrikes();
      this.layStraight();
      for (let k = 0; k < N; k++) this.trail.sample(this.tailDist + (k / (N - 1)) * this.L, t[k], this.ups[k]);
    }
  }

  /**
   * The dolphin: at the top of the leap out, dive back in head first (alternately back the way it
   * came and on ahead; now and then with a somersault). Steerable in the air.
   */
  dive() {
    if (this.leapT <= 0 || this.diveT > 0) return false;
    this.diveSpan = 0;
    this.diveLift = 0;
    this.diveGnaw = false;
    const t = 1 - this.leapT / LEAP_TIME;
    if (t < 0.2 || t > 0.85) return false;
    this.leapT = 0;
    const { L, target, ups } = this;
    const path = this.divePath;
    path.p.length = path.n.length = path.d.length = 0;
    for (let k = 0; k < N; k++) path.push(target[k], ups[k]);
    this.diveFrom = path.head;
    const head = target[N - 1];
    const up = this.leapN;
    const fwd = this.diveF.copy(this.f).addScaledVector(up, -this.f.dot(up));
    if (fwd.lengthSq() < 1e-6) fwd.copy(this.leapF);
    fwd.normalize();
    this.diveBack = !this.diveBack;
    if (this.diveBack) fwd.negate();
    this.diveP.copy(head);
    this.diveYaw = 0;
    // a quadratic curve from the head down to the skin 1.5 lengths on
    const at = this.diveAt.copy(head);
    appleProject(at).addScaledVector(fwd, 1.5 * L);
    appleProject(at);
    const ctrl = this.diveCtrl.copy(head).addScaledVector(fwd, 0.9 * L).addScaledVector(up, 0.15 * L);
    const side = this.diveSide.crossVectors(fwd, up).normalize();
    this.diveFlip = Math.random() < 0.25;
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    for (let i = 1; i <= 40; i++) {
      const s = i / 40;
      p.copy(head).multiplyScalar((1 - s) ** 2).addScaledVector(ctrl, 2 * s * (1 - s)).addScaledVector(at, s * s);
      tan.copy(ctrl).sub(head).multiplyScalar(2 * (1 - s)).addScaledVector(this.tmpN.copy(at).sub(ctrl), 2 * s).normalize();
      nrm.crossVectors(side, tan).normalize();
      path.push(p, nrm);
    }
    this.diveDir.copy(tan);
    this.diveT = this.diveAir();
    this.rear = 0;
    return true;
  }

  /** WW in the air (a jump, a backflip, a leap, a hop): dives head first into the skin just ahead. */
  burrowFromJump() {
    if (this.mode !== 'surface' || this.diveT > 0) return false;
    const hopping = this.hopT > 0 && this.hopHeight() > 0.03 * this.L;
    if (this.jumpT <= 0 && this.flipT <= 0 && this.leapT <= 0 && !hopping) return false;
    return this.diveHere();
  }

  /**
   * Dives into the skin right ahead of its head (dir: that way instead; up: the body's up on the way;
   * high: from higher up, as off the chafer's back), then gnaws on.
   */
  diveHere(dir?: THREE.Vector3, up?: THREE.Vector3, high = false) {
    if (this.mode !== 'surface' || this.diveT > 0) return false;
    const head = this.disp[N - 1].clone();
    appleNormal(this.tmp.copy(head), this.leapN);
    this.diveLift = high ? 0.4 * this.L : 0;
    head.addScaledVector(this.leapN, this.diveLift);
    const fwd = this.diveF.copy(dir ?? this.f);
    fwd.addScaledVector(this.leapN, -fwd.dot(this.leapN));
    if (fwd.lengthSq() < 1e-6) {
      fwd.crossVectors(this.leapN, this.tmp.set(0, 1, 0));
      if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0);
    }
    fwd.normalize();
    this.f.copy(fwd);
    this.n.copy(this.leapN);
    const at = this.diveAt.copy(head).addScaledVector(fwd, 0.32 * this.L);
    appleProject(at);
    const into = this.tmp2.copy(fwd).multiplyScalar(Math.cos(DIG_ANGLE)).addScaledVector(this.leapN, -Math.sin(DIG_ANGLE)).normalize();
    const ctrl = this.diveCtrl.copy(head).lerp(at, 0.45);
    const drop = Math.max(0, this.tmp.subVectors(head, at).dot(this.leapN));
    ctrl.addScaledVector(this.leapN, 0.12 * drop);
    const path = this.divePath;
    path.p.length = path.n.length = path.d.length = 0;
    const bodyUp = up && up.lengthSq() > 1e-8 ? up : this.leapN;
    for (let k = 0; k < N; k++) path.push(this.tmp.copy(this.disp[k]).addScaledVector(this.leapN, this.diveLift), bodyUp);
    this.diveFrom = path.head;
    this.diveP.copy(head);
    this.diveYaw = 0;
    this.diveBack = false;
    this.diveFlip = false;
    this.diveGnaw = true;
    this.diveSpan = 0.42 + 0.4 * +!!high;
    const side = this.diveSide.crossVectors(fwd, this.leapN);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    for (let i = 1; i <= 24; i++) {
      const s = i / 24;
      p.copy(head).multiplyScalar((1 - s) ** 2).addScaledVector(ctrl, 2 * s * (1 - s)).addScaledVector(at, s * s);
      tan.copy(ctrl).sub(head).multiplyScalar(2 * (1 - s)).addScaledVector(this.tmpN.copy(at).sub(ctrl), 2 * s);
      if (tan.lengthSq() < 1e-8) tan.copy(into);
      tan.normalize();
      nrm.crossVectors(side, tan);
      if (nrm.lengthSq() < 1e-8) nrm.copy(this.leapN);
      else nrm.normalize();
      path.push(p, nrm);
    }
    // in at the usual angle (not steeper than the curve came down)
    this.diveDir.copy(tan.dot(this.leapN) > -0.35 ? into : tan).normalize();
    this.jumpT = 0;
    this.hopT = 0;
    this.leapT = 0;
    this.flipT = 0;
    this.rear = 0;
    this.rideAt = null;
    this.rideFlip = -1;
    this.rideWasRunning = false;
    this.stopStrikes();
    this.diveT = this.diveAir();
    return true;
  }

  /** A point on the dive's path, turned by how much it has steered so far. */
  private diveSample(s: number, outP: THREE.Vector3, outN: THREE.Vector3) {
    this.divePath.sample(s, outP, outN);
    if (s <= this.diveFrom || !this.diveYaw) return;
    const k = Math.min(1, (s - this.diveFrom) / Math.max(1e-6, this.divePath.head - this.diveFrom));
    const yaw = this.diveYaw * k * k * (3 - 2 * k);
    outP.sub(this.diveP).applyAxisAngle(this.leapN, yaw).add(this.diveP);
    outN.applyAxisAngle(this.leapN, yaw);
  }

  /** In the air: the body runs along the dive's path (and somersaults). */
  private divePose() {
    const t = this.diveAir() - this.diveT;
    const wait = 0.4 * +(this.diveLift > 0);
    const k = Math.max(0, (t - wait) / (this.diveAir() - wait));
    const path = this.divePath;
    const headAt = this.diveFrom + (path.head - this.diveFrom) * k ** 1.5;
    const len = this.diveFrom - path.start;
    for (let i = 0; i < N; i++) this.diveSample(headAt - ((N - 1 - i) / (N - 1)) * len, this.target[i], this.ups[i]);
    if (this.diveLift > 0 && t < 0.24) {
      // off the chafer's back: it first drops down to the path
      const drop = this.diveLift * (1 - Math.min(1, t / 0.24)) ** 2;
      for (const q of this.target) q.addScaledVector(this.leapN, -drop);
    }
    if (this.diveFlip) {
      const s = Math.min(1, k / 0.8);
      const ang = -(Math.PI * 2) * s * s * (3 - 2 * s);
      const axis = this.tmpN.copy(this.diveSide).applyAxisAngle(this.leapN, this.diveYaw * s);
      const mid = this.tmp2.copy(this.target[N >> 1]);
      for (let i = 0; i < N; i++) {
        this.target[i].sub(mid).applyAxisAngle(axis, ang).add(mid);
        this.ups[i].applyAxisAngle(axis, ang);
      }
    }
    for (let i = 0; i < N; i++) {
      const q = this.target[i];
      if (appleF(q) < 0.5 * this.SEG_R && k < 0.9) appleProject(q).addScaledVector(appleNormal(q, this.tmpN), 0.5 * this.SEG_R);
    }
  }

  /** Into the skin: inside now, going on by itself a little (or, in the arena, straight through). */
  private diveIn() {
    const path = this.divePath;
    const len = this.diveFrom - path.start;
    this.trail.p.length = this.trail.n.length = this.trail.d.length = 0;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let s = path.head - len - 0.3; s <= path.head; s += 0.01) {
      this.diveSample(s, p, n);
      this.trail.push(p, n);
    }
    this.diveAt.sub(this.diveP).applyAxisAngle(this.leapN, this.diveYaw).add(this.diveP);
    appleProject(this.diveAt);
    this.diveDir.applyAxisAngle(this.leapN, this.diveYaw);
    this.mode = 'dig';
    this.p.copy(this.diveAt).addScaledVector(appleNormal(this.diveAt, this.tmpN), 0.5 * this.SEG_R);
    this.d.copy(this.diveDir);
    this.right.crossVectors(this.d, this.tmpN);
    if (this.right.lengthSq() < 1e-6) this.right.crossVectors(this.d, this.tmp2.set(0, 1, 0));
    this.right.normalize();
    this.u.crossVectors(this.right, this.d).normalize();
    this.travel = 0;
    this.entered = false;
    this.sinceEntry = 0;
    this.lastTunnelPt = null;
    this.pulledBack = false;
    if (this.diveGnaw) {
      this.diveLeft = 0.55 * this.L;
      this.diveBoost = 1;
      this.diveGnaw = false;
      this.diveSpan = 0;
    } else if (this.arena) {
      this.rocketing = true;
      this.through = true;
      this.throughDir.copy(this.d);
      this.diveLeft = 0;
    } else {
      this.diveLeft = 1.2 * this.L;
      // as fast as it came down at first
      this.diveBoost = Math.max(1, ((path.head - this.diveFrom) * 1.5) / this.diveAir() / (DIG_SPEED * this.growth));
    }
    this.events.tunnelStart?.(TUNNEL_R0 * girth(this.growth));
  }

  /** WW inside: a rocket — straight out of the fruit, knocking everything aside, and a leap out of the hole. */
  rocket() {
    if (this.mode !== 'dig' || this.rocketing || this.down) return false;
    this.rocketing = true;
    return true;
  }

  /** Arena, on the skin: up and down head first, straight through the fruit. */
  arenaStrike() {
    if (!this.arena || this.down || this.mode !== 'surface' || this.strikeT > 0 || this.airborne) return false;
    this.leapP.copy(this.pS);
    this.leapN.copy(this.n);
    this.leapF.copy(this.f);
    this.strikeT = STRIKE_TIME;
    return true;
  }

  /** The strike comes down: in, straight towards the centre and through. */
  private plunge() {
    const { p, d, u, right } = this;
    this.mode = 'dig';
    this.rocketing = true;
    this.through = true;
    p.copy(this.leapP).addScaledVector(this.leapF, 1.4 * this.L);
    appleProject(p);
    const n = appleNormal(p, this.tmpN);
    p.addScaledVector(n, this.SEG_R);
    this.throughDir.copy(n).negate();
    d.copy(this.throughDir);
    right.crossVectors(d, this.leapF);
    if (right.lengthSq() < 1e-6) right.crossVectors(d, this.tmp2.set(0, 1, 0));
    right.normalize();
    u.crossVectors(right, d).normalize();
    this.travel = 0;
    this.entered = false;
    this.sinceEntry = 0;
    this.lastTunnelPt = null;
    this.pulledBack = false;
    this.stopStrikes();
    this.events.tunnelStart?.(TUNNEL_R0 * girth(this.growth));
  }

  /** The strike: up, over, head first down ahead. */
  private strikePose() {
    const t = 1 - this.strikeT / STRIKE_TIME;
    const { leapP, leapN, leapF, L } = this;
    const up = Math.sin(Math.PI * t);
    const tilt = t < 0.22 ? (Math.PI / 2) * (1 - t / 0.22) : ((t - 0.22) / 0.78) * Math.PI;
    const head = this.tmp.copy(leapP).addScaledVector(leapN, 0.2 * L + 0.9 * L * up).addScaledVector(leapF, t * L * 1.4);
    const along = this.rearDir.copy(leapN).multiplyScalar(Math.cos(tilt)).addScaledVector(leapF, Math.sin(tilt));
    const bodyUp = this.rearUp.copy(leapN).multiplyScalar(Math.sin(tilt)).addScaledVector(leapF, -Math.cos(tilt));
    for (let k = 0; k < N; k++) {
      const back = ((N - 1 - k) / (N - 1)) * L;
      const q = this.target[k].copy(head).addScaledVector(along, -back).addScaledVector(bodyUp, 0.12 * L * Math.sin((Math.PI * back) / L));
      if (appleF(q) < 0.5 * this.SEG_R) appleProject(q).addScaledVector(appleNormal(q, this.tmpN), this.SEG_R);
      this.ups[k].copy(bodyUp);
    }
  }

  private emitHole() {
    const q = appleProject(this.p.clone());
    const nn = appleNormal(q, new THREE.Vector3());
    this.events.hole?.([q.x, q.y, q.z, nn.x, nn.y, nn.z, HOLE_R0 * girth(this.growth)].map(r3));
  }

  private toSurface() {
    const { pS, n, f, p, d, u } = this;
    this.mode = 'surface';
    pS.copy(p);
    appleProject(pS);
    appleNormal(pS, n);
    f.copy(d).addScaledVector(n, -d.dot(n));
    if (f.lengthSq() < 1e-4) f.copy(u).addScaledVector(n, -u.dot(n));
    f.normalize();
    this.phase = 0;
    this.trail.push(this.tmp.copy(pS).addScaledVector(n, this.SEG_R), n);
    this.tailDist = this.trail.head - this.L;
  }

  // ---------- body ----------

  private updateBody(dt: number) {
    const { trail, target, ups, L, SPACING } = this;
    if (this.mode === 'surface') {
      const gap = trail.head - this.tailDist;
      const h = 0.45 * Math.sqrt(Math.max(0, L * L - gap * gap));
      for (let k = 0; k < N; k++) {
        const t = k / (N - 1);
        trail.sample(this.tailDist + t * gap, target[k], this.tmpN);
        target[k].addScaledVector(this.tmpN, h * Math.sin(Math.PI * t));
        ups[k].copy(this.tmpN);
      }
      this.bendNose();
      if (this.leapT > 0) this.leapPose();
      if (this.strikeT > 0) this.strikePose();
      if (this.diveT > 0) this.divePose();
      if (this.rear > 0.001) this.rearUpPose();
      // held by the earwig: lifted (in its pincers, or just off the skin)
      const lifted = this.held && (this.heldAt || this.heldAt === undefined) ? 1 : 0;
      this.heldLift += (lifted - this.heldLift) * Math.min(1, (1 / 60) * (lifted ? 14 : 6));
      if (this.heldLift > 0.002) this.heldPose();
      if (this.emergeT > 0) {
        // a new round: it comes up out of the skin, head first
        this.emergeT = Math.max(0, this.emergeT - 1 / 60);
        const t = 1 - this.emergeT / EMERGE_TIME;
        for (let k = 0; k < N; k++) {
          const e = Math.min(1, Math.max(0, 1.6 * t - ((N - 1 - k) / (N - 1)) * 0.6));
          this.target[k].addScaledVector(this.ups[k], -(1 - (1 - (1 - e) ** 2)) * this.SEG_R * 2.6);
        }
      }
      if (this.wag && !this.wag.both) this.writhePose();
      if (this.wag && this.wag.v) this.wagPose();
      this.rideLift += (+!!this.rideAt - this.rideLift) * Math.min(1, (1 / 60) * 10);
      if (this.rideAt) {
        if (this.rideLift > 0.002) this.ridePose(dt);
      } else if (this.rideFlip >= 0 || this.rideWasRunning) {
        this.rideFlip = -1;
        this.rideWasRunning = false;
      }
      if (this.shakeT > 0) this.shakePose(dt);
      if (this.whipT > 0) this.whipPose(dt);
      if (this.slamT > 0) this.slamPose(dt);
      if (this.clapT > 0) this.clapPose(dt);
      if (this.jumpT > 0) {
        // a hop: up and down along an arc, the head a little higher (pushed off the tail), a little arch at the start
        const t = 1 - this.jumpT / JUMP_TIME;
        const h = 4 * JUMP_H * this.L * t * (1 - t);
        const arch = t < 0.22 ? 0.16 * this.L * Math.sin((t / 0.22) * Math.PI) : 0;
        for (let k = 0; k < N; k++) this.target[k].addScaledVector(this.ups[k], h * (0.75 + 0.25 * (k / (N - 1))) + arch * Math.sin((Math.PI * k) / (N - 1)));
      }
      if (this.landT > 0) {
        // landing: the ends bounce (after a backflip the middle humps)
        this.landT = Math.max(0, this.landT - dt);
        const t = 1 - this.landT / LAND_TIME;
        const ends = 0.22 * this.L * Math.abs(Math.sin(Math.PI * 2 * t)) * Math.exp(-3 * t);
        const hump = this.landHump ? 0.22 * this.L * Math.sin(Math.PI * t) * Math.exp(-1.5 * t) : 0;
        for (let k = 0; k < N; k++) {
          const s = k / (N - 1);
          this.target[k].addScaledVector(this.ups[k], ends * (1 - Math.sin(Math.PI * s)) + hump * Math.sin(Math.PI * s));
        }
        if (this.landT === 0) this.landHump = false;
      }
      if (this.swipeT > 0) this.swipePose(dt);
      if (this.lungeT > 0) this.lungePose(dt);
    } else {
      let spacing = SPACING;
      if (this.squeezeT > 0) {
        this.squeezeT = Math.max(0, this.squeezeT - dt);
        spacing *= 1 - 0.4 * Math.sin(Math.PI * (1 - this.squeezeT / SQUEEZE_TIME));
      }
      for (let k = 0; k < N; k++) trail.sample(trail.head - (N - 1 - k) * spacing, target[k], ups[k]);
    }
    if (this.mode === 'surface') this.lookAbout(dt);
    if (this.bitterAt >= 0) this.shiver(dt);
    this.smoothBody();
    this.unbreak(dt);
    if (this.swatT > 0) this.swatPose(dt);
    if (this.flipT > 0) this.flipPose(dt);
    const a = damp(dt, this.swatT > 0 || this.flipT > 0 ? 55 : 22);
    for (let k = 0; k < N; k++) {
      if (!this.placed) this.disp[k].copy(target[k]);
      else this.disp[k].lerp(target[k], a);
    }
    this.placed = true;
  }

  /**
   * Lying still 10 s: it looks about — the head left, then right, then up (a sigh), down, and again
   * (a 7 s cycle).
   */
  private lookAbout(dt: number) {
    if (this.rideFlip >= 0) return;
    this.lookW += (+(this.idleT > 10) - this.lookW) * damp(dt, 3);
    if (this.lookW < 0.01) {
      this.sigh = 0;
      return;
    }
    const w = this.lookW;
    const t = (((this.idleT - 10) % 7) + 7) % 7;
    const go = (from: number, to: number, a: number, b: number) => from + (to - from) * smooth01((t - a) / (b - a));
    let side = 0;
    let lift = 1;
    let sigh = 0;
    if (t < 0.35) {
      side = go(0, -1, 0, 0.35);
      lift = go(0, 1, 0, 0.35);
    } else if (t < 1.6) side = -1;
    else if (t < 1.95) side = go(-1, 1, 1.6, 1.95);
    else if (t < 3.2) side = 1;
    else if (t < 4.3) {
      side = go(1, 0, 3.2, 4.3);
      sigh = go(0, 1, 3.2, 4.3);
    } else if (t < 5.5) {
      sigh = go(1, 0, 4.3, 5.5);
      lift = go(1, 0, 4.3, 5.5);
    } else lift = 0;
    this.sigh = w * sigh;
    const across = this.bendAxis.crossVectors(this.f, this.ups[6]).normalize();
    this.bend(6, 1, across, (j) => w * lift * 0.22 * (j < 2 ? 1 : 0.4));
    const up = this.bendAxis.copy(this.ups[6]);
    this.bend(6, 1, up, (j) => w * side * 0.8 * (j === 0 ? 0.5 : 0.25));
  }

  /** Turns to face (`end`) towards / away from `at` (a ladybug holding it), lying straight. */
  alignTo(at: THREE.Vector3, end: 'head' | 'tail', dt: number) {
    if (this.mode !== 'surface' || this.slamT > 0 || this.clapT > 0) return;
    const n = appleNormal(this.pS, this.tmpN);
    const e = end === 'head' ? this.disp[N - 1] : this.disp[0];
    const want = end === 'head' ? this.tmp2.subVectors(at, e) : this.tmp2.subVectors(e, at);
    want.addScaledVector(n, -want.dot(n));
    if (want.lengthSq() < 1e-8) return;
    this.f.lerp(want.normalize(), Math.min(1, dt * 6)).normalize();
    this.layStraight();
  }

  /** Held at both ends: it's pulled straight (along where it lies). */
  straighten(dt: number) {
    if (this.mode !== 'surface' || this.slamT > 0 || this.clapT > 0) return;
    const n = appleNormal(this.pS, this.tmpN);
    const along = this.tmp2.subVectors(this.disp[N - 1], this.disp[0]);
    along.addScaledVector(n, -along.dot(n));
    if (along.lengthSq() < 1e-8) return;
    along.normalize();
    if (this.f.dot(along) > 0.999 && this.disp[N - 1].distanceTo(this.disp[0]) > 0.97 * this.L) return;
    this.f.lerp(along, Math.min(1, dt * 4)).normalize();
    this.layStraight();
  }

  /** Held by two ladybugs: claps its ends (and them) together. */
  clap() {
    if (this.mode !== 'surface' || this.clapT > 0) return false;
    this.clapT = CLAP_TIME;
    return true;
  }

  private clapPose(dt: number) {
    const before = this.clapT;
    this.clapT = Math.max(0, this.clapT - dt);
    const t = 1 - this.clapT / CLAP_TIME;
    const e = t < 0.45 ? (t / 0.45) ** 1.6 : 1 - smooth01((t - 0.45) / 0.55);
    const across = this.bendAxis.crossVectors(this.f, this.ups[5]).normalize();
    const fold = 0.95 * Math.PI * e;
    this.bend(5, 1, across, () => fold / 4);
    this.bend(5, -1, this.bendAxis.crossVectors(this.f, this.ups[5]).normalize(), () => -fold / 5);
    if (before > CLAP_TIME * 0.55 && this.clapT <= CLAP_TIME * 0.55) this.events.impact?.(this.tmp.addVectors(this.target[0], this.target[N - 1]).multiplyScalar(0.5));
  }

  /** Riding: a lash with the tail (to spur the chafer): up and over, or to one side (not the same twice). */
  rideLash() {
    this.rideLashT = RIDE_LASH;
    const sides = [-1, 0, 1].filter((s) => s !== this.rideLashSide);
    this.rideLashSide = sides[Math.floor(Math.random() * sides.length)];
  }

  /** On the chafer's back: holding on by the head, the tail flapping in the wind as it runs. */
  private ridePose(dt: number) {
    const { at, f, up, running } = this.rideAt!;
    this.rideLashT = Math.max(0, this.rideLashT - dt);
    if (running) {
      this.rideWasRunning = true;
      this.rideFlip = -1;
    } else if (this.rideWasRunning) {
      // it stopped: thrown forward over its head
      this.rideWasRunning = false;
      this.rideFlip = 0;
    }
    if (this.rideFlip >= 0) {
      this.rideFlip += dt;
      this.rideFlipPose(at, f, up, Math.min(1, this.rideFlip / RIDE_FLIP));
      if (this.rideFlip >= RIDE_FLIP) this.rideFlip = -1;
      return;
    }
    const time = performance.now() / 1000;
    const w = this.rideLift;
    /** Smooth value noise, −1…1. */
    const noise = (x: number, seed: number) => {
      const i = Math.floor(x);
      const fr = x - i;
      const h = (k: number) => {
        const v = Math.sin(k * 127.1 + seed * 311.7) * 43758.5453;
        return (v - Math.floor(v)) * 2 - 1;
      };
      return THREE.MathUtils.lerp(h(i), h(i + 1), fr * fr * (3 - 2 * fr));
    };
    const side = this.tmp2.crossVectors(up, f).normalize();
    for (let k = 0; k < N; k++) {
      const back = (N - 1 - k) / (N - 1);
      const q = this.tmp.copy(at).addScaledVector(f, -back * this.L * 0.85).addScaledVector(up, 0.8 * this.SEG_R - back * back * this.L * 0.12);
      if (this.rideLashT > 0) {
        const t = 1 - this.rideLashT / RIDE_LASH;
        const e = Math.sin(Math.PI * Math.pow(t, 0.6));
        const b2 = back * back;
        const snap = Math.exp(-(((t - 0.75) / 0.12) ** 2));
        if (this.rideLashSide === 0) {
          q.addScaledVector(up, e * (0.4 * back + 0.9 * b2) * this.L);
          q.addScaledVector(f, e * b2 * this.L * 0.4);
        } else {
          q.addScaledVector(side, e * b2 * this.L * 0.85 * this.rideLashSide);
          q.addScaledVector(up, e * back * this.L * 0.35);
        }
        q.addScaledVector(f, -snap * b2 * back * this.L * 0.45);
      } else if (running) {
        // flapping in the wind
        q.addScaledVector(side, noise(time * 7 - back * 0.7, 1) * back * back * this.L * 0.4);
        q.addScaledVector(up, (noise(time * 4.5 - back * 0.5, 2) + 1) * back * this.L * 0.32);
        q.addScaledVector(f, noise(time * 5 - back * 0.4, 3) * back * back * this.L * 0.1);
      } else q.addScaledVector(side, Math.sin(time * 1.5 + k * 0.5) * back * this.L * 0.03);
      this.target[k].lerp(q, w);
      this.ups[k].lerp(up, w).normalize();
    }
  }

  /** Thrown off the stopping chafer: a somersault forward, landing on it (keyframed, t 0…1). */
  private rideFlipPose(at: THREE.Vector3, f: THREE.Vector3, up: THREE.Vector3, t: number) {
    const axis = this.bendAxis.crossVectors(up, f);
    if (axis.lengthSq() < 1e-8) return;
    axis.normalize();
    // [time, how far over the neck bends, how much more each joint after]
    const KEYS = [
      [0, 0, 0],
      [0.2, 2.8, 0],
      [0.38, 2.8, -0.22],
      [0.55, 2.55, -0.45],
      [0.72, 1.5, -0.22],
      [0.86, 0.55, -0.06],
      [1, 0, 0],
    ];
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const k = smooth01((t - a[0]) / (b[0] - a[0] || 1));
    const over = a[1] + (b[1] - a[1]) * k;
    const each = a[2] + (b[2] - a[2]) * k;
    const L = this.L;
    const link = (0.85 * L) / (N - 1);
    const lift = 0.8 * this.SEG_R;
    const sag = Math.max(0, 1 - over / 1.2);
    const w = this.rideLift;
    const p = this.rearP.copy(at).addScaledVector(up, lift);
    for (let j = 0; j < N; j++) {
      const ball = N - 1 - j; // from the head back
      const s = j / (N - 1);
      const q = this.tmp.copy(p).addScaledVector(up, -s * s * L * 0.12 * sag);
      this.target[ball].lerp(q, w);
      const r = Math.min(1, j / 2);
      let ang = over * (0.08 + r * r * (3 - 2 * r) * 0.92);
      if (j >= 2) ang += each * (j - 2);
      this.rearUp.copy(up).applyAxisAngle(axis, ang);
      this.ups[ball].lerp(this.rearUp, w).normalize();
      if (j === N - 1) break;
      p.addScaledVector(f, -Math.cos(ang) * link).addScaledVector(up, Math.sin(ang) * link);
    }
  }

  /** Held by one end: the rest of the body writhes (a wave running out to the free end). */
  private writhePose() {
    const from = this.wag!.end === 'head' ? N - 1 : 0;
    const dir = from === N - 1 ? -1 : 1;
    const time = performance.now() / 1000;
    for (let j = 1; j < N; j++) {
      const k = from + dir * j;
      const prev = this.target[k - dir];
      const link = this.tmp.subVectors(this.target[k], prev);
      const side = this.tmp2.crossVectors(this.ups[k], link);
      if (side.lengthSq() < 1e-10) continue;
      side.normalize();
      const s = j / (N - 1);
      const wave = Math.sin(time * 3.4 - j * 0.9) + 0.4 * Math.sin(time * 5.3 - j * 1.4 + 1);
      this.target[k].addScaledVector(side, wave * s * s * this.L * 0.07);
    }
  }

  /** Wagged by whatever holds an end: the whole body swings round a point just beyond that end. */
  private wagPose() {
    const { end, v, reach, both } = this.wag!;
    const e = end === 'head' ? N - 1 : 0;
    const dir = end === 'head' ? -1 : 1;
    const t = this.target;
    const up = this.bendAxis.copy(this.ups[e]);
    const out = this.tmp2.subVectors(t[e], t[e + dir]);
    out.addScaledVector(up, -out.dot(up));
    if (out.lengthSq() < 1e-8) return;
    const pivot = this.rearP.copy(t[e]).addScaledVector(out.normalize(), reach ?? this.SEG_R);
    const ang = 0.45 * v;
    for (let j = 0; j < N; j++) {
      const k = e + dir * j;
      const s = j / (N - 1);
      const w = both ? (1 - s) ** 2 : 1 - 0.4 * s * s; // held at both ends: only its own end swings
      t[k].sub(pivot).applyAxisAngle(up, ang * w).add(pivot);
      this.ups[k].applyAxisAngle(up, ang * w);
    }
  }

  /** Held by the earwig: hanging across its pincers, wriggling (or lifted off the skin where it is). */
  private heldPose() {
    const time = performance.now() / 1000;
    const w = this.heldLift;
    if (this.heldAt) {
      const { tip, side, up } = this.heldAt;
      const link = 0.95 * this.SPACING;
      for (let k = 0; k < N; k++) {
        const s = (k - (N - 1) / 2) / ((N - 1) / 2); // −1…1 along the body, held in the middle
        const q = this.tmp
          .copy(tip)
          .addScaledVector(side, 4.5 * s * link * 0.8 + 0.03 * Math.sin(time * 6 + k) * this.L * Math.abs(s))
          .addScaledVector(up, -s * s * this.L * 0.3 + 0.04 * Math.sin(time * 8 + k * 1.3) * this.L * Math.abs(s));
        this.target[k].lerp(q, w);
        this.ups[k].lerp(up, w).normalize();
      }
      return;
    }
    const lens = this.heldLens;
    for (let k = 1; k < N; k++) lens[k] = this.target[k].distanceTo(this.target[k - 1]);
    for (let k = 0; k < N; k++) {
      const s = k / (N - 1);
      const lift = this.L * (0.55 + 0.45 * Math.sin(Math.PI * s)) * w;
      const along = this.tmp.subVectors(this.target[Math.min(N - 1, k + 1)], this.target[Math.max(0, k - 1)]);
      const side = this.tmp2.crossVectors(along, this.ups[k]);
      if (side.lengthSq() > 1e-10) side.normalize();
      this.target[k].addScaledVector(this.ups[k], lift).addScaledVector(side, 0.1 * Math.sin(time * 7 + k * 0.9) * this.L * w * (1 - 0.7 * Math.sin(Math.PI * s)));
    }
    // keep the links their length, out from the middle
    for (let k = 6; k < N; k++) {
      const l = this.tmp.subVectors(this.target[k], this.target[k - 1]);
      if (l.lengthSq() > 1e-12) this.target[k].copy(this.target[k - 1]).addScaledVector(l.normalize(), lens[k]);
    }
    for (let k = 4; k >= 0; k--) {
      const l = this.tmp.subVectors(this.target[k], this.target[k + 1]);
      if (l.lengthSq() > 1e-12) this.target[k].copy(this.target[k + 1]).addScaledVector(l.normalize(), lens[k + 1]);
    }
  }

  /** A bitter seed: a shiver runs down the body, head to tail, with the swallowing wave. */
  private shiver(dt: number) {
    this.bitterAt += dt / PULSE_TIME;
    if (this.bitterAt >= N - 1 + PULSE_WIDTH) {
      this.bitterAt = -1;
      return;
    }
    const at = N - 1 - this.bitterAt + 1.2;
    const jitter = Math.sin(this.bitterAt * PULSE_TIME * 55);
    const fade = 1 - 0.5 * (this.bitterAt / (N - 1 + PULSE_WIDTH));
    for (let k = 0; k < N; k++) {
      const w = 1 - Math.abs(k - at) / 2.2;
      if (w <= 0) continue;
      const along = this.tmp.subVectors(this.target[Math.min(N - 1, k + 1)], this.target[Math.max(0, k - 1)]);
      const side = this.tmp2.crossVectors(along, this.ups[k]);
      if (side.lengthSq() < 1e-10) continue;
      side.normalize();
      this.target[k].addScaledVector(side, jitter * w * fade * 0.07 * this.L);
    }
  }

  /**
   * No sharp kinks: a joint bent more than a limit is eased towards the middle of its neighbours
   * (a few passes), then the links get their lengths back from the head down.
   */
  private smoothBody() {
    const t = this.target;
    const lens = this.linkLens;
    for (let k = 1; k < N; k++) lens[k] = t[k].distanceTo(t[k - 1]);
    // the limit: tighter while hopping forward on the tail and in the somersault off the chafer
    const limit = Math.cos(0.55 + 0.8 * (this.mode === 'surface' && this.rear > 0.5 ? Math.max(0, this.hopState()[1]) : 0) + 1.05 * +(this.rideFlip >= 0));
    for (let pass = 0, again = true; pass < N && (pass < 4 || again); pass++) {
      again = false;
      for (let k = 1; k < N - 1; k++) {
        const a = this.tmp.subVectors(t[k], t[k - 1]);
        const b = this.tmp2.subVectors(t[k + 1], t[k]);
        const la = a.length();
        const lb = b.length();
        if (la < 1e-6 || lb < 1e-6) continue;
        const c = a.dot(b) / (la * lb);
        if (c >= limit) continue;
        if (c < limit - 0.35) again = true;
        const w = Math.min(0.5, (limit - c) * 0.9);
        this.tmp3.addVectors(t[k - 1], t[k + 1]).multiplyScalar(0.5);
        t[k].lerp(this.tmp3, w);
      }
    }
    for (let k = N - 2; k >= 0; k--) {
      const l = this.tmp.subVectors(t[k], t[k + 1]);
      const len = l.length();
      if (len > 1e-6) t[k].copy(t[k + 1]).addScaledVector(l, lens[k + 1] / len);
    }
  }

  /** The front bends towards the steering direction right away; the body follows as it crawls. */
  private bendNose() {
    const { target, ups, f, bendT, bendC } = this;
    const PIV = N - 4;
    bendT.subVectors(target[N - 1], target[N - 2]);
    bendT.addScaledVector(ups[N - 1], -bendT.dot(ups[N - 1]));
    if (bendT.lengthSq() < 1e-10) return;
    bendT.normalize();
    bendC.crossVectors(bendT, f);
    const ang = Math.max(-0.9, Math.min(0.9, Math.atan2(bendC.dot(ups[N - 1]), bendT.dot(f))));
    for (let k = PIV + 1; k < N; k++) {
      const w = (k - PIV) / (N - 1 - PIV);
      bendC.subVectors(target[k], target[PIV]).applyAxisAngle(ups[k], ang * w * 0.8);
      target[k].copy(target[PIV]).add(bendC);
    }
  }

  /**
   * Bends the body like a spine: walking from ball `from` towards the end in direction `dir` (±1),
   * every joint turns the rest of the chain by `perJoint(j)` radians about `axis`. The balls keep their
   * spacing, so the moving part sweeps along an arc instead of sliding sideways.
   */
  private bend(from: number, dir: 1 | -1, axis: THREE.Vector3, perJoint: (j: number) => number) {
    const t = this.target;
    const orig = this.bendTmp;
    for (let k = 0; k < N; k++) orig[k].copy(t[k]);
    let angle = 0;
    for (let k = from + dir, j = 0; k >= 0 && k < N; k += dir, j++) {
      angle += perJoint(j);
      this.bendVec.subVectors(orig[k], orig[k - dir]).applyAxisAngle(axis, angle);
      t[k].copy(t[k - dir]).add(this.bendVec);
    }
  }

  /**
   * The slam: the free end (with the ladybug on it) goes up, over to one side round the held end,
   * and down on the skin; a wave of delay runs along the body; then back to lying.
   */
  private slamPose(dt: number) {
    const before = this.slamAge;
    this.slamAge += dt;
    this.slamT = Math.max(0, this.slamT - dt);
    const age = this.slamAge;
    const head = this.slamEnd === 'head';
    const end = head ? N - 1 : 0;
    const t = this.target;
    const base = slamBase.copy(t[head ? 0 : N - 1]);
    const up = appleNormal(base, slamUp);
    const out = slamOut.subVectors(t[end], base);
    out.addScaledVector(up, -out.dot(up)).normalize();
    const side = slamSide.crossVectors(up, out);
    const fade = this.slamFresh ? Math.min(1, age / 0.08) : 1;
    for (let k = 0; k < N; k++) (slamWas[k] ??= new THREE.Vector3()).copy(t[k]);
    let prev = base;
    let along = 0;
    let total = 0;
    for (let j = 1; j < N; j++) total += slamWas[head ? j : N - 1 - j].distanceTo(slamWas[head ? j - 1 : N - j]);
    for (let j = 1; j < N; j++) {
      const k = head ? j : N - 1 - j;
      const kPrev = head ? j - 1 : N - j;
      const link = slamWas[k].distanceTo(slamWas[kPrev]);
      along += link;
      const s = along / total;
      const [lift, az, back] = this.slamAt(age - 0.11 * s ** 1.5);
      const c = Math.cos(lift);
      const dir = slamDir.copy(out).multiplyScalar(c * Math.cos(az)).addScaledVector(side, c * Math.sin(az)).addScaledVector(up, Math.sin(lift));
      const q = slamTo.copy(prev).addScaledVector(dir, link);
      if (appleF(q) < 0) appleProject(q);
      const w = fade * (1 - back);
      t[k].lerpVectors(slamWas[k], q, w);
      prev = t[k];
    }
    if (before < SLAM_HIT && age >= SLAM_HIT) this.events.impact?.(t[end], 'slam');
  }

  /** The "C" jerk: both halves curl to the same side, the ends the most (a quick start, a slow return). */
  private shakePose(dt: number) {
    this.shakeT = Math.max(0, this.shakeT - dt);
    const t = 1 - this.shakeT / SHAKE_TIME;
    const e = t < 0.3 ? (t / 0.3) ** 2 : 1 - smooth01((t - 0.3) / 0.7);
    const mid = N >> 1;
    const up = this.bendAxis.copy(this.ups[mid]);
    const a = this.shakeSide * 0.22 * e;
    this.bend(mid, 1, up, () => a);
    this.bend(mid, -1, up, () => -a);
  }

  /** A bite: the head lunges at the target (and dips in), then back. */
  private lungePose(dt: number) {
    const before = this.lungeT;
    this.lungeT = Math.max(0, this.lungeT - dt);
    const t = 1 - this.lungeT / LUNGE_TIME;
    const e = t < 0.32 ? Math.sin((Math.PI / 2) * (t / 0.32)) : t < 0.5 ? 1 : 1 - smooth01((t - 0.5) / 0.5);
    const head = this.target[N - 1];
    const to = this.tmp.subVectors(this.lungeAt, head);
    const len = to.length();
    if (len < 1e-6) return;
    to.multiplyScalar(Math.min(len, 0.7 * this.L) / len);
    const dip = t > 0.256 && t < 0.55 ? Math.sin(((t - 0.256) / 0.294) * Math.PI) : 0;
    for (let j = 0; j < 5; j++) {
      const k = N - 1 - j;
      const w = ((5 - j) / 5) ** 1.6;
      this.target[k].addScaledVector(to, e * w);
      this.target[k].addScaledVector(this.ups[k], -0.12 * dip * this.L * w);
    }
    if (before > LUNGE_TIME * 0.68 && this.lungeT <= LUNGE_TIME * 0.68) this.events.impact?.(this.lungeAt, 'bite');
  }

  /** Most of the body (from just behind the head) sweeps out to one side along a wide arc (a little wind-up first). */
  private swipePose(dt: number) {
    this.swipeT = Math.max(0, this.swipeT - dt);
    const t = 1 - this.swipeT / SWIPE_TIME;
    let e: number;
    if (t < 0.3) e = -0.25 * smooth01(t / 0.3);
    else if (t < 0.55) {
      const k = (t - 0.3) / 0.25;
      e = -0.25 + 1.25 * k * k;
    } else e = 1 - smooth01((t - 0.55) / 0.45);
    const pivot = N - 3; // the head and neck stay, the rest lashes
    const up = this.bendAxis.copy(this.ups[pivot]);
    this.bend(pivot, -1, up, (j) => this.swipeSide * e * (0.27 + 0.025 * j));
  }

  /**
   * The lash: lies straight from the held end, then the free end whips up and over onto whatever
   * holds the other end (a wild one: sideways, short of it), the tip stretching at the end.
   */
  private whipPose(dt: number) {
    const before = this.whipT;
    this.whipT = Math.max(0, this.whipT - dt);
    const s = 1 - this.whipT / WHIP_TIME;
    const e = s <= 0 ? 0 : s < 0.55 ? (s / 0.55) ** 2.4 : 1 - smooth01((s - 0.55) / 0.45);
    // first lie straight and flat from the held end (a bent body would strike crooked)
    const held = this.whipEnd === 'tail' ? N - 1 : 0;
    const away = this.rearDir.copy(this.f).multiplyScalar(held === N - 1 ? -1 : 1); // towards the free end
    const w = Math.min(1, e * 3);
    const base = this.rearP;
    for (let k = 0; k < N; k++) {
      base.copy(this.target[held]).addScaledVector(away, Math.abs(k - held) * this.SPACING);
      this.target[k].lerp(base, w);
      this.ups[k].lerp(this.ups[held], w).normalize();
    }
    // then every joint from the held end curls the rest up and over, a wave running to the tip
    const across = this.bendAxis.crossVectors(this.f, this.ups[N >> 1]).normalize();
    const dir: 1 | -1 = this.whipEnd === 'tail' ? -1 : 1;
    const sign = this.whipEnd === 'tail' ? -1 : 1;
    const fold = 5.4 * Math.min(1.1, this.whipFold);
    const curl = (j: number) => {
      const k = s < 0.62 ? Math.min(1, Math.max(0, (s - 0.045 * j) / 0.26)) ** 2.4 : 1 - smooth01((s - 0.62) / 0.38);
      return ((0.6 + (0.8 * j) / 8) / 9) * fold * k;
    };
    const wild = this.whipSide !== 0;
    this.bend(held, dir, across, (j) => sign * curl(j) * (wild ? 0.3 : 1));
    const up = this.bendAxis.copy(this.ups[held]);
    this.bend(held, dir, up, (j) => (wild ? this.whipSide * curl(j) * 0.95 : (curl(j) / fold) * this.whipAim));
    const snap = Math.exp(-(((s - 0.62) / 0.12) ** 2));
    if (snap > 0.01) this.stretchFrom(held, dir, 0.35 * snap);
    // the moment it lands
    if (before > WHIP_HIT && this.whipT <= WHIP_HIT && this.whipHit) this.events.impact?.(this.target[this.whipEnd === 'tail' ? 0 : N - 1]);
  }

  /** Stretches the links from ball `from` outwards in direction `dir` (more towards the tip). */
  private stretchFrom(from: number, dir: 1 | -1, k: number) {
    const t = this.target;
    let was = sA.copy(t[from]);
    const now = sB.copy(t[from]);
    for (let j = 1; j < N; j++) {
      const i = from + dir * j;
      if (i < 0 || i >= N) break;
      const link = sC.subVectors(t[i], was);
      was = was.copy(t[i]);
      t[i].copy(now).addScaledVector(link, 1 + k * (j / (N - 1)) ** 1.5 * 2.5);
      now.copy(t[i]);
    }
  }

  /**
   * A swat from above: standing on its tail, the body arcs up high and comes down on the aim (a critter),
   * then back up; the tail stays put.
   */
  private swatPose(dt: number) {
    const before = this.swatT;
    this.swatT = Math.max(0, this.swatT - dt);
    const t = 1 - this.swatT / SWAT_TIME;
    const tg = this.target;
    const root = swRoot.copy(tg[1]);
    const up = appleNormal(root, swUp);
    const aim = swAim.subVectors(this.swatAim, root);
    aim.addScaledVector(up, -aim.dot(up));
    if (aim.lengthSq() < 1e-8) aim.copy(this.f).addScaledVector(up, -this.f.dot(up));
    if (aim.lengthSq() < 1e-8) aim.set(1, 0, 0);
    aim.normalize();
    const reach = (N - 2) * this.SPACING;
    const high = swHigh.copy(root).addScaledVector(up, 0.96 * reach).addScaledVector(aim, -(0.2 * reach)); // wound up, leaning back
    const hit = swHit.copy(this.swatAim);
    appleProject(hit);
    hit.addScaledVector(appleNormal(hit, swN), this.SEG_R);
    let bow = 0;
    if (t < 0.08) swTip.copy(root).addScaledVector(up, reach).lerp(high, smooth01(t / 0.08));
    else if (t < 0.58) {
      const k = (t - 0.08) / 0.5;
      swTip.copy(high).lerp(hit, 1 - (1 - k) ** 2.4);
      bow = Math.min(1, 3 * k);
    } else {
      const k = smooth01((t - 0.58) / 0.42);
      swTip.copy(hit).lerp(swN.copy(root).addScaledVector(up, 0.9 * reach), k);
      bow = 1 - k;
    }
    const swing = swDir.subVectors(hit, high);
    if (swing.lengthSq() < 1e-8) swing.copy(aim);
    swing.normalize();
    const arm = swArm.subVectors(swTip, root);
    const side = swSide.crossVectors(up, aim);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    // the body bows out (along the swing, never below the horizon much)
    const out = swBow.crossVectors(side, arm);
    if (out.dot(swing) < 0) out.negate();
    if (out.dot(up) < 0.35) out.addScaledVector(up, 0.35 - out.dot(up));
    if (out.lengthSq() < 1e-8) out.copy(up);
    out.normalize();
    const ctrl = swCtrl.addVectors(root, swTip).multiplyScalar(0.5).addScaledVector(out, bow * this.L * 0.42);
    for (let j = 1; j <= N - 2; j++) {
      const s = j / (N - 2);
      const k = 1 + j;
      const r = 1 - s;
      const q = tg[k].set(0, 0, 0).addScaledVector(root, r * r).addScaledVector(ctrl, 2 * r * s).addScaledVector(swTip, s * s);
      if (appleF(q) < 0.35 * this.SEG_R) appleProject(q).addScaledVector(appleNormal(q, swN), this.SEG_R);
      this.ups[k].copy(up);
    }
    if (before > SWAT_TIME * 0.42 && this.swatT <= SWAT_TIME * 0.42) this.events.impact?.(tg[N - 1], 'swat');
    if (this.swatT === 0) this.beginSwat(); // the next one in the queue
  }

  /** The backflip: a somersault backwards round the middle, lifted; the tail lashes at the bottom of the turn. */
  private flipPose(dt: number) {
    const before = this.flipT;
    this.flipT = Math.max(0, this.flipT - dt);
    const t = 1 - this.flipT / FLIP_TIME;
    const axis = flAxis.crossVectors(this.flipF, this.flipN);
    if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
    axis.normalize();
    const turn = (t < 0.2 ? 0.16 * smooth01(t / 0.2) : t < 0.58 ? 0.16 + ((t - 0.2) / 0.38) * 0.52 : 0.68 + 0.32 * smooth01((t - 0.58) / 0.42)) * Math.PI * 2;
    const mid = this.target[N >> 1];
    const n = appleNormal(mid, flN);
    const lift = 0.72 * this.L * Math.sin(Math.PI * Math.min(1, t / 0.9));
    const centre = flMid.copy(mid).addScaledVector(n, lift + this.SEG_R);
    const lash = Math.exp(-(((t - 0.46) / 0.1) ** 2));
    const link = this.SPACING * (1 + 0.14 * lash);
    const along = (extra: number, out: THREE.Vector3) => out.copy(this.flipF).applyAxisAngle(axis, turn + extra);
    this.target[N >> 1].copy(centre);
    this.ups[N >> 1].copy(this.flipN).applyAxisAngle(axis, turn);
    for (let j = 1; j <= 5; j++) {
      const s = j / 5;
      const front = 5 + j;
      const back = 5 - j;
      if (front < N) {
        this.target[front].copy(this.target[front - 1]).addScaledVector(along(-0.12 * s, flA), link);
        this.ups[front].copy(this.ups[5]);
      }
      if (back >= 0) {
        this.target[back].copy(this.target[back + 1]).addScaledVector(along(0.55 * s * lash + 0.1 * s, flB), -link);
        this.ups[back].copy(this.ups[5]);
      }
    }
    const up = flUp.copy(this.flipN).applyAxisAngle(axis, turn);
    for (let k = 0; k < N; k++) {
      const curve = Math.sin((k / (N - 1)) * Math.PI) * this.L * 0.05;
      const q = this.target[k].addScaledVector(up, -curve);
      if (appleF(q) < 0.45 * this.SEG_R) appleProject(q).addScaledVector(appleNormal(q, flN), this.SEG_R);
    }
    if (before > FLIP_TIME * 0.54 && this.flipT <= FLIP_TIME * 0.54) this.events.impact?.(this.target[0], 'swat');
    if (this.flipT === 0) {
      this.landT = LAND_TIME;
      this.landHump = true;
    }
  }

  /**
   * Tail stays on the skin, the front curls up from ball 1, swaying a little; a hop on the tail
   * lifts it and bends it forward / back.
   */
  private rearUpPose() {
    const { target, ups, f, right } = this;
    const w = ease(Math.min(1, this.rear));
    const rn = this.rearN.copy(ups[1]);
    const [hop, lean] = this.hopState();
    if (hop > 0) for (let k = 0; k <= 1; k++) target[k].addScaledVector(rn, hop * w);
    const rp = this.rearP.copy(target[1]);
    right.crossVectors(f, rn).normalize();
    const time = performance.now() / 1000;
    const sway = (0.07 * Math.sin(time * 1.6) + 0.035 * Math.sin(time * 2.7 + 1)) * w;
    const nod = 0.05 * Math.sin(time * 1.1 + 2) * w;
    for (let k = 2; k < N; k++) {
      const s = (k - 1) / (N - 2);
      // up steeply from the tail, then the front leans forward a bit
      let ang = (s < 0.45 ? 1.75 * (s / 0.45) ** 0.7 : 1.75 - ((s - 0.45) / 0.55) * 0.95) + nod * s;
      if (lean > 0) ang += 1.7 * lean * Math.sin(Math.PI * 2 * s);
      else ang += -((Math.PI / 2 - ang) * lean * +(s > 0.1));
      this.rearDir.copy(f).applyAxisAngle(right, ang).applyAxisAngle(f, sway * s * 2);
      rp.addScaledVector(this.rearDir, this.SPACING * 1.05);
      target[k].lerp(rp, w);
      ups[k].lerp(this.rearUp.copy(rn).applyAxisAngle(right, ang), w).normalize();
    }
  }
}
