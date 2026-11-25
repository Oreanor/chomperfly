import * as THREE from 'three';
import { appleF } from '@/lib/apple';
import { connectNet, type Net, type NetMsg } from '@/lib/net';
import { WormSim, type SimInput } from './WormSim';
import { slotDir } from './spawn';
import { BIG_AT, WIN_GROWTH, WIN_SIZE_GAIN, antsDrag, r3, winProgress } from './constants';
import { LEVEL, type LevelName } from './levels';
import { HOLD, KNOCKED, LADYBUG, ANT, SLAPPED } from './Ants';

// bot names in the language of the player who adds them (everyone sees that name)
const BOT_NAMES: Record<string, string[]> = {
  ru: ['Бот Кузя', 'Бот Жора', 'Бот Нюша', 'Бот Шустрик', 'Бот Гусь', 'Бот Пончик', 'Бот Бублик'],
  en: ['Bot Bob', 'Bot Pip', 'Bot Nugget', 'Bot Zippy', 'Bot Goose', 'Bot Donut', 'Bot Bagel'],
  pt: ['Bot Tó', 'Bot Zeca', 'Bot Pipoca', 'Bot Faísca', 'Bot Ganso', 'Bot Bolacha', 'Bot Pastel'],
};
const uiLang = () => {
  const l = typeof document !== 'undefined' ? document.documentElement.lang : '';
  return l === 'ru' || l === 'pt' ? l : 'en';
};

/** How a bot plays, by the room's level. */
type BotRules = {
  bold: [number, number]; // how keen it is to hunt (its own, random in this range)
  prey: number; // goes for a worm on the skin this close
  preyInside: number; // …and for one gnawing inside (0: never)
  huntInside: number; // s it keeps hunting inside before a rest
  lashGap: [number, number]; // s between lashes at a worm biting its tail
  aim: number; // how well it steers at prey (1: straight at it)
  dropEvery: [number, number] | null; // s between trips to a water drop
  seedDodge: number; // chance it steers round a bitter seed ahead
  swat: number; // how often it swats critters nearby (per second)
  swatGap: number; // s between swats at least
  gnaw: [number, number]; // s it gnaws before coming out
};
const BOT_RULES: Record<LevelName, BotRules> = {
  easy: { bold: [0.1, 0.35], prey: 4, preyInside: 0, huntInside: 0, lashGap: [3.5, 6], aim: 0.6, dropEvery: null, seedDodge: 0.25, swat: 0, swatGap: 99, gnaw: [7, 14] },
  medium: { bold: [0.45, 0.75], prey: 6, preyInside: 2.4, huntInside: 5, lashGap: [2, 4], aim: 0.85, dropEvery: [28, 50], seedDodge: 0.7, swat: 1.2, swatGap: 2.5, gnaw: [9, 18] },
  hard: { bold: [0.85, 1], prey: 8, preyInside: 4, huntInside: 9, lashGap: [1.2, 2.2], aim: 1, dropEvery: [16, 28], seedDodge: 1, swat: 5, swatGap: 1.2, gnaw: [11, 20] },
};
const randIn = ([a, b]: [number, number]) => a + Math.random() * (b - a);

type BotState = 'crawl' | 'dig' | 'exit';

/**
 * A computer-controlled worm. It joins the room over its own connection, so for everyone
 * (including the player who added it) it is just another worm. It lives in the host's tab.
 * How it plays depends on the room's level: it hunts other worms (on the skin, and inside on harder
 * levels), lashes at worms biting its tail, swats critters, makes trips to water drops, dodges bitter seeds.
 */
export class Bot {
  readonly name: string;
  private net: Net;
  private sim: WormSim;
  private id = '';
  private tunnel = '';
  private tunnelR = 0.15;
  private counter = 0;
  private pending: number[] = [];
  private state: BotState = 'crawl';
  private huntT = 0;
  private huntRest = 0;
  private dropAt = Infinity; // s to the next trip to a water drop
  private dropTrip = 0; // s left of the trip
  private antsOnHead = 0;
  private earwigShakes = 0; // in the earwig's pincers: jerks left to get free
  private shieldUntil = 0; // ate a seed: untouchable till then
  private critters: { p: THREE.Vector3; kind: number }[] = [];
  private swatAt = -10;
  private dodgeRoll = { at: -1, ok: false };
  private stateLeft = 4 + Math.random() * 6;
  private rearLeft = 0;
  private t = Math.random() * 100;
  private others = new Map<string, { p: number[]; mode: string; at: number }>(); // the other worms, as last sent
  private lashAt = 0;
  private slamsDoneAt = 0;
  private drops = new Map<number, number[]>(); // water drops: id → direction
  private dropAskedAt = 0;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private lashGap = 3;
  private seed = Math.random() * 10;
  private sendT = 0;
  private flushT = 0;
  private readonly radial = new THREE.Vector3();
  private frozenUntil = 0; // bitten: can't move for a while
  private seedCharges: { until: number; add: number }[] = []; // speed boosts (water drops) still in effect
  private amokUntil = 0; // stung by a spider / bitten by an ant or the earwig: runs wild
  private amokMul = 2;
  private seedPending = -1;
  private seedAskedAt = -10;
  private antsOn = 0; // ants riding this bot
  private grip: 'head' | 'tail' | null = null; // a ladybug holds this end
  private shookAt = 0;
  private winClaimedAt = -10;
  closed = false;
  private waitRound = false; // after a win: still, until the player starts the next round
  private outTold = false;
  /** Does the bot touch a spider thread? (the host's view of the webs) */
  webTouch?: (disp: THREE.Vector3[], size: number) => boolean;
  private webShakes = 0;
  private webFreeUntil = 0;
  private readonly dropPoint = new THREE.Vector3();
  private readonly preyPoint = new THREE.Vector3();
  private readonly preyAt = new THREE.Vector3();
  private rules: BotRules;
  private bold: number;
  /** Called when the bot's strike lands (the host shows the comic burst). */
  onImpact?: (at: THREE.Vector3, size: number, kind?: string) => void;

  get playerId() {
    return this.id;
  }

  get tunnelId() {
    return this.tunnel;
  }

  /** How hollow it is ahead (the host's passages). */
  set hollow(fn: WormSim['hollow']) {
    this.sim.hollow = fn;
  }

  /** The player who runs this bot started the next round (OK after a win): go, from 0. */
  newRound(dir: THREE.Vector3) {
    this.waitRound = false;
    this.outTold = false;
    this.sim.restart(dir);
    this.state = 'crawl';
    this.stateLeft = 4 + Math.random() * 6;
  }

  /** The room's goal in points. */
  setWinPoints(n: number) {
    this.sim.growthRate = (WIN_SIZE_GAIN * 100) / n;
  }

  /** The arena: this much life. */
  setArena(life: number) {
    this.sim.setArena(life);
  }

  constructor(
    room: string,
    taken: Set<string>,
    private seedAt: (p: THREE.Vector3, reach: number) => number, // seeds of the fruit, shared with the host
    freeSpot: () => THREE.Vector3, // where nobody is (the host's view)
    onGone: (reason: 'full' | 'closed') => void,
    private level: LevelName = 'easy',
  ) {
    this.rules = BOT_RULES[level];
    this.bold = randIn(this.rules.bold);
    this.lashGap = randIn(this.rules.lashGap);
    if (this.rules.dropEvery) this.dropAt = randIn(this.rules.dropEvery);
    const names = BOT_NAMES[uiLang()];
    this.name = names.find((n) => !taken.has(n)) ?? `${names[0].split(' ')[0]} ${Math.floor(Math.random() * 90 + 10)}`;
    this.sim = new WormSim({
      impact: (p, kind) => {
        this.onImpact?.(p, this.sim.L, kind);
        if (kind === 'slam') this.net.send({ t: 'slam', at: [r3(p.x), r3(p.y), r3(p.z)], r: r3(0.9 * this.sim.L) });
      },
      tunnelStart: (r) => {
        if (!this.id) return;
        this.tunnel = `${this.id}-${++this.counter}`;
        this.tunnelR = r3(r);
        this.net.send({ t: 'ts', id: this.tunnel, r: r3(r) });
      },
      tunnelPoint: (p) => this.pending.push(r3(p.x), r3(p.y), r3(p.z)),
      tunnelEnd: () => {
        this.flush();
        this.tunnel = '';
      },
      hole: (h) => this.net.send({ t: 'h', h }),
      down: () => {
        if (this.outTold) return;
        this.outTold = true;
        this.net.send({ t: 'out' });
      },
    });
    this.sim.lossK = LEVEL[level].loss;
    this.net = connectNet(
      room,
      this.name,
      (m: NetMsg) => {
        if (m.t === 's' && m.id !== this.id && Array.isArray(m.p) && m.p.length === 30) this.others.set(m.id, { p: m.p, mode: m.m, at: this.t });
        if (m.t === 'leave') this.others.delete(m.id);
        if (m.t === 'welcome' && Array.isArray(m.drops)) this.drops = new Map(m.drops.map((d: { id: number; d: number[] }) => [d.id, d.d]));
        if (m.t === 'dropAdd' && m.drop) this.drops.set(m.drop.id, m.drop.d);
        if (m.t === 'drop') {
          this.drops.delete(m.id);
          if (m.by === this.id) {
            this.dropTrip = 0;
            if (this.sim.arena) this.sim.drink();
            else this.seedCharges.push({ until: performance.now() + 10000, add: 1 });
          }
        }
        if (m.t === 'welcome') {
          this.id = m.id;
          this.sim.spawn(freeSpot()); // join in a free place
        }
        if (m.t === 'full') {
          this.close();
          onGone('full');
        }
        if (m.t === 'reset') {
          this.outTold = false;
          const order: string[] = Array.isArray(m.order) ? m.order : [];
          const i = order.indexOf(this.id);
          this.sim.restart(i >= 0 ? slotDir(i, order.length, Number(m.rot) || 0) : freeSpot());
          this.frozenUntil = performance.now() + 3000; // waits for the countdown like everyone
          this.waitRound = false;
          this.seedCharges = [];
          this.seedPending = -1;
          this.webShakes = 0;
          this.webFreeUntil = 0;
          this.amokUntil = 0;
          this.state = 'crawl';
          this.stateLeft = 4 + Math.random() * 6;
        }
        if (m.t === 'ants') {
          const all = m.a as unknown[][];
          this.critters = all.filter((s) => s[1] !== HOLD && s[1] !== SLAPPED && s[1] !== KNOCKED && !s[12]).map((s) => ({ p: new THREE.Vector3(s[2] as number, s[3] as number, s[4] as number), kind: s[11] as number }));
          const mine = all.filter((s) => s[1] === HOLD && s[8] === this.id);
          this.antsOn = mine.filter((s) => s[11] !== LADYBUG).length;
          this.antsOnHead = mine.filter((s) => s[11] === ANT && (s[9] as number) >= 7).length;
          const bug = mine.find((s) => s[11] === LADYBUG);
          const had = this.grip;
          this.grip = bug ? (bug[9] === 0 ? 'tail' : 'head') : null;
          if (this.grip && !had) this.sim.addPoints(-10); // a ladybug grabbed it
        }
        if (m.t === 'seed') {
          if (m.i === this.seedPending) this.seedPending = -1;
          if (m.by === this.id) this.shieldUntil = performance.now() + 10000;
        }
        if (m.t === 'bite' && m.id === this.id) {
          this.frozenUntil = performance.now() + (m.duration || 5000);
          if (this.sim.arena && m.by === 'chafer') {
            if (performance.now() >= this.shieldUntil) this.sim.slay();
          } else if (m.by !== 'spider' && m.by !== 'pit' && m.by !== 'chafer') this.sim.addPoints(-10);
        }
        if (m.t === 'earwig' && m.id === this.id && m.how === 'drop') {
          this.earwigShakes = 0;
          this.sim.held = false;
        } else if (m.t === 'earwig' && m.id === this.id) {
          this.sim.addPoints(-(Number(m.pts) || 0));
          if (m.how === 'bite') {
            this.amokUntil = performance.now() + 5000;
            this.amokMul = 1.5;
          }
          if (m.how === 'grab') {
            this.earwigShakes = 5;
            this.sim.held = true;
          }
        }
        if (m.t === 'antbite' && m.id === this.id) {
          this.sim.addPoints(-5);
          this.amokUntil = performance.now() + (m.duration || 3000);
          this.amokMul = 1.5;
          this.webShakes = 0;
          this.webFreeUntil = this.amokUntil + 1000;
        }
        if (m.t === 'sting' && m.id === this.id) {
          this.sim.loseGrowth((25 * this.sim.growthRate) / 100);
          this.amokUntil = performance.now() + (m.duration || 5000);
          this.amokMul = 2;
          this.webShakes = 0;
          this.webFreeUntil = this.amokUntil + 1500;
        }
        if (m.t === 'wipe') {
          this.waitRound = true;
          this.webShakes = 0;
          this.webFreeUntil = 0;
          this.amokUntil = 0;
          this.antsOn = 0;
          this.grip = null;
          this.seedCharges = [];
          this.seedPending = -1;
        }
        // someone won: a new round, everyone back to 0 points (the winner after its flight)
        if (m.t === 'win') {
          this.waitRound = true; // the round is over: wait for the player to start the next one
          // no critters, webs or venom any more
          this.webShakes = 0;
          this.webFreeUntil = 0;
          this.amokUntil = 0;
          this.antsOn = 0;
          this.grip = null;
          this.seedCharges = [];
          this.seedPending = -1;
          if (m.id === this.id) this.sim.startVictory();
          else {
            // a fresh fruit: back on the skin (its passages are gone), 0 points
            this.sim.restart(freeSpot());
            this.state = 'crawl';
            this.stateLeft = 4 + Math.random() * 6;
          }
        }
      },
      () => {},
      true,
    );
  }

  /** Development helper: set the bot's points. */
  setPoints(n: number) {
    this.sim.growth = 1 + n / 100;
  }

  /** The bot's player id on the server ('' until it has joined). */
  get serverId() {
    return this.id;
  }

  update(dt: number) {
    if (this.closed) return;
    this.t += dt;
    if (!this.sim.arena && this.sim.growth >= WIN_GROWTH && this.sim.mode !== 'fly' && this.t - this.winClaimedAt > 2) {
      this.winClaimedAt = this.t;
      this.net.send({ t: 'win', g: r3(this.sim.growth) });
    }
    const inp = this.think(dt);
    inp.speed = this.seedFactor();
    if (performance.now() < this.amokUntil && this.sim.mode !== 'fly') {
      inp.forward = true;
      inp.speed = (inp.speed ?? 1) * this.amokMul;
      inp.rear = false;
    }
    const still = performance.now() < this.frozenUntil || this.waitRound || this.sim.down;
    if (still) {
      inp.forward = false;
      inp.turn = 0;
      inp.pitch = 0;
    }
    // a spider thread: stuck, five jerks to get free
    if (!this.webShakes && this.sim.mode === 'surface' && !this.sim.airborne && performance.now() > this.webFreeUntil && performance.now() > this.amokUntil) {
      if (this.webTouch?.(this.sim.disp, this.sim.growth)) this.webShakes = 5;
    }
    if (this.webShakes) {
      inp.forward = false;
      inp.turn = 0;
      // slower than a human clicking (the spider gets a chance); not at all while stunned
      if (!still && this.t - this.shookAt > 0.8) {
        this.shookAt = this.t;
        this.sim.shake();
        if (--this.webShakes === 0) this.webFreeUntil = performance.now() + 2500;
      }
    }
    if (this.antsOn && this.sim.mode === 'dig') {
      // ants hold it in a passage: slower, dragged back, shrinking and stretching to get free
      inp.speed = (inp.speed ?? 1) * antsDrag(this.antsOn);
      this.sim.pullBack(0.12 * this.antsOn * dt);
      if (!still && this.t - this.shookAt > 0.35) {
        this.shookAt = this.t;
        this.sim.squeeze();
        this.net.send({ t: 'shake' });
      }
    }
    if ((this.antsOn || this.grip) && this.sim.mode === 'surface') {
      // caught: ants slow it down, a ladybug holds it still; it keeps lashing / jerking to get free
      // (a big one slams the ladybug against the skin)
      inp.speed = (inp.speed ?? 1) * antsDrag(this.antsOn);
      if (this.grip) {
        inp.forward = false;
        inp.turn = 0;
      }
      if (!still && this.t - this.shookAt > (this.grip ? 0.7 : 0.4)) {
        this.shookAt = this.t;
        if (this.grip && winProgress(this.sim.growth) >= BIG_AT) {
          if (this.sim.slam(this.grip)) this.slamsDoneAt = this.t + 0.446; // tell the host when it hits
        } else if (this.grip ? this.sim.whip(this.grip === 'head' ? 'tail' : 'head', this.grip === 'head') : (this.sim.shake(), true)) this.net.send({ t: 'shake' });
      }
    }
    if (!still && !this.webShakes && !this.grip && !this.antsOn && this.sim.mode === 'surface') this.shoo(dt);
    if (this.earwigShakes > 0 && this.sim.mode !== 'surface') {
      this.earwigShakes = 0;
      this.sim.held = false;
      this.net.send({ t: 'free' });
    }
    if (this.earwigShakes > 0) {
      // in the earwig's pincers: wriggles free (five jerks)
      inp.forward = false;
      inp.turn = 0;
      if (!still && this.t - this.shookAt > 0.6) {
        this.shookAt = this.t;
        this.sim.shake();
        if (--this.earwigShakes === 0) {
          this.sim.held = false;
          this.net.send({ t: 'free' });
        }
      }
    }
    if (this.slamsDoneAt && this.t >= this.slamsDoneAt) {
      this.slamsDoneAt = 0;
      if (this.grip) this.net.send({ t: 'shake' });
    }
    this.sim.update(dt, inp);
    // a water drop right under its head: drink it
    if (this.sim.mode === 'surface' && this.t - this.dropAskedAt > 0.5) {
      const h = this.tmpV.copy(this.sim.head).normalize();
      for (const [id, d] of this.drops) {
        if (h.x * d[0] + h.y * d[1] + h.z * d[2] > 0.9985) {
          this.dropAskedAt = this.t;
          this.net.send({ t: 'drop', id });
          break;
        }
      }
    }
    if (this.seedPending >= 0 && this.t - this.seedAskedAt > 0.5) this.seedPending = -1;
    if (this.sim.mode === 'dig' && (!this.sim.rocketing || this.sim.through)) {
      const i = this.seedAt(this.sim.head, 0.6 * this.sim.L);
      if (i >= 0 && i !== this.seedPending) {
        this.seedPending = i;
        this.seedAskedAt = this.t;
        this.net.send({ t: 'seed', i });
      }
    }
    this.sendT += dt;
    if (this.sendT > (this.sim.mode === 'fly' ? 0.033 : 0.066)) {
      this.sendT = 0;
      const p: number[] = [];
      for (const v of this.sim.disp) p.push(r3(v.x), r3(v.y), r3(v.z));
      const now = performance.now();
      this.net.send({
        t: 's',
        p,
        m: this.sim.mode,
        g: r3(this.sim.growth),
        w: r3(this.sim.wave),
        fx: r3(this.sim.fx),
        k: this.webShakes ? 1 : 0,
        sp: r3(this.seedFactor()),
        rr: +(this.sim.rear > 0.5),
        iv: now < this.shieldUntil ? (this.shieldUntil - now < 2000 ? 2 : 1) : 0,
        ...(this.sim.arena ? { hp: Math.round(this.sim.life) } : {}),
      });
    }
    this.flushT += dt;
    if (this.flushT > 0.25) {
      this.flushT = 0;
      this.flush();
    }
  }

  /**
   * The brain: crawl around (sometimes standing up to look), hunt a worm nearby (lashing at one biting
   * its tail), go for a water drop now and then, burrow in, gnaw a while (hunting worms inside on
   * harder levels, dodging bitter seeds), come back out. In the arena: strikes down through the fruit.
   */
  private think(dt: number): SimInput {
    const sim = this.sim;
    const wander = (Math.sin(this.t * 0.7 + this.seed) * 0.7 + Math.sin(this.t * 1.9 + this.seed * 2) * 0.35) * dt;
    this.stateLeft -= dt;
    const inp: SimInput = { turn: wander, pitch: 0, forward: true, rear: false };
    if (performance.now() < this.frozenUntil || this.waitRound) return inp;
    if (sim.arena && (sim.mode === 'dig' || sim.airborne || sim.rocketing)) {
      inp.turn = 0;
      inp.pitch = 0;
      return inp;
    }
    if (this.state === 'crawl') {
      const prey = this.stateLeft > -5 ? this.preyNearby() : null;
      if (prey && !this.antsOn && !this.grip) {
        this.rearLeft = 0;
        this.radial.copy(sim.head).normalize();
        const to = this.tmpV.copy(prey.mid).sub(sim.head);
        to.addScaledVector(this.radial, -to.dot(this.radial));
        inp.turn = Math.max(-1, Math.min(1, 2.5 * Math.atan2(this.tmpV2.crossVectors(this.radial, sim.f).dot(to), to.dot(sim.f)) * this.rules.aim)) * dt + wander * (1 - this.rules.aim);
        if (prey.byTail && this.t - this.lashAt > this.lashGap) {
          this.lashAt = this.t;
          this.lashGap = randIn(this.rules.lashGap);
          sim.swipe();
          this.net.send({ t: 'lash', id: prey.id });
        }
        return inp;
      }
      if (this.dropTrip > 0) {
        this.dropTrip -= dt;
        const drop = this.nearestDrop();
        if (drop) {
          this.steerOnSkin(drop, inp, dt);
          this.stateLeft = Math.max(this.stateLeft, 1);
          return inp;
        }
        this.dropTrip = 0;
      }
      if (this.rearLeft > 0) {
        this.rearLeft -= dt;
        inp.rear = true;
        inp.forward = false;
      } else if (Math.random() < dt * 0.02) this.rearLeft = 1.2 + Math.random();
      if (sim.arena && this.rules.dropEvery && this.dropTrip <= 0) {
        this.dropAt -= dt;
        if (this.dropAt <= 0 && this.drops.size) {
          this.dropAt = randIn(this.rules.dropEvery);
          this.dropTrip = 14;
        }
      }
      if (this.stateLeft <= 0 && this.rearLeft <= 0 && this.dropTrip <= 0 && !this.antsOnHead && !this.grip && !this.webShakes && !this.earwigShakes) {
        if (sim.arena) {
          if (sim.arenaStrike()) this.state = 'dig';
        } else {
          sim.startDig();
          this.state = 'dig';
          this.stateLeft = randIn(this.rules.gnaw);
        }
      }
      return inp;
    }
    if (sim.mode === 'surface') {
      this.state = 'crawl';
      this.stateLeft = 2 + Math.random() * 3;
      return inp;
    }
    // inside: time for a water drop? head out
    this.dropAt -= dt;
    if (this.dropAt <= 0 && this.state === 'dig' && this.drops.size && this.rules.dropEvery) {
      this.dropAt = randIn(this.rules.dropEvery);
      this.dropTrip = 14;
      this.state = 'exit';
    }
    this.huntRest = Math.max(0, this.huntRest - dt);
    const prey = this.state === 'exit' || this.huntRest ? null : this.preyInside();
    if (prey) {
      this.huntT += dt;
      if (this.huntT > this.rules.huntInside * (0.6 + 0.4 * this.bold)) {
        this.huntT = 0;
        this.huntRest = 6 + Math.random() * 6;
      }
      this.steerInside(prey, inp, dt);
      return inp;
    }
    this.huntT = 0;
    // keep a comfortable depth, then head back out
    const depth = -appleF(sim.p);
    this.radial.copy(sim.p).normalize();
    const outward = sim.d.dot(this.radial); // +1 = heading out of the fruit
    const wantOut = this.state === 'exit' ? (this.dropTrip > 0 ? 0.95 : 0.75) : depth < 0.6 ? -0.35 : 0.3 * +(depth > 2.5);
    inp.pitch = Math.max(-1, Math.min(1, (wantOut - outward) * 2)) * (Math.sign(sim.u.dot(this.radial)) || 1) * dt;
    // a bitter seed just ahead: turn aside (if it notices)
    const ahead = this.tmpV.copy(sim.p).addScaledVector(sim.d, 0.9 * sim.L);
    if (this.t - this.dodgeRoll.at > 1) this.dodgeRoll = { at: this.t, ok: Math.random() < this.rules.seedDodge };
    if (this.dodgeRoll.ok && this.seedAt(ahead, 0.45 * sim.L) >= 0) inp.turn = 1.6 * dt;
    if (this.state === 'dig' && this.stateLeft <= 0) this.state = 'exit';
    return inp;
  }

  /** A critter close by: a bite at it (right in front of the head) or a swipe of the tail. */
  private shoo(dt: number) {
    if (!this.rules.swat || this.t - this.swatAt < this.rules.swatGap) return;
    const sim = this.sim;
    let near: THREE.Vector3 | null = null;
    let nd = 1.3 * sim.L;
    for (const c of this.critters) {
      for (let k = 0; k < 10; k += 3) {
        const d = c.p.distanceTo(sim.disp[k]);
        if (d < nd) {
          nd = d;
          near = c.p;
        }
      }
    }
    if (!near || Math.random() > this.rules.swat * dt) return;
    this.swatAt = this.t;
    const to = this.tmpV.subVectors(near, sim.head);
    if (to.length() < 1.1 * sim.L && to.normalize().dot(sim.f) > 0.55) sim.lunge(near);
    else sim.swipe();
    this.net.send({ t: 'swat' });
  }

  /** Inside: turn and pitch towards `to` (not out through the skin while shallow). */
  private steerInside(to: THREE.Vector3, inp: SimInput, dt: number) {
    const sim = this.sim;
    const d = this.tmpV.subVectors(to, sim.p);
    const right = this.tmpV2.crossVectors(sim.d, sim.u);
    const fwd = d.dot(sim.d);
    inp.turn = Math.max(-1.6, Math.min(1.6, -3 * Math.atan2(d.dot(right), fwd))) * dt;
    inp.pitch = Math.max(-1.6, Math.min(1.6, 3 * Math.atan2(d.dot(sim.u), fwd))) * dt;
    if (-appleF(sim.p) < 0.5 && sim.d.dot(this.radial.copy(sim.p).normalize()) > 0) inp.pitch = -Math.abs(inp.pitch) * (Math.sign(sim.u.dot(this.radial)) || 1);
  }

  /** On the skin: turn towards `to`. */
  private steerOnSkin(to: THREE.Vector3, inp: SimInput, dt: number) {
    const sim = this.sim;
    this.radial.copy(sim.head).normalize();
    const d = this.tmpV.copy(to).sub(sim.head);
    d.addScaledVector(this.radial, -d.dot(this.radial));
    inp.turn = Math.max(-1.4, Math.min(1.4, 2.5 * Math.atan2(this.tmpV2.crossVectors(this.radial, sim.f).dot(d), d.dot(sim.f)))) * dt;
    inp.forward = true;
  }

  /** The water drop nearest its head (on the skin), or null. */
  private nearestDrop() {
    const h = this.tmpV.copy(this.sim.head).normalize();
    let best: number[] | null = null;
    let bd = -2;
    for (const d of this.drops.values()) {
      const c = h.x * d[0] + h.y * d[1] + h.z * d[2];
      if (c > bd) {
        bd = c;
        best = d;
      }
    }
    return best ? this.dropPoint.set(best[0], best[1], best[2]).multiplyScalar(this.sim.head.length()) : null;
  }

  /** A worm gnawing inside close by (its middle), to hunt. */
  private preyInside() {
    let best: THREE.Vector3 | null = null;
    if (!this.rules.preyInside) return null;
    let bd = this.rules.preyInside * (0.7 + 0.3 * this.bold);
    for (const o of this.others.values()) {
      if (o.mode !== 'dig' || this.t - o.at > 1) continue;
      const mid = this.preyPoint.set(o.p[15], o.p[16], o.p[17]);
      const d = mid.distanceTo(this.sim.p);
      if (d < bd) {
        bd = d;
        best = this.preyAt.copy(mid);
      }
    }
    return best;
  }

  /** A worm on the skin close by (its middle), and whether it's at this bot's tail end. */
  private preyNearby() {
    if (this.sim.mode !== 'surface') return null;
    let best: { id: string; mid: THREE.Vector3; byTail: boolean } | null = null;
    let bd = this.rules.prey;
    const close = 1.2 * this.sim.L;
    for (const [id, o] of this.others) {
      if (o.mode !== 'surface' || this.t - o.at > 1) continue;
      const mid = new THREE.Vector3(o.p[15], o.p[16], o.p[17]);
      const d = mid.distanceTo(this.sim.head);
      if (d > bd) continue;
      let byTail = false;
      for (let k = 0; k < 5 && !byTail; k++) {
        for (let j = 0; j < 10; j++) {
          if (this.sim.disp[k].distanceTo(this.tmpV.set(o.p[j * 3], o.p[j * 3 + 1], o.p[j * 3 + 2])) < close) {
            byTail = true;
            break;
          }
        }
      }
      bd = d;
      best = { id, mid, byTail };
    }
    return best;
  }

  /** 1× plus every boost still in effect (a water drop: +1 for 10 s); they stack. */
  private seedFactor() {
    const now = performance.now();
    if (this.seedCharges.some((c) => c.until <= now)) this.seedCharges = this.seedCharges.filter((c) => c.until > now);
    let add = 0;
    for (const c of this.seedCharges) add += c.add;
    return 1 + add;
  }

  private flush() {
    if (this.pending.length && this.tunnel) this.net.send({ t: 'tp', id: this.tunnel, pts: this.pending, r: this.tunnelR });
    this.pending = [];
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.flush();
    this.net.close();
  }
}
