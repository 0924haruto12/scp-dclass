import { describe, expect, it } from 'vitest';
import {
  applyMemoryTreatment,
  concludeTrialPhase,
  copyItemsToEnvelopeAtNight,
  createInitialGameState,
  evaluateFinalDayOutcome,
  handleComparisonInterviewAction,
  inspectEnvelopeInMorning,
  interactWaterCoolerInMorning,
  performBadgeReverification,
  performSafeReevaluationTaskAtNight,
  proceedFromDeathReport,
  proceedFromMorning,
  proceedFromNightToNextDay,
  startCurrentDayTrial,
  submitDebriefResponse,
  updateHypothesis,
} from '../src/core/engine';
import {
  interactWithTrialObject,
  replyToInstruction,
  setTrialPause,
  stepTrial,
  traverseWhiteDoor,
  verifyWhiteDoorMapConstraints,
} from '../src/core/trials';
import {
  archiveCorruptedAndClearSave,
  CORRUPTED_BACKUP_KEY,
  loadGameState,
  MemoryStorageBackend,
  SAVE_STORAGE_KEY,
  saveGameState,
  StorageBackend,
} from '../src/core/storage';

describe('NEED TO KNOW MVP Acceptance Criteria (AC01 - AC15)', () => {
  it('AC01: Dying in the same facility advances day by 1 only, preserving anomaly parameters and under-bunk envelope', () => {
    const state = createInitialGameState('SEED-AC01');
    const initialParams = structuredClone(state.cycle.fixedParams);

    // Put an item into the envelope on Day 1 night or directly verify envelope persistence
    state.cycle.phase = 'night';
    copyItemsToEnvelopeAtNight(state, [
      {
        sourceType: 'observation',
        title: 'T-101 停止記録',
        content: '歩行を停止すると、半拍遅れて重なっていた背後の足音も停止した',
        roomCode: 'T-101',
        canonicalEvidenceId: 'ev-t101-echo-stop',
      },
    ]);
    expect(state.cycle.envelope).toHaveLength(1);

    // Return to Day 1 trial and trigger death in T-101
    state.cycle.phase = 'briefing';
    const trial = startCurrentDayTrial(state);
    // Run for 3.1s to exceed 3.0s approach grace
    stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 1, moveY: 0, moveMode: 'run' }, 3.1);
    expect(trial.status).toBe('dead');

    concludeTrialPhase(state);
    expect(state.cycle.phase).toBe('death_report');

    proceedFromDeathReport(state);
    expect(state.cycle.day).toBe(2);
    expect(state.cycle.phase).toBe('morning');
    expect(state.cycle.fixedParams).toEqual(initialParams);
    expect(state.cycle.envelope).toHaveLength(1);
    expect(state.cycle.envelope[0].content).toContain('背後の足音も停止した');
  });

  it('AC02: New subject has C/S/E and personal effects initialized, and old subject water cooler event is cancelled', () => {
    const state = createInitialGameState('FIXED-DEFAULT');
    state.cycle.day = 2;
    state.cycle.waterCoolerPresent = true;
    const oldSubjectId = state.subject.subjectId;

    // Drink from water cooler on Day 2 (grants C+1 and schedules duplicate event)
    interactWaterCoolerInMorning(state, 'drink');
    expect(state.subject.C).toBe(1);
    expect(state.deferredEvents).toHaveLength(1);
    expect(state.deferredEvents[0].targetSubjectId).toBe(oldSubjectId);

    // Give subject S=2, E=1, and badge effect
    state.subject.S = 2;
    state.subject.E = 1;
    state.subject.displayedBadgeNumber = 'D-3904';
    state.subject.badgeEffectUntilDay = 3;

    // Subject dies on Day 2
    state.cycle.phase = 'death_report';
    proceedFromDeathReport(state);

    // New subject on Day 3
    expect(state.cycle.day).toBe(3);
    expect(state.subject.subjectId).not.toBe(oldSubjectId);
    expect(state.subject.C).toBe(0);
    expect(state.subject.S).toBe(0);
    expect(state.subject.E).toBe(0);
    expect(state.subject.displayedBadgeNumber).toBe(state.subject.originalNumber);
    expect(state.subject.badgeEffectUntilDay).toBeNull();
    expect(state.deferredEvents[0].cancelled).toBe(true);

    // Advance to Day 6 morning (when delay=3 duplicate would have resolved) -> should NOT trigger morning_comparison
    state.cycle.day = 5;
    state.cycle.phase = 'night';
    proceedFromNightToNextDay(state);
    expect(state.cycle.day).toBe(6);
    expect(state.cycle.phase).toBe('morning');
    expect(state.comparisonInterview).toBeNull();
  });

  it('AC03: Resuming from save preserves seed, day, warning clock, and never re-executes resolved events', () => {
    const storage = new MemoryStorageBackend();
    const state = createInitialGameState('FIXED-DEFAULT');
    state.cycle.day = 2;
    state.cycle.waterCoolerPresent = true;
    interactWaterCoolerInMorning(state, 'drink');
    expect(state.subject.C).toBe(1);

    // Enter T-101 trial and trigger approach omen for 1.5s
    state.cycle.day = 1;
    const trial = startCurrentDayTrial(state);
    stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 1, moveY: 0, moveMode: 'run' }, 1.5);
    expect(trial.gait.state).toBe('approaching');
    expect(trial.hazardTimer).toBeCloseTo(1.5, 5);

    const savedOk = saveGameState(state, storage);
    expect(savedOk).toBe(true);

    const loaded = loadGameState(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.state.cycle.seed).toBe('FIXED-DEFAULT');
      expect(loaded.state.cycle.fixedParams).toEqual(state.cycle.fixedParams);
      expect(loaded.state.trial?.hazardTimer).toBeCloseTo(1.5, 5);
      // Restored trial starts paused
      expect(loaded.state.trial?.status).toBe('paused');

      // Trying to drink water cooler again with same processedEventIds does not re-execute
      loaded.state.cycle.day = 2;
      const msg = interactWaterCoolerInMorning(loaded.state, 'drink');
      expect(msg).toContain('既に');
      expect(loaded.state.subject.C).toBe(1);
    }
  });

  it('AC04: T-101 Gait allows slow round-trip under both thresholds (1.5 & 2.5), and stopping (0.5s) or slow walk (1.0s) cancels lethal approach', () => {
    for (const threshold of [1.5, 2.5] as const) {
      const state = createInitialGameState('FIXED-DEFAULT');
      state.cycle.fixedParams.gaitAllowedSpeed = threshold;
      const trial = startCurrentDayTrial(state);

      // Slow walk (1.0 u/s) outbound 24m takes 24s
      stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 1, moveY: 0, moveMode: 'slow' }, 24);
      expect(trial.player.x).toBeCloseTo(24, 3);
      expect(trial.gait.state).toBe('following');

      interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t101-box');
      expect(trial.player.carryingObjective).toBe(true);

      // Trigger approaching by running for 2.0s (8m from x=24 to x=16)
      stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: -1, moveY: 0, moveMode: 'run' }, 2.0);
      expect(trial.gait.state).toBe('approaching');
      expect(trial.hazardTimer).toBeCloseTo(2.0, 3);

      // Normal walk does NOT cancel approaching even when threshold is 2.5
      stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: -1, moveY: 0, moveMode: 'normal' }, 0.4);
      expect(trial.gait.state).toBe('approaching');
      expect(trial.hazardTimer).toBeCloseTo(2.4, 3);

      // Relief 1: Stop for 0.5s cancels approaching -> retreating -> following
      stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 0, moveY: 0, moveMode: 'stop' }, 0.5);
      expect(trial.gait.state).toBe('retreating');
      expect(trial.hazardTimer).toBe(0);
      stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 0, moveY: 0, moveMode: 'stop' }, 1.0);
      expect(trial.gait.state).toBe('following');

      // Trigger approaching again by running for 1.5s
      stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: -1, moveY: 0, moveMode: 'run' }, 1.5);
      expect(trial.gait.state).toBe('approaching');

      // Relief 2: Slow walk for 1.0s cancels approaching -> retreating
      stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: -1, moveY: 0, moveMode: 'slow' }, 1.0);
      expect(trial.gait.state).toBe('retreating');
      expect(trial.hazardTimer).toBe(0);

      // Finish return trip at slow speed (1.0 u/s)
      stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: -1, moveY: 0, moveMode: 'slow' }, 20);
      expect(trial.status).toBe('survived');
      expect(trial.externalClock).toBeLessThan(120);
    }
  });

  it('AC05: No lethal outcome without prior omen, no evasion required during input lock, and hazard timer freezes while paused/notebook open', () => {
    const state = createInitialGameState('FIXED-DEFAULT');
    const trial = startCurrentDayTrial(state);

    // Run for 1.0s -> omen must be active BEFORE any death
    stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 1, moveY: 0, moveMode: 'run' }, 1.0);
    expect(trial.omen.active).toBe(true);
    expect(trial.status).toBe('active');
    expect(trial.hazardTimer).toBeCloseTo(1.0, 5);

    // Open notebook -> pauses trial and stops movement
    setTrialPause(trial, 'notebook');
    expect(trial.status).toBe('paused');
    stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 1, moveY: 0, moveMode: 'run' }, 10.0);
    expect(trial.hazardTimer).toBeCloseTo(1.0, 5);
    expect(trial.externalClock).toBeCloseTo(1.0, 5);
    expect(trial.status).toBe('paused');

    // Unpause and test input lock
    setTrialPause(trial, 'none');
    trial.player.inputLocked = true;
    // During input lock, effective mode becomes 'stop', which pauses/relieves hazard rather than killing player
    stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 1, moveY: 0, moveMode: 'run' }, 0.5);
    expect(trial.gait.state).toBe('retreating');
  });

  it('AC06: Subtitles ON, Volume 0, and Normal Audio all produce identical timing perceptual cues from the same event source without imperative spoilers', () => {
    const configs = [
      { subtitlesOn: true, volume: 0.8 },
      { subtitlesOn: true, volume: 0.0 },
      { subtitlesOn: false, volume: 0.8 },
    ];

    const snapshots = configs.map((cfg) => {
      const state = createInitialGameState('FIXED-DEFAULT');
      state.settings.subtitlesOn = cfg.subtitlesOn;
      state.settings.volume = cfg.volume;
      const trial = startCurrentDayTrial(state);
      stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 1, moveY: 0, moveMode: 'run' }, 0.5);
      stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 0, moveY: 0, moveMode: 'stop' }, 0.5);
      return trial.cues;
    });

    expect(snapshots[0]).toEqual(snapshots[1]);
    expect(snapshots[1]).toEqual(snapshots[2]);

    // Verify cues contain perceptual descriptions only, never "停止せよ" or "危険度上昇"
    for (const cue of snapshots[0]) {
      expect(cue.subtitleText).not.toContain('停止せよ');
      expect(cue.subtitleText).not.toContain('危険度上昇');
    }
  });

  it('AC07: Reacting to omens, writing correct/any hypothesis text, or unchosen dialogue options never increases Suspicion S', () => {
    const state = createInitialGameState('FIXED-DEFAULT');
    expect(state.subject.S).toBe(0);

    // Write exact secret rules into hypothesis notebook
    updateHypothesis(state, 'T-101', {
      customName: '歩調の異常',
      triggerText: '許容速度2.5を超えると接近する',
      effectText: '3秒で接触死',
      conditionText: '0.5秒停止または1秒低速歩行で解除',
      freeNote: '研究員の走る指示は負荷テスト',
    });
    expect(state.subject.S).toBe(0);

    // React perfectly to omens in T-101
    const trial = startCurrentDayTrial(state);
    stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 1, moveY: 0, moveMode: 'normal' }, 12);
    interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t101-box');
    stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: -1, moveY: 0, moveMode: 'run' }, 2.0);
    stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 0, moveY: 0, moveMode: 'stop' }, 0.5);
    stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: -1, moveY: 0, moveMode: 'normal' }, 9.0);
    expect(trial.status).toBe('survived');

    concludeTrialPhase(state);
    // Choose grounded observation in debrief
    submitDebriefResponse(state, 'choice-grounded');
    expect(state.subject.S).toBe(0);
  });

  it('AC08: Repeating questions on same instruction, re-collecting objective, or repeating safe tasks only awards points once', () => {
    const state = createInitialGameState('FIXED-DEFAULT');
    const trial = startCurrentDayTrial(state);

    // Ask question twice on same instruction
    const r1 = replyToInstruction(trial, 'inst-t101-retrieve', 'question');
    const r2 = replyToInstruction(trial, 'inst-t101-retrieve', 'question');
    expect(r1).not.toContain('既に記録済み');
    expect(r2).toContain('既に記録済み');

    // Collect objective twice
    trial.player.x = 24;
    interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t101-box');
    const msg2 = interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t101-box');
    expect(msg2).toContain('既に回収箱を保持');

    // Complete trial and move to night
    trial.player.x = 0.2;
    stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: -1, moveY: 0, moveMode: 'slow' }, 0.2);
    expect(trial.status).toBe('survived');
    concludeTrialPhase(state);
    submitDebriefResponse(state, 'choice-excuse');
    expect(state.cycle.phase).toBe('night');

    const cBefore = state.subject.C;
    performSafeReevaluationTaskAtNight(state);
    expect(state.subject.C).toBe(cBefore + 1);
    const repeatMsg = performSafeReevaluationTaskAtNight(state);
    expect(repeatMsg).toContain('既に完了');
    expect(state.subject.C).toBe(cBefore + 1);
  });

  it('AC09: Memory treatment erases portable note copies, sets S=1, and preserves envelope and ReportArchive', () => {
    const state = createInitialGameState('FIXED-DEFAULT');
    const trial = startCurrentDayTrial(state);
    interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t101-scuff');
    expect(state.subject.portableNote.observations.length).toBeGreaterThan(0);

    // Put an item in the under-bunk envelope
    state.cycle.envelope = [
      {
        id: 'env-1',
        sourceType: 'observation',
        title: '保存メモ',
        content: '床の擦り跡の記録',
        roomCode: 'T-101',
        recordedBySubjectId: state.subject.subjectId,
        recordedDay: 1,
      },
    ];

    // Finish trial and trigger S=3 at debrief
    trial.status = 'survived';
    state.subject.S = 3;
    concludeTrialPhase(state);
    submitDebriefResponse(state, 'choice-silent');

    // Memory treatment should have run: S becomes 1, today's portable observations marked erased, envelope & archive preserved
    expect(state.subject.S).toBe(1);
    expect(state.subject.portableNote.observations.every((o) => o.erased)).toBe(true);
    expect(state.subject.portableNote.observations.every((o) => o.eventFact === '')).toBe(true);
    expect(state.cycle.envelope).toHaveLength(1);
    expect(state.reportArchive.length).toBeGreaterThan(0);
  });

  it('AC10: Wearing a badge changes human address while machine authentication and original subjectId remain unchanged', () => {
    const state = createInitialGameState('FIXED-DEFAULT');
    state.cycle.day = 2;
    const originalId = state.subject.subjectId;
    const trial = startCurrentDayTrial(state);
    expect(trial.roomCode).toBe('T-204');

    // Wear supplied badge D-3904
    interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t204-counter');
    expect(state.subject.displayedBadgeNumber).toBe('D-3904');
    expect(state.subject.originalNumber).toBe(originalId);
    expect(state.subject.subjectId).toBe(originalId);

    // Interview booth clerk addresses subject as D-3904
    const boothMsg = interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t204-booth');
    expect(boothMsg).toContain('D-3904');

    // Machine terminal reads originalId
    const termMsg = interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t204-terminal');
    expect(termMsg).toContain(originalId);

    // Reverification restores displayedBadgeNumber without adding S
    const sBefore = state.subject.S;
    performBadgeReverification(state.subject, trial);
    expect(state.subject.displayedBadgeNumber).toBe(originalId);
    expect(state.subject.badgeTargetStatus).toBe('hazard_corrected');
    expect(state.subject.S).toBe(sBefore);
  });

  it('AC11: Water cooler 2- or 3-day delayed event resolves on scheduled morning, and C=0 subject can survive via safe interview cooperation', () => {
    for (const delay of [2, 3] as const) {
      const state = createInitialGameState('FIXED-DEFAULT');
      state.cycle.fixedParams.waterCoolerDelayDays = delay;
      state.cycle.day = 2;
      state.cycle.waterCoolerPresent = true;

      interactWaterCoolerInMorning(state, 'drink');
      // Force C back to 0 to test survival from C=0
      state.subject.C = 0;

      const expectedMorningDay = 2 + delay + 1; // Day 5 for delay=2, Day 6 for delay=3
      state.cycle.day = expectedMorningDay - 1;
      state.cycle.phase = 'night';
      proceedFromNightToNextDay(state);

      expect(state.cycle.day).toBe(expectedMorningDay);
      expect(state.cycle.phase).toBe('morning_comparison');
      expect(state.comparisonInterview?.active).toBe(true);

      // Cooperate in safe interview -> C becomes 1 (>= duplicate's 1) -> survives!
      handleComparisonInterviewAction(state, 'cooperate_answer');
      expect(state.subject.C).toBe(1);
      expect(state.cycle.phase).toBe('morning');
    }
  });

  it('AC12: White Door (T-309) has valid round-trip paths under both phases and clock ratios, and all walkable positions reach an anchor point within <= 2.0s', () => {
    const mapCheck = verifyWhiteDoorMapConstraints();
    expect(mapCheck.valid).toBe(true);
    expect(mapCheck.maxSlowSecondsToAnchor).toBeLessThanOrEqual(2.0);

    for (const ratio of [1, 2] as const) {
      const state = createInitialGameState('FIXED-DEFAULT');
      state.cycle.fixedParams.whiteDoorTimeRatio = ratio;
      state.cycle.day = 3;
      const trial = startCurrentDayTrial(state);
      expect(trial.roomCode).toBe('T-309');

      // Anteroom checks do not advance external clock
      interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t309-clock');
      interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t309-window');
      expect(trial.externalClock).toBe(0);

      // Open main sector (enters E)
      interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t309-open-main');
      expect(trial.whiteDoor.currentRoom).toBe('E');

      // Traverse E -> X -> Y -> P in Phase A
      traverseWhiteDoor(trial, state.subject, state.cycle.fixedParams, 'forward');
      expect(trial.whiteDoor.currentRoom).toBe('X');
      traverseWhiteDoor(trial, state.subject, state.cycle.fixedParams, 'forward');
      expect(trial.whiteDoor.currentRoom).toBe('Y');
      traverseWhiteDoor(trial, state.subject, state.cycle.fixedParams, 'forward');
      expect(trial.whiteDoor.currentRoom).toBe('P');

      // Collect recording board in P
      interactWithTrialObject(trial, state.subject, state.cycle.fixedParams, 'obj-t309-board');
      expect(trial.whiteDoor.recordingBoardCollected).toBe(true);

      // Wait on anchor point through a full 30 internal seconds phase shift (A -> B)
      const realWaitForShift = 30 / ratio;
      stepTrial(trial, state.subject, state.cycle.fixedParams, { moveX: 0, moveY: 0, moveMode: 'stop' }, realWaitForShift);
      expect(trial.status).toBe('active');
      expect(trial.whiteDoor.phase).toBe('B');

      // Return P -> X -> Y -> E in Phase B
      traverseWhiteDoor(trial, state.subject, state.cycle.fixedParams, 'backward');
      expect(trial.whiteDoor.currentRoom).toBe('X');
      traverseWhiteDoor(trial, state.subject, state.cycle.fixedParams, 'backward');
      expect(trial.whiteDoor.currentRoom).toBe('Y');
      traverseWhiteDoor(trial, state.subject, state.cycle.fixedParams, 'backward');
      expect(trial.whiteDoor.currentRoom).toBe('E');
      traverseWhiteDoor(trial, state.subject, state.cycle.fixedParams, 'backward');
      expect(trial.status).toBe('survived');
    }
  });

  it('AC13: Both survival and death produce fact-based report fragments, and death count alone never unlocks extra secret lore', () => {
    const stateSurvive = createInitialGameState('FIXED-DEFAULT');
    const t1 = startCurrentDayTrial(stateSurvive);
    t1.player.carryingObjective = true;
    t1.player.x = 0.2;
    stepTrial(t1, stateSurvive.subject, stateSurvive.cycle.fixedParams, { moveX: -1, moveY: 0, moveMode: 'slow' }, 0.2);
    const fragSurvive = concludeTrialPhase(stateSurvive);
    expect(fragSurvive).toContain('T-101 事後記録');

    // Die 1st time vs 2nd time -> report fragments remain purely factual and identical in disclosure scope
    const stateDie = createInitialGameState('FIXED-DEFAULT');
    const deathFragments: string[] = [];
    for (let d = 1; d <= 2; d++) {
      stateDie.cycle.day = 1;
      stateDie.cycle.processedEventIds = [];
      const td = startCurrentDayTrial(stateDie);
      stepTrial(td, stateDie.subject, stateDie.cycle.fixedParams, { moveX: 1, moveY: 0, moveMode: 'run' }, 3.1);
      deathFragments.push(concludeTrialPhase(stateDie).replace(/D-\d+/g, 'D-XXXX'));
      proceedFromDeathReport(stateDie);
    }
    expect(deathFragments[0]).toBe(deathFragments[1]);
    expect(deathFragments[0]).not.toContain('許容速度2.5');
  });

  it('AC14: On Day 30, overlapping ending conditions strictly follow the priority table (1: Escape Attempt > 2: Day 30 Death > 3: Certified Useful > 4: Standard Termination)', () => {
    // Case 1: Subject has E=2, C=3, S=0 (eligible for Certified Useful) AND Supervisor Badge -> chooses Escape Attempt on Day 30 Morning -> Priority 1 wins
    const s1 = createInitialGameState('FIXED-DEFAULT');
    s1.cycle.day = 30;
    s1.subject.E = 2;
    s1.subject.C = 3;
    s1.subject.S = 0;
    s1.subject.hasSupervisorBadge = true;
    s1.subject.supervisorBadgeEarnedDay = 29;
    proceedFromMorning(s1, 'attempt_escape_with_supervisor_badge');
    expect(s1.cycle.endingResult).toBe('escape_attempt');

    // Case 2: Subject has E=2, C=3, S=0 on Day 30, enters final trial and dies -> Priority 2 (termination_shortage) wins over Certified Useful
    const s2 = createInitialGameState('FIXED-DEFAULT');
    s2.cycle.day = 30;
    s2.subject.E = 2;
    s2.subject.C = 3;
    s2.subject.S = 0;
    const t2 = startCurrentDayTrial(s2);
    stepTrial(t2, s2.subject, s2.cycle.fixedParams, { moveX: 1, moveY: 0, moveMode: 'run' }, 3.1);
    concludeTrialPhase(s2);
    proceedFromDeathReport(s2);
    expect(s2.cycle.endingResult).toBe('termination_shortage');

    // Case 3: Subject survives Day 30 with E=1, C=2, S=1 -> Priority 3 (certified_useful)
    const s3 = createInitialGameState('FIXED-DEFAULT');
    s3.cycle.day = 30;
    s3.subject.E = 1; // +1 from the final-day T-101 objective -> E=2
    s3.subject.C = 2;
    s3.subject.S = 1;
    const t3 = startCurrentDayTrial(s3);
    t3.player.carryingObjective = true;
    t3.player.x = 0.2;
    stepTrial(t3, s3.subject, s3.cycle.fixedParams, { moveX: -1, moveY: 0, moveMode: 'slow' }, 0.2);
    concludeTrialPhase(s3);
    submitDebriefResponse(s3, 'choice-grounded');
    expect(s3.subject.E).toBe(2);
    expect(s3.cycle.endingResult).toBe('certified_useful');

    // Case 4: Subject survives Day 30 after a mid-cycle death replacement (so E=1 < 2) -> Priority 4 (termination_standard)
    const s4 = createInitialGameState('FIXED-DEFAULT');
    s4.cycle.day = 30;
    s4.subject.E = 0; // Replaced subject missed the Day 16 evaluation -> only gets +1 on Day 30 -> E=1
    s4.subject.C = 3;
    s4.subject.S = 0;
    const t4 = startCurrentDayTrial(s4);
    t4.player.carryingObjective = true;
    t4.player.x = 0.2;
    stepTrial(t4, s4.subject, s4.cycle.fixedParams, { moveX: -1, moveY: 0, moveMode: 'slow' }, 0.2);
    concludeTrialPhase(s4);
    submitDebriefResponse(s4, 'choice-grounded');
    expect(s4.subject.E).toBe(1);
    expect(s4.cycle.endingResult).toBe('termination_standard');
  });

  it('AC15: When save data is corrupted, the original corrupted payload is preserved without being overwritten or silently replaced', () => {
    const storage = new MemoryStorageBackend();
    const corruptedPayload = '{ "schemaVersion": "1.0", "FacilityCycle": CORRUPTED_JSON ';
    storage.setItem(SAVE_STORAGE_KEY, corruptedPayload);

    const loadRes = loadGameState(storage);
    expect(loadRes.status).toBe('corrupted');
    if (loadRes.status === 'corrupted') {
      expect(loadRes.originalPreserved).toBe(true);
      expect(loadRes.rawOriginal).toBe(corruptedPayload);
    }

    // Attempting to auto-save a fresh state must NOT overwrite the unacknowledged corrupted save
    const fresh = createInitialGameState('FIXED-DEFAULT');
    const saveAllowed = saveGameState(fresh, storage);
    expect(saveAllowed).toBe(false);
    expect(storage.getItem(SAVE_STORAGE_KEY)).toBe(corruptedPayload);
  });
});

class WriteFailingBackend implements StorageBackend {
  constructor(
    private readonly inner: StorageBackend,
    private readonly failKey: string
  ) {}

  getItem(key: string): string | null {
    return this.inner.getItem(key);
  }

  setItem(key: string, value: string): void {
    if (key === this.failKey) {
      throw new Error('QuotaExceededError (simulated)');
    }
    this.inner.setItem(key, value);
  }

  removeItem(key: string): void {
    this.inner.removeItem(key);
  }
}

describe('ストレージ障害時の保護（統合版で追加）', () => {
  it('保存容量エラーでも例外を投げず、既存の正常なセーブを保持する', () => {
    const inner = new MemoryStorageBackend();
    const state = createInitialGameState('FIXED-DEFAULT');
    expect(saveGameState(state, inner)).toBe(true);
    const before = inner.getItem(SAVE_STORAGE_KEY);
    expect(before).not.toBeNull();

    const failing = new WriteFailingBackend(inner, SAVE_STORAGE_KEY);
    const changed = createInitialGameState('SEED-OTHER');

    expect(() => saveGameState(changed, failing)).not.toThrow();
    expect(saveGameState(changed, failing)).toBe(false);
    expect(inner.getItem(SAVE_STORAGE_KEY)).toBe(before);
  });

  it('破損データの退避に失敗しても元データを削除しない', () => {
    const inner = new MemoryStorageBackend();
    const corrupted = '{ "schemaVersion": "1.0", "FacilityCycle": broken';
    inner.setItem(SAVE_STORAGE_KEY, corrupted);
    const failing = new WriteFailingBackend(inner, CORRUPTED_BACKUP_KEY);

    expect(archiveCorruptedAndClearSave(failing)).toBe(false);
    expect(inner.getItem(SAVE_STORAGE_KEY)).toBe(corrupted);

    const loaded = loadGameState(failing);
    expect(loaded.status).toBe('corrupted');
    if (loaded.status === 'corrupted') {
      expect(loaded.rawOriginal).toBe(corrupted);
      expect(loaded.originalPreserved).toBe(true);
    }
  });

  it('破損データの退避に成功した場合だけ保存枠を初期化する', () => {
    const inner = new MemoryStorageBackend();
    const corrupted = '{ "schemaVersion": "1.0", "FacilityCycle": broken';
    inner.setItem(SAVE_STORAGE_KEY, corrupted);

    expect(archiveCorruptedAndClearSave(inner)).toBe(true);
    expect(inner.getItem(SAVE_STORAGE_KEY)).toBeNull();
    expect(inner.getItem(CORRUPTED_BACKUP_KEY)).toBe(corrupted);
  });
});
