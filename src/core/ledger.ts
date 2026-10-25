// 信用C・疑念S・役割評価Eの加減点。仕様案5.1・6.2に対応する。
// - 各イベントの加点は key ごとに1回だけ
// - 同じ試験の未達減点は shortfall key を共有し、合計1まで
// - 同じ結果に複数の差分がある場合は合計してから1回だけ丸める

import { STATS } from './params';

export interface Stats {
  credit: number;
  suspicion: number;
  evaluation: number;
}

export interface DeltaPart {
  /** 1回だけ適用するための識別子。同じ key は二度目以降を無視する */
  key: string;
  credit?: number;
  suspicion?: number;
  evaluation?: number;
}

export interface LedgerResult {
  applied: DeltaPart[];
  skipped: DeltaPart[];
  before: Stats;
  after: Stats;
}

export function shortfallKey(trialId: string): string {
  return `credit:shortfall:${trialId}`;
}

export function applyDelta(stats: Stats, awarded: string[], parts: readonly DeltaPart[]): LedgerResult {
  const before = { ...stats };
  const applied: DeltaPart[] = [];
  const skipped: DeltaPart[] = [];
  const seen = new Set(awarded);
  let dc = 0;
  let ds = 0;
  let de = 0;
  for (const part of parts) {
    if (seen.has(part.key)) {
      skipped.push(part);
      continue;
    }
    seen.add(part.key);
    awarded.push(part.key);
    applied.push(part);
    dc += part.credit ?? 0;
    ds += part.suspicion ?? 0;
    de += part.evaluation ?? 0;
  }
  stats.credit = clampStat(stats.credit + dc);
  stats.suspicion = clampStat(stats.suspicion + ds);
  stats.evaluation = Math.max(0, stats.evaluation + de);
  return { applied, skipped, before, after: { ...stats } };
}

export function clampStat(value: number): number {
  return Math.min(STATS.max, Math.max(STATS.min, value));
}
