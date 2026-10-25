import { describe, expect, it } from 'vitest';
import {
  answerInterrogation,
  answerSummons,
  beginTrial,
  createInitialState,
  interrogationOptions,
  nightAction,
  proceedToNight,
  resolveTrial,
  startNewCycle,
  trialLedger,
  type GameState,
} from '../src/core/cycle';
import { availableOptions, resolveOption, type InterrogationContext } from '../src/core/interrogation';
import { applyDelta, shortfallKey } from '../src/core/ledger';
import { addHypothesis } from '../src/core/notebook';
import { TICKS, type TrialOutcome } from '../src/core/pacing';
import { Driver, gaitInput } from './helpers';

function startedTrial(): { state: GameState; d: Driver } {
  const state = createInitialState();
  startNewCycle(state);
  answerSummons(state);
  const trial = beginTrial(state);
  return { state, d: new Driver(trial) };
}

/** 前兆を見て止まり、正しい行動で生還する被験者 */
function perfectRun(d: Driver): void {
  d.walkTo(22.5, 'normal');
  d.interact();
  d.walkTo(16.5, 'normal');
  d.walkTo(7.9, 'run');
  d.holdTicks(TICKS.stopRelease);
  d.holdTicks(TICKS.retreat);
  d.walkTo(0.5, 'normal');
}

const baseCtx: InterrogationContext = {
  trialId: 't1',
  retrieved: true,
  observedThisTrial: [],
  subjectEvidence: [],
  memoAvailable: false,
};

describe('AC07 前兆への反応・仮説の文章・未提示の選択肢だけでは疑念が変わらない', () => {
  it('前兆を見て止まり、足音を理由に説明しても S は 0 のまま', () => {
    const { state, d } = startedTrial();
    perfectRun(d);
    expect(d.state.outcome?.kind).toBe('survived');
    resolveTrial(state);
    const options = interrogationOptions(state.cycle!).map((o) => o.id);
    expect(options).toContain('footsteps');
    answerInterrogation(state, 'footsteps');
    expect(state.cycle!.subject.stats.suspicion).toBe(0);
    expect(state.cycle!.subject.stats.credit).toBe(1);
  });

  it('ノートに正解らしい仮説を書いても判定は変わらない', () => {
    const plain = startedTrial();
    const noted = startedTrial();
    addHypothesis(
      noted.state.cycle!.subject.notebook,
      { name: '歩調', trigger: '走る', effect: '死ぬ', condition: '速度2.5超', evidence: [], note: '走ると死ぬ。止まれば戻る' },
      1,
    );
    for (const run of [plain, noted]) {
      perfectRun(run.d);
      resolveTrial(run.state);
      answerInterrogation(run.state, 'know_all');
    }
    expect(noted.state.cycle!.subject.stats).toEqual(plain.state.cycle!.subject.stats);
  });

  it('選択肢を表示しただけでは何も変わらない', () => {
    const { state, d } = startedTrial();
    perfectRun(d);
    resolveTrial(state);
    const before = structuredClone(state.cycle!.subject.stats);
    for (let i = 0; i < 5; i++) interrogationOptions(state.cycle!);
    expect(state.cycle!.subject.stats).toEqual(before);
  });

  it('「全部知っている」は根拠となる観測がない時だけ S+1', () => {
    expect(resolveOption(baseCtx, 'know_all').parts).toEqual([{ key: 'suspicion:claim:t1', suspicion: 1 }]);
    expect(resolveOption({ ...baseCtx, subjectEvidence: ['pacing.echo'] }, 'know_all').parts).toEqual([]);
    // 床の痕跡を調べただけでは異常の根拠にならない
    expect(resolveOption({ ...baseCtx, subjectEvidence: ['pacing.scuff'] }, 'know_all').parts).toHaveLength(1);
  });

  it('観測していない事柄を説明する選択肢は出さない', () => {
    expect(availableOptions(baseCtx).map((o) => o.id)).not.toContain('footsteps');
    expect(availableOptions(baseCtx).map((o) => o.id)).not.toContain('submit_memo');
    const heardAndStopped = { ...baseCtx, observedThisTrial: ['pacing.echo', 'pacing.stop_silence'] as InterrogationContext['observedThisTrial'] };
    expect(availableOptions(heardAndStopped).map((o) => o.id)).toContain('footsteps');
  });
});

describe('AC08 同じ質問・目的物・安全業務の加点は1回だけ', () => {
  it('試験結果の判定を二度呼んでも回収の加点は1回', () => {
    const { state, d } = startedTrial();
    perfectRun(d);
    resolveTrial(state);
    resolveTrial(state);
    expect(state.cycle!.subject.stats.credit).toBe(1);
    answerInterrogation(state, 'footsteps');
    expect(answerInterrogation(state, 'footsteps')).toBeNull();
    expect(state.cycle!.subject.stats.credit).toBe(1);
  });

  it('安全な追加業務を同じ夜に二度行っても C+1・S-1 は各1回', () => {
    const { state, d } = startedTrial();
    perfectRun(d);
    resolveTrial(state);
    answerInterrogation(state, 'know_all');
    expect(state.cycle!.subject.stats).toMatchObject({ credit: 1, suspicion: 0 });
    state.cycle!.subject.stats.suspicion = 2;
    proceedToNight(state);
    nightAction(state, 'safe_task');
    nightAction(state, 'safe_task');
    expect(state.cycle!.subject.stats).toMatchObject({ credit: 2, suspicion: 1 });
  });

  it('拒否・指示未達・時間切れが重なっても、同じ試験の未達減点は合計1', () => {
    const outcome: TrialOutcome = {
      kind: 'timeout',
      tick: 7200,
      hasBox: true,
      lastMode: 'still',
      lastModeTicks: 0,
      leg: 'return',
      instructions: [
        { id: 'pacing.brief', scheduledTick: 0, issuedTick: 0, response: 'refuse', questioned: true, achieved: false },
        { id: 'pacing.run', scheduledTick: 100, issuedTick: 100, response: 'refuse', questioned: true, achieved: false },
      ],
    };
    const parts = trialLedger('t1', outcome);
    expect(parts).toEqual([{ key: shortfallKey('t1'), credit: -1 }]);
    const stats = { credit: 2, suspicion: 0, evaluation: 0 };
    const awarded: string[] = [];
    applyDelta(stats, awarded, parts);
    // 聴取で「話さない」を選んでも、同じ試験の未達減点は増えない
    applyDelta(stats, awarded, resolveOption({ ...baseCtx, retrieved: false }, 'silent').parts);
    expect(stats.credit).toBe(1);
  });

  it('同じ結果の加減点は合計してから1回だけ丸める', () => {
    const stats = { credit: 3, suspicion: 0, evaluation: 0 };
    applyDelta(stats, [], [
      { key: 'a', credit: 1 },
      { key: 'b', credit: -1 },
    ]);
    expect(stats.credit).toBe(3);
  });

  it('走行指示を拒否して箱を持ち帰ると、その試験の信用収支は0', () => {
    const { state, d } = startedTrial();
    d.walkTo(22.5, 'normal');
    d.interact();
    d.hold(1.1, gaitInput('slow', -1));
    d.step({ response: 'refuse' });
    d.walkTo(0.5, 'normal');
    expect(d.state.outcome?.kind).toBe('survived');
    resolveTrial(state);
    expect(state.cycle!.subject.stats.credit).toBe(0);
  });
});
