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

function createRoom({ name, fruit, max, win }) {
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
    clients: new Map(),
    tunnels: new Map(),
    holes: [],
    seeds: null, // filled below, once the map is known
    totalPts: 0,
    winUntil: 0,
    host: null, // websocket of the client that simulates the ants
    emptySince: Date.now(),
  };
  room.seeds = new Array(seedCount(room.fruit)).fill(false);
  rooms.set(id, room);
  console.log(`room ${id} "${room.name}" created (${room.fruit}, max ${room.max})`);
  return room;
}

const roomInfo = (r) => ({ id: r.id, name: r.name, fruit: r.fruit, players: r.clients.size, max: r.max, win: r.win });

setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (!r.clients.size && now - r.emptySince > ROOM_IDLE_MS) {
      rooms.delete(r.id);
      console.log(`room ${r.id} closed`);
    }
  }
}, 10_000);

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
const seedAdd = (fruit) => fruitSpec(fruit).seeds?.add ?? 1;

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
  const color = COLORS.find((c) => !used.has(c)) ?? COLORS[0];
  // random ids: tunnels are keyed by player id, so ids must not repeat within a room
  let id;
  do id = 'w' + randomBytes(5).toString('hex');
  while ([...room.clients.values()].some((c) => c.id === id));
  const me = { id, color, name, bot: isBot, state: null, frozenUntil: 0, contacts: new Set(), updated: 0 };
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
      players: [...room.clients.values()].filter((c) => c !== me).map(({ id, color, name }) => ({ id, color, name })),
      tunnels: [...tunnels].map(([tid, t]) => ({ id: tid, pts: t.pts, r: t.r })),
      holes: room.holes,
      seeds: room.seeds,
    }),
  );
  broadcast(room, { t: 'join', id, color, name }, ws);
  if (newHost) broadcast(room, { t: 'host', id }, ws);
  console.log(`[${roomName}] ${name} joined (${room.clients.size}/${room.max})`);

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const now = Date.now();
    // a stunned worm doesn't move (its states are dropped); what it gnawed still counts (or a passage goes missing)
    if (now < me.frozenUntil && m.t === 's') return;
    /** A new passage of mine (ids are "<my id>-<n>"), told to everyone; null if it isn't mine or exists. */
    const startTunnel = (msg) => {
      if (typeof msg.id !== 'string' || !msg.id.startsWith(id + '-') || tunnels.has(msg.id)) return null;
      const r = typeof msg.r === 'number' && Number.isFinite(msg.r) ? Math.min(0.8, Math.max(0.03, msg.r)) : 0.15;
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
          const state = { t: 's', id, p: m.p, m: mode, g, w, fx, k: m.k ? 1 : 0, sp }; // k: stuck in a web, sp: seed speed
          const previous = me.state;
          me.state = state;
          me.updated = now;
          broadcast(room, state, ws, true);
          const moving = previous && Math.hypot(...state.p.slice(27).map((v, i) => v - previous.p[27 + i])) > 0.0005;
          for (const victim of room.clients.values()) {
            if (victim === me || !victim.state || now - victim.updated > 2000) continue;
            const touching = touchesFlank(state, victim.state);
            if (!touching) { me.contacts.delete(victim.id); continue; }
            // one bite per contact; an inchworm's head stands still part of each step, so wait for it to move
            // (the contact counts only once it bit: standing still against it doesn't use it up)
            if (moving && !me.contacts.has(victim.id) && now >= victim.frozenUntil) {
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
        for (const c of room.clients.values()) if (c.state) c.state.g = 1;
        room.tunnels.clear();
        room.holes = [];
        room.totalPts = 0;
        room.winUntil = 0;
        room.seeds.fill(false);
        // everyone's starting place: evenly around the fruit, in this order, turned at random
        broadcast(room, { t: 'reset', by: name, order: [...room.clients.values()].map((c) => c.id), rot: Math.random() * Math.PI * 2 });
        console.log(`[${roomName}] ${name} restarted the round`);
        break;
      case 'ants': // the host's ant snapshot
        if (ws === room.host && Array.isArray(m.a) && m.a.length <= 50) {
          room.antsAt = now;
          // spider threads: in full now and then (w), just the new bits in between (wd)
          const threads = (x) => (Array.isArray(x) && x.length <= 8 && x.every(isNums) ? x : undefined);
          broadcast(room, { t: 'ants', a: m.a, w: threads(m.w), wd: threads(m.wd) }, ws, true); // a lost bit: the next full set fixes it
        }
        break;
      case 'sting': // the host: a spider bit a worm stuck in its web → it runs amok for a while
        if (ws === room.host && typeof m.id === 'string') broadcast(room, { t: 'sting', id: m.id, k: Number.isInteger(m.k) ? Math.min(9, Math.max(0, m.k)) : 5, duration: 5000 });
        break;
      case 'shake': // someone shakes ants off / lashes a ladybug: the host decides
      case 'swat': // someone shoos critters with the tail
      case 'free': // someone starts the next round: critters let go of it
        if (room.host && room.host !== ws && room.host.readyState === 1) room.host.send(JSON.stringify({ t: m.t, id }));
        break;
      case 'seed': {
        // eaten by whoever gets there first, gone until the next round; the next one can be eaten right away
        const i = m.i;
        if (!Number.isInteger(i) || i < 0 || i >= room.seeds.length || room.seeds[i]) break;
        room.seeds[i] = true;
        broadcast(room, { t: 'seed', i, by: id, add: seedAdd(room.fruit) });
        break;
      }
      case 'win': // first to grow to WIN_GROWTH (the room goal in points) wins the round; everyone starts small again
        // the claim carries its size (the last state may be a frame older)
        if (now >= (room.winUntil || 0) && Math.max(me.state?.g ?? 1, Number(m.g) || 1) >= WIN_GROWTH - 0.01) {
          room.winUntil = now + 6000;
          // everyone's points start from 0 (newcomers see that too; the winner keeps its size for the flight)
          for (const c of room.clients.values()) if (c !== me && c.state) c.state.g = 1;
          // a new round on a fresh fruit: no passages or holes, all seeds back
          room.tunnels.clear();
          room.holes = [];
          room.totalPts = 0;
          room.seeds.fill(false);
          broadcast(room, { t: 'seeds', eaten: room.seeds });
          broadcast(room, { t: 'win', id, name });
          console.log(`[${roomName}] ${name} won`);
        }
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
