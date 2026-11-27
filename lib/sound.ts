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

  /** The tail (or the body) swung through the air. */
  whoosh(strength = 1, p?: THREE.Vector3) {
    const o = this.out(p, 0.5 * strength);
    if (!o) return;
    const { ctx, t, node } = o;
    const len = 0.22 + 0.12 * strength;
    const src = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    const f0 = 280 * (0.85 + Math.random() * 0.3);
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f0 * (5 + 2 * strength), t + len * 0.4);
    bp.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + len);
    const g = this.env(t, 0.05, len, 1);
    src.connect(bp).connect(g).connect(node);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.05);
  }

  /**
   * A hit landing — the "thwack": a low thump with a crack on top. pop: a smaller, higher knock (a bite,
   * a pincer strike); strokes: a lash or a swat.
   */
  hit(strength = 1, p?: THREE.Vector3, style: 'pop' | 'strokes' = 'strokes') {
    const s = Math.min(1.6, Math.max(0.25, strength));
    const o = this.out(p, 0.85 * Math.min(1.2, s));
    if (!o) return;
    const { ctx, t, node } = o;
    const pop = style === 'pop';
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    const fTop = (pop ? 230 : 150) / Math.sqrt(s) * (0.9 + Math.random() * 0.2);
    thump.frequency.setValueAtTime(fTop, t);
    thump.frequency.exponentialRampToValueAtTime(fTop * 0.32, t + (pop ? 0.12 : 0.2));
    const tg = this.env(t, 0.003, pop ? 0.16 : 0.28, 1);
    // a touch of grit
    const shape = ctx.createWaveShaper();
    shape.curve = SATURATE;
    thump.connect(tg).connect(shape).connect(node);
    thump.start(t);
    thump.stop(t + 0.35);
    const crack = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = pop ? 'bandpass' : 'lowpass';
    f.frequency.value = pop ? 1600 : 2600;
    f.Q.value = pop ? 1.2 : 0.7;
    const cg = this.env(t, 0.001, pop ? 0.05 : 0.09, pop ? 0.7 : 0.6);
    crack.connect(f).connect(cg).connect(node);
    crack.start(t, Math.random() * 0.5);
    crack.stop(t + 0.15);
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
      bp.Q.value = 5;
      const g = this.env(at, 0.001, 0.018, 1);
      src.connect(bp).connect(g).connect(node);
      src.start(at, Math.random() * 0.5);
      src.stop(at + 0.04);
    }
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

  /** Out of the fruit: a cork-like pop. */
  pop(p?: THREE.Vector3) {
    const o = this.out(p, 0.45);
    if (!o) return;
    const { ctx, t, node } = o;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(700, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.07);
    const g = this.env(t, 0.002, 0.09, 1);
    osc.connect(g).connect(node);
    osc.start(t);
    osc.stop(t + 0.12);
    this.crunch(p, 2, 0.2);
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
