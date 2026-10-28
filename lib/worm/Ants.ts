import * as THREE from 'three';
import { appleF, appleNormal, appleProject } from '@/lib/apple';
import { girth, N, RADII } from './constants';

// Critters on the skin. They chase worms on the skin and catch them:
// - ants climb on (each halves the worm's speed, no burrowing); 3–5 shakes throw them off;
// - a ladybug grabs the nearer end, head or tail, and holds the worm still; 7–10 lashes with the
//   other end make it let go.
// One client — the room's host — simulates them (AntSim) and sends snapshots; everyone draws them (AntView).

export const ANT = 0;
export const LADYBUG = 1;
export const SPIDER = 2;
type Kind = typeof ANT | typeof LADYBUG | typeof SPIDER;

type KindSpec = {
  len: number; // body length (the worm is ~1 long)
  max: number; // at most this many at once
  every: [number, number]; // seconds between new ones
  speed: number;
  chase: number; // sees worms this far
  grab: number; // catches within this distance
  hits: [number, number]; // clicks needed to get free
  cooldown: number; // after letting go, no chasing for this long
};
const SPECS: Record<Kind, KindSpec> = {
  [ANT]: { len: 0.42, max: 40, every: [9, 11], speed: 1.15, chase: 4, grab: 0.3, hits: [3, 5], cooldown: 8 },
  [LADYBUG]: { len: 1.7, max: 1, every: [25, 35], speed: 1.45, chase: 7, grab: 0.7, hits: [7, 10], cooldown: 12 },
  // spiders never chase: they wander chaotically and leave a sticky thread behind
  [SPIDER]: { len: 0.77, max: 3, every: [18, 24], speed: 1.0, chase: 0, grab: 0, hits: [0, 0], cooldown: 0 },
};
const LIFE = 120; // a wandering ladybug leaves after this long (ants stay: there are more and more of them)
const FLEE_SPEED = 1.9;
const SAFE_DISTANCE = 8;
const SHAKE_BREATHER = 3; // seconds nobody grabs a worm that just shook its critters off (time to burrow)
const MAX_HOLDERS = 5; // ants holding one worm at once, at most
const SPIDER_SENSE = 14; // a spider feels a worm stuck in a web this far away
const SPIDER_RUSH = 2.6; // and runs over this fast
const STING_PEACE = 15; // seconds a bitten worm is left alone
const SILK_STEP = 0.2; // a thread point every this far
const SILK_POINTS = 250; // a spider's thread is this many points long (~50 units); then the oldest bit goes
const SWAT_REACH = 1.6; // a tail swat scares critters this close to the worm's body

export type AntState = 0 | 1 | 2 | 3; // wander, chase, attached, flee
/** [id, state, x, y, z, fx, fy, fz, target player id, ball index, angle, kind, inside (1) / on the skin (0), passage id, position along it] */
export type AntSnap = [number, AntState, number, number, number, number, number, number, string, number, number, Kind, 0 | 1, string, number];

/** A gnawed passage the ants may walk along (they never dig). */
export type TunnelPath = { id: string; pts: THREE.Vector3[] };
const ENTRY_REACH = 0.9; // an ant this close to a passage's mouth may go in
const MOUTH_DEPTH = 0.7; // a passage end this close under the skin is a way in / out

export type WormInfo = { id: string; mode: string; disp: THREE.Vector3[]; stuck?: boolean /* in a spider thread */; g?: number /* growth */ };

type Ant = {
  id: number;
  kind: Kind;
  p: THREE.Vector3;
  f: THREE.Vector3;
  n: THREE.Vector3;
  state: AntState;
  target: string;
  seg: number;
  ang: number;
  cool: number;
  age: number;
  burst: number; // seconds left of the current dash (< 0: pausing)
  startle: number; // swatted: frozen for this long, then it runs
  tun: string; // passage it walks in ('' = on the skin)
  tpos: number; // position along the passage, in points
  tdir: 1 | -1;
  fresh: boolean; // just let go inside a passage: pick the direction away from the worm
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const randIn = ([a, b]: [number, number]) => a + Math.random() * (b - a);

export class AntSim {
  private ants: Ant[] = [];
  private nextId = 1;
  private spawnIn: Record<Kind, number> = { [ANT]: 3, [LADYBUG]: 15, [SPIDER]: 8 };
  private threads = new Map<number, THREE.Vector3[]>(); // spider id → its silk, oldest first
  private hits = new Map<string, { done: number; need: number }>(); // "<player>:<kind>"
  private tmp = new THREE.Vector3();
  private lastWorms: WormInfo[] = [];
  /** A spider bit this worm (stuck in its web): the host freezes it. */
  onSting?: (wormId: string, ball: number) => void;
  private stungUntil = new Map<string, number>(); // bitten worms are left alone for a while (by age clock)
  private clock = 0;
  private safeUntil = new Map<string, number>(); // just shook them off: nobody grabs this worm until then

  /** May a critter grab this worm now? (a breather after shaking off; only so many hold on at once) */
  private canGrab(id: string, kind: Kind) {
    if ((this.safeUntil.get(id) ?? 0) > this.clock) return false;
    return kind !== ANT || this.ants.filter((b) => b.kind === ANT && b.state === 2 && b.target === id).length < MAX_HOLDERS;
  }
  private digIn = new Map<string, { t: TunnelPath; i: number; id?: string }>();
  private wormSpeed = new Map<string, number>();
  private lastHead = new Map<string, THREE.Vector3>();

  clear() {
    this.ants = [];
    this.hits.clear();
    this.spawnIn = { [ANT]: 3, [LADYBUG]: 15, [SPIDER]: 8 };
    this.threads.clear();
    this.stungUntil.clear();
    this.safeUntil.clear();
  }

  /** A click from `player`: lashes a ladybug that holds it, otherwise shakes ants. */
  /** A player starts afresh (a new round): whoever holds or chases it lets go and runs off; spiders leave it be. */
  release(player: string) {
    for (const a of this.ants) {
      if (a.target !== player || (a.state !== 1 && a.state !== 2)) continue;
      if (a.state === 2 && !a.tun) appleProject(a.p);
      a.state = 3;
      a.startle = 0;
      a.fresh = !!a.tun;
      a.cool = SPECS[a.kind].cooldown;
    }
    this.stungUntil.set(player, this.clock + STING_PEACE);
    this.safeUntil.set(player, this.clock + SHAKE_BREATHER);
  }

  shake(player: string) {
    const kind: Kind = this.ants.some((a) => a.kind === LADYBUG && a.state === 2 && a.target === player) ? LADYBUG : ANT;
    const key = `${player}:${kind}`;
    if (!this.ants.some((a) => a.kind === kind && a.state === 2 && a.target === player)) return;
    // count the jerks (start a count if there's none: never get stuck unshakeable)
    let h = this.hits.get(key);
    if (!h) this.hits.set(key, (h = { done: 0, need: Math.round(randIn(SPECS[kind].hits)) }));
    console.info('[ants] shake', player, kind, `${h.done + 1}/${h.need}`);
    if (++h.done < h.need) return;
    this.hits.delete(key);
    this.safeUntil.set(player, this.clock + SHAKE_BREATHER);
    for (const a of this.ants) {
      if (a.kind === kind && a.state === 2 && a.target === player) {
        a.state = 3;
        a.cool = SPECS[kind].cooldown;
        a.fresh = !!a.tun;
      }
    }
  }

  /** A tail swat by `player`: critters close to its body (not holding it) freeze for a moment, then run. */
  swat(player: string) {
    const w = this.lastWorms.find((x) => x.id === player);
    if (!w) return;
    for (const a of this.ants) {
      if (a.state === 2 || a.state === 3) continue;
      const near = w.disp.some((b) => b.distanceTo(a.p) < SWAT_REACH);
      if (!near) continue;
      a.state = 3;
      a.target = player;
      a.startle = 0.45;
      a.cool = SPECS[a.kind].cooldown;
    }
  }

  update(dt: number, worms: WormInfo[], passages: TunnelPath[] = []): AntSnap[] {
    this.lastWorms = worms;
    this.clock += dt;
    const byTunnel = new Map(passages.map((t) => [t.id, t]));
    for (const kind of [ANT, LADYBUG, SPIDER] as Kind[]) {
      this.spawnIn[kind] -= dt;
      if (this.spawnIn[kind] <= 0) {
        this.spawnIn[kind] = randIn(SPECS[kind].every);
        if (this.ants.filter((a) => a.kind === kind).length < SPECS[kind].max) this.ants.push(this.spawn(kind));
      }
    }
    const byId = new Map(worms.map((w) => [w.id, w]));
    // which passage each burrowing worm is in, and where along it
    const digIn = new Map<string, { t: TunnelPath; i: number; id?: string }>();
    for (const w of worms) {
      if (w.mode !== 'dig') continue;
      const c = w.disp[N >> 1];
      let bd = 1.2;
      for (const t of passages) {
        t.pts.forEach((q, i) => {
          const d = q.distanceTo(c);
          if (d < bd) {
            bd = d;
            digIn.set(w.id, { t, i, id: w.id });
          }
        });
      }
    }
    this.digIn = digIn;
    // how fast each worm really goes (boost included, smoothed over an inchworm step):
    // a chasing ant "boosts" too and stays a bit faster
    for (const w of worms) {
      const h = w.disp[0];
      const last = this.lastHead.get(w.id);
      if (last && dt > 0) {
        const v = Math.min(10, last.distanceTo(h) / dt);
        const old = this.wormSpeed.get(w.id) ?? v;
        this.wormSpeed.set(w.id, old + (v - old) * Math.min(1, dt * 1.5));
      }
      this.lastHead.set(w.id, h.clone());
    }
    for (const a of this.ants) {
      const spec = SPECS[a.kind];
      a.age += dt;
      a.cool = Math.max(0, a.cool - dt);
      const target = byId.get(a.target);
      if (a.tun) {
        this.walkPassage(a, byTunnel.get(a.tun), dt, byId);
        continue;
      }
      if (a.state === 2) {
        // holding on: fall off if the worm left the skin or the room
        if (!target || target.mode !== 'surface') {
          a.state = 3;
          a.cool = spec.cooldown;
          if (target) a.p.copy(target.disp[a.seg]);
          appleProject(a.p);
        } else a.p.copy(target.disp[a.seg]);
        continue;
      }
      if (a.state === 3 && a.startle > 0) {
        a.startle -= dt; // taken aback: stands still for a moment
        continue;
      }
      if (a.state === 3) {
        const from = target?.disp[N - 1];
        if (!from || a.p.distanceTo(from) > SAFE_DISTANCE) a.state = 0;
        else this.steer(a, this.tmp.copy(a.p).multiplyScalar(2).sub(from), FLEE_SPEED, dt);
        continue;
      }
      if (a.kind === SPIDER) {
        this.spiderWalk(a, dt, worms);
        continue;
      }
      // wander, or chase the nearest worm on the skin
      let best: WormInfo | null = null;
      let bestD = spec.chase;
      if (!a.cool) {
        for (const w of worms) {
          if (w.mode !== 'surface') continue;
          const d = w.disp[N - 1].distanceTo(a.p);
          if (d < bestD) {
            bestD = d;
            best = w;
          }
        }
      }
      if (best) {
        a.state = 1;
        a.target = best.id;
        let k = -1;
        let kd = Infinity;
        best.disp.forEach((b, i) => {
          const d = b.distanceTo(a.p) - RADII[i] * girth(best.g ?? 1);
          if (d < kd) {
            kd = d;
            k = i;
          }
        });
        if (kd < spec.grab && this.canGrab(best.id, a.kind)) this.catchWorm(a, best, k);
        else {
          // chasing: an ant zig-zags, a ladybug runs straight
          if (a.kind === ANT) a.f.applyAxisAngle(a.n, Math.sin(a.age * 9 + a.id) * 2.5 * dt);
          // a bit faster than the worm, whatever it does (boost, seed): there's no outrunning them
          const speed = Math.max(spec.speed, (this.wormSpeed.get(best.id) ?? 0) * 1.2);
          this.steer(a, best.disp[k], speed, dt);
        }
      } else {
        a.state = 0;
        if (a.kind === ANT) {
          // like an ant: a quick dash, a short freeze, a sharp turn, another dash
          a.burst -= dt;
          if (a.burst > 0) this.move(a, spec.speed * 0.85, dt);
          else if (a.burst < -(0.15 + (a.id % 5) * 0.08)) {
            a.f.applyAxisAngle(a.n, (Math.random() - 0.5) * 2.6);
            a.burst = 0.35 + Math.random() * 1.1;
          }
          // a worm went under the skin nearby: run after it into its passage
          if (!a.cool && this.followInto(a, spec.chase * 2.5, dt)) continue;
          // near a passage's mouth an ant may wander in
          if (a.state === 0 && Math.random() < dt * 0.2) this.maybeEnter(a, passages);
        } else {
          // a ladybug trundles along, turning gently
          a.f.applyAxisAngle(a.n, Math.sin(a.age * 0.9 + a.id) * 0.9 * dt);
          this.move(a, spec.speed * 0.5, dt);
        }
      }
    }
    this.ants = this.ants.filter((a) => !(a.kind === LADYBUG && a.state === 0 && a.age > LIFE));
    return this.ants.map((a) => [a.id, a.state, r3(a.p.x), r3(a.p.y), r3(a.p.z), r3(a.f.x), r3(a.f.y), r3(a.f.z), a.target, a.seg, r3(a.ang), a.kind, a.tun ? 1 : 0, a.tun, r3(a.tpos)]);
  }

  /** Silk threads of the spiders: [spider id, x, y, z, x, y, z, …] each. */
  webs(): number[][] {
    return [...this.threads].map(([id, pts]) => [id, ...pts.flatMap((p) => [r3(p.x), r3(p.y), r3(p.z)])]);
  }

  /** Chaotic: sudden turns, bursts and stops; spins a thread as it goes. */
  private spiderWalk(a: Ant, dt: number, worms: WormInfo[]) {
    a.state = 0;
    // somebody stuck in a web: hurry over and bite (then leave it alone)
    let prey: THREE.Vector3 | null = null;
    let preyId = '';
    let preyBall = 0;
    let pd = SPIDER_SENSE;
    for (const w of worms) {
      if (!w.stuck || w.mode !== 'surface' || (this.stungUntil.get(w.id) ?? 0) > this.clock) continue;
      w.disp.forEach((b, bi) => {
        const d = b.distanceTo(a.p) - RADII[bi] * girth(w.g ?? 1);
        if (d < pd) {
          pd = d;
          prey = b;
          preyId = w.id;
          preyBall = bi;
        }
      });
    }
    if (prey) {
      a.state = 1;
      a.target = preyId;
      if (pd < SPECS[SPIDER].len * 0.6) {
        this.stungUntil.set(preyId, this.clock + STING_PEACE);
        this.onSting?.(preyId, preyBall);
      } else this.steer(a, prey, SPIDER_RUSH, dt);
    } else {
      a.burst -= dt;
      if (a.burst > 0) this.move(a, SPECS[SPIDER].speed * (0.6 + 0.8 * Math.abs(Math.sin(a.age * 3 + a.id))), dt);
      else if (a.burst < -(0.1 + Math.random() * 0.4)) {
        a.f.applyAxisAngle(a.n, (Math.random() - 0.5) * 3.2);
        a.burst = 0.2 + Math.random() * 0.9;
      }
      a.f.applyAxisAngle(a.n, (Math.random() - 0.5) * 6 * dt); // jittery
    }
    let silk = this.threads.get(a.id);
    if (!silk) this.threads.set(a.id, (silk = []));
    const last = silk[silk.length - 1];
    if (!last || last.distanceTo(a.p) > SILK_STEP) {
      silk.push(a.p.clone());
      if (silk.length > SILK_POINTS) silk.shift();
    }
  }

  /** Head for the mouth of a passage a worm is burrowing in, and go in after it. */
  private followInto(a: Ant, reach: number, dt: number) {
    let best: { t: TunnelPath; end: number; d: number } | null = null;
    for (const { t } of this.digIn.values()) {
      const n = t.pts.length;
      if (n < 2) continue;
      for (const end of [0, n - 1]) {
        const mouth = t.pts[end];
        if (appleF(mouth) < -MOUTH_DEPTH) continue;
        const d = mouth.distanceTo(a.p);
        if (d < reach && (!best || d < best.d)) best = { t, end, d };
      }
    }
    if (!best) return false;
    const { t, end } = best;
    if (best.d < ENTRY_REACH) {
      a.tun = t.id;
      a.tpos = end;
      a.tdir = end === 0 ? 1 : -1;
      a.p.copy(t.pts[end]);
      return true;
    }
    a.state = 0;
    this.steer(a, t.pts[end], SPECS[ANT].speed, dt);
    return true;
  }

  /** Go into a passage whose mouth is close by. */
  private maybeEnter(a: Ant, passages: TunnelPath[]) {
    for (const t of passages) {
      const n = t.pts.length;
      if (n < 4) continue;
      for (const end of [0, n - 1]) {
        const mouth = t.pts[end];
        if (appleF(mouth) < -MOUTH_DEPTH || mouth.distanceTo(a.p) > ENTRY_REACH) continue;
        a.tun = t.id;
        a.tpos = end;
        a.tdir = end === 0 ? 1 : -1;
        a.p.copy(mouth);
        return;
      }
    }
  }

  /** Walk along an existing passage in dashes; turn back at a dead end, climb out at a mouth. */
  private walkPassage(a: Ant, t: TunnelPath | undefined, dt: number, worms: Map<string, WormInfo>) {
    if (!t || t.pts.length < 2) {
      a.tun = ''; // the passage is gone (new round): back on the skin
      a.state = 0;
      appleProject(a.p);
      return;
    }
    const n = t.pts.length;
    if (a.state === 2) {
      // holding a burrowing worm (its owner drags it back towards the ant)
      const w = worms.get(a.target);
      if (w && w.mode === 'dig') {
        a.p.copy(w.disp[a.seg]);
        return;
      }
      a.state = 0;
    }
    if (a.state === 3) {
      // shaken off: run along the passage away from the worm, fast, for a while
      const from = worms.get(a.target)?.disp[N - 1];
      if (a.fresh) {
        // it was riding the worm: drop onto the passage right where it is now (not where it grabbed)
        let best = 0;
        let bestD = Infinity;
        t.pts.forEach((q, qi) => {
          const d = q.distanceToSquared(a.p);
          if (d < bestD) {
            bestD = d;
            best = qi;
          }
        });
        a.tpos = best;
      }
      if (a.fresh && from) {
        const i = Math.round(a.tpos);
        const ahead = t.pts[Math.min(n - 1, i + 1)];
        const back = t.pts[Math.max(0, i - 1)];
        a.tdir = ahead.distanceTo(from) > back.distanceTo(from) ? 1 : -1;
        a.burst = 1.5;
      }
      a.fresh = false;
      if (a.cool < SPECS[ANT].cooldown - 2.5) a.state = 0;
    } else {
      a.state = 0;
      // a burrowing worm right here? grab its nearest ball
      if (!a.cool) {
        for (const w of worms.values()) {
          if (w.mode !== 'dig') continue;
          let k = -1;
          let kd = Infinity;
          w.disp.forEach((b, i) => {
            const d = b.distanceTo(a.p) - RADII[i] * girth(w.g ?? 1);
            if (d < kd) {
              kd = d;
              k = i;
            }
          });
          if (kd < 0.3 && this.canGrab(w.id, a.kind)) {
            a.target = w.id;
            this.catchWorm(a, w, k);
            return;
          }
        }
      }
    }
    // a worm in this passage: go after it, hardly stopping; nobody here: make for the way out
    const prey = a.state === 3 ? undefined : [...this.digIn.values()].find((x) => x.t.id === t.id);
    let gapK = 1; // close behind the worm: ease off smoothly (no stop-and-go, no dithering)
    if (prey) {
      const ahead = prey.i - a.tpos;
      if (Math.abs(ahead) > 3) a.tdir = ahead > 0 ? 1 : -1;
      gapK = Math.min(1, Math.max(0, (Math.abs(ahead) - 2) / 12));
    }
    else if (a.state !== 3) {
      const mouths = [0, n - 1].filter((e) => appleF(t.pts[e]) > -MOUTH_DEPTH);
      if (mouths.length) {
        const e = mouths.reduce((x, y) => (Math.abs(y - a.tpos) < Math.abs(x - a.tpos) ? y : x));
        a.tdir = e > a.tpos ? 1 : -1;
      }
    }
    a.burst -= dt;
    if (a.burst <= 0) {
      if (prey || a.burst < -0.3) a.burst = 0.4 + Math.random() * 1.2; // after prey: no stops
      if (!prey) return;
    }
    const chase = prey ? Math.max(SPECS[ANT].speed * 1.1, (this.wormSpeed.get(prey.id ?? '') ?? 0) * 1.2) * gapK : 0;
    let move = (a.state === 3 ? FLEE_SPEED : prey ? chase : SPECS[ANT].speed * 0.85) * dt;
    while (move > 0) {
      const i = Math.floor(a.tpos);
      const segLen = Math.max(1e-3, t.pts[Math.min(n - 1, i)].distanceTo(t.pts[Math.min(n - 1, i + 1)]));
      const before = a.tpos;
      a.tpos = Math.min(n - 1, Math.max(0, a.tpos + (a.tdir * move) / segLen));
      move -= Math.abs(a.tpos - before) * segLen;
      if (a.tpos <= 0 || a.tpos >= n - 1) {
        const end = a.tpos <= 0 ? 0 : n - 1;
        if (appleF(t.pts[end]) > -MOUTH_DEPTH) {
          // out through the mouth
          a.tun = '';
          a.p.copy(t.pts[end]);
          appleProject(a.p);
          appleNormal(a.p, a.n);
          a.f.subVectors(t.pts[end], t.pts[end === 0 ? 1 : n - 2]);
          a.f.addScaledVector(a.n, -a.f.dot(a.n)).normalize();
          return;
        }
        a.tdir = a.tdir > 0 ? -1 : 1; // dead end
        break;
      }
      if (Math.abs(a.tpos - before) < 1e-6) break;
    }
    const i = Math.min(n - 2, Math.floor(a.tpos));
    const f = a.tpos - i;
    a.p.lerpVectors(t.pts[i], t.pts[i + 1], f);
    a.f.subVectors(t.pts[i + 1], t.pts[i]).multiplyScalar(a.tdir).normalize();
  }

  private catchWorm(a: Ant, w: WormInfo, nearest: number) {
    a.state = 2;
    if (a.kind === LADYBUG) {
      // the nearer end: head or tail; one ladybug per worm
      if (this.ants.some((b) => b !== a && b.kind === LADYBUG && b.state === 2 && b.target === w.id)) {
        a.state = 1;
        return;
      }
      a.seg = a.p.distanceTo(w.disp[N - 1]) < a.p.distanceTo(w.disp[0]) ? N - 1 : 0;
      a.ang = 0;
    } else {
      a.seg = Math.max(1, Math.min(N - 2, nearest));
      a.ang = (Math.random() - 0.5) * 2.2;
    }
    const key = `${w.id}:${a.kind}`;
    if (!this.hits.has(key)) this.hits.set(key, { done: 0, need: Math.round(randIn(SPECS[a.kind].hits)) });
  }

  private spawn(kind: Kind): Ant {
    const p = new THREE.Vector3().randomDirection();
    p.y = p.y * 0.6; // not at the poles (stem, bottom)
    appleProject(p);
    const n = appleNormal(p, new THREE.Vector3());
    const f = new THREE.Vector3().randomDirection();
    f.addScaledVector(n, -f.dot(n)).normalize();
    return { id: this.nextId++, kind, p, f, n, state: 0, target: '', seg: 0, ang: 0, cool: 0, age: 0, burst: 0.5, startle: 0, tun: '', tpos: 0, tdir: 1, fresh: false };
  }

  private steer(a: Ant, to: THREE.Vector3, speed: number, dt: number) {
    const want = this.tmp.copy(to).sub(a.p);
    want.addScaledVector(a.n, -want.dot(a.n));
    if (want.lengthSq() > 1e-8) a.f.lerp(want.normalize(), Math.min(1, dt * 6)).normalize();
    this.move(a, speed, dt);
  }

  private move(a: Ant, speed: number, dt: number) {
    a.p.addScaledVector(a.f, speed * dt);
    appleProject(a.p);
    appleNormal(a.p, a.n);
    a.f.addScaledVector(a.n, -a.f.dot(a.n)).normalize();
  }
}

// ---------- drawing ----------

const sphere = new THREE.SphereGeometry(1, 14, 10);
const dome = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2); // upper half
const antMat = new THREE.MeshStandardMaterial({ color: 0x1b0f0a, roughness: 0.35, metalness: 0.1 });
const blackMat = new THREE.MeshStandardMaterial({ color: 0x0e0b0a, roughness: 0.3 });
const shellMat = new THREE.MeshStandardMaterial({ color: 0xd8180f, roughness: 0.22, metalness: 0.05 });
const legMat = new THREE.LineBasicMaterial({ color: 0x140b07 });
// a ladybug's seam: a thin black line arching over its shell from front to back
const seam = new THREE.TubeGeometry(
  new THREE.CatmullRomCurve3(
    Array.from({ length: 13 }, (_, i) => {
      const t = (i / 12) * Math.PI;
      return new THREE.Vector3(0, 0.04 + 0.3 * 1.015 * Math.sin(t), -0.05 + 0.42 * 1.015 * Math.cos(t));
    }),
  ),
  24,
  0.008,
  5,
);
const LEG_SEGMENTS = 8 * 2; // up to eight legs of two strokes (ants: six legs + two antennae)
const spiderMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.55 });

type AntMesh = {
  group: THREE.Group;
  legs: THREE.BufferAttribute;
  p: THREE.Vector3; // drawn position
  f: THREE.Vector3;
  snap: AntSnap;
  phase: number; // gait phase, advanced by the distance actually moved
  feelers: number;
  tpos: number; // drawn position along its passage (follows the path, never cuts corners)
  tun?: string; // the passage it's drawn in
};

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

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  apply(snaps: AntSnap[]) {
    this.snaps = snaps;
    const alive = new Set<number>();
    for (const s of snaps) {
      alive.add(s[0]);
      let a = this.ants.get(s[0]);
      if (!a) {
        a = this.make(s);
        this.ants.set(s[0], a);
      }
      a.snap = s;
    }
    for (const [id, a] of this.ants) {
      if (alive.has(id)) continue;
      this.group.remove(a.group);
      a.group.traverse((o) => {
        if (o instanceof THREE.LineSegments) o.geometry.dispose(); // legs are per critter, the rest is shared
      });
      this.ants.delete(id);
    }
  }

  clear() {
    this.apply([]);
  }

  /** Hide and seek: a worm inside sees only critters in the passages, a worm on the skin only those outside. */
  setInside(inside: boolean) {
    this.inside = inside;
  }

  /** How many critters of `kind` hold the worm `id`. */
  attachedTo(id: string, kind: Kind = ANT) {
    return this.snaps.filter((s) => s[1] === 2 && s[8] === id && s[11] === kind).length;
  }

  /** Which end of worm `id` a ladybug holds: 'head', 'tail' or null. */
  ladybugGrip(id: string): 'head' | 'tail' | null {
    const s = this.snaps.find((x) => x[1] === 2 && x[8] === id && x[11] === LADYBUG);
    return s ? (s[9] === 0 ? 'tail' : 'head') : null;
  }

  update(
    dt: number,
    wormBody: (id: string) => { disp: THREE.Vector3[]; size: number } | null,
    passage: (id: string) => THREE.Vector3[] | undefined = () => undefined,
  ) {
    const k = 1 - Math.exp(-12 * dt);
    for (const a of this.ants.values()) {
      const s = a.snap;
      const len = SPECS[s[11]].len;
      const body = s[1] === 2 ? wormBody(s[8]) : null;
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
          a.p.copy(ball).addScaledVector(this.up, -r).addScaledVector(a.f, len * 0.4 + r * 0.4);
          a.f.negate(); // looks back at the worm
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
        if (s[12]) {
          // in a passage: walk on its floor (towards the fruit's center)
          this.up.addScaledVector(a.f, -this.up.dot(a.f)).normalize();
          a.p.addScaledVector(this.up, -0.1);
        }
      }
      a.group.visible = s[12] === (this.inside ? 1 : 0);
      a.group.position.copy(a.p).addScaledVector(this.up, 0.03);
      // legs step as far as the critter moves (still when it stops); while holding on they scramble
      const moved = a.group.userData.prev ? a.group.position.distanceTo(a.group.userData.prev) : 0;
      a.group.userData.prev = a.group.position.clone();
      a.phase += s[1] === 2 ? dt * 26 : (Math.min(moved, 0.3) / len) * 9;
      a.feelers += dt;
      this.m.lookAt(a.f, new THREE.Vector3(), this.up);
      a.group.quaternion.setFromRotationMatrix(this.m);
      this.poseLegs(a, len, s[11]);
    }
  }

  private make(s: AntSnap): AntMesh {
    const group = new THREE.Group();
    const L = SPECS[s[11]].len;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x * L, y * L, z * L);
      m.scale.set(sx * L, sy * L, sz * L);
      group.add(m);
      return m;
    };
    if (s[11] === LADYBUG) {
      // red dome with black spots and a seam, black head
      add(dome, shellMat, 0, 0.04, -0.05, 0.36, 0.3, 0.42);
      add(sphere, blackMat, 0, 0.1, 0.36, 0.15, 0.11, 0.12);
      add(sphere, blackMat, 0, 0.05, -0.05, 0.33, 0.06, 0.4); // underside
      const spots: [number, number][] = [[0.15, 0.1], [-0.15, 0.1], [0.2, -0.12], [-0.2, -0.12], [0.1, -0.3], [-0.1, -0.3], [0, 0.22]];
      for (const [x, z] of spots) {
        const y = 0.04 + 0.3 * Math.sqrt(Math.max(0, 1 - (x / 0.36) ** 2 - ((z + 0.05) / 0.42) ** 2));
        add(sphere, blackMat, x, y, z, 0.055, 0.02, 0.055);
      }
      add(seam, blackMat, 0, 0, 0, 1, 1, 1); // the seam between the wing cases, over the dome
    } else if (s[11] === SPIDER) {
      // small head-chest, big round abdomen, dark
      add(sphere, spiderMat, 0, 0.16, 0.12, 0.13, 0.1, 0.14);
      add(sphere, spiderMat, 0, 0.2, -0.18, 0.2, 0.17, 0.24);
    } else {
      for (const [z, r, lenK] of [[0.3, 0.07, 1], [0.05, 0.065, 1.2], [-0.25, 0.1, 1.5]] as const) {
        add(sphere, antMat, 0, r * 1.2, z, r * 1.6, r * 1.4, r * 1.6 * lenK);
      }
    }
    const legs = new THREE.BufferAttribute(new Float32Array(LEG_SEGMENTS * 2 * 3), 3);
    legs.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', legs);
    const lines = new THREE.LineSegments(geo, legMat);
    lines.frustumCulled = false;
    group.add(lines);
    this.group.add(group);
    return { group, legs, p: new THREE.Vector3(s[2], s[3], s[4]), f: new THREE.Vector3(s[5], s[6], s[7]), snap: s, phase: Math.random() * 6, feelers: Math.random() * 6, tpos: s[14] ?? 0 };
  }

  /** Six legs (hip → knee → foot) stepping in a tripod gait, plus two antennae. */
  private poseLegs(a: AntMesh, L: number, kind: Kind) {
    const arr = a.legs.array as Float32Array;
    let o = 0;
    const seg = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      arr.set([x1 * L, y1 * L, z1 * L, x2 * L, y2 * L, z2 * L], o);
      o += 6;
    };
    if (kind === SPIDER) {
      // eight long legs, knees high above the body, alternating gait
      for (let i = 0; i < 4; i++) {
        for (const side of [-1, 1]) {
          const z = 0.22 - i * 0.14;
          const step = Math.sin(a.phase * 1.3 + i * 1.6 + (side > 0 ? 0 : Math.PI)) * 0.07;
          const spread = (i - 1.5) * 0.2;
          seg(side * 0.08, 0.17, 0.1, side * 0.3, 0.42, z + spread * 0.5 + step * 0.5);
          seg(side * 0.3, 0.42, z + spread * 0.5 + step * 0.5, side * 0.55, 0, z + spread + step);
        }
      }
      a.legs.needsUpdate = true;
      return;
    }
    const wide = kind === LADYBUG ? 1.15 : 1;
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const z = 0.12 - i * 0.12;
        const step = Math.sin(a.phase + (i % 2 === (side > 0 ? 0 : 1) ? 0 : Math.PI)) * 0.08;
        const kneeX = side * 0.2 * wide;
        const footX = side * 0.34 * wide;
        seg(side * 0.04, 0.08, z, kneeX, 0.16, z + step * 0.5);
        seg(kneeX, 0.16, z + step * 0.5, footX, 0, z + step + (i - 1) * 0.08);
      }
    }
    const wig = Math.sin(a.feelers * 11) * 0.05; // antennae always feel around
    const hz = kind === LADYBUG ? 0.44 : 0.38;
    seg(-0.03, 0.12, hz, -0.12 + wig, 0.22, hz + 0.18);
    seg(0.03, 0.12, hz, 0.12 - wig, 0.22, hz + 0.18);
    a.legs.needsUpdate = true;
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
