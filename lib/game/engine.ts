import * as THREE from 'three';
import { R0, appleF, appleNormal, appleProject, appleShapeR, pushOutOfPit, setPit } from '@/lib/apple';
import { connectNet, type NetMsg } from '@/lib/net';
import type { AppleModel } from '@/lib/appleModel';
import { FLESH_COLORS, makeFruitMaterial, makeFruitUniforms } from '@/lib/render/materials';
import { HoleLayer, TunnelStore } from '@/lib/render/tunnels';
import { Confetti } from '@/lib/render/confetti';
import { Impacts } from '@/lib/render/impacts';
import { Puffs } from '@/lib/render/puffs';
import { Webs } from '@/lib/render/webs';
import { Seeds } from '@/lib/render/seeds';
import { freeDir, slotDir } from '@/lib/worm/spawn';
import { ANT, AntSim, AntView, type AntSnap, type WormInfo } from '@/lib/worm/Ants';
import { SkyDome, loadFruitSky, sunDirFromPanorama } from '@/lib/render/sky';
import { WormSim, type SimInput } from '@/lib/worm/WormSim';
import { Bot } from '@/lib/worm/Bot';
import { disposeWormView, makeWormView, placeLabel, poseWorm, setLabel, setStunGlow, setWormColor, type WormView } from '@/lib/worm/wormView';
import { DEFAULT_NAME, girth, L0, N, RADII, TUNNEL_R0, WIN_GROWTH, WIN_SIZE_GAIN, damp, r3, smoothstep } from '@/lib/worm/constants';

/** What the React UI shows. Kept small: it is compared and re-sent every frame. */
export type HudState = {
  players: number;
  net: 'connecting' | 'online' | 'offline';
  roster: string; // JSON of RosterRow[]
  toast: string; // "<kind>:<name>"
  fps: number;
  seedBoost: number; // seconds of seed speed bonus left
  countdown: number; // Date.now() when a 3-2-1-START countdown began, 0 = none
  ants: number; // ants riding my worm
  grip: '' | 'head' | 'tail'; // a ladybug holds this end
  web: number; // stuck in a spider thread: jerks left (0 = free)
  winner: string; // name of this round's winner while the victory dialog is shown
  winnerMe: boolean;
};

export type RosterRow = { id: string; name: string; color: number; mode: string; me: boolean; score: number; myBot: boolean; stunned: number /* seconds left, 0 = fine */; panic: number /* stung by a spider, running wild: seconds left */ };

/** A lobby room: everyone in it plays on one fruit (the map). */
export type RoomInfo = { id: string; name: string; fruit: string; players: number; max: number; win?: number /* goal in points */ };

export type EngineOptions = {
  mount: HTMLElement;
  room: RoomInfo;
  name: string;
  model: AppleModel | null;
  pit?: { object: THREE.Object3D; radii: THREE.Vector3 } | null; // an obstacle instead of seeds
  hud: HudState;
  onHud: (hud: HudState) => void;
  uiBlocked: () => boolean; // a dialog is open: ignore the keyboard
  openSettings: () => void;
  /** Bots to add once connected (the player who created the room picked them). */
  bots?: number;
  /** The room is gone or full: back to the lobby. */
  onLeave: (reason: 'noroom' | 'full') => void;
};

export type Engine = {
  restartRoundForAll: () => void; // everyone starts again: passages, points and seeds reset
  dispose: () => void;
  addBot: () => void;
  removeBot: (id: string) => void;
  removeBots: () => void;
  restartRound: () => void;
};

type Remote = {
  view: WormView;
  disp: THREE.Vector3[];
  target: THREE.Vector3[];
  has: boolean;
  last: number;
  mode: string;
  size: number;
  wave: number;
  fx: number;
  prevFx: number;
  fxAt: number; // local time when fx arrived: the flight clock runs on between updates
  stuck?: boolean; // in a spider thread
};

const DEFAULT_ZOOM = 2;
export const COUNTDOWN_MS = 3000; // "3", "2", "1", then START

export function startEngine(o: EngineOptions): Engine {
  // the size grows 10× by the win whatever the goal; points come at the same pace (a bigger goal = a longer round)
  const winPoints = o.room.win || 300;
  const score = (growth: number) => Math.max(0, Math.floor(((growth - 1) / WIN_SIZE_GAIN) * winPoints + 1e-6));
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
  mount.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdcdcdc); // until the panorama loads
  const fog = new THREE.Fog(0xf2efe2, 500, 1000); // flesh haze when the camera is inside
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.02, 2000);
  scene.add(camera);

  // white light: one sun aimed at the panorama glare (no visible disc) + soft neutral fill
  const hemi = new THREE.HemisphereLight(0xffffff, 0x303030, 0.45);
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.position.set(0.2, 0.9, 0.3).multiplyScalar(50);
  const camLight = new THREE.PointLight(0xffffff, 0, 7, 1);
  scene.add(hemi, new THREE.AmbientLight(0xffffff, 0.1), sun);
  camera.add(camLight);

  let skyTex: THREE.Texture | null = null;
  let skyBlur = 0.3;
  const dome = new SkyDome(scene, R0 * 4); // the panorama a few fruit sizes away: a snug glade
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
    scene.environmentIntensity = 0.55;
    scene.backgroundIntensity = 0.9;
    hemi.intensity = 0.2;
    const dir = sunDirFromPanorama(tex);
    if (dir) sun.position.copy(dir).multiplyScalar(50);
  });

  // ---------- fruit ----------
  const fruitUniforms = makeFruitUniforms();
  if (FLESH_COLORS[fruit] !== undefined) {
    // e.g. a golden peach; the haze inside the flesh takes the same colour
    fruitUniforms.uFlesh.value.setHex(FLESH_COLORS[fruit]);
    fog.color.setHex(FLESH_COLORS[fruit]);
  }
  const fruitGeo = model ? model.geometry : proceduralFruitGeometry();
  const fruitMat = makeFruitMaterial(fruitUniforms, model?.map ?? null);
  const fruitMesh = new THREE.Mesh(fruitGeo, fruitMat);
  fruitMesh.renderOrder = 10;
  scene.add(fruitMesh);
  const extras = model?.stem ? [modelStem(model.stem)] : proceduralStemAndLeaf();
  scene.add(...extras);

  const tunnels = new TunnelStore(scene);
  const confetti = new Confetti(scene);
  const impacts = new Impacts(scene);
  const puffs = new Puffs(scene);
  const amokOf = new Map<string, number>(); // stung worms (by id) puff steam like a locomotive until then
  const puffAt = new Map<string, number>();
  const chimney = (id: string, disp: THREE.Vector3[], size: number) => {
    if ((amokOf.get(id) ?? 0) < performance.now()) return;
    // its butt is on fire: chug-chug, puffs of steam out of the tail end, up and trailing behind
    if (time - (puffAt.get(id) ?? -1) < 0.11) return;
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
  const WEB_SHAKES = 5;
  let webShakes = 0; // stuck in a thread: jerks left to get free
  let webFreeUntil = 0; // just got free: can cross threads for a moment
  let websSentAt = 0;
  // seeds are bonuses; a fruit with a pit has the pit (an obstacle, seen only from inside) instead
  const pit = o.pit ?? null;
  const seeds = pit ? null : new Seeds(scene);
  if (pit) {
    scene.add(pit.object);
    setPit({ c: new THREE.Vector3(), r: pit.radii });
  }
  // ants: the room's host simulates them, everyone draws them
  const antSim = new AntSim();
  antSim.onSting = (id, k) => net.send({ t: 'sting', id, k }); // the server freezes the worm for everyone
  const antView = new AntView(scene);
  let isHost = false;
  let antsSentAt = 0;
  let antsOnMe = 0;
  let gripOnMe: 'head' | 'tail' | null = null; // a ladybug holds this end of my worm
  const SEED_BONUS_MS = 10_000; // ×2 speed after eating a seed
  let seedBoostUntil = 0;
  let seedAskedAt = -10; // don't spam the server while it answers
  const CONFETTI_AT = 1.0; // seconds into the victory flight: the wings spring out
  /** Pop confetti when a flying worm's wings come out (fx passes CONFETTI_AT). */
  const maybeConfetti = (prevFx: number, fx: number, disp: THREE.Vector3[], size: number) => {
    if (!(prevFx < CONFETTI_AT && fx >= CONFETTI_AT)) return;
    const at = disp[N - 3];
    confetti.burst(at, at.clone().normalize(), L0 * size);
  };
  const holes = new HoleLayer(scene);
  let time = 0;

  // ---------- my worm ----------
  let xray = false; // X on the skin (inside it is always on)
  let myId = 'local' + Math.floor(Math.random() * 1e6);
  let curTunnel = '';
  let tunnelCounter = 0;
  let pendingPts: number[] = [];
  let winClaimedAt = -10;
  let frozenUntil = 0; // bitten
  let amokUntil = 0; // stung by a spider: runs wild (twice the boost), can only steer

  const newTunnelId = () => {
    let id;
    do id = `${myId}-${++tunnelCounter}`;
    while (tunnels.has(id)); // never append to someone else's (or an old) tunnel
    return id;
  };
  const flushTunnelPts = () => {
    if (pendingPts.length && curTunnel) net.send({ t: 'tp', id: curTunnel, pts: pendingPts });
    pendingPts = [];
  };

  const sim = new WormSim(
    {
      tunnelStart: (r) => {
        curTunnel = newTunnelId();
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
      impact: (p) => impacts.burst(p, sim.L),
      flown: () => {
        sim.spawn(freeSpot()); // back in, away from everyone
        camInit = false;
      },
    },
  );
  sim.growthRate = WIN_SIZE_GAIN * 100 / winPoints;

  const myView = makeWormView(0xe89a9a, scene);
  let myColor = 0xe89a9a;
  setLabel(myView, myName, myColor);

  // ---------- other worms ----------
  const remotes = new Map<string, Remote>();
  const players = new Map<string, { color: number; name: string }>();
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
  const nameOf = (id: string) => (id === myId ? myName : players.get(id)?.name ?? DEFAULT_NAME);

  // bots run in this tab over their own connections
  const bots: Bot[] = [];
  const addBot = () => {
    const taken = new Set([myName, ...[...players.values()].map((p) => p.name)]);
    const bot = new Bot(o.room.id, taken, (p, reach) => seeds?.hit(p, reach) ?? -1, () => freeSpot(true), (reason) => {
      if (reason === 'full') toast('full:');
      const i = bots.indexOf(bot);
      if (i >= 0) bots.splice(i, 1);
    });
    bot.onImpact = (p, size) => impacts.burst(p, size);
    bot.setWinPoints(winPoints);
    bot.webTouch = (disp, size) => webs.touches(disp, (i) => RADII[i] * girth(size) * 1.3 + 0.03);
    bots.push(bot);
  };
  const removeBot = (id: string) => {
    const i = bots.findIndex((b) => b.serverId === id);
    if (i < 0) return;
    bots[i].close();
    bots.splice(i, 1);
  };
  const setBots = (n: number) => {
    while (bots.length > n) bots.pop()!.close();
    while (bots.length < n) addBot();
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
          myId = m.id;
          // joined: once we know where the others are, move to the freest spot
          later(600, () => {
            if (sim.mode === 'surface' && sim.growth <= 1.001) {
              sim.spawn(freeSpot());
              camInit = false;
            }
          });
          myColor = m.color;
          setWormColor(myView, myColor);
          setLabel(myView, myName, myColor);
          for (const id of [...remotes.keys()]) removeRemote(id);
          players.clear();
          for (const pl of m.players) players.set(pl.id, { color: pl.color, name: pl.name || DEFAULT_NAME });
          tunnels.clear();
          holes.clear();
          for (const tt of m.tunnels) tunnels.appendFlat(tt.id, tt.pts, tt.r);
          for (const h of m.holes) holes.place(h);
          seeds?.setAll(m.seeds ?? []);
          isHost = m.host === myId;
          if (sim.mode === 'dig') {
            curTunnel = newTunnelId();
            tunnels.get(curTunnel, sim.growth * TUNNEL_R0);
            net.send({ t: 'ts', id: curTunnel, r: r3(sim.growth * TUNNEL_R0) });
          }
          updateHud({ players: players.size + 1 });
          if (botsToAdd) {
            setBots(botsToAdd);
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
          players.set(m.id, { color: m.color, name: m.name || DEFAULT_NAME });
          updateHud({ players: players.size + 1 });
          toast(`joined:${m.name || DEFAULT_NAME}`);
          break;
        case 'leave': {
          const pl = players.get(m.id);
          players.delete(m.id);
          removeRemote(m.id);
          updateHud({ players: players.size + 1 });
          if (pl) toast(`left:${pl.name}`);
          break;
        }
        case 's': {
          let r = remotes.get(m.id);
          if (!r) {
            const pl = players.get(m.id) ?? { color: 0xffffff, name: DEFAULT_NAME };
            r = {
              view: makeWormView(pl.color, scene),
              disp: Array.from({ length: N }, () => new THREE.Vector3()),
              target: Array.from({ length: N }, () => new THREE.Vector3()),
              has: false,
              last: 0,
              mode: 'surface',
              size: 1,
              wave: -1,
              fx: -1,
              prevFx: -1,
              fxAt: 0,
            };
            setLabel(r.view, pl.name, pl.color);
            remotes.set(m.id, r);
          }
          for (let k = 0; k < N; k++) r.target[k].set(m.p[k * 3], m.p[k * 3 + 1], m.p[k * 3 + 2]);
          if (!r.has) r.disp.forEach((v, k) => v.copy(r!.target[k]));
          r.has = true;
          r.last = time;
          r.mode = m.m === 'dig' || m.m === 'fly' ? m.m : 'surface';
          r.size = typeof m.g === 'number' ? m.g : 1;
          r.wave = typeof m.w === 'number' ? m.w : -1;
          r.prevFx = r.fx;
          r.fx = typeof m.fx === 'number' ? m.fx : -1;
          r.fxAt = time;
          r.stuck = !!m.k;
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
        case 'bite':
          stunnedUntil.set(m.id, performance.now() + (m.duration || 5000)); // shown in the player list
          if (m.id === myId) {
            frozenUntil = performance.now() + (m.duration || 5000);
            toast(m.by === 'spider' ? 'stung:' : `bitten:${nameOf(m.by)}`);
          }
          break;
        case 'sting':
          stunnedUntil.set(m.id, performance.now() + (m.duration || 5000)); // blinks
          amokOf.set(m.id, performance.now() + (m.duration || 5000));
          {
            // comic strokes where the spider bit
            const body = m.id === myId ? { disp: sim.disp, size: sim.growth } : remotes.get(m.id) ? { disp: remotes.get(m.id)!.disp, size: remotes.get(m.id)!.size } : null;
            if (body) impacts.burst(body.disp[Math.min(N - 1, Math.max(0, Number(m.k) || 0))], L0 * body.size * 0.8);
          }
          if (m.id === myId) {
            amokUntil = performance.now() + (m.duration || 5000);
            webShakes = 0; // the frenzy tears it out of the web
            webFreeUntil = amokUntil + 1500;
            toast('stung:');
          }
          break;
        case 'reset':
          tunnels.clear();
          holes.clear();
          seeds?.setAll([]);
          antSim.clear();
          antView.clear();
          curTunnel = '';
          pendingPts = [];
          seedBoostUntil = 0;
          {
            // round start: evenly around the fruit
            const order: string[] = Array.isArray(m.order) ? m.order : [];
            const i = order.indexOf(myId);
            restartRound(i >= 0 ? slotDir(i, order.length, Number(m.rot) || 0) : undefined);
          }
          toast(`reset:${m.by || DEFAULT_NAME}`);
          // 3, 2, 1, START: nobody moves until START
          updateHud({ countdown: Date.now() });
          frozenUntil = performance.now() + COUNTDOWN_MS;
          break;
        case 'host':
          isHost = m.id === myId;
          if (!isHost) antSim.clear();
          break;
        case 'ants':
          if (!isHost) antView.apply(m.a as AntSnap[]);
          if (!isHost && m.w) webs.set(m.w);
          break;
        case 'shake':
          if (isHost) antSim.shake(m.id);
          break;
        case 'swat':
          if (isHost) antSim.swat(m.id);
          break;
        case 'free':
          if (isHost) antSim.release(m.id);
          break;
        case 'seed':
          seeds?.setEaten(m.i, true);
          if (m.by === myId) seedBoostUntil = performance.now() + SEED_BONUS_MS;
          break;
        case 'seeds':
          seeds?.setAll(m.eaten);
          break;
        case 'win': {
          const winner = m.name || nameOf(m.id);
          const me = m.id === myId;
          toast(`win:${winner}`);
          // the round is over: a fresh fruit (no passages, no holes)…
          tunnels.clear();
          holes.clear();
          curTunnel = '';
          pendingPts = [];
          // …all the critters and webs are gone, nobody is bitten or stuck any more
          if (isHost) antSim.clear();
          antView.clear();
          webs.set([]);
          stunnedUntil.clear();
          amokOf.clear();
          clearAfflictions();
          // a new round: everyone back to 0 points right away (the winner after its flight)
          if (me) sim.startVictory(faceCamera());
          else {
            sim.resetGrowth();
            spectate = { id: m.id, until: time + 4.6 };
          }
          // after the flight everyone gets the victory dialog; OK starts the next round
          later(4600, () => updateHud({ winner, winnerMe: me }));
          break;
        }
      }
    },
    (net) => updateHud({ net }),
  );

  // ---------- input ----------
  const keys: Record<string, boolean> = {};
  let mdx = 0;
  let mdy = 0;
  let holdMouse = false;
  let lockDenied = false; // pointer lock unavailable → clicks dig right away
  let zoom = DEFAULT_ZOOM; // camera distance multiplier (wheel, ↑/↓)
  let camYaw = 0; // camera orbit around the worm (←/→, mouse on the skin)
  let camPitch = 0; // camera height round the worm (mouse on the skin)
  let lastArrow = -10;
  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === canvas || holdMouse) {
      mdx += e.movementX;
      mdy += e.movementY;
    }
  };
  /** Right button: every hit on the skin — lash a ladybug, shake ants off, or shoo them with the tail. */
  const hit = () => {
    if (sim.mode === 'dig') {
      // in a passage: no room to turn, shrink and stretch to shake ants off
      if (antsOnMe <= 0) return;
      sim.squeeze();
      if (isHost) antSim.shake(myId);
      else net.send({ t: 'shake' });
      return;
    }
    if (sim.mode !== 'surface') return;
    let kind: 'shake' | 'swat' = 'shake';
    if (!gripOnMe && webShakes) {      // stuck in silk: jerk free (nobody else needs to know)
      sim.shake();
      if (--webShakes === 0) webFreeUntil = performance.now() + 2500;
      return;
    }
    if (gripOnMe || antsOnMe) console.info('[worm] hit', { antsOnMe, gripOnMe, isHost });
    if (gripOnMe) sim.whip(gripOnMe === 'head' ? 'tail' : 'head');
    else if (antsOnMe > 0) sim.shake();
    else {
      sim.swipe();
      kind = 'swat';
    }
    if (isHost) {
      if (kind === 'swat') antSim.swat(myId);
      else antSim.shake(myId);
    } else net.send({ t: kind });
  };
  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 2) {
      hit();
      return;
    }
    if (e.button !== 0) return;
    if (document.pointerLockElement !== canvas && !lockDenied) {
      // the click that grabs the mouse doesn't start digging
      try {
        const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        r?.catch?.(() => (lockDenied = true));
      } catch {
        lockDenied = true;
      }
      return;
    }
    holdMouse = true;
    if (sim.mode !== 'surface') return;
    // caught, stuck, stung or bitten: no burrowing; say why
    const now = performance.now();
    const why = gripOnMe ? 'grip' : antsOnMe > 0 ? 'ants' : webShakes ? 'web' : now < amokUntil ? 'amok' : now < frozenUntil ? 'frozen' : '';
    if (why) {
      holdMouse = false;
      toast(`nodig:${why}`);
      console.info('[worm] no dig:', why, { antsOnMe, gripOnMe, webShakes, amokLeft: amokUntil - now, frozenLeft: frozenUntil - now, isHost });
      return;
    }
    sim.startDig();
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) holdMouse = false;
  };
  const CAPTURED = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (down && (o.uiBlocked() || e.target instanceof HTMLInputElement)) return;
    if (CAPTURED.includes(e.code)) e.preventDefault();
    if (down && !e.repeat && e.code === 'KeyN') {
      e.preventDefault(); // otherwise the "n" lands in the name field that the dialog focuses
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      for (const k in keys) keys[k] = false;
      o.openSettings();
      return;
    }
    keys[e.code] = down;
    if (down && !e.repeat && e.code === 'KeyB') {
      const pending = bots.reduce((n, b) => n + (b.serverId ? 0 : 1), 0);
      if (players.size + 1 + pending >= o.room.max) toast('full:');
      else addBot();
    }
    if (down && !e.repeat && e.code === 'KeyX') xray = !xray;
    if (down && !e.repeat && e.code === 'Space' && !gripOnMe && !webShakes) sim.jump();
    if (down && !e.repeat && e.code === 'KeyV') {
      camYaw = 0;
      camPitch = 0;
      zoom = DEFAULT_ZOOM;
    }
  };
  const onKeyDown = onKey(true);
  const onKeyUp = onKey(false);
  const onWheel = (e: WheelEvent) => {
    zoom = Math.min(25, Math.max(0.5, zoom * Math.exp(e.deltaY * 0.0012)));
  };
  const onBlur = () => {
    holdMouse = false;
    for (const k in keys) keys[k] = false;
  };
  const onLockChange = () => {
    if (document.pointerLockElement === canvas) lockDenied = false;
  };
  const onResize = () => {
    camera.aspect = mount.clientWidth / mount.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(mount.clientWidth, mount.clientHeight);
  };
  const noMenu = (e: Event) => e.preventDefault();
  const listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [
    [document, 'mousemove', onMouseMove as EventListener],
    [canvas, 'mousedown', onMouseDown as EventListener],
    [window, 'mouseup', onMouseUp as EventListener],
    [window, 'keydown', onKeyDown as EventListener],
    [window, 'keyup', onKeyUp as EventListener],
    [canvas, 'wheel', onWheel as EventListener, { passive: true }],
    [canvas, 'contextmenu', noMenu],
    [window, 'blur', onBlur],
    [window, 'resize', onResize],
    [document, 'pointerlockchange', onLockChange],
  ];
  for (const [t, ev, fn, opt] of listeners) t.addEventListener(ev, fn, opt);

  /** Keys and mouse → this frame's movement. */
  function readInput(dt: number): SimInput {
    const mx = mdx;
    const my = mdy;
    mdx = mdy = 0;
    if (sim.mode === 'surface' && (mx || my)) {
      camYaw -= mx * 0.0012;
      camPitch = THREE.MathUtils.clamp(camPitch + my * 0.0009, -0.45, 0.95);
      lastArrow = time; // the camera stays where it was put for a while
    }
    const ky = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    const kp = (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0); // inside: E up, Q down
    const forward = !!keys.KeyW || (sim.mode === 'dig' && holdMouse); // Shift alone doesn't move: it only speeds up W
    const inp: SimInput = {
      // inside the mouse steers the head; on the skin it only turns the camera (A/D turn the worm)
      turn: -((sim.mode === 'dig' ? mx * 0.003 : 0) + ky * 1.2 * dt),
      pitch: (sim.mode === 'dig' ? -my * 0.003 : 0) + kp * dt,
      forward,
      boost: !!(keys.ShiftLeft || keys.ShiftRight),
      // a seed doubles the speed; every ant riding the worm halves it
      speed: (performance.now() < seedBoostUntil ? 2 : 1) * 0.5 ** antsOnMe,
      rear: !!keys.KeyS,
    };
    if (performance.now() < amokUntil && sim.mode === 'surface') {
      // spider venom: crawls on wildly, twice the boost; only steering is left
      inp.forward = true;
      inp.boost = true;
      inp.speed = (inp.speed ?? 1) * 4;
      inp.rear = false;
    }
    if (performance.now() < frozenUntil || gripOnMe || webShakes) {
      // bitten, waiting for START, or held by a ladybug
      inp.forward = false;
      inp.turn = inp.pitch = 0;
    }
    return inp;
  }

  // ---------- camera ----------
  const camPos = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const camQ = new THREE.Quaternion();
  const look = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const fCam = new THREE.Vector3(); // heading the camera follows, lags behind the worm's
  const tmp = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  let camInit = false;
  let spectate: { id: string; until: number } | null = null; // another worm's victory flight

  function updateCamera(dt: number) {
    const head = sim.head;
    const L = sim.L; // camera distances are measured in body lengths
    camYaw += ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * 1.8 * dt;
    if (keys.ArrowRight || keys.ArrowLeft) lastArrow = time;
    // moving forward slowly brings the camera back behind the worm
    if (keys.KeyW && time - lastArrow > 1) {
      camYaw = Math.atan2(Math.sin(camYaw), Math.cos(camYaw));
      camYaw *= Math.exp(-0.9 * dt);
    }
    zoom = Math.min(25, Math.max(0.5, zoom * Math.exp(((keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0)) * 1.3 * dt)));

    let upT: THREE.Vector3;
    if (sim.mode === 'dig') {
      tmp.set(0, 0, 0).addScaledVector(sim.d, -2.2 * zoom * L).addScaledVector(sim.u, 1.6 * zoom * L).applyAxisAngle(sim.u, camYaw);
      desired.copy(head).add(tmp);
      look.copy(head).addScaledVector(sim.d, 0.4 * Math.cos(camYaw));
      upT = sim.u;
    } else {
      // third-person orbit: behind-above, arrows spin around the skin normal; follows turns with a lag
      if (fCam.lengthSq() < 0.5) fCam.copy(sim.f);
      fCam.lerp(sim.f, damp(dt, 1.8));
      fCam.addScaledVector(sim.n, -fCam.dot(sim.n)).normalize();
      const dist = zoom * L * (1 + 1.1 * sim.rear); // standing up (S) backs the camera off
      const elev = 0.55 + camPitch; // the mouse lifts / lowers the camera round the worm
      tmp.set(0, 0, 0).addScaledVector(sim.n, Math.sin(elev) * 3.05 * dist).addScaledVector(fCam, -Math.cos(elev) * 3.05 * dist).applyAxisAngle(sim.n, camYaw);
      desired.copy(head).add(tmp);
      look.copy(head).addScaledVector(sim.n, 0.08 * zoom);
      upT = sim.n;
      if (sim.mode === 'fly') {
        // close-up of the winner rising and flapping, upright to the take-off point;
        // once it takes off the camera stays put and watches it shrink into the sky
        const up = sim.flyUpDir;
        if (sim.fx > 3.2) desired.copy(camPos);
        else desired.copy(head).addScaledVector(up, 1.0 * L).addScaledVector(sim.flyFacing, 3.8 * L);
        look.copy(head);
        upT = up;
      }
    }
    // someone else won: fly over and watch their take-off, then come back
    const winner = spectate && time < spectate.until ? remotes.get(spectate.id) : undefined;
    if (winner) {
      const wHead = winner.disp[N - 1];
      const wUp = tmpN.copy(wHead).normalize();
      const wL = L0 * winner.size;
      if (winner.fx > 3.2) desired.copy(camPos);
      else {
        // from where the camera is, keep a close side view of the winner
        tmp.subVectors(camPos, wHead);
        tmp.addScaledVector(wUp, -tmp.dot(wUp));
        if (tmp.lengthSq() < 1e-6) tmp.set(1, 0, 0);
        desired.copy(wHead).addScaledVector(wUp, 1.2 * wL).addScaledVector(tmp.normalize(), 3.8 * wL);
      }
      look.copy(wHead);
      upT = winner.fx >= 0 ? wUp.clone() : upT;
    }
    if (!camInit) {
      camPos.copy(desired);
      camUp.copy(upT);
      camInit = true;
    }
    camPos.lerp(desired, damp(dt, 3));
    // until the worm has burrowed in, the camera never goes under the skin
    if (sim.mode !== 'dig') {
      for (let i = 0; i < 3; i++) {
        const F = appleF(camPos);
        if (F >= 0.35) break;
        appleNormal(camPos, tmpN);
        camPos.addScaledVector(tmpN, 0.35 - F);
      }
    }
    pushOutOfPit(camPos, 0.4); // nor inside the pit
    camUp.lerp(upT, damp(dt, 3)).normalize();

    camera.position.copy(camPos);
    mtx.lookAt(camPos, look, camUp);
    camQ.setFromRotationMatrix(mtx);
    camera.quaternion.slerp(camQ, damp(dt, 7));
  }

  /** From the worm towards the camera: the winner turns its face to us. */
  function faceCamera() {
    return camera.position.clone().sub(sim.head);
  }

  function updateFruitLook(dt: number) {
    const inside = sim.mode === 'dig' ? 1 : 0;
    fruitUniforms.uWorm.value.copy(sim.head);
    fruitUniforms.uCutR.value = 1.5 * sim.L;
    fruitUniforms.uCut.value += (inside - fruitUniforms.uCut.value) * damp(dt, 3);
    // inside the fruit the x-ray view is always on; on the skin it's toggled with X
    fruitUniforms.uXray.value += ((xray || inside ? 1 : 0) - fruitUniforms.uXray.value) * damp(dt, 3);
    fruitUniforms.uInside.value += (inside - fruitUniforms.uInside.value) * damp(dt, 3);
    const camInside = smoothstep(0.05, -0.4, appleF(camera.position)) * (1 - fruitUniforms.uXray.value);
    fog.near = THREE.MathUtils.lerp(500, 2.5, camInside);
    fog.far = THREE.MathUtils.lerp(1000, 18, camInside);
    camLight.intensity = 2.5 * camInside;
    // macro depth of field: close camera → soft background, far → trees show up
    const blurT = THREE.MathUtils.clamp(0.3 - 0.14 * Math.log(zoom), 0.02, 0.5);
    skyBlur += (blurT - skyBlur) * damp(dt, 4);
    dome.update(skyBlur, camera.position);
  }

  function updateRemotes(dt: number) {
    const a = damp(dt, 12);
    for (const [id, r] of remotes) {
      if (time - r.last > 10) {
        removeRemote(id);
        continue;
      }
      // surface worms and burrowing worms can't see each other; a winner's flight is seen by all
      r.view.group.visible = r.mode === sim.mode || r.mode === 'fly' || sim.mode === 'fly';
      for (let k = 0; k < N; k++) r.disp[k].lerp(r.target[k], a);
      // the wings flap faster than updates arrive: run the flight clock locally
      const fx = r.fx >= 0 ? r.fx + (time - r.fxAt) : -1;
      poseWorm(r.view, r.disp, null, r.size, r.wave, fx);
      setStunGlow(r.view, stunnedUntil.get(id) ?? 0);
      placeLabel(r.view, r.disp[N - 1], tmpN.copy(r.disp[N - 1]).normalize(), r.size);
    }
  }

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let raf = 0;
  let sendT = 0;
  let flushT = 0;
  let fpsFrames = 0;
  let fpsT = 0;

  let perfMs = 0;
  let perfN = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const t0 = performance.now();
    const clockDt = clock.getDelta();
    const dt = Math.min(clockDt, 0.05);
    time += dt;

    const fxBefore = sim.fx;
    sim.update(dt, readInput(dt));
    maybeConfetti(fxBefore, sim.fx, sim.disp, sim.growth);
    // claim the win; if no answer comes (another win was being shown), claim again in 2 s
    if (sim.growth >= WIN_GROWTH && sim.mode !== 'fly' && time - winClaimedAt > 2) {
      winClaimedAt = time;
      net.send({ t: 'win', g: r3(sim.growth) });
    }
    poseWorm(myView, sim.disp, sim.ups, sim.growth, sim.wave, sim.fx);
    setStunGlow(myView, stunnedUntil.get(myId) ?? 0);
    // while flying the balls' "up" faces the camera, so put the tag above the head instead
    placeLabel(myView, sim.head, sim.mode === 'fly' ? tmpN.copy(sim.head).normalize() : sim.ups[N - 1], sim.growth * (sim.mode === 'fly' ? 1.8 : 1));
    updateCamera(dt);
    updateFruitLook(dt);
    tunnels.update(time);
    confetti.update(dt);
    impacts.update(dt);
    chimney(myId, sim.disp, sim.growth);
    for (const [id, r] of remotes) chimney(id, r.disp, r.size);
    puffs.update(dt);
    // ants: simulate (host) and draw (everyone)
    if (isHost) {
      const worms: WormInfo[] = [{ id: myId, mode: sim.mode, disp: sim.disp, stuck: webShakes > 0, g: sim.growth }];
      for (const [id, r] of remotes) worms.push({ id, mode: r.mode, disp: r.disp, stuck: r.stuck, g: r.size });
      const snaps = antSim.update(dt, worms, tunnels.list());
      antView.apply(snaps);
      const sendWebs = time - websSentAt > 0.5;
      if (sendWebs) {
        websSentAt = time;
        webs.set(antSim.webs());
      }
      if (time - antsSentAt > 0.1) {
        antsSentAt = time;
        net.send({ t: 'ants', a: snaps, w: sendWebs ? antSim.webs() : undefined });
      }
    }
    antView.update(
      dt,
      (id) => {
        if (id === myId) return { disp: sim.disp, size: sim.growth };
        const r = remotes.get(id);
        return r ? { disp: r.disp, size: r.size } : null;
      },
      (id) => tunnels.points(id),
    );
    if (pit) pit.object.visible = sim.mode === 'dig' || xray; // the pit shows while gnawing inside (or in x-ray)
    antView.setInside(sim.mode === 'dig');
    webs.setVisible(sim.mode !== 'dig');
    // stepped on a spider thread: stuck until 5 jerks (not while hopping over it)
    if (!webShakes && sim.mode === 'surface' && !sim.airborne && performance.now() > webFreeUntil) {
      if (webs.touches(sim.disp, (i) => RADII[i] * girth(sim.growth) * 1.3 + 0.03)) webShakes = WEB_SHAKES;
    }
    if (sim.mode !== 'surface') webShakes = 0; // inside you see the ants in the passages, outside those on the skin
    antsOnMe = sim.mode === 'fly' ? 0 : antView.attachedTo(myId, ANT);
    // ants in a passage drag the worm back towards them, slowly
    if (sim.mode === 'dig' && antsOnMe) sim.pullBack(0.12 * antsOnMe * dt);
    gripOnMe = sim.mode === 'surface' ? antView.ladybugGrip(myId) : null;

    // gnawing into a seed eats it (the server decides who was first); none while a seed bonus runs
    if (sim.mode === 'dig' && time - seedAskedAt > 0.5 && performance.now() >= seedBoostUntil) {
      const i = seeds ? seeds.hit(sim.head, 0.6 * sim.L) : -1;
      if (i >= 0) {
        seedAskedAt = time;
        net.send({ t: 'seed', i });
      }
    }
    updateRemotes(dt);
    for (const b of bots) b.update(dt);

    const now = performance.now();
    const stunned = (id: string) => Math.max(0, Math.ceil(((stunnedUntil.get(id) ?? 0) - now) / 1000));
    const panic = (id: string) => Math.max(0, Math.ceil(((amokOf.get(id) ?? 0) - now) / 1000));
    const roster: RosterRow[] = [
      { id: myId, name: myName, color: myColor, mode: sim.mode, me: true, score: score(sim.growth), myBot: false, stunned: stunned(myId), panic: panic(myId) },
    ];
    for (const [id, pl] of players) {
      const r = remotes.get(id);
      const myBot = bots.some((b) => b.serverId === id);
      roster.push({ id, name: pl.name, color: pl.color, mode: r?.mode ?? 'surface', me: false, score: score(r?.size ?? 1), myBot, stunned: stunned(id), panic: panic(id) });
    }
    updateHud({ web: webShakes, grip: gripOnMe ?? '', ants: antsOnMe, roster: JSON.stringify(roster), seedBoost: Math.max(0, Math.ceil((seedBoostUntil - performance.now()) / 1000)) });

    fpsFrames++;
    fpsT += clockDt;
    if (fpsT >= 0.5) {
      updateHud({ fps: Math.round(fpsFrames / fpsT) });
      fpsFrames = 0;
      fpsT = 0;
    }

    sendT += dt;
    if (sendT > (sim.mode === 'fly' ? 0.033 : 0.066)) { // a winner's flight goes out twice as often
      sendT = 0;
      const p: number[] = [];
      for (const v of sim.disp) p.push(r3(v.x), r3(v.y), r3(v.z));
      net.send({ t: 's', p, m: sim.mode, g: r3(sim.growth), w: r3(sim.wave), fx: r3(sim.fx), k: webShakes ? 1 : 0 });
    }
    flushT += dt;
    if (flushT > 0.25) {
      flushT = 0;
      flushTunnelPts();
    }
    renderer.render(scene, camera);
    perfMs += performance.now() - t0;
    if (++perfN > 120) {
      perfMs /= 2;
      perfN /= 2;
    }
  }
  frame();

  // console helpers in development: __worm() state, __wormFly() previews a victory, __wormPoints(25) sets my points
  if (process.env.NODE_ENV !== 'production') {
    const w = window as unknown as Record<string, unknown>;
    w.__wormFly = () => {
      sim.startVictory(faceCamera());
      later(4600, () => updateHud({ winner: myName, winnerMe: true }));
    };
    w.__wormPoints = (n: number) => {
      sim.growth = 1 + n / 100;
    };
    w.__botPoints = (n: number) => bots.forEach((b) => b.setPoints(n));
    w.__perf = () => ({ frameMs: +(perfMs / Math.max(1, perfN)).toFixed(2), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, px: [renderer.domElement.width, renderer.domElement.height] });
    w.__worm = () => ({
      mode: sim.mode,
      held: holdMouse,
      tunnels: tunnels.size,
      holes: holes.count,
      growth: sim.growth,
      wave: sim.wave,
      fx: sim.fx,
      bots: bots.map((b) => b.name),
      remotes: [...remotes].map(([id, r]) => ({ id, mode: r.mode, size: r.size, visible: r.view.group.visible })),
    });
  }

  /** Not bitten, stuck or running amok any more. */
  function clearAfflictions() {
    webShakes = 0;
    webFreeUntil = 0;
    amokUntil = 0;
  }

  const restartRound = (dir?: THREE.Vector3) => {
    updateHud({ winner: '', winnerMe: false });
    // a fresh start: nothing holds on from before
    clearAfflictions();
    frozenUntil = 0;
    stunnedUntil.delete(myId);
    amokOf.delete(myId);
    if (isHost) antSim.release(myId);
    else net.send({ t: 'free' });
    sim.restart(dir ?? freeSpot());
    camInit = false;
    camYaw = 0;
    camPitch = 0;
  };

  return {
    restartRoundForAll: () => net.send({ t: 'reset' }),
    addBot,
    removeBot,
    removeBots,
    restartRound,
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      for (const id of timers) clearTimeout(id);
      removeBots();
      net.close();
      for (const [t, ev, fn] of listeners) t.removeEventListener(ev, fn);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      tunnels.dispose();
      confetti.dispose();
      impacts.dispose();
      puffs.dispose();
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
      fruitMat.dispose();
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
  const stem = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 32, 0.028 * R0, 12, false),
    new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.9 }),
  );
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
