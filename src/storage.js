import { validateGame } from './game.js';

// Unique origin + key per implementation; other model prototypes must not share a save.
export const SAVE_KEY = 'ntk-codex-vertical-v1';
export class SaveStore {
  constructor(storage) { this.storage = storage; this.blocked = false; this.raw = null; }
  load() {
    try {
      this.raw = this.storage.getItem(SAVE_KEY);
      if (!this.raw) return { game: null };
      return { game: validateGame(JSON.parse(this.raw)) };
    } catch (error) { this.blocked = true; return { game: null, error: error.message }; }
  }
  save(game) {
    if (this.blocked) return { ok: false, error: '元の保存を保護しています。先に書き出して別の保存枠を作成してください。' };
    try { const payload = JSON.stringify(validateGame(game)); this.storage.setItem(SAVE_KEY, payload); this.raw = payload; return { ok: true }; }
    catch (error) { this.blocked = true; return { ok: false, error: `保存できません：${error.message}` }; }
  }
  // Deliberate recovery only: the original must be exported before enabling a new slot.
  recoverAfterExport() {
    const backupKey = `${SAVE_KEY}-preserved-${Date.now()}`;
    try {
      if (this.raw !== null) this.storage.setItem(backupKey, this.raw);
      this.blocked = false;
      return { ok: true, backupKey };
    } catch (error) { return { ok: false, error: error.message }; }
  }
}
