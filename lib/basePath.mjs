// Where the site lives: '' (the root) or a prefix like '/chomperfly', from NEXT_PUBLIC_BASE_PATH.
// Shared by next.config.mjs and server.mjs; the browser side uses lib/paths.ts.

/** '' | '/' -> '', 'chomperfly/' -> '/chomperfly' */
export function normalizeBasePath(v) {
  const s = String(v ?? '').trim().replace(/^\/+|\/+$/g, '');
  return s ? '/' + s : '';
}

export const BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
