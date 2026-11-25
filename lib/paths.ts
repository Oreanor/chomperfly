// URLs of the site's own resources (public files, lobby API, WebSocket) with the base path in front,
// so the game also works from a subdirectory (NEXT_PUBLIC_BASE_PATH=/chomperfly). Same rule as lib/basePath.mjs.

const raw = (process.env.NEXT_PUBLIC_BASE_PATH || '').trim().replace(/^\/+|\/+$/g, '');

/** '' or e.g. '/chomperfly' */
export const BASE_PATH = raw ? '/' + raw : '';

/** '/api/rooms' -> '/chomperfly/api/rooms' */
export const withBase = (path: string) => BASE_PATH + (path.startsWith('/') ? path : '/' + path);

/** ws(s)://<this host><base>/<path> */
export const wsUrl = (path: string) => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + withBase(path);
