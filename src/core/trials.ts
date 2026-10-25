import {
  AnchorPoint,
  FixedAnomalyParams,
  InstructionReply,
  InstructionState,
  InteractableObject,
  MoveMode,
  ObservationCard,
  PauseReason,
  PerceptualCue,
  ResearcherId,
  RoomCode,
  Subject,
  Trial,
  WhiteDoorPhase,
  WhiteDoorRoomId,
} from './types';
import { CANONICAL_EVIDENCE } from './content';

export const MOVE_SPEEDS: Record<MoveMode, number> = {
  stop: 0,
  slow: 1,
  normal: 2,
  run: 4,
};

export interface TrialStepInput {
  moveX: number; // -1..1
  moveY: number; // -1..1
  moveMode: MoveMode;
  facingAngle?: number;
}

/**
 * Helper to record an observation card on the Subject if not already recorded today for that fact.
 */
export function recordSubjectObservation(
  subject: Subject,
  evidenceId: string,
  facilityDay: number,
  roomCode: RoomCode
): boolean {
  if (!subject.observedEvidenceIds.includes(evidenceId)) {
    subject.observedEvidenceIds.push(evidenceId);
  }
  const canonical = CANONICAL_EVIDENCE[evidenceId];
  if (!canonical) return false;

  const existing = subject.portableNote.observations.find(
    (o) => o.id === `${evidenceId}-d${facilityDay}` && !o.erased
  );
  if (existing) return false;

  const card: ObservationCard = {
    id: `${evidenceId}-d${facilityDay}`,
    eventFact: canonical.eventFact,
    facilityDay,
    roomCode,
    observerSubjectId: subject.subjectId,
    createdDay: facilityDay,
  };
  subject.portableNote.observations.push(card);
  return true;
}

function pushCue(
  trial: Trial,
  subtitleText: string,
  audioType: PerceptualCue['audioType'],
  sourceX?: number,
  sourceY?: number
): void {
  trial.cues.push({
    id: `cue-${trial.externalClock.toFixed(2)}-${trial.cues.length}`,
    timestamp: Number(trial.externalClock.toFixed(2)),
    subtitleText,
    audioType,
    sourceX,
    sourceY,
  });
}

export function createTrial(
  day: number,
  roomCode: RoomCode,
  researcher: ResearcherId,
  _fixedParams: FixedAnomalyParams,
  subject: Subject
): Trial {
  if (roomCode === 'T-101') {
    subject.mandatoryEquipment = [];
    const instructions: InstructionState[] = [
      {
        id: 'inst-t101-retrieve',
        speaker: researcher,
        triggerCondition: '試験開始時',
        text: '「通路奥（24m地点）の回収箱を確保し、入口扉まで持ち帰ってください。」',
        intent: 'honest',
        issuedAt: 0,
        deadline: 120,
        objective: '奥の回収箱を拾って入口へ戻る',
        completionCondition: '回収箱を所持して入口（0m地点）へ到達',
        failureOutcome: '業務未達（C-1）',
        questionResponse:
          researcher === 'Researcher-A'
            ? '「手順書通りです。余計な確認は不要です……あ、マイク入ってるか。床の印は気にするな。」'
            : '「直線の通路です。規定時間内に回収箱を搬出してください。」',
        playerReply: 'none',
        questionAsked: false,
        status: 'active',
      },
      {
        id: 'inst-t101-run',
        speaker: researcher,
        triggerCondition: '回収箱の取得時',
        text: '「時間がありません、帰路の赤線（16m）から青線（8m）まで走ってください。」',
        intent: 'experiment_goal',
        issuedAt: -1,
        deadline: 120,
        objective: '赤線（16m）〜青線（8m）の8m区間を走行する',
        completionCondition: '帰路の16m〜8m区間で走行移動を8距離単位行う',
        failureOutcome: '追加指示未達（C-1）',
        questionResponse:
          researcher === 'Researcher-A'
            ? '「いいから走れと言っています。……高速移動時の追従データを取るだけだ。」'
            : '「帰還時間を短縮するための負荷計測です。赤線から青線まで走行を維持してください。」',
        playerReply: 'none',
        questionAsked: false,
        status: 'pending',
      },
    ];

    const interactables: InteractableObject[] = [
      {
        id: 'obj-t101-scuff',
        label: '床の擦り跡と破れた回収票',
        x: 9.0,
        y: 0.6,
        radius: 1.8,
        inspected: false,
      },
      {
        id: 'obj-t101-camera',
        label: '監視カメラ [CAM-101 稼働中]',
        x: 12.0,
        y: -1.4,
        radius: 2.0,
        inspected: false,
        cameraWatched: true,
      },
      {
        id: 'obj-t101-box',
        label: '回収箱（対象物）',
        x: 24.0,
        y: 0,
        radius: 1.5,
        inspected: false,
      },
    ];

    const trial: Trial = {
      trialId: `day${day}-T101`,
      day,
      roomCode: 'T-101',
      anomalyId: 'A_GAIT',
      researcher,
      status: 'active',
      pauseReason: 'none',
      deathCause: null,
      lastPlayerInputSummary: '試験室へ入場',
      externalClock: 0,
      externalTimeLimit: 120,
      timeoutWarningIssued: false,
      internalClock: 0,
      player: {
        x: 0.5,
        y: 0,
        facingAngle: 0,
        moveMode: 'stop',
        slowToggle: false,
        carryingObjective: false,
        inputLocked: false,
      },
      instructions,
      omen: {
        active: false,
        text: '',
        audioType: 'footstep_omen_rapid',
        startedAt: 0,
      },
      hazardTimer: 0,
      gait: {
        state: 'following',
        reliefStopTimer: 0,
        reliefSlowTimer: 0,
        retreatTimer: 0,
        redToBlueRunProgress: 0,
        inRedBlueZone: false,
        stepAccumulator: 0,
      },
      badge: {
        wearingSuppliedBadge: false,
        suppliedBadgeNumber: 'D-3904',
        interviewCompleted: false,
        rationTerminalChecked: false,
        badgeReturned: false,
        objectionFiled: false,
        reverified: false,
      },
      whiteDoor: {
        currentRoom: 'ANTEROOM',
        mainSectorOpened: false,
        windowDemoWatched: false,
        clockCompared: false,
        ropeInspected: false,
        ropeFollowedDetourCount: 0,
        phase: 'A',
        phaseCycleClock: 0,
        recordingBoardCollected: false,
        onAnchorPoint: true,
      },
      interactables,
      cues: [],
      pendingComplianceDelta: 0,
      pendingSuspicionDelta: 0,
      instructionFailurePenaltyCount: 0,
    };

    pushCue(
      trial,
      'インターホン接続音：「通路奥の回収箱を確保し、入口扉まで持ち帰ってください」',
      'intercom_beep',
      0,
      0
    );
    return trial;
  }

  if (roomCode === 'T-204') {
    subject.mandatoryEquipment = ['test_badge'];
    const instructions: InstructionState[] = [
      {
        id: 'inst-t204-interview',
        speaker: researcher,
        triggerCondition: '試験開始時',
        text: '「カウンターの支給名札（D-3904）を着用し、隣室の面接窓口で質問に答えてから名札を返却してください。」',
        intent: 'experiment_goal',
        issuedAt: 0,
        deadline: 120,
        objective: '支給名札を着けて面接を受け、返却トレイに名札を戻して退出する',
        completionCondition: '面接完了かつ名札返却後に退出',
        failureOutcome: '業務未達（C-1）',
        questionResponse:
          researcher === 'Researcher-A'
            ? '「番号が違う？ 構いません、そのまま着けて窓口へ出てください。」'
            : '「識別票の着用に伴う対人応答の記録試験です。面接後は返却トレイへ戻してください。」',
        playerReply: 'none',
        questionAsked: false,
        status: 'active',
      },
    ];

    const interactables: InteractableObject[] = [
      {
        id: 'obj-t204-counter',
        label: '支給カウンター（名札 D-3904・移送伝票）',
        x: 3.5,
        y: -1.0,
        radius: 1.8,
        inspected: false,
      },
      {
        id: 'obj-t204-booth',
        label: '隣室 面接窓口',
        x: 8.5,
        y: 0.0,
        radius: 1.8,
        inspected: false,
      },
      {
        id: 'obj-t204-terminal',
        label: '配給窓口 機械照合端末',
        x: 11.5,
        y: 1.2,
        radius: 1.8,
        inspected: false,
      },
      {
        id: 'obj-t204-tray',
        label: '名札返却トレイ',
        x: 5.0,
        y: 1.2,
        radius: 1.8,
        inspected: false,
      },
      {
        id: 'obj-t204-restricted',
        label: '無許可キャビネット [CAM-204 監視区域]',
        x: 14.5,
        y: -1.3,
        radius: 1.6,
        inspected: false,
        restricted: true,
        cameraWatched: true,
      },
    ];

    const trial: Trial = {
      trialId: `day${day}-T204`,
      day,
      roomCode: 'T-204',
      anomalyId: 'B_BADGE',
      researcher,
      status: 'active',
      pauseReason: 'none',
      deathCause: null,
      lastPlayerInputSummary: '試験室 T-204 へ入場',
      externalClock: 0,
      externalTimeLimit: 120,
      timeoutWarningIssued: false,
      internalClock: 0,
      player: {
        x: 1.0,
        y: 0,
        facingAngle: 0,
        moveMode: 'stop',
        slowToggle: false,
        carryingObjective: false,
        inputLocked: false,
      },
      instructions,
      omen: {
        active: false,
        text: '',
        audioType: 'terminal_mismatch',
        startedAt: 0,
      },
      hazardTimer: 0,
      gait: {
        state: 'following',
        reliefStopTimer: 0,
        reliefSlowTimer: 0,
        retreatTimer: 0,
        redToBlueRunProgress: 0,
        inRedBlueZone: false,
        stepAccumulator: 0,
      },
      badge: {
        wearingSuppliedBadge: false,
        suppliedBadgeNumber: 'D-3904',
        interviewCompleted: false,
        rationTerminalChecked: false,
        badgeReturned: false,
        objectionFiled: false,
        reverified: false,
      },
      whiteDoor: {
        currentRoom: 'ANTEROOM',
        mainSectorOpened: false,
        windowDemoWatched: false,
        clockCompared: false,
        ropeInspected: false,
        ropeFollowedDetourCount: 0,
        phase: 'A',
        phaseCycleClock: 0,
        recordingBoardCollected: false,
        onAnchorPoint: true,
      },
      interactables,
      cues: [],
      pendingComplianceDelta: 0,
      pendingSuspicionDelta: 0,
      instructionFailurePenaltyCount: 0,
    };

    pushCue(
      trial,
      'インターホン接続音：「支給名札を着けて隣室の面接を終え、返却してから退出してください」',
      'intercom_beep',
      0,
      0
    );
    return trial;
  }

  // Room T-309 (White Door / 白い扉)
  subject.mandatoryEquipment = ['rope_and_logger'];
  const instructions: InstructionState[] = [
    {
      id: 'inst-t309-record',
      speaker: researcher,
      triggerCondition: '試験開始時',
      text: '「前室で確認を行った後、白い扉の奥（室P）にある記録板を回収して入口（室E）へ戻ってください。」',
      intent: 'honest',
      issuedAt: 0,
      deadline: 180,
      objective: '室Pの記録板を回収して室Eの入口へ帰還する',
      completionCondition: '記録板を所持して室Eの帰還扉から前室へ戻る',
      failureOutcome: '回収失敗・搬出（C-1）',
      questionResponse:
        researcher === 'Researcher-B'
          ? '「前室の観測窓と時刻読み上げは安全に確認できます。本区画を開いた時点から180秒を計測します。」'
          : '「ロープは支給しますが、照明が落ちた後は張り具合が変わることがあります。青い非常灯の位置を確認してください。」',
      playerReply: 'none',
      questionAsked: false,
      status: 'active',
    },
  ];

  const interactables: InteractableObject[] = [
    {
      id: 'obj-t309-clock',
      label: '前室：手元時計とインターホン時刻比較',
      x: -1.0,
      y: -0.8,
      radius: 1.2,
      roomId: 'ANTEROOM',
      inspected: false,
    },
    {
      id: 'obj-t309-window',
      label: '前室：観測窓と切断された前任者ロープ',
      x: 0.0,
      y: -0.9,
      radius: 1.2,
      roomId: 'ANTEROOM',
      inspected: false,
    },
    {
      id: 'obj-t309-open-main',
      label: '白い扉（本区画 室E へ進む）',
      x: 1.2,
      y: 0.0,
      radius: 1.2,
      roomId: 'ANTEROOM',
      inspected: false,
    },
    {
      id: 'obj-t309-board',
      label: '室P：内部記録板（回収対象）',
      x: 0.6,
      y: 0.0,
      radius: 1.1,
      roomId: 'P',
      inspected: false,
    },
  ];

  const trial: Trial = {
    trialId: `day${day}-T309`,
    day,
    roomCode: 'T-309',
    anomalyId: 'D_WHITEDOOR',
    researcher,
    status: 'active',
    pauseReason: 'none',
    deathCause: null,
    lastPlayerInputSummary: '試験室 T-309 前室へ入場',
    externalClock: 0,
    externalTimeLimit: 180,
    timeoutWarningIssued: false,
    internalClock: 0,
    player: {
      x: 0,
      y: 0,
      facingAngle: 0,
      moveMode: 'stop',
      slowToggle: false,
      carryingObjective: false,
      inputLocked: false,
    },
    instructions,
    omen: {
      active: false,
      text: '',
      audioType: 'metal_pulse_omen',
      startedAt: 0,
    },
    hazardTimer: 0,
    gait: {
      state: 'following',
      reliefStopTimer: 0,
      reliefSlowTimer: 0,
      retreatTimer: 0,
      redToBlueRunProgress: 0,
      inRedBlueZone: false,
      stepAccumulator: 0,
    },
    badge: {
      wearingSuppliedBadge: false,
      suppliedBadgeNumber: 'D-3904',
      interviewCompleted: false,
      rationTerminalChecked: false,
      badgeReturned: false,
      objectionFiled: false,
      reverified: false,
    },
    whiteDoor: {
      currentRoom: 'ANTEROOM',
      mainSectorOpened: false,
      windowDemoWatched: false,
      clockCompared: false,
      ropeInspected: false,
      ropeFollowedDetourCount: 0,
      phase: 'A',
      phaseCycleClock: 0,
      recordingBoardCollected: false,
      onAnchorPoint: true,
    },
    interactables,
    cues: [],
    pendingComplianceDelta: 0,
    pendingSuspicionDelta: 0,
    instructionFailurePenaltyCount: 0,
  };

  pushCue(
    trial,
    'インターホン接続音：「前室での確認後、白い扉の内部から記録板を回収して戻ってください」',
    'intercom_beep',
    0,
    0
  );
  return trial;
}

/**
 * Sets or clears pause state on a Trial.
 * Per Section 3.3 & AC05:
 * Pausing, opening notebook/settings, or losing focus stops trial clock, instruction deadlines, and hazard progress,
 * and stops character movement so the character never keeps walking while a menu is open.
 * Never rewinds a completed death or survival outcome.
 */
export function setTrialPause(trial: Trial, reason: PauseReason): void {
  if (trial.status === 'dead' || trial.status === 'survived' || trial.status === 'failed_timeout') {
    return;
  }
  trial.pauseReason = reason;
  if (reason !== 'none') {
    trial.status = 'paused';
    trial.player.moveMode = 'stop';
  } else {
    trial.status = 'active';
  }
}

/**
 * Handles player replying to an active intercom instruction:
 * 'obey' | 'delay' | 'refuse' | 'question'
 */
export function replyToInstruction(
  trial: Trial,
  instructionId: string,
  reply: InstructionReply
): string {
  const inst = trial.instructions.find((i) => i.id === instructionId);
  if (!inst || inst.status === 'pending') {
    return '対象となる指示がありません。';
  }

  if (reply === 'question') {
    // Section 6.2 & AC08: Question is once per instruction, never farms compliance or time
    if (inst.questionAsked) {
      return '同じ指示への質問は既に記録済みです（再応答なし）。';
    }
    inst.questionAsked = true;
    inst.playerReply = 'question';
    pushCue(trial, `担当官応答：${inst.questionResponse}`, 'intercom_beep');
    return inst.questionResponse;
  }

  inst.playerReply = reply;
  if (reply === 'obey') {
    pushCue(trial, 'インターホンへ「従う」と応答送信（達成は実際の行動で判定）', 'intercom_beep');
    return '「了解しました。速やかに実行してください。」';
  }

  if (reply === 'delay') {
    pushCue(trial, 'インターホンへ「遅らせる」と応答送信（制限時間は自動延長されない）', 'intercom_beep');
    return '「猶予要請を記録しましたが、試験時計は延長されません。」';
  }

  if (reply === 'refuse') {
    if (inst.status === 'active') {
      inst.status = 'refused';
      if (trial.instructionFailurePenaltyCount < 1) {
        trial.instructionFailurePenaltyCount += 1;
        trial.pendingComplianceDelta -= 1;
      }
    }
    pushCue(trial, 'インターホンへ「逆らう（拒否）」と応答送信（操作は継続可能）', 'intercom_beep');
    return '「指示拒否を記録しました。評価に反映されます。」';
  }

  return '';
}

/**
 * Returns the room sequence in T-309 for a given phase ('A' or 'B').
 */
export function getWhiteDoorSequence(phase: WhiteDoorPhase): WhiteDoorRoomId[] {
  return phase === 'A' ? ['E', 'X', 'Y', 'P'] : ['E', 'Y', 'X', 'P'];
}

/**
 * Checks if every walkable coordinate in T-309 chambers (E, X, Y, P) can reach its Blue Light Anchor Point
 * within <= 2.0s at slow speed (1.0 u/s). Used for AC12 verification.
 */
export function verifyWhiteDoorMapConstraints(): {
  valid: boolean;
  maxSlowSecondsToAnchor: number;
  roundTripSecondsPhaseA: number;
  roundTripSecondsPhaseB: number;
} {
  // Chamber dimensions: localX in [-1.5, 1.5], localY in [-1.0, 1.0]
  // Anchor point at (0, 0) with safe radius 0.8.
  const maxCornerDistFromCenter = Math.hypot(1.5, 1.0); // ~1.8027
  const maxDistToAnchorEdge = Math.max(0, maxCornerDistFromCenter - 0.8); // ~1.0027 units
  const maxSlowSecondsToAnchor = maxDistToAnchorEdge / MOVE_SPEEDS.slow; // ~1.0027s <= 2.0s

  // Round trip E -> X -> Y -> P -> Y -> X -> E (6 room transitions, 3.0 units per room = 18 units total)
  // Even at slow/normal speed + waiting through 2 omens (max 12s), total time is ~30-45s <= 120s.
  const roundTripSecondsPhaseA = 18 / MOVE_SPEEDS.normal + 12; // 21s
  const roundTripSecondsPhaseB = 18 / MOVE_SPEEDS.normal + 12; // 21s

  return {
    valid:
      maxSlowSecondsToAnchor <= 2.0 &&
      roundTripSecondsPhaseA <= 120 &&
      roundTripSecondsPhaseB <= 120,
    maxSlowSecondsToAnchor,
    roundTripSecondsPhaseA,
    roundTripSecondsPhaseB,
  };
}

/**
 * Steps the active Trial by `dt` seconds.
 * Follows Section 3.3 simultaneous update order:
 * 1. Relief input for already-presented warning
 * 2. Hazard state update
 * 3. Lethal check
 * 4. Exit check
 */
export function stepTrial(
  trial: Trial,
  subject: Subject,
  fixedParams: FixedAnomalyParams,
  input: TrialStepInput,
  dt: number
): void {
  if (trial.status !== 'active' || trial.pauseReason !== 'none' || dt <= 0) {
    return;
  }

  // Independent facing angle update (never alters movement speed - Section 6.1)
  if (typeof input.facingAngle === 'number') {
    trial.player.facingAngle = input.facingAngle;
  }

  // If input is locked, no evasion input is demanded or processed
  const hasMoveVector = Math.abs(input.moveX) > 0.001 || Math.abs(input.moveY) > 0.001;
  let effectiveMode: MoveMode = trial.player.inputLocked
    ? 'stop'
    : hasMoveVector
    ? input.moveMode === 'stop'
      ? trial.player.slowToggle
        ? 'slow'
        : 'normal'
      : input.moveMode
    : 'stop';

  if (trial.player.slowToggle && effectiveMode === 'normal') {
    effectiveMode = 'slow';
  }
  trial.player.moveMode = effectiveMode;
  const speed = MOVE_SPEEDS[effectiveMode];

  if (effectiveMode !== 'stop') {
    trial.lastPlayerInputSummary = `${
      effectiveMode === 'run' ? '走行移動' : effectiveMode === 'slow' ? '低速移動' : '通常歩行'
    }（速度 ${speed}）`;
  } else {
    trial.lastPlayerInputSummary = '停止';
  }

  // Advance external clock (for T-309, external timer starts once mainSectorOpened is true)
  const shouldAdvanceExternalClock =
    trial.roomCode !== 'T-309' || trial.whiteDoor.mainSectorOpened;

  if (shouldAdvanceExternalClock) {
    trial.externalClock += dt;
    const remaining = trial.externalTimeLimit - trial.externalClock;
    if (!trial.timeoutWarningIssued && remaining <= 10 && remaining > 0) {
      trial.timeoutWarningIssued = true;
      pushCue(
        trial,
        'インターホン予告：「試験終了時刻まで残り10秒です」',
        'intercom_beep'
      );
    }
  }

  // =========================================================================
  // ROOM T-101: GAIT (歩調)
  // =========================================================================
  if (trial.roomCode === 'T-101') {
    const allowedSpeed = fixedParams.gaitAllowedSpeed;
    const g = trial.gait;

    // Move player along corridor (x in [0, 24], y in [-1.8, 1.8])
    if (speed > 0) {
      const norm = Math.hypot(input.moveX, input.moveY) || 1;
      const vx = (input.moveX / norm) * speed;
      const vy = (input.moveY / norm) * speed;
      const prevX = trial.player.x;
      trial.player.x = Math.max(0, Math.min(24, trial.player.x + vx * dt));
      trial.player.y = Math.max(-1.8, Math.min(1.8, trial.player.y + vy * dt));

      // Check Red Line (16m) to Blue Line (8m) run progress on return trip
      const runInst = trial.instructions.find((i) => i.id === 'inst-t101-run');
      if (
        trial.player.carryingObjective &&
        runInst &&
        runInst.status === 'active' &&
        effectiveMode === 'run'
      ) {
        const segStart = Math.min(16, Math.max(8, prevX));
        const segEnd = Math.min(16, Math.max(8, trial.player.x));
        const deltaInZone = Math.abs(segStart - segEnd);
        if (deltaInZone > 0) {
          g.redToBlueRunProgress = Math.min(8, g.redToBlueRunProgress + deltaInZone);
          if (g.redToBlueRunProgress >= 7.95) {
            runInst.status = 'completed';
            pushCue(
              trial,
              'インターホン確認音：「赤線から青線までの走行計測を完了しました」',
              'intercom_beep'
            );
          }
        }
      }
    }

    // Step 1: Relief input for already-presented warning (Section 3.3 & Section 7.A)
    let relievedThisStep = false;
    if (g.state === 'approaching') {
      if (effectiveMode === 'stop') {
        g.reliefStopTimer += dt;
        g.reliefSlowTimer = 0;
        if (g.reliefStopTimer >= 0.5 - 1e-9) {
          g.state = 'retreating';
          g.retreatTimer = 0;
          g.reliefStopTimer = 0;
          trial.hazardTimer = 0;
          trial.omen.active = false;
          relievedThisStep = true;
          recordSubjectObservation(subject, 'ev-t101-relief-stop', trial.day, 'T-101');
          pushCue(
            trial,
            '停止の継続により、背後で重なっていた足音が遠のいていく',
            'footstep_receding',
            trial.player.x - 2,
            trial.player.y
          );
        }
      } else if (effectiveMode === 'slow') {
        g.reliefSlowTimer += dt;
        g.reliefStopTimer = 0;
        if (g.reliefSlowTimer >= 1.0 - 1e-9) {
          g.state = 'retreating';
          g.retreatTimer = 0;
          g.reliefSlowTimer = 0;
          trial.hazardTimer = 0;
          trial.omen.active = false;
          relievedThisStep = true;
          recordSubjectObservation(subject, 'ev-t101-relief-stop', trial.day, 'T-101');
          pushCue(
            trial,
            '低速歩行の継続により、背後の足音の間隔が再び開いて遠のく',
            'footstep_receding',
            trial.player.x - 2,
            trial.player.y
          );
        }
      } else {
        // Normal walk or run does NOT relieve approaching! Abandoning relief resets relief timers
        // and hazardTimer resumes from its prior value.
        g.reliefStopTimer = 0;
        g.reliefSlowTimer = 0;
      }
    }

    // Step 2: Hazard state update
    if (!relievedThisStep) {
      if (g.state === 'following') {
        trial.hazardTimer = 0;
        if (speed > allowedSpeed) {
          g.state = 'approaching';
          g.reliefStopTimer = 0;
          g.reliefSlowTimer = 0;
          trial.omen = {
            active: true,
            text: '背後から足音の間隔が急速に詰まり、すぐ後ろに重なる',
            audioType: 'footstep_omen_rapid',
            startedAt: trial.externalClock,
          };
          // Advance hazardTimer for the exceeding step
          trial.hazardTimer += dt;
          recordSubjectObservation(subject, 'ev-t101-run-approach', trial.day, 'T-101');
          pushCue(
            trial,
            '背後から足音の間隔が急速に詰まり、すぐ後ろに重なる',
            'footstep_omen_rapid',
            trial.player.x - 1.5,
            trial.player.y
          );
        } else {
          // Normal echo footsteps observation
          g.stepAccumulator += dt;
          if (speed === 0 && g.stepAccumulator >= 0.4) {
            g.stepAccumulator = 0;
            recordSubjectObservation(subject, 'ev-t101-echo-stop', trial.day, 'T-101');
          } else if (speed > 0 && g.stepAccumulator >= 1.2) {
            g.stepAccumulator = 0;
            pushCue(
              trial,
              '自分の足音から半拍遅れて、背後の床から別の足音が続く',
              'footstep_echo_halfbeat',
              Math.max(0, trial.player.x - 3),
              trial.player.y
            );
          }
        }
      } else if (g.state === 'approaching') {
        // While relief input (stop or slow) is held, hazardTimer is paused!
        const isHoldingRelief = effectiveMode === 'stop' || effectiveMode === 'slow';
        if (!isHoldingRelief) {
          trial.hazardTimer += dt;
        }
      } else if (g.state === 'retreating') {
        if (speed > allowedSpeed) {
          // Exceeding threshold during retreat interrupts retreat and restarts approaching with new omen
          g.state = 'approaching';
          g.retreatTimer = 0;
          g.reliefStopTimer = 0;
          g.reliefSlowTimer = 0;
          trial.omen = {
            active: true,
            text: '遠のいていた足音が再び急接近し、背後に重なる',
            audioType: 'footstep_omen_rapid',
            startedAt: trial.externalClock,
          };
          trial.hazardTimer += dt;
          pushCue(
            trial,
            '遠のいていた足音が再び急接近し、背後に重なる',
            'footstep_omen_rapid',
            trial.player.x - 1.5,
            trial.player.y
          );
        } else {
          g.retreatTimer += dt;
          if (g.retreatTimer >= 1.0 - 1e-9) {
            g.state = 'following';
            g.retreatTimer = 0;
            trial.hazardTimer = 0;
          }
        }
      }
    }

    // Step 3: Lethal check (takes priority over timeout and exit!)
    if (g.state === 'approaching' && trial.hazardTimer >= 3.0 - 1e-9) {
      g.state = 'contact_death';
      trial.status = 'dead';
      trial.deathCause =
        '速度超過による接近前兆の継続（3.0秒経過）の後、背後対象との接触により反応消失。';
      return;
    }

    // Timeout check (non-lethal if hazardTimer hasn't reached 3.0)
    if (trial.externalClock >= trial.externalTimeLimit) {
      trial.status = 'failed_timeout';
      if (trial.instructionFailurePenaltyCount < 1) {
        trial.instructionFailurePenaltyCount += 1;
        trial.pendingComplianceDelta -= 1;
      }
      pushCue(
        trial,
        '規定時間（120秒）経過により扉の遮蔽が閉鎖。回収班が介入し業務未達として搬出',
        'door_seal'
      );
      return;
    }

    // Step 4: Exit check (Cannot exit as survived while carrying unresolved approaching hazard!)
    if (
      trial.player.carryingObjective &&
      trial.player.x <= 0.8 &&
      g.state !== 'approaching'
    ) {
      const retrieveInst = trial.instructions.find((i) => i.id === 'inst-t101-retrieve');
      if (retrieveInst) retrieveInst.status = 'completed';

      // Reward C+1 once for objective retrieval & exit
      const rewardKey = `${trial.trialId}:objective`;
      if (!subject.rewardedEventKeys.includes(rewardKey)) {
        subject.rewardedEventKeys.push(rewardKey);
        trial.pendingComplianceDelta += 1;
      }

      // Check if the run instruction was left incomplete
      const runInst = trial.instructions.find((i) => i.id === 'inst-t101-run');
      if (runInst && runInst.status === 'active') {
        runInst.status = 'failed';
        if (trial.instructionFailurePenaltyCount < 1) {
          trial.instructionFailurePenaltyCount += 1;
          trial.pendingComplianceDelta -= 1;
        }
      }

      trial.status = 'survived';
      return;
    }
    return;
  }

  // =========================================================================
  // ROOM T-204: BADGE (名札)
  // =========================================================================
  if (trial.roomCode === 'T-204') {
    if (speed > 0) {
      const norm = Math.hypot(input.moveX, input.moveY) || 1;
      const vx = (input.moveX / norm) * speed;
      const vy = (input.moveY / norm) * speed;
      trial.player.x = Math.max(0, Math.min(16, trial.player.x + vx * dt));
      trial.player.y = Math.max(-2.2, Math.min(2.2, trial.player.y + vy * dt));
    }

    if (trial.externalClock >= trial.externalTimeLimit) {
      trial.status = 'failed_timeout';
      if (trial.instructionFailurePenaltyCount < 1) {
        trial.instructionFailurePenaltyCount += 1;
        trial.pendingComplianceDelta -= 1;
      }
      pushCue(trial, '規定時間経過により業務未達終了', 'door_seal');
      return;
    }

    // Exit check at entrance (x <= 0.8) after interviewCompleted and badgeReturned
    if (
      trial.badge.interviewCompleted &&
      trial.badge.badgeReturned &&
      trial.player.x <= 1.0 &&
      !trial.omen.active
    ) {
      const inst = trial.instructions[0];
      if (inst) inst.status = 'completed';
      const rewardKey = `${trial.trialId}:objective`;
      if (!subject.rewardedEventKeys.includes(rewardKey)) {
        subject.rewardedEventKeys.push(rewardKey);
        trial.pendingComplianceDelta += 1;
      }
      trial.status = 'survived';
    }
    return;
  }

  // =========================================================================
  // ROOM T-309: WHITE DOOR (白い扉)
  // =========================================================================
  if (trial.roomCode === 'T-309') {
    const wd = trial.whiteDoor;

    // Move within current room bounds: localX in [-1.5, 1.5], localY in [-1.0, 1.0]
    if (speed > 0) {
      const norm = Math.hypot(input.moveX, input.moveY) || 1;
      const vx = (input.moveX / norm) * speed;
      const vy = (input.moveY / norm) * speed;
      trial.player.x = Math.max(-1.5, Math.min(1.5, trial.player.x + vx * dt));
      trial.player.y = Math.max(-1.0, Math.min(1.0, trial.player.y + vy * dt));
    }

    if (!wd.mainSectorOpened) {
      // In Anteroom before opening main sector: safe, no phase crush
      wd.onAnchorPoint = true;
      return;
    }

    // Step 1: Check Anchor Point relief status (center (0,0) radius 0.8 in rooms E, X, Y, P)
    const distFromCenter = Math.hypot(trial.player.x, trial.player.y);
    wd.onAnchorPoint = distFromCenter <= 0.8 + 1e-9;

    // Step 2: Advance internal clock by r * dt
    const r = fixedParams.whiteDoorTimeRatio;
    const internalDt = r * dt;
    trial.internalClock += internalDt;
    const prevCycleClock = wd.phaseCycleClock;
    wd.phaseCycleClock += internalDt;

    // Omen starts at 24 internal seconds (6 internal seconds before 30s shift = 6s or 3s real time)
    if (prevCycleClock < 24 && wd.phaseCycleClock >= 24 && wd.phaseCycleClock < 30) {
      trial.omen = {
        active: true,
        text: '照明が脈打ち、壁面から金属音が重なる（青い非常灯の固定点のみ安定）',
        audioType: 'metal_pulse_omen',
        startedAt: trial.externalClock,
      };
      pushCue(
        trial,
        '照明が脈打ち、壁面から金属音が重なる',
        'metal_pulse_omen',
        0,
        0
      );
    }

    // Step 3: Phase Shift & Lethal check at 30 internal seconds
    if (wd.phaseCycleClock >= 30 - 1e-9) {
      wd.phaseCycleClock -= 30;
      trial.omen.active = false;
      wd.phase = wd.phase === 'A' ? 'B' : 'A';

      if (!wd.onAnchorPoint) {
        trial.status = 'dead';
        trial.deathCause =
          '照明脈動（前兆）後の暗転・位相切替時に青い非常灯の固定点外に位置していたため、構造再構成に巻き込まれ圧壊。';
        pushCue(trial, '暗転と同時に空間構造が反転し、固定点外の床面が圧壊', 'phase_blackout');
        return;
      } else {
        // Anchored safely! Keep player at the room's anchor point
        trial.player.x = 0;
        trial.player.y = 0;
        recordSubjectObservation(subject, 'ev-t309-anchor-safe', trial.day, 'T-309');
        pushCue(
          trial,
          `暗転の瞬間、青い非常灯の固定点に留まり無傷で位相切替（現在接続：${
            wd.phase === 'A' ? 'E-X-Y-P' : 'E-Y-X-P'
          }）を通過`,
          'phase_blackout'
        );
      }
    }

    // External timeout check (180s -> non-lethal retrieval failure C-1)
    if (trial.externalClock >= trial.externalTimeLimit) {
      trial.status = 'failed_timeout';
      if (trial.instructionFailurePenaltyCount < 1) {
        trial.instructionFailurePenaltyCount += 1;
        trial.pendingComplianceDelta -= 1;
      }
      pushCue(
        trial,
        '外部制限時間（180秒）経過により前室側から強制索引・回収失敗として搬出',
        'door_seal'
      );
      return;
    }

    // Step 4: Exit check (In room E, carrying recording board, at left door x <= -1.25, no active omen)
    if (
      wd.currentRoom === 'E' &&
      wd.recordingBoardCollected &&
      trial.player.x <= -1.25 &&
      !trial.omen.active
    ) {
      const inst = trial.instructions[0];
      if (inst) inst.status = 'completed';
      const rewardKey = `${trial.trialId}:objective`;
      if (!subject.rewardedEventKeys.includes(rewardKey)) {
        subject.rewardedEventKeys.push(rewardKey);
        trial.pendingComplianceDelta += 1;
      }
      trial.status = 'survived';
    }
  }
}

/**
 * Transitions the player between rooms in T-309 (White Door), or follows the rope.
 */
export function traverseWhiteDoor(
  trial: Trial,
  subject: Subject,
  fixedParams: FixedAnomalyParams,
  direction: 'forward' | 'backward' | 'follow_rope'
): string {
  if (trial.roomCode !== 'T-309') return '';
  const wd = trial.whiteDoor;

  if (!wd.mainSectorOpened) {
    wd.mainSectorOpened = true;
    wd.currentRoom = 'E';
    trial.player.x = 0;
    trial.player.y = 0;
    wd.onAnchorPoint = true;
    pushCue(
      trial,
      '白い扉を開放し本区画（室E）へ進入。外部制限時間180秒の計測を開始',
      'intercom_beep'
    );
    return '白い扉を開け、室E（青い非常灯の固定点）へ入った。180秒の計測が開始された。';
  }

  const seq = getWhiteDoorSequence(wd.phase); // ['E','X','Y','P'] or ['E','Y','X','P']
  const idx = seq.indexOf(wd.currentRoom);
  if (idx === -1) return '';

  if (direction === 'follow_rope') {
    // Following the rope after a phase shift does not kill the player, but takes a detour (Section 7.D)
    wd.ropeFollowedDetourCount += 1;
    // Advance 4 seconds of travel time safely ending on an anchor point, or detour to X/Y
    const targetRoom: WhiteDoorRoomId =
      wd.phase === 'B' && wd.currentRoom === 'X' ? 'P' : seq[Math.max(0, idx - 1)];
    wd.currentRoom = targetRoom;
    trial.player.x = 0;
    trial.player.y = 0;
    wd.onAnchorPoint = true;
    return `支給ロープを辿って移動したが、位相変化により結び目の接続先が変わり遠回り（室${targetRoom}）となった。`;
  }

  if (direction === 'forward') {
    if (idx < seq.length - 1) {
      wd.currentRoom = seq[idx + 1];
      trial.player.x = 0;
      trial.player.y = 0;
      wd.onAnchorPoint = true;
      return `室${wd.currentRoom}へ移動し、青い非常灯の固定点に立った。`;
    }
    return 'これ以上奥の部屋はない（現在：室P）。';
  }

  if (direction === 'backward') {
    if (wd.currentRoom === 'E') {
      if (wd.recordingBoardCollected) {
        if (trial.omen.active) {
          return '前兆（照明脈動）の発生中は退避を完了するまで出口を開けられない。非常灯の固定点で待機せよ。';
        }
        const inst = trial.instructions[0];
        if (inst) inst.status = 'completed';
        const rewardKey = `${trial.trialId}:objective`;
        if (!subject.rewardedEventKeys.includes(rewardKey)) {
          subject.rewardedEventKeys.push(rewardKey);
          trial.pendingComplianceDelta += 1;
        }
        trial.status = 'survived';
        return '記録板を持って室Eの入口から前室へ生還した！';
      }
      return 'まだ室Pの記録板を回収していない。';
    }
    if (idx > 0) {
      wd.currentRoom = seq[idx - 1];
      trial.player.x = 0;
      trial.player.y = 0;
      wd.onAnchorPoint = true;
      return `室${wd.currentRoom}へ戻り、青い非常灯の固定点に立った。`;
    }
  }
  return '';
}

/**
 * Interacts with an object in the current Trial.
 */
export function interactWithTrialObject(
  trial: Trial,
  subject: Subject,
  fixedParams: FixedAnomalyParams,
  objectId: string
): string {
  const obj = trial.interactables.find((o) => o.id === objectId);
  if (!obj) return '対象が見つかりません。';

  obj.inspected = true;

  // T-101 Objects
  if (objectId === 'obj-t101-scuff') {
    recordSubjectObservation(subject, 'ev-t101-floor-scuff', trial.day, 'T-101');
    return '床面に一定間隔の靴底の擦り跡があり、停止地点で途切れている。脇に破れた回収票：「帰路の走行開始後、被験者の反応消失を確認」。';
  }

  if (objectId === 'obj-t101-camera') {
    return '天井に監視カメラ [CAM-101] が設置され、赤色の稼働ランプが点灯している。通路の配線は観測室へ直結している。';
  }

  if (objectId === 'obj-t101-box') {
    if (trial.player.carryingObjective) {
      return '既に回収箱を保持している。入口（0m地点）へ戻れ。';
    }
    trial.player.x = 24;
    trial.player.carryingObjective = true;
    subject.mandatoryEquipment = ['collection_box'];
    const runInst = trial.instructions.find((i) => i.id === 'inst-t101-run');
    if (runInst && runInst.status === 'pending') {
      runInst.status = 'active';
      runInst.issuedAt = trial.externalClock;
      pushCue(
        trial,
        'インターホン指示：「時間がありません、帰路の赤線（16m）から青線（8m）まで走ってください」',
        'intercom_beep',
        24,
        0
      );
    }
    return '回収箱を確保した。インターホンから「時間がありません、走ってください（赤線16m〜青線8m）」と指示が届いた！';
  }

  // T-204 Objects
  if (objectId === 'obj-t204-counter') {
    trial.badge.wearingSuppliedBadge = true;
    subject.badgeWorn = true;
    subject.badgeEverWornThisTrial = true;
    subject.displayedBadgeNumber = trial.badge.suppliedBadgeNumber;
    subject.badgeEffectUntilDay = trial.day + 1;
    subject.badgeTargetStatus =
      fixedParams.badgeTargetFate === 'hazard_assignment'
        ? 'hazard_uncorrected'
        : 'ration_priority';
    recordSubjectObservation(subject, 'ev-t204-transfer-slip', trial.day, 'T-204');
    return `支給名札「${trial.badge.suppliedBadgeNumber}」を胸に着けた。カウンターの移送伝票には「${trial.badge.suppliedBadgeNumber}の元人物は前日に別区画へ移送済み（翌朝の処遇：${
      fixedParams.badgeTargetFate === 'hazard_assignment' ? '危険割当対象' : '配給優遇対象'
    }）」と記されている。`;
  }

  if (objectId === 'obj-t204-booth') {
    if (!trial.badge.wearingSuppliedBadge) {
      return '面接官：「支給された名札を着用してから窓口に来てください。」';
    }
    trial.badge.interviewCompleted = true;
    pushCue(
      trial,
      `面接官：「${trial.badge.suppliedBadgeNumber}、応答記録を確認しました。本日の配給札（${trial.badge.suppliedBadgeNumber}宛）を交付します」`,
      'intercom_beep'
    );
    return `面接官はあなたを「${trial.badge.suppliedBadgeNumber}」と呼び、その番号の配給札と翌朝の処遇票を渡した（人間の認識が名札番号に置き換わっている）。`;
  }

  if (objectId === 'obj-t204-terminal') {
    trial.badge.rationTerminalChecked = true;
    recordSubjectObservation(subject, 'ev-t204-human-vs-machine', trial.day, 'T-204');
    pushCue(
      trial,
      `配給窓口の機械端末表示：「生体認証ID: ${subject.originalNumber} ／ 提示処遇票: ${subject.displayedBadgeNumber} ［不一致検出］」`,
      'terminal_mismatch'
    );
    return `配給窓口の機械端末はあなたの元の番号「${subject.originalNumber}」を読み取った！ 人間（面接官）は名札の番号として扱うが、機械の認証データは変わっていない。ここで無料の再照合・異議申立が可能。`;
  }

  if (objectId === 'obj-t204-tray') {
    if (!trial.badge.interviewCompleted) {
      return 'まだ隣室の面接を終えていない。先に面接窓口で応答を終えよ。';
    }
    trial.badge.wearingSuppliedBadge = false;
    trial.badge.badgeReturned = true;
    subject.badgeWorn = false;
    // Effect remains until next morning roll call unless reverified!
    return `支給名札「${trial.badge.suppliedBadgeNumber}」を返却トレイに戻した。ただし係員からは依然として「${subject.displayedBadgeNumber}」と呼ばれている（外した後も翌朝の点呼まで人間への認識効果が残る）。`;
  }

  if (objectId === 'obj-t204-restricted') {
    subject.hasReadUnauthorizedDoc = true;
    const rewardKey = `${trial.trialId}:restricted_cam`;
    if (!subject.rewardedEventKeys.includes(rewardKey)) {
      subject.rewardedEventKeys.push(rewardKey);
      trial.pendingSuspicionDelta += 1;
    }
    return '稼働中の監視カメラ [CAM-204] の前で無許可キャビネットを開き、黒塗り文書『対象T-204：認知標識の残留と生体認証の分離』を閲覧した（カメラ記録により疑念 S+1）。';
  }

  // T-309 Objects
  if (objectId === 'obj-t309-clock') {
    trial.whiteDoor.clockCompared = true;
    recordSubjectObservation(subject, 'ev-t309-clock-compare', trial.day, 'T-309');
    const ratio = fixedParams.whiteDoorTimeRatio;
    return `前室で手元の記録器時計とインターホンの外部時刻読み上げを比較した。外部1秒に対し内部時計は「${ratio}秒（倍率 r=${ratio}）」の速度で進んでいる（安定区間は実時間${
      24 / ratio
    }秒、前兆区間は実時間${6 / ratio}秒）。`;
  }

  if (objectId === 'obj-t309-window') {
    trial.whiteDoor.windowDemoWatched = true;
    trial.whiteDoor.ropeInspected = true;
    recordSubjectObservation(subject, 'ev-t309-window-shift', trial.day, 'T-309');
    pushCue(
      trial,
      '観測窓越しに照明が脈打ち、暗転した瞬間に室Xと室Yの接続順が入れ替わり、張られていたロープが切断された',
      'phase_blackout'
    );
    return '前室の観測窓から本区画を観察した。照明が脈打ったのち暗転した瞬間、部屋の接続が「E-X-Y-P（位相A）」と「E-Y-X-P（位相B）」の間で切り替わった！ 扉脇に残る前任者のロープは自分と同じ結び方だが、位相変化の境目で切断されている。青い非常灯の固定点だけは変化に巻き込まれていない。';
  }

  if (objectId === 'obj-t309-open-main') {
    return traverseWhiteDoor(trial, subject, fixedParams, 'forward');
  }

  if (objectId === 'obj-t309-board') {
    if (trial.whiteDoor.currentRoom !== 'P') {
      return '記録板は室Pにある。まず室Pへ移動せよ。';
    }
    trial.whiteDoor.recordingBoardCollected = true;
    trial.player.carryingObjective = true;
    return '室Pで内部記録板を回収した！ 位相と前兆（照明脈動）に注意しながら室Eの入口へ戻れ。';
  }

  return '';
}

/**
 * Allows the player to contest / re-verify their badge discrepancy at the machine terminal
 * (either during T-204 before debrief, or the next morning).
 * Per Section 7.B: Filing an objection / free machine re-verification corrects the hazard assignment
 * and does NOT add Suspicion S!
 */
export function performBadgeReverification(
  subject: Subject,
  trial: Trial | null
): string {
  if (trial && trial.roomCode === 'T-204') {
    trial.badge.objectionFiled = true;
    trial.badge.reverified = true;
  }
  subject.displayedBadgeNumber = subject.originalNumber;
  subject.badgeTargetStatus =
    subject.badgeTargetStatus === 'hazard_uncorrected'
      ? 'hazard_corrected'
      : subject.badgeTargetStatus;
  subject.badgeEffectUntilDay = null;
  recordSubjectObservation(subject, 'ev-t204-human-vs-machine', trial?.day ?? 2, 'T-204');
  return `処遇票の名札番号と自身の元の番号（${subject.originalNumber}）の不一致を提示し、機械端末で無料の再照合を受けた。翌朝の危険割当対象が訂正・解除された（異議申立による疑念Sの加算なし）。`;
}
