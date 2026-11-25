// A worm's colour: one hue (0…359), turned into a soft, light colour (the same for everyone).

/** The key the chosen hue is remembered under. */
export const HUE_KEY = 'wormHue';

/** A pastel colour of hue h (degrees): HSL-like, all equally light. */
export function hueColor(h: number) {
  const ch = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (0.74 - 0.1612 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (ch(0) << 16) | (ch(8) << 8) | ch(4);
}

export const hexColor = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** The whole range as a CSS gradient (for the picker). */
export const HUE_GRADIENT = `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) => hexColor(hueColor(i * 30))).join(', ')})`;
