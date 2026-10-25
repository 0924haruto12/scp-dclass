// 保存と読込。仕様案9節・AC03・AC15に対応する。
// - 読込は書き込みを一切しない
// - 読めない保存は元データを保持し、空データや新規データで自動置換しない
// - 破損データの上に書くには、退避先へ複写して読み戻しを確認した後に限る

import { SAVE_VERSION, type GameState } from './cycle';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SAVE_KEY = 'need-to-know.save.v1';
export const CORRUPT_PREFIX = 'need-to-know.save.corrupt.';

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; state: GameState }
  | { status: 'corrupt'; raw: string; reason: string };

export class CorruptSaveProtectedError extends Error {
  constructor() {
    super('既存の保存データを読めないため、退避が確認できるまで上書きしない');
  }
}

export function loadGame(store: KeyValueStore): LoadResult {
  const raw = store.getItem(SAVE_KEY);
  if (raw === null) return { status: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { status: 'corrupt', raw, reason: `JSONとして読めない: ${(err as Error).message}` };
  }
  const problem = validateState(parsed);
  if (problem) return { status: 'corrupt', raw, reason: problem };
  return { status: 'ok', state: parsed as GameState };
}

export function saveGame(store: KeyValueStore, state: GameState): void {
  const current = store.getItem(SAVE_KEY);
  if (current !== null && loadGame(store).status === 'corrupt' && !isPreserved(store, current)) {
    throw new CorruptSaveProtectedError();
  }
  store.setItem(SAVE_KEY, JSON.stringify(stripTransient(state)));
}

/** 破損データを退避キーへ複写し、読み戻して一致を確かめる。退避先のキーを返す */
export function preserveCorrupt(store: KeyValueStore, raw: string, now: number = Date.now()): string {
  const key = `${CORRUPT_PREFIX}${now}`;
  store.setItem(key, raw);
  if (store.getItem(key) !== raw) throw new Error('破損データの退避を確認できない');
  store.setItem(`${CORRUPT_PREFIX}latest`, key);
  return key;
}

function isPreserved(store: KeyValueStore, raw: string): boolean {
  const latest = store.getItem(`${CORRUPT_PREFIX}latest`);
  return latest !== null && store.getItem(latest) === raw;
}

function stripTransient(state: GameState): GameState {
  if (!state.cycle?.trial) return state;
  return { ...state, cycle: { ...state.cycle, trial: { ...state.cycle.trial, events: [] } } };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 最低限の形の検査。問題があれば理由を返す */
export function validateState(value: unknown): string | null {
  if (!isObject(value)) return '最上位がオブジェクトではない';
  if (value.saveVersion !== SAVE_VERSION) return `未対応の保存版: ${String(value.saveVersion)}`;
  const meta = value.meta;
  if (!isObject(meta) || typeof meta.cyclesStarted !== 'number' || !Array.isArray(meta.archive)) return 'meta が不正';
  const cycle = value.cycle;
  if (cycle === null) return null;
  if (!isObject(cycle)) return 'cycle が不正';
  if (typeof cycle.seed !== 'number' || typeof cycle.day !== 'number' || typeof cycle.phase !== 'string') return 'cycle の基本項目が不正';
  if (!Array.isArray(cycle.processed) || !Array.isArray(cycle.envelope) || !Array.isArray(cycle.schedule)) return 'cycle の一覧項目が不正';
  if (!isObject(cycle.params) || typeof cycle.params.pacingTolerance !== 'number') return '変動パラメータが不正';
  const subject = cycle.subject;
  if (!isObject(subject) || !isObject(subject.stats) || !isObject(subject.notebook)) return 'subject が不正';
  if (cycle.phase === 'trial' && !isObject(cycle.trial)) return '実験中の状態が欠けている';
  return null;
}

/** テストと非ブラウザ環境用 */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}
