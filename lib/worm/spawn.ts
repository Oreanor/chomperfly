import * as THREE from 'three';

/** Round start: place i of n evenly around the fruit's equator, turned by `rot`. */
export function slotDir(i: number, n: number, rot: number) {
  const a = rot + (i / Math.max(1, n)) * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a), 0.1, Math.sin(a));
}

/** Joining mid-game: of some random spots, the one farthest from every worm already there. */
export function freeDir(others: THREE.Vector3[]) {
  let best = new THREE.Vector3(1, 0.1, 0);
  let bestD = -1;
  for (let i = 0; i < 32; i++) {
    const phi = Math.random() * Math.PI * 2;
    const d = new THREE.Vector3(Math.cos(phi), -0.3 + Math.random() * 0.7, Math.sin(phi)).normalize();
    let near = Infinity;
    for (const o of others) near = Math.min(near, d.angleTo(o));
    if (near > bestD) {
      bestD = near;
      best = d;
    }
  }
  return best;
}
