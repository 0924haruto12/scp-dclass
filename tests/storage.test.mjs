import test from 'node:test';
import assert from 'node:assert/strict';

import { SAVE_KEY } from '../src/core/constants.js';
import { createGame } from '../src/core/model.js';
import {
  isValidSave,
  quarantineCorrupt,
  readSave,
  writeSave,
} from '../src/core/storage.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

test('保存がなければ empty', () => {
  assert.equal(readSave(memoryStorage()).status, 'empty');
});

test('正常な保存は ok で読み戻せる', () => {
  const storage = memoryStorage();
  const game = createGame({ seed: 'storage', firstCycle: true });
  assert.equal(writeSave(storage, game).ok, true);
  const result = readSave(storage);
  assert.equal(result.status, 'ok');
  assert.equal(result.state.subject.number, 'D-9341');
});

test('壊れたJSONは corrupt として元の文字列を保持する', () => {
  const raw = '{"version":1,"cycle":';
  const storage = memoryStorage({ [SAVE_KEY]: raw });
  const result = readSave(storage);
  assert.equal(result.status, 'corrupt');
  assert.equal(result.raw, raw);
  assert.equal(storage.getItem(SAVE_KEY), raw);
});

test('形が違う保存も corrupt とし、自動で上書きしない', () => {
  const raw = JSON.stringify({ version: 1, cycle: { day: 1 } });
  const storage = memoryStorage({ [SAVE_KEY]: raw });
  const result = readSave(storage);
  assert.equal(result.status, 'corrupt');
  assert.equal(isValidSave(JSON.parse(raw)), false);
  assert.equal(storage.getItem(SAVE_KEY), raw);
});

test('破損データは別キーへ退避でき、元キーは変更されない', () => {
  const raw = '{broken';
  const storage = memoryStorage({ [SAVE_KEY]: raw });
  const result = quarantineCorrupt(storage, raw, 123456);
  assert.equal(result.ok, true);
  assert.equal(storage.getItem(result.backupKey), raw);
  assert.equal(storage.getItem(SAVE_KEY), raw);
});

test('保存容量の失敗は例外にせず ok:false で返す', () => {
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  const result = writeSave(storage, createGame({ seed: 'quota', firstCycle: true }));
  assert.equal(result.ok, false);
});
