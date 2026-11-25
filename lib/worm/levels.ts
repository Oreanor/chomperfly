// A room's difficulty: how many critters and how fierce. The server keeps the room's choice
// (server.mjs LEVELS) and scales the water drops by it; the host's critters read the rest here.

export const LEVELS = ['easy', 'medium', 'hard'] as const;
export type LevelName = (typeof LEVELS)[number];

export type Level = {
  every: [number, number, number, number]; // × the time between new critters: ants, ladybugs, spiders, earwigs
  max: [number, number, number, number]; // at most this many of each at once
  chase: number; // × how far ants and ladybugs notice a worm
  speed: number; // × critter speed
  earwigChase: number; // the earwig's speed on the skin, × a worm's
  earwigGrab: number; // chance it grabs with its pincers instead of biting
  earwigDrill: number; // × how often it dives and drills through the fruit at a gnawing worm
  loss: number; // × the points a critter takes
};

export const LEVEL: Record<LevelName, Level> = {
  easy: { every: [1.6, 1.6, 1.6, 2], max: [26, 4, 2, 1], chase: 0.75, speed: 0.9, earwigChase: 1.4, earwigGrab: 0.3, earwigDrill: 0.5, loss: 0.6 },
  medium: { every: [1, 1, 1, 1], max: [50, 8, 3, 1], chase: 1, speed: 1, earwigChase: 1.8, earwigGrab: 0.5, earwigDrill: 1, loss: 1 },
  hard: { every: [0.7, 0.65, 0.7, 0.75], max: [56, 9, 4, 2], chase: 1.3, speed: 1.12, earwigChase: 2.1, earwigGrab: 0.6, earwigDrill: 1.7, loss: 1.3 },
};
