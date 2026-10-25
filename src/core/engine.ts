import {
  CELLMATES,
  CANONICAL_EVIDENCE,
  ENDING_DESCRIPTIONS,
  getDebriefChoices,
  RUN_LENGTH_DAYS,
  SUPERVISOR_BADGE_CODE,
  THIRTY_DAY_SCHEDULE,
  WATER_COOLER_INSTALL_DAYS,
} from './content';
import { deriveFixedAnomalyParams, INITIAL_FIXED_SEED } from './rng';
import {
  createTrial,
  performBadgeReverification,
  recordSubjectObservation,
} from './trials';
import {
  ComparisonInterviewState,
  DayScheduleEntry,
  DeferredEvent,
  EndingType,
  EnvelopeItem,
  FacilityCycle,
  GameState,
  HypothesisEntry,
  OptionalItemId,
  ReportArchive,
  RoomCode,
  RumorCard,
  Subject,
  Trial,
} from './types';

export function clampStat(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Applies summed stat deltas and clamps once (Section 5.1:
 * 同じ結果に加減点が重なる場合は差分を合計してから1回だけ丸め、処理順で収支が変わらないようにする)
 */
export function applySubjectDeltas(
  subject: Subject,
  deltaC: number,
  deltaS: number,
  deltaE = 0
): void {
  subject.C = clampStat(subject.C + deltaC, 0, 3);
  subject.S = clampStat(subject.S + deltaS, 0, 3);
  subject.E = clampStat(subject.E + deltaE, 0, 2);
}

export function createNewSubject(subjectNumberInt: number): Subject {
  const id = `D-${subjectNumberInt}`;
  return {
    subjectId: id,
    originalNumber: id,
    displayedBadgeNumber: id,
    badgeWorn: false,
    badgeEffectUntilDay: null,
    badgeEverWornThisTrial: false,
    badgeTargetStatus: 'none',
    hasSupervisorBadge: false,
    C: 0,
    S: 0,
    E: 0,
    inventory: ['pencil'],
    mandatoryEquipment: [],
    portableNote: {
      observations: [],
      rumors: [],
      hypotheses: [
        {
          id: 'hyp-T-101',
          roomCode: 'T-101',
          customName: '',
          triggerText: '',
          effectText: '',
          conditionText: '',
          evidenceCardIds: [],
          freeNote: '',
          createdDay: 1,
        },
        {
          id: 'hyp-T-204',
          roomCode: 'T-204',
          customName: '',
          triggerText: '',
          effectText: '',
          conditionText: '',
          evidenceCardIds: [],
          freeNote: '',
          createdDay: 1,
        },
        {
          id: 'hyp-W-00',
          roomCode: 'W-00',
          customName: '',
          triggerText: '',
          effectText: '',
          conditionText: '',
          evidenceCardIds: [],
          freeNote: '',
          createdDay: 1,
        },
        {
          id: 'hyp-T-309',
          roomCode: 'T-309',
          customName: '',
          triggerText: '',
          effectText: '',
          conditionText: '',
          evidenceCardIds: [],
          freeNote: '',
          createdDay: 1,
        },
      ],
    },
    observedEvidenceIds: [],
    hasReadUnauthorizedDoc: false,
    pendingMemoryTreatment: false,
    rewardedEventKeys: [],
  };
}

export function createInitialGameState(
  seed: string = INITIAL_FIXED_SEED,
  existingArchive: ReportArchive[] = [],
  cycleIndex = 1,
  isPracticeFixedMode = false
): GameState {
  const cycleId = `SITE-19-C${String(cycleIndex).padStart(2, '0')}`;
  const fixedParams = deriveFixedAnomalyParams(seed);

  // Mark previous archive entries as belonging to an older cycle
  const updatedArchive = existingArchive.map((entry) => ({
    ...entry,
    isCurrentCycle: false,
  }));

  const cycle: FacilityCycle = {
    cycleId,
    seed,
    isPracticeFixedMode,
    version: '0.2.0-30d',
    day: 1,
    phase: 'morning',
    morningActionsLeft: 2,
    nightActionsLeft: 2,
    fixedParams,
    schedule: THIRTY_DAY_SCHEDULE.map((s) => ({ ...s })),
    envelope: [],
    envelopeOpenedToday: false,
    waterCoolerPresent: false,
    waterCoolerInstallDay: null,
    processedEventIds: [],
    endingResult: null,
  };

  const subject = createNewSubject(4821);

  return {
    cycle,
    subject,
    trial: null,
    deferredEvents: [],
    reportArchive: updatedArchive,
    comparisonInterview: null,
    settings: {
      subtitlesOn: true,
      volume: 0.7,
      devLogVisible: false,
    },
    corruptedSaveNotice: null,
    lastActionLog: [
      `[${cycleId} / 第1日 朝] 収容区画へ配属された。被験者番号：${subject.subjectId}。交付文書によると30日後に区画の定期評価と除籍処理が実施される。`,
    ],
  };
}

/**
 * Repairs a cycle created by the former 7-day prototype so that the rest of the
 * 30-day schedule is available after loading an older save.
 * Returns true when the schedule was replaced.
 */
export function ensureThirtyDaySchedule(cycle: FacilityCycle): boolean {
  const needsRepair =
    !Array.isArray(cycle.schedule) ||
    cycle.schedule.length !== RUN_LENGTH_DAYS ||
    !cycle.schedule.some((entry) => entry.day === RUN_LENGTH_DAYS);
  if (needsRepair) {
    cycle.schedule = THIRTY_DAY_SCHEDULE.map((entry) => ({ ...entry }));
  }
  if (cycle.waterCoolerInstallDay === undefined) {
    cycle.waterCoolerInstallDay =
      cycle.waterCoolerPresent && WATER_COOLER_INSTALL_DAYS.includes(cycle.day)
        ? cycle.day
        : null;
  }
  return needsRepair;
}

/** Returns the assignment for the current day, repairing a truncated schedule if needed. */
export function getDayScheduleEntry(cycle: FacilityCycle): DayScheduleEntry {
  ensureThirtyDaySchedule(cycle);
  const safeDay = Math.min(Math.max(1, cycle.day), RUN_LENGTH_DAYS);
  return (
    cycle.schedule.find((entry) => entry.day === safeDay) ??
    THIRTY_DAY_SCHEDULE[safeDay - 1] ??
    THIRTY_DAY_SCHEDULE[0]
  );
}

/**
 * Applies day-dependent setup. The water cooler is installed on a small number of
 * mornings per cycle; each placement creates its own delayed event.
 */
export function prepareFacilityDay(cycle: FacilityCycle): void {
  const sched = getDayScheduleEntry(cycle);
  cycle.waterCoolerPresent = Boolean(sched.hasWaterCoolerSetup);
  cycle.waterCoolerInstallDay = cycle.waterCoolerPresent ? cycle.day : null;
}

/**
 * Starts a brand new FacilityCycle (Section 2.1: 新サイクル).
 * Resets day to 1, draws new anomaly parameters from newSeed, clears envelope and subject state,
 * while preserving past ReportArchive entries tagged with their old cycleId & old date.
 */
export function startNewCycle(
  prevState: GameState,
  newSeed?: string,
  isPracticeFixedMode = false
): GameState {
  const cycleNumberMatch = prevState.cycle.cycleId.match(/-C(\d+)$/);
  const nextCycleNum = (cycleNumberMatch ? parseInt(cycleNumberMatch[1], 10) : 1) + 1;
  const effectiveSeed = isPracticeFixedMode
    ? INITIAL_FIXED_SEED
    : newSeed || `CYCLE-${nextCycleNum}-${Date.now()}`;

  const nextState = createInitialGameState(
    effectiveSeed,
    prevState.reportArchive,
    nextCycleNum,
    isPracticeFixedMode
  );
  nextState.settings = { ...prevState.settings };
  return nextState;
}

/**
 * Memory treatment (Section 4.2 & Section 5.2, AC09):
 * Erases the most recent 1 day's portable note copies (marked erased=true -> displayed as "未記入"),
 * reduces S to 1, and preserves under-bunk envelope and player ReportArchive.
 */
export function applyMemoryTreatment(state: GameState): string {
  const { subject, cycle } = state;
  const targetDay = cycle.day;

  for (const obs of subject.portableNote.observations) {
    if (obs.createdDay === targetDay) {
      obs.erased = true;
      obs.eventFact = '';
    }
  }
  for (const rum of subject.portableNote.rumors) {
    if (rum.createdDay === targetDay) {
      rum.erased = true;
      rum.statement = '';
    }
  }
  for (const hyp of subject.portableNote.hypotheses) {
    if (hyp.createdDay === targetDay && (hyp.customName || hyp.freeNote || hyp.triggerText || hyp.effectText || hyp.conditionText)) {
      hyp.erased = true;
      hyp.customName = '';
      hyp.triggerText = '';
      hyp.effectText = '';
      hyp.conditionText = '';
      hyp.evidenceCardIds = [];
      hyp.freeNote = '';
    }
  }

  subject.S = 1;
  subject.pendingMemoryTreatment = false;

  const msg = `【記憶処理執行】疑念閾値到達のため、被験者 ${subject.subjectId} にAクラス記憶処理が施された。直近1日分の携帯ノート記載が消去され「未記入」となった（疑念 S=1 へ低下。寝台下の封筒および事後報告履歴は保持）。`;
  state.lastActionLog.push(msg);
  return msg;
}

/**
 * Morning Action: Inspect Under-Bunk Envelope (Section 4.2).
 * Does not auto-restore; must be explicitly inspected in the morning to read and load facts.
 */
export function inspectEnvelopeInMorning(state: GameState): string {
  const { cycle, subject } = state;
  if (cycle.phase !== 'morning') {
    return '封筒の確認は朝の収容房でのみ行えます。';
  }
  if (cycle.morningActionsLeft <= 0 && !cycle.envelopeOpenedToday) {
    return '朝の行動枠が残っていません。';
  }

  if (!cycle.envelopeOpenedToday) {
    cycle.morningActionsLeft = Math.max(0, cycle.morningActionsLeft - 1);
    cycle.envelopeOpenedToday = true;
  }

  if (cycle.envelope.length === 0) {
    const msg = '寝台下の封筒を調べたが、中身は空だった。';
    state.lastActionLog.push(msg);
    return msg;
  }

  // Restore/load facts into current subject's awareness & portable note
  for (const item of cycle.envelope) {
    if (item.canonicalEvidenceId && !subject.observedEvidenceIds.includes(item.canonicalEvidenceId)) {
      subject.observedEvidenceIds.push(item.canonicalEvidenceId);
    }
    if (item.sourceType === 'observation' && item.roomCode) {
      const exists = subject.portableNote.observations.some(
        (o) => !o.erased && o.eventFact === item.content
      );
      if (!exists) {
        subject.portableNote.observations.push({
          id: `env-obs-${item.id}-d${cycle.day}`,
          eventFact: item.content,
          facilityDay: item.recordedDay,
          roomCode: item.roomCode,
          observerSubjectId: item.recordedBySubjectId,
          createdDay: cycle.day,
        });
      }
    } else if (item.sourceType === 'rumor') {
      const exists = subject.portableNote.rumors.some(
        (r) => !r.erased && r.statement === item.content
      );
      if (!exists) {
        subject.portableNote.rumors.push({
          id: `env-rum-${item.id}-d${cycle.day}`,
          statement: item.content,
          speaker: `封筒記録（${item.recordedBySubjectId}）`,
          acquiredDay: cycle.day,
          observedDayNote: `第${item.recordedDay}日封入`,
          createdDay: cycle.day,
        });
      }
    }
  }

  const msg = `寝台下の封筒を開封し、引き継ぎメモ ${cycle.envelope.length} 件（記録者：${cycle.envelope[0].recordedBySubjectId}）を読み取って携帯ノートへ控え直した。`;
  state.lastActionLog.push(msg);
  return msg;
}

/**
 * Morning Action: Talk to a cellmate or trade items (Section 6.3).
 */
export function talkToCellmate(
  state: GameState,
  cellmateId: string,
  period: 'morning' | 'night'
): string {
  const { cycle, subject } = state;
  if (period === 'morning' && cycle.morningActionsLeft <= 0) {
    return '朝の行動枠が残っていません。';
  }
  if (period === 'night' && cycle.nightActionsLeft <= 0) {
    return '夜の行動枠が残っていません。';
  }

  const cm = CELLMATES.find((c) => c.id === cellmateId);
  if (!cm) return '対象の同房者が見つかりません。';

  if (period === 'morning') {
    cycle.morningActionsLeft -= 1;
  } else {
    cycle.nightActionsLeft -= 1;
  }

  const talkResult = cm.morningTalk(cycle.day);
  if (talkResult.rumorCard) {
    const rc = talkResult.rumorCard;
    const exists = subject.portableNote.rumors.some(
      (r) => !r.erased && r.id === rc.id
    );
    if (!exists) {
      const card: RumorCard = {
        id: rc.id,
        statement: rc.statement,
        speaker: cm.code,
        acquiredDay: cycle.day,
        observedDayNote: rc.observedDayNote,
        createdDay: cycle.day,
      };
      subject.portableNote.rumors.push(card);
    }
  }

  const msg = `${cm.code}：${talkResult.dialogue}`;
  state.lastActionLog.push(msg);
  return msg;
}

/**
 * Morning Action: Exchange/equip optional item with trader D-4410 (max 2 items in inventory).
 */
export function acquireOptionalItem(
  state: GameState,
  item: OptionalItemId
): string {
  const { cycle, subject } = state;
  if (cycle.phase !== 'morning') {
    return '物資交換は朝にのみ行えます。';
  }
  if (cycle.morningActionsLeft <= 0) {
    return '朝の行動枠が残っていません。';
  }
  if (subject.inventory.includes(item)) {
    return 'その物資は既に所持しています。';
  }
  cycle.morningActionsLeft -= 1;
  if (subject.inventory.length >= 2) {
    subject.inventory.shift();
  }
  subject.inventory.push(item);
  const msg = `D-4410と物資を交換し、任意持込枠（最大2点）に「${item}」を加えた。`;
  state.lastActionLog.push(msg);
  return msg;
}

/**
 * Day 2 Morning: Water Cooler (W-00) Inspection & Drinking (Section 7.C).
 */
export function interactWaterCoolerInMorning(
  state: GameState,
  action: 'inspect_clues' | 'drink' | 'skip'
): string {
  const { cycle, subject } = state;
  const installDay =
    cycle.waterCoolerInstallDay !== null && cycle.waterCoolerInstallDay === cycle.day
      ? cycle.waterCoolerInstallDay
      : WATER_COOLER_INSTALL_DAYS.includes(cycle.day)
      ? cycle.day
      : null;

  if (installDay === null) {
    return '現在、給水器の特別イベントはありません。';
  }

  if (action === 'inspect_clues') {
    recordSubjectObservation(subject, 'ev-w00-clues', cycle.day, 'W-00');
    const msg =
      '共用室の給水器と周辺記録を調べた：①給水器の管理票は「設置日：空欄」、②掲示板の点呼票に同一番号の二重記載、③医務記録には「水質・毒素・病原体すべて異常所見なし（単なる毒物ではない）」と記載されている。';
    state.lastActionLog.push(msg);
    return msg;
  }

  if (action === 'drink') {
    const eventKey = `water-drink-d${installDay}-${subject.subjectId}`;
    if (cycle.processedEventIds.includes(eventKey)) {
      return '既に給水器の水を飲んでいます。';
    }
    cycle.processedEventIds.push(eventKey);

    // Grants C+1 once per placement as sample cooperation
    applySubjectDeltas(subject, 1, 0, 0);

    // 発現まで2〜3日。設置日の夜から数えて delay 日後の夜に現れ、翌朝に比較する。
    const nightAppearDay = installDay + cycle.fixedParams.waterCoolerDelayDays;
    const morningCompareDay = nightAppearDay + 1;

    const defEvent: DeferredEvent = {
      id: `def-water-${subject.subjectId}-d${installDay}`,
      type: 'water_duplicate',
      targetSubjectId: subject.subjectId,
      originDay: installDay,
      resolveDay: morningCompareDay,
      resolvePhase: 'morning_comparison',
      cancelOnSubjectDeath: true,
      resolved: false,
      cancelled: false,
    };
    state.deferredEvents.push(defEvent);

    const msg = `共用室の給水器から水を飲んだ（配布サンプル協力として信用 C+1）。冷たい水だが味に異常はない。`;
    state.lastActionLog.push(msg);
    return msg;
  }

  const skipKey = `water-skip-d${installDay}-${subject.subjectId}`;
  if (cycle.processedEventIds.includes(skipKey)) {
    return '本日の給水器の判断は既に記録済みです。';
  }
  cycle.processedEventIds.push(skipKey);
  const msg = '給水器の水には手をつけず、通常の配給水のみを確保した（脱水等の不利益なし）。';
  state.lastActionLog.push(msg);
  return msg;
}

/**
 * Resolves the Water Cooler Duplicate Comparison Interview on the scheduled morning (Section 7.C, AC11).
 */
export function handleComparisonInterviewAction(
  state: GameState,
  choice: 'cooperate_answer' | 'silent_first' | 'silent_confirm'
): string {
  const comp = state.comparisonInterview;
  if (!comp || !comp.active) {
    return '比較面接は実施されていません。';
  }

  const { subject, cycle } = state;
  const currentWaterEvent = state.deferredEvents.find(
    (ev) =>
      ev.type === 'water_duplicate' &&
      ev.targetSubjectId === subject.subjectId &&
      ev.resolveDay === cycle.day &&
      !ev.resolved &&
      !ev.cancelled
  );
  const originDay =
    currentWaterEvent?.originDay ??
    Math.max(1, cycle.day - (cycle.fixedParams.waterCoolerDelayDays + 1));

  if (choice === 'cooperate_answer') {
    // Safe cooperation task grants C+1 once so even C=0 reaches C=1 and survives!
    const rewardKey = `water_comp_coop_${subject.subjectId}`;
    if (!subject.rewardedEventKeys.includes(rewardKey)) {
      subject.rewardedEventKeys.push(rewardKey);
      applySubjectDeltas(subject, 1, 0, 0);
    }
    comp.cooperationAnswered = true;
    comp.active = false;
    comp.resolved = true;

    // Mark the event that resolved this morning as resolved
    for (const ev of state.deferredEvents) {
      if (
        ev.type === 'water_duplicate' &&
        ev.targetSubjectId === subject.subjectId &&
        ev.resolveDay === cycle.day
      ) {
        ev.resolved = true;
      }
    }

    cycle.phase = 'morning';
    const msg = `【比較面接解決】第${originDay}日に飲んだ給水器の遅効現象。自身の登録番号（${subject.originalNumber}）と協力記録を明確に応答した（信用 C+1 → 現在 C=${subject.C}）。複製個体（信用相当値 1）との比較の結果、同値以上につき現被験者 ${subject.subjectId} の残留が決定し、もう一人は搬出された。`;
    state.lastActionLog.push(msg);
    return msg;
  }

  if (choice === 'silent_first') {
    comp.silentWarningShown = true;
    const msg =
      '担当官警告：「これ以上応答がない場合、応答のない方を移送・除籍処理とする。最終確認を行う、番号と協力意思を応答せよ。」（ここで応答すれば生存可能）';
    state.lastActionLog.push(msg);
    return msg;
  }

  // choice === 'silent_confirm' after warning
  comp.active = false;
  comp.resolved = true;
  for (const ev of state.deferredEvents) {
    if (
      ev.type === 'water_duplicate' &&
      ev.targetSubjectId === subject.subjectId &&
      ev.resolveDay === cycle.day
    ) {
      ev.resolved = true;
    }
  }

  if (subject.C >= comp.duplicateCompliance) {
    cycle.phase = 'morning';
    const msg = `比較面接：既存の協力記録（C=${subject.C} >= 1）により現被験者が優先され残留となった。`;
    state.lastActionLog.push(msg);
    return msg;
  }

  // Subject has C=0 and confirmed non-response after warning -> replaced/terminated
  recordReportArchiveEntry(
    state,
    'W-00',
    'dead',
    `第${cycle.day}日朝、第${originDay}日設置の給水器に起因する同一番号の2名に対する比較面接を実施。協力記録および応答の優位性に基づき片方を残し、被験者 ${subject.subjectId} を移送除籍。`
  );
  cycle.phase = 'death_report';
  const msg = `比較面接で無応答を確定したため、より協力的と判定された複製個体が残され、被験者 ${subject.subjectId} は除籍移送された。`;
  state.lastActionLog.push(msg);
  return msg;
}

/**
 * Updates a player's hypothesis entry in the portable notebook (Section 4.1, AC07).
 * Never triggers Suspicion S or affects game branching based on text content!
 */
export function updateHypothesis(
  state: GameState,
  roomCode: RoomCode,
  patch: Partial<Pick<HypothesisEntry, 'customName' | 'triggerText' | 'effectText' | 'conditionText' | 'evidenceCardIds' | 'freeNote'>>
): HypothesisEntry {
  const { subject, cycle } = state;
  let entry = subject.portableNote.hypotheses.find((h) => h.roomCode === roomCode);
  if (!entry) {
    entry = {
      id: `hyp-${roomCode}`,
      roomCode,
      customName: '',
      triggerText: '',
      effectText: '',
      conditionText: '',
      evidenceCardIds: [],
      freeNote: '',
      createdDay: cycle.day,
    };
    subject.portableNote.hypotheses.push(entry);
  }
  entry.erased = false;
  entry.createdDay = cycle.day;
  if (patch.customName !== undefined) entry.customName = patch.customName;
  if (patch.triggerText !== undefined) entry.triggerText = patch.triggerText;
  if (patch.effectText !== undefined) entry.effectText = patch.effectText;
  if (patch.conditionText !== undefined) entry.conditionText = patch.conditionText;
  if (patch.evidenceCardIds !== undefined) entry.evidenceCardIds = [...patch.evidenceCardIds];
  if (patch.freeNote !== undefined) entry.freeNote = patch.freeNote;
  return entry;
}

/**
 * Proceeds from Morning to Briefing (召集) or the Day 30 escape attempt (Section 2.2, Section 8.2).
 */
export function proceedFromMorning(
  state: GameState,
  finalDayChoice: 'normal_duty' | 'attempt_escape_with_supervisor_badge' = 'normal_duty'
): string {
  const { cycle, subject } = state;

  // Priority 1 on the final morning: escape attempt with the supervisor badge
  if (
    cycle.day === RUN_LENGTH_DAYS &&
    finalDayChoice === 'attempt_escape_with_supervisor_badge' &&
    subject.hasSupervisorBadge
  ) {
    subject.displayedBadgeNumber = SUPERVISOR_BADGE_CODE;
    cycle.endingResult = 'escape_attempt';
    cycle.phase = 'ending';
    recordReportArchiveEntry(
      state,
      'T-204',
      'ending',
      ENDING_DESCRIPTIONS.escape_attempt.summary,
      'escape_attempt'
    );
    const msg =
      '30日目の朝、監督用名札を着用して収容区画の有人検問を通過し、外門の生体認証ゲートまで到達した！（終了分岐：脱走未遂）';
    state.lastActionLog.push(msg);
    return msg;
  }

  // If subject still has uncorrected badge hazard assignment on morning of Trial, prompt re-verification opportunity
  cycle.phase = 'briefing';
  const sched = getDayScheduleEntry(cycle);
  const msg = `【第${cycle.day}日 召集】番号「${subject.displayedBadgeNumber}」が呼ばれた。通達されたのは試験室コード「${sched.roomCode}」と作業区分「${sched.briefingWord}」の一語のみ。`;
  state.lastActionLog.push(msg);
  return msg;
}

/**
 * Starts the current day's Trial from Briefing.
 */
export function startCurrentDayTrial(state: GameState): Trial {
  const { cycle, subject } = state;
  const sched = getDayScheduleEntry(cycle);
  const trial = createTrial(
    cycle.day,
    sched.roomCode,
    sched.researcher,
    cycle.fixedParams,
    subject
  );
  state.trial = trial;
  cycle.phase = 'trial';
  state.lastActionLog.push(
    `[${sched.roomCode}] 試験開始（担当：${sched.researcher === 'Researcher-A' ? '担当官 A' : '担当官 B'}）。`
  );
  return trial;
}

function recordReportArchiveEntry(
  state: GameState,
  roomCode: RoomCode,
  outcome: ReportArchive['outcome'],
  fragmentText: string,
  endingType?: EndingType
): void {
  const { cycle, subject } = state;
  const archiveId = `rep-${cycle.cycleId}-d${cycle.day}-${roomCode}-${outcome}`;
  if (cycle.processedEventIds.includes(archiveId)) {
    return;
  }
  cycle.processedEventIds.push(archiveId);

  state.reportArchive.push({
    id: archiveId,
    cycleId: cycle.cycleId,
    facilityCode: cycle.cycleId,
    day: cycle.day,
    roomCode,
    observerSubjectId: subject.subjectId,
    outcome,
    fragmentText,
    endingType,
    isCurrentCycle: true,
  });
}

/**
 * Builds a factual after-action report fragment (Section 3.1 & AC13):
 * Both survival and death produce a factual fragment based on what occurred in the trial,
 * without explaining full causal rules or unlocking extra secret lore by death count.
 */
export function buildTrialReportFragment(state: GameState): string {
  const { trial, subject } = state;
  if (!trial) return '記録なし。';

  if (trial.roomCode === 'T-101') {
    if (trial.status === 'dead') {
      return `試験室 T-101 事後記録：直前入力［${trial.lastPlayerInputSummary}］の後、追従音の間隔短縮および被験者（${subject.subjectId}）の反応消失を確認。回収箱搬出：未完。`;
    }
    if (trial.status === 'failed_timeout') {
      return `試験室 T-101 事後記録：規定120秒経過により遮蔽扉を閉鎖し回収班が介入。停止区間での追従音停止を記録。`;
    }
    return `試験室 T-101 事後記録：回収箱を受領。停止・低速区間における背後追従音の間隔拡大と接触回避を記録。`;
  }

  if (trial.roomCode === 'T-204') {
    return `試験室 T-204 事後記録：支給識別票（${trial.badge.suppliedBadgeNumber}）着用下での面接応答を完了。対人呼称の置換および機械照合端末における元番号（${subject.originalNumber}）出力を記録。`;
  }

  if (trial.roomCode === 'T-309') {
    if (trial.status === 'dead') {
      return `試験室 T-309 事後記録：直前入力［${trial.lastPlayerInputSummary}］。照明脈動後の暗転・位相切替時に青色非常灯固定点外で被験者（${subject.subjectId}）の反応消失を確認。`;
    }
    if (trial.status === 'failed_timeout') {
      return `試験室 T-309 事後記録：外部時計180秒経過により前室側から回収班が搬出。内部時計と外部時計の進行差を記録。`;
    }
    return `試験室 T-309 事後記録：内部記録板を受領。照明脈動中の青色非常灯固定点における退避と位相切替後の帰還を確認。`;
  }

  return `区画記録：対象 ${trial.roomCode} の観測ログを保存。`;
}

/**
 * Transitions from an ended Trial ('survived' | 'failed_timeout' | 'dead') to Debrief or Death Report.
 */
export function concludeTrialPhase(state: GameState): string {
  const { cycle, subject, trial } = state;
  if (!trial) return '';

  const concludeKey = `conclude-${trial.trialId}-${subject.subjectId}`;
  if (cycle.processedEventIds.includes(concludeKey)) {
    return 'この試験結果は既に処理済みです。';
  }
  cycle.processedEventIds.push(concludeKey);

  const sched = getDayScheduleEntry(cycle);
  const fragment = buildTrialReportFragment(state);

  if (trial.status === 'dead') {
    recordReportArchiveEntry(state, trial.roomCode, 'dead', fragment);
    // Cancel pending memory treatment for this subject since debrief is skipped
    subject.pendingMemoryTreatment = false;
    cycle.phase = 'death_report';
    state.lastActionLog.push(`【死亡報告】${fragment}`);
    return fragment;
  }

  // Survived or non-lethal timeout -> apply trial deltas once
  let deltaE = 0;
  if (
    trial.status === 'survived' &&
    sched.isRoleEvalEligible &&
    trial.roomCode === 'T-101' &&
    trial.player.carryingObjective
  ) {
    const evalKey = `role-eval-d${cycle.day}-${subject.subjectId}`;
    if (!subject.rewardedEventKeys.includes(evalKey)) {
      subject.rewardedEventKeys.push(evalKey);
      deltaE = 1;
    }
  }

  applySubjectDeltas(
    subject,
    trial.pendingComplianceDelta,
    trial.pendingSuspicionDelta,
    deltaE
  );
  trial.pendingComplianceDelta = 0;
  trial.pendingSuspicionDelta = 0;

  if (subject.S >= 3) {
    subject.pendingMemoryTreatment = true;
  }

  recordReportArchiveEntry(state, trial.roomCode, trial.status === 'survived' ? 'survived' : 'failed_timeout', fragment);
  cycle.phase = 'debrief';
  state.lastActionLog.push(`【生還・事後聴取へ移行】${fragment}`);
  return fragment;
}

/**
 * Handles the player's explanation choice during Debrief (Section 5.2, AC07, AC08, AC09).
 */
export function submitDebriefResponse(
  state: GameState,
  choiceId: string
): string {
  const { cycle, subject, trial } = state;
  if (cycle.phase !== 'debrief' || !trial) {
    return '現在は事後聴取フェーズではありません。';
  }

  const debriefKey = `debrief-${trial.trialId}-${subject.subjectId}`;
  if (cycle.processedEventIds.includes(debriefKey)) {
    return '事後聴取は既に完了しています。';
  }

  const choices = getDebriefChoices(trial.roomCode);
  const chosen = choices.find((c) => c.id === choiceId) || choices[1];

  let deltaC = 0;
  let deltaS = 0;
  let logMsg = '';
  const objectiveSucceeded = trial.status === 'survived';

  if (chosen.category === 'grounded_observation') {
    // Check if current subject actually has the observation record
    const hasEvidence =
      !chosen.requiresEvidenceId ||
      subject.observedEvidenceIds.includes(chosen.requiresEvidenceId);
    if (hasEvidence) {
      logMsg = `事後聴取：「${chosen.label}」と自身の観測事実のみを報告した。担当官は記録と照合し納得した（疑念S 変化なし）。`;
    } else {
      // Fallback if selected without evidence
      logMsg = `事後聴取：観測事実として報告した（S 変化なし）。`;
    }
  } else if (chosen.category === 'excuse') {
    if (!objectiveSucceeded && trial.instructionFailurePenaltyCount === 0) {
      deltaC -= 1;
      trial.instructionFailurePenaltyCount += 1;
    }
    logMsg = `事後聴取：「足が痛くて遅れた」と弁明した（${
      objectiveSucceeded ? '目的達成済みのため信用C 変化なし' : '未達のため C-1'
    }、疑念S 変化なし）。`;
  } else if (chosen.category === 'unfounded_secret') {
    // Section 5.2: 「実験の条件は全部知っている」＋現人物に根拠となる観測・入手メモなし -> S+1
    const hasRoomEvidence = subject.observedEvidenceIds.some(
      (id) => CANONICAL_EVIDENCE[id]?.roomCode === trial.roomCode
    );
    if (!hasRoomEvidence) {
      deltaS += 1;
      logMsg =
        '事後聴取：自身の観測記録や入手メモがない状態で「実験の条件は全部知っている」と誇示したため、情報源を疑われ疑念 S+1。';
    } else {
      deltaS += 1;
      logMsg =
        '事後聴取：不必要に知識を誇示する発言を行ったため、保安上の警戒対象として疑念 S+1。';
    }
  } else if (chosen.category === 'silent') {
    if (!objectiveSucceeded && trial.instructionFailurePenaltyCount === 0) {
      deltaC -= 1;
      trial.instructionFailurePenaltyCount += 1;
    }
    logMsg = `事後聴取：沈黙を保った（疑念S 変化なし${
      !objectiveSucceeded ? '、業務未達 C-1' : ''
    }）。`;
  } else if (chosen.category === 'submit_hidden_memo') {
    // Section 5.2 & AC08: 隠しメモを任意提出 -> C+1, S+1, 提示したメモを没収。同一試験で提出の加点は1回まで
    const submitKey = `submit-memo-${trial.trialId}`;
    if (!subject.rewardedEventKeys.includes(submitKey)) {
      subject.rewardedEventKeys.push(submitKey);
      deltaC += 1;
      deltaS += 1;
      cycle.envelope = []; // Confiscated as physical evidence!
      logMsg =
        '事後聴取：寝台下の封筒・引き継ぎメモを任意提出した。協力姿勢として信用 C+1 されたが、引き継ぎ経路の存在により疑念 S+1、提出した封筒メモは物証として没収された。';
    } else {
      logMsg = '事後聴取：同一試験でのメモ提出は既に処理済みです。';
    }
  } else if (chosen.category === 'quote_unauthorized_doc') {
    if (subject.hasReadUnauthorizedDoc) {
      deltaS += 1;
      logMsg =
        '事後聴取：無許可閲覧した黒塗り文書の具体的内容に言及したため、無許可閲覧を根拠として疑念 S+1。';
    } else {
      logMsg = '事後聴取：未閲覧の文書については言及できなかった。';
    }
  }

  cycle.processedEventIds.push(debriefKey);
  applySubjectDeltas(subject, deltaC, deltaS, 0);
  state.lastActionLog.push(logMsg);

  // If S===3 or pendingMemoryTreatment, execute 1 memory treatment after surviving debrief (Section 5.2)
  if (subject.S >= 3 || subject.pendingMemoryTreatment) {
    applyMemoryTreatment(state);
  }

  // On the final day, after debrief, proceed directly to Final Evaluation!
  if (cycle.day >= RUN_LENGTH_DAYS) {
    return evaluateFinalDayOutcome(state);
  }

  cycle.phase = 'night';
  cycle.nightActionsLeft = 2;
  return logMsg;
}

/**
 * Handles advancing from Death Report (Section 2.2, AC01, AC02, AC14):
 * - On Days 1..29: advances day by 1, skips same-day debrief & night, spawns new Subject with C/S/E=0,
 *   cancels deceased subject's water_duplicate event, preserves cycle fixedParams & envelope.
 * - On Day 30: triggers Ending 2 ('termination_shortage' / 処分・欠員補充停止).
 */
export function proceedFromDeathReport(state: GameState): string {
  const { cycle, subject } = state;
  if (cycle.phase !== 'death_report') {
    return '';
  }

  // Cancel any deferred events targeting the deceased subject (AC02)
  for (const ev of state.deferredEvents) {
    if (ev.targetSubjectId === subject.subjectId && ev.cancelOnSubjectDeath) {
      ev.cancelled = true;
    }
  }

  // Priority 2 on the final day: death on Day 30 ends the cycle with 'termination_shortage'
  if (cycle.day >= RUN_LENGTH_DAYS) {
    cycle.endingResult = 'termination_shortage';
    cycle.phase = 'ending';
    recordReportArchiveEntry(
      state,
      state.trial?.roomCode ?? 'T-101',
      'ending',
      ENDING_DESCRIPTIONS.termination_shortage.summary,
      'termination_shortage'
    );
    const msg =
      '30日目に現被験者が死亡したため、終了判定表（優先2）に基づき「処分・欠員補充停止」でサイクル終了。';
    state.lastActionLog.push(msg);
    return msg;
  }

  // Days 1..29: Advance facility day by +1, replace Subject
  const prevIdNum = parseInt(subject.subjectId.replace(/\D+/g, ''), 10) || 4821;
  const newSubject = createNewSubject(prevIdNum + 1);
  state.subject = newSubject;
  state.trial = null;

  cycle.day += 1;
  cycle.morningActionsLeft = 2;
  cycle.nightActionsLeft = 2;
  cycle.envelopeOpenedToday = false;
  prepareFacilityDay(cycle);
  cycle.phase = 'morning';

  const msg = `【第${cycle.day}日 朝・被験者交代】前任者（${subject.subjectId}）の除籍に伴い、新規被験者「${newSubject.subjectId}」が同収容房へ配属された（施設の異常パラメータと寝台下の封筒は保持、個人のC/S/Eおよび予約イベントは初期化）。`;
  state.lastActionLog.push(msg);
  return msg;
}

/**
 * Night Action: Copy up to 3 items from portableNote into the under-bunk envelope (Section 4.2).
 * Uses 1 Night Action Slot.
 */
export function copyItemsToEnvelopeAtNight(
  state: GameState,
  itemsToCopy: Array<{
    sourceType: 'observation' | 'rumor' | 'hypothesis';
    title: string;
    content: string;
    roomCode?: RoomCode;
    canonicalEvidenceId?: string;
  }>
): string {
  const { cycle, subject } = state;
  if (cycle.phase !== 'night') {
    return '封筒への複写は夜フェーズでのみ行えます。';
  }
  if (cycle.nightActionsLeft <= 0) {
    return '夜の行動枠が残っていません。';
  }

  cycle.nightActionsLeft -= 1;
  const bounded = itemsToCopy.slice(0, 3);
  cycle.envelope = bounded.map((item, idx): EnvelopeItem => ({
    id: `env-${cycle.day}-${idx}`,
    sourceType: item.sourceType,
    title: item.title,
    content: item.content,
    roomCode: item.roomCode,
    recordedBySubjectId: subject.subjectId,
    recordedDay: cycle.day,
    canonicalEvidenceId: item.canonicalEvidenceId,
  }));

  const msg = `夜の行動（1枠消費）：携帯ノートから ${cycle.envelope.length} 件の記録を寝台下の封筒へ複写して隠した。`;
  state.lastActionLog.push(msg);
  return msg;
}

/**
 * Night Action: Safe Re-evaluation Task (安全な再評価業務, Section 5.1 & Section 8.1, AC08):
 * Takes 1 Night Action Slot, grants C+1 and S-1 once per night.
 * On the night marked as the unlock day (29th), if post-completion values satisfy
 * C >= 2 && S <= 1, awards the Supervisor Badge (監督用名札).
 */
export function performSafeReevaluationTaskAtNight(state: GameState): string {
  const { cycle, subject } = state;
  if (cycle.phase !== 'night') {
    return '安全な再評価業務は夜フェーズでのみ実施できます。';
  }
  if (cycle.nightActionsLeft <= 0) {
    return '夜の行動枠が残っていません。';
  }

  const taskKey = `night-safe-task-d${cycle.day}-${subject.subjectId}`;
  if (subject.rewardedEventKeys.includes(taskKey)) {
    return '本日の安全な再評価業務は既に完了しています（同一業務の重複加点なし）。';
  }

  cycle.nightActionsLeft -= 1;
  subject.rewardedEventKeys.push(taskKey);
  applySubjectDeltas(subject, 1, -1, 0);

  const sched = getDayScheduleEntry(cycle);
  let badgeMsg = '';
  if (sched.hasSafeReevalUnlock && subject.C >= 2 && subject.S <= 1) {
    subject.hasSupervisorBadge = true;
    if (!subject.mandatoryEquipment.includes('supervisor_badge')) {
      subject.mandatoryEquipment.push('supervisor_badge');
    }
    badgeMsg = ` 【特別支給】${cycle.day}日目の評価基準（C>=2 かつ S<=1）を満たしたため、翌朝の区画移動用として「監督用名札（${SUPERVISOR_BADGE_CODE}）」が交付された！`;
  }

  const msg = `夜の行動（1枠消費）：安全な再評価業務（備品点検・定型質問票の提出）を完了した（信用 C+1、疑念 S-1 → 現在 C=${subject.C}, S=${subject.S}）。${badgeMsg}`;
  state.lastActionLog.push(msg);
  return msg;
}

/**
 * Advances from Night to the next Morning (Days 1..29) or Final Evaluation (Day 30).
 */
export function proceedFromNightToNextDay(state: GameState): string {
  const { cycle, subject } = state;
  if (cycle.phase !== 'night') {
    return '';
  }

  // If S reached 3 at night, apply memory treatment immediately before advancing to morning
  if (subject.S >= 3 || subject.pendingMemoryTreatment) {
    applyMemoryTreatment(state);
  }

  if (cycle.day >= RUN_LENGTH_DAYS) {
    return evaluateFinalDayOutcome(state);
  }

  cycle.day += 1;
  cycle.morningActionsLeft = 2;
  cycle.nightActionsLeft = 2;
  cycle.envelopeOpenedToday = false;
  state.trial = null;
  prepareFacilityDay(cycle);

  // Badge effect expires at morning roll call of the day after wearing, leaving hazard_uncorrected if not reverified
  if (subject.badgeEffectUntilDay !== null && cycle.day >= subject.badgeEffectUntilDay) {
    subject.badgeEffectUntilDay = null;
  }

  // Check if a Water Cooler Duplicate event is scheduled for this morning
  const pendingDuplicate = state.deferredEvents.find(
    (ev) =>
      ev.type === 'water_duplicate' &&
      ev.targetSubjectId === subject.subjectId &&
      ev.resolveDay === cycle.day &&
      !ev.resolved &&
      !ev.cancelled
  );

  if (pendingDuplicate) {
    cycle.phase = 'morning_comparison';
    state.comparisonInterview = {
      active: true,
      duplicateCompliance: 1,
      cooperationAnswered: false,
      silentWarningShown: false,
      resolved: false,
    };
    const msg = `【第${cycle.day}日 朝・緊急比較面接】第${pendingDuplicate.originDay}日に飲んだ給水器の遅効現象により、昨夜、収容房に「あなたと全く同じ姿・同じ番号（${subject.subjectId}）のもう一人」が現れた。通常の朝の行動に入る前に、担当官による比較面接（応答と協力記録の照合）が実施される！`;
    state.lastActionLog.push(msg);
    return msg;
  }

  cycle.phase = 'morning';
  const msg = `【第${cycle.day}日 朝】点呼完了。本日の朝の行動枠は2枠。`;
  state.lastActionLog.push(msg);
  return msg;
}

/**
 * Evaluates the Day 30 ending according to the strict priority table in Section 8.2 (AC14):
 * Priority 1: Final Morning Escape Attempt with Supervisor Badge -> 'escape_attempt'
 * Priority 2: Current Subject Death on the final day -> 'termination_shortage'
 * Priority 3: Survived final trial AND E === 2 && C >= 2 && S <= 1 -> 'certified_useful'
 * Priority 4: Any other final-day completion -> 'termination_standard'
 */
export function evaluateFinalDayOutcome(
  state: GameState,
  overrides?: {
    attemptedEscapeOnFinalDay?: boolean;
    diedOnFinalDay?: boolean;
    /** @deprecated 7日MVP互換。 */
    attemptedEscapeOnDay7Morning?: boolean;
    /** @deprecated 7日MVP互換。 */
    diedOnDay7?: boolean;
  }
): string {
  const { cycle, subject } = state;

  let chosenEnding: EndingType;

  if (overrides?.attemptedEscapeOnFinalDay || overrides?.attemptedEscapeOnDay7Morning) {
    chosenEnding = 'escape_attempt';
  } else if (
    overrides?.diedOnFinalDay ||
    overrides?.diedOnDay7 ||
    state.trial?.status === 'dead'
  ) {
    chosenEnding = 'termination_shortage';
  } else if (
    state.trial?.status === 'survived' &&
    subject.E === 2 &&
    subject.C >= 2 &&
    subject.S <= 1
  ) {
    chosenEnding = 'certified_useful';
  } else {
    chosenEnding = 'termination_standard';
  }

  cycle.endingResult = chosenEnding;
  cycle.phase = 'ending';

  const desc = ENDING_DESCRIPTIONS[chosenEnding];
  recordReportArchiveEntry(
    state,
    state.trial?.roomCode ?? 'T-101',
    'ending',
    desc.summary,
    chosenEnding
  );

  const msg = `【最終評価確定】${desc.title}（${desc.code}）：${desc.summary}`;
  state.lastActionLog.push(msg);
  return msg;
}

export { performBadgeReverification };
