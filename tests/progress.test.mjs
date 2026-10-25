import test from 'node:test';
import assert from 'node:assert/strict';

import { createGame } from '../src/core/model.js';
import {
  clearRecentCopies,
  evaluateEnding,
  interviewOptions,
  resolveInterview,
  safeWorkReward,
  trialCredit,
} from '../src/core/progress.js';
import { createTrial } from '../src/core/footstep.js';

function trialFixture({ outcome = 'survived', collected = true, reply = 'obey', spanSatisfied = true, offered = true } = {}) {
  const trial = createTrial({ tolerance: 2.5 });
  trial.outcome = outcome;
  trial.box.collected = collected;
  trial.load.offered = offered;
  trial.load.reply = reply;
  trial.load.spanSatisfied = spanSatisfied;
  trial.follow.stopClears = 1;
  return trial;
}

function interviewGame(overrides = {}) {
  const game = createGame({ seed: 'interview-seed', firstCycle: true });
  game.cycle.phase = 'interview';
  game.subject.C = overrides.C ?? 0;
  game.subject.S = overrides.S ?? 0;
  game.subject.observations = overrides.observations ?? [];
  game.subject.hearsays = overrides.hearsays ?? [];
  game.cycle.envelope.items = overrides.envelope ?? [];
  game.interview = {
    trialOutcome: overrides.success === false ? 'timeout' : 'survived',
    success: overrides.success !== false,
    creditDelta: overrides.creditDelta ?? 0,
    roleEligible: false,
    resolved: false,
    choice: null,
  };
  return game;
}

test('信用は回収・退出で+1、走行指示の拒否で相殺されて0になる', () => {
  assert.equal(trialCredit(trialFixture()), 1);
  assert.equal(trialCredit(trialFixture({ reply: 'refuse' })), 0);
  assert.equal(trialCredit(trialFixture({ reply: 'obey', spanSatisfied: false })), 0);
});

test('期限超過と拒否が重なっても、1回の実験の減点は1まで', () => {
  const trial = trialFixture({
    outcome: 'timeout',
    collected: true,
    reply: 'refuse',
    spanSatisfied: false,
  });
  assert.equal(trialCredit(trial), -1);
});

test('期限超過は指示の有無にかかわらず業務未達で-1', () => {
  const trial = trialFixture({
    outcome: 'timeout',
    collected: false,
    offered: false,
    spanSatisfied: false,
  });
  assert.equal(trialCredit(trial), -1);
});

test('指示が出ていない死亡では信用を動かさない', () => {
  const trial = trialFixture({ outcome: 'died', collected: false, offered: false });
  assert.equal(trialCredit(trial), 0);
});

test('前兆を見て止まった返答だけでは疑念が増えない', () => {
  const game = interviewGame({ S: 2, observations: [{ id: 'N1', day: 1 }] });
  const result = resolveInterview(game, 'footsteps');
  assert.equal(game.subject.S, 2);
  assert.equal(result.suspicionDelta, 0);
});

test('根拠のない「全部知っている」は聴取でだけ疑念+1', () => {
  const withoutEvidence = interviewGame();
  resolveInterview(withoutEvidence, 'knowAll');
  assert.equal(withoutEvidence.subject.S, 1);

  const withEvidence = interviewGame({ observations: [{ id: 'N1', day: 1 }] });
  resolveInterview(withEvidence, 'knowAll');
  assert.equal(withEvidence.subject.S, 0);

  const withRumorOnly = interviewGame({ hearsays: [{ id: 'N2', day: 1 }] });
  resolveInterview(withRumorOnly, 'knowAll');
  assert.equal(withRumorOnly.subject.S, 1);
});

test('隠しメモの任意提出は信用+1・疑念+1で、メモは没収される', () => {
  const game = interviewGame({ envelope: [{ id: 'E1', text: 'メモ' }] });
  const result = resolveInterview(game, 'submit');
  assert.equal(game.subject.C, 1);
  assert.equal(game.subject.S, 1);
  assert.equal(game.cycle.envelope.items.length, 0);
  assert.equal(game.cycle.envelope.confiscated, true);
  assert.equal(result.confiscated, true);
});

test('同一実験の信用減点は、実験の-1と聴取の-1を合わせて1まで', () => {
  const game = interviewGame({ C: 1, success: false, creditDelta: -1 });
  resolveInterview(game, 'pain');
  assert.equal(game.subject.C, 1);
});

test('疑念3では記憶処理が走り、直近1日の携帯写しだけが消える', () => {
  const game = interviewGame({
    S: 3,
    observations: [
      { id: 'N1', day: 1, text: '今日の観測' },
      { id: 'N2', day: 0, text: '以前の観測' },
    ],
    hearsays: [{ id: 'N3', day: 1, text: '今日の伝聞' }],
  });
  const result = resolveInterview(game, 'silent');
  assert.equal(result.memoryProcessed, true);
  assert.equal(game.subject.S, 1);
  assert.deepEqual(
    game.subject.observations.map((card) => card.id),
    ['N2'],
  );
  assert.equal(game.subject.hearsays.length, 0);
  assert.equal(game.cycle.lastMemoryProcessingDay, 1);
});

test('封筒は記憶処理の対象外', () => {
  const game = interviewGame({ S: 3 });
  game.cycle.envelope.items = [{ id: 'E1', text: '封筒の写し' }];
  clearRecentCopies(game);
  assert.equal(game.cycle.envelope.items.length, 1);
});

test('インタビューの選択肢は取得物に応じて増える', () => {
  const game = interviewGame();
  assert.deepEqual(interviewOptions(game), ['footsteps', 'pain', 'knowAll', 'silent']);
  game.cycle.envelope.items = [{ id: 'E1' }];
  assert.ok(interviewOptions(game).includes('submit'));
});

test('安全な再評価業務は6日目に条件を満たすと監督用名札を与える', () => {
  const game = createGame({ seed: 'badge', firstCycle: true });
  game.cycle.day = 6;
  game.subject.C = 2;
  game.subject.S = 1;
  const reward = safeWorkReward(game);
  assert.equal(reward.badge, true);
  assert.equal(game.cycle.flags.supervisorBadge, true);
  assert.equal(game.subject.C, 3);
  assert.equal(game.subject.S, 0);
});

test('7日目の死亡は、生前のE=2でも有用認定より優先して処分になる', () => {
  const game = createGame({ seed: 'ending', firstCycle: true });
  game.cycle.day = 7;
  game.subject.E = 2;
  game.subject.C = 3;
  game.subject.S = 0;
  const ending = evaluateEnding(game, 'day7-death');
  assert.equal(ending.kind, '処分');
});

test('E=2・C>=2・S<=1なら有用認定', () => {
  const game = createGame({ seed: 'ending', firstCycle: true });
  game.subject.E = 2;
  game.subject.C = 2;
  game.subject.S = 1;
  assert.equal(evaluateEnding(game, 'normal').kind, '有用認定');
});
