import { SAVE_KEY, SAVE_VERSION } from './constants.js';

// 読み込めない保存は元データを保持し、空データで上書きしない。
// 書き込みを止める判断は呼び出し側（画面）が行う。

export function isValidSave(state) {
  return Boolean(
    state &&
      typeof state === 'object' &&
      state.version === SAVE_VERSION &&
      state.cycle &&
      typeof state.cycle.day === 'number' &&
      state.cycle.day >= 1 &&
      state.subject &&
      typeof state.subject.C === 'number' &&
      typeof state.subject.S === 'number' &&
      Array.isArray(state.subject.observations) &&
      Array.isArray(state.reports),
  );
}

export function readSave(storage, key = SAVE_KEY) {
  let raw;
  try {
    raw = storage.getItem(key);
  } catch (error) {
    return { status: 'error', error };
  }
  if (!raw) return { status: 'empty' };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: 'corrupt', raw, reason: 'parse', error };
  }

  if (!isValidSave(parsed)) {
    return { status: 'corrupt', raw, reason: 'invalid' };
  }
  return { status: 'ok', state: parsed, raw };
}

export function writeSave(storage, state, key = SAVE_KEY) {
  try {
    storage.setItem(key, JSON.stringify(state));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export function quarantineCorrupt(storage, raw, now = Date.now(), key = SAVE_KEY) {
  const backupKey = `${key}.corrupt.${now}`;
  try {
    storage.setItem(backupKey, raw);
    return { ok: true, backupKey };
  } catch (error) {
    return { ok: false, error };
  }
}
