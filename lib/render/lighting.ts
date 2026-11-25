// A room's time of day: how the orchard is lit. The server keeps the room's choice (server.mjs LIGHTS).

export const LIGHTS = ['morning', 'day', 'sunset', 'night'] as const;
export type LightName = (typeof LIGHTS)[number];

export type Lighting = {
  sunElev: number | null; // degrees above the horizon; null = the panorama's own sun (night: the moon)
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  envIntensity: number; // reflections of the sky
  skyTint: [number, number, number]; // the panorama, multiplied
  skyIntensity: number;
  skyMoon: number; // 1 = the night sky shader (moonlit, a moon)
  exposure: number;
  ambient: number;
  ambientIntensity: number;
};

export const LIGHTING: Record<LightName, Lighting> = {
  morning: {
    sunElev: 12,
    sunColor: 0xffc9a8,
    sunIntensity: 2.3,
    hemiSky: 0xa9c8ff,
    hemiGround: 0x2c3448,
    hemiIntensity: 0.55,
    envIntensity: 0.35,
    skyTint: [0.8, 0.92, 1.25],
    skyIntensity: 0.8,
    skyMoon: 0,
    exposure: 0.92,
    ambient: 0x9db8ff,
    ambientIntensity: 0.16,
  },
  day: {
    sunElev: 62,
    sunColor: 0xfffaf0,
    sunIntensity: 3.8,
    hemiSky: 0xffffff,
    hemiGround: 0x2a2a2a,
    hemiIntensity: 0.18,
    envIntensity: 0.6,
    skyTint: [1.02, 1.02, 1],
    skyIntensity: 0.95,
    skyMoon: 0,
    exposure: 1.05,
    ambient: 0xffffff,
    ambientIntensity: 0.08,
  },
  sunset: {
    sunElev: 5,
    sunColor: 0xffa070,
    sunIntensity: 3.1,
    hemiSky: 0xffb48c,
    hemiGround: 0x3a2040,
    hemiIntensity: 0.38,
    envIntensity: 0.32,
    skyTint: [1.32, 0.86, 0.66],
    skyIntensity: 0.8,
    skyMoon: 0,
    exposure: 0.92,
    ambient: 0xc890b8,
    ambientIntensity: 0.12,
  },
  night: {
    sunElev: null,
    sunColor: 0xc5d8f0,
    sunIntensity: 0.8,
    hemiSky: 0x6a8ec4,
    hemiGround: 0x1c2c4a,
    hemiIntensity: 0.5,
    envIntensity: 0.05,
    skyTint: [1, 1, 1],
    skyIntensity: 0.88,
    skyMoon: 1,
    exposure: 0.76,
    ambient: 0x6884b0,
    ambientIntensity: 0.2,
  },
};
