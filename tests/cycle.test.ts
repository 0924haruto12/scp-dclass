import { describe, expect, it } from 'vitest';
import {
  acknowledgeDeath,
  answerInterrogation,
  answerSummons,
  beginTrial,
  copyToEnvelope,
  createInitialState,
  cycleParamsForSeed,
  decideEnding,
  morningAction,
  proceedToNight,
  resolveTrial,
  sleep,
  startNewCycle,
  type GameState,
} from '../src/core/cycle';
import { FIRST_FIXED_SEED, PACING } from '../src/core/params';
import { Driver, gaitInput } from './helpers';

function withPacingEveryDay(state: GameState): void {
  for (const a of state.cycle!.schedule) a.trial = 'pacing';
}

function dieInTrial(state: GameState): void {
  answerSummons(state);
  const d = new Driver(beginTrial(state));
  d.hold(5, gaitInput('run', 1));
  expect(d.state.outcome?.kind).toBe('death');
  resolveTrial(state);
}

function surviveDay(state: GameState): Driver {
  answerSummons(state);
  const d = new Driver(beginTrial(state));
  d.walkTo(22.5, 'slow');
  d.interact();
  d.walkTo(0.5, 'slow');
  resolveTrial(state);
  return d;
}

describe('サイクルと変動パラメータ', () => {
  it('初回サイクルは固定seedで許容速度2.5', () => {
    const state = createInitialState();
    const cycle = startNewCycle(state);
    expect(cycle.seed).toBe(FIRST_FIXED_SEED);
    expect(cycle.params.pacingTolerance).toBe(PACING.firstFixedTolerance);
  });

  it('2回目以降は新seedで抽選し、両方の値が出る', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 64; seed++) seen.add(cycleParamsForSeed(seed).pacingTolerance);
    expect([...seen].sort()).toEqual([1.5, 2.5]);
    const state = createInitialState();
    startNewCycle(state);
    const second = startNewCycle(state);
    expect(second.seed).not.toBe(FIRST_FIXED_SEED);
  });
});

describe('AC01・AC02 死亡継承', () => {
  it('死亡しても日付は1つだけ進み、seed・異常パラメータ・封筒を保持する', () => {
    const state = createInitialState();
    const cycle = startNewCycle(state, 12345);
    withPacingEveryDay(state);
    surviveDay(state);
    answerInterrogation(state, 'silent');
    proceedToNight(state);
    const card = cycle.subject.notebook.observations[0]!;
    copyToEnvelope(state, [{ entryId: card.id }, { freeText: '走るな' }]);
    sleep(state);
    expect(state.cycle!.day).toBe(2);

    const params = structuredClone(state.cycle!.params);
    const envelope = structuredClone(state.cycle!.envelope);
    dieInTrial(state);
    expect(state.cycle!.phase).toBe('death_report');
    acknowledgeDeath(state);
    acknowledgeDeath(state);
    expect(state.cycle!.day).toBe(3);
    expect(state.cycle!.phase).toBe('morning');
    expect(state.cycle!.seed).toBe(12345);
    expect(state.cycle!.params).toEqual(params);
    expect(state.cycle!.envelope).toEqual(envelope);
  });

  it('新被験者は C/S/E・携帯ノート・個人効果を引き継がず、旧人物の遅効イベントは解決しない', () => {
    const state = createInitialState();
    startNewCycle(state);
    withPacingEveryDay(state);
    const dead = state.cycle!.subject;
    dead.stats = { credit: 2, suspicion: 1, evaluation: 1 };
    dead.effects.push('nametag:D-9999');
    state.cycle!.deferred.push({ id: 'cooler-1', subjectId: dead.subjectId, origin: 'cooler', resolveDay: 3, resolvePhase: 'morning', status: 'pending' });
    dieInTrial(state);
    acknowledgeDeath(state);
    const next = state.cycle!.subject;
    expect(next.subjectId).not.toBe(dead.subjectId);
    expect(next.number).not.toBe(dead.number);
    expect(next.stats).toEqual({ credit: 0, suspicion: 0, evaluation: 0 });
    expect(next.effects).toEqual([]);
    expect(next.notebook.observations).toEqual([]);
    expect(next.evidence).toEqual([]);
    expect(state.cycle!.deferred[0]!.status).toBe('cancelled');
  });

  it('新被験者は封筒を朝に調べて初めて読める。観測カードは直接移らない', () => {
    const state = createInitialState();
    startNewCycle(state);
    withPacingEveryDay(state);
    state.cycle!.envelope.push({ id: 'e1', source: 'free', text: '帰りは走るな', writtenDay: 1 });
    dieInTrial(state);
    acknowledgeDeath(state);
    const s = state.cycle!.subject;
    expect(s.notebook.hearsay).toEqual([]);
    const result = morningAction(state, 'envelope');
    expect(result.lines.join('')).toContain('帰りは走るな');
    expect(s.notebook.observations).toEqual([]);
    expect(s.notebook.hearsay).toHaveLength(1);
    expect(s.notebook.hearsay[0]).toMatchObject({ kind: 'hearsay', speaker: '寝台下の封筒（筆跡）' });
  });

  it('朝の行動枠は2つ。召集で残りを放棄する', () => {
    const state = createInitialState();
    startNewCycle(state);
    expect(morningAction(state, 'notice').ok).toBe(true);
    expect(morningAction(state, 'cellmate').ok).toBe(true);
    expect(morningAction(state, 'envelope').ok).toBe(false);
    answerSummons(state);
    expect(state.cycle!.phase).toBe('summons');
  });

  it('縦切りでは2日目の召集で範囲外の表示へ進む', () => {
    const state = createInitialState();
    startNewCycle(state);
    surviveDay(state);
    answerInterrogation(state, 'silent');
    proceedToNight(state);
    sleep(state);
    answerSummons(state);
    expect(state.cycle!.phase).toBe('slice_end');
  });
});

describe('AC09 記憶処理', () => {
  it('S=3 で携帯写しが消え、封筒・観測の原記録・報告履歴は保持される', () => {
    const state = createInitialState();
    startNewCycle(state);
    morningAction(state, 'cellmate');
    state.cycle!.envelope.push({ id: 'e0', source: 'free', text: '前任者のメモ', writtenDay: 0 });
    answerSummons(state);
    // 動かずに時間切れ。異常の根拠となる観測を持たない
    const d = new Driver(beginTrial(state));
    d.hold(PACING.deadline + 1);
    resolveTrial(state);
    const s = state.cycle!.subject;
    expect(s.notebook.observations).toHaveLength(1);
    expect(s.notebook.hearsay).toHaveLength(1);
    s.stats.suspicion = 2;

    answerInterrogation(state, 'know_all');
    expect(s.stats.suspicion).toBe(1);
    expect(s.notebook.observations).toEqual([{ kind: 'erased', id: expect.any(String) }]);
    expect(s.notebook.hearsay).toEqual([{ kind: 'erased', id: expect.any(String) }]);
    expect(s.evidence).toEqual(['pacing.timeout']);
    expect(state.cycle!.envelope).toHaveLength(1);
    expect(state.meta.archive).toHaveLength(1);
    expect(state.cycle!.notices.join('')).toContain('書いた覚えのない空白');
  });
});

describe('AC14 終了判定表（判定関数のみ。7日接続は未実装）', () => {
  const good = { evaluation: 2, credit: 2, suspicion: 1 };
  it('優先順で最初の1件だけを返す', () => {
    expect(decideEnding({ escapeAttempt: true, diedOnFinalDay: true, finalTaskSurvived: true, stats: good })).toBe('escape_attempt');
    expect(decideEnding({ escapeAttempt: false, diedOnFinalDay: true, finalTaskSurvived: true, stats: good })).toBe('disposal_no_replacement');
    expect(decideEnding({ escapeAttempt: false, diedOnFinalDay: false, finalTaskSurvived: true, stats: good })).toBe('useful');
    expect(decideEnding({ escapeAttempt: false, diedOnFinalDay: false, finalTaskSurvived: true, stats: { ...good, suspicion: 2 } })).toBe('disposal');
    expect(decideEnding({ escapeAttempt: false, diedOnFinalDay: false, finalTaskSurvived: false, stats: good })).toBe('disposal');
  });
});
