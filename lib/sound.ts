import * as THREE from 'three';

/**
 * The game's sounds, all made in code with Web Audio (no files): a whoosh of the tail through the air,
 * the thwack of a good hit, mandible clicks, pincer snaps, crunching through the flesh, buzzing wings,
 * crickets at night. Positional: quieter far from the camera, panned left / right.
 *
 * Browsers only allow sound after the player clicks or presses a key: the first such gesture unlocks it.
 */

const MUTE_KEY = 'chomperfly.muted';
const VOLUME = 0.8;

type Loop = { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode; lfo: OscillatorNode; seen: boolean };
type Cricket = { pitch: number; pan: number; next: number; rate: number };

const tDir = new THREE.Vector3();

class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private night!: GainNode; // the crickets' bus (fades with the night, muffled inside)
  private nightFilter!: BiquadFilterNode;
  muted = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
  private cam = new THREE.Vector3();
  private right = new THREE.Vector3(1, 0, 0);
  private loops = new Map<string, Loop>();
  private crickets: Cricket[] = [];
  private installed = false;

  /** Unlock on the first click / key press (call once; harmless again). */
  install() {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    const go = () => this.unlock();
    window.addEventListener('pointerdown', go, { capture: true });
    window.addEventListener('keydown', go, { capture: true });
  }

  private unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : VOLUME;
      // a soft limiter: a pile of hits at once doesn't crackle
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 8;
      comp.ratio.value = 5;
      this.master.connect(comp).connect(ctx.destination);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.nightFilter = ctx.createBiquadFilter();
      this.nightFilter.type = 'lowpass';
      this.nightFilter.frequency.value = 12000;
      this.night = ctx.createGain();
      this.night.gain.value = 0;
      this.night.connect(this.nightFilter).connect(this.master);
      this.crickets = [0, 1, 2].map((i) => ({ pitch: 4100 + i * 380 + Math.random() * 200, pan: [-0.7, 0.6, -0.1][i], next: 0.5 + Math.random() * 2, rate: 0.55 + Math.random() * 0.5 }));
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {}
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : VOLUME, this.ctx.currentTime, 0.05);
  }

  /** Where the ears are (every frame). */
  listen(camera: THREE.Camera) {
    this.cam.copy(camera.position);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  }

  // ---------- one-shots ----------

  /**
   * The tail (or the body) swung through the air: a soft rush of air, no ringing tone (broad filters,
   * the low end rising and falling as it sweeps past).
   */
  whoosh(strength = 1, p?: THREE.Vector3) {
    const o = this.out(p, 0.3 * strength);
    if (!o) return;
    const { ctx, t, node } = o;
    const len = 0.2 + 0.1 * strength;
    const src = this.noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 550; // no dense low rustle: just air
    hp.Q.value = 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.2;
    const f0 = 800 * (0.85 + Math.random() * 0.3);
    lp.frequency.setValueAtTime(f0, t);
    lp.frequency.exponentialRampToValueAtTime(f0 * (2.6 + strength), t + len * 0.45);
    lp.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + len * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(hp).connect(lp).connect(g).connect(node);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.05);
  }

  /**
   * A hit landing on a body — a wet, meaty slap: a sharp broadband smack, the dull squish of flesh
   * under it and a short low thud (no ringing). pop: smaller and higher (a bite, a pincer strike).
   */
  hit(strength = 1, p?: THREE.Vector3, style: 'pop' | 'strokes' = 'strokes') {
    const s = Math.min(1.6, Math.max(0.25, strength));
    const o = this.out(p, 0.9 * Math.min(1.2, s));
    if (!o) return;
    const { ctx, t, node } = o;
    const pop = style === 'pop';
    const k = (pop ? 1.6 : 1) / Math.sqrt(s);
    // the slap: skin on skin
    const slap = this.noiseSrc();
    const sb = ctx.createBiquadFilter();
    sb.type = 'bandpass';
    sb.frequency.value = 1300 * k * (0.85 + Math.random() * 0.3);
    sb.Q.value = 0.5;
    const sg = this.env(t, 0.001, pop ? 0.035 : 0.05, 1);
    slap.connect(sb).connect(sg).connect(node);
    slap.start(t, Math.random() * 0.5);
    slap.stop(t + 0.1);
    // the squish: the flesh giving under it
    const squish = this.noiseSrc();
    const sq = ctx.createBiquadFilter();
    sq.type = 'lowpass';
    sq.frequency.setValueAtTime(900 * k, t);
    sq.frequency.exponentialRampToValueAtTime(250 * k, t + 0.1);
    sq.Q.value = 0.4;
    const qg = this.env(t + 0.004, 0.006, pop ? 0.06 : 0.11, 0.9);
    squish.connect(sq).connect(qg).connect(node);
    squish.start(t, Math.random() * 0.5);
    squish.stop(t + 0.2);
    // the thud: short and low, felt more than heard
    const thud = ctx.createOscillator();
    const f = (pop ? 120 : 80) * (0.9 + Math.random() * 0.2);
    thud.frequency.setValueAtTime(f, t);
    thud.frequency.exponentialRampToValueAtTime(f * 0.75, t + 0.06);
    const tg = this.env(t, 0.002, pop ? 0.05 : 0.09, pop ? 0.4 : 0.7);
    thud.connect(tg).connect(node);
    thud.start(t);
    thud.stop(t + 0.14);
  }

  /** Mandibles: a few quick dry clicks (ants, a spider's fangs). */
  clicks(p?: THREE.Vector3, n = 2, pitch = 1, vol = 0.35) {
    const o = this.out(p, vol);
    if (!o) return;
    const { ctx, t, node } = o;
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.035 + Math.random() * 0.03);
      const src = this.noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3200 * pitch * (0.85 + Math.random() * 0.3);
      bp.Q.value = 0.8; // dry, not a ringing drop
      const g = this.env(at, 0.0005, 0.008, 1);
      src.connect(bp).connect(g).connect(node);
      src.start(at, Math.random() * 0.5);
      src.stop(at + 0.04);
    }
  }

  /**
   * Ants on me: the dry crackle of their jaws (a quick double snap) and the scratchy scurry of their
   * feet on the skin.
   */
  scurry(p?: THREE.Vector3, vol = 0.3) {
    const o = this.out(p, vol);
    if (!o) return;
    const { ctx, t, node } = o;
    const grain = (at: number, f: number, q: number, len: number, amp: number) => {
      const src = this.noiseSrc();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = f;
      hp.Q.value = q;
      const g = this.env(at, 0.0005, len, amp);
      src.connect(hp).connect(g).connect(node);
      src.start(at, Math.random() * 0.5);
      src.stop(at + len + 0.01);
    };
    // the jaws: snap-snap
    grain(t, 2500, 0.7, 0.006, 1);
    grain(t + 0.035 + Math.random() * 0.02, 2800, 0.7, 0.005, 0.8);
    // the feet: a scratchy patter
    for (let i = 0; i < 10; i++) grain(t + 0.05 + Math.random() * 0.3, 5000 + Math.random() * 3000, 0.5, 0.003 + Math.random() * 0.004, 0.25 + Math.random() * 0.25);
  }

  /** An ant straining under a load: a barely heard "kh-kh-kh". */
  grunt(p?: THREE.Vector3, vol = 0.12) {
    const o = this.out(p, vol);
    if (!o) return;
    const { ctx, t, node } = o;
    const n = 2 + Math.floor(Math.random() * 3);
    const pitch = 300 + Math.random() * 120;
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.11 + Math.random() * 0.04);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(pitch * 1.15, at);
      osc.frequency.exponentialRampToValueAtTime(pitch * 0.8, at + 0.06);
      // a breathy "kh": a voice through a mouth-like formant, plus a little hiss
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = 1100;
      formant.Q.value = 3;
      const g = this.env(at, 0.008, 0.06, 1);
      osc.connect(formant).connect(g).connect(node);
      osc.start(at);
      osc.stop(at + 0.09);
      const hiss = this.noiseSrc();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const hg = this.env(at, 0.004, 0.04, 0.35);
      hiss.connect(hp).connect(hg).connect(node);
      hiss.start(at, Math.random() * 0.5);
      hiss.stop(at + 0.06);
    }
  }

  /** Ants squabbling: thin angry squeaks. */
  squeak(p?: THREE.Vector3, vol = 0.18) {
    const o = this.out(p, vol);
    if (!o) return;
    const { ctx, t, node } = o;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.07 + Math.random() * 0.05);
      const f = 2300 + Math.random() * 1400;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, at);
      osc.frequency.linearRampToValueAtTime(f * (Math.random() < 0.5 ? 1.35 : 0.8), at + 0.05);
      const g = this.env(at, 0.004, 0.05, 1);
      osc.connect(g).connect(node);
      osc.start(at);
      osc.stop(at + 0.07);
    }
  }

  /** The earwig's pincers snapping shut. */
  snap(p?: THREE.Vector3) {
    this.clicks(p, 1, 0.55, 0.6);
    const o = this.out(p, 0.25);
    if (!o) return;
    const { ctx, t, node } = o;
    const ping = ctx.createOscillator();
    ping.frequency.setValueAtTime(1900, t);
    ping.frequency.exponentialRampToValueAtTime(1300, t + 0.05);
    const g = this.env(t, 0.001, 0.06, 1);
    ping.connect(g).connect(node);
    ping.start(t);
    ping.stop(t + 0.08);
  }

  /** A bite out of the flesh: a juicy crunch (n grains). */
  crunch(p?: THREE.Vector3, n = 3, vol = 0.3) {
    const o = this.out(p, vol);
    if (!o) return;
    const { ctx, t, node } = o;
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.025 + Math.random() * 0.035);
      const src = this.noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200 + Math.random() * 2400;
      bp.Q.value = 1.5;
      const g = this.env(at, 0.002, 0.03 + Math.random() * 0.05, 0.6 + Math.random() * 0.4);
      src.connect(bp).connect(g).connect(node);
      src.start(at, Math.random() * 0.5);
      src.stop(at + 0.1);
    }
  }

  /**
   * Gnawing through the flesh: a soft "khrum", like a step in fresh snow — a quick swell of tiny
   * crackles, then a dull settle.
   */
  chew(vol = 0.2) {
    const o = this.out(undefined, vol);
    if (!o) return;
    const { ctx, t, node } = o;
    const len = 0.11 + Math.random() * 0.05;
    const grains = 14 + Math.floor(Math.random() * 8);
    for (let i = 0; i < grains; i++) {
      // denser and louder towards the middle of the crunch
      const u = Math.random();
      const at = t + len * u;
      const amp = Math.sin(Math.PI * u) * (0.5 + Math.random() * 0.5);
      const src = this.noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400 + Math.random() * 3200;
      bp.Q.value = 1.2;
      const g = this.env(at, 0.001, 0.004 + Math.random() * 0.008, Math.max(0.05, amp));
      src.connect(bp).connect(g).connect(node);
      src.start(at, Math.random() * 0.5);
      src.stop(at + 0.03);
    }
    // the dull body of it: the flesh packing down
    const body = this.noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const bg = this.env(t + len * 0.3, 0.03, len, 0.35);
    body.connect(lp).connect(bg).connect(node);
    body.start(t, Math.random() * 0.5);
    body.stop(t + len * 1.6);
  }

  /**
   * The earwig drilling through the flesh: faster and meaner than a worm's gnawing — a hard gnash of
   * its jaws over a low growl.
   */
  drill(p?: THREE.Vector3, vol = 1) {
    const o = this.out(p, 0.35 * vol);
    if (!o) return;
    const { ctx, t, node } = o;
    for (let i = 0; i < 9; i++) {
      const u = Math.random();
      const at = t + 0.07 * u;
      const src = this.noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700 + Math.random() * 1800;
      bp.Q.value = 2;
      const g = this.env(at, 0.001, 0.006 + Math.random() * 0.01, 0.5 + 0.5 * Math.sin(Math.PI * u));
      src.connect(bp).connect(g).connect(node);
      src.start(at, Math.random() * 0.5);
      src.stop(at + 0.03);
    }
    const growl = ctx.createOscillator();
    growl.type = 'sawtooth';
    growl.frequency.setValueAtTime(62 + Math.random() * 10, t);
    growl.frequency.linearRampToValueAtTime(48, t + 0.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const gg = this.env(t, 0.01, 0.1, 0.55);
    growl.connect(lp).connect(gg).connect(node);
    growl.start(t);
    growl.stop(t + 0.14);
  }

  /** Biting into the fruit: a bigger, juicier "khrum" — the crunch, then a wet squelch of juice. */
  bite() {
    this.chew(0.3);
    const o = this.out(undefined, 0.3);
    if (!o) return;
    const { ctx, t, node } = o;
    const at = t + 0.05;
    const juice = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(1700, at);
    bp.frequency.exponentialRampToValueAtTime(450, at + 0.16);
    const g = this.env(at, 0.02, 0.16, 1);
    juice.connect(bp).connect(g).connect(node);
    juice.start(at, Math.random() * 0.5);
    juice.stop(at + 0.25);
  }

  /** The win: a light party popper — a crisp pop, then a sprinkle of tiny crackles as the confetti flies. */
  popper(p?: THREE.Vector3) {
    const o = this.out(p, 0.5);
    if (!o) return;
    const { ctx, t, node } = o;
    const bang = this.noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const bg = this.env(t, 0.001, 0.05, 1);
    bang.connect(hp).connect(bg).connect(node);
    bang.start(t, Math.random() * 0.5);
    bang.stop(t + 0.1);
    const body = ctx.createOscillator();
    body.frequency.setValueAtTime(330, t);
    body.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    const bb = this.env(t, 0.002, 0.07, 0.5);
    body.connect(bb).connect(node);
    body.start(t);
    body.stop(t + 0.1);
    for (let i = 0; i < 22; i++) {
      const at = t + 0.08 + Math.random() ** 1.6 * 0.9;
      const c = this.noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3500 + Math.random() * 4500;
      bp.Q.value = 4;
      const g = this.env(at, 0.001, 0.008 + Math.random() * 0.01, 0.15 + Math.random() * 0.3);
      c.connect(bp).connect(g).connect(node);
      c.start(at, Math.random() * 0.5);
      c.stop(at + 0.03);
    }
  }

  /** The butterfly's wings: soft rustling beats, fading as it flies away. */
  flutter(p?: THREE.Vector3, seconds = 2.6) {
    const o = this.out(p, 0.35);
    if (!o) return;
    const { ctx, t, node } = o;
    let at = t;
    while (at < t + seconds) {
      const k = 1 - (at - t) / seconds; // fading away
      const src = this.noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800 + Math.random() * 1400;
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.0001 + k * k * (0.6 + Math.random() * 0.3), at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      src.connect(bp).connect(g).connect(node);
      src.start(at, Math.random() * 0.5);
      src.stop(at + 0.1);
      at += 0.1 + Math.random() * 0.025; // ~9 beats a second
    }
  }

  /** A drop of dew picked up: a bubbly bloop. */
  bloop(p?: THREE.Vector3) {
    const o = this.out(p, 0.35);
    if (!o) return;
    const { ctx, t, node } = o;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(950, t + 0.11);
    const g = this.env(t, 0.005, 0.16, 1);
    osc.connect(g).connect(node);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /**
   * Out of the fruit: a juicy "chpok" — a quick rising pop (like a finger flicked out of a cheek) and a
   * wet splash of juice after it.
   */
  pop(p?: THREE.Vector3) {
    const o = this.out(p, 0.4);
    if (!o) return;
    const { ctx, t, node } = o;
    const osc = ctx.createOscillator();
    const f = 520 * (0.92 + Math.random() * 0.16);
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 2.6, t + 0.045);
    const g = this.env(t, 0.003, 0.06, 1);
    osc.connect(g).connect(node);
    osc.start(t);
    osc.stop(t + 0.09);
    const splash = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(3200, t + 0.02);
    bp.frequency.exponentialRampToValueAtTime(1100, t + 0.14);
    const sg = this.env(t + 0.02, 0.008, 0.12, 0.6);
    splash.connect(bp).connect(sg).connect(node);
    splash.start(t, Math.random() * 0.5);
    splash.stop(t + 0.2);
  }

  /** A soft landing on the skin. */
  thud(p?: THREE.Vector3, strength = 1) {
    const o = this.out(p, 0.4 * strength);
    if (!o) return;
    const { ctx, t, node } = o;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    const g = this.env(t, 0.004, 0.2, 1);
    osc.connect(g).connect(node);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  /** A heavy beetle's footfall (the chafer galloping): a low thump and the scrape of its claws. */
  stomp(p?: THREE.Vector3, vol = 1, accent = 1) {
    const o = this.out(p, 0.55 * vol * accent);
    if (!o) return;
    const { ctx, t, node } = o;
    const osc = ctx.createOscillator();
    const f = 75 * (0.9 + Math.random() * 0.2);
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.09);
    const g = this.env(t, 0.003, 0.12, 1);
    const shape = ctx.createWaveShaper();
    shape.curve = SATURATE;
    osc.connect(g).connect(shape).connect(node);
    osc.start(t);
    osc.stop(t + 0.16);
    const scrape = this.noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const sg = this.env(t, 0.002, 0.05, 0.5);
    scrape.connect(lp).connect(sg).connect(node);
    scrape.start(t, Math.random() * 0.5);
    scrape.stop(t + 0.08);
  }

  /**
   * A step on the fruit's skin: rubber squeaking on glass, softly — "wee" (up: the pitch rising, the back
   * pulling up) or "woo" (down: falling, the front stretching on). Stick-slip: a buzzy tone, trembling.
   */
  rub(p?: THREE.Vector3, up = true, vol = 0.05) {
    const o = this.out(p, vol);
    if (!o) return;
    const { ctx, t, node } = o;
    const len = 0.16 + Math.random() * 0.05;
    const f0 = (up ? 520 : 680) * (0.92 + Math.random() * 0.16);
    const f1 = up ? f0 * 1.35 : f0 * 0.72;
    // a soft, round tone (no buzz): a sine with a little triangle for body
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + len);
    // a gentle wobble of the rubber (not a judder)
    const wob = ctx.createOscillator();
    wob.frequency.value = 22 + Math.random() * 8;
    const wg = ctx.createGain();
    wg.gain.value = 0.15;
    const trem = ctx.createGain();
    trem.gain.value = 0.85;
    wob.connect(wg).connect(trem.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.06); // eases in
    g.gain.setValueAtTime(1, t + len * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(trem).connect(lp).connect(g).connect(node);
    osc.start(t);
    wob.start(t);
    osc.stop(t + len + 0.02);
    wob.stop(t + len + 0.02);
  }

  /**
   * Silk threads stretched: a rustle and a creak — a run of tiny stick-slip catches, faster and higher
   * the tighter they're pulled (tension 0…1).
   */
  creak(p?: THREE.Vector3, tension = 0, vol = 0.3) {
    const o = this.out(p, vol);
    if (!o) return;
    const { ctx, t, node } = o;
    const len = 0.32 + Math.random() * 0.1;
    // the rustle of silk
    const rustle = this.noiseSrc();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const rg = this.env(t, 0.05, len, 0.25);
    rustle.connect(hp).connect(rg).connect(node);
    rustle.start(t, Math.random() * 0.5);
    rustle.stop(t + len + 0.1);
    // the creak: catches speeding up as the thread is pulled
    const rate0 = 28 + 30 * tension;
    let at = t + 0.02;
    let k = 0;
    while (at < t + len) {
      const u = (at - t) / len;
      const src = this.noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = (1300 + 1200 * tension) * (1 + 0.35 * u);
      bp.Q.value = 6;
      const g = this.env(at, 0.0008, 0.012, 0.5 + 0.5 * Math.sin(Math.PI * u));
      src.connect(bp).connect(g).connect(node);
      src.start(at, Math.random() * 0.5);
      src.stop(at + 0.03);
      at += 1 / (rate0 * (1 + 0.8 * u)) * (0.85 + Math.random() * 0.3);
      k++;
    }
  }

  /**
   * The thread snaps — PYN'K: a bright plucked string (like a guitar's top strings), its pitch dropping
   * a touch as it goes slack.
   */
  snapString(p?: THREE.Vector3) {
    const o = this.out(p, 0.45);
    if (!o) return;
    const { ctx, t, node } = o;
    const f = [330, 392, 440, 494][Math.floor(Math.random() * 4)] * 2; // E5…B5: the top strings, high up
    for (const [mul, amp, decay] of [
      [1, 1, 0.55],
      [2, 0.45, 0.3],
      [3, 0.22, 0.18],
      [4, 0.1, 0.12],
    ]) {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(f * mul, t);
      osc.frequency.exponentialRampToValueAtTime(f * mul * 0.94, t + decay); // goes slack
      const g = this.env(t, 0.002, decay, amp);
      osc.connect(g).connect(node);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    }
    // the snap itself: a sharp click
    const click = this.noiseSrc();
    const chp = ctx.createBiquadFilter();
    chp.type = 'highpass';
    chp.frequency.value = 2500;
    const cg = this.env(t, 0.0005, 0.012, 0.8);
    click.connect(chp).connect(cg).connect(node);
    click.start(t, Math.random() * 0.5);
    click.stop(t + 0.03);
  }

  /** Stuck in a web (or tugging at it): the silk twangs. */
  twang(p?: THREE.Vector3, vol = 0.3) {
    const o = this.out(p, vol);
    if (!o) return;
    const { ctx, t, node } = o;
    const base = 180 + Math.random() * 40;
    for (const [mul, v] of [
      [1, 1],
      [1.5, 0.5],
      [2.01, 0.3],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(base * mul * 1.04, t);
      osc.frequency.exponentialRampToValueAtTime(base * mul, t + 0.3);
      const g = this.env(t, 0.003, 0.7, v);
      osc.connect(g).connect(node);
      osc.start(t);
      osc.stop(t + 0.75);
    }
  }

  // ---------- loops ----------

  /**
   * Buzzing wings, kept up from frame to frame: call it every frame while `key` buzzes (at `p`), then
   * call endFrame(): the ones not called fade out. base: the wing-beat pitch (a gnat high, the chafer low).
   */
  buzz(key: string, p: THREE.Vector3, base: number, vol: number) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    let l = this.loops.get(key);
    if (!l) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = base;
      const lfo = ctx.createOscillator(); // the wobble of a real buzz
      lfo.frequency.value = 5 + Math.random() * 4;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = base * 0.04;
      lfo.connect(lfoAmt).connect(osc.frequency);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = base * 3;
      filter.Q.value = 0.9;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      osc.connect(filter).connect(gain).connect(pan).connect(this.master);
      osc.start();
      lfo.start();
      l = { osc, filter, gain, pan, lfo, seen: true };
      this.loops.set(key, l);
    }
    l.seen = true;
    const { g, pan } = this.place(p, vol);
    const t = ctx.currentTime;
    l.gain.gain.setTargetAtTime(g, t, 0.06);
    l.pan.pan.setTargetAtTime(pan, t, 0.06);
    l.osc.frequency.setTargetAtTime(base * (0.97 + 0.06 * Math.random()), t, 0.1);
  }

  /** After the frame's buzz() calls: fade out (and drop) the loops not heard this frame; the crickets. */
  endFrame(nightAmount: number, muffled: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [key, l] of this.loops) {
      if (l.seen) {
        l.seen = false;
        continue;
      }
      l.gain.gain.setTargetAtTime(0, t, 0.08);
      if (l.gain.gain.value < 0.002) {
        l.osc.stop();
        l.lfo.stop();
        l.pan.disconnect();
        this.loops.delete(key);
      }
    }
    // crickets: chirp chirp chirp, a few of them about the orchard
    this.night.gain.setTargetAtTime(this.muted ? 0 : 0.5 * nightAmount, t, 0.8);
    this.nightFilter.frequency.setTargetAtTime(muffled > 0.5 ? 900 : 12000, t, 0.3);
    if (nightAmount <= 0.01) return;
    for (const c of this.crickets) {
      if (t < c.next) continue;
      this.chirp(c, t + 0.02);
      // they keep a rhythm for a while, then pause
      c.next = t + (Math.random() < 0.12 ? 2 + Math.random() * 4 : c.rate * (0.92 + Math.random() * 0.16));
    }
  }

  /** Everything off (leaving the game). */
  stopAll() {
    for (const l of this.loops.values()) {
      l.osc.stop();
      l.lfo.stop();
      l.pan.disconnect();
    }
    this.loops.clear();
    if (this.ctx) this.night.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  private chirp(c: Cricket, t: number) {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = c.pan;
    pan.connect(this.night);
    const pulses = 3 + (Math.random() < 0.3 ? 1 : 0);
    for (let i = 0; i < pulses; i++) {
      const at = t + i * 0.045;
      const osc = ctx.createOscillator();
      osc.frequency.value = c.pitch;
      // the pulse trembles (the wing's teeth)
      const am = ctx.createOscillator();
      am.frequency.value = 190;
      const amG = ctx.createGain();
      amG.gain.value = 0.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.12, at + 0.006);
      g.gain.setValueAtTime(0.12, at + 0.022);
      g.gain.linearRampToValueAtTime(0, at + 0.03);
      const trem = ctx.createGain();
      trem.gain.value = 0.5;
      am.connect(amG).connect(trem.gain);
      osc.connect(trem).connect(g).connect(pan);
      osc.start(at);
      am.start(at);
      osc.stop(at + 0.035);
      am.stop(at + 0.035);
    }
  }

  // ---------- plumbing ----------

  /** How loud and where (left / right) a sound at p is for the camera. */
  private place(p: THREE.Vector3 | undefined, vol: number) {
    if (!p) return { g: vol, pan: 0 };
    tDir.subVectors(p, this.cam);
    const d = tDir.length();
    const g = vol * Math.min(1, (REF / Math.max(0.01, d)) ** 1.2);
    const pan = d > 1e-4 ? THREE.MathUtils.clamp(tDir.dot(this.right) / d, -1, 1) * 0.8 : 0;
    return { g, pan };
  }

  /** A fresh output for a one-shot: its volume and pan set; null when silent. */
  private out(p: THREE.Vector3 | undefined, vol: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return null;
    const { g, pan } = this.place(p, vol);
    if (g < 0.01) return null;
    const gain = ctx.createGain();
    gain.gain.value = g;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    gain.connect(panner).connect(this.master);
    return { ctx, t: ctx.currentTime + 0.005, node: gain as AudioNode };
  }

  private noiseSrc() {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  /** An attack-decay envelope. */
  private env(t: number, attack: number, decay: number, peak: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }
}

/** Distance (world units) at which a sound plays at its full volume. */
const REF = 4;
const SATURATE = (() => {
  const c = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * 2 - 1;
    c[i] = Math.tanh(2.2 * x) / Math.tanh(2.2);
  }
  return c;
})();

export const sound = new Sound();
