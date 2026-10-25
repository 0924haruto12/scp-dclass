import test from 'node:test';
import assert from 'node:assert/strict';

import { BASE_SPEED, GAIT, ROOM } from '../src/core/constants.js';
import { createTrial, replyToInstruction, stepTrial } from '../src/core/footstep.js';

const DT = 1 / 60;

function walk(trial, seconds, { mode = 'normal', moveX = 1, moveY = 0, interact = false } = {}) {
  const events = [];
  const frames = Math.max(1, Math.round(seconds / DT));
  for (let i = 0; i < frames; i += 1) {
    events.push(...stepTrial(trial, { dt: DT, moveX, moveY, mode, facing: 0, interact }));
  }
  return events;
}

function still(trial, seconds) {
  return walk(trial, seconds, { mode: 'idle', moveX: 0, moveY: 0 });
}

test('通常歩行は許容速度2.5では接近を起こさない', () => {
  const trial = createTrial({ tolerance: 2.5 });
  walk(trial, 1, { mode: 'normal' });
  assert.equal(trial.follow.mode, 'following');
  assert.equal(trial.stats.approachCount, 0);
});

test('走行は接近を起こし、そのまま走り続けると約3秒で死亡する', () => {
  const trial = createTrial({ tolerance: 2.5 });
  const events = walk(trial, 0.1, { mode: 'run' });
  assert.equal(trial.follow.mode, 'approach');
  assert.ok(events.some((event) => event.type === 'approach'));

  walk(trial, 3.2, { mode: 'run' });
  assert.equal(trial.outcome, 'died');
  assert.ok(trial.death.at >= GAIT.contactSeconds);
  assert.ok(trial.death.at < GAIT.contactSeconds + 0.1);
});

test('危険時計は停止中に止まり、再開すると元の値から進む', () => {
  const trial = createTrial({ tolerance: 2.5 });
  walk(trial, 2, { mode: 'run' });
  assert.equal(trial.follow.mode, 'approach');
  assert.ok(Math.abs(trial.follow.danger - 2) < 0.05);

  still(trial, 0.4);
  assert.ok(Math.abs(trial.follow.danger - 2) < 0.05);
  assert.equal(trial.follow.mode, 'approach');

  walk(trial, 0.5, { mode: 'normal' });
  assert.ok(trial.follow.danger > 2.4);
  assert.ok(trial.follow.danger < 3);
  assert.equal(trial.outcome, null);
});

test('停止0.5秒で解除され、1秒の後退提示のあと追従へ戻る', () => {
  const trial = createTrial({ tolerance: 2.5 });
  walk(trial, 1, { mode: 'run' });
  const events = still(trial, 0.55);
  assert.equal(trial.follow.mode, 'backoff');
  assert.ok(events.some((event) => event.type === 'retreat'));
  assert.equal(trial.follow.stopClears, 1);

  still(trial, 1.05);
  assert.equal(trial.follow.mode, 'following');
});

test('通常歩行に戻しただけでは接近状態を解除しない（許容速度2.5でも）', () => {
  const trial = createTrial({ tolerance: 2.5 });
  walk(trial, 0.2, { mode: 'run' });
  const modeSpeed = trial.follow.mode;
  assert.equal(modeSpeed, 'approach');

  walk(trial, 2.0, { mode: 'normal' });
  assert.equal(trial.follow.mode, 'approach');
  assert.equal(trial.outcome, null);

  walk(trial, 1.2, { mode: 'normal' });
  assert.equal(trial.outcome, 'died');
});

test('低速解除は1秒の継続を要し、停止と低速を混ぜると継続がリセットされる', () => {
  const trial = createTrial({ tolerance: 2.5 });
  walk(trial, 0.5, { mode: 'run' });
  still(trial, 0.3);
  walk(trial, 0.8, { mode: 'slow' });
  assert.equal(trial.follow.mode, 'approach');

  walk(trial, 0.3, { mode: 'slow' });
  assert.equal(trial.follow.mode, 'backoff');
  assert.equal(trial.follow.slowClears, 1);
});

test('後退中に閾値を超えると、前兆付きの接近へ戻る', () => {
  const trial = createTrial({ tolerance: 2.5 });
  walk(trial, 0.5, { mode: 'run' });
  still(trial, 0.55);
  assert.equal(trial.follow.mode, 'backoff');

  const events = walk(trial, 0.1, { mode: 'run' });
  assert.equal(trial.follow.mode, 'approach');
  assert.ok(events.some((event) => event.type === 'approach'));
  assert.ok(trial.follow.danger < 0.1);
});

test('未解除の危険を持ったまま出口に触れても生還しない', () => {
  const trial = createTrial({ tolerance: 2.5 });
  trial.box.collected = true;
  trial.player.x = 1.1;
  trial.follow.mode = 'approach';
  trial.follow.danger = 1;
  const events = walk(trial, 0.1, { moveX: 0, mode: 'idle' });
  assert.equal(trial.outcome, null);
  assert.ok(events.some((event) => event.type === 'blocked-exit'));
});

test('赤線から青線まで走り抜け、停止して解除すると生還できる', () => {
  const trial = createTrial({ tolerance: 2.5 });
  trial.box.collected = true;
  trial.load.offered = true;
  replyToInstruction(trial, 'obey');
  trial.player.x = 9.2;
  trial.player.y = 0;

  walk(trial, 2.1, { moveX: -1, mode: 'run' });
  assert.equal(trial.load.spanSatisfied, true);
  assert.equal(trial.outcome, null);
  assert.ok(trial.follow.danger > 1.8);

  still(trial, 0.6);
  assert.equal(trial.outcome, 'survived');
  assert.equal(trial.flags.reachedExit, true);
});

test('走行区間の途中で止まると未達になり、やり直せる', () => {
  const trial = createTrial({ tolerance: 2.5 });
  trial.box.collected = true;
  trial.load.offered = true;
  replyToInstruction(trial, 'obey');
  trial.player.x = 9.2;

  walk(trial, 0.5, { moveX: -1, mode: 'run' });
  walk(trial, 0.1, { moveX: -1, mode: 'normal' });
  assert.equal(trial.load.spanArmed, false);
  assert.equal(trial.load.spanFailed, true);
  assert.equal(trial.load.spanSatisfied, false);
});

test('期限10秒前に予告し、120秒でタイムアウトする（死亡ではない）', () => {
  const trial = createTrial({ tolerance: 2.5 });
  trial.elapsed = 109.9;
  const events = still(trial, 0.2);
  assert.ok(events.some((event) => event.type === 'deadline-warning'));
  assert.equal(trial.outcome, null);

  trial.elapsed = 119.9;
  still(trial, 0.2);
  assert.equal(trial.outcome, 'timeout');
  assert.equal(trial.phase, 'done');
  assert.equal(ROOM.exitX, 1.2);
});

test('ボックスは近接して調べた時だけ回収され、走行指示が出る', () => {
  const trial = createTrial({ tolerance: 2.5 });
  trial.player.x = trial.box.x;
  still(trial, 0.1);
  assert.equal(trial.box.collected, false);

  const events = walk(trial, 0.1, { moveX: 0, mode: 'idle', interact: true });
  assert.equal(trial.box.collected, true);
  assert.equal(trial.load.offered, true);
  assert.ok(events.some((event) => event.type === 'instruction'));
});

test('走行指示への返答は1回だけで、質問で時間は延びない', () => {
  const trial = createTrial({ tolerance: 2.5 });
  trial.load.offered = true;
  replyToInstruction(trial, 'question');
  const second = replyToInstruction(trial, 'obey');
  assert.equal(trial.load.reply, 'question');
  assert.deepEqual(second, []);
  assert.equal(trial.deadline, GAIT.deadlineSeconds);
});

test('低速移動は通常歩行より遅く、走行は4単位/秒', () => {
  const trial = createTrial({ tolerance: 2.5 });
  const x0 = trial.player.x;
  walk(trial, 1, { mode: 'slow' });
  const slowDistance = trial.player.x - x0;
  assert.ok(Math.abs(slowDistance - BASE_SPEED.slow) < 0.1);
});
