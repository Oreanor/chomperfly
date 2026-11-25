/**
 * What the game says to the server over the WebSocket (server.mjs checks every field again).
 * Points are flat number arrays [x, y, z, x, y, z, …] rounded to 0.001.
 */
export type ClientMsg =
  // my worm, ~15 times a second (30 in the victory flight): 10 balls, mode, growth, swallowing wave,
  // victory clock, stuck in a web (k), speed factor (sp), standing on the tail (rr), untouchable (iv: 1, 2 = the
  // last 2 s), the arena: life (hp)
  | { t: 's'; p: number[]; m: 'surface' | 'dig' | 'fly'; g: number; w: number; fx: number; k: 0 | 1; sp: number; rr: number; iv: number; hp?: number }
  | { t: 'ts'; id: string; r: number } // a new passage (id, radius)
  | { t: 'tp'; id: string; pts: number[]; r: number } // more points of my passage (r: in case its start got lost)
  | { t: 'h'; h: number[] } // a hole in the skin: x, y, z, normal x, y, z, radius
  | { t: 'seed'; i: number } // I bit seed i (the server says who was first)
  | { t: 'drop'; id: number } // I drank water drop id
  | { t: 'win'; g: number } // I reached the goal (with my growth, in case the last state is older)
  | { t: 'out' } // arena: my life hit 0
  | { t: 'reset' } // restart the round for everyone
  | { t: 'ready' } // after a round: OK, I'm ready for the next one
  | { t: 'gonow'; key: string } // the room's creator: start the next round now
  | { t: 'free'; one?: boolean } // critters, let go of me (one: just one ant, the rocket shakes them off)
  | { t: 'shake' } // I shake critters off / lash a ladybug (the host decides)
  // I swat with the tail: round my body (bite: it was a bite at a critter ahead), at a point (at, r), or clap two ladybugs
  | { t: 'swat'; bite?: boolean; at?: number[]; r?: number; clap?: boolean }
  | { t: 'lash'; id: string } // my tail caught worm `id`
  | { t: 'slam'; at: number[]; r: number } // I slammed a ladybug on the skin here
  | { t: 'ram'; id: string } // my rocket hit worm `id`
  | { t: 'ramat'; at: number[]; r: number } // my rocket's head here (critters in the way)
  | { t: 'ride'; on?: boolean; off?: boolean; scoot?: boolean; bite?: boolean; turn?: number } // on the chafer
  // the host only: the critters (see AntSnap), spider threads in full (w) or just the new bits (wd)
  | { t: 'ants'; a: unknown[]; w?: number[][]; wd?: number[][] }
  | { t: 'sting'; id: string; k: number } // the host only: a spider bit worm `id` at ball k
  | { t: 'antbite'; id: string; k: number } // the host only: an ant on worm `id` bit it
  | { t: 'earwig'; id: string; pts: number; how: string } // the host only: the earwig bit / grabbed / dropped / drilled `id`
  | { t: 'chafer'; id: string }; // the host only: the chafer ran over worm `id`
