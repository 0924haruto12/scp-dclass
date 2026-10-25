export type CyclePhase =
  | 'title'
  | 'morning_comparison' // Water cooler duplicate interview before morning actions
  | 'morning'
  | 'briefing'
  | 'trial'
  | 'debrief'
  | 'death_report'
  | 'night'
  | 'final_eval'
  | 'ending';

export type RoomCode = 'T-101' | 'T-204' | 'T-309' | 'W-00';

export type AnomalyInternalId = 'A_GAIT' | 'B_BADGE' | 'C_WATER' | 'D_WHITEDOOR';

export type ResearcherId = 'Researcher-A' | 'Researcher-B';

export type MoveMode = 'stop' | 'slow' | 'normal' | 'run';

export type GaitState = 'following' | 'approaching' | 'retreating' | 'contact_death';

export type WhiteDoorPhase = 'A' | 'B';

export type WhiteDoorRoomId = 'ANTEROOM' | 'E' | 'X' | 'Y' | 'P';

export type EndingType =
  | 'escape_attempt'          // 1: 脱走未遂 (30日目の朝、監督用名札で外門の検問まで進む)
  | 'termination_shortage'    // 2: 処分・欠員補充停止 (30日目に現人物が死亡)
  | 'certified_useful'        // 3: 有用認定 (最終業務を生還し、現人物のE=2、C>=2、S<=1)
  | 'termination_standard';   // 4: 処分 (その他の30日目終了)

export type OptionalItemId = 'pencil' | 'paper_strip' | 'small_mirror';

export type MandatoryItemId =
  | 'collection_box'
  | 'test_badge'
  | 'rope_and_logger'
  | 'supervisor_badge';

export interface FixedAnomalyParams {
  gaitAllowedSpeed: 1.5 | 2.5;
  badgeTargetFate: 'hazard_assignment' | 'ration_priority';
  waterCoolerDelayDays: 2 | 3;
  whiteDoorTimeRatio: 1 | 2;
}

export interface ObservationCard {
  id: string;
  eventFact: string;
  facilityDay: number;
  roomCode: RoomCode;
  observerSubjectId: string;
  createdDay: number; // Used by memory treatment to erase most recent 1 day's portable copies
  erased?: boolean;
}

export interface RumorCard {
  id: string;
  statement: string;
  speaker: string;
  acquiredDay: number;
  observedDayNote: string;
  createdDay: number;
  erased?: boolean;
}

export interface HypothesisEntry {
  id: string;
  roomCode: RoomCode;
  customName: string; // Player-assigned alias (since game never shows "歩調" etc.)
  triggerText: string;
  effectText: string;
  conditionText: string;
  evidenceCardIds: string[];
  freeNote: string;
  createdDay: number;
  erased?: boolean;
}

export interface EnvelopeItem {
  id: string;
  sourceType: 'observation' | 'rumor' | 'hypothesis';
  title: string;
  content: string;
  roomCode?: RoomCode;
  recordedBySubjectId: string;
  recordedDay: number;
  canonicalEvidenceId?: string;
}

export interface DayScheduleEntry {
  day: number;
  roomCode: RoomCode;
  anomalyId: AnomalyInternalId;
  researcher: ResearcherId;
  briefingWord: string; // e.g. "回収", "応答", "記録", "再回収"
  isRoleEvalEligible: boolean;
  hasWaterCoolerSetup?: boolean;
  hasSafeReevalUnlock?: boolean;
  isFinalDay?: boolean;
}

export interface FacilityCycle {
  cycleId: string;
  seed: string;
  isPracticeFixedMode: boolean;
  version: string;
  day: number; // 1..30
  phase: CyclePhase;
  morningActionsLeft: number; // 0..2
  nightActionsLeft: number; // 0..2
  fixedParams: FixedAnomalyParams;
  schedule: DayScheduleEntry[];
  envelope: EnvelopeItem[]; // Max 3 items under bunk bed
  envelopeOpenedToday: boolean;
  waterCoolerPresent: boolean;
  waterCoolerInstallDay: number | null; // Day of the current water-cooler placement (2 / 12 / 22)
  processedEventIds: string[]; // Prevents duplicate execution on resume
  endingResult: EndingType | null;
}

export interface Subject {
  subjectId: string;
  originalNumber: string;
  displayedBadgeNumber: string;
  badgeWorn: boolean;
  badgeEffectUntilDay: number | null;
  badgeEverWornThisTrial: boolean;
  badgeTargetStatus: 'none' | 'hazard_uncorrected' | 'hazard_corrected' | 'ration_priority';
  hasSupervisorBadge: boolean;
  supervisorBadgeEarnedDay: number | null;
  C: number; // 0..3 Compliance (信用)
  S: number; // 0..3 Suspicion (疑念)
  E: number; // 0..2 Role Evaluation (役割評価)
  inventory: OptionalItemId[]; // Max 2
  mandatoryEquipment: MandatoryItemId[];
  portableNote: {
    observations: ObservationCard[];
    rumors: RumorCard[];
    hypotheses: HypothesisEntry[];
  };
  observedEvidenceIds: string[]; // Ground truth facts this specific Subject has observed or read from opened envelope
  hasReadUnauthorizedDoc: boolean;
  pendingMemoryTreatment: boolean;
  rewardedEventKeys: string[]; // Guarantees 1-time point awards per event/trial
}

export type InstructionIntent = 'honest' | 'experiment_goal' | 'misdirection' | 'silence';

export type InstructionReply = 'none' | 'obey' | 'delay' | 'refuse' | 'question';

export interface InstructionState {
  id: string;
  speaker: ResearcherId;
  triggerCondition: string;
  text: string;
  intent: InstructionIntent; // Never shown in normal UI
  issuedAt: number;
  deadline: number;
  objective: string;
  completionCondition: string;
  failureOutcome: string;
  questionResponse: string;
  playerReply: InstructionReply;
  questionAsked: boolean;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'refused';
}

export interface PerceptualCue {
  id: string;
  timestamp: number;
  subtitleText: string; // Perceptual fact only, never "Stop!" or solution
  audioType:
    | 'footstep_normal'
    | 'footstep_echo_halfbeat'
    | 'footstep_omen_rapid'
    | 'footstep_receding'
    | 'intercom_beep'
    | 'intercom_cutoff'
    | 'metal_pulse_omen'
    | 'phase_blackout'
    | 'terminal_mismatch'
    | 'terminal_ok'
    | 'door_seal';
  sourceX?: number;
  sourceY?: number;
}

export type PauseReason = 'none' | 'pause_menu' | 'notebook' | 'settings' | 'blur';

export interface AnchorPoint {
  id: string;
  roomId: WhiteDoorRoomId;
  x: number;
  y: number;
  radius: number;
}

export interface InteractableObject {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  roomId?: WhiteDoorRoomId;
  inspected: boolean;
  restricted?: boolean;
  cameraWatched?: boolean;
}

export interface Trial {
  trialId: string;
  day: number;
  roomCode: RoomCode;
  anomalyId: AnomalyInternalId;
  researcher: ResearcherId;
  status: 'active' | 'paused' | 'survived' | 'failed_timeout' | 'dead';
  pauseReason: PauseReason;
  deathCause: string | null;
  lastPlayerInputSummary: string;
  externalClock: number; // Elapsed seconds
  externalTimeLimit: number; // 120s for T-101/T-204, 180s for T-309
  timeoutWarningIssued: boolean;
  internalClock: number; // For T-309: advances by r * dt
  player: {
    x: number;
    y: number;
    facingAngle: number; // radians
    moveMode: MoveMode;
    slowToggle: boolean;
    carryingObjective: boolean;
    inputLocked: boolean;
  };
  instructions: InstructionState[];
  omen: {
    active: boolean;
    text: string;
    audioType: PerceptualCue['audioType'];
    startedAt: number;
  };
  hazardTimer: number;
  // T-101 Gait specific
  gait: {
    state: GaitState;
    reliefStopTimer: number; // 0..0.5s
    reliefSlowTimer: number; // 0..1.0s
    retreatTimer: number; // 0..1.0s
    redToBlueRunProgress: number; // 0..8 units run between x=16 and x=8 on return
    inRedBlueZone: boolean;
    stepAccumulator: number;
  };
  // T-204 Badge specific
  badge: {
    wearingSuppliedBadge: boolean;
    suppliedBadgeNumber: string;
    interviewCompleted: boolean;
    rationTerminalChecked: boolean;
    badgeReturned: boolean;
    objectionFiled: boolean;
    reverified: boolean;
  };
  // T-309 White Door specific
  whiteDoor: {
    currentRoom: WhiteDoorRoomId;
    mainSectorOpened: boolean;
    windowDemoWatched: boolean;
    clockCompared: boolean;
    ropeInspected: boolean;
    ropeFollowedDetourCount: number;
    phase: WhiteDoorPhase;
    phaseCycleClock: number; // 0..30 internal seconds (0..24 stable, 24..30 omen)
    recordingBoardCollected: boolean;
    onAnchorPoint: boolean;
  };
  interactables: InteractableObject[];
  cues: PerceptualCue[];
  pendingComplianceDelta: number;
  pendingSuspicionDelta: number;
  instructionFailurePenaltyCount: number; // Max 1 per trial
}

export interface DeferredEvent {
  id: string;
  type: 'water_duplicate' | 'badge_morning_rollcall' | 'scheduled_memory_treatment';
  targetSubjectId: string;
  originDay: number;
  resolveDay: number;
  resolvePhase: 'morning_comparison' | 'morning' | 'debrief';
  cancelOnSubjectDeath: boolean;
  resolved: boolean;
  cancelled: boolean;
}

export interface ReportArchive {
  id: string;
  cycleId: string;
  facilityCode: string;
  day: number;
  roomCode: RoomCode;
  observerSubjectId: string;
  outcome: 'survived' | 'failed_timeout' | 'dead' | 'ending';
  fragmentText: string;
  endingType?: EndingType;
  isCurrentCycle: boolean;
}

export interface ComparisonInterviewState {
  active: boolean;
  duplicateCompliance: number; // 1
  cooperationAnswered: boolean;
  silentWarningShown: boolean;
  resolved: boolean;
}

export interface DebriefChoice {
  id: string;
  label: string;
  category: 'grounded_observation' | 'excuse' | 'unfounded_secret' | 'silent' | 'submit_hidden_memo' | 'quote_unauthorized_doc';
  description: string;
  requiresEvidenceId?: string;
  requiresEnvelopeOrNote?: boolean;
  requiresUnauthorizedDoc?: boolean;
}

export interface GameState {
  cycle: FacilityCycle;
  subject: Subject;
  trial: Trial | null;
  deferredEvents: DeferredEvent[];
  reportArchive: ReportArchive[];
  comparisonInterview: ComparisonInterviewState | null;
  settings: {
    subtitlesOn: boolean;
    volume: number; // 0..1
    devLogVisible: boolean;
  };
  corruptedSaveNotice: string | null;
  lastActionLog: string[];
}
