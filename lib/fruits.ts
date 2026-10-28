import data from './fruits.json';

/** What a fruit has inside (see lib/fruits.json). */
export type FruitSpec = {
  flesh?: string; // '#rrggbb'
  seeds?: { kind: 'star' | 'arils'; count: number; add: number };
  pit?: string; // model file in /public/fruits
  upsideDown?: boolean; // the model is made stem-down: turn it over
};

const FRUITS = data as unknown as Record<string, FruitSpec>;

export function fruitSpec(fruit: string): FruitSpec {
  return (fruit !== '_about' && FRUITS[fruit]) || {};
}
