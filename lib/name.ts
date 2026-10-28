// Player names: letters of any alphabet, digits, space and _ . -  (2–16 chars).
// Everything else (emoji, control/invisible/bidi characters, markup) is dropped.
// The server repeats the same check in server.mjs.

export const NAME_MIN = 2;
export const NAME_MAX = 16;

const DISALLOWED = /[^\p{L}\p{N} _.\-]/gu;

/** While typing: drop disallowed characters, keep spaces so words can be typed. */
export function filterNameInput(s: string): string {
  return s.normalize('NFC').replace(DISALLOWED, '').replace(/\s{2,}/g, ' ').slice(0, NAME_MAX);
}

/** Final form, or '' if the name is not acceptable. */
export function cleanName(s: string): string {
  const n = filterNameInput(s).trim();
  return n.length >= NAME_MIN ? n : '';
}
