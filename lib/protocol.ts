/**
 * What the game says to the server over the WebSocket (server.mjs checks every field again).
 * Points are flat number arrays [x, y, z, x, y, z, …] rounded to 0.001.
 */
export type ClientMsg =
  // my worm, ~15 times a second (30 in the victory flight): 10 balls, mode, growth, swallowing wave,
  // victory clock, stuck in a web (k), speed factor from seeds (sp)
  | { t: 's'; p: number[]; m: 'surface' | 'dig' | 'fly'; g: number; w: number; fx: number; k: 0 | 1; sp: number }
  | { t: 'ts'; id: string; r: number } // a new passage (id, radius)
  | { t: 'tp'; id: string; pts: number[]; r: number } // more points of my passage (r: in case its start got lost)
  | { t: 'h'; h: number[] } // a hole in the skin: x, y, z, normal x, y, z, radius
  | { t: 'seed'; i: number } // I bit seed i (the server says who was first)
  | { t: 'win'; g: number } // I reached the goal (with my growth, in case the last state is older)
  | { t: 'reset' } // restart the round for everyone
  | { t: 'free' } // I start the next round: critters, let go of me
  | { t: 'shake' | 'swat' } // I shake critters off / swat with the tail (the host decides)
  // the host only: the critters (see AntSnap), spider threads in full (w) or just the new bits (wd)
  | { t: 'ants'; a: unknown[]; w?: number[][]; wd?: number[][] }
  | { t: 'sting'; id: string; k: number }; // the host only: a spider bit worm `id` at ball k
