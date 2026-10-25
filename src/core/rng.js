// 再開時にルール抽選が変わらないよう、描画・音のばらつきとは別系統の
// 決定的な乱数だけをここに置く。

export function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFrom(seed) {
  const next = mulberry32(typeof seed === 'number' ? seed : hashSeed(String(seed)));
  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(list) {
      if (!list.length) return undefined;
      return list[Math.floor(next() * list.length)];
    },
    chance(p) {
      return next() < p;
    },
  };
}

export function randomSeedString() {
  const values = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return `${values[0].toString(16)}${values[1].toString(16)}`;
  }
  return `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffffffff).toString(16)}`;
}

export function trialSeed(cycleSeed, day) {
  return hashSeed(`${cycleSeed}:day:${day}`);
}
