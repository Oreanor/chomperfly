import * as THREE from 'three';
import { appleF, appleNormal, appleProject, pushOutOfPit, R0 } from '@/lib/apple';
import { Trail } from './Trail';
import {
  CYCLE, girth, DIG_SPEED, GROWTH_MAX, GROWTH_PER_DIAMETER, HOLE_R0, L0, LC0, N, PULSE_TIME, PULSE_WIDTH,
  SEG_R0, STRAIGHT_HOLD, TUNNEL_R0, TUNNEL_STEP, damp, ease, r3,
} from './constants';

/** What drives a worm this frame (the player's keys or a bot's brain). */
export type SimInput = {
  turn: number; // radians this frame, + = left
  pitch: number; // radians this frame, + = up (inside only)
  forward: boolean;
  speed?: number; // extra speed factor (a seed bonus), 1 = normal
  rear: boolean; // stand up on the tail (on the skin only)
};

export type SimEvents = {
  tunnelStart?: (radius: number) => void;
  tunnelPoint?: (p: THREE.Vector3) => void;
  tunnelEnd?: () => void;
  hole?: (h: number[]) => void; // [x, y, z, nx, ny, nz, radius]
  flown?: () => void; // the victory flight is over, the worm starts again small
  impact?: (at: THREE.Vector3) => void; // a strike landed (the tip of the lashing end)
};

// victory flight timeline (seconds)
const FLY_RISE = 1.2; // rise above the fruit, straightening up
const FLY_GO = 3.2; // wings out + two flaps until here, then off it goes
const FLY_END = 4.4;
const SHAKE_TIME = 0.28;
const WHIP_TIME = 0.45; // long enough to see the swing
const SWIPE_TIME = 0.3;
const RUN = 2; // the worm's pace: what used to be the Shift boost
const JUMP_TIME = 0.55;
const JUMP_DIST = 1.5; // body lengths forward
const JUMP_H = 0.55; // body lengths up
const SQUEEZE_TIME = 0.3;

/**
 * One worm's body and movement on / inside the fruit:
 * inchworm crawl on the skin, snake-like gnawing inside, rearing up, growth and the swallowing wave.
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
  private swipeT = 0; // a tail swipe to one side
  private swipeSide = 1;
  private whipT = 0; // a lash at a ladybug: one end flies up and over to the other
  private whipEnd: 'head' | 'tail' = 'tail';
  private whipAim = 0; // sideways aim of this strike, radians
  rear = 0; // 0 = lying, 1 = standing on the tail
  gnawing = false;

  readonly trail = new Trail();
  readonly disp = Array.from({ length: N }, () => new THREE.Vector3());
  readonly ups = Array.from({ length: N }, () => new THREE.Vector3(0, 1, 0));
  private readonly target = Array.from({ length: N }, () => new THREE.Vector3());
  private placed = false;

  private readonly tmp = new THREE.Vector3();
  private readonly tmpN = new THREE.Vector3();
  private readonly bendT = new THREE.Vector3();
  private readonly bendC = new THREE.Vector3();
  private readonly rearP = new THREE.Vector3();
  private readonly rearDir = new THREE.Vector3();
  private readonly rearUp = new THREE.Vector3();
  private readonly bendTmp = Array.from({ length: N }, () => new THREE.Vector3());
  private readonly bendVec = new THREE.Vector3();
  private readonly bendAxis = new THREE.Vector3();

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

  /** Size gained per gnawed distance: 100 / the room's goal (points come at the same pace, the size always doubles by the win). */
  growthRate = 1;

  private grow(dist: number) {
    this.growth = Math.min(GROWTH_MAX, this.growth + (dist * GROWTH_PER_DIAMETER * this.growthRate) / (2 * R0));
    this.applyGrowth();
  }

  /** On the skin in direction `dir` from the center (random if none), with a short trail behind. */
  spawn(dir?: THREE.Vector3) {
    const { pS, n, f } = this;
    this.trail.p.length = this.trail.n.length = this.trail.d.length = 0;
    if (dir) pS.copy(dir);
    else {
      const phi = Math.random() * Math.PI * 2;
      pS.set(Math.cos(phi), -0.3 + Math.random() * 0.7, Math.sin(phi));
    }
    appleProject(pS);
    appleNormal(pS, n);
    f.crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize();
    const bp = pS.clone();
    const bf = f.clone().negate();
    const bn = n.clone();
    const pts: THREE.Vector3[] = [];
    const nrm: THREE.Vector3[] = [];
    for (let i = 0; i < 120; i++) {
      pts.push(bp.clone().addScaledVector(bn, this.SEG_R));
      nrm.push(bn.clone());
      bp.addScaledVector(bf, 0.01);
      appleProject(bp);
      appleNormal(bp, bn);
      bf.addScaledVector(bn, -bf.dot(bn)).normalize();
    }
    for (let i = pts.length - 1; i >= 0; i--) this.trail.push(pts[i], nrm[i]);
    this.tailDist = this.trail.head - this.L;
    this.mode = 'surface';
    this.placed = false;
  }

  /** One jerk to throw ants off: head and tail swing to one side, the next jerk to the other. */
  shake() {
    this.shakeT = SHAKE_TIME;
    this.shakeSide = -this.shakeSide;
  }

  /** Shift: spring off the tail and hop forward (clears a spider thread). */
  jump() {
    if (this.mode !== 'surface' || this.jumpT > 0 || this.rear > 0.05) return;
    this.jumpT = JUMP_TIME;
  }

  get airborne() {
    return this.jumpT > 0;
  }

  /** A swipe of the tail to one side, the next to the other: shoo critters away. */
  /** Inside a passage there is no room to turn: shrink like an accordion and stretch back. */
  squeeze() {
    this.squeezeT = SQUEEZE_TIME;
  }

  /** An ant in the passage drags the worm back along its own tunnel. */
  pullBack(dist: number) {
    if (this.mode !== 'dig' || dist <= 0) return;
    this.trail.truncate(this.trail.head - dist);
    this.trail.sample(this.trail.head, this.p, this.tmpN);
  }

  swipe() {
    this.swipeT = SWIPE_TIME;
    this.swipeSide = -this.swipeSide;
  }

  /** A lash with `end` at whatever holds the other end. */
  whip(end: 'head' | 'tail') {
    this.whipT = WHIP_TIME;
    this.whipEnd = end;
    this.whipAim = (Math.random() * 2 - 1) * 0.3; // each strike lands a bit left or right
  }

  /** Burrow in from the skin (head goes in at ~40°). */
  startDig() {
    if (this.mode !== 'surface') return;
    const { pS, n, f, p, d, u, right } = this;
    this.mode = 'dig';
    p.copy(pS).addScaledVector(n, this.SEG_R);
    right.crossVectors(f, n).normalize();
    d.copy(f).multiplyScalar(Math.cos(0.7)).addScaledVector(n, -Math.sin(0.7)).normalize();
    u.crossVectors(right, d).normalize();
    this.travel = 0;
    this.entered = false;
    this.sinceEntry = 0;
    this.lastTunnelPt = null;
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

  /** New round: small again, at a new spot on the skin. */
  restart(dir?: THREE.Vector3) {
    if (this.mode === 'fly') return; // the winner restarts by itself after the flight
    if (this.mode === 'dig') this.events.tunnelEnd?.();
    this.resetGrowth();
    this.wave = -1;
    this.rear = 0;
    this.spawn(dir);
  }

  /** Back to the starting size (someone else won the round). */
  resetGrowth() {
    this.growth = 1;
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
    const boost = RUN * (inp.speed ?? 1); // always at a run (no separate boost)
    this.rear += ((this.mode === 'surface' && inp.rear ? 1 : 0) - this.rear) * damp(dt, 5);
    if (this.mode === 'surface') this.updateSurface(dt, inp.turn, inp.forward && this.rear < 0.05, boost);
    else this.updateDig(dt, inp.turn, inp.pitch, inp.forward, boost);
    this.gnawing = this.mode === 'dig' && inp.forward;
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
    const { f, n, trail, L } = this;
    f.applyAxisAngle(n, turn).normalize();
    if (this.jumpT > 0) {
      // in the air: carried forward, body straight
      this.jumpT = Math.max(0, this.jumpT - dt);
      this.stepSurface(((JUMP_DIST * L) / JUMP_TIME) * dt);
      this.tailDist = trail.head - L;
      return;
    }
    // crawl only while moving forward; otherwise freeze mid-step and resume from the same phase
    if (!forward) return;
    // fast (boost, seeds, panic): several small sub-steps, so no part of a step is skipped
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
    d.applyAxisAngle(u, turn);
    right.crossVectors(d, u).normalize();
    d.applyAxisAngle(right, pitch).normalize();
    u.crossVectors(right, d).normalize();
    if (!forward) return;
    const before = this.rearDir.copy(p);
    p.addScaledVector(d, DIG_SPEED * this.growth * boost * dt);
    pushOutOfPit(p, this.SEG_R); // a pit stops the worm, it slides along
    const step = p.distanceTo(before); // only real progress counts (for growth too)
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
        this.grow(step);
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
      if (this.rear > 0.001) this.rearUpPose();
      if (this.shakeT > 0) this.shakePose(dt);
      if (this.whipT > 0) this.whipPose(dt);
      if (this.jumpT > 0) {
        // a hop: up and down along an arc, the head a little higher (pushed off the tail)
        const t = 1 - this.jumpT / JUMP_TIME;
        const h = 4 * JUMP_H * this.L * t * (1 - t);
        for (let k = 0; k < N; k++) this.target[k].addScaledVector(this.ups[k], h * (0.75 + 0.25 * (k / (N - 1))));
      }
      if (this.swipeT > 0) this.swipePose(dt);
    } else {
      let spacing = SPACING;
      if (this.squeezeT > 0) {
        this.squeezeT = Math.max(0, this.squeezeT - dt);
        spacing *= 1 - 0.4 * Math.sin(Math.PI * (1 - this.squeezeT / SQUEEZE_TIME));
      }
      for (let k = 0; k < N; k++) trail.sample(trail.head - (N - 1 - k) * spacing, target[k], ups[k]);
    }
    const a = damp(dt, 22);
    for (let k = 0; k < N; k++) {
      if (!this.placed) this.disp[k].copy(target[k]);
      else this.disp[k].lerp(target[k], a);
    }
    this.placed = true;
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

  /** The "C" jerk: both halves curl to the same side, the ends the most. */
  private shakePose(dt: number) {
    this.shakeT = Math.max(0, this.shakeT - dt);
    const e = Math.sin(Math.PI * (1 - this.shakeT / SHAKE_TIME));
    const mid = N >> 1;
    const up = this.bendAxis.copy(this.ups[mid]);
    const a = this.shakeSide * 0.22 * e;
    this.bend(mid, 1, up, () => a);
    this.bend(mid, -1, up, () => -a);
  }

  /** Most of the body (from just behind the head) sweeps out to one side along a wide arc. */
  private swipePose(dt: number) {
    this.swipeT = Math.max(0, this.swipeT - dt);
    const e = Math.sin(Math.PI * (1 - this.swipeT / SWIPE_TIME));
    const pivot = N - 3; // the head and neck stay, the rest lashes
    const up = this.bendAxis.copy(this.ups[pivot]);
    this.bend(pivot, -1, up, (j) => this.swipeSide * e * (0.2 + 0.02 * j));
  }

  /** Folds in half and strikes over the back with the free end; the held end stays put. */
  private whipPose(dt: number) {
    const before = this.whipT;
    this.whipT = Math.max(0, this.whipT - dt);
    const e = Math.sin(Math.PI * (1 - this.whipT / WHIP_TIME));
    const mid = N >> 1;
    // first lie straight and flat from the held end (a bent body would strike crooked) ...
    const held = this.whipEnd === 'tail' ? N - 1 : 0;
    const away = this.rearDir.copy(this.f).multiplyScalar(held === N - 1 ? -1 : 1); // towards the free end
    const w = Math.min(1, e * 3);
    const base = this.rearP;
    for (let k = 0; k < N; k++) {
      base.copy(this.target[held]).addScaledVector(away, Math.abs(k - held) * this.SPACING);
      this.target[k].lerp(base, w);
      this.ups[k].lerp(this.ups[held], w).normalize();
    }
    // ... then fold in half at the middle: the free half swings up over the back and its tip comes
    // down on whatever holds the other end; the joints after the fold curl it down onto it
    const across = this.bendAxis.crossVectors(this.f, this.ups[mid]).normalize();
    const fold = (j: number) => e * (j === 0 ? 2.85 : 0.3); // ~165° at the middle, then curling down onto the target
    if (this.whipEnd === 'tail') this.bend(mid, -1, across, (j) => -fold(j));
    else this.bend(mid, 1, across, fold);
    // aim: swing the folded half a little to one side around the middle
    const up = this.bendAxis.copy(this.ups[mid]);
    this.bend(mid, this.whipEnd === 'tail' ? -1 : 1, up, (j) => (j === 0 ? e * this.whipAim : 0));
    // the moment it lands: the middle of the strike
    if (before > WHIP_TIME / 2 && this.whipT <= WHIP_TIME / 2) this.events.impact?.(this.target[this.whipEnd === 'tail' ? 0 : N - 1]);
  }

  /** Tail stays on the skin, the front curls up from the pivot ball towards vertical. */
  private rearUpPose() {
    const { target, ups, f, right } = this;
    const PIVOT = 3;
    const w = ease(Math.min(1, this.rear));
    const rp = this.rearP.copy(target[PIVOT]);
    const rn = ups[PIVOT];
    right.crossVectors(f, rn).normalize();
    for (let k = PIVOT + 1; k < N; k++) {
      const ang = Math.min(1.4, (k - PIVOT) * 0.34);
      this.rearDir.copy(f).applyAxisAngle(right, ang);
      rp.addScaledVector(this.rearDir, this.SPACING * 1.05);
      target[k].lerp(rp, w);
      ups[k].lerp(this.rearUp.copy(rn).applyAxisAngle(right, ang), w).normalize();
    }
  }
}
