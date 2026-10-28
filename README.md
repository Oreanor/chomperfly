# Chomperfly

*[Русская версия](README.ru.md)*

A small online 3D game for 1–8 players in the browser. Each player is a worm on a big fruit hanging in an orchard. Crawl on the skin, gnaw tunnels inside, grow, and be the first to reach the room's goal (**300, 500 or 1000 points**, chosen when the room is created): the winner grows wings and flies away.

Built with Next.js, React and three.js, plus a small Node WebSocket server for multiplayer.

## Gameplay

- **On the skin** the worm crawls like an inchworm (pull the tail up, stretch the front forward). It can stand up on its tail to look around.
- **Burrowing in** (left mouse button) takes it inside the fruit. There it moves like a snake and gnaws a tunnel. The fruit turns see-through around you, and every passage shows up as a glass pipe.
- **Growing:** the worm grows only while it gnaws through flesh. A path as long as the fruit's diameter gives +50% size. Points = how much you have grown (+1% = 1 point).
- **Victory:** the first worm to reach the goal rises above the fruit, sprouts antennae and two pairs of wings, bursts into confetti and flies off. Everyone sees a victory dialog and a new round starts with all worms small again.
- **Hide and seek:** a worm on the skin can't see a worm inside the fruit, and vice versa. Name tags show through the fruit only when you are in the same layer.
- **Bites:** ramming another worm's flank with your head freezes it for 5 seconds. Head-on collisions don't count.
- **Bots** can fill empty places. They crawl, look around, burrow, gnaw and come back out, and they can win too.

## Lobby and rooms

After entering a name you get to the lobby:

- **Room list:** name, map (which fruit), players `n/max`, **Join**.
- **Create a room:** name, map, max players (2–8), number of bots (0–3).

A room lives while someone is in it and closes about a minute after the last player leaves. Its tunnels and holes live with it. In a room, ⎋ goes back to the lobby.

## Controls

| Key | Action |
|---|---|
| **W** | forward (crawl on the skin / gnaw inside) |
| **A / D** | turn (inside the fruit the mouse steers too; on the skin the mouse turns the camera) |
| **S** | stand up on the tail |
| **Shift** | run ×2 |
| **Space** | spring hop on the tail (over a spider web) |
| **Left mouse button** | burrow in / gnaw |
| **E / Q** | up / down inside the fruit |
| **← / →** | orbit the camera |
| **↑ / ↓ / wheel** | camera closer / farther |
| **V** | reset the view |
| **X** | x-ray on the skin (always on inside) |
| **N** | settings: name, language (EN/RU), theme |
| **H** | hide the key hints |

The first click in the game only captures the mouse (Esc releases it).

## Running it

Requires Node.js 20+.

```bash
npm install
npm run dev          # development, http://localhost:3000
npm run build && npm start   # production
```

The server prints the local network address. A friend on the same Wi-Fi opens it and joins your room from the lobby.

For players outside your network the simplest free option is a tunnel from your PC, e.g. `cloudflared tunnel --url http://localhost:3000`. To keep it running without your PC you need a host with a long-running Node process and WebSockets (a VPS, Railway, Render…). Serverless platforms like Vercel won't work: they don't keep WebSocket connections open.

## Adding a fruit (map)

1. Put a GLB model at `public/fruits/<name>.glb`. The stem should point up (+Y). The shape must be "star-shaped": every ray from the center hits the surface once (apple, pear, plum, orange are fine; a banana is not).
2. Optionally add an equirectangular sky panorama `public/sky/<name>.jpg` (2:1). The brightest spot becomes the sun direction.
3. Optionally add a display name in `lib/i18n.tsx` (`fruit.<name>`) and `components/Lobby.tsx` (`FRUIT_NAMES`).

The map appears in the lobby automatically. At load time the model is centred, scaled, its small bumps are smoothed out and its texture is re-baked into a spherical layout; worms crawl exactly on that smooth surface.

## Project structure

```
server.mjs              Next.js + WebSocket server: lobby API, rooms, relay, bites, wins
components/
  Game.tsx              React shell: name → lobby → game
  Lobby.tsx             room list and "create room"
  GameUI.tsx            in-game HUD and dialogs
  AccountDialogs.tsx    name prompt and settings
  ui/                   small UI kit (Button, Modal, Select, Segmented, Toast…)
lib/
  game/engine.ts        3D scene, input, camera, network, bots, victory
  worm/WormSim.ts       worm movement: inchworm, burrowing, growth, flight
  worm/Bot.ts           bot brain (plays over its own connection)
  worm/wormView.ts      worm look: balls, eyes, wings, antennae, name tags
  worm/constants.ts     tuning: sizes, speeds, win points
  render/               fruit and glass materials, tunnels, holes, sky, confetti
  apple.ts              fruit shape (radius by direction) used by the physics
  appleModel.ts         GLB loading, smoothing, texture re-baking
  bite.mjs              server-side bite check
  i18n.tsx, theme.tsx   languages and themes
```

In development the browser console has two helpers: `__worm()` shows the game state and `__wormFly()` previews the victory flight.
