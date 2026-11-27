import * as THREE from 'three';
import { R0, appleF, appleNormal, appleProject, pushOutOfPit } from '@/lib/apple';
import { BIG_AT, girth, N, RADII, winProgress } from './constants';
import { LEVEL, type Level, type LevelName } from './levels';

// Critters on the skin. One client — the room's host — simulates them (AntSim) and sends snapshots;
// everyone draws them (AntView).
// - ants chase worms and climb on (they slow it, hold its head so it can't burrow, bite from its back);
//   they follow worms into their passages, gang up, quarrel with ladybugs, carry upturned ones off;
// - a ladybug grabs the nearer end, head or tail, and holds the worm; lashes free you (a big worm
//   slaps it off); another worm can bite it off you;
// - spiders wander and spin sticky threads; a worm stuck in one gets bitten;
// - an earwig flies in now and then: bites, grabs with its pincers, and drills through the fruit at
//   anyone gnawing inside;
// - a rose chafer lives on the fruit: bite it and it bolts round the fruit, flattening whoever's in
//   the way; jump on its back first and you can steer it.

export const ANT = 0;
export const LADYBUG = 1;
export const SPIDER = 2;
export const EARWIG = 3;
export const CHAFER = 4;
export type Kind = typeof ANT | typeof LADYBUG | typeof SPIDER | typeof EARWIG | typeof CHAFER;

// states
export const WANDER = 0;
export const CHASE = 1; // (the chafer: bolting)
export const HOLD = 2; // holding a worm
export const FLEE = 3;
export const QUARREL = 4; // ants round a ladybug or an earwig, waving at it
export const SLAPPED = 5; // slapped off by a big worm / flown away: gone at qEnd
export const KNOCKED = 6; // a ladybug knocked aside, sliding
export const DRILL = 7; // the earwig drilling through the fruit
export const CARRIED = 8; // an ant riding off on something
export const FLUNG = 9; // flung into the air: gone at qEnd
export const UPTURNED = 10; // on its back, legs waving
export const CARRY = 11; // ants carrying an upturned ladybug away
export type AntState = number;

type KindSpec = {
  len: number; // body length (the worm is ~1 long)
  max: number; // at most this many at once (the room's level says for most)
  every: [number, number]; // seconds between new ones (× the level's factor)
  speed: number;
  chase: number; // sees worms this far
  grab: number; // catches within this distance
  hits: [number, number]; // clicks needed to get free
  cooldown: number; // after letting go, no chasing for this long
};
export const SPECS: Record<Kind, KindSpec> = {
  [ANT]: { len: 0.42, max: 40, every: [7.5, 9.5], speed: 1.15, chase: 4, grab: 0.3, hits: [3, 5], cooldown: 8 },
  [LADYBUG]: { len: 1.7, max: 8, every: [30, 30], speed: 1.45, chase: 7, grab: 0.7, hits: [7, 10], cooldown: 12 },
  // spiders never chase: they wander chaotically and leave a sticky thread behind
  [SPIDER]: { len: 0.77, max: 3, every: [18, 24], speed: 1.0, chase: 0, grab: 0, hits: [0, 0], cooldown: 0 },
  [CHAFER]: { len: 2.4, max: 1, every: [1, 1], speed: 7.2, chase: 0, grab: 0, hits: [0, 0], cooldown: 0 },
  [EARWIG]: { len: 2.8, max: 1, every: [60, 60], speed: 3.2, chase: 12, grab: 0, hits: [0, 0], cooldown: 3 },
};
/** The balls an ant can't bite from: the worm's two ends (balls 0–2 and 7–9 hang out of reach). */
const atEnd = (seg: number) => seg <= 2 || seg >= 7;
const FLEE_SPEED = 1.9;
const SAFE_DISTANCE = 8;
export const LADYBUG_FLY_IN = 2.2; // seconds a new ladybug takes to fly in and settle
export const EARWIG_FLY_IN = 1.8; // …and the earwig
const SHAKE_BREATHER = 3; // seconds nobody grabs a worm that just shook its critters off (time to burrow)
const MAX_HOLDERS = 5; // ants holding one worm at once, at most
const SPIDER_SENSE = 14; // a spider feels a worm stuck in a web this far away
const SPIDER_RUSH = 2.6; // and runs over this fast
const STING_PEACE = 15; // seconds a bitten worm is left alone
const SILK_STEP = 0.2; // a thread point every this far
export const SILK_POINTS = 500; // a spider's thread is this many points long (a web and a trail); then the oldest bit goes
const ORB_R = 1.4; // an orb web's radius (~3.5 spider lengths across)
const ORB_STEP = 0.1; // a thread point every this far while weaving one (finer than the trail)
const ORB_TURNS = 3.5; // turns of its spiral
const SWAT_REACH = 2; // a tail swat scares critters this close to the worm's body
const ANT_BITE_EVERY = 5; // s an ant on a worm's back (alone there) takes to bite

/**
 * [id, state, x, y, z, fx, fy, fz, target player id, ball index, angle / pose, kind,
 *  inside (1) / on the skin (0), passage id, position along it]
 */
export type AntSnap = [number, AntState, number, number, number, number, number, number, string, number, number, Kind, 0 | 1, string, number];

/** A gnawed passage the ants may walk along (they never dig). */
export type TunnelPath = { id: string; pts: THREE.Vector3[] };
const ENTRY_REACH = 0.9; // an ant this close to a passage's mouth may go in
const MOUTH_DEPTH = 0.7; // a passage end this close under the skin is a way in / out

export type WormInfo = {
  id: string;
  mode: string;
  disp: THREE.Vector3[];
  stuck?: boolean; // in a spider thread
  g?: number; // growth
  seed?: number; // speed factor (ants don't match that)
  safe?: boolean; // untouchable (just ate a seed): critters ignore it
  rear?: boolean; // standing on its tail (taunts spiders)
};

type Ant = {
  id: number;
  kind: Kind;
  p: THREE.Vector3;
  f: THREE.Vector3;
  n: THREE.Vector3;
  state: AntState;
  target: string;
  seg: number;
  ang: number; // sent along: a pose (wag, wave, how far along a knock / a flip…)
  cool: number;
  age: number;
  burst: number; // seconds left of the current dash (< 0: pausing)
  startle: number; // swatted: frozen for this long, then it runs
  tun: string; // passage it walks in ('' = on the skin)
  tpos: number; // position along the passage, in points
  tdir: 1 | -1;
  fresh: boolean; // just let go inside a passage: pick the direction away from the worm
  // knocked aside / swatted
  knockT?: number;
  knockDir?: THREE.Vector3;
  knockStay?: boolean; // after the knock it just stays (a small worm's swat: a spider isn't upturned)
  tumbleT?: number;
  fleeFrom?: THREE.Vector3;
  qEnd?: number; // SLAPPED / FLUNG: gone then
  // ants ganging up
  rush?: { worm: string; until: number; ang: number }; // milling round a worm others hold
  guarding?: string; // standing on a worm's head while the others haul it
  meetWith?: number; // two ants meeting: touch feelers
  meetT?: number;
  quarrelCool?: number;
  qWith?: number; // the critter it quarrels with
  qAng?: number;
  qDist?: number;
  qEndAt?: number;
  qGather?: number;
  spar?: number; // an ant and a spider squaring up
  tauntBy?: string; // the worm taunting this spider
  tauntT?: number;
  tauntScared?: boolean;
  sparT?: number;
  meetCool?: number;
  lunge?: number;
  qR?: number;
  qNext?: number;
  scold?: { worm: string; t: number }; // a spider scolding a worm that tore its web
  carry?: number; // the upturned ladybug it carries
  carryAng?: number; // its place under it
  carryFrom?: THREE.Vector3;
  slide?: THREE.Vector3; // an upturned ladybug sliding (clapped off)
  haulTo?: THREE.Vector3;
  haulDir?: THREE.Vector3;
  holdT?: number;
  tugs?: number;
  heldBy?: number; // in the earwig's pincers
  heldT?: number;
  // ladybugs
  hadWorm?: { worm: string; seg: number };
  wagT?: number;
  wantEnd?: 'head' | 'tail';
  flippedAt?: number;
  upturnT?: number;
  biteT?: number;
  // the earwig
  act?: number;
  actT?: number;
  actLen?: number;
  actSide?: number;
  lifeT?: number;
  antProof?: number; // ants leave it be until then
  preyId?: string;
  sideOn?: boolean;
  holdAt?: THREE.Vector3;
  holdSide?: number;
  holding?: string;
  biteCool?: number;
  turnAway?: number;
  drill?: { d: THREE.Vector3; base: THREE.Vector3; bias: THREE.Vector3; miss: number; lean: number; inner: boolean; dug: number; hit: Set<string>; lastPt: THREE.Vector3 };
  drillCool?: number;
  grabCool?: number;
  // the chafer
  rider?: string;
  relocating?: boolean;
  runLeft?: number;
  spurT?: number;
  steer?: number;
  restLeft?: number;
  wanderT?: number;
  wanderTurn?: number;
  driftT?: number;
  driftTo?: number;
  drift?: number;
  tornSilk?: Set<number>; // thread points it already tore through (by number)
  // a spider weaving an orb web: where it walks next (silk: laying thread on the way; gap: a fresh
  // thread starts there, not joined to the last one), and the pause till the next web
  orb?: { way: { p: THREE.Vector3; silk: boolean; gap: boolean }[]; i: number; drops: THREE.Vector3[] };
  orbCool?: number;
  stunned?: Map<string, number>; // worms it ran over, until when they're safe from it
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const randIn = ([a, b]: [number, number]) => a + Math.random() * (b - a);
const isZero = (v: THREE.Vector3) => v.lengthSq() < 1e-9;

export class AntSim {
  private ants: Ant[] = [];
  private nextId = 1;
  // when the next critter of each kind arrives: a random moment in each period (not clockwork)
  private arrivals: Partial<Record<Kind, { in: number; rest: number }>> = {};
  private rules: Level = LEVEL.medium;
  private everyone: WormInfo[] = []; // every worm, untouchable ones too
  private threads = new Map<number, THREE.Vector3[]>(); // spider id → its silk, oldest first
  websMoved = false; // a thread was tugged or torn: send them in full
  private silkTotal = new Map<number, number>(); // points ever spun, per spider
  private silkSent = new Map<number, number>(); // …of which already sent
  private hits = new Map<string, { done: number; slams: number; need: number }>(); // "<player>:<kind>"
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private tmp3 = new THREE.Vector3();
  private lastWorms: WormInfo[] = [];
  /** A spider bit this worm (stuck in its web): the host freezes it. */
  onSting?: (wormId: string, ball: number) => void;
  /** An ant on a worm's back bit it. */
  onAntBite?: (wormId: string, ball: number) => void;
  /** The earwig did something to a worm: bit (points), grabbed, dropped, drilled through it… */
  onEarwig?: (wormId: string, points: number, what: string) => void;
  /** The earwig's drill: its passage (start, points, the hole where it comes out, end). */
  onDrill?: { start(id: number, r: number): void; point(id: number, p: THREE.Vector3): void; hole(h: number[]): void; end(id: number): void };
  /** The chafer ran a worm over (or carries its rider away). */
  onChafer?: (wormId: string) => void;
  private stungUntil = new Map<string, number>(); // bitten worms are left alone for a while (by the clock)
  private clock = 0;
  private safeUntil = new Map<string, number>(); // just shook them off: nobody grabs this worm until then
  private digIn = new Map<string, { t: TunnelPath; i: number; id?: string; step?: number; half?: number }>();
  private digAge = 1;
  private wormSpeed = new Map<string, number>();
  private lastHead = new Map<string, THREE.Vector3>();
  websTouched = false; // …since the host last redrew them
  private millAt = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private tmpS2 = new THREE.Vector3();

  /** arena: a fight to the last one standing (ants knocked off a tail are gone for good). */
  constructor(private arena = false) {}

  setDifficulty(level: LevelName) {
    if (this.rules !== LEVEL[level]) this.arrivals = {};
    this.rules = LEVEL[level];
  }

  /** May a critter grab this worm now? (a breather after shaking off; only so many hold on at once) */
  private canGrab(id: string, kind: Kind) {
    if ((this.safeUntil.get(id) ?? 0) > this.clock) return false;
    return kind !== ANT || this.ants.filter((b) => b.kind === ANT && b.state === HOLD && b.target === id).length < MAX_HOLDERS;
  }

  clear() {
    this.ants = [];
    this.hits.clear();
    this.arrivals = {};
    this.threads.clear();
    this.silkTotal.clear();
    this.silkSent.clear();
    this.stungUntil.clear();
    this.safeUntil.clear();
  }

  /** One ant holding `player` lets go (tumbles off). False if none holds it. */
  dropOne(player: string) {
    const a = this.ants.find((b) => b.kind === ANT && b.state === HOLD && b.target === player);
    if (!a) return false;
    if (!a.tun) appleProject(a.p);
    a.state = FLEE;
    a.startle = 0;
    a.tumbleT = 0.6;
    a.fresh = !!a.tun;
    a.cool = SPECS[ANT].cooldown;
    this.safeUntil.set(player, this.clock + SHAKE_BREATHER);
    return true;
  }

  /** A player starts afresh (a new round): whoever holds or chases it lets go and runs off; spiders leave it be. */
  release(player: string) {
    for (const a of this.ants) {
      if (a.target !== player || (a.state !== CHASE && a.state !== HOLD)) continue;
      if (a.state === HOLD && !a.tun) appleProject(a.p);
      a.state = FLEE;
      a.startle = 0;
      a.fresh = !!a.tun;
      a.cool = SPECS[a.kind].cooldown;
    }
    this.stungUntil.set(player, this.clock + STING_PEACE);
    this.safeUntil.set(player, this.clock + SHAKE_BREATHER);
    for (const a of this.ants) {
      if (a.kind === EARWIG && a.holding === player) {
        a.holding = undefined;
        a.act = 0;
        a.turnAway = 2;
        a.biteCool = 4;
      }
    }
  }

  /**
   * A click from `player`: lashes a ladybug that holds it (a big worm slaps it against the skin:
   * three slaps and it flies off), otherwise shakes ants.
   */
  shake(player: string) {
    const kind: Kind = this.ants.some((a) => a.kind === LADYBUG && a.state === HOLD && a.target === player) ? LADYBUG : ANT;
    const key = `${player}:${kind}`;
    if (!this.ants.some((a) => a.kind === kind && a.state === HOLD && a.target === player)) return;
    // count the jerks (start a count if there's none: never get stuck unshakeable)
    let h = this.hits.get(key);
    if (!h) this.hits.set(key, (h = { done: 0, slams: 0, need: Math.round(randIn(SPECS[kind].hits)) }));
    const w = this.lastWorms.find((x) => x.id === player);
    const slap = kind === LADYBUG && !!w && winProgress(w.g) >= BIG_AT;
    if (slap ? ++h.slams < 3 : ++h.done < h.need) return;
    this.hits.delete(key);
    this.safeUntil.set(player, this.clock + SHAKE_BREATHER);
    for (const a of this.ants) {
      if (a.kind !== kind || a.state !== HOLD || a.target !== player) continue;
      if (slap) {
        if (!a.tun) appleProject(a.p);
        a.state = SLAPPED;
        a.target = '';
        a.qEnd = this.clock + 1.8;
        continue;
      }
      a.state = FLEE;
      a.cool = SPECS[kind].cooldown;
      a.fresh = !!a.tun;
    }
  }

  /** A rocket or a rushing worm at p (reach r): critters in the way are knocked aside. */
  ramAt(p: THREE.Vector3, r: number) {
    for (const a of this.ants) {
      if (a.state === SLAPPED || a.state === CARRIED || a.state === FLUNG || a.kind === CHAFER || a.p.distanceTo(p) > r + SPECS[a.kind].len * 0.4) continue;
      if (a.kind === EARWIG) {
        if (a.state === DRILL) {
          appleProject(a.p);
          appleNormal(a.p, a.n);
          this.onDrill?.end(a.id);
          a.drill = undefined;
          a.state = WANDER;
          a.drillCool = 20;
        }
        if (a.state === WANDER) this.earwigAct(a, 6, 1, 1);
        continue;
      }
      if (a.tun) {
        a.state = FLEE;
        a.target = '';
        a.cool = SPECS[a.kind].cooldown;
        a.fresh = true;
        continue;
      }
      if (a.state === HOLD) this.hits.delete(`${a.target}:${a.kind}`);
      this.knockAside(a, p);
    }
  }

  /** A worm slammed down on the skin at p (reach r): critters round it are knocked aside (not its own). */
  slamAt(p: THREE.Vector3, r: number, by: string) {
    for (const a of this.ants) {
      if (a.tun || a.state === SLAPPED || a.state === CARRIED || a.state === FLUNG || a.state === UPTURNED || (a.state === HOLD && a.target === by)) continue;
      if (a.p.distanceTo(p) > r + SPECS[a.kind].len * 0.4) continue;
      if (a.kind === EARWIG) {
        if (a.state === WANDER) this.earwigAct(a, 6, 1, 1);
        continue;
      }
      if (a.kind === CHAFER) {
        if (a.state === WANDER && !a.rider) {
          this.relocateChafer(a);
          a.seg = 3;
        }
        continue;
      }
      if (a.state === HOLD) this.hits.delete(`${a.target}:${a.kind}`);
      this.knockAside(a, p);
    }
  }

  /** Knocked away from p along the skin: a ladybug slides, the rest are sent flying a bit and run. */
  private knockAside(a: Ant, p: THREE.Vector3) {
    const away = new THREE.Vector3().subVectors(a.p, p).addScaledVector(a.n, -this.tmp.subVectors(a.p, p).dot(a.n)).normalize();
    if (away.lengthSq() < 0.5) away.copy(a.f).negate();
    appleProject(a.p);
    appleNormal(a.p, a.n);
    a.target = '';
    if (a.kind === LADYBUG) {
      a.state = KNOCKED;
      a.knockT = 0.9;
      a.knockDir = away;
    } else {
      a.state = FLEE;
      a.startle = 0;
      a.knockT = 0.5;
      a.knockStay = false;
      a.knockDir = away;
      a.cool = 6;
    }
  }

  /**
   * A tail swat by `player` (back: a backflip's swat). at: where the tail struck (the swat reaches
   * `reach` round it), else round the whole body. Critters there are knocked away; a ladybug is
   * flipped on its back; the earwig startles; the chafer bolts (back) or moves off. Ants on the tail
   * end are swept off it.
   */
  swat(player: string, back = false, at?: THREE.Vector3, reach = SWAT_REACH) {
    const w = this.lastWorms.find((x) => x.id === player);
    if (!w) return;
    const swept = new Set<Ant>();
    if (at && w.mode === 'surface') {
      const onTail = (a: Ant) => a.kind === ANT && a.state === HOLD && a.target === player && a.seg >= 7;
      const tail = this.ants.filter(onTail);
      if (tail.length) {
        this.hits.delete(player + ':' + ANT);
        this.safeUntil.set(player, this.clock + SHAKE_BREATHER);
        if (this.arena) this.ants = this.ants.filter((a) => !onTail(a));
        else {
          for (const a of tail) {
            swept.add(a);
            a.p.copy(at);
            appleProject(a.p);
            appleNormal(a.p, a.n);
            a.state = FLEE;
            a.target = player;
            a.tun = '';
            a.startle = 0;
            a.ang = 0;
            a.cool = SPECS[ANT].cooldown;
            a.knockT = 0.5;
            a.knockStay = false;
            a.knockDir = new THREE.Vector3().subVectors(at, w.disp[0]);
            a.knockDir.addScaledVector(a.n, -a.knockDir.dot(a.n));
            if (a.knockDir.lengthSq() < 1e-8) {
              a.knockDir.set(1, 0, 0).addScaledVector(a.n, -a.n.x);
              if (a.knockDir.lengthSq() < 1e-8) a.knockDir.set(0, 1, 0).addScaledVector(a.n, -a.n.y);
            }
            a.knockDir.normalize();
          }
        }
      }
    }
    const r = at ? reach : SWAT_REACH;
    const near = (p: THREE.Vector3, extra = 0) => (at ? p.distanceTo(at) < r + extra : w.disp.some((b) => b.distanceTo(p) < r + extra));
    /** The struck point closest to p (within reach), or null. */
    const struck = (p: THREE.Vector3, extra = 0): THREE.Vector3 | null => {
      if (at) return p.distanceTo(at) < r + extra ? at : null;
      let best: THREE.Vector3 | null = null;
      let bd = r + extra;
      for (const b of w.disp) {
        const d = b.distanceTo(p);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      return best;
    };
    for (const a of this.ants) {
      if (swept.has(a)) continue;
      if (a.kind === EARWIG) {
        if (w.mode === 'surface' && a.state === WANDER && a.age >= EARWIG_FLY_IN && near(a.p, SPECS[EARWIG].len * 0.4)) {
          if (a.holding) {
            this.onEarwig?.(a.holding, 0, 'drop');
            a.holding = undefined;
          }
          this.earwigAct(a, 6, 1, back ? -1 : 1);
          a.biteCool = Math.max(a.biteCool ?? 0, 1.5);
        }
        continue;
      }
      if (a.kind === CHAFER) {
        if (w.mode === 'surface' && a.state === WANDER && a.cool <= 0 && a.rider !== player && near(a.p, SPECS[CHAFER].len * 0.4)) {
          if (back) {
            // lashed from a backflip: it bolts, two laps round the fruit
            a.state = CHASE;
            a.seg = 1;
            a.startle = 0.4;
            a.relocating = false;
            a.runLeft = 2 * Math.PI * 2 * R0;
          } else {
            this.relocateChafer(a);
            a.seg = 3;
          }
        }
        continue;
      }
      if (a.kind === LADYBUG && a.state === UPTURNED && near(a.p, SPECS[LADYBUG].len * 0.4)) {
        // a lash at one on its back: it rights itself and flies off
        if (this.clock - (a.flippedAt ?? -9) > 0.6) this.ladybugAway(a);
        continue;
      }
      if (a.kind === LADYBUG && a.state !== SLAPPED && a.state !== KNOCKED && (a.state !== HOLD || a.target !== player) && !a.tun && a.age > LADYBUG_FLY_IN) {
        const s = struck(a.p, SPECS[LADYBUG].len * 0.4);
        if (!s) continue;
        if (a.state === HOLD) this.hits.delete(`${a.target}:${LADYBUG}`);
        if (a.state === HOLD || a.state === QUARREL) appleProject(a.p);
        appleNormal(a.p, a.n);
        const away = new THREE.Vector3().subVectors(a.p, s).addScaledVector(a.n, -this.tmp.subVectors(a.p, s).dot(a.n)).normalize();
        if (away.lengthSq() < 0.5) away.copy(a.f).negate();
        a.target = '';
        a.ang = 0;
        this.flipLadybug(a, away);
        continue;
      }
      if (a.state === HOLD || a.state === SLAPPED || a.state === CARRIED || a.tun) continue;
      const s = struck(a.p);
      if (!s) continue;
      // a small worm's swat sends a spider off but doesn't turn it over
      const soft = a.kind === SPIDER && winProgress(w.g) < 0.5;
      a.state = FLEE;
      a.target = player;
      a.startle = 0;
      a.cool = SPECS[a.kind].cooldown;
      a.knockT = soft ? 0.22 : 0.5;
      a.knockStay = soft;
      a.knockDir = new THREE.Vector3().subVectors(a.p, s).addScaledVector(a.n, -this.tmp.subVectors(a.p, s).dot(a.n)).normalize();
      if (a.knockDir.lengthSq() < 0.5) a.knockDir.copy(a.f).negate();
    }
  }

  update(dt: number, worms: WormInfo[], passages: TunnelPath[] = []): AntSnap[] {
    this.everyone = worms;
    // an untouchable worm (it just ate a seed) and a chafer's rider are nobody's prey
    let prey = worms.filter((w) => !w.safe);
    this.lastWorms = prey;
    const riders = new Set(this.ants.filter((a) => a.kind === CHAFER && a.rider).map((a) => a.rider));
    prey = prey.filter((w) => !riders.has(w.id));
    this.clock += dt;
    const byTunnel = new Map(passages.map((t) => [t.id, t]));
    for (const kind of [ANT, LADYBUG, SPIDER, EARWIG, CHAFER] as Kind[]) {
      const period = () => {
        const p = randIn(SPECS[kind].every) * (kind === CHAFER ? 1 : this.rules.every[kind]);
        const at = Math.random() * p;
        return { in: at, rest: p - at };
      };
      const next = this.arrivals[kind] ?? (this.arrivals[kind] = period());
      for (next.in -= dt; next.in <= 0; ) {
        const max = kind === CHAFER ? SPECS[kind].max : this.rules.max[kind];
        if (this.ants.filter((a) => a.kind === kind).length < max) this.arrive(kind, max);
        const p = period();
        next.in += next.rest + p.in;
        next.rest = p.rest;
      }
    }
    const byId = new Map(prey.map((w) => [w.id, w]));
    this.ants = this.ants.filter((a) => !((a.state === SLAPPED || a.state === FLUNG) && (a.qEnd ?? 0) < this.clock));
    // which passage each burrowing worm is in, and where along it (5 times a second is enough;
    // look near where it was first)
    this.digAge += dt;
    if (this.digAge >= 0.2) {
      this.digAge = 0;
      const digIn = new Map<string, { t: TunnelPath; i: number; id?: string; step?: number; half?: number }>();
      for (const w of prey) {
        if (w.mode !== 'dig') continue;
        const c = w.disp[N >> 1];
        const was = this.digIn.get(w.id);
        const same = was && passages.find((t) => t.id === was.t.id);
        let found: { t: TunnelPath; i: number; id?: string; step?: number; half?: number } | null = null;
        let bd = 1.2;
        const look = (t: TunnelPath, from: number, to: number) => {
          for (let i = Math.max(0, from); i < Math.min(t.pts.length, to); i++) {
            const d2 = t.pts[i].distanceToSquared(c);
            if (d2 < bd * bd) {
              bd = Math.sqrt(d2);
              found = { t, i, id: w.id };
            }
          }
        };
        if (same && was) look(same, was.i - 150, was.i + 150);
        if (!found) for (const t of passages) look(t, 0, t.pts.length);
        if (found) {
          const f = found as { t: TunnelPath; i: number; id?: string; step?: number; half?: number };
          let len = 0;
          for (let i = 1; i < N; i++) len += w.disp[i].distanceTo(w.disp[i - 1]);
          const k = Math.max(0, Math.min(f.t.pts.length - 2, f.i));
          f.step = f.t.pts.length >= 2 ? Math.max(0.001, f.t.pts[k].distanceTo(f.t.pts[k + 1])) : 0.03;
          f.half = len / 2 / f.step; // half the worm, in passage points
          digIn.set(w.id, f);
        }
      }
      this.digIn = digIn;
    }
    // how fast each worm really goes (boost included, smoothed over an inchworm step):
    // a chasing ant "boosts" too and stays a bit faster
    for (const w of prey) {
      const h = w.disp[0];
      const last = this.lastHead.get(w.id);
      if (last && dt > 0) {
        const v = Math.min(10, last.distanceTo(h) / dt) / Math.max(1, w.seed ?? 1); // a boost is a real head start
        const old = this.wormSpeed.get(w.id) ?? v;
        this.wormSpeed.set(w.id, old + (v - old) * Math.min(1, dt * 1.5));
      }
      if (last) last.copy(h);
      else this.lastHead.set(w.id, h.clone());
    }
    this.spreadFuss(dt, byId);
    this.guardHaul(dt, byId);
    for (const a of this.ants) {
      const spec = SPECS[a.kind];
      a.age += dt;
      // a ladybug that just let go of a worm steps back off it (not left standing in its body)
      if (a.kind === LADYBUG) {
        if (a.state === HOLD) a.hadWorm = { worm: a.target, seg: a.seg };
        else if (a.hadWorm) {
          this.standOff(a, this.everyone.find((w) => w.id === a.hadWorm!.worm), a.hadWorm.seg);
          a.hadWorm = undefined;
        }
      }
      if (a.kind === LADYBUG && a.age < LADYBUG_FLY_IN) continue; // still flying in (drawn by the view)
      if (a.state === FLUNG) {
        a.p.addScaledVector(a.knockDir!, dt);
        a.knockDir!.multiplyScalar(1 - 0.9 * dt);
        a.ang = Math.min(1, 1 - ((a.qEnd ?? 0) - this.clock) / 1.1);
        continue;
      }
      if (a.kind === EARWIG) {
        if (a.age >= EARWIG_FLY_IN) this.earwigStep(a, dt, prey);
        continue;
      }
      if (a.kind === CHAFER) {
        this.chaferStep(a, dt, worms);
        continue;
      }
      if (a.state === CARRIED) continue;
      a.cool = Math.max(0, a.cool - dt);
      const target = byId.get(a.target);
      if (a.tun) {
        this.walkPassage(a, byTunnel.get(a.tun), dt, byId);
        continue;
      }
      if (a.state === QUARREL) {
        if (a.kind === LADYBUG) this.quarrelLadybug(a, dt);
        else this.quarrelAnt(a, dt);
        continue;
      }
      if (a.state === SLAPPED) continue;
      if (a.state === KNOCKED) {
        // a ladybug knocked aside: slides off a couple of its lengths
        a.knockT = Math.max(0, (a.knockT ?? 0) - dt);
        a.ang = 1 - (a.knockT ?? 0) / 0.9;
        a.p.addScaledVector(a.knockDir!, ((2.2 * spec.len) / 0.9) * dt);
        appleProject(a.p);
        appleNormal(a.p, a.n);
        if (!a.knockT) {
          a.state = WANDER;
          a.ang = 0;
          a.cool = 3;
          a.burst = -1;
        }
        continue;
      }
      if (a.state === HOLD) {
        if (target && target.mode === 'surface') {
          a.p.copy(target.disp[a.seg]);
          if (a.kind === ANT && this.switchSides(a, target, dt)) continue;
          // an ant alone on a worm's back bites it now and then (not from its ends)
          if (a.kind === ANT && !atEnd(a.seg) && this.ants.some((b) => b !== a && b.kind === ANT && b.state === HOLD && b.target === target.id)) a.biteT = 0;
          else if (a.kind === ANT && !atEnd(a.seg)) {
            a.biteT = (a.biteT ?? 0) + dt;
            if (a.biteT >= ANT_BITE_EVERY) {
              a.biteT = 0;
              this.onAntBite?.(target.id, a.seg);
            }
          }
          if (a.kind === LADYBUG) {
            // now and then it wags its tail end (two holding one worm take turns)
            const was = a.wagT ?? 2 + Math.random() * 2;
            a.wagT = was - dt;
            if (was > 0 && a.wagT <= 0 && this.ants.some((b) => b !== a && b.kind === LADYBUG && b.state === HOLD && b.target === target.id && (b.wagT ?? 1) <= 0)) {
              a.wagT = 0.6 + Math.random() * 1.2;
            }
            if (a.wagT <= 0) {
              const t = -a.wagT / 1.3;
              a.ang = Math.sin(t * Math.PI * 8) * Math.sin(Math.PI * Math.min(1, t)) ** 0.5;
              if (t >= 1) {
                a.wagT = 2.5 + Math.random() * 2.5;
                a.ang = 0;
              }
            }
          }
          if (a.kind === LADYBUG && this.antsRescue(a, target, dt)) continue;
          // a ladybug holding someone can be bitten in the side or the back by another worm: it lets go and runs
          const biter = a.kind === LADYBUG ? this.bitesLadybug(a, target, prey) : null;
          if (biter) {
            this.hits.delete(`${target.id}:${LADYBUG}`);
            appleProject(a.p);
            a.state = FLEE;
            a.target = biter; // runs away from the one that bit it
            a.startle = 0.15;
            a.cool = spec.cooldown;
          }
        } else {
          // the worm left the skin or the room: fall off
          a.state = FLEE;
          a.cool = spec.cooldown;
          if (target) a.p.copy(target.disp[a.seg]);
          appleProject(a.p);
        }
        continue;
      }
      if (a.state === FLEE && (a.knockT ?? 0) > 0) {
        // swatted: sent flying along the skin, slowing; then it runs (a spider lies on its back a while)
        a.knockT = Math.max(0, (a.knockT ?? 0) - dt);
        a.ang = 1 - (a.knockT ?? 0) / 0.5;
        a.p.addScaledVector(a.knockDir!, 7 * (0.4 + (a.knockT ?? 0) / 0.5) * dt);
        appleProject(a.p);
        appleNormal(a.p, a.n);
        if (!a.knockT) {
          a.ang = 0;
          if (a.knockStay) {
            a.knockStay = false;
            a.state = WANDER;
          } else if (a.kind === LADYBUG) {
            a.state = WANDER;
            a.burst = -0.01;
          } else if (a.kind === SPIDER) {
            a.state = UPTURNED;
            a.upturnT = 5;
            a.target = '';
            a.scold = undefined;
          }
        }
        continue;
      }
      if (a.state === UPTURNED && a.kind === LADYBUG) {
        this.upturnedLadybug(a, dt);
        continue;
      }
      if (a.state === UPTURNED) {
        a.upturnT = (a.upturnT ?? 0) - dt;
        if (a.upturnT <= 0) a.state = WANDER;
        continue;
      }
      if (a.state === CARRY) {
        this.carryStep(a, dt);
        continue;
      }
      if (a.state === FLEE && a.startle > 0) {
        a.startle -= dt; // taken aback: stands still for a moment
        continue;
      }
      if (a.state === FLEE) {
        const from = a.fleeFrom ?? target?.disp[N - 1];
        if (!from || a.p.distanceTo(from) > SAFE_DISTANCE) {
          a.state = WANDER;
          a.fleeFrom = undefined;
        } else this.steer(a, this.tmp.copy(a.p).multiplyScalar(2).sub(from), FLEE_SPEED, dt);
        continue;
      }
      if (a.kind === SPIDER) {
        this.spiderWalk(a, dt, prey);
        continue;
      }
      // an ant near a ladybug may pick a quarrel with it
      if (a.kind === ANT && !a.cool && !a.rush && this.clock > (a.quarrelCool ?? 0) && this.ladybugNear(a)) {
        a.quarrelCool = this.clock + 8;
        if (Math.random() < 0.2 && this.startQuarrel(a)) continue;
      }
      if (a.kind === ANT && this.squareUp(a, dt)) {
        a.state = WANDER;
        continue;
      }
      if (a.guarding) {
        // standing on a worm's head while the others haul it off
        const g = this.everyone.find((w) => w.id === a.guarding && w.mode === 'surface');
        const hauled = a.rush && byId.get(a.rush.worm);
        if (!g || !hauled || this.clock > (a.rush?.until ?? 0) || g.disp[N - 1].distanceTo(hauled.disp[N >> 1]) > 5.12) {
          a.guarding = undefined;
          a.ang = 0;
        } else {
          const head = g.disp[N - 1];
          a.state = WANDER;
          a.ang = 1;
          if (a.p.distanceTo(head) > 0.35) this.steer(a, head, SPECS[ANT].speed * 1.3, dt);
          continue;
        }
      }
      if (a.rush) {
        // others hold this worm: mill round it, ready to step in when one lets go
        const w = byId.get(a.rush.worm);
        if (w && w.mode === 'surface' && this.clock < a.rush.until && this.ants.some((b) => b.kind === ANT && b.state === HOLD && b.target === w.id)) {
          if (!this.canGrab(w.id, ANT) || a.cool) {
            this.millRound(a, w, dt);
            continue;
          }
        } else {
          a.rush = undefined;
          a.ang = 0;
        }
      }
      if (a.kind === LADYBUG && this.awayFromEarwig(a, dt)) continue;
      // wander, or chase the nearest worm on the skin
      let best: WormInfo | null = (a.rush && byId.get(a.rush.worm)) ?? null;
      // a ladybug goes for a worm another ladybug holds by one end: it takes the other end
      const contest = a.kind !== LADYBUG || best || a.cool ? null : this.contestFor(a, byId);
      if (contest) {
        best = contest;
        const other = this.ants.find((b) => b.kind === LADYBUG && b.state === HOLD && b.target === contest.id);
        a.wantEnd = other?.seg === N - 1 ? 'tail' : 'head';
      } else if (a.kind === LADYBUG) a.wantEnd = undefined;
      let bestD = best ? 0 : spec.chase * this.rules.chase;
      if (!a.cool) {
        for (const w of prey) {
          if (w.mode !== 'surface') continue;
          if (a.kind === LADYBUG && this.ants.some((b) => b !== a && b.kind === LADYBUG && b.state === HOLD && b.target === w.id)) continue;
          const d = w.disp[N - 1].distanceTo(a.p);
          if (d < bestD) {
            bestD = d;
            best = w;
          }
        }
      }
      if (best) {
        a.meetWith = undefined;
        a.state = CHASE;
        a.target = best.id;
        if (a.kind === ANT) {
          // the earwig has it in its pincers: go for the earwig
          const ew = this.ants.find((b) => b.kind === EARWIG && b.holding === best!.id && b.state !== SLAPPED && b.state !== DRILL);
          if (ew) {
            this.steer(a, ew.p, spec.speed * this.rules.speed, dt);
            continue;
          }
        }
        let k = -1;
        let kd = Infinity;
        best.disp.forEach((b, i) => {
          if (a.wantEnd && i >= N >> 1 !== (a.wantEnd === 'head')) return;
          const d = b.distanceTo(a.p) - RADII[i] * girth(best!.g ?? 1);
          if (d < kd) {
            kd = d;
            k = i;
          }
        });
        if (kd < spec.grab && this.canGrab(best.id, a.kind)) this.catchWorm(a, best, k);
        else if (a.kind === ANT && kd < 1.2 && !this.canGrab(best.id, ANT)) {
          // it's held by as many as can hold it: mill round (at most a dozen do; the rest turn away)
          if (!a.rush && this.ants.filter((b) => b.rush?.worm === best!.id).length >= 12) {
            a.cool = 4;
            a.f.negate();
            continue;
          }
          a.rush ??= { worm: best.id, until: this.clock + 9, ang: this.angleAround(best, a.p) };
          this.millRound(a, best, dt);
          continue;
        } else {
          // chasing: an ant zig-zags, a ladybug runs straight (a last dash when it's close)
          if (a.kind === ANT) a.f.applyAxisAngle(a.n, Math.sin(a.age * 9 + a.id) * 2.5 * dt);
          const dash = a.kind === LADYBUG && kd < SPECS[LADYBUG].len * 0.9 ? 2.2 : 1;
          // a bit faster than the worm, whatever it does: there's no outrunning them
          const speed = Math.max(spec.speed, (this.wormSpeed.get(best.id) ?? 0) * 1.2) * this.rules.speed * (contest ? 1.3 : 1) * dash;
          // a ladybug won't go near the earwig: it only turns towards the worm
          if (a.kind === LADYBUG && this.ants.some((b) => b.kind === EARWIG && b.state !== SLAPPED && b.state !== DRILL && b.age >= EARWIG_FLY_IN && b.p.distanceTo(best!.disp[k]) < 2.6)) {
            this.tmp.subVectors(best.disp[k], a.p).addScaledVector(a.n, -this.tmp2.subVectors(best.disp[k], a.p).dot(a.n));
            if (this.tmp.lengthSq() > 1e-8) a.f.lerp(this.tmp.normalize(), Math.min(1, dt * 4)).normalize();
            continue;
          }
          this.steer(a, best.disp[k], speed, dt);
        }
      } else {
        a.state = WANDER;
        if (a.kind === ANT) {
          if (this.meet(a, dt)) continue;
          // like an ant: a quick dash, a short freeze, a sharp turn, another dash (and they keep together)
          a.burst -= dt;
          if (a.burst > 0) {
            this.flock(a, dt);
            this.move(a, spec.speed * 0.85, dt);
          } else if (a.burst < -(0.15 + (a.id % 5) * 0.08)) {
            a.f.applyAxisAngle(a.n, (Math.random() - 0.5) * 2.6);
            a.burst = 0.35 + Math.random() * 1.1;
          }
          // a worm went under the skin nearby: run after it into its passage
          if (!a.cool && this.followInto(a, spec.chase * this.rules.chase * 2.5, dt)) continue;
          // near a passage's mouth an ant may wander in
          if (a.state === WANDER && Math.random() < dt * 0.2) this.maybeEnter(a, passages);
        } else {
          // a ladybug trundles along, turning gently, and stops now and then
          a.burst -= dt;
          if (a.burst > 0) {
            a.f.applyAxisAngle(a.n, Math.sin(a.age * 1.3 + a.id) * 0.6 * dt);
            this.move(a, spec.speed * 0.45, dt);
          } else {
            a.f.applyAxisAngle(a.n, Math.sin(a.age * 2 + a.id) * 1.2 * dt);
            if (a.burst < -(0.6 + (a.id % 3) * 0.4)) a.burst = 1 + Math.random() * 2.5;
          }
        }
      }
    }
    return this.ants.map((a) => [
      a.id,
      a.state,
      r3(a.p.x),
      r3(a.p.y),
      r3(a.p.z),
      r3(a.f.x),
      r3(a.f.y),
      r3(a.f.z),
      a.target,
      a.seg,
      r3(a.state !== FLEE || (a.knockT ?? 0) > 0 || (a.tumbleT ?? 0) > 0 ? a.ang : 0),
      a.kind,
      a.tun || a.drill?.inner ? 1 : 0,
      a.tun,
      r3(a.tpos),
    ]);
  }

  /** The threads as they are (full precision; for the host's own drawing). */
  websNow(): number[][] {
    return [...this.threads].map(([id, pts]) => [id, this.silkTotal.get(id) ?? pts.length, ...pts.flatMap((p) => [p.x, p.y, p.z])]);
  }

  /** Silk threads of the spiders in full: [spider id, points ever spun, x, y, z, x, y, z, …] each. */
  webs(): number[][] {
    for (const [id, n] of this.silkTotal) this.silkSent.set(id, n); // sent in full: no new bits owed
    return [...this.threads].map(([id, pts]) => [id, this.silkTotal.get(id) ?? pts.length, ...pts.flatMap((p) => [r3(p.x), r3(p.y), r3(p.z)])]);
  }

  /** Just the silk spun since the last call: [spider id, points ever spun, the new points…] per spider. */
  websDelta(): number[][] {
    const out: number[][] = [];
    for (const [id, pts] of this.threads) {
      const total = this.silkTotal.get(id) ?? 0;
      const fresh = Math.min(pts.length, total - (this.silkSent.get(id) ?? 0));
      if (fresh <= 0) continue;
      this.silkSent.set(id, total);
      out.push([id, total, ...pts.slice(-fresh).flatMap((p) => [r3(p.x), r3(p.y), r3(p.z)])]);
    }
    return out;
  }

  /** Chaotic: sudden turns, bursts and stops; spins a thread as it goes. */
  private spiderWalk(a: Ant, dt: number, worms: WormInfo[]) {
    a.state = WANDER;
    if (this.scoldFor(a, dt) || this.tauntedBy(a, dt, worms)) return;
    if (a.spar !== undefined) {
      // squaring up to an ant: face it
      const ant = this.ants.find((b) => b.id === a.spar && b.spar === a.id && b.state === WANDER) ?? this.ants.find((b) => b.spar === a.id && b.kind === ANT && b.state === WANDER);
      if (ant) {
        this.tmp.subVectors(ant.p, a.p).addScaledVector(a.n, -this.tmp2.subVectors(ant.p, a.p).dot(a.n));
        if (this.tmp.lengthSq() > 1e-8) a.f.lerp(this.tmp.normalize(), Math.min(1, dt * 5)).normalize();
        a.ang = 1;
        return;
      }
      a.spar = undefined;
      a.ang = 0;
    }
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
      if (a.orb) a.orbCool = 15 + Math.random() * 15; // dinner first; a new web later
      a.orb = undefined;
      a.state = CHASE;
      a.target = preyId;
      if (pd < SPECS[SPIDER].len * 0.6) {
        this.stungUntil.set(preyId, this.clock + STING_PEACE);
        this.onSting?.(preyId, preyBall);
      } else this.steer(a, prey, SPIDER_RUSH, dt);
    } else if (a.orb) this.weave(a, dt);
    else {
      a.orbCool = (a.orbCool ?? 6) - dt;
      if (a.orbCool <= 0 && Math.random() < dt * 0.3) this.planOrb(a);
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
    const spin = (p: THREE.Vector3) => {
      silk.push(p);
      this.silkTotal.set(a.id, (this.silkTotal.get(a.id) ?? 0) + 1);
      if (silk.length > SILK_POINTS) silk.shift();
    };
    const orb = a.orb;
    if (orb) {
      // weaving: the points (and breaks, at the origin) it laid on its way, in order
      for (const d of orb.drops) spin(d);
      orb.drops.length = 0;
      return;
    }
    const last = silk[silk.length - 1];
    if (!last || last.distanceTo(a.p) > SILK_STEP) spin(a.p.clone());
  }

  /**
   * An orb web, from where the spider stands: eight spokes like a star (out along each laying thread,
   * back to the middle without), then a spiral from the middle outwards across them.
   */
  private planOrb(a: Ant) {
    const c = a.p.clone();
    const e1 = a.f.clone();
    const e2 = new THREE.Vector3().crossVectors(a.n, e1).normalize();
    /** A point of the web's plane (x, y from its middle) on the skin. */
    const at = (x: number, y: number) => appleProject(c.clone().addScaledVector(e1, x).addScaledVector(e2, y));
    const way: NonNullable<Ant['orb']>['way'] = [];
    /** A straight-ish run of thread from (x0, y0) to (x1, y1), a point every step, sagging `sag` towards the middle. */
    const run = (x0: number, y0: number, x1: number, y1: number, silk: boolean, sag = 0) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / ORB_STEP));
      for (let j = 1; j <= n; j++) {
        const u = j / n;
        const k = 1 - sag * Math.sin(Math.PI * u);
        way.push({ p: at((x0 + (x1 - x0) * u) * k, (y0 + (y1 - y0) * u) * k), silk, gap: false });
      }
    };
    // eight spokes like a star: out laying thread, back to the middle without
    const tilt = Math.random() * Math.PI;
    const ang = Array.from({ length: 8 }, (_, k) => tilt + (k * Math.PI) / 4 + (Math.random() - 0.5) * 0.12);
    for (const th of ang) {
      const r = ORB_R * (0.95 + Math.random() * 0.1);
      const from = way.length;
      run(0, 0, r * Math.cos(th), r * Math.sin(th), true);
      way[from].gap = true;
      run(r * Math.cos(th), r * Math.sin(th), 0, 0, false);
    }
    // the spiral, from the middle outwards: straight bits from spoke to spoke, each sagging a little inwards
    const steps = Math.round(ORB_TURNS * 8);
    let r = ORB_R * 0.1;
    const dr = (ORB_R * 0.93 - r) / steps;
    let x = r * Math.cos(ang[0]);
    let y = r * Math.sin(ang[0]);
    way.push({ p: at(x, y), silk: false, gap: false });
    const from = way.length;
    for (let i = 1; i <= steps; i++) {
      r += dr;
      const th = ang[i % 8];
      const nx = r * Math.cos(th);
      const ny = r * Math.sin(th);
      run(x, y, nx, ny, true, 0.07);
      x = nx;
      y = ny;
    }
    way[from].gap = true;
    a.orb = { way, i: 0, drops: [new THREE.Vector3(), c.clone()] };
    a.burst = 0;
  }

  /** Walking the web's plan: on to the next point, and the next. Done: off it goes. */
  private weave(a: Ant, dt: number) {
    const orb = a.orb!;
    let go = SPECS[SPIDER].speed * (orb.way[orb.i].silk ? 0.55 : 0.9) * dt;
    while (go > 0 && orb.i < orb.way.length) {
      const w = orb.way[orb.i];
      const d = this.tmp.subVectors(w.p, a.p);
      d.addScaledVector(a.n, -d.dot(a.n));
      const dist = d.length();
      if (dist <= go) {
        a.p.copy(w.p);
        appleNormal(a.p, a.n);
        go -= dist;
        if (w.silk) orb.drops.push(w.p.clone());
        orb.i++;
        // a fresh thread from here (a new spoke, the spiral): a break, then where it starts
        if (orb.way[orb.i]?.gap) orb.drops.push(new THREE.Vector3(), w.p.clone());
        continue;
      }
      a.f.copy(d.normalize());
      this.move(a, go / dt, dt);
      go = 0;
    }
    if (orb.i >= orb.way.length) {
      a.orb = undefined;
      a.orbCool = 30 + Math.random() * 30;
      a.burst = 1.5; // and away
    }
  }

  /**
   * Is another worm biting this ladybug (which holds `held` by an end)? Its head on the ladybug's body,
   * coming at the side or the back, not at its face. Returns the biter's id.
   */
  private bitesLadybug(a: Ant, held: WormInfo, worms: WormInfo[]): string | null {
    const len = SPECS[LADYBUG].len;
    const ball = held.disp[a.seg];
    const next = held.disp[a.seg === 0 ? 1 : N - 2];
    const out = this.tmp.subVectors(ball, next).normalize(); // from the worm's end outwards: where its body is
    const r = RADII[a.seg] * girth(held.g ?? 1);
    const center = this.tmp2.copy(ball).addScaledVector(out, len * 0.4 + r * 0.4); // as drawn
    for (const w of worms) {
      if (w.id === held.id || w.mode !== 'surface') continue;
      const head = w.disp[N - 1];
      const headR = RADII[N - 1] * girth(w.g ?? 1);
      const d = this.tmp3.subVectors(head, center);
      const dist = d.length();
      if (dist > len * 0.55 + headR) continue;
      // its face looks back along -out at the worm it holds: a head there is face to face, no bite
      if (dist > 1e-6 && d.dot(out) / dist < -0.5) continue;
      return w.id;
    }
    return null;
  }

  /** A new critter. Ants often come in twos and threes. */
  private arrive(kind: Kind, max: number) {
    const a = this.spawn(kind);
    this.ants.push(a);
    if (kind !== ANT || Math.random() > 0.4) return;
    const more = Math.random() < 0.4 ? 2 : 1;
    for (let i = 0; i < more && this.ants.filter((b) => b.kind === ANT).length < max; i++) {
      const b = this.spawn(ANT);
      const off = new THREE.Vector3().randomDirection();
      off.addScaledVector(a.n, -off.dot(a.n)).normalize();
      b.p.copy(a.p).addScaledVector(off, 0.3 + Math.random() * 0.5);
      appleProject(b.p);
      appleNormal(b.p, b.n);
      b.f.copy(a.f).addScaledVector(b.n, -a.f.dot(b.n)).normalize();
      b.burst = a.burst + Math.random() * 0.3;
      this.ants.push(b);
    }
  }

  /** A fuss (ants holding a worm, a quarrel) draws idle ants from round about. */
  private spreadFuss(dt: number, worms: Map<string, WormInfo>) {
    const fuss: Ant[] = [];
    for (const a of this.ants) {
      if (a.kind !== ANT || a.tun) continue;
      const onWorm = (a.state === HOLD || a.state === CHASE) && worms.get(a.target)?.mode === 'surface' && this.ants.some((b) => b.state === HOLD && b.kind === ANT && b.target === a.target);
      if (a.state === QUARREL || a.rush || onWorm) fuss.push(a);
    }
    if (!fuss.length) return;
    for (const a of this.ants) {
      if (a.kind !== ANT || a.state !== WANDER || a.tun || a.cool || a.rush || a.spar !== undefined || a.tauntBy !== undefined || Math.random() > dt * 0.9) continue;
      const near = fuss.find((b) => b !== a && b.p.distanceTo(a.p) < 5);
      if (!near) continue;
      if (near.state === QUARREL) {
        const lb = this.ants.find((b) => b.id === near.qWith && b.state === QUARREL && b.kind === LADYBUG);
        if (!lb || this.ants.filter((b) => b.state === QUARREL && b.qWith === lb.id).length >= 10) continue;
        a.meetWith = undefined;
        this.joinQuarrel(a, lb, this.angleRound(lb, a.p), SPECS[LADYBUG].len * (0.8 + Math.random() * 0.4));
        lb.qGather = Math.max(lb.qGather ?? 0, this.clock + 2.5);
        continue;
      }
      const worm = near.rush ? near.rush.worm : near.target;
      if (this.ants.filter((b) => b.rush?.worm === worm).length >= 6) continue;
      a.meetWith = undefined;
      a.rush = { worm, until: this.clock + 9, ang: Math.random() * Math.PI * 2 };
    }
  }

  /**
   * Ants hauling a worm off defend it: what comes near (the earwig, a ladybug after it, a spider)
   * gets a few of them in its way, and two stand on the head of any other worm that comes close.
   */
  private guardHaul(dt: number, worms: Map<string, WormInfo>) {
    const hauled = new Set<string>();
    for (const a of this.ants) {
      if (a.kind === ANT && a.state === HOLD && !a.tun && worms.get(a.target)?.mode === 'surface') hauled.add(a.target);
    }
    for (const id of hauled) {
      const w = worms.get(id)!;
      const close = (p: THREE.Vector3, d: number) => w.disp.some((b) => b.distanceTo(p) < d);
      /** Sends up to n ants of this haul (the millers first, then holders) to deal with what's at p. */
      const send = (p: THREE.Vector3, n: number, go: (a: Ant) => void) => {
        if (n <= 0) return;
        const millers = this.ants.filter((a) => a.kind === ANT && a.state === WANDER && a.rush?.worm === id && !a.guarding && !a.tun);
        const holders = this.ants.filter((a) => a.kind === ANT && a.state === HOLD && a.target === id && !a.tun);
        const nearer = (x: Ant, y: Ant) => x.p.distanceTo(p) - y.p.distanceTo(p);
        for (const a of [...millers.sort(nearer), ...holders.sort(nearer)]) {
          if (n <= 0) break;
          if (a.state === HOLD) {
            appleProject(a.p);
            appleNormal(a.p, a.n);
            a.state = WANDER;
            a.target = '';
          }
          a.rush = { worm: id, until: this.clock + 9, ang: Math.random() * Math.PI * 2 };
          go(a);
          n--;
        }
      };
      for (const c of this.ants) {
        if (c.tun || c.state === SLAPPED || c.state === DRILL || c.state === CARRIED || c.state === FLUNG || c.state === UPTURNED) continue;
        if (c.kind === EARWIG && c.age >= EARWIG_FLY_IN && close(c.p, SPECS[EARWIG].len * 0.63)) {
          const there = this.ants.filter((b) => b.state === QUARREL && b.qWith === c.id).length;
          send(c.p, 4 - there, (a) => this.joinQuarrel(a, c, this.angleRound(c, a.p), 1));
        } else if (
          c.kind === LADYBUG &&
          c.age > LADYBUG_FLY_IN &&
          ((c.state === CHASE && c.target === id && close(c.p, 3.2)) || (c.state === QUARREL && this.ants.some((b) => b.state === QUARREL && b.qWith === c.id && b.rush?.worm === id)))
        ) {
          const there = this.ants.filter((b) => b.state === QUARREL && b.qWith === c.id).length;
          send(c.p, 4 - there, (a) => {
            if (c.state === QUARREL) this.joinQuarrel(a, c, this.angleRound(c, a.p), SPECS[LADYBUG].len * 0.95);
            else this.startQuarrel(a, c);
          });
        } else if (c.kind === SPIDER && c.state === WANDER && close(c.p, SPECS[SPIDER].len * 1.58)) {
          const there = this.ants.filter((b) => b.spar === c.id).length;
          send(c.p, 2 - there, (a) => {
            a.spar = c.id;
            if (c.spar === undefined) c.spar = a.id;
            a.sparT = 5;
            a.meetWith = undefined;
          });
        }
      }
      for (const o of this.everyone) {
        if (o.id === id || o.mode !== 'surface' || !close(o.disp[N - 1], 1.504)) continue;
        const there = this.ants.filter((b) => b.guarding === o.id).length;
        send(o.disp[N - 1], 2 - there, (a) => (a.guarding = o.id));
      }
    }
  }

  /** Round and round a worm the others hold (a ring along its body), facing its middle. */
  private millRound(a: Ant, w: WormInfo, dt: number) {
    a.state = WANDER;
    a.ang = 1; // feelers up
    const mid = w.disp[N >> 1];
    const up = appleNormal(mid, this.tmp3);
    a.rush!.ang += dt * (0.6 + (a.id % 3) * 0.25) * (a.id % 2 ? 1 : -1);
    const along = this.tmp.copy(w.disp[N - 1]).sub(w.disp[0]);
    along.addScaledVector(up, -along.dot(up));
    if (along.lengthSq() < 1e-8) return;
    along.normalize();
    const across = this.tmp2.crossVectors(up, along);
    const len = w.disp[N - 1].distanceTo(w.disp[0]);
    const spot = this.millAt
      .copy(mid)
      .addScaledVector(along, Math.cos(a.rush!.ang) * (len * 0.6 + 0.3))
      .addScaledVector(across, Math.sin(a.rush!.ang) * 0.55);
    appleProject(spot);
    if (a.p.distanceTo(spot) > 0.12) this.steer(a, spot, SPECS[ANT].speed * 1.1, dt);
    else {
      this.tmp.subVectors(mid, a.p).addScaledVector(a.n, -this.tmp2.subVectors(mid, a.p).dot(a.n));
      if (this.tmp.lengthSq() > 1e-8) a.f.lerp(this.tmp.normalize(), Math.min(1, dt * 6)).normalize();
      a.f.applyAxisAngle(a.n, Math.sin(this.clock * 8 + a.id) * 0.3 * dt);
    }
  }

  /** The angle of p round a worm's middle (0 = towards its head). */
  private angleAround(w: WormInfo, p: THREE.Vector3) {
    const mid = w.disp[N >> 1];
    const along = this.tmp.copy(w.disp[N - 1]).sub(w.disp[0]).normalize();
    const d = this.tmp2.subVectors(p, mid);
    const across = this.tmp3.crossVectors(appleNormal(mid, this.millAt), along);
    return Math.atan2(d.dot(across), d.dot(along));
  }

  /** Wandering ants drift together and the same way (a loose column). */
  private flock(a: Ant, dt: number) {
    const toward = this.tmp.set(0, 0, 0);
    const heading = this.tmp2.set(0, 0, 0);
    let n = 0;
    for (const b of this.ants) {
      if (b === a || b.kind !== ANT || b.state !== WANDER || b.tun) continue;
      const d = b.p.distanceTo(a.p);
      if (d > 2.4 || d < 0.15) continue;
      toward.add(this.tmp3.subVectors(b.p, a.p));
      heading.add(b.f);
      n++;
    }
    if (!n) return;
    toward.addScaledVector(a.n, -toward.dot(a.n));
    heading.addScaledVector(a.n, -heading.dot(a.n));
    if (toward.lengthSq() > 1e-8) a.f.lerp(toward.normalize(), Math.min(1, dt * 0.5));
    if (heading.lengthSq() > 1e-8) a.f.lerp(heading.normalize(), Math.min(1, dt * 0.7));
    a.f.addScaledVector(a.n, -a.f.dot(a.n)).normalize();
  }

  /** An idle ladybug about, to pick a quarrel with? */
  private ladybugNear(a: Ant) {
    const len = SPECS[LADYBUG].len;
    return this.ants.some((b) => b.kind === LADYBUG && (b.state === WANDER || b.state === CHASE) && !b.cool && !b.tun && b.age > LADYBUG_FLY_IN && b.p.distanceTo(a.p) < len * 2);
  }

  /** Ant a picks a quarrel with a ladybug (that one, or one close by): it stops; ants gather round. */
  private startQuarrel(a: Ant, with_?: Ant) {
    const len = SPECS[LADYBUG].len;
    const lb =
      with_ ?? this.ants.find((b) => b.kind === LADYBUG && (b.state === WANDER || b.state === CHASE) && !b.cool && !b.tun && b.age > LADYBUG_FLY_IN && b.p.distanceTo(a.p) < len * 2);
    if (!lb) return false;
    lb.state = QUARREL;
    lb.target = '';
    lb.seg = 0; // how many times it has had enough
    lb.qGather = this.clock + 5;
    lb.qNext = Infinity;
    const side = this.tmp.crossVectors(lb.n, lb.f).normalize();
    const d = this.tmp2.subVectors(a.p, lb.p);
    const ang = Math.atan2(d.dot(side), d.dot(lb.f));
    this.joinQuarrel(a, lb, ang, len * 0.62);
    return true;
  }

  /** The angle of p round critter c (0 = in front of it). */
  private angleRound(c: Ant, p: THREE.Vector3) {
    const side = this.tmp3.crossVectors(c.n, c.f).normalize();
    const d = this.tmp2.subVectors(p, c.p);
    return Math.atan2(d.dot(side), d.dot(c.f));
  }

  private joinQuarrel(a: Ant, c: Ant, ang: number, r: number) {
    a.state = QUARREL;
    a.target = '';
    a.qWith = c.id;
    a.qAng = ang;
    a.qR = r;
    a.lunge = 0;
  }

  /** Where ant a stands in its quarrel with c: round it (an earwig: an oval along its long body); a lunge goes closer. */
  private quarrelSpot(a: Ant, c: Ant, out: THREE.Vector3) {
    const side = this.tmp3.crossVectors(c.n, c.f).normalize();
    const r = (a.qR ?? 1) * ((a.lunge ?? 0) > 0 ? 0.55 : 1);
    const along = c.kind === EARWIG ? SPECS[EARWIG].len * 0.48 : r;
    const across = c.kind === EARWIG ? SPECS[EARWIG].len * 0.17 : r;
    out.copy(c.p).addScaledVector(c.f, Math.cos(a.qAng ?? 0) * along).addScaledVector(side, Math.sin(a.qAng ?? 0) * across);
    return appleProject(out);
  }

  private quarrelAnt(a: Ant, dt: number) {
    const c = this.ants.find((b) => b.id === a.qWith && (b.state === QUARREL || (b.kind === LADYBUG && b.state === HOLD) || (b.kind === EARWIG && b.state !== SLAPPED && b.state !== DRILL)));
    if (!c) {
      a.state = WANDER;
      return;
    }
    a.lunge = Math.max(0, (a.lunge ?? 0) - dt);
    const spot = this.quarrelSpot(a, c, this.tmp2);
    const d = a.p.distanceTo(spot);
    if (d > 0.25 && !a.lunge) {
      this.steer(a, spot, SPECS[ANT].speed, dt);
      return;
    }
    const step = Math.min(d, SPECS[ANT].speed * (a.lunge ? 2.5 : 1) * dt);
    if (d > 1e-4) a.p.addScaledVector(this.tmp3.subVectors(spot, a.p).normalize(), step);
    appleProject(a.p);
    appleNormal(a.p, a.n);
    // face it, swaying
    this.tmp3.subVectors(c.p, a.p);
    a.f.copy(this.tmp3).addScaledVector(a.n, -this.tmp3.dot(a.n)).normalize();
    a.f.applyAxisAngle(a.n, Math.sin(this.clock * 7 + a.id) * 0.25);
  }

  /**
   * A ladybug the ants quarrel with: while they gather it waits; then they lunge at it, one or two at
   * a time; three rounds and it's had enough: it flies off, or it stays and the ants run.
   */
  private quarrelLadybug(lb: Ant, dt: number) {
    const ring = this.ants.filter((b) => b.state === QUARREL && b.kind === ANT && b.qWith === lb.id);
    const inPlace = ring.filter((b) => b.p.distanceTo(this.quarrelSpot(b, lb, this.tmp2)) < 0.4);
    if ((lb.qNext ?? Infinity) === Infinity) {
      // gathering: more ants come
      if (ring.length < 10) {
        for (const a of this.ants) {
          if (a.kind !== ANT || (a.state !== WANDER && a.state !== CHASE) || a.tun || a.p.distanceTo(lb.p) > 6 || Math.random() > dt * 1.6) continue;
          this.joinQuarrel(a, lb, this.angleRound(lb, a.p), SPECS[LADYBUG].len * 0.95);
          lb.qGather = this.clock + 5;
          break;
        }
      }
      if (inPlace.length >= 3) {
        lb.qNext = this.clock + 0.6;
        return;
      }
      if (this.clock < (lb.qGather ?? 0)) return;
      // not enough came: it's over
      for (const a of ring) a.state = WANDER;
      lb.state = WANDER;
      lb.cool = 10;
      return;
    }
    if (this.clock < (lb.qNext ?? 0)) return;
    const who = inPlace.length ? inPlace : ring;
    const n = Math.random() < 0.35 ? 2 : 1;
    for (let i = 0; i < n && i < who.length; i++) who[Math.floor(Math.random() * who.length)].lunge = 0.35;
    lb.seg++;
    lb.qNext = this.clock + 0.9 + Math.random() * 0.7;
    if (lb.seg < 3) return;
    for (const a of ring) {
      a.state = FLEE;
      a.target = '';
      a.fleeFrom = lb.p.clone();
      a.cool = SPECS[ANT].cooldown * 0.5;
    }
    if (Math.random() < 0.5) {
      lb.state = SLAPPED; // flies off
      lb.qEnd = this.clock + 1.8;
    } else {
      lb.state = WANDER;
      lb.cool = 10;
      lb.seg = 0;
    }
  }

  /** A spider whose web a chafer-rider tore: it runs after that worm and scolds it, facing it. */
  private scoldFor(a: Ant, dt: number) {
    if (!a.scold) return false;
    a.scold.t -= dt;
    const w = this.everyone.find((x) => x.id === a.scold!.worm && x.mode === 'surface');
    if (!w || a.scold.t <= 0) {
      a.scold = undefined;
      a.ang = 0;
      a.target = '';
      return false;
    }
    const head = w.disp[N - 1];
    a.target = w.id;
    const d = a.p.distanceTo(head);
    if (d > SPECS[SPIDER].len * 2.2) {
      a.ang = +(d < SPECS[SPIDER].len * 4);
      this.steer(a, head, SPIDER_RUSH * 0.8, dt);
    } else {
      this.tmp.subVectors(head, a.p).addScaledVector(a.n, -this.tmp2.subVectors(head, a.p).dot(a.n));
      if (this.tmp.lengthSq() > 1e-8) a.f.lerp(this.tmp.normalize(), Math.min(1, dt * 5)).normalize();
      a.ang = 1;
    }
    return true;
  }

  /**
   * A ladybug on its back: it rocks a while (sliding if it was flung). Ants nearby come to carry it
   * off, a few round it; it goes faster the more carry. Nobody came in 5 s: it rights itself.
   */
  private upturnedLadybug(lb: Ant, dt: number) {
    const fresh = this.clock - (lb.flippedAt ?? -99) < 5;
    lb.seg = +!!fresh;
    if (lb.slide) {
      lb.p.addScaledVector(lb.slide, dt);
      lb.slide.multiplyScalar(Math.exp(-2.5 * dt));
      appleProject(lb.p);
      appleNormal(lb.p, lb.n);
      lb.slide.addScaledVector(lb.n, -lb.slide.dot(lb.n));
      if (lb.slide.lengthSq() < 0.01) lb.slide = undefined;
      return;
    }
    const crew = this.ants.filter((b) => b.state === CARRY && b.carry === lb.id);
    const under = crew.filter((b) => b.p.distanceTo(this.carrySpot(b, lb, this.tmp2)) < 0.3);
    if (crew.length < 6) {
      for (const a of this.ants) {
        if (a.kind !== ANT || (a.state !== WANDER && a.state !== CHASE) || a.tun || a.cool || a.p.distanceTo(lb.p) > 4.5) continue;
        if (Math.random() > dt * 1.2) continue;
        a.state = CARRY;
        a.carry = lb.id;
        a.carryAng = crew.length;
        a.carryFrom = a.p.clone();
        a.target = '';
        a.rush = undefined;
        a.meetWith = undefined;
        break;
      }
    }
    if (!under.length) {
      if (!fresh) {
        lb.state = WANDER;
        lb.cool = 8;
        lb.ang = 0;
        for (const a of crew) a.state = WANDER;
      }
      return;
    }
    lb.ang = 1; // carried
    if (!lb.haulTo) {
      // off the way the first carrier came from
      const first = under.reduce((x, y) => ((x.carryAng ?? 0) <= (y.carryAng ?? 0) ? x : y));
      const dir = new THREE.Vector3().subVectors(first.carryFrom ?? first.p, lb.p);
      dir.addScaledVector(lb.n, -dir.dot(lb.n));
      if (dir.lengthSq() < 1e-6) dir.copy(lb.f);
      dir.normalize();
      lb.haulDir = dir;
      lb.haulTo = appleProject(lb.p.clone().addScaledVector(dir, 14 + Math.random() * 8));
    }
    if (lb.p.distanceTo(lb.haulTo) < 0.5) {
      const dir = this.tmp.copy(lb.haulDir ?? lb.f).applyAxisAngle(lb.n, (Math.random() - 0.5) * 2);
      dir.addScaledVector(lb.n, -dir.dot(lb.n)).normalize();
      lb.haulTo = appleProject(lb.p.clone().addScaledVector(dir, 10 + Math.random() * 8));
    }
    const want = this.tmp.subVectors(lb.haulTo, lb.p);
    want.addScaledVector(lb.n, -want.dot(lb.n));
    if (want.lengthSq() > 1e-8 && lb.haulDir) lb.haulDir.lerp(want.normalize(), Math.min(1, dt * 0.8)).addScaledVector(lb.n, -lb.haulDir.dot(lb.n)).normalize();
    const speed = Math.min(0.9, 0.22 * under.length + 0.1);
    if (lb.haulDir) lb.p.addScaledVector(lb.haulDir, speed * dt);
    appleProject(lb.p);
    appleNormal(lb.p, lb.n);
  }

  /** An ant carrying an upturned ladybug: to its spot under it, then along. */
  private carryStep(a: Ant, dt: number) {
    const lb = this.ants.find((b) => b.id === a.carry && b.kind === LADYBUG && b.state === UPTURNED);
    if (!lb) {
      a.state = WANDER;
      a.carry = undefined;
      return;
    }
    const spot = this.carrySpot(a, lb, this.tmp2);
    if (a.p.distanceTo(spot) > 0.3) {
      this.steer(a, spot, SPECS[ANT].speed * 1.2, dt);
      return;
    }
    a.p.copy(spot);
    appleNormal(a.p, a.n);
    if (lb.haulDir) this.tmp.copy(lb.haulDir);
    else this.tmp.subVectors(lb.p, a.p);
    this.tmp.addScaledVector(a.n, -this.tmp.dot(a.n));
    if (this.tmp.lengthSq() > 1e-8) a.f.lerp(this.tmp.normalize(), Math.min(1, dt * 8)).normalize();
  }

  /** Where carrier a goes under ladybug lb. */
  private carrySpot(a: Ant, lb: Ant, out: THREE.Vector3) {
    const fwd = lb.haulDir ?? lb.f;
    const side = this.tmp3.crossVectors(lb.n, fwd).normalize();
    const len = SPECS[LADYBUG].len;
    const SPOTS = [
      [0, 0],
      [-0.16, 0.1],
      [-0.16, -0.1],
      [0.14, 0.12],
      [0.14, -0.12],
      [-0.3, 0],
    ];
    const [x, y] = SPOTS[(a.carryAng ?? 0) % SPOTS.length];
    out.copy(lb.p).addScaledVector(fwd, x * len).addScaledVector(side, y * len);
    return appleProject(out);
  }

  /** An upturned ladybug rights itself and flies away; its carriers scatter. */
  private ladybugAway(lb: Ant) {
    for (const a of this.ants) {
      if (a.state !== CARRY || a.carry !== lb.id) continue;
      a.state = FLEE;
      a.carry = undefined;
      a.fleeFrom = lb.p.clone();
      a.startle = 0;
      a.cool = SPECS[ANT].cooldown * 0.5;
    }
    lb.state = SLAPPED;
    lb.qEnd = this.clock + 1.8;
    lb.seg = 99; // (the view: flies off from its back)
    lb.haulTo = lb.haulDir = undefined;
    lb.ang = 0;
  }

  /** A ladybug keeps away from the earwig. */
  private awayFromEarwig(a: Ant, dt: number) {
    const ew = this.ants.find((b) => b.kind === EARWIG && b.state !== SLAPPED && b.state !== DRILL && b.age >= EARWIG_FLY_IN && b.p.distanceTo(a.p) < 2.21);
    if (!ew) return false;
    this.steer(a, this.tmp3.copy(a.p).multiplyScalar(2).sub(ew.p), SPECS[LADYBUG].speed, dt);
    return true;
  }

  /** A worm one ladybug holds by one end, that this ladybug is the nearest free one to (it takes the other end). */
  private contestFor(a: Ant, worms: Map<string, WormInfo>) {
    for (const lb of this.ants) {
      if (lb.kind !== LADYBUG || lb.state !== HOLD || lb === a) continue;
      const w = worms.get(lb.target);
      if (!w || w.mode !== 'surface' || this.ants.some((b) => b !== lb && b.kind === LADYBUG && b.state === HOLD && b.target === w.id)) continue;
      const d = a.p.distanceTo(w.disp[N >> 1]);
      if (!this.ants.some((b) => b !== a && b.kind === LADYBUG && (b.state === WANDER || b.state === CHASE) && !b.cool && !b.tun && b.age > LADYBUG_FLY_IN && b.p.distanceTo(w.disp[N >> 1]) < d)) return w;
    }
    return null;
  }

  /** A worm held by two ladybugs (one at each end) claps them together: both are flung on their backs. */
  clap(player: string) {
    const two = this.ants.filter((a) => a.kind === LADYBUG && a.state === HOLD && a.target === player);
    if (two.length < 2) return;
    const [x, y] = two;
    this.hits.delete(`${player}:${LADYBUG}`);
    for (const [a, b] of [
      [x, y],
      [y, x],
    ]) {
      appleProject(a.p);
      appleNormal(a.p, a.n);
      const away = new THREE.Vector3().subVectors(a.p, b.p).addScaledVector(a.n, -this.tmp.subVectors(a.p, b.p).dot(a.n));
      if (away.lengthSq() < 1e-6) away.copy(a.f).negate();
      away.normalize();
      this.flipLadybug(a, away);
      a.slide = away.multiplyScalar(5 + Math.random());
    }
  }

  /** A ladybug that let go stands off the worm's end (not left standing inside its body). */
  private standOff(a: Ant, w: WormInfo | undefined, seg: number) {
    if (!w) return;
    const end = w.disp[seg];
    const out = this.tmp.subVectors(end, w.disp[seg === 0 ? 1 : N - 2]);
    const up = appleNormal(end, this.tmp2);
    out.addScaledVector(up, -out.dot(up));
    if (out.lengthSq() < 1e-8) return;
    a.p.copy(end).addScaledVector(out.normalize(), SPECS[LADYBUG].len * 0.45);
    appleProject(a.p);
    appleNormal(a.p, a.n);
  }

  /** Over onto its back, a little away. */
  private flipLadybug(lb: Ant, away: THREE.Vector3) {
    for (const a of this.ants) if (a.state === QUARREL && a.qWith === lb.id) a.state = WANDER;
    lb.state = UPTURNED;
    lb.flippedAt = this.clock;
    lb.haulTo = lb.haulDir = undefined;
    lb.ang = 0;
    lb.target = '';
    lb.p.addScaledVector(away, 0.25);
    appleProject(lb.p);
    appleNormal(lb.p, lb.n);
  }

  /** Ants come to the rescue of a worm a ladybug holds: two in place round it and it lets go to quarrel. */
  private antsRescue(lb: Ant, w: WormInfo, dt: number) {
    const ring = this.ants.filter((b) => b.state === QUARREL && b.qWith === lb.id);
    if (ring.length < 10) {
      for (const a of this.ants) {
        if (a.kind !== ANT || (a.state !== WANDER && a.state !== CHASE) || a.tun || a.cool || a.rush || a.p.distanceTo(lb.p) > 6) continue;
        if (Math.random() > dt * 1.6) continue;
        a.meetWith = undefined;
        a.rush = undefined;
        this.joinQuarrel(a, lb, this.angleRound(lb, a.p), SPECS[LADYBUG].len * 0.95);
        break;
      }
    }
    if (ring.filter((b) => b.p.distanceTo(this.quarrelSpot(b, lb, this.tmp2)) < 0.4).length < 2) return false;
    this.hits.delete(`${w.id}:${LADYBUG}`);
    appleProject(lb.p);
    appleNormal(lb.p, lb.n);
    lb.state = QUARREL;
    lb.target = '';
    lb.ang = 0;
    lb.seg = 0;
    lb.qGather = this.clock;
    lb.qNext = this.clock + 0.3;
    return true;
  }

  /**
   * A worm standing on its tail near a spider taunts it: the spider faces it, legs up (5 s; a worm
   * half way to the goal or more scares it: 1.1 s, then it flees).
   */
  private tauntedBy(a: Ant, dt: number, worms: WormInfo[]) {
    a.meetCool = Math.max(0, (a.meetCool ?? 0) - dt);
    if (a.tauntBy === undefined) {
      if (a.meetCool || a.spar !== undefined) return false;
      const w = worms.find((x) => x.rear && x.mode === 'surface' && x.disp.some((b) => b.distanceTo(a.p) < 2.2 * Math.max(1, x.g ?? 1)));
      if (!w) return false;
      a.tauntBy = w.id;
      a.target = w.id;
      a.tauntScared = winProgress(w.g) >= 0.5;
      a.tauntT = a.tauntScared ? 1.1 : 5;
    }
    const w = worms.find((x) => x.id === a.tauntBy);
    a.tauntT = (a.tauntT ?? 0) - dt;
    if (!w || a.tauntT <= 0) {
      a.tauntBy = undefined;
      a.target = '';
      a.ang = 0;
      a.meetCool = 12;
      a.f.applyAxisAngle(a.n, Math.PI * (0.8 + Math.random() * 0.4));
      a.burst = 1.5;
      if (a.tauntScared && w) {
        a.state = FLEE;
        a.fleeFrom = w.disp[N - 1].clone();
        a.startle = 0;
      }
      return a.state === FLEE;
    }
    const head = w.disp[N - 1];
    this.tmp.subVectors(head, a.p).addScaledVector(a.n, -this.tmp2.subVectors(head, a.p).dot(a.n));
    if (this.tmp.lengthSq() > 1e-8) a.f.lerp(this.tmp.normalize(), Math.min(1, dt * 5)).normalize();
    a.ang = 1;
    return true;
  }

  /** An ant and a spider meet: they square up (5 s); more ants join; then one side runs. */
  private squareUp(a: Ant, dt: number) {
    if (a.spar !== undefined) {
      const sp = this.ants.find((b) => b.id === a.spar && b.kind === SPIDER && b.state === WANDER);
      if (!sp) {
        a.spar = undefined;
        a.ang = 0;
        return false;
      }
      const d = a.p.distanceTo(sp.p);
      if (d > 0.6) this.steer(a, sp.p, SPECS[ANT].speed * 0.6, dt);
      else {
        this.tmp.subVectors(sp.p, a.p).addScaledVector(a.n, -this.tmp2.subVectors(sp.p, a.p).dot(a.n));
        if (this.tmp.lengthSq() > 1e-8) a.f.lerp(this.tmp.normalize(), Math.min(1, dt * 6)).normalize();
      }
      a.ang = +(d <= 0.84);
      a.sparT = (a.sparT ?? 0) - dt;
      // the first one calls a friend
      if (sp.spar === a.id && a.sparT > 0.8) {
        for (const b of this.ants) {
          if (b.kind !== ANT || b.state !== WANDER || b.spar !== undefined || b.cool || b.tun || b.p.distanceTo(sp.p) > 4 || Math.random() > dt * 1.2) continue;
          b.spar = sp.id;
          b.sparT = a.sparT;
          b.meetWith = undefined;
          break;
        }
      }
      if (a.sparT <= 0) {
        if (sp.spar === a.id) {
          if (Math.random() < 0.5) {
            // the spider gives up
            sp.state = FLEE;
            sp.fleeFrom = a.p.clone();
            sp.startle = 0;
            sp.cool = 6;
          } else {
            for (const b of this.ants) {
              if (b.kind !== ANT || b.spar !== sp.id || b === a) continue;
              b.spar = undefined;
              b.ang = 0;
              b.state = FLEE;
              b.fleeFrom = sp.p.clone();
              b.startle = 0;
              b.cool = SPECS[ANT].cooldown * 0.5;
            }
          }
        }
        const run = sp.spar === a.id && sp.state !== FLEE;
        a.spar = undefined;
        if (sp.spar === a.id) sp.spar = undefined;
        if (run) {
          a.ang = 0;
          a.state = FLEE;
          a.fleeFrom = sp.p.clone();
          a.startle = 0;
          a.cool = SPECS[ANT].cooldown * 0.5;
          if (!this.ants.some((b) => b !== a && b.spar === sp.id)) sp.ang = 0;
          return true;
        }
        a.ang = 0;
        if (!this.ants.some((b) => b !== a && b.spar === sp.id)) sp.ang = 0;
        a.meetCool = 12;
        a.f.applyAxisAngle(a.n, Math.PI * (0.7 + Math.random() * 0.6));
        a.burst = 0.8;
      }
      return true;
    }
    if (a.meetCool) return false;
    const sp = this.ants.find((b) => b.kind === SPIDER && b.state === WANDER && b.spar === undefined && b.p.distanceTo(a.p) < 0.8);
    if (!sp) return false;
    a.spar = sp.id;
    sp.spar = a.id;
    a.sparT = 5;
    a.meetWith = undefined;
    return true;
  }

  /** Two wandering ants meet: they stop and touch feelers a couple of seconds, then part. */
  private meet(a: Ant, dt: number) {
    a.meetCool = Math.max(0, (a.meetCool ?? 0) - dt);
    if (a.meetWith !== undefined) {
      const b = this.ants.find((x) => x.id === a.meetWith);
      if (!b || b.state !== WANDER || b.meetWith !== a.id || b.tun) {
        a.meetWith = undefined;
        a.meetCool = 10;
        return false;
      }
      if (a.p.distanceTo(b.p) > 0.36) this.steer(a, b.p, SPECS[ANT].speed * 0.5, dt);
      else {
        this.tmp.subVectors(b.p, a.p).addScaledVector(a.n, -this.tmp2.subVectors(b.p, a.p).dot(a.n));
        if (this.tmp.lengthSq() > 1e-8) a.f.lerp(this.tmp.normalize(), Math.min(1, dt * 6)).normalize();
        a.f.applyAxisAngle(a.n, Math.sin(this.clock * 5 + a.id) * 0.4 * dt);
      }
      a.meetT = (a.meetT ?? 0) - dt;
      if (a.meetT <= 0) {
        a.meetWith = undefined;
        b.meetWith = undefined;
        a.meetCool = b.meetCool = 10;
        a.f.applyAxisAngle(a.n, Math.PI * (0.6 + Math.random() * 0.8));
        b.f.applyAxisAngle(b.n, -Math.PI * (0.6 + Math.random() * 0.8));
        a.burst = b.burst = 0.6;
      }
      return true;
    }
    if (a.meetCool || a.cool) return false;
    const b = this.ants.find((x) => x !== a && x.kind === ANT && x.state === WANDER && x.meetWith === undefined && !x.meetCool && !x.cool && !x.tun && x.p.distanceTo(a.p) < 1.1);
    if (!b) return false;
    a.meetWith = b.id;
    b.meetWith = a.id;
    a.meetT = b.meetT = 2 + Math.random() * 2.5;
    return true;
  }

  /**
   * An ant holding a worm's end for a while goes over to the other end if more of them hold that one
   * (they gather on one end to haul it). True if it let go to go there.
   */
  private switchSides(a: Ant, w: WormInfo, dt: number) {
    if (!atEnd(a.seg)) return false;
    a.holdT = (a.holdT ?? 0) + dt;
    if (a.holdT < 1.4 + (a.id % 4) * 0.4) return false;
    let head = 0;
    let tail = 0;
    for (const b of this.ants) {
      if (b.kind === ANT && b.state === HOLD && b.target === w.id && !b.tun && atEnd(b.seg)) {
        if (b.seg >= N >> 1) head++;
        else tail++;
      }
    }
    const mine = a.seg >= N >> 1 ? 'head' : 'tail';
    if ((mine === 'head' ? head : tail) < (mine === 'head' ? tail : head)) {
      a.state = CHASE;
      a.wantEnd = mine === 'head' ? 'tail' : 'head';
      a.holdT = 0;
      appleProject(a.p);
      return true;
    }
    return false;
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
    a.state = WANDER;
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
      a.state = WANDER;
      appleProject(a.p);
      return;
    }
    const n = t.pts.length;
    if (a.state === HOLD) {
      // holding a burrowing worm (its owner drags it back towards the ant)
      const w = worms.get(a.target);
      if (w && w.mode === 'dig') {
        a.p.copy(w.disp[a.seg]);
        return;
      }
      if (w && w.mode === 'surface') {
        // it came out with the ant on it: the ant rides out too
        a.tun = '';
        a.p.copy(w.disp[a.seg]);
        return;
      }
      a.state = WANDER;
    }
    if (a.state === FLEE && (a.tumbleT ?? 0) > 0) {
      // fell off: tumbles a moment
      a.tumbleT = Math.max(0, (a.tumbleT ?? 0) - dt);
      a.ang = 1 - (a.tumbleT ?? 0) / 0.6;
      if (!a.tumbleT) a.ang = 0;
      return;
    }
    if (a.state === FLEE) {
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
      if (a.cool < SPECS[ANT].cooldown - 2.5) a.state = WANDER;
    } else {
      a.state = WANDER;
      // a burrowing worm right here? grab its nearer end
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
            this.catchWorm(a, w, k < N >> 1 ? 0 : N - 1);
            return;
          }
        }
      }
    }
    // a worm in this passage: go after it, stopping just behind it; nobody here: make for the way out
    const prey = a.state === FLEE ? undefined : [...this.digIn.values()].find((x) => x.t.id === t.id);
    let gapK = 1; // close behind the worm: ease off smoothly (no stop-and-go, no dithering)
    if (prey) {
      const ahead = prey.i - a.tpos;
      const half = prey.half ?? 2;
      const step = prey.step ?? 0.1;
      const gap = (Math.abs(ahead) - half) * step; // from the worm's end
      if (gap < -0.1) {
        // inside the worm's body: back off to just behind it
        a.tpos = Math.min(n - 1, Math.max(0, prey.i - Math.sign(ahead || 1) * (half + 0.1 / step)));
        a.tdir = ahead >= 0 ? 1 : -1;
      } else if (Math.abs(ahead) > 1) a.tdir = ahead > 0 ? 1 : -1;
      gapK = Math.min(1, Math.max(0, (gap - 0.15) / (12 * step)));
    } else if (a.state !== FLEE) {
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
    const chase = prey ? Math.max(SPECS[ANT].speed * 1.1, (this.wormSpeed.get(prey.id ?? '') ?? 0) * 1.2) * this.rules.speed * gapK : 0;
    let move = (a.state === FLEE ? FLEE_SPEED : prey ? chase : SPECS[ANT].speed * 0.85) * dt;
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
    a.state = HOLD;
    if (a.kind === LADYBUG) {
      // the nearer end, head or tail; a second ladybug takes the other end; never three
      const other = this.ants.find((b) => b !== a && b.kind === LADYBUG && b.state === HOLD && b.target === w.id);
      const nearer = a.p.distanceTo(w.disp[N - 1]) < a.p.distanceTo(w.disp[0]) ? N - 1 : 0;
      if (other && this.ants.some((b) => b !== a && b !== other && b.kind === LADYBUG && b.state === HOLD && b.target === w.id)) {
        a.state = CHASE;
        return;
      }
      a.seg = other ? (other.seg !== N - 1 ? N - 1 : 0) : nearer;
      a.ang = 0;
      a.wagT = undefined;
    } else {
      a.seg = Math.max(1, Math.min(N - 2, nearest));
      a.ang = (Math.random() - 0.5) * 2.2;
      a.holdT = 0;
      a.biteT = 0;
      a.wantEnd = undefined;
    }
    const key = `${w.id}:${a.kind}`;
    if (!this.hits.has(key)) this.hits.set(key, { done: 0, slams: 0, need: Math.round(randIn(SPECS[a.kind].hits)) });
  }

  private spawn(kind: Kind): Ant {
    const p = new THREE.Vector3().randomDirection();
    p.y = p.y * 0.6; // not at the poles (stem, bottom)
    appleProject(p);
    const n = appleNormal(p, new THREE.Vector3());
    const f = new THREE.Vector3().randomDirection();
    f.addScaledVector(n, -f.dot(n)).normalize();
    return { id: this.nextId++, kind, p, f, n, state: WANDER, target: '', seg: 0, ang: 0, cool: 0, age: 0, burst: 0.5, startle: 0, tun: '', tpos: 0, tdir: 1, fresh: false };
  }

  // ---------- the rose chafer ----------

  /**
   * A worm riding the chafer: on (jumped on its back), off (jumped off; scoot: it runs a little way
   * from under you), bite (it bolts, or a bite on the run spurs it: ×1.25 for 5 s), turn (steering, −1…1).
   */
  ride(player: string, how: { on?: boolean; off?: boolean; scoot?: boolean; bite?: boolean; turn?: number }) {
    const c = this.ants.find((a) => a.kind === CHAFER);
    if (!c) return;
    if (how.on && !c.rider) {
      this.release(player);
      c.rider = player;
    }
    if (c.rider !== player) return;
    if (how.off) {
      c.rider = undefined;
      if (how.scoot && (c.state !== CHASE || c.relocating)) {
        c.state = CHASE;
        c.seg = 2;
        c.relocating = true;
        c.startle = 0;
        c.steer = 0;
        c.runLeft = Math.max(c.runLeft ?? 0, SPECS[CHAFER].len * 1.35);
      }
      return;
    }
    if (how.bite && c.state === CHASE && !c.relocating && !(c.startle > 0)) {
      // spurred on the run (the pose flips between two)
      c.spurT = 5;
      c.seg = c.seg === 4 ? 5 : 4;
    }
    if (how.bite && (c.state !== CHASE || c.relocating)) {
      // bitten: it bolts, two laps round the fruit
      c.state = CHASE;
      c.seg = 1;
      c.startle = 0.4;
      c.relocating = false;
      c.runLeft = 2 * Math.PI * 2 * R0;
      c.tornSilk = undefined;
    }
    if (Number.isFinite(how.turn)) c.steer = (c.steer ?? 0) + Math.max(-1, Math.min(1, how.turn!));
  }

  /** The rider fell off (stunned, a new round…): the chafer calms down. */
  unseat(player: string) {
    const c = this.ants.find((a) => a.kind === CHAFER && a.rider === player);
    if (!c) return;
    c.rider = undefined;
    c.target = '';
    c.state = WANDER;
    c.runLeft = 0;
    c.relocating = false;
    c.restLeft = 20 + Math.random() * 10;
    c.cool = 0.6;
    c.steer = 0;
    c.ang = 0;
  }

  /** The chafer trundles off somewhere else (a short way, calmly). */
  private relocateChafer(c: Ant) {
    c.state = CHASE;
    c.seg = 2;
    c.relocating = true;
    c.runLeft = (0.2 + Math.random() * 0.8) * Math.PI * R0;
    c.f.applyAxisAngle(c.n, (Math.random() - 0.5) * Math.PI * 2);
    c.ang = 0;
  }

  /**
   * The chafer. Sits (20–30 s), then moves somewhere else. Bitten, it bolts: weaving, faster than any
   * worm; it tears through spider threads, flings ants off, upturns ladybugs, scares the earwig off,
   * and stuns any worm it runs over. seg (sent along): 0 sitting, 1 bolting, 2 moving off, 3 startled,
   * 4/5 spurred.
   */
  private chaferStep(c: Ant, dt: number, worms: WormInfo[]) {
    const len = SPECS[CHAFER].len;
    c.cool = Math.max(0, c.cool - dt);
    if (c.rider && !this.everyone.some((w) => w.id === c.rider && w.mode === 'surface')) c.rider = undefined;
    c.target = c.rider ?? '';
    if (c.state !== CHASE) {
      c.state = WANDER;
      c.steer = 0;
      c.restLeft = (c.restLeft ?? 20 + Math.random() * 10) - dt;
      if (c.restLeft > 0) return;
      this.relocateChafer(c);
    }
    if (c.startle > 0) {
      c.startle -= dt;
      return;
    }
    // it weaves: a new turn now and then, and a slow drift from side to side
    const steer = c.steer ?? 0;
    c.steer = 0;
    c.wanderT = (c.wanderT ?? 0) - dt;
    if (c.wanderT <= 0) {
      c.wanderT = 0.2 + Math.random() * 0.9;
      c.wanderTurn = (Math.random() - 0.5) * 2.6;
    }
    c.ang += ((c.wanderTurn ?? 0) - c.ang) * (1 - Math.exp(-5 * dt));
    c.driftT = (c.driftT ?? 0) - dt;
    if (c.driftT <= 0) {
      c.driftT = 4 + Math.random() * 5;
      c.driftTo = -(Math.sign(c.driftTo ?? 0) || (Math.random() < 0.5 ? -1 : 1)) * (0.15 + Math.random() * 0.25);
    }
    c.drift = (c.drift ?? 0) + ((c.driftTo ?? 0) - (c.drift ?? 0)) * (1 - Math.exp(-0.8 * dt));
    if (c.rider && steer) c.f.applyAxisAngle(c.n, steer);
    else if (!c.relocating) c.f.applyAxisAngle(c.n, (c.ang * 0.6 + c.drift) * dt);
    if ((c.spurT ?? 0) > 0) {
      c.spurT = Math.max(0, (c.spurT ?? 0) - dt);
      if (!c.spurT && (c.seg === 4 || c.seg === 5)) c.seg = 1;
    }
    const speed = c.relocating ? SPECS[CHAFER].speed / 1.5 : SPECS[CHAFER].speed * ((c.spurT ?? 0) > 0 ? 1.25 : 1);
    const step = Math.min(speed * dt, Math.max(0, c.runLeft ?? 0));
    this.move(c, speed, step / speed);
    c.runLeft = (c.runLeft ?? 0) - step;
    // spider threads in its way: pushed aside, mostly torn
    const half = len * 0.5;
    const side = this.tmp3.crossVectors(c.n, c.f).normalize();
    for (const [id, silk] of this.threads) {
      let touched = false;
      const first = (this.silkTotal.get(id) ?? silk.length) - silk.length; // the oldest point's number
      for (let i = 0; i < silk.length; i++) {
        const p = silk[i];
        if (isZero(p)) continue;
        const d = this.tmp.subVectors(p, c.p);
        const across = Math.abs(d.dot(side));
        const along = d.dot(c.f);
        if (across > half || along > len * 0.75 || along < -len * 0.55) continue;
        if (across < half * 0.3 && Math.abs(along) < len * 0.3 && !c.tornSilk?.has(first + i)) {
          c.tornSilk ??= new Set();
          for (let k = -3; k <= 3; k++) c.tornSilk.add(first + i + k);
          if (Math.random() < 0.85 && i > 0 && i < silk.length - 1) {
            p.set(0, 0, 0); // torn
            this.websMoved = this.websTouched = true;
            touched = true;
            continue;
          }
        }
        const k = 1 - across / half;
        p.addScaledVector(c.f, -(step * 0.85) * k * k);
        appleProject(p);
        this.websMoved = this.websTouched = true;
        touched = true;
      }
      // the spider whose web the rider tore goes after the rider
      const spider = touched && c.rider ? this.ants.find((a) => a.id === id && a.kind === SPIDER && a.state === WANDER) : undefined;
      if (spider && !spider.scold) spider.scold = { worm: c.rider!, t: 5 };
    }
    // critters in its way
    for (const a of this.ants) {
      if (a === c || a.kind === CHAFER || a.tun || a.state === SLAPPED || a.state === CARRIED || a.state === FLUNG) continue;
      const earwigWide = !c.relocating && a.kind === EARWIG;
      if (a.p.distanceTo(c.p) > (earwigWide ? len * 1.3 : c.relocating ? len * 0.55 : len * 0.75) + SPECS[a.kind].len * 0.3) continue;
      const away = new THREE.Vector3().subVectors(a.p, c.p).addScaledVector(a.n, -this.tmp.subVectors(a.p, c.p).dot(a.n)).normalize();
      if (away.lengthSq() < 0.5) away.copy(c.f);
      const wild = !c.relocating;
      if (a.kind === EARWIG) {
        if (wild && a.state !== DRILL) {
          this.earwigLeave(a);
          continue;
        }
        a.turnAway = 1.5;
        a.p.addScaledVector(away, 0.4);
        appleProject(a.p);
        continue;
      }
      if (a.state === HOLD) this.hits.delete(`${a.target}:${a.kind}`);
      appleProject(a.p);
      appleNormal(a.p, a.n);
      a.target = '';
      if (a.kind === ANT && wild) {
        // flung into the air
        a.state = FLUNG;
        a.knockDir = away.multiplyScalar(2.6 + Math.random() * 1.2).addScaledVector(a.n, 3.6 + Math.random() * 1.2).addScaledVector(c.f, 2.2);
        a.qEnd = this.clock + 1.1;
        a.rush = undefined;
        a.ang = 0;
        continue;
      }
      if (a.kind === LADYBUG && wild && a.age > LADYBUG_FLY_IN) {
        if (a.state === KNOCKED || (a.state === UPTURNED && this.clock - (a.flippedAt ?? -9) <= 0.6)) continue;
        if (a.state === UPTURNED) {
          // one on its back: knocked back onto its feet
          for (const b of this.ants) {
            if (b.state === CARRY && b.carry === a.id) {
              b.state = WANDER;
              b.carry = undefined;
              b.cool = 3;
            }
          }
          a.state = WANDER;
          a.cool = 3;
          a.haulTo = a.haulDir = undefined;
          a.ang = 0;
          a.p.addScaledVector(away, 0.3);
          appleProject(a.p);
          continue;
        }
        this.flipLadybug(a, away);
      } else if (a.kind === LADYBUG) {
        a.state = KNOCKED;
        a.knockT = 0.9;
        a.knockDir = away;
      } else {
        a.state = FLEE;
        a.startle = 0;
        a.knockT = 0.5;
        a.knockStay = false;
        a.knockDir = away;
        a.cool = 6;
      }
    }
    // worms it runs over: stunned (once in a while each)
    c.stunned ??= new Map<string, number>();
    for (const w of c.relocating ? [] : worms) {
      if (w.id === c.rider || w.safe || w.mode !== 'surface' || (c.stunned.get(w.id) ?? 0) > this.clock) continue;
      if (w.disp.some((b, i) => b.distanceTo(c.p) < len * 0.4 + RADII[i] * girth(w.g ?? 1))) {
        c.stunned.set(w.id, this.clock + 5 + 1);
        this.onChafer?.(w.id);
      }
    }
    if ((c.runLeft ?? 0) <= 0) {
      c.state = WANDER;
      c.seg = 0;
      c.spurT = 0;
      c.relocating = false;
      c.restLeft = 20 + Math.random() * 10;
      c.ang = 0;
    }
  }

  // ---------- the earwig ----------

  /**
   * The earwig: flies in once a minute (or so) and stays 100 s. It hunts worms on the skin: bites
   * (25 points, the worm panics) or grabs with its pincers and holds it (until it tugs free); at
   * a worm gnawing inside it dives and drills through the fruit. Ants gang up on it: five and it
   * goes (or shakes them off); it snaps at spiders and ladybugs too. act (sent in seg): 1 a jaw
   * snap, 2 a pincer snap, 3 tugging, 4 a pincer grab, 5 holding a worm, 6 startled.
   */
  private earwigStep(e: Ant, dt: number, worms: WormInfo[]) {
    const len = SPECS[EARWIG].len;
    e.lifeT = (e.lifeT ?? 0) + dt;
    if (e.state === SLAPPED) return;
    if ((e.actT ?? 0) > 0) {
      e.actT = Math.max(0, (e.actT ?? 0) - dt);
      e.ang = (e.actSide ?? 1) * (1 - (e.actT ?? 0) / (e.actLen ?? 1));
      if (!e.actT) e.act = 0;
    }
    e.seg = e.act ?? 0;
    if (!e.act) e.ang = 0;
    e.biteCool = Math.max(0, (e.biteCool ?? 0) - dt);
    e.drillCool = Math.max(0, (e.drillCool ?? 1.5) - dt);
    e.turnAway = Math.max(0, (e.turnAway ?? 0) - dt);
    if (e.state === DRILL) return this.drillStep(e, dt, worms);
    if (e.act === 6) return; // startled
    // ants ganging up: five and it leaves (or snaps them away and is left alone a while)
    const gang = this.ants.filter((a) => a.kind === ANT && a.state === QUARREL && a.qWith === e.id);
    if (gang.length >= 5) {
      if (Math.random() < 0.5) return this.earwigLeave(e);
      for (const a of gang) {
        a.state = FLEE;
        a.qWith = undefined;
        a.fleeFrom = e.p.clone();
        a.startle = 0;
        a.cool = SPECS[ANT].cooldown;
      }
      e.antProof = this.clock + 8;
      this.earwigAct(e, 2, 0.6, 1);
      return;
    }
    const holdingWorm = !!e.holding;
    for (const a of this.ants) {
      if (this.clock < (e.antProof ?? 0)) break;
      if (a.kind !== ANT || (a.state !== WANDER && a.state !== CHASE) || a.tun || a.cool) continue;
      const d = a.p.distanceTo(e.p);
      // it has a worm: ants come from far; else they join one that already started
      const come = holdingWorm ? d < 11 && Math.random() < dt * 2.8 : gang.length > 0 && d < 6 && Math.random() < dt * 0.6;
      if (d < len * 0.45 || come) {
        this.joinQuarrel(a, e, this.angleRound(e, a.p), 1);
        gang.push(a);
      }
    }
    const held = this.ants.find((a) => a.state === CARRIED && a.heldBy === e.id);
    if (held) this.holdInPincers(e, held, dt);
    if (e.lifeT > 100) return this.earwigLeave(e);
    // a spider within reach: grabbed or snapped at
    if (!held && !e.biteCool) {
      for (const s of this.ants) {
        if (s.kind !== SPIDER || s.state === CARRIED || s.tun || s.p.distanceTo(e.p) > len * 0.6) continue;
        e.biteCool = 2.5;
        if (Math.random() < 0.5) this.grab(e, s, 3);
        else {
          this.earwigAct(e, 2, 0.45);
          s.state = FLEE;
          s.fleeFrom = e.p.clone();
          s.cool = 6;
          e.turnAway = 1.2;
          e.f.subVectors(e.p, s.p).addScaledVector(e.n, -this.tmp.subVectors(e.p, s.p).dot(e.n)).normalize();
        }
        break;
      }
    }
    // a ladybug: grabbed (it tugs three times and gets away) or knocked aside
    if (!held && !e.biteCool) {
      for (const l of this.ants) {
        if (l.kind !== LADYBUG || l.tun || l.age < LADYBUG_FLY_IN || l.state === SLAPPED || l.state === KNOCKED || l.state === CARRIED || l.state === UPTURNED) continue;
        if (l.p.distanceTo(e.p) > len * 0.55) continue;
        e.biteCool = 2.5;
        if (l.state === HOLD) this.hits.delete(`${l.target}:${LADYBUG}`);
        appleProject(l.p);
        appleNormal(l.p, l.n);
        if (Math.random() < 0.35) {
          l.tugs = 0;
          this.grab(e, l, 99);
        } else {
          this.earwigAct(e, 1, 0.22, this.angleRound(e, l.p) > 0 ? 1 : -1);
          l.state = KNOCKED;
          l.target = '';
          l.knockT = 0.9;
          l.knockDir = new THREE.Vector3().subVectors(l.p, e.p).addScaledVector(l.n, -this.tmp.subVectors(l.p, e.p).dot(l.n)).normalize();
        }
        break;
      }
    }
    // its prey: the nearest worm on the skin (not one another earwig has)
    let prey: WormInfo | null = null;
    let pd = SPECS[EARWIG].chase * this.rules.chase;
    for (const w of worms) {
      if (w.mode !== 'surface' || this.ants.some((b) => b !== e && b.kind === EARWIG && b.state !== SLAPPED && (b.holding === w.id || b.preyId === w.id))) continue;
      const d = w.disp[N >> 1].distanceTo(e.p);
      if (d < pd) {
        pd = d;
        prey = w;
      }
    }
    e.preyId = prey?.id;
    const slow = (1 / (1 + 0.35 * gang.length)) * (held ? 0.5 : 1); // ants on it and a catch in its pincers slow it
    // somebody gnawing inside: dive and drill at them
    if (!e.drillCool && !held && !e.holding) {
      const digger = this.nearestDigger(e, worms);
      if (digger) return void this.startDrill(e, digger.disp[N >> 1]);
    }
    if (e.holding) {
      const w = worms.find((x) => x.id === e.holding);
      e.holdT = (e.holdT ?? 0) + dt;
      if (!w || w.mode !== 'surface' || e.holdT > 12) {
        this.onEarwig?.(e.holding, 0, 'drop');
        e.holding = undefined;
        e.act = 0;
        e.biteCool = 4;
      } else {
        this.earwigAct(e, 5, 0.3, e.holdSide ?? 1);
        e.ang = e.holdSide ?? 1;
        return;
      }
    }
    if (prey && !e.turnAway) {
      const preySpeed = this.wormSpeed.get(prey.id) ?? 0;
      let gap = Infinity;
      for (let i = 0; i < N; i++) gap = Math.min(gap, prey.disp[i].distanceTo(e.p) - RADII[i] * girth(prey.g ?? 1));
      // close: maybe it comes at the worm side-on, to grab it with the pincers
      if (gap > len * 0.85) e.sideOn = undefined;
      else e.sideOn ??= Math.random() < this.rules.earwigGrab;
      if (e.sideOn && gap < len * 0.6 && !e.biteCool) {
        const to = this.tmp3.subVectors(prey.disp[N >> 1], e.p);
        to.addScaledVector(e.n, -to.dot(e.n)).normalize();
        const side = this.tmp2.crossVectors(e.n, to);
        if (side.dot(e.f) < 0) side.negate();
        e.f.lerp(side, Math.min(1, dt * 14)).normalize();
      } else if (gap > len * 0.32) this.steer(e, prey.disp[N >> 1], Math.max(SPECS[EARWIG].speed, preySpeed * this.rules.earwigChase) * slow, dt);
      else {
        const to = this.tmp3.subVectors(prey.disp[N >> 1], e.p);
        to.addScaledVector(e.n, -to.dot(e.n));
        if (to.lengthSq() > 1e-6) e.f.lerp(to.normalize(), Math.min(1, dt * 8)).normalize();
      }
      const inJaws = gap < len * 0.32 || prey.disp.some((b, i) => this.segDist(b, e.p, this.tmp2.copy(e.p).addScaledVector(e.f, len * 0.45)) < 0.3 + RADII[i] * girth(prey!.g ?? 1));
      const to = this.tmp3.subVectors(prey.disp[N >> 1], e.p);
      const sideways = (e.sideOn && gap < len * 0.62) || (!inJaws && gap < len * 0.5 && to.normalize().dot(e.f) < 0.3);
      if (!e.biteCool && (inJaws || sideways)) {
        e.biteCool = 1.3;
        e.sideOn = undefined;
        if (!sideways && Math.random() >= this.rules.earwigGrab) {
          this.earwigAct(e, 1, 0.22, Math.random() < 0.5 ? -1 : 1);
          this.onEarwig?.(prey.id, 25, 'bite');
        } else {
          e.holding = prey.id;
          e.target = prey.id;
          e.holdT = 0;
          e.holdAt = prey.disp[N >> 1].clone();
          e.holdSide = this.angleRound(e, e.holdAt) > 0 ? 1 : -1;
          this.onEarwig?.(prey.id, 25, 'grab');
        }
      }
    } else {
      // roams, and snaps at the air now and then
      e.f.applyAxisAngle(e.n, (Math.sin(this.clock * 0.7 + e.id) * 0.8 + Math.sin(this.clock * 1.9 + e.id * 2) * 0.4) * dt);
      this.move(e, SPECS[EARWIG].speed * 0.5 * slow, dt);
      if (!e.act && Math.random() < dt * 0.25) this.earwigAct(e, Math.random() < 0.5 ? 1 : 2, Math.random() < 0.5 ? 0.22 : 0.4, Math.random() < 0.5 ? -1 : 1);
    }
  }

  private nearestDigger(e: Ant, worms: WormInfo[]) {
    let best: WormInfo | null = null;
    let bd = Infinity;
    for (const w of worms) {
      if (w.mode !== 'dig') continue;
      const d = w.disp[N >> 1].distanceTo(e.p);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** Distance from p to the segment a–b. */
  private segDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
    const ab = this.tmpS.subVectors(b, a);
    const t = Math.max(0, Math.min(1, this.tmpS2.subVectors(p, a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
    return this.tmpS2.copy(a).addScaledVector(ab, t).distanceTo(p);
  }

  /** For testing: the earwig grabs `player` (balls `disp`) at once. */
  debugGrab(player: string, disp: THREE.Vector3[]) {
    const e = this.ants.find((a) => a.kind === EARWIG && a.state === WANDER);
    if (!e) return false;
    const mid = disp[N >> 1];
    e.p.copy(mid).addScaledVector(e.n.copy(mid).normalize(), 0).add(new THREE.Vector3(0.9, 0, 0.9));
    appleProject(e.p);
    appleNormal(e.p, e.n);
    e.age = 99;
    e.biteCool = 0;
    e.holding = player;
    e.target = player;
    e.holdT = 0;
    e.holdAt = mid.clone();
    e.holdSide = this.angleRound(e, e.holdAt) > 0 ? 1 : -1;
    this.onEarwig?.(player, 0, 'grab');
    return true;
  }

  /** An action of the earwig's (see earwigStep) for `len` s; side: which way it turns into it. */
  private earwigAct(e: Ant, act: number, len: number, side = 1) {
    e.act = act;
    e.actT = len;
    e.actLen = len;
    e.actSide = side;
  }

  /** Grabs critter c in its pincers (held for `hold` s; a ladybug tugs free). */
  private grab(e: Ant, c: Ant, hold: number) {
    c.state = CARRIED;
    c.heldBy = e.id;
    c.heldT = hold;
    c.target = '';
    c.ang = 0;
    this.earwigAct(e, 4, 0.5);
  }

  /** What it holds rides over its back in the pincers. A spider is let go after a while; a ladybug tugs free. */
  private holdInPincers(e: Ant, c: Ant, dt: number) {
    const len = SPECS[EARWIG].len;
    c.p.copy(e.p).addScaledVector(e.f, -len * 0.6);
    appleProject(c.p);
    appleNormal(c.p, c.n);
    c.f.copy(e.f).negate();
    if (c.kind === SPIDER) {
      c.heldT = (c.heldT ?? 0) - dt;
      if (!e.act) this.earwigAct(e, 4, 0.5);
      if ((c.heldT ?? 0) <= 0) {
        c.state = FLEE;
        c.heldBy = undefined;
        c.fleeFrom = e.p.clone();
        c.cool = 6;
        c.startle = 0;
      }
      return;
    }
    // a ladybug: tugs (a jerk every 1.3 s), the earwig tugs back; three and it's free (flies off)
    c.heldT = (c.heldT ?? 0) + dt;
    const t = c.heldT % 1.3;
    c.ang = t < 0.75 ? Math.sin((t / 0.75) * Math.PI) : 0;
    this.earwigAct(e, 3, 0.2);
    e.ang = c.ang;
    if (t < dt && c.heldT > 1) c.tugs = (c.tugs ?? 0) + 1;
    if ((c.tugs ?? 0) >= 3) {
      c.heldBy = undefined;
      c.state = SLAPPED;
      c.target = '';
      c.seg = 0;
      c.ang = 0;
      c.qEnd = this.clock + 1.8;
      e.act = 0;
    }
  }

  /** The earwig flies off: drops what it holds, the ants round it run. */
  private earwigLeave(e: Ant) {
    if (e.holding) this.onEarwig?.(e.holding, 0, 'drop');
    e.holding = undefined;
    e.state = SLAPPED;
    e.qEnd = this.clock + 1.6;
    e.act = 0;
    e.seg = 0;
    e.ang = 0;
    for (const a of this.ants) {
      if (a.state === QUARREL && a.qWith === e.id) {
        a.state = FLEE;
        a.qWith = undefined;
        a.fleeFrom = e.p.clone();
        a.cool = SPECS[ANT].cooldown;
      }
      if (a.state === CARRIED && a.heldBy === e.id) {
        a.heldBy = undefined;
        a.state = a.kind === LADYBUG ? SLAPPED : FLEE;
        a.qEnd = this.clock + 1.8;
        a.fleeFrom = e.p.clone();
        a.cool = 6;
      }
    }
  }

  /**
   * Dives in and drills at `at` (a worm gnawing inside): roughly — it aims beside the worm by a random
   * miss (about a worm's length or so) and homes in only a little; whoever it touches loses 50.
   */
  private startDrill(e: Ant, at: THREE.Vector3) {
    for (const a of this.ants) {
      if ((a.state === QUARREL && a.qWith === e.id) || (a.state === CARRIED && a.heldBy === e.id)) {
        a.state = a.kind === LADYBUG ? SLAPPED : FLEE;
        a.qWith = undefined;
        a.heldBy = undefined;
        a.qEnd = this.clock + 1.8;
        a.fleeFrom = e.p.clone();
        a.cool = 6;
      }
    }
    const to = this.tmp.subVectors(at, e.p);
    if (to.lengthSq() < 1e-6) to.copy(e.f);
    to.normalize();
    const bias = this.tmp2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    bias.addScaledVector(to, -bias.dot(to));
    if (bias.lengthSq() < 1e-6) bias.crossVectors(to, this.tmp3.set(0, 1, 0));
    bias.normalize();
    // the miss: a Rayleigh-distributed distance (a 2D gaussian's radius), σ = 1.15
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const g = Math.sqrt(-2 * Math.log(u));
    const miss = 1.15 * Math.hypot(g * Math.cos(2 * Math.PI * v), g * Math.sin(2 * Math.PI * v));
    const d = this.tmp3.copy(at).addScaledVector(bias, miss).sub(e.p).normalize();
    e.state = DRILL;
    e.act = 0;
    e.drill = { d: d.clone(), base: d.clone(), bias: bias.clone(), miss, lean: 0, dug: 0, inner: false, hit: new Set(), lastPt: e.p.clone() };
    const r = SPECS[EARWIG].len * 0.13;
    this.onDrill?.start(e.id, r);
    this.onDrill?.hole([e.p.x, e.p.y, e.p.z, e.n.x, e.n.y, e.n.z, r].map(r3));
  }

  /** The drill's heading: turns a little towards the nearest gnawing worm ahead (missing it by its miss), and wobbles, within 15° of where it set off. */
  private guideDrill(e: Ant, worms: WormInfo[], dt: number) {
    const dr = e.drill!;
    let goal: THREE.Vector3 | undefined;
    let bd = Infinity;
    for (const w of worms) {
      if (w.mode !== 'dig') continue;
      const m = w.disp[N >> 1];
      const d = this.tmp.subVectors(m, e.p).length();
      if (d < 0.4 || d >= bd || this.tmp.dot(dr.base) < 0.35 * d) continue; // behind it doesn't count
      bd = d;
      goal = m;
    }
    if (goal) {
      const off = this.tmp2.copy(dr.bias).addScaledVector(dr.base, -dr.bias.dot(dr.base));
      if (off.lengthSq() > 1e-6) off.normalize();
      const want = this.tmp.subVectors(goal, e.p).addScaledVector(off, dr.miss);
      if (want.lengthSq() > 1e-6) {
        want.normalize();
        const axis = this.tmp3.crossVectors(dr.d, want);
        const ang = Math.asin(Math.min(1, axis.length()));
        if (ang > 1e-4) dr.d.applyAxisAngle(axis.normalize(), Math.min(ang, 0.16 * dt));
      }
    }
    const lean = dr.lean;
    dr.lean += ((Math.random() - 0.5) * 1.6 - 0.5 * dr.lean) * dt;
    dr.lean = THREE.MathUtils.clamp(dr.lean, -0.16, 0.16);
    const axis = this.tmp3.crossVectors(dr.base, dr.bias);
    if (axis.lengthSq() > 1e-8) dr.d.applyAxisAngle(axis.normalize(), dr.lean - lean);
    if (dr.d.dot(dr.base) < Math.cos(0.26)) {
      const ax = this.tmp3.crossVectors(dr.base, dr.d);
      if (ax.lengthSq() > 1e-8) dr.d.copy(dr.base).applyAxisAngle(ax.normalize(), 0.26);
      else dr.d.copy(dr.base);
    }
    dr.d.normalize();
  }

  /** Drilling: on through the flesh (round a pit), leaving a passage; out through the skin on the far side. */
  private drillStep(e: Ant, dt: number, worms: WormInfo[]) {
    const dr = e.drill!;
    const r = SPECS[EARWIG].len * 0.13;
    this.guideDrill(e, worms, dt);
    const was = this.tmp.copy(e.p);
    e.p.addScaledVector(dr.d, 5.5 * dt);
    if (pushOutOfPit(e.p, r)) {
      // slid round the pit: that's its way now
      const moved = this.tmp2.subVectors(e.p, was);
      if (moved.lengthSq() > 1e-8) dr.d.copy(moved).normalize();
      else dr.d.applyAxisAngle(this.tmp2.set(0, 1, 0).cross(dr.d).normalize(), 0.5);
      dr.base.copy(dr.d);
    }
    dr.dug += e.p.distanceTo(was);
    e.f.copy(dr.d);
    if (!dr.inner && appleF(e.p) < -r * 0.5) dr.inner = true;
    if (dr.inner && e.p.distanceTo(dr.lastPt) >= 0.03) {
      dr.lastPt.copy(e.p);
      this.onDrill?.point(e.id, e.p);
    }
    for (const w of worms) {
      if (dr.hit.has(w.id) || w.mode === 'fly') continue;
      if (w.disp.some((b, i) => b.distanceTo(e.p) < r + RADII[i] * girth(w.g ?? 1))) {
        dr.hit.add(w.id);
        this.onEarwig?.(w.id, 50, 'drill');
      }
    }
    if ((dr.inner && appleF(e.p) > 0) || dr.dug > 40) {
      // out
      appleProject(e.p);
      appleNormal(e.p, e.n);
      this.onDrill?.hole([e.p.x, e.p.y, e.p.z, e.n.x, e.n.y, e.n.z, r].map(r3));
      this.onDrill?.end(e.id);
      e.f.copy(dr.d).addScaledVector(e.n, -dr.d.dot(e.n)).normalize();
      if (e.f.lengthSq() < 0.5) e.f.set(1, 0, 0).addScaledVector(e.n, -e.n.x).normalize();
      e.drill = undefined;
      e.state = WANDER;
      e.drillCool = (3 + Math.random() * 2) / Math.max(0.75, this.rules.earwigDrill);
    }
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
