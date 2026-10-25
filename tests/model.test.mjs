import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addHypothesis,
  addObservation,
  attemptEscape,
  beginTrial,
  collectibleNotes,
  completeTrial,
  continueAfterDeath,
  copyToEnvelope,
  createGame,
  doSafeWork,
  envelopeReadable,
  sleep,
  startNewCycle,
  submitEnvelope,
  submitInterview,
  talkToRoommate,
} from '../src/core/model.js';
import { stepTrial } from '../src/core/footstep.js';
import { isValidSave } from '../src/core/storage.js';

function fastDeath(game) {
  const trial = beginTrial(game);
  trial.box.collected = true;
  trial.load.offered = true;
  trial.load.reply = 'refuse';
  trial.player.x = 3;
  trial.follow.mode = 'approach';
  trial.follow.danger = 2.99;
  // 1フレームだけ走らせて接触死にする
  stepTrial(trial, { dt: 0.02, moveX: 1, moveY: 0, mode: 'run' });
  assert.equal(trial.outcome, 'died');
  completeTrial(game);
  return trial;
}

test('初回サイクルは許容速度2.5で固定される', () => {
  const game = createGame({ seed: 'first', firstCycle: true });
  assert.equal(game.cycle.tolerance, 2.5);
  assert.equal(game.cycle.day, 1);
  assert.equal(game.subject.number, 'D-9341');
});

test('同じseedと同じサイクル番号なら許容速度の抽選は再現する', () => {
  const a = createGame({ seed: 'same', firstCycle: false });
  const b = createGame({ seed: 'same', firstCycle: false });
  assert.equal(a.cycle.tolerance, b.cycle.tolerance);
});

test('死亡すると日付は1つだけ進み、新被験者はC/S/Eとノートを初期化される', () => {
  const game = createGame({ seed: 'death', firstCycle: true });
  game.subject.C = 3;
  game.subject.S = 2;
  game.subject.E = 2;
  addObservation(game, { key: 'scratches', text: '擦り跡' });
  game.cycle.envelope.items = [{ id: 'E1', text: '隠したメモ' }];
  game.cycle.envelope.readableOn = 1;

  fastDeath(game);
  assert.equal(game.cycle.phase, 'death');
  assert.equal(game.cycle.day, 1);
  const result = continueAfterDeath(game);

  assert.equal(result.ending, null);
  assert.equal(game.cycle.day, 2);
  assert.equal(game.subject.number, 'D-9342');
  assert.equal(game.subject.C, 0);
  assert.equal(game.subject.S, 0);
  assert.equal(game.subject.E, 0);
  assert.equal(game.subject.observations.length, 0);
  assert.equal(game.cycle.envelope.items.length, 1);
  assert.equal(game.cycle.tolerance, 2.5);
  assert.equal(game.reports.filter((report) => report.kind === 'death').length, 1);
});

test('死亡した日は夜を飛ばし、翌朝から再開する', () => {
  const game = createGame({ seed: 'death-skip-night', firstCycle: true });
  fastDeath(game);
  continueAfterDeath(game);
  assert.equal(game.cycle.phase, 'morning');
  assert.equal(game.cycle.slots.night, 2);
});

test('7日目の死亡は欠員補充停止の処分で終了する', () => {
  const game = createGame({ seed: 'death-day7', firstCycle: true });
  game.cycle.day = 7;
  fastDeath(game);
  const result = continueAfterDeath(game);
  assert.equal(result.ending.kind, '処分');
  assert.equal(game.cycle.phase, 'ending');
  assert.equal(game.cycle.day, 7);
});

test('死亡報告は接近の事実を記し、起きていない間隔拡大を主張しない', () => {
  const game = createGame({ seed: 'death-report', firstCycle: true });
  const trial = beginTrial(game);
  for (let i = 0; i < 210; i += 1) {
    stepTrial(trial, { dt: 1 / 60, moveX: 1, moveY: 0, mode: 'run', facing: 0 });
  }
  assert.equal(trial.outcome, 'died');
  completeTrial(game);

  const lines = game.pendingDeath.lines.join('\n');
  assert.match(lines, /追従音の接近を確認/);
  assert.match(lines, /最終入力: 走行/);
  assert.doesNotMatch(lines, /間隔拡大/);
  assert.match(lines, /間隔短縮/);
});

test('生還すると聴取を経て夜へ進み、報告が残る', () => {
  const game = createGame({ seed: 'survive', firstCycle: true });
  const trial = beginTrial(game);
  trial.box.collected = true;
  trial.load.offered = true;
  trial.load.reply = 'obey';
  trial.load.spanSatisfied = true;
  trial.follow.stopClears = 1;
  trial.player.x = 1;
  trial.outcome = 'survived';
  trial.phase = 'done';

  completeTrial(game);
  assert.equal(game.cycle.phase, 'interview');
  assert.equal(game.subject.C, 1);
  assert.ok(game.reports.some((report) => report.kind === 'survival'));

  submitInterview(game, 'footsteps');
  assert.equal(game.cycle.phase, 'night');
  assert.equal(game.cycle.slots.night, 2);
});

test('封筒への複写は夜の行動枠1つと最大3件、翌朝に読める', () => {
  const game = createGame({ seed: 'envelope', firstCycle: true });
  game.cycle.phase = 'night';
  addObservation(game, { key: 'a', text: 'A' });
  addObservation(game, { key: 'b', text: 'B' });
  addObservation(game, { key: 'c', text: 'C' });
  addObservation(game, { key: 'd', text: 'D' });

  const cards = collectibleNotes(game);
  assert.equal(cards.length, 4);
  const result = copyToEnvelope(
    game,
    cards.map((card) => card.id),
  );
  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
  assert.equal(game.cycle.slots.night, 1);
  assert.equal(game.cycle.envelope.readableOn, 2);
  assert.equal(envelopeReadable(game), false);

  const again = copyToEnvelope(game, [cards[0].id]);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already-sealed');
  assert.equal(game.cycle.slots.night, 1);

  game.cycle.day = 2;
  assert.equal(envelopeReadable(game), true);
});

test('封筒は朝の行動枠を使って任意提出でき、没収される', () => {
  const game = createGame({ seed: 'submit', firstCycle: true });
  game.cycle.phase = 'morning';
  game.cycle.envelope.items = [{ id: 'E1', text: 'メモ' }];
  game.cycle.envelope.readableOn = 1;
  const result = submitEnvelope(game);
  assert.equal(result.ok, true);
  assert.equal(game.subject.C, 1);
  assert.equal(game.subject.S, 1);
  assert.equal(game.cycle.envelope.items.length, 0);
  assert.equal(game.cycle.slots.morning, 1);
});

test('夜の就寝で翌朝になり、行動枠が戻る', () => {
  const game = createGame({ seed: 'sleep', firstCycle: true });
  game.cycle.day = 2;
  game.cycle.phase = 'night';
  game.cycle.slots = { morning: 0, night: 0 };
  const result = sleep(game);
  assert.equal(result.ending, null);
  assert.equal(game.cycle.day, 3);
  assert.equal(game.cycle.phase, 'morning');
  assert.deepEqual(game.cycle.slots, { morning: 2, night: 2 });
});

test('7日目の就寝で終了判定に入る', () => {
  const game = createGame({ seed: 'ending', firstCycle: true });
  game.cycle.day = 7;
  game.cycle.phase = 'night';
  game.subject.C = 3;
  game.subject.S = 0;
  game.subject.E = 0;
  const result = sleep(game);
  assert.equal(result.ending.kind, '処分');
  assert.equal(game.cycle.phase, 'ending');
});

test('監督用名札があれば7日目の朝に脱走未遂を選べる', () => {
  const game = createGame({ seed: 'escape', firstCycle: true });
  game.cycle.day = 7;
  game.cycle.phase = 'morning';
  assert.equal(attemptEscape(game), null);

  game.cycle.flags.supervisorBadge = true;
  const ending = attemptEscape(game);
  assert.equal(ending.kind, '脱走未遂');
  assert.equal(game.cycle.phase, 'ending');
});

test('同房者の伝聞は同じ日に繰り返し聞いても重複せず、枠を消費する', () => {
  const game = createGame({ seed: 'talk', firstCycle: true });
  const first = talkToRoommate(game);
  assert.equal(first.ok, true);
  assert.equal(game.cycle.slots.morning, 1);
  assert.equal(game.subject.hearsays.length, 1);
  const second = talkToRoommate(game);
  assert.equal(second.ok, true);
  assert.equal(game.subject.hearsays.length, 2);
});

test('保存形式は往復しても同じ内容で、検証を通る', () => {
  const game = createGame({ seed: 'save', firstCycle: true });
  beginTrial(game);
  game.trial.elapsed = 12.5;
  game.trial.follow.danger = 1.25;
  game.trial.follow.mode = 'approach';
  const restored = JSON.parse(JSON.stringify(game));
  assert.equal(isValidSave(restored), true);
  assert.equal(restored.trial.elapsed, 12.5);
  assert.equal(restored.trial.follow.danger, 1.25);
  assert.equal(restored.cycle.seed, game.cycle.seed);
  assert.equal(restored.subject.number, game.subject.number);
});

test('新しいサイクルは日付と被験者を戻し、報告履歴は保持する', () => {
  const game = createGame({ seed: 'cycle1', firstCycle: true });
  game.reports.push({ id: 'R1', kind: 'survival', title: '旧報告' });
  const oldSeed = game.cycle.seed;
  startNewCycle(game, { seed: 'cycle2' });
  assert.equal(game.cycle.number, 2);
  assert.equal(game.cycle.day, 1);
  assert.equal(game.subject.number, 'D-9341');
  assert.equal(game.reports.length, 1);
  assert.notEqual(game.cycle.seed, oldSeed);
});

test('仮説はプレイヤーの自由記述として保存され、正誤判定を受けない', () => {
  const game = createGame({ seed: 'hypo', firstCycle: true });
  const card = addHypothesis(game, {
    title: '速度が原因',
    trigger: '走る',
    effect: '足音が近づく',
    condition: '許容速度を超えた時',
    basis: '停止で遠のいた',
    note: '振り返りは無関係かもしれない',
  });
  assert.equal(card.title, '速度が原因');
  assert.equal(game.subject.hypotheses.length, 1);
});

test('7日間を同じ人物で生還し続けると有用認定に到達する', () => {
  const game = createGame({ seed: 'seven-days', firstCycle: true });

  for (let day = 1; day <= 7; day += 1) {
    const trial = beginTrial(game);
    trial.box.collected = true;
    trial.load.offered = true;
    trial.load.reply = 'obey';
    trial.load.spanSatisfied = true;
    trial.follow.stopClears = 1;
    trial.follow.mode = 'backoff';
    trial.player.x = 1;
    trial.outcome = 'survived';
    trial.phase = 'done';
    completeTrial(game);
    submitInterview(game, 'footsteps');
    assert.equal(game.cycle.phase, 'night');

    if (day < 7) {
      assert.equal(doSafeWork(game).ok, true);
      const result = sleep(game);
      assert.equal(result.ending, null);
      assert.equal(game.cycle.day, day + 1);
    }
  }

  assert.equal(game.subject.E, 2, 'Eは4日目と7日目だけ加算される');
  assert.equal(game.cycle.flags.supervisorBadge, true);
  const result = sleep(game);
  assert.equal(result.ending.kind, '有用認定');
  assert.equal(game.cycle.phase, 'ending');
});
