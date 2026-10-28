import * as THREE from 'three';
import { appleF } from '@/lib/apple';
import { connectNet, type Net, type NetMsg } from '@/lib/net';
import { WormSim, type SimInput } from './WormSim';
import { slotDir } from './spawn';
import { WIN_GROWTH, WIN_SIZE_GAIN, r3 } from './constants';

const BOT_NAMES = ['Бот Кузя', 'Бот Жора', 'Бот Нюша', 'Бот Шустрик', 'Бот Гусь', 'Бот Пончик', 'Бот Бублик'];

type BotState = 'crawl' | 'dig' | 'exit';

/**
 * A computer-controlled worm. It joins the room over its own connection, so for everyone
 * (including the player who added it) it is just another worm. It lives in the host's tab.
 */
export class Bot {
  readonly name: string;
  private net: Net;
  private sim: WormSim;
  private id = '';
  private tunnel = '';
  private counter = 0;
  private pending: number[] = [];
  private state: BotState = 'crawl';
  private stateLeft = 4 + Math.random() * 6;
  private rearLeft = 0;
  private boostLeft = 0; // remaining sprint, the same ×2 the player gets from space
  private t = Math.random() * 100;
  private seed = Math.random() * 10;
  private sendT = 0;
  private flushT = 0;
  private readonly radial = new THREE.Vector3();
  private frozenUntil = 0; // bitten: can't move for a while
  private seedBoostUntil = 0; // ate a seed: ×2 speed
  private amokUntil = 0; // stung by a spider: runs wild
  private seedAskedAt = -10;
  private antsOn = 0; // ants riding this bot
  private grip: 'head' | 'tail' | null = null; // a ladybug holds this end
  private shookAt = 0;
  private winClaimedAt = -10;
  closed = false;
  /** Called when the bot's strike lands (the host shows the comic burst). */
  onImpact?: (at: THREE.Vector3, size: number) => void;
  /** The room's goal in points. */
  setWinPoints(n: number) {
    this.sim.growthRate = (WIN_SIZE_GAIN * 100) / n;
  }
  /** Does the bot touch a spider thread? (the host's view of the webs) */
  webTouch?: (disp: THREE.Vector3[], size: number) => boolean;
  private webShakes = 0;
  private webFreeUntil = 0;

  constructor(
    room: string,
    taken: Set<string>,
    private seedAt: (p: THREE.Vector3, reach: number) => number, // seeds of the fruit, shared with the host
    freeSpot: () => THREE.Vector3, // where nobody is (the host's view)
    onGone: (reason: 'full' | 'closed') => void,
  ) {
    this.name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Бот ${Math.floor(Math.random() * 90 + 10)}`;
    this.sim = new WormSim({
      impact: (p) => this.onImpact?.(p, this.sim.L),
      tunnelStart: (r) => {
        if (!this.id) return;
        this.tunnel = `${this.id}-${++this.counter}`;
        this.net.send({ t: 'ts', id: this.tunnel, r: r3(r) });
      },
      tunnelPoint: (p) => this.pending.push(r3(p.x), r3(p.y), r3(p.z)),
      tunnelEnd: () => {
        this.flush();
        this.tunnel = '';
      },
      hole: (h) => this.net.send({ t: 'h', h }),
    });
    this.net = connectNet(
      room,
      this.name,
      (m: NetMsg) => {
        if (m.t === 'welcome') {
          this.id = m.id;
          this.sim.spawn(freeSpot()); // join in a free place
        }
        if (m.t === 'full') {
          this.close();
          onGone('full');
        }
        if (m.t === 'reset') {
          const order: string[] = Array.isArray(m.order) ? m.order : [];
          const i = order.indexOf(this.id);
          this.sim.restart(i >= 0 ? slotDir(i, order.length, Number(m.rot) || 0) : freeSpot());
          this.frozenUntil = performance.now() + 3000; // waits for the countdown like everyone
          this.seedBoostUntil = 0;
          this.webShakes = 0;
          this.webFreeUntil = 0;
          this.amokUntil = 0;
          this.state = 'crawl';
          this.stateLeft = 4 + Math.random() * 6;
        }
        if (m.t === 'ants') {
          const mine = (m.a as unknown[][]).filter((s) => s[1] === 2 && s[8] === this.id);
          this.antsOn = mine.filter((s) => s[11] !== 1).length;
          const bug = mine.find((s) => s[11] === 1);
          this.grip = bug ? (bug[9] === 0 ? 'tail' : 'head') : null;
        }
        if (m.t === 'seed' && m.by === this.id) this.seedBoostUntil = performance.now() + 10_000;
        if (m.t === 'bite' && m.id === this.id) this.frozenUntil = performance.now() + (m.duration || 5000);
        if (m.t === 'sting' && m.id === this.id) {
          this.amokUntil = performance.now() + (m.duration || 5000);
          this.webShakes = 0;
          this.webFreeUntil = this.amokUntil + 1500;
        }
        // someone won: a new round, everyone back to 0 points (the winner after its flight)
        if (m.t === 'win') {
          // the round is over: no critters, webs or venom any more
          this.webShakes = 0;
          this.webFreeUntil = 0;
          this.amokUntil = 0;
          this.antsOn = 0;
          this.grip = null;
          if (m.id === this.id) this.sim.startVictory();
          else {
            // a fresh fruit: start again on the skin (its passages are gone)
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
    if (this.sim.growth >= WIN_GROWTH && this.sim.mode !== 'fly' && this.t - this.winClaimedAt > 2) {
      this.winClaimedAt = this.t;
      this.net.send({ t: 'win', g: r3(this.sim.growth) });
    }
    const inp = this.think(dt);
    if (performance.now() < this.frozenUntil) {
      inp.forward = false;
      inp.turn = 0;
      inp.pitch = 0;
    }
    if (performance.now() < this.seedBoostUntil) inp.speed = 2;
    if (performance.now() < this.amokUntil && this.sim.mode === 'surface') {
      inp.forward = true;
      inp.boost = true;
      inp.speed = (inp.speed ?? 1) * 4;
      inp.rear = false;
    }
    // a spider thread: stuck, five jerks to get free
    if (!this.webShakes && this.sim.mode === 'surface' && !this.sim.airborne && performance.now() > this.webFreeUntil) {
      if (this.webTouch?.(this.sim.disp, this.sim.growth)) this.webShakes = 5;
    }
    if (this.webShakes) {
      inp.forward = false;
      inp.turn = 0;
      // slower than a human clicking (the spider gets a chance); not at all while stunned
      if (this.t - this.shookAt > 0.8) {
        this.shookAt = this.t;
        this.sim.shake();
        if (--this.webShakes === 0) this.webFreeUntil = performance.now() + 2500;
      }
    }
    if (this.antsOn && this.sim.mode === 'dig') {
      // ants hold it in a passage: slower, dragged back, shrinking and stretching to get free
      inp.speed = (inp.speed ?? 1) * 0.5 ** this.antsOn;
      this.sim.pullBack(0.12 * this.antsOn * dt);
      if (this.t - this.shookAt > 0.35) {
        this.shookAt = this.t;
        this.sim.squeeze();
        this.net.send({ t: 'shake' });
      }
    }
    if ((this.antsOn || this.grip) && this.sim.mode === 'surface') {
      // caught: ants slow it down, a ladybug holds it still; it keeps lashing / jerking to get free
      inp.speed = (inp.speed ?? 1) * 0.5 ** this.antsOn;
      if (this.grip) {
        inp.forward = false;
        inp.turn = 0;
      }
      if (this.t - this.shookAt > (this.grip ? 0.5 : 0.35)) {
        this.shookAt = this.t;
        if (this.grip) this.sim.whip(this.grip === 'head' ? 'tail' : 'head');
        else this.sim.shake();
        this.net.send({ t: 'shake' });
      }
    }
    this.sim.update(dt, inp);
    if (this.sim.mode === 'dig' && this.t - this.seedAskedAt > 0.5 && performance.now() >= this.seedBoostUntil) {
      const i = this.seedAt(this.sim.head, 0.6 * this.sim.L);
      if (i >= 0) {
        this.seedAskedAt = this.t;
        this.net.send({ t: 'seed', i });
      }
    }
    this.sendT += dt;
    if (this.sendT > (this.sim.mode === 'fly' ? 0.033 : 0.066)) {
      this.sendT = 0;
      const p: number[] = [];
      for (const v of this.sim.disp) p.push(r3(v.x), r3(v.y), r3(v.z));
      this.net.send({ t: 's', p, m: this.sim.mode, g: r3(this.sim.growth), w: r3(this.sim.wave), fx: r3(this.sim.fx), k: this.webShakes ? 1 : 0 });
    }
    this.flushT += dt;
    if (this.flushT > 0.25) {
      this.flushT = 0;
      this.flush();
    }
  }

  /** Simple brain: crawl around, sprint in bursts, sometimes stand up and look, burrow in, gnaw a while, come back out. */
  private think(dt: number): SimInput {
    const sim = this.sim;
    const wander = (Math.sin(this.t * 0.7 + this.seed) * 0.7 + Math.sin(this.t * 1.9 + this.seed * 2) * 0.35) * dt;
    this.stateLeft -= dt;
    const inp: SimInput = { turn: wander, pitch: 0, forward: true, boost: false, rear: false };

    if (this.state === 'crawl') {
      if (this.rearLeft > 0) {
        this.rearLeft -= dt;
        inp.rear = true;
        inp.forward = false;
      } else if (Math.random() < dt * 0.06) {
        this.rearLeft = 1.2 + Math.random();
      } else {
        inp.boost = this.sprint(dt);
      }
      if (this.stateLeft <= 0 && this.rearLeft <= 0 && !this.antsOn && !this.grip && !this.webShakes && performance.now() >= this.amokUntil) {
        sim.startDig();
        this.state = 'dig';
        this.stateLeft = 4 + Math.random() * 7;
      }
      return inp;
    }

    // inside: keep a comfortable depth, then head back out
    if (sim.mode === 'surface') {
      this.state = 'crawl';
      this.stateLeft = 6 + Math.random() * 8;
      return inp;
    }
    const depth = -appleF(sim.p);
    this.radial.copy(sim.p).normalize();
    const outward = sim.d.dot(this.radial); // +1 = heading out of the fruit
    let wantOut: number;
    if (this.state === 'exit') wantOut = 0.75;
    else if (depth < 0.6) wantOut = -0.35;
    else if (depth > 2.5) wantOut = 0.3;
    else wantOut = 0;
    const upIsOut = Math.sign(sim.u.dot(this.radial)) || 1;
    inp.pitch = Math.max(-1, Math.min(1, (wantOut - outward) * 2)) * upIsOut * dt;
    inp.boost = this.state === 'exit' || this.sprint(dt);
    if (this.state === 'dig' && this.stateLeft <= 0) this.state = 'exit';
    return inp;
  }

  /** A sprint of about a second or two, then a pause. Climbing out always boosts on top of this. */
  private sprint(dt: number): boolean {
    if (this.boostLeft > 0) {
      this.boostLeft -= dt;
      return true;
    }
    if (Math.random() < dt * 0.35) {
      this.boostLeft = 0.8 + Math.random() * 2.2;
      return true;
    }
    return false;
  }

  private flush() {
    if (this.pending.length && this.tunnel) this.net.send({ t: 'tp', id: this.tunnel, pts: this.pending });
    this.pending = [];
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.flush();
    this.net.close();
  }
}
