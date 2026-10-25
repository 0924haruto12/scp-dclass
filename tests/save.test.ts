import { describe, expect, it } from 'vitest';
import { answerSummons, beginTrial, createInitialState, resolveTrial, startNewCycle } from '../src/core/cycle';
import { stepTrial, IDLE_INPUT } from '../src/core/pacing';
import { CORRUPT_PREFIX, CorruptSaveProtectedError, loadGame, MemoryStore, preserveCorrupt, SAVE_KEY, saveGame } from '../src/core/save';
import { Driver, gaitInput } from './helpers';

describe('AC03 再開でseed・日付・警告時計を保持し、解決済みイベントを再実行しない', () => {
  it('実験中の保存から、同じ状態・同じ結果で再開できる', () => {
    const store = new MemoryStore();
    const state = createInitialState();
    startNewCycle(state, 4242);
    answerSummons(state);
    const d = new Driver(beginTrial(state));
    d.hold(3, gaitInput('normal', 1));
    d.hold(0.8, gaitInput('run', 1));
    expect(d.state.follower.state).toBe('approach');
    expect(d.state.follower.clockTicks).toBeGreaterThan(0);
    saveGame(store, state);

    const loaded = loadGame(store);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    const restored = loaded.state.cycle!;
    expect(restored.seed).toBe(4242);
    expect(restored.day).toBe(1);
    expect(restored.params).toEqual(state.cycle!.params);
    expect(restored.trial!.tick).toBe(d.state.tick);
    expect(restored.trial!.follower).toEqual(d.state.follower);
    expect(restored.trial!.events).toEqual([]);

    // 同じ入力を続ければ、元の状態と同じ刻みで同じ結果になる
    for (let i = 0; i < 600; i++) {
      const input = { ...IDLE_INPUT, ...gaitInput('normal', 1) };
      stepTrial(d.state, input);
      stepTrial(restored.trial!, input);
    }
    expect(restored.trial!.outcome).toEqual(d.state.outcome);
  });

  it('判定済みの試験を再開後に再判定しない', () => {
    const store = new MemoryStore();
    const state = createInitialState();
    startNewCycle(state);
    answerSummons(state);
    const d = new Driver(beginTrial(state));
    d.walkTo(22.5, 'slow');
    d.interact();
    d.walkTo(0.5, 'slow');
    // 判定直前の状態と判定後の状態を両方保存しておく
    resolveTrial(state);
    saveGame(store, state);
    const loaded = loadGame(store);
    if (loaded.status !== 'ok') throw new Error('load failed');
    const credit = loaded.state.cycle!.subject.stats.credit;
    loaded.state.cycle!.trial = structuredClone(d.state);
    loaded.state.cycle!.phase = 'trial';
    resolveTrial(loaded.state);
    expect(loaded.state.cycle!.subject.stats.credit).toBe(credit);
  });
});

describe('AC15 保存破損時に元データを上書きしない', () => {
  it('読めない保存は読込で書き換えず、自動で新規データに置き換えない', () => {
    const store = new MemoryStore();
    const broken = '{"saveVersion":1,"meta":{"cyclesStarted":1,"archive":[]},"cycle":{"seed":';
    store.setItem(SAVE_KEY, broken);
    const result = loadGame(store);
    expect(result.status).toBe('corrupt');
    expect(store.getItem(SAVE_KEY)).toBe(broken);
    expect([...store.data.keys()]).toEqual([SAVE_KEY]);

    const fresh = createInitialState();
    startNewCycle(fresh);
    expect(() => saveGame(store, fresh)).toThrow(CorruptSaveProtectedError);
    expect(store.getItem(SAVE_KEY)).toBe(broken);
  });

  it('退避して読み戻しを確認した後に限り、新しい保存を書ける', () => {
    const store = new MemoryStore();
    const broken = '{"saveVersion":99}';
    store.setItem(SAVE_KEY, broken);
    expect(loadGame(store).status).toBe('corrupt');
    const backupKey = preserveCorrupt(store, broken, 1000);
    expect(backupKey).toBe(`${CORRUPT_PREFIX}1000`);
    const fresh = createInitialState();
    startNewCycle(fresh);
    saveGame(store, fresh);
    expect(store.getItem(backupKey)).toBe(broken);
    expect(loadGame(store).status).toBe('ok');
  });

  it('形が不正な保存も破損として扱う', () => {
    const store = new MemoryStore();
    store.setItem(SAVE_KEY, JSON.stringify({ saveVersion: 1, meta: { cyclesStarted: 1, archive: [] }, cycle: { seed: 1 } }));
    const result = loadGame(store);
    expect(result.status).toBe('corrupt');
  });
});
