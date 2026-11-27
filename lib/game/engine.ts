import * as THREE from 'three';
import { R0, appleF, appleNormal, appleProject, appleShapeR, pushOutOfPit, setPit } from '@/lib/apple';
import { connectNet, type NetMsg } from '@/lib/net';
import type { AppleModel } from '@/lib/appleModel';
import { addCutaway, makeFruitMaterial, makeFruitUniforms } from '@/lib/render/materials';
import { fruitSpec } from '@/lib/fruits';
import { HoleLayer, TunnelStore } from '@/lib/render/tunnels';
import { Confetti } from '@/lib/render/confetti';
import { Impacts } from '@/lib/render/impacts';
import { Puffs } from '@/lib/render/puffs';
import { StunStars } from '@/lib/render/stars';
import { SpeedLines } from '@/lib/render/streaks';
import { Webs } from '@/lib/render/webs';
import { Seeds } from '@/lib/render/seeds';
import { Drops } from '@/lib/render/drops';
import { Gnats } from '@/lib/render/gnats';
import { SunFlare } from '@/lib/render/sunFlare';
import { LIGHTING, LIGHTS, type LightName } from '@/lib/render/lighting';
import { freeDir, slotDir } from '@/lib/worm/spawn';
import { ANT, AntSim, CARRY, CHAFER, CHASE, HOLD, LADYBUG, QUARREL, SPECS, type WormInfo } from '@/lib/worm/Ants';
import { sound } from '@/lib/sound';
import { AntView } from '@/lib/worm/AntView';
import { SkyDome, loadFruitSky, sunDirFromPanorama } from '@/lib/render/sky';
import { WormSim, type SimInput } from '@/lib/worm/WormSim';
import { Bot } from '@/lib/worm/Bot';
import { LEVEL, LEVELS, type LevelName } from '@/lib/worm/levels';
import { disposeWormView, makeWormView, placeLabel, poseWorm, setLabel, setRainbow, setStunGlow, setWormColor, type WormView } from '@/lib/worm/wormView';
import { BIG_AT, DEFAULT_NAME, DIG_SPEED, WIN_DEFAULT, WIN_GROWTH, WIN_SIZE_GAIN, antsDrag, damp, girth, L0, N, RADII, r3, winProgress } from '@/lib/worm/constants';

/** What the React UI shows. Kept small: it is compared and re-sent every frame. */
export type HudState = {
  players: number;
  net: 'connecting' | 'online' | 'offline';
  roster: string; // JSON of RosterRow[]
  toast: string; // "<kind>:<name>"
  fps: number;
  seedBoost: number; // seconds until the last water drop's boost ends
  seedMul: number; // speed multiplier from water drops, 1 = none
  countdown: number; // Date.now() when a 3-2-1-START countdown began, 0 = none
  ants: number; // ants riding my worm
  grip: '' | 'head' | 'tail'; // a ladybug holds this end
  web: number; // stuck in a spider thread: jerks left (0 = free)
  earwig: number; // in the earwig's pincers: jerks left (0 = free)
  winner: string; // name of this round's winner while the end-of-round dialog is shown
  winnerMe: boolean;
  end: '' | 'win' | 'arena' | 'wipe'; // how the round ended
  roundTime: number; // seconds into the round (stops when it's over)
  light: string; // the time of day
  readyMe: boolean; // I pressed OK for the next round
  readyN: number; // …so many have
  readyOf: number;
  goAt: number; // Date.now() when the next round starts anyway
  canStartNow: boolean; // I made this room: I may start the next round at once
};

export type RosterRow = {
  id: string;
  name: string;
  color: number;
  mode: string;
  me: boolean;
  score: number; // points (the arena: life)
  wins: number; // rounds won in this room
  web: boolean; // stuck in a web
  myBot: boolean;
  stunned: number; // seconds left, 0 = fine
  panic: number; // stung / bitten, running wild: seconds left
  out: boolean; // arena: no life left
};

/** A lobby room: everyone in it plays on one fruit (the map). */
export type RoomInfo = {
  id: string;
  name: string;
  fruit: string;
  players: number;
  max: number;
  win?: number; // the goal in points (the arena: lives)
  light?: string; // the time of day
  level?: string; // the difficulty
  size?: string; // the fruit's size: small, standard, large
  arena?: boolean; // the last one with life left wins, not the first to the goal
};

export type EngineOptions = {
  mount: HTMLElement;
  room: RoomInfo;
  name: string;
  color?: number; // my worm's colour (the server may give another if it's taken)
  model: AppleModel | null;
  pit?: { object: THREE.Object3D; radii: THREE.Vector3 } | null; // an obstacle instead of seeds
  hud: HudState;
  onHud: (hud: HudState) => void;
  uiBlocked: () => boolean; // a dialog is open: ignore the keyboard
  openSettings: () => void;
  /** Bots to add once connected (the player who created the room picked them), at this level. */
  bots?: number;
  botLevel?: LevelName;
  /** The room is gone or full: back to the lobby. */
  onLeave: (reason: 'noroom' | 'full') => void;
};

export type Engine = {
  restartRoundForAll: () => void; // everyone starts again: passages, points and seeds reset
  roundReady: () => void; // OK after a round: ready for the next one
  startNow: () => void; // the room's creator: the next round now, without waiting
  nextLight: () => void; // the next time of day
  dispose: () => void;
  addBot: () => void;
  removeBot: (id: string) => void;
  removeBots: () => void;
  restartRound: (dir?: THREE.Vector3) => void;
};

type Remote = {
  view: WormView;
  disp: THREE.Vector3[];
  target: THREE.Vector3[];
  from: THREE.Vector3[]; // where the balls were drawn when the last update came: we glide from there to target
  recvAt: number; // local time of the last update
  every: number; // how often updates come (smoothed), the glide's length
  waveAt: number; // local time the swallowing wave value came, and how fast it runs: it moves on between updates
  waveRate: number;
  has: boolean;
  last: number;
  mode: string;
  size: number;
  wave: number;
  fx: number;
  prevFx: number;
  fxAt: number; // local time when fx arrived: the flight clock runs on between updates
  bornAt: number; // it pops up when it first appears
  stuck?: boolean; // in a spider thread
  seed?: number; // its speed factor
  rear?: boolean; // standing on its tail
  hp?: number; // arena: its life
  shield?: boolean; // untouchable (ate a seed)
  shieldEnding?: number; // …the last 2 s (it blinks)
  out?: boolean; // arena: no life left
};

const DEFAULT_ZOOM = 2;
const INTRO_HOLD = 0.7; // seconds on the whole fruit when joining
const INTRO_FLY = 1.8; // then a gentle swoop down to the worm
const OVERVIEW_FLY = 1.8; // after a win, the drift back to the whole fruit
const Y_UP = new THREE.Vector3(0, 1, 0);
export const COUNTDOWN_MS = 3000; // "3", "2", "1", then START
const GULP_PANIC = 3; // panicking: the swallowing wave swells 3× bigger, huge gulps
const CONFETTI_AT = 1.0; // seconds into the victory flight: the wings spring out
const SHIELD_MS = 10000; // a seed: untouchable this long
const PIT_SHIELD_MS = 20000; // a peach's pit: …this long (once in 40 s)
const DOUBLE_CLICK_MS = 320;
const WEB_SHAKES = 5;
const EARWIG_SHAKES = 5;

/** Untouchable, the last 2 s: blinking (true = shown). */
const shieldShown = (leftMs: number) => leftMs > 2000 || (((2000 - leftMs) / 2000) * 3) % 1 < 0.55;
/** After a panic: the body wobbles, fading out over 4 s. */
const afterPanic = (until: number) => {
  const t = performance.now() - until;
  return t < 0 || t > 4000 ? 0 : 1 - t / 4000;
};
/** Smootherstep. */
const smoother = (k: number) => k * k * k * (k * (k * 6 - 15) + 10);

export function startEngine(o: EngineOptions): Engine {
  const WIDE_LOOK = new THREE.Vector3(0, 0.05 * R0, 0); // where the whole-fruit shot looks
  // the race: the size grows 3× by the win whatever the goal; a bigger goal just takes longer
  // the arena: the goal is the life everyone starts with
  const winPoints = o.room.win || WIN_DEFAULT;
  const arena = !!o.room.arena;
  const score = (growth: number) => Math.max(0, Math.floor(winProgress(growth) * winPoints + 1e-6));
  /** What the board shows: points, or (the arena) life. */
  const shown = (growth: number, hp?: number) => (arena ? Math.max(0, Math.round(hp ?? winPoints)) : score(growth));
  const { mount, model } = o;
  const { fruit } = o.room;
  const myName = o.name;
  let hud = o.hud;
  const updateHud = (patch: Partial<HudState>) => {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof HudState)[]) if (hud[k] !== patch[k]) changed = true;
    if (!changed) return;
    hud = { ...hud, ...patch };
    o.onHud(hud);
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const toast = (text: string) => {
    updateHud({ toast: text });
    later(3000, () => {
      if (hud.toast === text) updateHud({ toast: '' });
    });
  };

  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // sharper costs a lot of GPU on hi-dpi screens
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  // hidden until the worm has its place (no jump of the camera on joining), then fades in
  canvas.style.opacity = '0';
  canvas.style.transition = 'opacity 0.45s ease';
  let introAt = -100; // game time when the opening shot started (the whole fruit, then down to the worm)
  let introFrom: { pos: THREE.Vector3; q: THREE.Quaternion } | null = null; // a new round: fly from here (no hold)
  // after a win: the whole fruit, from where the camera was (side), until the next round
  let overview: { at: number; side: THREE.Vector3; fromPos: THREE.Vector3; fromQ: THREE.Quaternion } | null = null;
  const startOverview = () => {
    const side = new THREE.Vector3(camera.position.x, 0, camera.position.z);
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
    overview = { at: time, side: side.normalize(), fromPos: camera.position.clone(), fromQ: camera.quaternion.clone() };
  };
  const reveal = () => {
    if (canvas.style.opacity !== '1') {
      introAt = time;
      introFrom = null; // joining: the whole fruit first
    }
    canvas.style.opacity = '1';
  };
  later(3000, reveal); // no server answer: show it anyway

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdcdcdc); // until the panorama loads
  const fog = new THREE.Fog(0xf2efe2, 500, 1000); // flesh haze when the camera is inside
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.02, 2000);
  scene.add(camera);

  // the sun (casting shadows over the fruit) + sky / ground light + a soft fill; a lamp at the camera inside
  const hemi = new THREE.HemisphereLight(0xffffff, 0x303030, 0.45);
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 4;
  {
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -1.5 * R0;
    sc.right = sc.top = 1.5 * R0;
  }
  sun.position.set(0.2, 0.9, 0.3).multiplyScalar(50);
  const camLight = new THREE.PointLight(0xffffff, 0, 7, 1);
  const ambient = new THREE.AmbientLight(0xffffff, 0.1);
  scene.add(hemi, ambient, sun);
  camera.add(camLight);

  let skyTex: THREE.Texture | null = null;
  let skyBlur = 0.3;
  const dome = new SkyDome(scene, R0 * 4); // the panorama a few fruit sizes away: a snug glade
  const flare = new SunFlare(scene, R0);
  const drops = new Drops(scene);
  const gnats = new Gnats(scene);
  let alive = true;
  void loadFruitSky(fruit, (tex) => {
    if (!alive) return tex.dispose();
    skyTex = tex;
    tex.colorSpace = THREE.SRGBColorSpace;
    dome.setMap(tex);
    scene.background = null;
    // lighting/reflections still from the panorama, as if at infinity
    const env = tex.clone();
    env.mapping = THREE.EquirectangularReflectionMapping;
    env.needsUpdate = true;
    scene.environment = env;
    scene.backgroundIntensity = 0.9;
    panoramaSun = sunDirFromPanorama(tex);
    skyLoaded = true;
    applyLight();
    warmFruitShaders();
    tunnels.warmShaders(renderer, camera);
    holes.warmShaders(renderer, camera);
    antView.warm(renderer, camera, scene);
  });

  // ---------- the time of day ----------
  let light: LightName = (LIGHTS as readonly string[]).includes(o.room.light ?? '') ? (o.room.light as LightName) : 'day';
  let panoramaSun: THREE.Vector3 | null = null; // where the photo's sun is
  let skyLoaded = false;
  let night = 0;
  function applyLight() {
    const L = LIGHTING[light];
    sun.color.setHex(L.sunColor);
    sun.intensity = L.sunIntensity;
    hemi.color.setHex(L.hemiSky);
    hemi.groundColor.setHex(L.hemiGround);
    renderer.toneMappingExposure = L.exposure;
    ambient.color.setHex(L.ambient);
    ambient.intensity = L.ambientIntensity;
    hemi.intensity = L.hemiIntensity;
    flare.setMoon(L.skyMoon > 0);
    drops.setMoon(L.skyMoon > 0);
    gnats.setNight(L.skyMoon > 0);
    night = L.skyMoon;
    camLight.color.setHex(L.skyMoon > 0 ? 0xa8bdd4 : 0xffffff);
    sun.shadow.radius = L.skyMoon > 0 ? 9 : 4; // moonlight: soft shadows
    if (!skyLoaded) return;
    scene.environmentIntensity = L.envIntensity;
    dome.setTint(L.skyTint, L.skyIntensity, L.skyMoon);
    // the sun: from where the photo has it, at this time of day's height (night: the photo's sun is the moon)
    let dir = panoramaSun ? panoramaSun.clone() : null;
    if (L.sunElev !== null) {
      const flat = dir ? new THREE.Vector3(dir.x, 0, dir.z) : new THREE.Vector3(0.6, 0, 0.8);
      if (flat.lengthSq() < 1e-6) flat.set(0.6, 0, 0.8);
      const el = THREE.MathUtils.degToRad(L.sunElev);
      dir = flat.normalize().multiplyScalar(Math.cos(el)).setY(Math.sin(el));
    }
    if (dir) {
      sun.position.copy(dir).multiplyScalar(50);
      flare.setSun(dir);
    }
  }
  applyLight();

  // ---------- fruit ----------
  const fruitUniforms = makeFruitUniforms();
  const fleshColor = fruitUniforms.uFlesh.value.clone();
  const flesh = fruitSpec(fruit).flesh; // lib/fruits.json
  if (flesh) fleshColor.set(flesh); // e.g. a golden peach; the haze inside the flesh takes the same colour
  fruitUniforms.uFlesh.value.copy(fleshColor);
  fruitUniforms.uNight.value = night;
  fog.color.copy(fleshColor);
  const fruitGeo = model ? model.geometry : proceduralFruitGeometry();
  const surfaceMat = makeFruitMaterial(fruitUniforms, model?.map ?? null, 'surface');
  const cutawayMat = makeFruitMaterial(fruitUniforms, model?.map ?? null, 'cutaway');
  const fruitMesh = new THREE.Mesh(fruitGeo, surfaceMat);
  fruitMesh.renderOrder = 10;
  fruitMesh.receiveShadow = true;
  scene.add(fruitMesh);
  // inside: the far wall stays solid flesh and hides the outside world (drawn first, behind everything inside)
  const backdropMat = makeFruitMaterial(fruitUniforms, model?.map ?? null, 'backdrop');
  const fruitBackdrop = new THREE.Mesh(fruitGeo, backdropMat);
  fruitBackdrop.renderOrder = -5;
  fruitBackdrop.visible = false;
  scene.add(fruitBackdrop);
  function warmFruitShaders() {
    // Compile both transition materials with the panorama and room lights before their first use.
    const mesh = new THREE.Mesh(fruitGeo, cutawayMat);
    renderer.compile(mesh, camera, scene);
    mesh.material = backdropMat;
    renderer.compile(mesh, camera, scene);
  }
  const extras = model?.stem ? [modelStem(model.stem)] : proceduralStemAndLeaf();
  for (const e of extras) {
    e.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }
  scene.add(...extras);

  const tunnels = new TunnelStore(scene);
  const confetti = new Confetti(scene);
  const impacts = new Impacts(scene);
  const puffs = new Puffs(scene);
  const stars = new StunStars(scene);
  const streaks = new SpeedLines(scene);
  const sunDir = new THREE.Vector3();
  let dropPending = -1; // the drop we asked the server for
  let dropAskedAt = -10;
  const panicOf = new Map<string, number>(); // panicking worms (by id) puff steam like a locomotive until then
  const puffAt = new Map<string, number>();
  const chimney = (id: string, disp: THREE.Vector3[], size: number) => {
    if ((panicOf.get(id) ?? 0) < performance.now() || time - (puffAt.get(id) ?? -1) < 0.11) return;
    // its butt is on fire: chug-chug, puffs of steam out of the tail end, up and trailing behind
    puffAt.set(id, time);
    const tail = disp[0];
    const up = tmpUp.copy(tail).normalize();
    const back = tmpBack.subVectors(tail, disp[2]).normalize();
    const L = L0 * size;
    puffs.emit(tmpP.copy(tail).addScaledVector(up, 0.1 * L), up.multiplyScalar(1.4 * L).addScaledVector(back, 1.2 * L), 1.1 * L);
  };
  const tmpUp = new THREE.Vector3();
  const tmpBack = new THREE.Vector3();
  const tmpP = new THREE.Vector3();
  const webs = new Webs(scene);
  let webShakes = 0; // stuck in a thread: jerks left to get free
  let webFreeUntil = 0; // just got free: can cross threads for a moment
  let websSentAt = 0;
  let hudAt = -1; // when the player list was last refreshed
  let websFullAt = -10;
  let websTouchedAt = 0;
  let pendingWebs: { w?: number[][]; wd?: number[][] } | null = null; // threads waiting for the next critters' message
  // seeds; a fruit with a pit has the pit (an obstacle, seen only from inside) instead
  const pit = o.pit ?? null;
  const seeds = pit ? null : new Seeds(scene, fruit);
  seeds?.useCutaway((m) => addCutaway(m, fruitUniforms)); // membranes and arils don't hide the worm
  if (pit) {
    scene.add(pit.object);
    setPit({ c: new THREE.Vector3(), r: pit.radii });
  }
  // critters: the room's host simulates them, everyone draws them
  const antSim = new AntSim(arena);
  antSim.onSting = (id, k) => net.send({ t: 'sting', id, k }); // the server freezes the worm for everyone
  antSim.onAntBite = (id, k) => net.send({ t: 'antbite', id, k });
  antSim.onEarwig = (id, pts, how) => net.send({ t: 'earwig', id, pts, how });
  antSim.onChafer = (id) => net.send({ t: 'chafer', id });
  // the earwig's drill leaves passages like a worm's (sent as the host's)
  let drillCounter = 0;
  const drills = new Map<number, { id: string; r: number; pts: number[] }>();
  const flushDrills = () => {
    for (const d of drills.values()) {
      if (d.pts.length) net.send({ t: 'tp', id: d.id, pts: d.pts, r: d.r });
      d.pts = [];
    }
  };
  antSim.onDrill = {
    start: (ew, r) => {
      const d = { id: `${myId}-e${++drillCounter}`, r: r3(r), pts: [] as number[] };
      drills.set(ew, d);
      tunnels.get(d.id, r);
      net.send({ t: 'ts', id: d.id, r: d.r });
    },
    point: (ew, p) => {
      const d = drills.get(ew);
      if (!d) return;
      tunnels.append(d.id, p);
      d.pts.push(r3(p.x), r3(p.y), r3(p.z));
    },
    end: (ew) => {
      flushDrills();
      drills.delete(ew);
    },
    hole: (h) => {
      holes.place(h);
      net.send({ t: 'h', h });
    },
  };
  const antView = new AntView(scene);
  antView.onBite = (p, size, style, follow) => {
    impacts.burst(p, size, style === 'pop', follow);
    sound.hit(size, p, style);
  };
  sound.install();
  let soundMode = '';
  const soundHead = new THREE.Vector3();
  let soundWeb = 0;
  let stompIn = 0; // s to the chafer's next footfall
  let stompStep = 0;
  let chewIn = 0;
  const chaferWas = new THREE.Vector3();
  let isHost = false;
  let roundOver = false; // someone won (or the arena wiped out): everyone stops until the next round
  let roundStart = performance.now();
  let roundEnd = 0;
  let winnerId = '';
  let netStatus: HudState['net'] = 'connecting';
  let antsSentAt = 0;
  let antsOnMe = 0;
  let gripOnMe: 'head' | 'tail' | null = null; // a ladybug holds this end of my worm
  let slamDoneAt = 0; // when my slam hits (tell the host)
  let boosts: { until: number; add: number }[] = []; // each water drop adds `add` to the base speed; they stack
  let seedPending = -1; // index we already asked the server about
  let seedAskedAt = -10;
  const boostFactor = () => {
    const now = performance.now();
    if (boosts.some((c) => c.until <= now)) boosts = boosts.filter((c) => c.until > now);
    let add = 0;
    for (const c of boosts) add += c.add;
    return 1 + add;
  };
  /** Pop confetti when a flying worm's wings come out (fx passes CONFETTI_AT). */
  const maybeConfetti = (prevFx: number, fx: number, disp: THREE.Vector3[], size: number) => {
    if (!(prevFx < CONFETTI_AT && fx >= CONFETTI_AT)) return;
    const at = disp[N - 3];
    confetti.burst(at, at.clone().normalize(), L0 * size);
  };
  const holes = new HoleLayer(scene, fruitUniforms.uNight);
  let time = 0;

  // ---------- my worm ----------
  let xray = false; // X on the skin (inside it is always on)
  let myId = 'local' + Math.floor(Math.random() * 1e6);
  let curTunnel = '';
  let tunnelCounter = 0;
  let pendingPts: number[] = [];
  let winClaimedAt = -10;
  let frozenUntil = 0; // bitten
  let roundResults: Map<string, number> | null = null; // after a win, until the next round: the final points on the board
  let shieldUntil = 0; // ate a seed: untouchable
  let pitShieldAt = -1e9; // the pit's shield (once in a while)
  let riding = false; // on the chafer's back
  const rammed = new Set<string>(); // worms my rocket already hit
  let ramAt = 0;
  let dropOneAt = 0;
  let wasRocketing = false;
  let rideStartAt = 0;
  let rideTurn = 0; // steering the chafer, gathered between messages
  let rideSentAt = 0;
  let earwigShakes = 0; // in the earwig's pincers: jerks left to get free
  let earwigHeldAt = 0;
  let panicMul = 2; // panicking: × speed (a spider's venom ×2, an ant's or the earwig's bite ×1.5)
  let panicUntil = 0; // panicking: runs wild, can only steer
  let curTunnelR = 0.2; // its radius (sent with the points too)
  let outTold = false;
  const newTunnelId = () => {
    let id;
    do id = `${myId}-${++tunnelCounter}`;
    while (tunnels.has(id)); // never append to someone else's (or an old) tunnel
    return id;
  };
  const flushTunnelPts = () => {
    if (pendingPts.length && curTunnel) net.send({ t: 'tp', id: curTunnel, pts: pendingPts, r: curTunnelR });
    pendingPts = [];
  };

  const sim: WormSim = new WormSim({
    tunnelStart: (r) => {
      curTunnel = newTunnelId();
      curTunnelR = r3(r);
      tunnels.get(curTunnel, r);
      net.send({ t: 'ts', id: curTunnel, r: r3(r) });
    },
    tunnelPoint: (pt) => {
      if (!curTunnel) return;
      tunnels.append(curTunnel, pt);
      pendingPts.push(r3(pt.x), r3(pt.y), r3(pt.z));
    },
    tunnelEnd: () => {
      flushTunnelPts();
      curTunnel = '';
    },
    hole: (h) => {
      holes.place(h);
      net.send({ t: 'h', h });
    },
    impact: (p, kind) => {
      impacts.burst(p, sim.L, kind === 'bite');
      sound.hit(kind === 'slam' ? 1.5 : 1.1, p, kind === 'bite' ? 'pop' : 'strokes');
      if (kind === 'swat') {
        // a swat from above: worms under it are lashed, critters knocked away
        const reach = 0.42 * sim.L;
        const now = performance.now();
        for (const [id, r] of remotes) {
          if (r.mode !== 'surface' || r.out || (stunnedUntil.get(id) ?? 0) > now || untouchable(id)) continue;
          if (r.disp.some((b) => b.distanceTo(p) < reach)) net.send({ t: 'lash', id });
        }
        if (isHost) antSim.swat(myId, false, p, reach);
        else net.send({ t: 'swat', at: [r3(p.x), r3(p.y), r3(p.z)], r: r3(reach) });
      }
      if (kind === 'slam') {
        const at = [r3(p.x), r3(p.y), r3(p.z)];
        net.send({ t: 'slam', at, r: r3(0.9 * sim.L) });
        if (isHost) antSim.slamAt(p, 0.9 * sim.L, myId);
      }
    },
    pitCrash: () => {
      // a peach's pit: untouchable a while (not again for 40 s)
      if (performance.now() - pitShieldAt < 40000) return;
      pitShieldAt = performance.now();
      shieldUntil = performance.now() + PIT_SHIELD_MS;
      toast('pitshield:');
    },
    down: () => {
      if (outTold) return;
      outTold = true;
      net.send({ t: 'out' });
      if ([...remotes.values()].filter((r) => !r.out).length >= 2) toast('out:');
    },
    flown: () => {
      sim.spawn(freeSpot()); // back in, away from everyone
      camInit = false;
    },
  });
  sim.growthRate = (WIN_SIZE_GAIN * 100) / winPoints;
  if (arena) sim.setArena(winPoints);

  const myView = makeWormView(0xe89a9a, scene);
  let myColor = o.color ?? 0xe89a9a;
  setLabel(myView, myName, myColor);
  sim.hollow = (p, r, d) => tunnels.hollowAt(p, r, d, curTunnel);
  const level: LevelName = (LEVELS as readonly string[]).includes(o.room.level ?? '') ? (o.room.level as LevelName) : 'medium';
  antSim.setDifficulty(level);
  sim.lossK = LEVEL[level].loss;

  // ---------- other worms ----------
  const remotes = new Map<string, Remote>();
  const players = new Map<string, { color: number; name: string; wins: number }>();
  let myWins = 0;
  const stunnedUntil = new Map<string, number>(); // bitten worms, by player id
  const removeRemote = (id: string) => {
    const r = remotes.get(id);
    if (!r) return;
    disposeWormView(r.view);
    remotes.delete(id);
  };
  /** The spot farthest from every worm we can see (for joining or coming back); bots avoid my worm too. */
  const freeSpot = (avoidMe = false) => {
    const others: THREE.Vector3[] = avoidMe ? [sim.head] : [];
    for (const r of remotes.values()) others.push(r.disp[N - 1]);
    return freeDir(others);
  };
  const nameOf = (id: string) => (id === myId ? myName : (players.get(id)?.name ?? DEFAULT_NAME));

  // bots run in this tab over their own connections
  const bots: Bot[] = [];
  const addBot = () => {
    // names in use: players, and our bots (two added at once aren't players yet)
    const taken = new Set([myName, ...[...players.values()].map((p) => p.name), ...bots.map((b) => b.name)]);
    const bot = new Bot(
      o.room.id,
      taken,
      (p, reach) => seeds?.hit(p, reach) ?? -1,
      () => freeSpot(true),
      (reason) => {
        if (reason === 'full') toast('full:');
        const i = bots.indexOf(bot);
        if (i >= 0) bots.splice(i, 1);
      },
      level,
    );
    bot.onImpact = (p, size, kind) => impacts.burst(p, size, kind === 'bite');
    bot.hollow = (p, r, d) => tunnels.hollowAt(p, r, d, bot.tunnelId);
    bot.setWinPoints(winPoints);
    if (arena) bot.setArena(winPoints);
    bot.webTouch = (disp, size) => webs.touches(disp, (i) => RADII[i] * girth(size) * 1.3 + 0.03);
    bots.push(bot);
  };
  let botsToAdd = o.bots ?? 0;
  const removeBots = () => {
    for (const b of bots) b.close();
    bots.length = 0;
  };

  const net = connectNet(
    o.room.id,
    myName,
    (m: NetMsg) => {
      switch (m.t) {
        case 'welcome': {
          roundStart = performance.now() - (Number(m.roundMs) || 0);
          roundEnd = m.roundOver ? performance.now() : 0;
          myId = m.id;
          later(600, () => {
            // joining mid-game: away from everyone (a returning winner already has a spot)
            if (sim.mode === 'surface' && sim.growth <= 1.001) {
              sim.spawn(freeSpot());
              camInit = false;
            }
            later(80, reveal);
          });
          myColor = m.color;
          setWormColor(myView, myColor);
          setLabel(myView, myName, myColor);
          for (const id of [...remotes.keys()]) removeRemote(id);
          players.clear();
          for (const p of m.players) players.set(p.id, { color: p.color, name: p.name || DEFAULT_NAME, wins: Number(p.wins) || 0 });
          tunnels.clear();
          holes.clear();
          for (const t of m.tunnels) tunnels.appendFlat(t.id, t.pts, t.r);
          for (const h of m.holes) holes.place(h);
          seeds?.setAll(m.seeds ?? []);
          drops.set(Array.isArray(m.drops) ? m.drops : []);
          isHost = m.host === myId;
          if (sim.mode === 'dig') {
            // reconnected inside: carry on in a new passage
            curTunnel = newTunnelId();
            curTunnelR = r3(0.2 * girth(sim.growth));
            tunnels.get(curTunnel, curTunnelR);
            net.send({ t: 'ts', id: curTunnel, r: curTunnelR });
          }
          updateHud({ players: players.size + 1 });
          if (botsToAdd) {
            const n = botsToAdd;
            while (bots.length > n) bots.pop()!.close();
            while (bots.length < n) addBot();
            botsToAdd = 0;
          }
          break;
        }
        case 'full':
        case 'noroom':
          net.close();
          o.onLeave(m.t);
          break;
        case 'join':
          players.set(m.id, { color: m.color, name: m.name || DEFAULT_NAME, wins: 0 });
          updateHud({ players: players.size + 1 });
          toast(`joined:${m.name || DEFAULT_NAME}`);
          break;
        case 'leave': {
          const p = players.get(m.id);
          players.delete(m.id);
          removeRemote(m.id);
          updateHud({ players: players.size + 1 });
          if (p) toast(`left:${p.name}`);
          break;
        }
        case 's': {
          let r = remotes.get(m.id);
          if (!r) {
            const p = players.get(m.id) ?? { color: 0xffffff, name: DEFAULT_NAME, wins: 0 };
            r = {
              view: makeWormView(p.color, scene),
              disp: Array.from({ length: N }, () => new THREE.Vector3()),
              target: Array.from({ length: N }, () => new THREE.Vector3()),
              from: Array.from({ length: N }, () => new THREE.Vector3()),
              recvAt: 0,
              every: 0.066,
              waveAt: 0,
              waveRate: 0,
              has: false,
              last: 0,
              mode: 'surface',
              size: 1,
              wave: -1,
              fx: -1,
              prevFx: -1,
              fxAt: 0,
              bornAt: time,
            };
            setLabel(r.view, p.name, p.color);
            remotes.set(m.id, r);
          }
          // how often updates come: the glide between two takes that long
          if (r.has) r.every = THREE.MathUtils.clamp(0.8 * r.every + (time - r.recvAt) * 0.2, 0.03, 0.25);
          r.recvAt = time;
          for (let k = 0; k < N; k++) {
            r.from[k].copy(r.disp[k]);
            r.target[k].set(m.p[k * 3], m.p[k * 3 + 1], m.p[k * 3 + 2]);
          }
          // first sight, or a jump (respawn, burrowing in): no glide
          if (!r.has || r.disp[N - 1].distanceTo(r.target[N - 1]) > 2.5 * (r.size || 1)) {
            r.disp.forEach((v, k) => v.copy(r!.target[k]));
            r.from.forEach((v, k) => v.copy(r!.target[k]));
          }
          r.has = true;
          r.last = time;
          r.mode = m.m === 'dig' || m.m === 'fly' ? m.m : 'surface';
          r.size = typeof m.g === 'number' ? m.g : 1;
          {
            const w = typeof m.w === 'number' ? m.w : -1;
            if (w >= 0 && r.wave >= 0 && w > r.wave && time > r.waveAt) r.waveRate = 0.7 * r.waveRate + ((w - r.wave) / (time - r.waveAt)) * 0.3;
            r.wave = w;
            r.waveAt = time;
          }
          r.prevFx = r.fx;
          r.fx = typeof m.fx === 'number' ? m.fx : -1;
          r.fxAt = time;
          r.stuck = !!m.k;
          r.seed = typeof m.sp === 'number' ? m.sp : 1;
          r.rear = !!m.rr;
          if (typeof m.hp === 'number') r.hp = m.hp;
          r.shield = !!m.iv;
          if (m.iv === 2) r.shieldEnding ??= performance.now();
          else r.shieldEnding = undefined;
          maybeConfetti(r.prevFx, r.fx, r.target, r.size);
          break;
        }
        case 'ts':
          tunnels.get(m.id, m.r || undefined);
          break;
        case 'tp':
          tunnels.appendFlat(m.id, m.pts);
          break;
        case 'h':
          holes.place(m.h);
          break;
        case 'bite': {
          if (untouchable(m.id)) break;
          stunnedUntil.set(m.id, performance.now() + (m.duration || 5000)); // shown in the player list
          {
            const body = bodyOf(m.id);
            if (body && (m.lash || m.by === 'pit' || m.by === 'chafer')) {
              impacts.burst(body.disp[N >> 1], 0.9 * body.size, false, body.disp[N >> 1]);
              sound.hit(0.9 * body.size, body.disp[N >> 1]);
            }
            else if (body && m.by !== 'spider') {
              // the pop where the biter's head hit
              const head = m.by === myId ? sim.head : remotes.get(m.by)?.disp[N - 1];
              let at = body.disp[N >> 1];
              if (head) {
                let bd = Infinity;
                for (const b of body.disp) {
                  const d = b.distanceToSquared(head);
                  if (d < bd) {
                    bd = d;
                    at = b;
                  }
                }
              }
              impacts.burst(at, 1.3 * body.size, true, at);
              if (m.by === myId) {
                sim.lunge(at);
                toast(`youbit:${nameOf(m.id)}`);
              }
            }
          }
          if (m.lash && m.by === myId) toast(`youlashed:${nameOf(m.id)}`);
          if (m.id === myId) {
            frozenUntil = performance.now() + (m.duration || 5000);
            // knocked away from what hit it (the chafer, a lash)
            const from = m.by === 'chafer' ? antView.chaferAt() : Array.isArray(m.from) ? new THREE.Vector3(m.from[0], m.from[1], m.from[2]) : null;
            if (from && sim.mode === 'surface') {
              const mid = sim.disp[N >> 1];
              const away = new THREE.Vector3().subVectors(mid, from);
              const up = mid.clone().normalize();
              away.addScaledVector(up, -away.dot(up));
              if (away.lengthSq() < 1e-6) away.set(1, 0, 0).addScaledVector(up, -up.x);
              sim.spawn(mid.clone().addScaledVector(away.normalize(), 1.6 * sim.L));
              sim.jump();
            }
            if (arena && m.by === 'chafer') sim.slay();
            else if (m.by !== 'spider' && m.by !== 'pit' && m.by !== 'chafer') sim.addPoints(-10);
            toast(m.by === 'spider' ? 'stung:' : m.by === 'pit' ? 'pit:' : m.by === 'chafer' ? (arena ? 'chaferkill:' : 'chafer:') : `${m.lash ? 'lashed' : 'bitten'}:${nameOf(m.by)}`);
          }
          break;
        }
        case 'earwig': {
          if (untouchable(m.id)) break;
          const body = bodyOf(m.id);
          if (m.how === 'drop') {
            if (m.id === myId) {
              dropFromEarwig();
              earwigShakes = 0;
            }
            break;
          }
          if (body) impacts.burst(body.disp[N >> 1], 1.2 * body.size, m.how === 'bite', body.disp[N >> 1]);
          if (m.how === 'bite') panicOf.set(m.id, performance.now() + 5000);
          if (m.id === myId) {
            sim.addPoints(-(Number(m.pts) || 0));
            if (m.how === 'bite') {
              panicUntil = performance.now() + 5000;
              panicMul = 1.5;
              webShakes = 0;
            }
            if (m.how === 'grab') {
              earwigShakes = EARWIG_SHAKES;
              earwigHeldAt = performance.now();
              sim.held = true;
            }
            toast(`${m.how === 'drill' ? 'earwigdrill' : m.how === 'grab' ? 'earwiggrab' : 'earwig'}:${m.pts}`);
          }
          break;
        }
        case 'antbite': {
          if (untouchable(m.id)) break;
          const body = bodyOf(m.id);
          if (body) {
            const b = body.disp[Math.min(N - 1, Math.max(0, Number(m.k) || 0))];
            impacts.burst(b, 0.6 * body.size, true, b);
          }
          panicOf.set(m.id, performance.now() + (m.duration || 3000));
          if (m.id === myId) {
            sim.addPoints(-5);
            panicUntil = performance.now() + (m.duration || 3000);
            panicMul = 1.5;
            webShakes = 0;
            webFreeUntil = panicUntil + 1000;
            toast('antbit:');
          }
          break;
        }
        case 'sting':
          if (untouchable(m.id)) break;
          stunnedUntil.set(m.id, performance.now() + (m.duration || 5000));
          panicOf.set(m.id, performance.now() + (m.duration || 5000));
          {
            const body = bodyOf(m.id);
            if (body) {
              const b = body.disp[Math.min(N - 1, Math.max(0, Number(m.k) || 0))];
              impacts.burst(b, 0.8 * body.size, true, b);
            }
          }
          if (m.id === myId) {
            // the spider sucks out 25 points; then panic
            sim.loseGrowth((25 * WIN_SIZE_GAIN) / winPoints);
            panicUntil = performance.now() + (m.duration || 5000);
            panicMul = 2;
            webShakes = 0;
            webFreeUntil = panicUntil + 1500;
            toast('stung:');
          }
          break;
        case 'reset':
          for (const r of remotes.values()) {
            r.size = 1;
            r.out = false;
            if (arena) r.hp = winPoints;
          }
          seeds?.setAll([]);
          wipeRound();
          {
            const order: string[] = Array.isArray(m.order) ? m.order : [];
            const i = order.indexOf(myId);
            restartRound(i >= 0 ? slotDir(i, order.length, Number(m.rot) || 0) : undefined);
          }
          if (m.after !== 'win') toast(`reset:${m.by || DEFAULT_NAME}`);
          updateHud({ countdown: Date.now() });
          frozenUntil = performance.now() + COUNTDOWN_MS; // nobody moves until START
          break;
        case 'ready':
          updateHud({ readyN: Number(m.n) || 0, readyOf: Number(m.of) || 0, goAt: Date.now() + (Number(m.left) || 0) });
          break;
        case 'host':
          isHost = m.id === myId;
          if (!isHost) antSim.clear();
          break;
        case 'ants':
          if (!isHost) antView.apply(m.a);
          if (!isHost && m.w) webs.set(m.w);
          if (!isHost && m.wd) webs.add(m.wd);
          break;
        // the host simulates the critters: what the others did to them
        case 'shake':
          if (isHost) antSim.shake(m.id);
          break;
        case 'swat':
          if (isHost && m.clap) antSim.clap(m.id);
          else if (isHost && Array.isArray(m.at)) antSim.swat(m.id, false, new THREE.Vector3(m.at[0], m.at[1], m.at[2]), Number(m.r) || 1);
          else if (isHost) antSim.swat(m.id, !!m.bite);
          break;
        case 'free':
          if (isHost && m.one) antSim.dropOne(m.id);
          else if (isHost) antSim.release(m.id);
          break;
        case 'ride':
          if (isHost) antSim.ride(m.id, m);
          break;
        case 'ramat':
          if (isHost && Array.isArray(m.at)) antSim.ramAt(new THREE.Vector3(m.at[0], m.at[1], m.at[2]), Number(m.r) || 1);
          break;
        case 'slam':
          if (isHost && Array.isArray(m.at)) antSim.slamAt(new THREE.Vector3(m.at[0], m.at[1], m.at[2]), Number(m.r) || 1, m.id);
          break;
        case 'unseat': {
          // someone was knocked off the chafer
          const seat = antView.chaferSeat(m.id);
          if (seat) {
            const disp = m.id === myId ? sim.disp : remotes.get(m.id)?.disp;
            impacts.burst(seat.at, 0.7 * SPECS[CHAFER].len, false, disp?.[N - 1]);
          }
          if (isHost) antSim.unseat(m.id);
          if (m.id === myId) getOffChafer();
          if (m.by === myId) toast(`youlashed:${nameOf(m.id)}`);
          break;
        }
        case 'seed':
          seeds?.setEaten(m.i, true);
          if (m.i === seedPending) seedPending = -1;
          if (m.by === myId) {
            shieldUntil = performance.now() + SHIELD_MS;
            toast('shield:');
          }
          break;
        case 'seeds':
          seeds?.setAll(m.eaten);
          break;
        case 'dropAdd':
          if (m.drop) drops.add(m.drop);
          break;
        case 'drop': {
          const at = drops.where(m.id);
          if (at) impacts.burst(at.clone().addScaledVector(at.clone().normalize(), 0.15), 0.5);
          drops.pick(m.id);
          if (m.id === dropPending) dropPending = -1;
          if (m.by === myId) {
            if (arena) {
              sim.drink();
              toast('dropgrow:');
            } else {
              boosts.push({ until: performance.now() + 10000, add: 1 });
              toast('water:');
            }
          }
          break;
        }
        case 'out':
          if (m.id === myId) {
            if (!sim.down) sim.slay();
          } else {
            const r = remotes.get(m.id);
            if (r) {
              r.out = true;
              r.hp = 0;
            }
          }
          break;
        case 'win': {
          const winner = m.name || nameOf(m.id);
          const me = m.id === myId;
          roundOver = true;
          winnerId = m.id;
          roundEnd = performance.now();
          if (Number(m.roundMs) > 0) roundStart = roundEnd - Number(m.roundMs);
          if (me) myWins = Number(m.wins) || myWins + 1;
          else {
            const p = players.get(m.id);
            if (p) p.wins = Number(m.wins) || p.wins + 1;
          }
          toast(arena ? (me ? 'arenawinMe:' : `arenawin:${winner}`) : `win:${winner}`);
          // the board keeps the final points (the winner: the goal) until the next round
          if (arena) {
            roundResults = new Map([[myId, Math.round(sim.life)]]);
            for (const [id, r] of remotes) roundResults.set(id, r.out ? 0 : Math.round(r.hp ?? winPoints));
          } else {
            roundResults = new Map([[myId, score(sim.growth)]]);
            for (const [id, r] of remotes) roundResults.set(id, score(r.size));
            roundResults.set(m.id, winPoints);
          }
          if (!arena) for (const [id, r] of remotes) if (id !== m.id) r.size = 1;
          wipeRound();
          if (me) sim.startVictory(camera.position.clone().sub(sim.head));
          else {
            if (!arena) sim.resetGrowth();
            followWinner = { id: m.id, until: time + 4.6 }; // watch the winner fly off
          }
          later(3300, startOverview);
          later(4600, () => updateHud({ winner, winnerMe: me, end: arena ? 'arena' : 'win' }));
          break;
        }
        case 'wipe':
          // the arena, alone all round: no life left, no winner
          roundOver = true;
          winnerId = '';
          roundEnd = performance.now();
          if (Number(m.roundMs) > 0) roundStart = roundEnd - Number(m.roundMs);
          toast('wipe:');
          roundResults = new Map([[myId, 0]]);
          wipeRound();
          later(400, startOverview);
          later(1200, () => updateHud({ winner: '', winnerMe: false, end: 'wipe' }));
          break;
      }
    },
    (s) => {
      netStatus = s;
      updateHud({ net: s });
    },
    false,
    o.color,
  );

  /** The key that lets me close this room (I made it): it also lets me start the next round at once. */
  function roomKey(): string {
    try {
      return JSON.parse(localStorage.getItem('wormRoomKeys') || '{}')[o.room.id] ?? '';
    } catch {
      return '';
    }
  }
  updateHud({ canStartNow: !!roomKey(), light });

  /** A worm's body as this client draws it. */
  function bodyOf(id: string) {
    if (id === myId) return { disp: sim.disp, size: sim.growth };
    const r = remotes.get(id);
    return r ? { disp: r.disp, size: r.size } : null;
  }

  // ---------- input ----------
  const keys: Record<string, boolean> = {};
  let mouseDX = 0;
  let mouseDY = 0;
  let mouseHeld = false; // left button: crawl / gnaw forward
  let noPointerLock = false; // the browser refused it: steer with the mouse unlocked
  let zoom = DEFAULT_ZOOM;
  let orbit = 0; // ←/→: the camera round the worm
  let camTilt = 0;
  let orbitAt = -10; // when ←/→ was last used (it then drifts back behind the worm)
  let lastClickAt = 0;
  let lastWAt = 0;
  /** The nearest critter in front of my head (within reach, at least cosMin ahead), or null. */
  const critterAhead = (reach: number, cosMin: number, ok?: (kind: number) => boolean) => {
    if (sim.mode !== 'surface') return null;
    let best: { p: THREE.Vector3; r: number; kind: number } | null = null;
    let bd = Infinity;
    for (const c of antView.critters(myId)) {
      if (ok && !ok(c.kind)) continue;
      tmpAhead.subVectors(c.p, sim.head);
      const d = tmpAhead.length() - c.r;
      if (d > reach || d >= bd || tmpAhead.normalize().dot(sim.f) < cosMin) continue;
      best = c;
      bd = d;
    }
    return best;
  };
  const tmpAhead = new THREE.Vector3();

  /**
   * Right click / Alt: on the chafer, a bite (it bolts; on the run: a lash with the tail spurs it);
   * in the earwig's pincers, a jerk; inside, a squeeze; in a web, a jerk; held by two ladybugs, a clap;
   * held by one, a lash (a big worm: a slam); in the air, a backflip; standing on the tail, a swat
   * from above; ants on me, a shake; else a bite at a critter ahead or a swipe of the tail.
   */
  const hit = () => {
    if (riding) {
      if (sim.rideAt?.running) sim.rideLash();
      ride({ bite: true });
      return;
    }
    if (earwigShakes > 0) {
      sim.shake();
      if (--earwigShakes === 0) freeFromEarwig();
      return;
    }
    if (sim.mode === 'dig') {
      if (antsOnMe <= 0) return;
      sim.squeeze();
      sound.crunch(undefined, 3, 0.3);
      if (isHost) antSim.shake(myId);
      else net.send({ t: 'shake' });
      return;
    }
    if (sim.mode !== 'surface') return;
    let what: 'shake' | 'swat' = 'shake';
    let bite = false;
    if (!gripOnMe && webShakes) {
      sim.shake();
      sound.twang(sim.head, 0.22);
      if (--webShakes === 0) webFreeUntil = performance.now() + 2500;
      return;
    }
    if (gripOnMe && antView.ladybugsBoth(myId)) {
      if (sim.clap()) later(200, () => (isHost ? antSim.clap(myId) : net.send({ t: 'swat', clap: true })));
      return;
    }
    if (gripOnMe) {
      if (winProgress(sim.growth) >= BIG_AT) {
        if (sim.slam(gripOnMe)) {
          slamDoneAt = performance.now() + 446;
          sound.whoosh(1.5);
        }
        return;
      } else if (!sim.whip(gripOnMe === 'head' ? 'tail' : 'head', gripOnMe === 'head')) return;
      sound.whoosh(1);
    } else if (sim.backflip()) {
      sound.whoosh(0.8);
      return;
    } else if (sim.rear > 0.55) {
      sim.flySwat(swatTargets());
      sound.whoosh(1.2);
      return;
    } else if (antsOnMe > 0) {
      sim.shake();
      sound.whoosh(0.45);
    } else {
      const c = critterAhead(1.1 * sim.L, 0.55);
      bite = !!c;
      if (c) sim.lunge(c.p);
      else sim.swipe();
      sound.whoosh(1);
      what = 'swat';
      // a worm at my tail end gets lashed
      const victim = (() => {
        if (sim.mode !== 'surface') return '';
        const reach = girth(sim.growth);
        let id = '';
        let bd = Infinity;
        for (const [rid, r] of remotes) {
          if (r.mode !== 'surface' || (stunnedUntil.get(rid) ?? 0) > performance.now()) continue;
          for (let k = 0; k < 5; k++) {
            for (const b of r.disp) {
              const d = b.distanceTo(sim.disp[k]);
              if (d < reach && d < bd) {
                bd = d;
                id = rid;
              }
            }
          }
        }
        return id;
      })();
      if (victim) net.send({ t: 'lash', id: victim });
    }
    if (isHost) {
      if (what === 'swat') antSim.swat(myId, bite);
      else antSim.shake(myId);
    } else net.send(what === 'swat' ? { t: 'swat', bite } : { t: what });
  };

  /** Standing on the tail: what to swat from above — critters and worms round me (in random order), or a random spot. */
  const swatTargets = () => {
    const reach = 1.22 * sim.L;
    const root = sim.disp[1];
    const out: THREE.Vector3[] = [];
    for (const c of antView.critters(myId)) if (c.p.distanceTo(root) <= reach + c.r) out.push(c.p.clone());
    const now = performance.now();
    for (const [id, r] of remotes) {
      if (r.mode !== 'surface' || r.out || (stunnedUntil.get(id) ?? 0) > now) continue;
      let best: THREE.Vector3 | null = null;
      let bd = reach;
      for (const b of r.disp) {
        const d = b.distanceTo(root);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (best) out.push(best.clone());
    }
    for (let i = out.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [out[i], out[j]] = [out[j], out[i]];
    }
    /** A little off the point, at random (not every swat lands the same). */
    const jitter = (p: THREE.Vector3, d: number) => {
      appleNormal(p, tmp2);
      const a = tmpAhead.crossVectors(tmp2, sim.f);
      if (a.lengthSq() < 1e-8) a.set(1, 0, 0);
      a.normalize();
      const b = tmpP.crossVectors(a, tmp2).normalize();
      const ang = Math.random() * Math.PI * 2;
      p.addScaledVector(a, Math.cos(ang) * d).addScaledVector(b, Math.sin(ang) * d);
      appleProject(p);
    };
    if (out.length) for (const p of out) jitter(p, sim.L * (0.05 + Math.random() * 0.1));
    else {
      const ang = Math.random() * Math.PI * 2;
      const d = sim.L * (0.55 + Math.random() * 0.62);
      appleNormal(root, tmp2);
      const a = tmpAhead.crossVectors(tmp2, sim.f);
      if (a.lengthSq() < 1e-8) a.set(1, 0, 0);
      a.normalize();
      const b = tmpP.crossVectors(a, tmp2).normalize();
      const p = root.clone().addScaledVector(b, Math.cos(ang) * d).addScaledVector(a, Math.sin(ang) * d);
      appleProject(p);
      out.push(p);
    }
    return out;
  };

  /**
   * Double click / WW: inside, a rocket (out); on the chafer, dive off its back into the skin; at
   * the top of a leap out, the dolphin dive back in; on the skin, burrow in (from a jump: head first;
   * the arena: a strike through the fruit) — unless something holds me.
   */
  const dig = () => {
    const now = performance.now();
    if (sim.mode === 'dig' && now > frozenUntil && earwigShakes === 0) {
      if (sim.rocket()) {
        rammed.clear();
        toast('rocket:');
        dropOneAt = 0;
      }
      return;
    }
    if (riding) {
      const seat = antView.chaferSeat(myId) ?? sim.rideAt;
      riding = false;
      sim.rideAt = null;
      ride({ off: true, scoot: true });
      if (!sim.diveHere(seat?.f, seat?.up, true)) sim.startDig();
      return;
    }
    if (sim.dive()) {
      toast('dive:');
      return;
    }
    if (sim.mode !== 'surface') return;
    const why = earwigShakes > 0 ? 'earwig' : gripOnMe ? 'grip' : antView.antsOnHead(myId) > 0 ? 'ants' : webShakes ? 'web' : now < frozenUntil ? 'frozen' : '';
    if (why) {
      toast(`nodig:${why}`);
      return;
    }
    if (arena) {
      if (sim.arenaStrike()) toast('strike:');
      return;
    }
    if (!sim.burrowFromJump()) sim.startDig();
  };

  const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (down && e.code === 'Escape') {
      releaseInput();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      return;
    }
    if (e.code === 'AltLeft' || e.code === 'AltRight') {
      e.preventDefault(); // not the browser's menu
      if (down && !e.repeat && !o.uiBlocked()) hit();
      return;
    }
    if (down && (o.uiBlocked() || e.target instanceof HTMLInputElement)) return;
    if (GAME_KEYS.includes(e.code)) e.preventDefault();
    if (down && !e.repeat && e.code === 'KeyM') {
      sound.toggleMute();
      return;
    }
    if (down && !e.repeat && e.code === 'KeyN') {
      e.preventDefault();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      for (const k in keys) keys[k] = false;
      o.openSettings();
      return;
    }
    keys[e.code] = down;
    // WW: dig (a double tap of W)
    if (down && !e.repeat && e.code === 'KeyW') {
      const now = performance.now();
      if (now - lastWAt < DOUBLE_CLICK_MS) {
        lastWAt = 0;
        dig();
      } else lastWAt = now;
    }
    if (down && !e.repeat && e.code === 'KeyB') {
      // bots not yet in count too
      const joining = bots.reduce((n, b) => n + +!b.serverId, 0);
      if (players.size + 1 + joining >= o.room.max) toast('full:');
      else addBot();
    }
    if (down && !e.repeat && e.code === 'KeyX') xray = !xray;
    if (down && !e.repeat && e.code === 'KeyT') nextLight();
    if (down && !e.repeat && e.code === 'Space' && riding) getOffChafer();
    else if (down && !e.repeat && e.code === 'Space' && !gripOnMe && !webShakes && earwigShakes === 0 && sim.mode === 'surface' && antView.chaferNear(sim.head, 2.2) !== null) {
      // the chafer right here: up onto its back (free of whatever held me)
      riding = true;
      earwigShakes = 0;
      sim.held = false;
      sim.heldAt = null;
      webShakes = 0;
      gripOnMe = null;
      frozenUntil = 0;
      panicUntil = 0;
      dragged = 0;
      stunnedUntil.delete(myId);
      panicOf.delete(myId);
      lastClickAt = 0;
      orbit = 0;
      camTilt = 0;
      rideStartAt = performance.now();
      ride({ on: true });
      toast('chaferon:');
    } else if (down && !e.repeat && e.code === 'Space' && !gripOnMe && !webShakes) sim.jump();
    if (down && !e.repeat && e.code === 'KeyV') {
      orbit = 0;
      camTilt = 0;
      zoom = DEFAULT_ZOOM;
    }
  };
  const onKeyDown = onKey(true);
  const onKeyUp = onKey(false);
  const releaseInput = () => {
    mouseHeld = false;
    mouseDX = mouseDY = 0;
    lastClickAt = 0;
    lastWAt = 0;
    rideTurn = 0;
    for (const k in keys) keys[k] = false;
  };
  const listeners: [EventTarget, string, (e: never) => void, AddEventListenerOptions?][] = [
    [
      document,
      'mousemove',
      (e: MouseEvent) => {
        if (o.uiBlocked()) return;
        if (document.pointerLockElement === canvas || mouseHeld) {
          mouseDX += e.movementX;
          mouseDY += e.movementY;
        }
      },
    ],
    [
      canvas,
      'mousedown',
      (e: MouseEvent) => {
        if (o.uiBlocked()) return;
        if (e.button === 2) return hit();
        if (e.button !== 0) return;
        if (document.pointerLockElement !== canvas && !noPointerLock) {
          try {
            const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
            p?.catch?.(() => (noPointerLock = true));
          } catch {
            noPointerLock = true;
          }
        }
        mouseHeld = true;
        if (riding) {
          lastClickAt = 0;
          return;
        }
        // a double click: dig
        const now = performance.now();
        const dbl = now - lastClickAt < DOUBLE_CLICK_MS;
        lastClickAt = dbl ? 0 : now;
        if (dbl) dig();
      },
    ],
    [
      window,
      'mouseup',
      (e: MouseEvent) => {
        if (e.button === 0) mouseHeld = false;
      },
    ],
    [window, 'keydown', onKeyDown],
    [window, 'keyup', onKeyUp],
    [
      canvas,
      'wheel',
      (e: WheelEvent) => {
        zoom = Math.min(25, Math.max(0.5, zoom * Math.exp(e.deltaY * 0.0012)));
      },
      { passive: true },
    ],
    [canvas, 'contextmenu', (e: Event) => e.preventDefault()],
    [window, 'blur', releaseInput],
    [
      window,
      'resize',
      () => {
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      },
    ],
    [
      document,
      'pointerlockchange',
      () => {
        if (document.pointerLockElement === canvas) noPointerLock = false;
        else releaseInput();
      },
    ],
  ];
  for (const [t, ev, fn, opt] of listeners) t.addEventListener(ev, fn as EventListener, opt);

  // ---------- held, dragged, wagged ----------
  let dragged = 0; // ants dragging me (smoothed: + by the head, − by the tail)
  let wagT = 0; // a ladybug just grabbed me: I'm wagged a moment
  let pullLeft = 0; // a ladybug let go of me: I spring back a bit
  let pullHead = true;
  let grabPull = 0; // …and as it grabs, it pulls me in
  let clapDir = 1; // two ladybugs: they tug me one way, then the other
  let clapT = 0;
  let clapPull = 0;
  let movingForward = false;

  // ---------- camera ----------
  const camPos = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const camQ = new THREE.Quaternion();
  const look = new THREE.Vector3();
  const wantPos = new THREE.Vector3();
  const camFwd = new THREE.Vector3(); // where the camera faces (the worm's heading, smoothed)
  const rideLast = new THREE.Vector3();
  let wasRiding = false;
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  let camInit = false;
  let tauntZoom = 1; // standing on the tail the camera backs off (not while a spider is taunted: close up)
  let followWinner: { id: string; until: number } | null = null;
  const clock = new THREE.Clock();
  let raf = 0;
  let sendT = 0;
  let flushT = 0;
  let frames = 0;
  let fpsT = 0;
  // a hidden tab gets no animation frames: a worker ticks the game on (5 times a second)
  const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 200);'], { type: 'text/javascript' })));

  /** This frame's input (keys, mouse), with everything that overrides it (panic, held, the chafer…). */
  function readInput(dt: number): SimInput {
    const dx = mouseDX;
    const dy = mouseDY;
    mouseDX = mouseDY = 0;
    const turnKeys = +!!keys.KeyD - +!!keys.KeyA;
    const fwd = !!keys.KeyW || mouseHeld;
    movingForward = fwd;
    const inp: SimInput = {
      turn: -(dx * (sim.mode === 'dig' ? 0.003 : 0.0035) + turnKeys * 1.2 * dt),
      pitch: sim.mode === 'dig' ? -dy * 0.003 : 0,
      forward: fwd,
      speed: boostFactor() * antsDrag(antsOnMe),
      rear: !!keys.KeyS,
    };
    if (performance.now() < panicUntil && sim.mode !== 'fly') {
      // panicking: runs wild, can only steer
      inp.forward = true;
      inp.speed = (inp.speed ?? 1) * panicMul;
      inp.rear = false;
    }
    movingForward = inp.forward;
    // a rocket shakes the ants off me one by one, and lets go of them all when it ends
    if (sim.rocketing && antsOnMe > 0 && time - dropOneAt > 0.11) {
      dropOneAt = time;
      if (isHost) antSim.dropOne(myId);
      else net.send({ t: 'free', one: true });
    }
    if (wasRocketing && !sim.rocketing) {
      if (isHost) antSim.release(myId);
      else net.send({ t: 'free' });
    }
    wasRocketing = sim.rocketing;
    if (sim.rocketing) {
      // ramming: worms in the way (inside; the arena: anywhere) and critters
      const head = sim.head;
      for (const [id, r] of remotes) {
        if (rammed.has(id) || r.out || (!arena && r.mode !== 'dig')) continue;
        if (r.disp.some((b) => b.distanceTo(head) < 0.45 * sim.L)) {
          rammed.add(id);
          net.send({ t: 'ram', id });
        }
      }
      if (time - ramAt > 0.12) {
        ramAt = time;
        const at = [r3(head.x), r3(head.y), r3(head.z)];
        if (isHost) antSim.ramAt(head, 0.6 * sim.L);
        else net.send({ t: 'ramat', at, r: r3(0.6 * sim.L) });
      }
    }
    if (riding) {
      // on the chafer: the mouse / A, D steer it (sent ten times a second)
      sim.rideAt = antView.chaferSeat(myId);
      if (!sim.rideAt && performance.now() - rideStartAt > 1500) getOffChafer();
      rideTurn += inp.turn;
      inp.turn = 0;
      inp.forward = false;
      inp.rear = false;
      if (time - rideSentAt > 0.1) {
        rideSentAt = time;
        if (rideTurn) ride({ turn: rideTurn });
        rideTurn = 0;
      }
    } else sim.rideAt = null;
    sim.heldAt = earwigShakes > 0 ? antView.earwigGrip(sim.disp[N >> 1]) : null;
    if (earwigShakes > 0 && (performance.now() - earwigHeldAt > 13000 || sim.mode !== 'surface')) freeFromEarwig();
    if (sim.down || performance.now() < frozenUntil || gripOnMe || webShakes || earwigShakes > 0) {
      inp.forward = false;
      inp.turn = inp.pitch = 0;
    }
    // a ladybug or a spider right in front of my head: I can't crawl through it
    if (inp.forward && !inp.rear && critterAhead(RADII[N - 1] * girth(sim.growth) * 1.1, 0.2, (k) => k !== ANT)) inp.forward = false;
    return inp;
  }

  /** The camera: behind and above the worm (orbit, zoom), following the chafer it rides; the winner's flight; the intro and the overview. */
  function updateCamera(dt: number) {
    const seat = riding && sim.mode === 'surface' ? sim.rideAt : null;
    const at = seat ? seat.at : sim.head;
    const fwd = seat ? seat.f : sim.f;
    const up = seat ? seat.up : sim.n;
    const L = seat ? Math.max(sim.L, 0.8 * SPECS[CHAFER].len) : sim.L;
    // riding: the camera moves with the chafer at once (no lag)
    if (seat && wasRiding) camPos.add(tmp.subVectors(seat.at, rideLast));
    if (seat) rideLast.copy(seat.at);
    wasRiding = !!seat;
    orbit += (+!!keys.ArrowRight - +!!keys.ArrowLeft) * 1.8 * dt;
    if (keys.ArrowRight || keys.ArrowLeft) orbitAt = time;
    // moving: the camera drifts back behind the worm
    if ((keys.KeyW || mouseHeld || seat?.running) && time - orbitAt > 1) orbit = Math.atan2(Math.sin(orbit), Math.cos(orbit)) * Math.exp(-0.9 * dt);
    zoom = Math.min(25, Math.max(0.5, zoom * Math.exp((+!!keys.ArrowDown - +!!keys.ArrowUp) * 1.3 * dt)));
    let camUpWant: THREE.Vector3;
    if (sim.mode === 'dig') {
      tmp.set(0, 0, 0).addScaledVector(sim.d, -2.2 * zoom * L).addScaledVector(sim.u, 1.6 * zoom * L).applyAxisAngle(sim.u, orbit);
      wantPos.copy(at).add(tmp);
      look.copy(at).addScaledVector(sim.d, 0.4 * Math.cos(orbit));
      camUpWant = sim.u;
    } else {
      if (camFwd.lengthSq() < 0.5) camFwd.copy(fwd);
      camFwd.lerp(fwd, damp(dt, seat ? 8 : 1.8));
      camFwd.addScaledVector(up, -camFwd.dot(up)).normalize();
      tauntZoom += (+!antView.spiderTaunting(myId) - tauntZoom) * damp(dt, 2.5);
      const dist = zoom * L * (1 + 1.1 * sim.rear * tauntZoom);
      const el = 0.55 + camTilt;
      tmp.set(0, 0, 0).addScaledVector(up, 3.05 * Math.sin(el) * dist).addScaledVector(camFwd, -3.05 * Math.cos(el) * dist).applyAxisAngle(up, orbit);
      wantPos.copy(at).add(tmp);
      look.copy(at).addScaledVector(up, 0.08 * zoom);
      camUpWant = up;
      if (sim.mode === 'fly') {
        // my victory flight: in front of me, looking at me; then it stays and watches me go
        const flyUp = sim.flyUpDir;
        if (sim.fx > 3.2) wantPos.copy(camPos);
        else wantPos.copy(at).addScaledVector(flyUp, +L).addScaledVector(sim.flyFacing, 3.8 * L);
        look.copy(at);
        camUpWant = flyUp;
      }
    }
    // watching the winner fly off
    const w = followWinner && time < followWinner.until ? remotes.get(followWinner.id) : undefined;
    if (w) {
      const head = w.disp[N - 1];
      const out = tmp2.copy(head).normalize();
      const s = +w.size;
      if (w.fx > 3.2) wantPos.copy(camPos);
      else {
        tmp.subVectors(camPos, head);
        tmp.addScaledVector(out, -tmp.dot(out));
        if (tmp.lengthSq() < 1e-6) tmp.set(1, 0, 0);
        wantPos.copy(head).addScaledVector(out, 1.2 * s).addScaledVector(tmp.normalize(), 3.8 * s);
      }
      look.copy(head);
      camUpWant = w.fx >= 0 ? out.clone() : camUpWant;
    }
    if (!camInit) {
      camPos.copy(wantPos);
      camUp.copy(camUpWant);
      camInit = true;
    }
    // on the skin the camera stays a little above it
    if (sim.mode !== 'dig') {
      for (let i = 0; i < 3; i++) {
        const f = appleF(wantPos);
        if (f >= 0.35) break;
        appleNormal(wantPos, tmp2);
        wantPos.addScaledVector(tmp2, 0.35 - f);
      }
    }
    camPos.lerp(wantPos, damp(dt, seat ? 8 : 3));
    if (sim.mode !== 'dig') {
      for (let i = 0; i < 3; i++) {
        const f = appleF(camPos);
        if (f >= 0.35) break;
        appleNormal(camPos, tmp2);
        camPos.addScaledVector(tmp2, 0.35 - f);
      }
    }
    pushOutOfPit(camPos, 0.4);
    camUp.lerp(camUpWant, damp(dt, seat ? 8 : 3)).normalize();
    if (overview) {
      // after a win: drift back to the whole fruit
      const k = Math.min(1, (time - overview.at) / OVERVIEW_FLY);
      const e = smoother(k);
      const wide = tmp2.copy(overview.side).multiplyScalar(3.3 * R0).setY(0.35 * R0);
      camera.position.lerpVectors(overview.fromPos, wide, e);
      mtx.lookAt(wide, WIDE_LOOK, Y_UP);
      camQ.setFromRotationMatrix(mtx);
      camera.quaternion.slerpQuaternions(overview.fromQ, camQ, e);
      camPos.copy(camera.position);
      return;
    }
    const it = time - introAt;
    if (it < INTRO_HOLD + INTRO_FLY) {
      // the opening shot: the whole fruit, then a swoop down to the worm (a new round: from where it was)
      const k = Math.min(1, Math.max(0, it - INTRO_HOLD) / INTRO_FLY);
      const e = smoother(k);
      if (introFrom) {
        mtx.lookAt(camPos, look, camUp);
        camQ.setFromRotationMatrix(mtx);
        camera.position.lerpVectors(introFrom.pos, camPos, e);
        camera.quaternion.slerpQuaternions(introFrom.q, camQ, e);
        return;
      }
      const side = tmp.set(at.x, 0, at.z);
      if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
      side.normalize();
      const wide = tmp2.copy(side).multiplyScalar(3.3 * R0).setY(0.35 * R0);
      camera.position.lerpVectors(wide, camPos, e);
      const lookAt = new THREE.Vector3().lerpVectors(WIDE_LOOK, look, e);
      const upNow = new THREE.Vector3(0, 1, 0).lerp(camUp, e).normalize();
      mtx.lookAt(camera.position, lookAt, upNow);
      camera.quaternion.setFromRotationMatrix(mtx);
      return;
    }
    camera.position.copy(camPos);
    mtx.lookAt(camPos, look, camUp);
    camQ.setFromRotationMatrix(mtx);
    camera.quaternion.slerp(camQ, damp(dt, 7));
  }

  /** The other worms: glide to their last positions, pose, glow, shimmer; hide and seek through the skin. */
  function updateRemotes() {
    for (const [id, r] of remotes) {
      if (time - r.last > 10) {
        removeRemote(id); // gone quiet
        continue;
      }
      const flying = r.mode === 'fly' || sim.mode === 'fly';
      r.view.group.visible = true;
      const k = Math.min(1, (time - r.recvAt) / r.every);
      for (let i = 0; i < N; i++) r.disp[i].lerpVectors(r.from[i], r.target[i], k);
      const fx = r.fx >= 0 ? r.fx + (time - r.fxAt) : -1;
      const wave = r.wave >= 0 ? r.wave + r.waveRate * Math.min(time - r.waveAt, 0.25) : -1;
      const born = Math.min(1, (time - (r.bornAt ?? -9)) / 0.6); // it pops up out of the skin
      poseWorm(
        r.view,
        r.disp,
        null,
        r.size * (born < 1 ? 0.05 + 0.95 * (1 - (1 - born) ** 3) : 1),
        wave,
        fx,
        (panicOf.get(id) ?? 0) > performance.now() ? GULP_PANIC : 1,
        afterPanic(panicOf.get(id) ?? 0),
      );
      setStunGlow(r.view, stunnedUntil.get(id) ?? 0);
      setRainbow(r.view, !!r.shield && (!r.shieldEnding || shieldShown(2000 - (performance.now() - r.shieldEnding))), players.get(id)?.color ?? 0xe89a9a);
      // hide and seek: inside I see only what's inside (and the parts of others in the flesh), outside what's outside
      const inside = sim.mode === 'dig';
      for (let i = 0; i < N; i++) {
        const out = appleF(r.disp[i]) > 0;
        r.view.segs[i].visible = flying || (r.mode === sim.mode && (r.mode !== 'dig' || !out)) || out !== inside;
      }
      if (r.view.label) r.view.label.visible = r.view.segs[N - 1].visible;
      placeLabel(r.view, r.disp[N - 1], tmp2.copy(r.disp[N - 1]).normalize(), r.size);
    }
  }

  /** The frame's sounds: crossing in and out, chewing, ants at me, the web, critters' voices and wings, gnats, crickets. */
  function playSounds(dt: number) {
    sound.listen(camera);
    if (sim.mode !== soundMode) {
      if (sim.mode === 'dig' && soundMode === 'surface') sound.crunch(undefined, 5, 0.45);
      else if (soundMode === 'dig') sound.pop();
      else if (soundMode === 'fly' && sim.mode === 'surface') sound.thud(undefined, 0.8);
      soundMode = sim.mode;
    }
    // gnawing through the flesh: a soft crunch every half second, more often the faster I go
    chewIn -= dt;
    if (sim.mode === 'dig') {
      const pace = sim.head.distanceTo(soundHead) / Math.max(dt, 1e-3) / (DIG_SPEED * sim.growth);
      if (pace > 0.2 && chewIn <= 0) {
        sound.chew(0.2);
        chewIn = Math.max(0.15, 0.5 / Math.max(1, pace)) * (0.9 + Math.random() * 0.2);
      }
    }
    soundHead.copy(sim.head);
    if (antsOnMe > 0 && Math.random() < dt * (1.2 + antsOnMe * 0.6)) sound.clicks(sim.head, 2 + Math.floor(Math.random() * 2), 1, 0.22);
    if (webShakes && !soundWeb) sound.twang(sim.head, 0.4);
    soundWeb = webShakes;
    // critters: ants grunt under a load and squeak in a quarrel, wings buzz, the chafer gallops
    const grunters: THREE.Vector3[] = [];
    const squeakers: THREE.Vector3[] = [];
    let chafer: THREE.Vector3 | null = null;
    for (const c of antView.heard()) {
      if (c.flying) sound.buzz(`c${c.id}`, c.p, c.kind === LADYBUG ? 150 : 120, 0.35);
      else if (c.kind === CHAFER && (c.state === CHASE || riding)) chafer = c.p;
      else if (c.kind === ANT && (c.state === HOLD || c.state === CARRY)) grunters.push(c.p);
      else if (c.kind === ANT && c.state === QUARREL) squeakers.push(c.p);
    }
    if (grunters.length && Math.random() < dt * Math.min(2.5, 0.7 * grunters.length)) sound.grunt(grunters[Math.floor(Math.random() * grunters.length)]);
    if (squeakers.length && Math.random() < dt * Math.min(3, 1.2 * squeakers.length)) sound.squeak(squeakers[Math.floor(Math.random() * squeakers.length)]);
    stompIn -= dt;
    const galloping = !!chafer && chafer.distanceTo(chaferWas) / Math.max(dt, 1e-3) > 0.8;
    if (chafer) chaferWas.copy(chafer);
    if (chafer && galloping && stompIn <= 0) {
      // a gallop: ta-da-dum … ta-da-dum
      const k = stompStep++ % 3;
      sound.stomp(chafer, riding ? 1 : 0.7, k === 2 ? 1 : 0.75);
      stompIn = k === 2 ? 0.2 : 0.075;
    }
    // a fly heard only as it passes right in front of the camera, one at a time (far ones are silent)
    if (!night && sim.mode !== 'dig') {
      let near: { i: number; p: THREE.Vector3; close: boolean } | null = null;
      let nd = 2.5;
      for (const g of gnats.flying()) {
        const d = g.p.distanceTo(camera.position);
        if (d < nd) {
          nd = d;
          near = g;
        }
      }
      if (near) sound.buzz('fly', near.p, near.close ? 360 : 410, 0.16);
    }
    sound.endFrame(Math.min(1, night), sim.mode === 'dig' ? 1 : 0);
  }

  function frame(hidden: boolean) {
    const t0 = performance.now();
    const realDt = clock.getDelta();
    const dt = Math.min(realDt, hidden ? 0.25 : 0.05);
    time += dt;
    const prevFx = sim.fx;
    if (!roundOver || sim.fx >= 0) sim.update(dt, readInput(dt));
    maybeConfetti(prevFx, sim.fx, sim.disp, sim.growth);
    if (!arena && sim.growth >= WIN_GROWTH && sim.mode !== 'fly' && time - winClaimedAt > 2) {
      winClaimedAt = time;
      net.send({ t: 'win', g: r3(sim.growth) });
    }
    poseWorm(myView, sim.disp, sim.ups, sim.growth, sim.wave, sim.fx, performance.now() < panicUntil ? GULP_PANIC : 1, afterPanic(panicUntil), sim.sigh);
    setStunGlow(myView, stunnedUntil.get(myId) ?? 0);
    setRainbow(myView, performance.now() < shieldUntil && shieldShown(shieldUntil - performance.now()), myColor);
    // stars over the stunned
    stars.begin(dt);
    if (sim.down || ((stunnedUntil.get(myId) ?? 0) > performance.now() && frozenUntil > performance.now())) stars.show(myId, sim.head, tmp2.copy(sim.head).normalize(), girth(sim.growth), true);
    for (const [id, r] of remotes) {
      if (r.out) {
        stars.show(id, r.disp[N - 1], tmp2.copy(r.disp[N - 1]).normalize(), girth(r.size), r.view.group.visible && r.view.segs[N - 1].visible);
        continue;
      }
      if ((stunnedUntil.get(id) ?? 0) <= performance.now() || (panicOf.get(id) ?? 0) > performance.now()) continue;
      stars.show(id, r.disp[N - 1], tmp2.copy(r.disp[N - 1]).normalize(), girth(r.size), r.view.group.visible && r.view.segs[N - 1].visible);
    }
    for (const d of antView.dazed()) stars.show(`lb${d.id}`, d.at, d.up, 0.7 * d.len, true);
    stars.end();
    placeLabel(myView, sim.head, sim.mode === 'fly' ? tmp2.copy(sim.head).normalize() : sim.ups[N - 1], sim.growth * (sim.mode === 'fly' ? 1.8 : 1));
    updateCamera(dt);

    // inside: cut the skin away round the line to the worm, x-ray, the flesh haze
    const inside = +(sim.mode === 'dig' && !overview);
    fruitMesh.receiveShadow = !inside && !xray;
    for (const e of extras) e.visible = !inside; // the stem and leaf are outside: not seen through the flesh
    fruitUniforms.uWorm.value.copy(sim.head);
    fruitUniforms.uCutR.value = 1.5 * sim.L;
    fruitUniforms.uCut.value += (inside - fruitUniforms.uCut.value) * damp(dt, 3);
    fruitUniforms.uXray.value += ((xray || inside ? 1 : 0) - fruitUniforms.uXray.value) * damp(dt, 3);
    fruitUniforms.uXrayKey.value += (+!!xray - fruitUniforms.uXrayKey.value) * damp(dt, 3);
    fruitUniforms.uInside.value += (inside - fruitUniforms.uInside.value) * damp(dt, 3);
    const cameraSurface = appleF(camera.position);
    const xrayBlend = fruitUniforms.uXray.value;
    // Let the fade finish to within half a percent before switching to opaque skin.
    const cutaway = inside || xray || cameraSurface < 0 || Math.max(xrayBlend, fruitUniforms.uCut.value) > 0.005;
    fruitMesh.material = cutaway ? cutawayMat : surfaceMat;
    fruitBackdrop.visible = xrayBlend * (1 - fruitUniforms.uXrayKey.value) >= 0.5;
    const deep = ((a: number, b: number, x: number) => {
      const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return k * k * (3 - 2 * k);
    })(0.05, -0.4, cameraSurface) * (1 - xrayBlend);
    fog.near = THREE.MathUtils.lerp(500, 2.5, deep);
    fog.far = THREE.MathUtils.lerp(1000, 18, deep);
    camLight.intensity = (night > 0 ? 1.5 : 2.5) * deep;
    fruitUniforms.uNight.value = night;
    fog.color.copy(fleshColor).lerp(new THREE.Color(0x6a849c), 0.72 * night);
    // the sky goes soft up close, sharper from afar
    const blur = THREE.MathUtils.clamp(0.3 - 0.14 * Math.log(zoom), 0.02, 0.5);
    skyBlur += (blur - skyBlur) * damp(dt, 4);
    dome.update(skyBlur, camera.position);
    tunnels.update(time);
    holes.update();
    confetti.update(dt);
    impacts.update(dt);
    chimney(myId, sim.disp, sim.growth);
    for (const [id, r] of remotes) chimney(id, r.disp, r.size);
    puffs.update(dt);
    webs.update(dt);
    if (sim.rocketing && sim.mode === 'dig') {
      const dir = tmp2.subVectors(sim.disp[N - 1], sim.disp[N - 2]);
      if (dir.lengthSq() > 1e-8) streaks.emit(dt, sim.disp[N - 1], dir.normalize(), sim.L, RADII[N >> 1] * girth(sim.growth));
    }
    streaks.update(dt);
    drops.update(dt, camera.position, sunDir.copy(sun.position).normalize());
    // my slam hit: tell the host now
    if (slamDoneAt && performance.now() >= slamDoneAt) {
      slamDoneAt = 0;
      if (gripOnMe) {
        if (isHost) antSim.shake(myId);
        else net.send({ t: 'shake' });
      }
    }
    drops.setVisible(sim.mode !== 'dig');
    if (dropPending >= 0 && time - dropAskedAt > 0.5) dropPending = -1;
    if (sim.mode === 'surface') {
      const d = drops.hit(sim.head, 0.25 * sim.L);
      if (d >= 0 && d !== dropPending) {
        dropPending = d;
        dropAskedAt = time;
        net.send({ t: 'drop', id: d });
        sound.bloop();
      }
    }
    flare.update(dt, sim.mode === 'dig', renderer.getPixelRatio());
    gnats.update(dt, sim.mode === 'dig', camera);

    // the host simulates the critters and sends them (and the spider threads) to everyone
    if (isHost && !roundOver) {
      const worms: WormInfo[] = [
        { id: myId, mode: sim.mode, disp: sim.disp, stuck: webShakes > 0, g: sim.growth, seed: boostFactor(), rear: sim.rear > 0.5, safe: performance.now() < shieldUntil || sim.down },
      ];
      for (const [id, r] of remotes) worms.push({ id, mode: r.mode, disp: r.disp, stuck: r.stuck, g: r.size, seed: r.seed, rear: r.rear, safe: !!r.shield || !!r.out });
      const snaps = antSim.update(dt, worms, tunnels.list());
      antView.apply(snaps);
      // the chafer tore / tugged threads: redraw them here at once
      if (antSim.websTouched && time - websTouchedAt > 0.05) {
        antSim.websTouched = false;
        websTouchedAt = time;
        webs.set(antSim.websNow());
      }
      // threads in full every 4 s (sooner after a tug), just the new bits twice a second
      if (time - websFullAt > 4 || (antSim.websMoved && time - websFullAt > 0.5)) {
        antSim.websMoved = false;
        websFullAt = websSentAt = time;
        const all = antSim.webs();
        webs.set(all);
        pendingWebs = { w: all };
      } else if (time - websSentAt > 0.5) {
        websSentAt = time;
        const delta = antSim.websDelta();
        if (delta.length) {
          webs.add(delta);
          if (pendingWebs?.w) pendingWebs.w = antSim.webs();
          else pendingWebs = { wd: [...(pendingWebs?.wd ?? []), ...delta] };
        }
      }
      if (time - antsSentAt > 0.1) {
        antsSentAt = time;
        net.send({ t: 'ants', a: snaps, w: pendingWebs?.w, wd: pendingWebs?.wd });
        pendingWebs = null;
      }
    }
    antView.setCamera(camera.position);
    antView.update(dt, (id) => bodyOf(id), (id) => tunnels.points(id));
    // riding: my body follows the chafer as drawn this frame
    if (riding && sim.mode === 'surface') {
      const seat = antView.chaferSeat(myId);
      if (seat) {
        sim.rideAt = seat;
        sim.followRide();
        poseWorm(myView, sim.disp, sim.ups, sim.growth, sim.wave, sim.fx, performance.now() < panicUntil ? GULP_PANIC : 1, afterPanic(panicUntil), sim.sigh);
        placeLabel(myView, sim.head, sim.ups[N - 1], sim.growth);
      }
    }
    if (pit) pit.object.visible = sim.mode === 'dig' || xray;
    antView.setInside(sim.mode === 'dig');
    seeds?.setInside(sim.mode === 'dig');
    webs.setVisible(sim.mode !== 'dig');
    // a spider thread: stuck, five jerks to get free
    if (!riding && !webShakes && sim.mode === 'surface' && !sim.airborne && performance.now() > webFreeUntil && performance.now() > panicUntil) {
      if (webs.touches(sim.disp, (i) => RADII[i] * girth(sim.growth) * 1.3 + 0.03)) webShakes = WEB_SHAKES;
    }
    if (riding || sim.mode !== 'surface') webShakes = 0;

    // ants on me: they drag me (on the skin by the end more of them hold; inside, back along my passage) unless I crawl on
    antsOnMe = riding || sim.mode === 'fly' ? 0 : antView.attachedTo(myId, ANT);
    playSounds(dt);
    const pulling = antsOnMe && !movingForward;
    dragged += ((pulling ? (sim.mode === 'surface' ? antView.dragBalance(myId) : 1) : 0) - dragged) * damp(dt, 3);
    if (Math.abs(dragged) > 0.3) sim.pullBack(0.12 * Math.abs(dragged) * dt, dragged > 0);
    if (!riding && sim.mode === 'surface' && antView.ladybugsBoth(myId)) {
      // two ladybugs: pulled straight, tugged one way and then the other
      sim.straighten(dt);
      if ((clapT -= dt) <= 0) {
        clapDir = clapDir === 1 ? -1 : 1;
        clapT = 2.5 + Math.random() * 2;
        clapPull = 0;
      }
      const k = Math.min(1, (clapPull += dt) / 0.7);
      sim.pullBack(0.3 * k * (movingForward ? 0.4 : 1) * dt, clapDir > 0);
    } else clapT = 0;
    {
      // a ladybug: it grabs (pulls me in, wags me), wags me now and then; let go, I spring back
      const had = gripOnMe;
      gripOnMe = riding || sim.mode !== 'surface' ? null : antView.ladybugGrip(myId);
      const shake = gripOnMe ? antView.ladybugShake(myId) : null;
      const reach = (end: string) => 0.12 * SPECS[LADYBUG].len + RADII[end === 'head' ? N - 1 : 0] * girth(sim.growth) * 0.4;
      if (wagT > 0 && gripOnMe && (!shake || Math.abs(shake.v) < 0.05)) {
        const k = 1 - wagT / 0.5;
        sim.wag = { end: gripOnMe, v: Math.sin(k * Math.PI * 3) * (1 - k), both: antView.ladybugsBoth(myId), reach: reach(gripOnMe) };
      } else sim.wag = shake ? { end: shake.end as 'head' | 'tail', v: shake.v, both: antView.ladybugsBoth(myId), reach: reach(shake.end) } : null;
      if (had && !gripOnMe && !riding && sim.mode === 'surface') {
        pullLeft = 0.25 * sim.L;
        pullHead = had === 'tail';
      }
      if (pullLeft > 0) {
        const d = Math.min(pullLeft, 2.5 * sim.L * dt);
        sim.pullBack(d, pullHead);
        pullLeft -= d;
      }
      if (gripOnMe && !had) {
        grabPull = 0.3 * sim.L;
        wagT = 0.5;
      }
      if (wagT > 0 && gripOnMe) {
        wagT = Math.max(0, wagT - dt);
        const lb = antView.ladybugAt(myId, gripOnMe);
        if (lb && !antView.ladybugsBoth(myId)) sim.alignTo(lb, gripOnMe, dt);
      }
      if (grabPull > 0 && gripOnMe) {
        const d = Math.min(grabPull, 3 * sim.L * dt);
        sim.pullBack(d, gripOnMe === 'head');
        grabPull -= d;
      }
      if (gripOnMe && !had) {
        if (!untouchable(myId)) sim.addPoints(-10);
        toast(`ladybit:${10}`);
      }
    }
    // a seed under my head while gnawing (not in a rocket, unless going straight through): ask the server
    if (seedPending >= 0 && time - seedAskedAt > 0.5) seedPending = -1;
    if (sim.mode === 'dig' && seeds && (!sim.rocketing || sim.through)) {
      const i = seeds.hit(sim.head, 0.6 * sim.L);
      if (i >= 0 && i !== seedPending) {
        seedPending = i;
        seedAskedAt = time;
        net.send({ t: 'seed', i });
      }
    }
    updateRemotes();
    // my bots (after a win only the winner moves: its flight)
    for (const b of bots) if (!roundOver || b.playerId === winnerId) b.update(dt);

    // the player list, 10 times a second
    if (time - hudAt >= 0.1 || hidden) {
      hudAt = time;
      const now = performance.now();
      const stunned = (id: string) => Math.max(0, Math.ceil(((stunnedUntil.get(id) ?? 0) - now) / 1000));
      const panic = (id: string) => Math.max(0, Math.ceil(((panicOf.get(id) ?? 0) - now) / 1000));
      const rows: RosterRow[] = [
        {
          id: myId,
          name: myName,
          color: myColor,
          mode: sim.mode,
          me: true,
          score: roundResults?.get(myId) ?? shown(sim.growth, sim.life),
          wins: myWins,
          web: webShakes > 0,
          myBot: false,
          stunned: stunned(myId),
          panic: panic(myId),
          out: arena && sim.down,
        },
      ];
      for (const [id, p] of players) {
        const r = remotes.get(id);
        rows.push({
          id,
          name: p.name,
          color: p.color,
          mode: r?.mode ?? 'surface',
          me: false,
          score: roundResults?.get(id) ?? shown(r?.size ?? 1, r?.out ? 0 : r?.hp),
          wins: p.wins,
          web: !!r?.stuck,
          myBot: bots.some((b) => b.serverId === id),
          stunned: stunned(id),
          panic: panic(id),
          out: arena && !!r?.out,
        });
      }
      const mul = boostFactor();
      const boostEnds = boosts.reduce((m, c) => Math.max(m, c.until), 0);
      updateHud({
        web: webShakes,
        roundTime: Math.max(0, Math.floor(((roundEnd || performance.now()) - roundStart) / 1000)),
        earwig: earwigShakes,
        grip: gripOnMe ?? '',
        ants: antsOnMe,
        roster: JSON.stringify(rows),
        seedBoost: boostEnds ? Math.max(0, Math.ceil((boostEnds - performance.now()) / 1000)) : 0,
        seedMul: Math.round(mul * 100) / 100,
      });
    }
    frames++;
    fpsT += realDt;
    if (fpsT >= 0.5) {
      updateHud({ fps: Math.round(frames / fpsT) });
      frames = 0;
      fpsT = 0;
    }
    // my worm, ~15 times a second (30 in the victory flight)
    sendT += dt;
    if (sendT > (sim.mode === 'fly' ? 0.033 : 0.066)) {
      sendT = 0;
      const p: number[] = [];
      for (const v of sim.disp) p.push(r3(v.x), r3(v.y), r3(v.z));
      net.send({
        t: 's',
        p,
        m: sim.mode,
        g: r3(sim.growth),
        w: r3(sim.wave),
        fx: r3(sim.fx),
        k: webShakes ? 1 : 0,
        sp: r3(boostFactor()),
        rr: +(sim.rear > 0.5),
        iv: performance.now() < shieldUntil ? (shieldUntil - performance.now() < 2000 ? 2 : 1) : 0,
        ...(arena ? { hp: Math.round(sim.life) } : {}),
      });
    }
    flushT += dt;
    if (flushT > 0.25) {
      flushT = 0;
      flushTunnelPts();
      flushDrills();
    }
    if (!hidden) renderer.render(scene, camera);
    void t0;
  }

  /** Untouchable: riding the chafer, or a seed's shield. */
  function untouchable(id: string) {
    if ((id === myId && riding) || !!antView.chaferSeat(id)) return true;
    return id === myId ? performance.now() < shieldUntil : !!remotes.get(id)?.shield;
  }
  /** On the chafer: tell the host (or the host itself). */
  function ride(how: { on?: boolean; off?: boolean; scoot?: boolean; bite?: boolean; turn?: number }) {
    if (isHost) antSim.ride(myId, how);
    else net.send({ t: 'ride', ...how });
  }
  /** Off the chafer: a hop to its side. */
  function getOffChafer() {
    if (!riding) return;
    riding = false;
    ride({ off: true });
    const seat = sim.rideAt;
    sim.rideAt = null;
    if (seat && sim.mode === 'surface') {
      const side = new THREE.Vector3().crossVectors(seat.up, seat.f).normalize();
      sim.spawn(seat.at.clone().addScaledVector(side, 0.6 * SPECS[CHAFER].len));
      sim.jump();
    }
  }
  /** The earwig let go: down where it held me. */
  function dropFromEarwig() {
    if (sim.held && sim.heldAt && sim.mode === 'surface') sim.spawn(sim.disp[N >> 1].clone());
    sim.held = false;
    sim.heldAt = null;
  }
  /** Wriggled out of its pincers. */
  function freeFromEarwig() {
    dropFromEarwig();
    earwigShakes = 0;
    if (isHost) antSim.release(myId);
    else net.send({ t: 'free' });
  }
  /** Nothing holds me, nothing boosts me. */
  function clearMyState() {
    if (riding) getOffChafer();
    earwigShakes = 0;
    sim.held = false;
    shieldUntil = 0;
    webShakes = 0;
    webFreeUntil = 0;
    panicUntil = 0;
    boosts = [];
    seedPending = -1;
  }
  /** The round is over (or a new one starts): passages and holes fade, critters and threads go. */
  function wipeRound() {
    tunnels.fadeAll();
    drills.clear();
    holes.fadeAll();
    curTunnel = '';
    pendingPts = [];
    antSim.clear();
    antView.clear();
    webs.set([]);
    stunnedUntil.clear();
    panicOf.clear();
    clearMyState();
  }

  ticker.onmessage = () => {
    if (document.hidden) frame(true);
  };
  const loop = () => {
    raf = requestAnimationFrame(loop);
    frame(false);
  };
  loop();

  // console helpers in development: __worm() state, __wormFly() previews a victory, __wormPoints(25) sets my points
  if (process.env.NODE_ENV !== 'production') {
    const w = window as unknown as Record<string, unknown>;
    w.__sound = sound; // __sound.hit(), __sound.whoosh(), … to hear one
    // __spawn(2): a critter now (0 ant, 1 ladybug, 2 spider, 3 earwig, 4 chafer), near me
    w.__spawn = (kind: number) => {
      const s = antSim as unknown as { spawn(k: number): { p: THREE.Vector3 }; ants: { p: THREE.Vector3 }[] };
      const a = s.spawn(kind);
      a.p.copy(sim.head).addScaledVector(new THREE.Vector3().randomDirection(), 1.5);
      appleProject(a.p);
      s.ants.push(a);
    };
    w.__wormFly = () => {
      sim.startVictory(camera.position.clone().sub(sim.head));
      later(3300, startOverview);
      later(4600, () => updateHud({ winner: myName, winnerMe: true, end: 'win' }));
    };
    w.__wormPoints = (n: number) => {
      sim.growth = 1 + n / 100;
    };
    w.__botPoints = (n: number) => bots.forEach((b) => b.setPoints(n));
    w.__perf = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, px: [renderer.domElement.width, renderer.domElement.height] });
    w.__worm = () => ({
      mode: sim.mode,
      head: sim.head.toArray().map(r3),
      cam: camera.position.toArray().map(r3),
      time: r3(time),
      introAt: r3(introAt),
      overview: !!overview,
      riding,
      host: isHost,
      tunnels: tunnels.size,
      growth: sim.growth,
      bots: bots.map((b) => b.name),
      remotes: [...remotes].map(([id, r]) => ({ id, mode: r.mode, size: r.size, visible: r.view.group.visible })),
    });
  }

  /** A new round: small again (the arena: full life), at `dir` (else a free spot); the camera flies there. */
  const restartRound = (dir?: THREE.Vector3) => {
    roundOver = false;
    roundStart = performance.now();
    roundEnd = 0;
    winnerId = '';
    updateHud({ winner: '', winnerMe: false, end: '', readyMe: false, readyN: 0, readyOf: 0, goAt: 0 });
    roundResults = null;
    if (!dir) for (const b of bots) b.newRound(freeSpot(true));
    overview = null;
    introFrom = { pos: camera.position.clone(), q: camera.quaternion.clone() };
    introAt = time - INTRO_HOLD;
    clearMyState();
    frozenUntil = 0;
    stunnedUntil.delete(myId);
    panicOf.delete(myId);
    if (isHost) antSim.release(myId);
    else net.send({ t: 'free' });
    outTold = false;
    sim.restart(dir ?? freeSpot());
    camInit = false;
    orbit = 0;
    camTilt = 0;
  };
  function nextLight() {
    light = LIGHTS[(LIGHTS.indexOf(light) + 1) % LIGHTS.length];
    applyLight();
    updateHud({ light });
  }

  return {
    restartRoundForAll: () => net.send({ t: 'reset' }),
    roundReady: () => {
      if (netStatus === 'online') {
        net.send({ t: 'ready' });
        updateHud({ readyMe: true });
      } else restartRound(); // offline: on my own
    },
    startNow: () => net.send({ t: 'gonow', key: roomKey() }),
    nextLight,
    addBot,
    removeBot: (id) => {
      const i = bots.findIndex((b) => b.serverId === id);
      if (i < 0) return;
      bots[i].close();
      bots.splice(i, 1);
    },
    removeBots,
    restartRound,
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      ticker.terminate();
      for (const id of timers) clearTimeout(id);
      removeBots();
      net.close();
      for (const [t, ev, fn] of listeners) t.removeEventListener(ev, fn as EventListener);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      tunnels.dispose();
      confetti.dispose();
      impacts.dispose();
      puffs.dispose();
      stars.dispose();
      streaks.dispose();
      gnats.dispose();
      sound.stopAll();
      drops.dispose();
      flare.dispose();
      webs.dispose();
      seeds?.dispose();
      if (pit) {
        pit.object.removeFromParent();
        setPit(null);
      }
      antView.dispose();
      holes.dispose();
      for (const id of [...remotes.keys()]) removeRemote(id);
      disposeWormView(myView);
      fruitGeo.dispose();
      surfaceMat.dispose();
      cutawayMat.dispose();
      backdropMat.dispose();
      model?.map?.dispose();
      skyTex?.dispose();
      (scene.environment as THREE.Texture | null)?.dispose();
      dome.dispose();
      renderer.dispose();
      mount.removeChild(canvas);
    },
  };
}

// ---------- fallback fruit when no model is found ----------

function proceduralFruitGeometry() {
  const geo = new THREE.SphereGeometry(1, 360, 260);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    appleProject(v);
    pos.setXYZ(i, v.x, v.y, v.z);
    appleNormal(v, nn);
    nor.setXYZ(i, nn.x, nn.y, nn.z);
  }
  geo.computeBoundingSphere();
  return geo;
}

function modelStem(stem: NonNullable<AppleModel['stem']>) {
  return new THREE.Mesh(stem.geometry, new THREE.MeshStandardMaterial({ map: stem.map, roughness: 0.8, side: THREE.DoubleSide }));
}

function proceduralStemAndLeaf() {
  const top = appleShapeR(0, 1, 0);
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, top - 0.6, 0),
    new THREE.Vector3(0.02 * R0, top + 0.22 * R0, 0),
    new THREE.Vector3(0.12 * R0, top + 0.32 * R0, 0.03 * R0),
  );
  const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.028 * R0, 12, false), new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.9 }));
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.15, 0.28, 0.6, 0.32, 1, 0);
  s.bezierCurveTo(0.6, -0.32, 0.15, -0.28, 0, 0);
  const leafGeo = new THREE.ShapeGeometry(s, 24);
  leafGeo.scale(0.42 * R0, 0.42 * R0, 0.42 * R0);
  const leaf = new THREE.Mesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0x3d7a22, roughness: 0.6, side: THREE.DoubleSide }));
  leaf.position.copy(curve.getPoint(0.55));
  leaf.rotation.set(-0.5, 0.6, 0.35);
  return [stem, leaf];
}
