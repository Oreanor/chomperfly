import data from './fruits.json';

/** What a fruit has inside (see lib/fruits.json). */
export type FruitSpec = {
  flesh?: string; // '#rrggbb'
  // points: what eating one does to your score (seeds are bitter: < 0); y: height × the fruit's radius
  // (else its widest part); size: × the usual seed size
  seeds?: { kind: 'star' | 'arils'; count: number; points: number; y?: number; size?: number };
  pit?: string; // model file in /public/fruits
  upsideDown?: boolean; // the model is made stem-down: turn it over
};

const FRUITS = data as unknown as Record<string, FruitSpec>;

export function fruitSpec(fruit: string): FruitSpec {
  return (fruit !== '_about' && FRUITS[fruit]) || {};
}
