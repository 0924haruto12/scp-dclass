import { FixedAnomalyParams } from './types';

export const INITIAL_FIXED_SEED = 'FIXED-DEFAULT';

/**
 * Hashes a string seed into a 32-bit unsigned integer.
 */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Mulberry32 deterministic PRNG.
 */
export function createSeededRng(seedStr: string): () => number {
  let a = hashSeed(seedStr) || 1;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derives the cycle-fixed anomaly parameters from a cycle seed.
 * Separated from rendering/audio randomness so saving & resuming never alters rules.
 *
 * Initial fixed seed ('FIXED-DEFAULT'):
 * - gaitAllowedSpeed: 2.5 (Section 7.A: 初回固定seedは2.5にする)
 * - badgeTargetFate: 'hazard_assignment'
 * - waterCoolerDelayDays: 3 (Section 7.C: 3日は初回固定seedとする)
 * - whiteDoorTimeRatio: 2
 */
export function deriveFixedAnomalyParams(seed: string): FixedAnomalyParams {
  if (seed === INITIAL_FIXED_SEED) {
    return {
      gaitAllowedSpeed: 2.5,
      badgeTargetFate: 'hazard_assignment',
      waterCoolerDelayDays: 3,
      whiteDoorTimeRatio: 2,
    };
  }

  const rng = createSeededRng(`RULE:${seed}`);
  const gaitAllowedSpeed: 1.5 | 2.5 = rng() < 0.5 ? 1.5 : 2.5;
  const badgeTargetFate: 'hazard_assignment' | 'ration_priority' =
    rng() < 0.5 ? 'hazard_assignment' : 'ration_priority';
  const waterCoolerDelayDays: 2 | 3 = rng() < 0.5 ? 2 : 3;
  const whiteDoorTimeRatio: 1 | 2 = rng() < 0.5 ? 1 : 2;

  return {
    gaitAllowedSpeed,
    badgeTargetFate,
    waterCoolerDelayDays,
    whiteDoorTimeRatio,
  };
}

/**
 * Separate cosmetic PRNG for visual/audio variation (never used for rule decisions).
 */
export const cosmeticRng = createSeededRng('COSMETIC-STREAM-2026');
