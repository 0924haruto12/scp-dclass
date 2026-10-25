// 施設サイクルと被験者の進行。仕様案2節・5節・8節に対応する。
// 状態遷移は処理済みIDで守り、再開や二重呼び出しで結果を重複適用しない。

import {
  DISTRIBUTED_NOTICE,
  MEMORY_TREATMENT_LINES,
  MORNING_CELLMATE,
  NIGHT_CELLMATE,
  SAFE_TASK,
  SLICE_END_LINES,
  rationText,
  roomLabel,
  suspicionNotices,
  type CellmateLine,
} from './content';
import type { FactId } from './facts';
import type { ResearcherId } from './instructions';
import {
  availableOptions,
  resolveOption,
  type InterrogationContext,
  type InterrogationOptionId,
  type InterrogationResolution,
} from './interrogation';
import { applyDelta, shortfallKey, type DeltaPart, type Stats } from './ledger';
import {
  addHearsay,
  addObservation,
  emptyNotebook,
  envelopeTextFor,
  eraseRecentCopies,
  findEntry,
  FREE_TEXT_LIMIT,
  type EnvelopeItem,
  type Notebook,
} from './notebook';
import { createPacingTrial, type PacingTrialState, type TrialOutcome } from './pacing';
import { DAY, FIRST_FIXED_SEED, PACING } from './params';
import { buildTrialReport, type ArchivedReport } from './reports';
import { createRng, nextFloat, pick, randomSeed } from './rng';

export const SAVE_VERSION = 1;
export const RULES_VERSION = 'mvp-draft-0.1/slice-pacing-1';

export type Phase =
  | 'morning'
  | 'summons'
  | 'trial'
  | 'interrogation'
  | 'report'
  | 'night'
  | 'death_report'
  | 'slice_end'
  | 'ended';

export type EndingKind = 'escape_attempt' | 'disposal_no_replacement' | 'useful' | 'disposal';

export interface CycleParams {
  pacingTolerance: number;
}

export interface DayAssignment {
  day: number;
  trial: 'pacing' | null;
  researcher: ResearcherId;
  roomCode: string;
}

/** 遅効イベント（給水器など）の予約。縦切りでは発生源がなく、取消処理だけを持つ */
export interface DeferredEvent {
  id: string;
  subjectId: string;
  origin: string;
  resolveDay: number;
  resolvePhase: 'morning' | 'night';
  status: 'pending' | 'resolved' | 'cancelled';
}

export interface Subject {
  subjectId: string;
  number: string;
  arrivedDay: number;
  stats: Stats;
  awarded: string[];
  carry: string[];
  notebook: Notebook;
  effects: string[];
  /** 現人物が観測した事実の原記録。記憶処理でも消えない。疑念の根拠判定に使う */
  evidence: FactId[];
  slotDay: number;
  morningSlotsUsed: number;
  nightSlotsUsed: number;
  envelopeReadDay: number | null;
}

export interface ResolvedTrial {
  trialId: string;
  roomCode: string;
  outcome: TrialOutcome;
  observed: FactId[];
}

export interface FacilityCycle {
  cycleId: string;
  seed: number;
  rulesVersion: string;
  facilityCode: string;
  day: number;
  phase: Phase;
  params: CycleParams;
  schedule: DayAssignment[];
  envelope: EnvelopeItem[];
  processed: string[];
  subjectSerial: number;
  subject: Subject;
  trial: PacingTrialState | null;
  resolved: ResolvedTrial | null;
  interrogation: InterrogationContext | null;
  interrogationReply: string | null;
  currentReport: ArchivedReport | null;
  notices: string[];
  deferred: DeferredEvent[];
  ending: EndingKind | null;
}

export interface GameMeta {
  cyclesStarted: number;
  /** プレイヤー向けの事後報告履歴。新サイクルでも消さない */
  archive: ArchivedReport[];
}

export interface GameState {
  saveVersion: typeof SAVE_VERSION;
  meta: GameMeta;
  cycle: FacilityCycle | null;
}

export interface ActionResult {
  ok: boolean;
  title: string;
  lines: string[];
}

export type MorningAction = 'notice' | 'cellmate' | 'envelope';
export type NightAction = 'cellmate' | 'safe_task';

export function createInitialState(): GameState {
  return { saveVersion: SAVE_VERSION, meta: { cyclesStarted: 0, archive: [] }, cycle: null };
}

export function cycleParamsForSeed(seed: number): CycleParams {
  if (seed === FIRST_FIXED_SEED) return { pacingTolerance: PACING.firstFixedTolerance };
  const rng = createRng(seed, 'rules');
  return { pacingTolerance: pick(rng, PACING.toleranceOptions) };
}

function facilityCodeForSeed(seed: number): string {
  const rng = createRng(seed, 'names');
  const block = 2 + Math.floor(nextFloat(rng) * 8);
  const wing = pick(rng, ['A', 'B', 'C', 'D', 'E', 'F']);
  return `区画${block}-${wing}`;
}

function subjectNumberFor(seed: number, serial: number): string {
  const rng = createRng((seed ^ Math.imul(serial + 1, 0x27d4eb2d)) >>> 0, 'names');
  return `D-${String(1000 + Math.floor(nextFloat(rng) * 9000))}`;
}

export function sliceSchedule(): DayAssignment[] {
  return Array.from({ length: DAY.cycleLength }, (_, i) => ({
    day: i + 1,
    trial: i === 0 ? ('pacing' as const) : null,
    researcher: 'A' as const,
    roomCode: PACING.roomCode,
  }));
}

function createSubject(seed: number, serial: number, day: number): Subject {
  return {
    subjectId: `s${serial}`,
    number: subjectNumberFor(seed, serial),
    arrivedDay: day,
    stats: { credit: 0, suspicion: 0, evaluation: 0 },
    awarded: [],
    carry: [],
    notebook: emptyNotebook(),
    effects: [],
    evidence: [],
    slotDay: day,
    morningSlotsUsed: 0,
    nightSlotsUsed: 0,
    envelopeReadDay: null,
  };
}

/** 新サイクル。初回は固定seed、以後は新seedで変動パラメータを抽選する */
export function startNewCycle(state: GameState, seedOverride?: number): FacilityCycle {
  const seed = seedOverride ?? (state.meta.cyclesStarted === 0 ? FIRST_FIXED_SEED : randomSeed());
  state.meta.cyclesStarted += 1;
  const cycle: FacilityCycle = {
    cycleId: `c${state.meta.cyclesStarted}-${seed.toString(36)}`,
    seed,
    rulesVersion: RULES_VERSION,
    facilityCode: facilityCodeForSeed(seed),
    day: 1,
    phase: 'morning',
    params: cycleParamsForSeed(seed),
    schedule: sliceSchedule(),
    envelope: [],
    processed: [],
    subjectSerial: 1,
    subject: createSubject(seed, 1, 1),
    trial: null,
    resolved: null,
    interrogation: null,
    interrogationReply: null,
    currentReport: null,
    notices: [],
    deferred: [],
    ending: null,
  };
  state.cycle = cycle;
  return cycle;
}

function requireCycle(state: GameState): FacilityCycle {
  if (!state.cycle) throw new Error('no active cycle');
  return state.cycle;
}

/** 一度だけ実行する。既に処理済みなら false */
function once(cycle: FacilityCycle, key: string): boolean {
  if (cycle.processed.includes(key)) return false;
  cycle.processed.push(key);
  return true;
}

function ensureSlotDay(subject: Subject, day: number): void {
  if (subject.slotDay === day) return;
  subject.slotDay = day;
  subject.morningSlotsUsed = 0;
  subject.nightSlotsUsed = 0;
}

export function morningSlotsLeft(cycle: FacilityCycle): number {
  ensureSlotDay(cycle.subject, cycle.day);
  return DAY.morningSlots - cycle.subject.morningSlotsUsed;
}

export function nightSlotsLeft(cycle: FacilityCycle): number {
  ensureSlotDay(cycle.subject, cycle.day);
  return DAY.nightSlots - cycle.subject.nightSlotsUsed;
}

/** 朝の状況。数値は出さず、配給札と警備の様子で伝える */
export function morningStatus(cycle: FacilityCycle): string[] {
  const s = cycle.subject;
  const lines = [`${cycle.facilityCode}／${cycle.day}日目の朝／${s.number}`, rationText(s.stats.credit), ...suspicionNotices(s.stats.suspicion)];
  if (s.arrivedDay === cycle.day && cycle.day > 1) lines.push('この寝台に移されたばかりだ。前の持ち主の私物は回収されている。');
  return lines;
}

function talkToCellmate(cycle: FacilityCycle, line: CellmateLine): ActionResult {
  const s = cycle.subject;
  const key = `hearsay:${line.id}`;
  if (!s.awarded.includes(key)) {
    s.awarded.push(key);
    addHearsay(s.notebook, line.text, line.speaker, cycle.day, line.speakerObserved);
  }
  return { ok: true, title: line.speaker, lines: [line.text] };
}

export function morningAction(state: GameState, action: MorningAction): ActionResult {
  const cycle = requireCycle(state);
  if (cycle.phase !== 'morning') return { ok: false, title: '', lines: ['今は行えない。'] };
  if (morningSlotsLeft(cycle) <= 0) return { ok: false, title: '', lines: ['召集の時間だ。'] };
  cycle.subject.morningSlotsUsed += 1;
  switch (action) {
    case 'notice':
      return { ok: true, title: '配布文書', lines: [...DISTRIBUTED_NOTICE] };
    case 'cellmate':
      return talkToCellmate(cycle, MORNING_CELLMATE);
    case 'envelope':
      return readEnvelope(cycle);
  }
}

/** 封筒は朝に調べて初めて読める。読んだ内容は伝聞カードとして携帯ノートに写る */
function readEnvelope(cycle: FacilityCycle): ActionResult {
  const s = cycle.subject;
  if (cycle.envelope.length === 0) return { ok: true, title: '寝台の下', lines: ['寝台の裏を探った。何も挟まっていない。'] };
  const firstRead = s.envelopeReadDay !== cycle.day;
  s.envelopeReadDay = cycle.day;
  if (firstRead) {
    for (const item of cycle.envelope) {
      addHearsay(s.notebook, item.text, '寝台下の封筒（筆跡）', cycle.day, `${item.writtenDay}日目の夜に書かれたもの`);
    }
  }
  return {
    ok: true,
    title: '寝台の下の封筒',
    lines: ['寝台の裏に、折り畳んだ紙が挟まっていた。', ...cycle.envelope.map((item) => `・${item.text}`)],
  };
}

export function answerSummons(state: GameState): void {
  const cycle = requireCycle(state);
  if (cycle.phase !== 'morning') return;
  const assignment = cycle.schedule[cycle.day - 1];
  cycle.phase = assignment?.trial ? 'summons' : 'slice_end';
}

export function summonsText(cycle: FacilityCycle): string[] {
  const a = cycle.schedule[cycle.day - 1];
  if (!a?.trial) return [...SLICE_END_LINES];
  return [`${cycle.subject.number}。${roomLabel(a.roomCode)}へ。`, '作業: 回収。'];
}

export function trialIdFor(cycle: FacilityCycle): string {
  return `${cycle.cycleId}:d${cycle.day}:pacing`;
}

export function beginTrial(state: GameState): PacingTrialState {
  const cycle = requireCycle(state);
  const trialId = trialIdFor(cycle);
  if (cycle.phase === 'trial' && cycle.trial?.trialId === trialId) return cycle.trial;
  if (cycle.phase !== 'summons') throw new Error(`cannot begin trial in phase ${cycle.phase}`);
  const assignment = cycle.schedule[cycle.day - 1];
  cycle.trial = createPacingTrial({
    trialId,
    subjectNumber: cycle.subject.number,
    day: cycle.day,
    researcher: assignment?.researcher ?? 'A',
    tolerance: cycle.params.pacingTolerance,
  });
  cycle.phase = 'trial';
  return cycle.trial;
}

/** 試験終了の判定。死亡なら死亡報告、生還・時間切れなら聴取へ進む */
export function resolveTrial(state: GameState): void {
  const cycle = requireCycle(state);
  const trial = cycle.trial;
  if (!trial || !trial.outcome) return;
  if (!once(cycle, `resolve:${trial.trialId}`)) return;
  const s = cycle.subject;
  const outcome = trial.outcome;
  for (const fact of trial.observed) if (!s.evidence.includes(fact)) s.evidence.push(fact);
  cycle.resolved = { trialId: trial.trialId, roomCode: trial.roomCode, outcome, observed: [...trial.observed] };
  cycle.trial = null;

  if (outcome.kind === 'death') {
    const report = buildReport(cycle, cycle.resolved);
    state.meta.archive.push(report);
    cycle.currentReport = report;
    cycle.phase = 'death_report';
    return;
  }

  for (const fact of trial.observed) addObservation(s.notebook, fact, cycle.day, trial.roomCode, s.number);
  applyDelta(s.stats, s.awarded, trialLedger(trial.trialId, outcome));
  cycle.interrogation = {
    trialId: trial.trialId,
    retrieved: outcome.kind === 'survived',
    observedThisTrial: [...trial.observed],
    subjectEvidence: [...s.evidence],
    memoAvailable: s.envelopeReadDay !== null && cycle.envelope.length > 0,
  };
  cycle.interrogationReply = null;
  cycle.phase = 'interrogation';
}

/** 試験結果の信用差分。回収・退出で+1、拒否・未達・時間切れは合計1まで-1 */
export function trialLedger(trialId: string, outcome: TrialOutcome): DeltaPart[] {
  const parts: DeltaPart[] = [];
  if (outcome.kind === 'survived') parts.push({ key: `credit:retrieve:${trialId}`, credit: 1 });
  const refused = outcome.instructions.some((rt) => rt.response === 'refuse');
  const unmet = outcome.instructions.some((rt) => rt.issuedTick !== null && !rt.achieved);
  if (outcome.kind === 'timeout' || refused || unmet) parts.push({ key: shortfallKey(trialId), credit: -1 });
  return parts;
}

function buildReport(cycle: FacilityCycle, resolved: ResolvedTrial): ArchivedReport {
  return buildTrialReport({
    cycleId: cycle.cycleId,
    facilityCode: cycle.facilityCode,
    day: cycle.day,
    subjectNumber: cycle.subject.number,
    roomCode: resolved.roomCode,
    outcome: resolved.outcome,
    observed: resolved.observed,
  });
}

export function interrogationOptions(cycle: FacilityCycle) {
  return cycle.interrogation ? availableOptions(cycle.interrogation) : [];
}

export function answerInterrogation(state: GameState, optionId: InterrogationOptionId): InterrogationResolution | null {
  const cycle = requireCycle(state);
  const ctx = cycle.interrogation;
  if (cycle.phase !== 'interrogation' || !ctx || !cycle.resolved) return null;
  if (!availableOptions(ctx).some((o) => o.id === optionId)) return null;
  if (!once(cycle, `interrogation:${ctx.trialId}`)) return null;
  const s = cycle.subject;
  const resolution = resolveOption(ctx, optionId);
  applyDelta(s.stats, s.awarded, resolution.parts);
  const notices: string[] = [];
  if (resolution.confiscateEnvelope) {
    cycle.envelope = [];
    notices.push('メモは没収された。');
  }
  const treatment = applySuspicionConsequences(cycle);
  notices.push(...(treatment.length > 0 ? treatment : suspicionNotices(s.stats.suspicion)));
  cycle.interrogationReply = resolution.reply;
  cycle.notices = notices;
  const report = buildReport(cycle, cycle.resolved);
  state.meta.archive.push(report);
  cycle.currentReport = report;
  cycle.interrogation = null;
  cycle.phase = 'report';
  return resolution;
}

/** S=3で記憶処理。直近1日の携帯写しを消し、S=1に戻す */
export function applySuspicionConsequences(cycle: FacilityCycle): string[] {
  const s = cycle.subject;
  if (s.stats.suspicion < 3) return [];
  if (!once(cycle, `memory:${s.subjectId}:d${cycle.day}:${cycle.phase}`)) return [];
  eraseRecentCopies(s.notebook, cycle.day);
  s.stats.suspicion = 1;
  return [...MEMORY_TREATMENT_LINES];
}

export function proceedToNight(state: GameState): void {
  const cycle = requireCycle(state);
  if (cycle.phase !== 'report') return;
  cycle.phase = 'night';
  cycle.notices = [];
}

export function nightAction(state: GameState, action: NightAction): ActionResult {
  const cycle = requireCycle(state);
  if (cycle.phase !== 'night') return { ok: false, title: '', lines: ['今は行えない。'] };
  if (nightSlotsLeft(cycle) <= 0) return { ok: false, title: '', lines: ['消灯の時間だ。'] };
  cycle.subject.nightSlotsUsed += 1;
  switch (action) {
    case 'cellmate':
      return talkToCellmate(cycle, NIGHT_CELLMATE);
    case 'safe_task': {
      const s = cycle.subject;
      applyDelta(s.stats, s.awarded, [
        { key: `credit:safe_task:d${cycle.day}`, credit: 1 },
        { key: `suspicion:safe_task:d${cycle.day}`, suspicion: -1 },
      ]);
      return { ok: true, title: SAFE_TASK.title, lines: [...SAFE_TASK.lines, ...applySuspicionConsequences(cycle)] };
    }
  }
}

export interface EnvelopeSelection {
  entryId?: string;
  freeText?: string;
}

/** 夜に携帯ノートから合計3件まで封筒へ複写する。行動枠を1つ使う */
export function copyToEnvelope(state: GameState, selections: readonly EnvelopeSelection[]): ActionResult {
  const cycle = requireCycle(state);
  if (cycle.phase !== 'night') return { ok: false, title: '', lines: ['今は行えない。'] };
  if (nightSlotsLeft(cycle) <= 0) return { ok: false, title: '', lines: ['消灯の時間だ。'] };
  const items: EnvelopeItem[] = [];
  const push = (source: EnvelopeItem['source'], text: string) =>
    items.push({ id: `e${cycle.day}-${cycle.envelope.length + items.length}`, source, text, writtenDay: cycle.day });
  for (const sel of selections.slice(0, DAY.envelopeCapacity)) {
    if (sel.entryId) {
      const entry = findEntry(cycle.subject.notebook, sel.entryId);
      if (!entry || entry.kind === 'erased') continue;
      const text = envelopeTextFor(entry, roomLabel);
      if (text) push(entry.kind, text);
    } else if (sel.freeText && sel.freeText.trim()) {
      push('free', sel.freeText.trim().slice(0, FREE_TEXT_LIMIT));
    }
  }
  if (items.length === 0) return { ok: false, title: '', lines: ['写す内容が選ばれていない。'] };
  cycle.subject.nightSlotsUsed += 1;
  cycle.envelope.push(...items);
  return { ok: true, title: '寝台の下', lines: [`${items.length}件を紙に写し、封筒に入れて寝台の裏へ挟んだ。`] };
}

/** 就寝。翌朝へ進む。7日目の夜以降の最終評価は縦切り範囲外 */
export function sleep(state: GameState): void {
  const cycle = requireCycle(state);
  if (cycle.phase !== 'night') return;
  if (!once(cycle, `sleep:d${cycle.day}`)) return;
  if (cycle.day >= DAY.cycleLength) {
    cycle.phase = 'slice_end';
    return;
  }
  advanceDay(cycle);
}

function advanceDay(cycle: FacilityCycle): void {
  cycle.day += 1;
  cycle.phase = 'morning';
  cycle.resolved = null;
  cycle.currentReport = null;
  cycle.interrogationReply = null;
  cycle.notices = [];
  ensureSlotDay(cycle.subject, cycle.day);
  resolveDeferredForMorning(cycle);
}

function resolveDeferredForMorning(cycle: FacilityCycle): void {
  for (const ev of cycle.deferred) {
    if (ev.status !== 'pending' || ev.resolvePhase !== 'morning' || ev.resolveDay !== cycle.day) continue;
    if (ev.subjectId !== cycle.subject.subjectId) {
      ev.status = 'cancelled';
      continue;
    }
    if (once(cycle, `deferred:${ev.id}`)) ev.status = 'resolved';
  }
}

/**
 * 死亡報告の確認後。日付を1つだけ進め、新しい被験者が同じ寝台に入る。
 * seed・変動パラメータ・封筒は保持し、C/S/E・携帯ノート・所持品・個人効果は引き継がない。
 */
export function acknowledgeDeath(state: GameState): void {
  const cycle = requireCycle(state);
  if (cycle.phase !== 'death_report' || !cycle.resolved) return;
  if (!once(cycle, `death:${cycle.resolved.trialId}`)) return;
  const dead = cycle.subject;
  for (const ev of cycle.deferred) {
    if (ev.subjectId === dead.subjectId && ev.status === 'pending') ev.status = 'cancelled';
  }
  if (cycle.day >= DAY.cycleLength) {
    cycle.ending = decideEnding({ escapeAttempt: false, diedOnFinalDay: true, finalTaskSurvived: false, stats: dead.stats });
    cycle.phase = 'ended';
    return;
  }
  cycle.subjectSerial += 1;
  cycle.subject = createSubject(cycle.seed, cycle.subjectSerial, cycle.day + 1);
  advanceDay(cycle);
}

export interface EndingInput {
  escapeAttempt: boolean;
  diedOnFinalDay: boolean;
  finalTaskSurvived: boolean;
  stats: Stats;
}

/** 終了判定表（仕様案8.2）。該当する最初の1件だけを返す。縦切りでは7日目に到達しない */
export function decideEnding(input: EndingInput): EndingKind {
  if (input.escapeAttempt) return 'escape_attempt';
  if (input.diedOnFinalDay) return 'disposal_no_replacement';
  const { evaluation, credit, suspicion } = input.stats;
  if (input.finalTaskSurvived && evaluation >= 2 && credit >= 2 && suspicion <= 1) return 'useful';
  return 'disposal';
}
