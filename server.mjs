// Next.js + WebSocket game server with a lobby: players create rooms (map, max players)
// or join one from the list. A room lives while someone is in it; its passages and holes live with it.
import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import next from 'next';
import { WebSocketServer } from 'ws';
import { PENALTY_MS, touchesFlank } from './lib/bite.mjs';

const dev = !process.argv.includes('--prod');
const port = Number(process.env.PORT) || 3000;
const MAX_POINTS = 3_000_000; // tunnel numbers per room
// the rules shared with the game (lib/rules.json)
const RULES = JSON.parse(readFileSync(new URL('./lib/rules.json', import.meta.url), 'utf8'));
const WIN_GROWTH = 1 + RULES.winSizeGain; // the size at the win
const ROOM_IDLE_MS = 60_000; // an empty room closes after this
const MSG_PER_SEC = 120; // more from one connection than this is a flood
const RESET_GAP_MS = 5000; // the round can be restarted at most this often
const COLORS = [0xe89a9a, 0x9ad0e8, 0xb8e89a, 0xe8d49a, 0xc79ae8, 0xe8b07a, 0x9ae8cf, 0xf0f0f0];

const app = next({ dev });
const handle = app.getRequestHandler();
await app.prepare();

// ---------- names & maps ----------

// same rule as lib/name.ts: letters, digits, space, _ . -
function cleanText(s, max) {
  const n = String(s ?? '').normalize('NFC').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s{2,}/g, ' ').slice(0, max).trim();
  return n.length >= 2 ? n : '';
}
const cleanName = (s) => cleanText(s, 16);

/** Playable maps = fruit models in public/fruits. */
function listFruits() {
  try {
    return readdirSync('public/fruits').filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4)).filter((n) => n in FRUITS && n !== '_about').filter((n) => /^[a-z0-9_-]{1,32}$/.test(n));
  } catch {
    return [];
  }
}

// ---------- rooms ----------

/** @type {Map<string, any>} */
const rooms = new Map();

const WIN_OPTIONS = RULES.winOptions; // a room's goal in points

const LIGHTS = ['morning', 'day', 'sunset', 'night']; // a room's time of day
const LEVELS = ['easy', 'medium', 'hard']; // a room's difficulty
const SIZES = ['small', 'standard', 'large']; // its fruit's size
function createRoom({ name, fruit, max, win, light, level, size, arena }) {
  const fruits = listFruits();
  let id;
  do id = randomBytes(3).toString('hex');
  while (rooms.has(id));
  const room = {
    id,
    name: cleanText(name, 24) || `Room ${id}`, // the lobby always sends a name in the player's language
    fruit: fruits.includes(fruit) ? fruit : fruits[0] || 'apple',
    max: Math.min(8, Math.max(2, Math.round(Number(max)) || 4)),
    key: randomBytes(12).toString('hex'), // its creator's secret: whoever has it may close the room
    win: WIN_OPTIONS.includes(Number(win)) ? Number(win) : RULES.winDefault,
    light: LIGHTS.includes(light) ? light : 'day',
    level: LEVELS.includes(level) ? level : 'medium',
    size: SIZES.includes(size) ? size : 'standard',
    arena: arena === true, // last one with life left, instead of a race to the goal
    clients: new Map(),
    tunnels: new Map(),
    holes: [],
    seeds: null, // filled below, once the map is known
    totalPts: 0,
    winUntil: 0,
    roundAt: Date.now(), // when this round began…
    roundEnd: 0, // …and ended (0 = still going)
    hadCompany: false, // arena: a bot or another player was in this round at some point
    drops: [], // water drops on the skin: { id, d: direction }
    host: null, // websocket of the client that simulates the ants
    emptySince: Date.now(),
  };
  room.seeds = new Array(seedCount(room.fruit)).fill(false);
  rooms.set(id, room);
  console.log(`room ${id} "${room.name}" created (${room.fruit}, max ${room.max})`);
  return room;
}

const roomInfo = (r) => ({ id: r.id, name: r.name, fruit: r.fruit, players: r.clients.size, max: r.max, win: r.win, light: r.light, level: r.level, size: r.size, arena: !!r.arena });

setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (!r.clients.size && now - r.emptySince > ROOM_IDLE_MS) {
      rooms.delete(r.id);
      console.log(`room ${r.id} closed`);
    }
  }
}, 10_000);

/**
 * A new round for everyone at once: passages, holes and points wiped, seeds back, everybody placed evenly
 * around the fruit (in this order, turned at random). afterWin: it follows a win (no "restarted" notice).
 */
function startRound(room, by, afterWin = false) {
  room.riders = new Set();
  const now = Date.now();
  room.resetAt = now;
  room.roundAt = now; // the round's clock starts
  room.roundEnd = 0;
  room.hadCompany = room.clients.size >= 2; // this round, so far: anyone else here already
  room.goAt = 0;
  room.ready = new Set();
  for (const c of room.clients.values()) {
    if (c.state) c.state.g = 1;
    c.out = false;
  }
  wipeTunnels(room);
  room.holes = [];
  room.totalPts = 0;
  room.winUntil = 0;
  room.seeds.fill(false);
  broadcast(room, { t: 'reset', by, after: afterWin ? 'win' : undefined, order: [...room.clients.values()].map((c) => c.id), rot: Math.random() * Math.PI * 2 });
}

// after a win: the victory flight (WIN_SHOW_MS), then everybody has this long to press OK
const WIN_SHOW_MS = 4600;
const READY_WAIT_MS = 15000;
/** Someone won. Same flight and the same next-round wait, race or arena. */
function declareWin(room, winner) {
  const now = Date.now();
  if (now < (room.winUntil || 0)) return;
  room.winUntil = now + 6000;
  for (const c of room.clients.values()) if (c !== winner && c.state) c.state.g = 1;
  wipeTunnels(room);
  room.holes = [];
  room.totalPts = 0;
  room.seeds.fill(false);
  broadcast(room, { t: 'seeds', eaten: room.seeds });
  winner.wins++;
  room.roundEnd = now;
  broadcast(room, { t: 'win', id: winner.id, name: winner.name, wins: winner.wins, roundMs: now - (room.roundAt || now) });
  room.ready = new Set();
  room.goAt = now + WIN_SHOW_MS + READY_WAIT_MS;
  checkReady(room);
  console.log(`[${room.name}] ${winner.name} won`);
}

const WIPE_SHOW_MS = 1200; // alone all round: no victory flight, the end card comes quickly
/** Arena, and this round never had a bot or another player: life at 0 ends it. No winner. */
function declareWipe(room) {
  const now = Date.now();
  if (room.roundEnd || now < (room.winUntil || 0)) return;
  room.winUntil = now + 6000;
  room.roundEnd = now;
  wipeTunnels(room);
  room.holes = [];
  room.totalPts = 0;
  room.seeds.fill(false);
  broadcast(room, { t: 'seeds', eaten: room.seeds });
  broadcast(room, { t: 'wipe', roundMs: now - (room.roundAt || now) });
  room.ready = new Set();
  room.goAt = now + WIPE_SHOW_MS + READY_WAIT_MS;
  checkReady(room);
  console.log(`[${room.name}] arena ended: alone, no life left`);
}

/**
 * Arena. A round that never had anyone else ends when the only worm hits 0.
 * A round that had a bot or another player ends the moment one is left standing: that one won.
 */
function arenaCheck(room) {
  if (!room.arena || room.roundEnd) return;
  const all = [...room.clients.values()];
  if (!all.length) return;
  if (!room.hadCompany) {
    if (all.length === 1 && all[0].out) declareWipe(room);
    return;
  }
  const alive = all.filter((c) => !c.out);
  if (alive.length === 1) declareWin(room, alive[0]);
}

function checkReady(room) {
  if (!room.goAt) return;
  const people = [...room.clients.values()].filter((c) => !c.bot);
  const n = people.filter((c) => room.ready.has(c.id)).length;
  if (people.length && n >= people.length) return startRound(room, '', true);
  broadcast(room, { t: 'ready', n, of: people.length, left: Math.max(0, room.goAt - Date.now()) });
}
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) if (r.goAt && now >= r.goAt) startRound(r, '', true);
}, 500);

/**
 * A new round: the passages are gone. Their ids are remembered, so points of theirs still on the way
 * (sent just before the reset) don't start them again as little stray bits of tube.
 */
function wipeTunnels(room) {
  room.deadTunnels = new Set([...(room.deadTunnels ?? []), ...room.tunnels.keys()].slice(-500));
  room.tunnels.clear();
}

const PIT_STUN_MS = 3000; // crashing into a peach pit

// water drops on the skin: one to three in every room; after one is picked up, another a while later
// (more and oftener on an easy room, fewer and rarer on a hard one)
const DROPS = { easy: { max: 8, every: [2500, 4500] }, medium: { max: 6, every: [4000, 7500] }, hard: { max: 4, every: [7000, 12000] } };
const dropRules = (room) => DROPS[room.level] ?? DROPS.medium;
function newDrop(room) {
  let x, y, z, l;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
    z = Math.random() * 2 - 1;
    l = Math.hypot(x, y, z);
  } while (l > 1 || l < 0.2 || Math.abs(y / l) > 0.85); // not at the stem or the bottom
  room.dropId = (room.dropId || 0) + 1;
  const d = { id: room.dropId, d: [x / l, y / l, z / l].map((v) => Math.round(v * 1000) / 1000) };
  room.drops.push(d);
  return d;
}
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    const dr = dropRules(r);
    if (!r.clients.size || r.drops.length >= dr.max) continue;
    if (r.drops.length > 0 && now < (r.nextDropAt || 0)) continue; // never none at all
    broadcast(r, { t: 'dropAdd', drop: newDrop(r) });
    r.nextDropAt = now + dr.every[0] + Math.random() * (dr.every[1] - dr.every[0]);
  }
}, 1000);

// the host went quiet (a background tab, a frozen browser): hand the ants to someone who's actually playing
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (!r.host || now - (r.antsAt || 0) < 3000) continue;
    const next = [...r.clients].find(([w, c]) => w !== r.host && !c.bot && now - c.updated < 2000);
    if (!next) continue;
    r.host = next[0];
    r.antsAt = now; // give the new one time to start
    console.log(`room ${r.id}: ants handed over to ${next[1].name}`);
    broadcast(r, { t: 'host', id: next[1].id });
  }
}, 1000);

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

const LAG_BYTES = 64 * 1024; // a client this far behind skips the frequent updates (fresher ones follow)

/**
 * To everyone in the room (but `except`). lossy: a frequent update that the next one replaces (worm
 * states, critters): a client whose connection is lagging doesn't get it, so its queue doesn't grow.
 */
function broadcast(room, msg, except, lossy = false) {
  const s = JSON.stringify(msg);
  for (const ws of room.clients.keys()) {
    if (ws === except || ws.readyState !== 1) continue;
    if (lossy && ws.bufferedAmount > LAG_BYTES) continue;
    ws.send(s);
  }
}

// what each fruit has inside: lib/fruits.json (shared with the game)
const FRUITS = JSON.parse(readFileSync(new URL('./lib/fruits.json', import.meta.url), 'utf8'));
const fruitSpec = (fruit) => (fruit !== '_about' && FRUITS[fruit]) || {};
const seedCount = (fruit) => fruitSpec(fruit).seeds?.count ?? 0;
const seedPoints = (fruit) => fruitSpec(fruit).seeds?.points ?? 0; // a seed eaten: points (< 0: bitter)

/** Is any ball of the victim near the back half of the lasher (with leeway: states lag a little)? */
function inLashReach(a, v) {
  const reach = 1.6 * Math.max(a.g, 1) * 1.6; // a body length or so, for a big worm more, plus slack
  for (let k = 0; k < 5; k++) {
    for (let j = 0; j < 10; j++) {
      const d = Math.hypot(a.p[k * 3] - v.p[j * 3], a.p[k * 3 + 1] - v.p[j * 3 + 1], a.p[k * 3 + 2] - v.p[j * 3 + 2]);
      if (d < reach) return true;
    }
  }
  return false;
}

const isNums = (a) => Array.isArray(a) && a.every((v) => typeof v === 'number' && Number.isFinite(v));

wss.on('connection', (ws, req) => {
  const params = new URL(req.url || '/ws', 'http://x').searchParams;
  const name = cleanName(params.get('name')) || 'worm';
  const isBot = params.get('bot') === '1';
  const room = rooms.get(params.get('room') || '');
  if (!room) {
    ws.send(JSON.stringify({ t: 'noroom' }));
    ws.close();
    return;
  }
  const roomName = room.id;
  if (room.clients.size >= room.max) {
    ws.send(JSON.stringify({ t: 'full' }));
    ws.close();
    return;
  }
  const used = new Set([...room.clients.values()].map((c) => c.color));
  // the colour the player picked (6 hex digits), else the first free one of the palette
  const asked = /^[0-9a-f]{6}$/i.test(params.get('color') || '') ? parseInt(params.get('color'), 16) : null;
  const color = asked ?? COLORS.find((c) => !used.has(c)) ?? COLORS[0];
  // random ids: tunnels are keyed by player id, so ids must not repeat within a room
  let id;
  do id = 'w' + randomBytes(5).toString('hex');
  while ([...room.clients.values()].some((c) => c.id === id));
  const me = { id, color, name, bot: isBot, state: null, frozenUntil: 0, contacts: new Set(), updated: 0, wins: 0, out: false }; // wins: rounds won here; out: arena, life gone
  room.clients.set(ws, me);
  // the first person in the room simulates the ants for everyone (bots never do)
  const newHost = !room.host && !isBot;
  if (newHost) {
    room.host = ws;
    room.antsAt = Date.now();
  }
  const { tunnels } = room;

  ws.send(
    JSON.stringify({
      t: 'welcome',
      id,
      color,
      room: roomInfo(room),
      host: room.host ? room.clients.get(room.host)?.id ?? '' : '',
      players: [...room.clients.values()].filter((c) => c !== me).map(({ id, color, name, wins }) => ({ id, color, name, wins })),
      tunnels: [...tunnels].map(([tid, t]) => ({ id: tid, pts: t.pts, r: t.r })),
      holes: room.holes,
      seeds: room.seeds,
      drops: room.drops,
      // the round's clock: how long it has been going (or how long it took, if it's over)
      roundMs: (room.roundEnd || Date.now()) - (room.roundAt || Date.now()),
      roundOver: !!room.roundEnd,
    }),
  );
  if (room.clients.size >= 2) room.hadCompany = true; // this round had someone else, even if they leave
  broadcast(room, { t: 'join', id, color, name }, ws);
  if (newHost) broadcast(room, { t: 'host', id }, ws);
  console.log(`[${roomName}] ${name} joined (${room.clients.size}/${room.max})`);

  let msgWindow = Date.now();
  let msgCount = 0;
  ws.on('message', (raw) => {
    const now = Date.now();
    // a fair game sends ~30 messages a second; far more is a flood: dropped
    if (now - msgWindow > 1000) {
      msgWindow = now;
      msgCount = 0;
    }
    if (++msgCount > MSG_PER_SEC) return;
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // (a stunned worm freezes itself; its states keep coming, so everyone sees it where it really is)
    /** A new passage of mine (ids are "<my id>-<n>"), told to everyone; null if it isn't mine or exists. */
    const startTunnel = (msg) => {
      if (typeof msg.id !== 'string' || !msg.id.startsWith(id + '-') || tunnels.has(msg.id)) return null;
      if (room.deadTunnels?.has(msg.id)) return null; // a passage from the last round: its late points are dropped
      const r = typeof msg.r === 'number' && Number.isFinite(msg.r) ? Math.min(1.2, Math.max(0.03, msg.r)) : 0.2;
      const t = { owner: id, pts: [], r };
      tunnels.set(msg.id, t);
      broadcast(room, { t: 'ts', id: msg.id, r }, ws);
      return t;
    };
    switch (m.t) {
      case 's': // worm state, relayed as is (~15/s)
        if (isNums(m.p) && m.p.length === 30) {
          const g = typeof m.g === 'number' && Number.isFinite(m.g) ? Math.min(3, Math.max(1, m.g)) : 1;
          const w = typeof m.w === 'number' && Number.isFinite(m.w) ? Math.min(20, Math.max(-1, m.w)) : -1;
          const mode = m.m === 'dig' || m.m === 'fly' ? m.m : 'surface';
          const fx = typeof m.fx === 'number' && Number.isFinite(m.fx) ? Math.min(10, Math.max(-1, m.fx)) : -1;
          const sp = typeof m.sp === 'number' && Number.isFinite(m.sp) ? Math.min(100, Math.max(1, m.sp)) : 1;
          const hp = typeof m.hp === 'number' && Number.isFinite(m.hp) ? Math.max(0, Math.min(1000, Math.round(m.hp))) : undefined;
          const state = { t: 's', id, p: m.p, m: mode, g, w, fx, k: m.k ? 1 : 0, sp, rr: m.rr ? 1 : 0, iv: m.iv === 2 ? 2 : m.iv ? 1 : 0, ...(hp !== undefined ? { hp } : {}) }; // iv: shielded (2: running out) // k: stuck in a web, sp: seed speed, rr: standing up, hp: arena life
          const previous = me.state;
          me.state = state;
          me.updated = now;
          broadcast(room, state, ws, true);
          if (room.arena && hp === 0 && !me.out) {
            me.out = true;
            broadcast(room, { t: 'out', id });
            arenaCheck(room);
          }
          const moving = previous && Math.hypot(...state.p.slice(27).map((v, i) => v - previous.p[27 + i])) > 0.0005;
          for (const victim of room.clients.values()) {
            if (victim === me || !victim.state || now - victim.updated > 2000 || room.riders?.has(victim.id)) continue;
            const touching = touchesFlank(state, victim.state);
            if (!touching) { me.contacts.delete(victim.id); continue; }
            // one bite per contact; an inchworm's head stands still part of each step, so wait for it to move
            // (the contact counts only once it bit: standing still against it doesn't use it up)
            if (moving && !me.contacts.has(victim.id) && now >= victim.frozenUntil && !victim.out) {
              victim.frozenUntil = now + PENALTY_MS;
              broadcast(room, { t: 'bite', id: victim.id, by: id, duration: PENALTY_MS });
              me.contacts.add(victim.id);
            }
          }
        }
        break;
      case 'ts': // tunnel start
        startTunnel(m);
        break;
      case 'tp': {
        // tunnel points (a passage whose start got lost is started here)
        const t = tunnels.get(m.id) ?? startTunnel(m);
        if (!t || t.owner !== id || !isNums(m.pts) || m.pts.length % 3) break;
        if (room.totalPts + m.pts.length > MAX_POINTS) break;
        t.pts.push(...m.pts);
        room.totalPts += m.pts.length;
        broadcast(room, { t: 'tp', id: m.id, pts: m.pts }, ws);
        break;
      }
      case 'reset': // restart the round for everyone: passages, holes and points wiped, seeds back
        if (now - (room.resetAt || 0) < RESET_GAP_MS) break; // not over and over
        startRound(room, name);
        console.log(`[${roomName}] ${name} restarted the round`);
        break;
      case 'ready': // after a win: I pressed OK (the next round starts once everybody has, or the time is up)
        if (room.goAt && !me.bot) {
          room.ready.add(id);
          checkReady(room);
        }
        break;
      case 'gonow': // after a win: the room's creator starts the next round without waiting
        if (room.goAt && m.key === room.key) {
          startRound(room, '', true);
          console.log(`[${roomName}] ${name} started the next round`);
        }
        break;
      case 'ants': // the host's ant snapshot
        if (ws === room.host && Array.isArray(m.a) && m.a.length <= 64) {
          room.antsAt = now;
          room.riders = new Set(m.a.filter((a) => Array.isArray(a) && a[11] === 4 && typeof a[8] === 'string' && a[8]).map((a) => a[8]));
          // spider threads: in full now and then (w), just the new bits in between (wd)
          const threads = (x) => (Array.isArray(x) && x.length <= 8 && x.every(isNums) ? x : undefined);
          broadcast(room, { t: 'ants', a: m.a, w: threads(m.w), wd: threads(m.wd) }, ws, true); // a lost bit: the next full set fixes it
        }
        break;
      case 'sting': // the host: a spider bit a worm stuck in its web → it runs amok for a while
        if (room.riders?.has(m.id)) break;
        if (ws === room.host && typeof m.id === 'string') broadcast(room, { t: 'sting', id: m.id, k: Number.isInteger(m.k) ? Math.min(9, Math.max(0, m.k)) : 5, duration: 5000 });
        break;
      case 'earwig': // the host: an earwig bit a worm (or drilled through it): points lost, maybe stunned
        if (room.riders?.has(m.id)) break;
        if (ws === room.host && typeof m.id === 'string') {
          const how = ['grab', 'drill', 'drop'].includes(m.how) ? m.how : 'bite';
          broadcast(room, { t: 'earwig', id: m.id, pts: Math.min(60, Math.max(0, Number(m.pts) || 0)), how });
        }
        break;
      case 'antbite': // the host: an ant riding a worm bit it → it bolts for a moment
        if (room.riders?.has(m.id)) break;
        if (ws === room.host && typeof m.id === 'string') broadcast(room, { t: 'antbite', id: m.id, k: Number.isInteger(m.k) ? Math.min(9, Math.max(0, m.k)) : 5, duration: 3000 });
        break;
      case 'out': // arena: my life hit 0
        if (!room.arena || me.out) break;
        me.out = true;
        broadcast(room, { t: 'out', id });
        arenaCheck(room);
        break;
      case 'ram': { // my rocket hit a worm: knocked senseless (arena: on the skin too, the plunge goes through)
        const victim = [...room.clients.values()].find((c) => c.id === m.id);
        if (!victim || victim === me || !me.state || !victim.state || me.state.m !== 'dig' || victim.out || now < victim.frozenUntil) break;
        if (!room.arena && victim.state.m !== 'dig') break;
        const hx = me.state.p[27], hy = me.state.p[28], hz = me.state.p[29];
        let near = false;
        for (let k = 0; k < 10 && !near; k++) near = Math.hypot(victim.state.p[k * 3] - hx, victim.state.p[k * 3 + 1] - hy, victim.state.p[k * 3 + 2] - hz) < 2.5 * Math.max(1, me.state.g);
        if (!near) break;
        victim.frozenUntil = now + PENALTY_MS;
        broadcast(room, { t: 'bite', id: victim.id, by: id, duration: PENALTY_MS, lash: 1 });
        break;
      }
      case 'ramat': // my rocket's head here: the host knocks the critters in its way
        if (isNums(m.at) && m.at.length === 3 && room.host && room.host !== ws && room.host.readyState === 1) {
          room.host.send(JSON.stringify({ t: 'ramat', id, at: m.at, r: Math.min(3, Math.max(0.2, Number(m.r) || 0.6)) }));
        }
        break;
      case 'slam': { // I slammed a ladybug against the skin: worms right under it are hit (and flung aside)
        if (!isNums(m.at) || m.at.length !== 3 || !me.state || me.state.m !== 'surface') break;
        if (now < (me.slamAt || 0) + 300) break;
        me.slamAt = now;
        const r = Math.min(4, Math.max(0.3, Number(m.r) || 1));
        for (const victim of room.clients.values()) {
          if (victim === me || !victim.state || victim.state.m !== 'surface' || now < victim.frozenUntil || room.riders?.has(victim.id)) continue;
          let near = false;
          for (let k = 0; k < 10 && !near; k++) near = Math.hypot(victim.state.p[k * 3] - m.at[0], victim.state.p[k * 3 + 1] - m.at[1], victim.state.p[k * 3 + 2] - m.at[2]) < r;
          if (!near || victim.out) continue;
          victim.frozenUntil = now + PENALTY_MS;
          broadcast(room, { t: 'bite', id: victim.id, by: id, duration: PENALTY_MS, lash: 1, from: m.at });
        }
        // the critters under it: the host knocks them away
        if (room.host && room.host !== ws && room.host.readyState === 1) room.host.send(JSON.stringify({ t: 'slam', id, at: m.at, r }));
        break;
      }
      case 'lash': { // my tail swipe caught a worm: stunned, if it really was in reach
        const victim = [...room.clients.values()].find((c) => c.id === m.id);
        if (!victim || victim === me || !me.state || !victim.state || me.state.m !== 'surface' || victim.state.m !== 'surface' || victim.out) break;
        if (now < victim.frozenUntil || now < (me.lashAt || 0) + 280) break;
        if (!inLashReach(me.state, victim.state)) break;
        me.lashAt = now;
        if (room.riders?.has(victim.id)) {
          room.riders.delete(victim.id);
          broadcast(room, { t: 'unseat', id: victim.id, by: id });
          break;
        }
        victim.frozenUntil = now + PENALTY_MS;
        broadcast(room, { t: 'bite', id: victim.id, by: id, duration: PENALTY_MS, lash: 1 });
        break;
      }
      case 'ride': // riding the chafer (climbing on / off, a bite, steering): the host decides
        if (room.host && room.host !== ws && room.host.readyState === 1) {
          room.host.send(JSON.stringify({ t: 'ride', id, on: !!m.on, off: !!m.off, bite: !!m.bite, scoot: !!m.scoot, turn: Number.isFinite(m.turn) ? Math.max(-1, Math.min(1, m.turn)) : 0 }));
        }
        break;
      case 'chafer': { // the host: the bolting chafer ran over a worm: stunned for everyone
        if (room.riders?.has(m.id)) break;
        if (ws !== room.host || typeof m.id !== 'string') break;
        const victim = [...room.clients.values()].find((c) => c.id === m.id);
        if (victim?.out) break;
        if (victim) victim.frozenUntil = now + 5000;
        broadcast(room, { t: 'bite', id: m.id, by: 'chafer', duration: 5000 });
        break;
      }
      case 'shake': // someone shakes ants off / lashes a ladybug: the host decides
      case 'swat': // someone shoos critters with the tail
      case 'free': // someone starts the next round: critters let go of it
        if (room.host && room.host !== ws && room.host.readyState === 1) {
          const at = m.t === 'swat' && isNums(m.at) && m.at.length === 3 ? m.at : undefined;
          const r = m.t === 'swat' && Number.isFinite(Number(m.r)) ? Math.min(4, Math.max(0.2, Number(m.r))) : undefined;
          room.host.send(JSON.stringify({ t: m.t, id, bite: m.t === 'swat' && !!m.bite, clap: m.t === 'swat' && !!m.clap, one: m.t === 'free' && !!m.one, ...(at ? { at, r } : {}) }));
        }
        break;
      case 'pit': { // gnawed head-on into the peach pit: stunned for a moment (everyone sees it)
        if (!me.state || me.state.m !== 'dig' || now < me.frozenUntil) break;
        me.frozenUntil = now + PIT_STUN_MS;
        broadcast(room, { t: 'bite', id, by: 'pit', duration: PIT_STUN_MS });
        break;
      }
      case 'drop': { // picked up a water drop: gone (another comes in a while)
        const k = room.drops.findIndex((d) => d.id === m.id);
        if (k < 0) break;
        room.drops.splice(k, 1);
        const dr = dropRules(room);
        room.nextDropAt = Math.max(room.nextDropAt || 0, now + dr.every[0] + Math.random() * (dr.every[1] - dr.every[0]));
        broadcast(room, { t: 'drop', id: m.id, by: id });
        break;
      }
      case 'seed': {
        // eaten by whoever gets there first, gone until the next round; the next one can be eaten right away
        const i = m.i;
        if (!Number.isInteger(i) || i < 0 || i >= room.seeds.length || room.seeds[i]) break;
        room.seeds[i] = true;
        broadcast(room, { t: 'seed', i, by: id, points: seedPoints(room.fruit) });
        break;
      }
      case 'win': // first to grow to WIN_GROWTH wins the round. An arena ignores this: last one alive, from arenaCheck
        if (room.arena) break;
        if (now >= (room.winUntil || 0) && Math.max(me.state?.g ?? 1, Number(m.g) || 1) >= WIN_GROWTH - 0.01) declareWin(room, me);
        break;
      case 'h': // hole in the skin
        if (isNums(m.h) && (m.h.length === 6 || m.h.length === 7) && room.holes.length < 20000) {
          room.holes.push(m.h);
          broadcast(room, { t: 'h', h: m.h }, ws);
        }
        break;
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    if (room.host === ws) {
      // hand the ants over to the next person
      const next = [...room.clients].find(([, c]) => !c.bot);
      room.host = next ? next[0] : null;
      room.antsAt = Date.now();
      broadcast(room, { t: 'host', id: next ? next[1].id : '' });
    }
    if (!room.clients.size) room.emptySince = Date.now();
    broadcast(room, { t: 'leave', id });
    if (room.goAt) checkReady(room); // maybe the one everybody waited for
    arenaCheck(room); // the one left, after a bot or another player was here, has won
    console.log(`[${roomName}] ${name} left`);
  });
});

// ---------- lobby API ----------

function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function api(req, res) {
  if (req.url === '/api/fruits' && req.method === 'GET') return json(res, 200, listFruits());
  if (req.url === '/api/rooms' && req.method === 'GET') {
    return json(res, 200, [...rooms.values()].map(roomInfo).sort((a, b) => b.players - a.players));
  }
  if (req.url === '/api/rooms' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 2000) req.destroy();
    });
    req.on('end', () => {
      let o = {};
      try {
        o = JSON.parse(body);
      } catch {}
      if (rooms.size >= 200) return json(res, 503, { error: 'too many rooms' });
      const room = createRoom(o);
      json(res, 200, { ...roomInfo(room), key: room.key }); // only the creator ever sees the key
    });
    return;
  }
  // DELETE /api/rooms/<id>?key=<key>: the creator closes the room; anyone inside goes back to the lobby
  const del = req.method === 'DELETE' && /^\/api\/rooms\/([0-9a-f]{6})\?key=([0-9a-f]{24})$/.exec(req.url || '');
  if (del) {
    const room = rooms.get(del[1]);
    if (!room) return json(res, 404, { error: 'no such room' });
    if (room.key !== del[2]) return json(res, 403, { error: 'not yours' });
    rooms.delete(room.id);
    for (const ws of room.clients.keys()) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'noroom' }));
      ws.close();
    }
    console.log(`room ${room.id} closed by its creator`);
    return json(res, 200, { ok: true });
  }
  handle(req, res);
}

const server = createServer(api);
const nextUpgrade = app.getUpgradeHandler();
server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/ws')) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    nextUpgrade(req, socket, head);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`\n  Worm-in-apple ready (${dev ? 'dev' : 'prod'})`);
  console.log(`  local:   http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  network: http://${a.address}:${port}`);
    }
  }
  console.log('');
});
