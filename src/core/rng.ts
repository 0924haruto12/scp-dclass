// ルール抽選用と演出用で乱数列を分ける。演出の呼び出し回数が変わっても
// ルールが変わらないよう、用途ごとに seed から別の列を作る。

export type RngStream = 'rules' | 'names' | 'cosmetic';

const STREAM_SALT: Record<RngStream, number> = {
  rules: 0x9e3779b9,
  names: 0x85ebca6b,
  cosmetic: 0xc2b2ae35,
};

export interface RngState {
  s: number;
}

export function createRng(seed: number, stream: RngStream): RngState {
  return { s: hash32(seed ^ STREAM_SALT[stream]) };
}

/** mulberry32。状態は数値1つなので保存できる */
export function nextFloat(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) | 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function pick<T>(rng: RngState, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick from empty list');
  return items[Math.floor(nextFloat(rng) * items.length)] as T;
}

export function hash32(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    return crypto.getRandomValues(new Uint32Array(1))[0] as number;
  }
  return Math.floor(Math.random() * 0xffffffff);
}
