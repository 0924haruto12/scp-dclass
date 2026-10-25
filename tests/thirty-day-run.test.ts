import { describe, expect, it } from 'vitest';
import {
  FINAL_DAY,
  getRunStage,
  ROLE_EVAL_DAYS,
  RUN_LENGTH_DAYS,
  THIRTY_DAY_SCHEDULE,
  WATER_COOLER_INSTALL_DAYS,
} from '../src/core/content';
import {
  concludeTrialPhase,
  createInitialGameState,
  handleComparisonInterviewAction,
  interactWaterCoolerInMorning,
  performSafeReevaluationTaskAtNight,
  prepareFacilityDay,
  proceedFromDeathReport,
  proceedFromMorning,
  proceedFromNightToNextDay,
  startCurrentDayTrial,
  startNewCycle,
  submitDebriefResponse,
} from '../src/core/engine';
import {
  loadGameState,
  MemoryStorageBackend,
  saveGameState,
} from '../src/core/storage';

describe('30日間ラン', () => {
  it('30日間の固定割当表が全日を覆い、各期・評価日・給水器設置日・最終日が整合する', () => {
    expect(RUN_LENGTH_DAYS).toBe(30);
    expect(THIRTY_DAY_SCHEDULE).toHaveLength(30);
    expect(THIRTY_DAY_SCHEDULE.map((entry) => entry.day)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1)
    );

    const finalEntry = THIRTY_DAY_SCHEDULE[FINAL_DAY - 1];
    expect(finalEntry.roomCode).toBe('T-101');
    expect(finalEntry.isFinalDay).toBe(true);
    expect(finalEntry.briefingWord).toBe('最終回収');

    for (const day of ROLE_EVAL_DAYS) {
      expect(THIRTY_DAY_SCHEDULE[day - 1].isRoleEvalEligible).toBe(true);
      expect(THIRTY_DAY_SCHEDULE[day - 1].roomCode).toBe('T-101');
    }
    expect(
      THIRTY_DAY_SCHEDULE.filter((entry) => entry.isRoleEvalEligible).map((entry) => entry.day)
    ).toEqual([...ROLE_EVAL_DAYS]);

    for (const day of WATER_COOLER_INSTALL_DAYS) {
      expect(THIRTY_DAY_SCHEDULE[day - 1].hasWaterCoolerSetup).toBe(true);
    }
    expect(
      THIRTY_DAY_SCHEDULE.filter((entry) => entry.hasWaterCoolerSetup).map((entry) => entry.day)
    ).toEqual([...WATER_COOLER_INSTALL_DAYS]);

    expect(getRunStage(1).id).toBe('observation');
    expect(getRunStage(10).id).toBe('observation');
    expect(getRunStage(11).id).toBe('contact');
    expect(getRunStage(20).id).toBe('contact');
    expect(getRunStage(21).id).toBe('month_end');
    expect(getRunStage(30).id).toBe('month_end');
  });

  it('死亡せずに30日目まで進め、16日目と30日目の評価を同一人物で完了すると有用認定になる', () => {
    const state = createInitialGameState('FIXED-DEFAULT');

    for (let day = 1; day <= RUN_LENGTH_DAYS; day++) {
      expect(state.cycle.day).toBe(day);
      expect(state.cycle.phase).toBe('morning');

      proceedFromMorning(state, 'normal_duty');
      expect(state.cycle.phase).toBe('briefing');

      const trial = startCurrentDayTrial(state);
      expect(state.cycle.phase).toBe('trial');

      // Complete the assigned objective. The exact room mechanics are covered by
      // the existing AC04 / AC10 / AC12 tests; this test verifies the full date loop.
      trial.player.carryingObjective = true;
      trial.status = 'survived';

      concludeTrialPhase(state);
      expect(state.cycle.phase).toBe('debrief');

      submitDebriefResponse(state, 'choice-silent');

      if (day < RUN_LENGTH_DAYS) {
        expect(state.cycle.phase).toBe('night');
        const beforeC = state.subject.C;
        performSafeReevaluationTaskAtNight(state);
        expect(state.subject.C).toBeGreaterThanOrEqual(beforeC);

        proceedFromNightToNextDay(state);
        expect(state.cycle.day).toBe(day + 1);
      }
    }

    expect(state.cycle.day).toBe(30);
    expect(state.cycle.phase).toBe('ending');
    expect(state.subject.E).toBe(2);
    expect(state.subject.C).toBeGreaterThanOrEqual(2);
    expect(state.subject.S).toBeLessThanOrEqual(1);
    expect(state.cycle.endingResult).toBe('certified_useful');
  });

  it('29日目の死亡では30日目朝へ進み、30日目の死亡では欠員補充停止で終了する', () => {
    const state = createInitialGameState('FIXED-DEFAULT');
    state.cycle.day = 29;
    state.cycle.phase = 'briefing';
    const oldSubjectId = state.subject.subjectId;

    const trial29 = startCurrentDayTrial(state);
    trial29.status = 'dead';
    trial29.deathCause = 'テスト用の反応消失';
    concludeTrialPhase(state);
    expect(state.cycle.phase).toBe('death_report');

    proceedFromDeathReport(state);
    expect(state.cycle.day).toBe(30);
    expect(state.cycle.phase).toBe('morning');
    expect(state.subject.subjectId).not.toBe(oldSubjectId);

    proceedFromMorning(state, 'normal_duty');
    const trial30 = startCurrentDayTrial(state);
    trial30.status = 'dead';
    trial30.deathCause = 'テスト用の最終日反応消失';
    concludeTrialPhase(state);
    expect(state.cycle.phase).toBe('death_report');

    proceedFromDeathReport(state);
    expect(state.cycle.phase).toBe('ending');
    expect(state.cycle.endingResult).toBe('termination_shortage');
  });

  it('29日目の夜だけ監督用名札が支給され、30日目の朝に脱走未遂へ進める', () => {
    const beforeUnlock = createInitialGameState('FIXED-DEFAULT');
    beforeUnlock.cycle.day = 28;
    beforeUnlock.cycle.phase = 'night';
    beforeUnlock.subject.C = 3;
    beforeUnlock.subject.S = 0;
    performSafeReevaluationTaskAtNight(beforeUnlock);
    expect(beforeUnlock.subject.hasSupervisorBadge).toBe(false);

    const state = createInitialGameState('FIXED-DEFAULT');
    state.cycle.day = 29;
    state.cycle.phase = 'night';
    state.subject.C = 2;
    state.subject.S = 1;

    const taskMsg = performSafeReevaluationTaskAtNight(state);
    expect(state.subject.hasSupervisorBadge).toBe(true);
    expect(taskMsg).toContain('29日目');

    proceedFromNightToNextDay(state);
    expect(state.cycle.day).toBe(30);
    expect(state.cycle.phase).toBe('morning');

    proceedFromMorning(state, 'attempt_escape_with_supervisor_badge');
    expect(state.cycle.phase).toBe('ending');
    expect(state.cycle.endingResult).toBe('escape_attempt');
  });

  it('給水器は12日目にも再設置され、遅効比較面接が所定の朝に解決する', () => {
    const state = createInitialGameState('FIXED-DEFAULT');
    state.cycle.day = 12;
    state.cycle.phase = 'morning';
    prepareFacilityDay(state.cycle);
    expect(state.cycle.waterCoolerPresent).toBe(true);
    expect(state.cycle.waterCoolerInstallDay).toBe(12);

    const drinkMsg = interactWaterCoolerInMorning(state, 'drink');
    expect(drinkMsg).toContain('水を飲んだ');
    expect(state.subject.C).toBe(1);

    const scheduled = state.deferredEvents.find((event) => event.type === 'water_duplicate');
    expect(scheduled).toBeDefined();
    expect(scheduled?.originDay).toBe(12);
    expect(scheduled?.resolveDay).toBe(16); // 12 + 3 (FIXED-DEFAULT) + 1

    state.cycle.day = 15;
    state.cycle.phase = 'night';
    proceedFromNightToNextDay(state);
    expect(state.cycle.day).toBe(16);
    expect(state.cycle.phase).toBe('morning_comparison');

    handleComparisonInterviewAction(state, 'cooperate_answer');
    expect(state.cycle.phase).toBe('morning');
    expect(state.subject.C).toBeGreaterThanOrEqual(1);
  });

  it('旧7日間保存を読み込むと30日間スケジュールへ移行し、日付・被験者・封筒を保持する', () => {
    const backend = new MemoryStorageBackend();
    const state = createInitialGameState('FIXED-DEFAULT');
    state.cycle.day = 7;
    state.cycle.phase = 'night';
    state.cycle.schedule = state.cycle.schedule.slice(0, 7);
    state.cycle.version = '0.1.0';
    state.cycle.waterCoolerPresent = true;
    (state.cycle as unknown as { waterCoolerInstallDay?: number | null }).waterCoolerInstallDay =
      undefined;
    state.cycle.envelope = [
      {
        id: 'env-legacy',
        sourceType: 'observation',
        title: '旧保存のメモ',
        content: '旧7日間サイクルで封入された記録',
        roomCode: 'T-101',
        recordedBySubjectId: state.subject.subjectId,
        recordedDay: 6,
      },
    ];
    const subjectId = state.subject.subjectId;

    expect(saveGameState(state, backend)).toBe(true);
    const loaded = loadGameState(backend);
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;

    expect(loaded.state.cycle.day).toBe(7);
    expect(loaded.state.subject.subjectId).toBe(subjectId);
    expect(loaded.state.cycle.envelope).toHaveLength(1);
    expect(loaded.state.cycle.schedule).toHaveLength(30);
    expect(loaded.state.cycle.schedule[29].day).toBe(30);
    expect(loaded.state.cycle.version).toBe('0.2.0-30d');
    expect(
      loaded.state.lastActionLog.some((line) => line.includes('30日間スケジュールへ移行'))
    ).toBe(true);
  });

  it('30日終了後に新サイクルを開始すると、日付が1日に戻り施設コードだけが進む', () => {
    const state = createInitialGameState('FIXED-DEFAULT');
    state.cycle.day = 30;
    state.cycle.phase = 'ending';
    state.cycle.endingResult = 'termination_standard';

    const next = startNewCycle(state, 'SEED-NEXT-CYCLE');

    expect(next.cycle.cycleId).toBe('SITE-19-C02');
    expect(next.cycle.day).toBe(1);
    expect(next.cycle.phase).toBe('morning');
    expect(next.cycle.schedule).toHaveLength(30);
    expect(next.cycle.endingResult).toBeNull();
    expect(next.cycle.seed).toBe('SEED-NEXT-CYCLE');
    expect(next.reportArchive).toHaveLength(state.reportArchive.length);
  });
});
