// 歩調（通路試験）の実行仕様。MVP仕様案 7.A と 3.2・3.3 に対応する。
// 状態はすべて保存可能な素のデータで持ち、固定刻みで進める。
// 時計は浮動小数の誤差で境界判定がずれないよう、刻み数で数える。

import { FACTS, type FactId } from './facts';
import {
  PACING_INSTRUCTIONS,
  PACING_LINES,
  instructionText,
  type InstructionDef,
  type ResearcherId,
  type ResponseKind,
} from './instructions';
import { PACING, SIM_DT, SPEED } from './params';

export type MoveMode = 'still' | 'slow' | 'normal' | 'run';
export type FollowerState = 'follow' | 'approach' | 'retreat';
export type ReleaseKind = 'stop' | 'slow';
export type TrialOutcomeKind = 'survived' | 'death' | 'timeout';

export const TICKS = {
  dangerLimit: secondsToTicks(PACING.dangerLimit),
  stopRelease: secondsToTicks(PACING.stopReleaseHold),
  slowRelease: secondsToTicks(PACING.slowReleaseHold),
  retreat: secondsToTicks(PACING.retreatDuration),
  deadline: secondsToTicks(PACING.deadline),
  deadlineWarning: secondsToTicks(PACING.deadline - PACING.deadlineWarningBefore),
  stopSilence: secondsToTicks(0.25),
  normalSteady: secondsToTicks(3),
  responseWindow: secondsToTicks(PACING.responseWindow),
} as const;

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds / SIM_DT);
}

export function ticksToSeconds(ticks: number): number {
  return ticks * SIM_DT;
}

export interface TrialInput {
  /** -1〜1。斜め入力は正規化する */
  moveX: number;
  moveY: number;
  run: boolean;
  /** 保持式・切替式を解決した後の低速指定 */
  slow: boolean;
  /** 視線の向き（ラジアン、画面座標。yは下向き） */
  facing: number;
  /** この刻みで「調べる」が押されたか */
  interact: boolean;
  /** この刻みで選ばれたインターホン返答 */
  response: ResponseKind | null;
}

export const IDLE_INPUT: TrialInput = {
  moveX: 0,
  moveY: 0,
  run: false,
  slow: false,
  facing: 0,
  interact: false,
  response: null,
};

export interface InstructionRuntime {
  id: string;
  scheduledTick: number | null;
  issuedTick: number | null;
  response: Exclude<ResponseKind, 'question'> | null;
  questioned: boolean;
  achieved: boolean;
}

export interface ModeChange {
  tick: number;
  mode: MoveMode;
}

export interface TrialOutcome {
  kind: TrialOutcomeKind;
  tick: number;
  hasBox: boolean;
  /** 死亡直前の移動様式と、その継続刻み数 */
  lastMode: MoveMode;
  lastModeTicks: number;
  leg: 'outbound' | 'return';
  instructions: InstructionRuntime[];
}

export type SimEvent =
  | { kind: 'step'; tick: number; source: 'player' | 'follower'; x: number; y: number; loudness: number; phase: FollowerState }
  | { kind: 'approach_start'; tick: number; x: number; y: number; cause: MoveMode }
  | { kind: 'release_hold'; tick: number; by: ReleaseKind }
  | { kind: 'retreat_start'; tick: number; by: ReleaseKind; x: number; y: number }
  | { kind: 'follow_resume'; tick: number }
  | { kind: 'intercom'; tick: number; speaker: ResearcherId; text: string; instructionId: string | null; respondable: boolean }
  | { kind: 'pickup'; tick: number }
  | { kind: 'examine'; tick: number; target: InteractTarget }
  | { kind: 'observe'; tick: number; fact: FactId }
  | { kind: 'door_locked'; tick: number }
  | { kind: 'end'; tick: number; outcome: TrialOutcomeKind };

export type InteractTarget = 'box' | 'slip' | 'camera' | 'lines' | 'scuff' | 'door';

export interface PacingTrialState {
  version: 1;
  trialId: string;
  subjectNumber: string;
  day: number;
  roomCode: string;
  researcher: ResearcherId;
  tolerance: number;
  tick: number;
  player: {
    x: number;
    y: number;
    facing: number;
    hasBox: boolean;
    speed: number;
    mode: MoveMode;
    /** 最後に移動した方向。追従者の「背後」を決める */
    lastDirX: number;
    lastDirY: number;
    stepDistance: number;
    stillTicks: number;
    normalTicks: number;
  };
  follower: {
    state: FollowerState;
    clockTicks: number;
    stopTicks: number;
    slowTicks: number;
    retreatTicks: number;
    retreatFromDistance: number;
    pendingStepTick: number | null;
    stepTimer: number;
    lastHeardTick: number | null;
    doorLockNotified: boolean;
  };
  instructions: InstructionRuntime[];
  runAttempt: boolean;
  deadlineWarned: boolean;
  doorWithoutBoxNotified: boolean;
  observed: FactId[];
  modeLog: ModeChange[];
  outcome: TrialOutcome | null;
  /** 表示層へ渡す未処理の出来事。保存対象外 */
  events: SimEvent[];
}

export interface CreateTrialOptions {
  trialId: string;
  subjectNumber: string;
  day: number;
  researcher: ResearcherId;
  tolerance: number;
}

export function createPacingTrial(options: CreateTrialOptions): PacingTrialState {
  const state: PacingTrialState = {
    version: 1,
    trialId: options.trialId,
    subjectNumber: options.subjectNumber,
    day: options.day,
    roomCode: PACING.roomCode,
    researcher: options.researcher,
    tolerance: options.tolerance,
    tick: 0,
    player: {
      x: PACING.startX,
      y: 0,
      facing: 0,
      hasBox: false,
      speed: 0,
      mode: 'still',
      lastDirX: 1,
      lastDirY: 0,
      stepDistance: 0,
      stillTicks: 0,
      normalTicks: 0,
    },
    follower: {
      state: 'follow',
      clockTicks: 0,
      stopTicks: 0,
      slowTicks: 0,
      retreatTicks: 0,
      retreatFromDistance: PACING.followDistance,
      pendingStepTick: null,
      stepTimer: 0,
      lastHeardTick: null,
      doorLockNotified: false,
    },
    instructions: PACING_INSTRUCTIONS.filter((d) => d.speaker === options.researcher).map((d) => ({
      id: d.id,
      scheduledTick: d.trigger === 'trialStart' ? 0 : null,
      issuedTick: null,
      response: null,
      questioned: false,
      achieved: false,
    })),
    runAttempt: false,
    deadlineWarned: false,
    doorWithoutBoxNotified: false,
    observed: [],
    modeLog: [{ tick: 0, mode: 'still' }],
    outcome: null,
    events: [],
  };
  issueDueInstructions(state);
  return state;
}

function instructionDef(id: string): InstructionDef {
  const def = PACING_INSTRUCTIONS.find((d) => d.id === id);
  if (!def) throw new Error(`unknown instruction ${id}`);
  return def;
}

/** 1刻み進める。状態を直接書き換える */
export function stepTrial(state: PacingTrialState, input: TrialInput): void {
  if (state.outcome) return;
  state.tick += 1;

  issueDueInstructions(state);
  const prevX = state.player.x;
  movePlayer(state, input);
  handleInteraction(state, input);
  handleResponse(state, input.response);
  playerFootsteps(state);
  observeStill(state);

  // 仕様案3.3の順: 解除入力 → 危険状態更新 → 致死判定 → 退出判定
  updateFollower(state);
  if (state.follower.state === 'approach' && state.follower.clockTicks >= TICKS.dangerLimit) {
    finish(state, 'death');
    return;
  }
  if (checkExit(state)) return;

  trackRunSegment(state, prevX);
  followerFootsteps(state);

  if (!state.deadlineWarned && state.tick >= TICKS.deadlineWarning) {
    state.deadlineWarned = true;
    pushIntercom(state, PACING_LINES.warning, null, false);
  }
  if (state.tick >= TICKS.deadline) {
    observe(state, 'pacing.timeout');
    pushIntercom(state, PACING_LINES.timeout, null, false);
    finish(state, 'timeout');
  }
}

function issueDueInstructions(state: PacingTrialState): void {
  for (const rt of state.instructions) {
    if (rt.issuedTick !== null || rt.scheduledTick === null || rt.scheduledTick > state.tick) continue;
    rt.issuedTick = state.tick;
    const def = instructionDef(rt.id);
    pushIntercom(state, instructionText(def, state.subjectNumber), def.id, true);
  }
}

function pushIntercom(state: PacingTrialState, text: string, instructionId: string | null, respondable: boolean): void {
  state.events.push({ kind: 'intercom', tick: state.tick, speaker: state.researcher, text, instructionId, respondable });
}

export function resolveMoveMode(input: TrialInput): MoveMode {
  if (input.moveX === 0 && input.moveY === 0) return 'still';
  if (input.slow) return 'slow';
  if (input.run) return 'run';
  return 'normal';
}

function classifySpeed(speed: number): MoveMode {
  if (speed < PACING.stopSpeedEpsilon) return 'still';
  if (speed <= SPEED.slow + 1e-6) return 'slow';
  if (speed <= SPEED.normal + 1e-6) return 'normal';
  return 'run';
}

function movePlayer(state: PacingTrialState, input: TrialInput): void {
  const p = state.player;
  p.facing = input.facing;
  const intended = resolveMoveMode(input);
  let dx = 0;
  let dy = 0;
  if (intended !== 'still') {
    const len = Math.hypot(input.moveX, input.moveY);
    const speed = SPEED[intended];
    dx = (input.moveX / len) * speed * SIM_DT;
    dy = (input.moveY / len) * speed * SIM_DT;
  }
  const minX = PACING.playerRadius;
  const maxX = PACING.corridorLength - PACING.playerRadius;
  const maxY = PACING.corridorHalfWidth - PACING.playerRadius;
  const nx = clamp(p.x + dx, minX, maxX);
  const ny = clamp(p.y + dy, -maxY, maxY);
  const moved = Math.hypot(nx - p.x, ny - p.y);
  if (moved > 0) {
    p.lastDirX = (nx - p.x) / moved;
    p.lastDirY = (ny - p.y) / moved;
  }
  p.x = nx;
  p.y = ny;
  p.speed = moved / SIM_DT;
  p.stepDistance += moved;

  // 壁に押し付けた場合も含め、実際の移動量で速度を判定する
  const mode = classifySpeed(p.speed);
  if (mode !== p.mode) {
    p.mode = mode;
    state.modeLog.push({ tick: state.tick, mode });
    if (state.modeLog.length > 16) state.modeLog.shift();
  }
}

export function interactTarget(state: PacingTrialState): InteractTarget | null {
  const p = state.player;
  const near = (x: number, y: number, r: number = PACING.interactRange) => Math.hypot(p.x - x, p.y - y) <= r;
  if (!p.hasBox && near(PACING.boxX, 0)) return 'box';
  if (near(PACING.slipX, PACING.slipY, 0.9)) return 'slip';
  if (near(PACING.cameraX, -PACING.corridorHalfWidth, 1.4)) return 'camera';
  if (Math.abs(p.x - PACING.redLineX) < 0.6 || Math.abs(p.x - PACING.blueLineX) < 0.6) return 'lines';
  if (PACING.scuffMarks.some((x) => Math.abs(p.x - x) < 0.6) && Math.abs(p.y) < 0.9) return 'scuff';
  if (p.x <= PACING.exitX + 0.6) return 'door';
  return null;
}

function handleInteraction(state: PacingTrialState, input: TrialInput): void {
  if (!input.interact) return;
  const target = interactTarget(state);
  if (!target) return;
  state.events.push({ kind: 'examine', tick: state.tick, target });
  switch (target) {
    case 'box': {
      state.player.hasBox = true;
      state.events.push({ kind: 'pickup', tick: state.tick });
      for (const rt of state.instructions) {
        const def = instructionDef(rt.id);
        if (def.trigger === 'boxAcquired' && rt.scheduledTick === null) {
          rt.scheduledTick = state.tick + secondsToTicks(def.delay);
        }
      }
      break;
    }
    case 'slip':
      observe(state, 'pacing.slip');
      break;
    case 'camera':
      observe(state, 'pacing.camera');
      break;
    case 'lines':
      observe(state, 'pacing.lines');
      break;
    case 'scuff':
      observe(state, 'pacing.scuff');
      break;
    case 'door':
      if (!state.player.hasBox && !state.doorWithoutBoxNotified) {
        state.doorWithoutBoxNotified = true;
        pushIntercom(state, PACING_LINES.doorWithoutBox, null, false);
      }
      break;
  }
}

/** 返答を受け付けている指示。最後に発話された指示で、受付時間内のもの */
export function openInstruction(state: PacingTrialState): InstructionRuntime | null {
  let latest: InstructionRuntime | null = null;
  for (const rt of state.instructions) {
    if (rt.issuedTick === null) continue;
    if (!latest || (latest.issuedTick ?? -1) < rt.issuedTick) latest = rt;
  }
  if (!latest || latest.issuedTick === null) return null;
  if (state.tick - latest.issuedTick > TICKS.responseWindow) return null;
  if (latest.response !== null && latest.questioned) return null;
  return latest;
}

export function availableResponses(state: PacingTrialState): ResponseKind[] {
  const rt = openInstruction(state);
  if (!rt) return [];
  const list: ResponseKind[] = [];
  if (rt.response === null) list.push('comply', 'delay', 'refuse');
  if (!rt.questioned) list.push('question');
  return list;
}

function handleResponse(state: PacingTrialState, response: ResponseKind | null): void {
  if (!response) return;
  const rt = openInstruction(state);
  if (!rt || !availableResponses(state).includes(response)) return;
  const def = instructionDef(rt.id);
  if (response === 'question') {
    // 質問は指示ごとに1回。繰り返しても応答・時間・信用は増えない
    rt.questioned = true;
  } else {
    rt.response = response;
  }
  const reply = def.replies[response];
  if (reply) pushIntercom(state, reply, null, false);
}

function playerFootsteps(state: PacingTrialState): void {
  const p = state.player;
  if (p.mode === 'still') return;
  while (p.stepDistance >= PACING.stepLength) {
    p.stepDistance -= PACING.stepLength;
    state.events.push({ kind: 'step', tick: state.tick, source: 'player', x: p.x, y: p.y, loudness: stepLoudness(p.mode), phase: state.follower.state });
    if (state.follower.state === 'follow') {
      // 自分の足音から半拍遅れて重なる
      const interval = PACING.stepLength / Math.max(p.speed, SPEED.slow);
      state.follower.pendingStepTick = state.tick + Math.max(1, secondsToTicks(interval / 2));
    }
  }
}

function stepLoudness(mode: MoveMode): number {
  switch (mode) {
    case 'slow':
      return 0.25;
    case 'normal':
      return 0.4;
    case 'run':
      return 0.6;
    default:
      return 0;
  }
}

function observeStill(state: PacingTrialState): void {
  const p = state.player;
  if (p.mode === 'still') {
    p.stillTicks += 1;
    const heard = state.follower.lastHeardTick;
    if (
      state.follower.state === 'follow' &&
      p.stillTicks === TICKS.stopSilence &&
      heard !== null &&
      state.tick - heard <= secondsToTicks(1.5)
    ) {
      observe(state, 'pacing.stop_silence');
    }
  } else {
    p.stillTicks = 0;
  }
  if (p.mode === 'normal' && state.follower.state === 'follow') {
    p.normalTicks += 1;
    if (p.normalTicks === TICKS.normalSteady && state.follower.lastHeardTick !== null) {
      observe(state, 'pacing.normal_steady');
    }
  } else {
    p.normalTicks = 0;
  }
}

function updateFollower(state: PacingTrialState): void {
  const f = state.follower;
  const p = state.player;
  const exceeding = p.speed > state.tolerance + 1e-6;
  const stopped = p.mode === 'still';
  const slowMoving = p.mode === 'slow';

  switch (f.state) {
    case 'follow':
      if (exceeding) enterApproach(state);
      break;
    case 'approach': {
      // 解除入力の継続中は危険時計を止める。途中で破棄すると元の値から再開する
      if (stopped) {
        f.stopTicks += 1;
        f.slowTicks = 0;
      } else if (slowMoving) {
        f.slowTicks += 1;
        f.stopTicks = 0;
      } else {
        f.stopTicks = 0;
        f.slowTicks = 0;
      }
      if ((stopped && f.stopTicks === 1) || (slowMoving && f.slowTicks === 1)) {
        state.events.push({ kind: 'release_hold', tick: state.tick, by: stopped ? 'stop' : 'slow' });
      }
      if (f.stopTicks >= TICKS.stopRelease) {
        enterRetreat(state, 'stop');
      } else if (f.slowTicks >= TICKS.slowRelease) {
        enterRetreat(state, 'slow');
      } else if (!stopped && !slowMoving) {
        f.clockTicks += 1;
      }
      break;
    }
    case 'retreat':
      if (exceeding) {
        // 後退を中断し、新しい前兆付きの接近へ戻す
        enterApproach(state);
        break;
      }
      f.retreatTicks += 1;
      if (f.retreatTicks >= TICKS.retreat) {
        f.state = 'follow';
        f.clockTicks = 0;
        f.retreatTicks = 0;
        f.doorLockNotified = false;
        state.events.push({ kind: 'follow_resume', tick: state.tick });
      }
      break;
  }
}

function enterApproach(state: PacingTrialState): void {
  const f = state.follower;
  f.state = 'approach';
  // 新しい前兆の後には、毎回同じ猶予を与える（仕様案3.2-3）
  f.clockTicks = 0;
  f.stopTicks = 0;
  f.slowTicks = 0;
  f.retreatTicks = 0;
  f.pendingStepTick = null;
  f.stepTimer = 0;
  const pos = followerPosition(state);
  const cause = state.player.mode;
  state.events.push({ kind: 'approach_start', tick: state.tick, x: pos.x, y: pos.y, cause });
  emitFollowerStep(state, 0.85);
  observe(state, cause === 'run' ? 'pacing.approach.run' : 'pacing.approach.normal');
}

function enterRetreat(state: PacingTrialState, by: ReleaseKind): void {
  const f = state.follower;
  f.retreatFromDistance = followerDistance(state);
  f.state = 'retreat';
  f.retreatTicks = 0;
  f.stopTicks = 0;
  f.slowTicks = 0;
  f.stepTimer = 0;
  const pos = followerPosition(state);
  state.events.push({ kind: 'retreat_start', tick: state.tick, by, x: pos.x, y: pos.y });
  observe(state, by === 'stop' ? 'pacing.retreat.stop' : 'pacing.retreat.slow');
}

export function followerDistance(state: PacingTrialState): number {
  const f = state.follower;
  switch (f.state) {
    case 'follow':
      return PACING.followDistance;
    case 'approach':
      return Math.max(0.4, PACING.followDistance * (1 - f.clockTicks / TICKS.dangerLimit));
    case 'retreat': {
      const t = f.retreatTicks / TICKS.retreat;
      return f.retreatFromDistance + (PACING.followDistance - f.retreatFromDistance) * t;
    }
  }
}

/** 追従者の位置。最後に移動した方向の背後に置く。姿は描かず、音と埃の位置だけに使う */
export function followerPosition(state: PacingTrialState): { x: number; y: number } {
  const p = state.player;
  const d = followerDistance(state);
  return {
    x: clamp(p.x - p.lastDirX * d, 0.2, PACING.corridorLength - 0.2),
    y: clamp(p.y - p.lastDirY * d, -PACING.corridorHalfWidth + 0.2, PACING.corridorHalfWidth - 0.2),
  };
}

function emitFollowerStep(state: PacingTrialState, loudness: number): void {
  const pos = followerPosition(state);
  state.events.push({ kind: 'step', tick: state.tick, source: 'follower', x: pos.x, y: pos.y, loudness, phase: state.follower.state });
  state.follower.lastHeardTick = state.tick;
  // 振り返っても効果は変わらない。視界内なら足音に合わせて埃だけが見える
  if (isInViewCone(state, pos.x, pos.y)) observe(state, 'pacing.look_back');
}

function followerFootsteps(state: PacingTrialState): void {
  const f = state.follower;
  const p = state.player;
  const emit = (loudness: number) => emitFollowerStep(state, loudness);

  switch (f.state) {
    case 'follow':
      if (f.pendingStepTick !== null && state.tick >= f.pendingStepTick) {
        f.pendingStepTick = null;
        // 被験者が止まっていれば、もう一つの足音も鳴らない
        if (p.mode !== 'still') {
          emit(0.45);
          observe(state, 'pacing.echo');
        }
      }
      break;
    case 'approach': {
      const releasing = p.mode === 'still' || p.mode === 'slow';
      if (releasing) break;
      const progress = f.clockTicks / TICKS.dangerLimit;
      const interval = 0.32 - 0.2 * progress;
      f.stepTimer += SIM_DT;
      if (f.stepTimer >= interval) {
        f.stepTimer -= interval;
        emit(0.6 + 0.4 * progress);
      }
      break;
    }
    case 'retreat': {
      const progress = f.retreatTicks / TICKS.retreat;
      f.stepTimer += SIM_DT;
      if (f.stepTimer >= 0.28) {
        f.stepTimer -= 0.28;
        emit(0.55 * (1 - progress) + 0.05);
      }
      break;
    }
  }
}

const VIEW_HALF_ANGLE = (50 * Math.PI) / 180;
export const VIEW_RADIUS = 9;

export function isInViewCone(state: PacingTrialState, x: number, y: number): boolean {
  const p = state.player;
  const dx = x - p.x;
  const dy = y - p.y;
  const dist = Math.hypot(dx, dy);
  if (dist > VIEW_RADIUS) return false;
  if (dist < 0.6) return true;
  return Math.abs(angleDiff(Math.atan2(dy, dx), p.facing)) <= VIEW_HALF_ANGLE;
}

function checkExit(state: PacingTrialState): boolean {
  const p = state.player;
  if (!p.hasBox || p.x > PACING.exitX) return false;
  if (state.follower.state === 'approach') {
    // 未解除の危険を持ったまま出口へ触れても生還扱いにしない
    if (!state.follower.doorLockNotified) {
      state.follower.doorLockNotified = true;
      state.events.push({ kind: 'door_locked', tick: state.tick });
    }
    return false;
  }
  const brief = state.instructions.find((rt) => instructionDef(rt.id).completion === 'retrieveAndExit');
  if (brief) brief.achieved = true;
  pushIntercom(state, PACING_LINES.exitOk, null, false);
  finish(state, 'survived');
  return true;
}

function trackRunSegment(state: PacingTrialState, prevX: number): void {
  const rt = state.instructions.find((r) => instructionDef(r.id).completion === 'runSegment');
  if (!rt || rt.issuedTick === null || rt.achieved) return;
  const p = state.player;
  const runningLeft = p.speed >= PACING.runningSpeedMin && p.x < prevX;
  const red = PACING.redLineX;
  const blue = PACING.blueLineX;
  if (!state.runAttempt) {
    if (runningLeft && p.x <= red && p.x >= red - PACING.runStartSlack) state.runAttempt = true;
    return;
  }
  if (p.x <= blue) {
    rt.achieved = true;
    state.runAttempt = false;
    return;
  }
  if (!runningLeft || p.x > red) state.runAttempt = false;
}

function observe(state: PacingTrialState, fact: FactId): void {
  if (state.observed.includes(fact)) return;
  state.observed.push(fact);
  state.events.push({ kind: 'observe', tick: state.tick, fact });
}

function finish(state: PacingTrialState, kind: TrialOutcomeKind): void {
  const last = state.modeLog[state.modeLog.length - 1] ?? { tick: 0, mode: 'still' as MoveMode };
  state.outcome = {
    kind,
    tick: state.tick,
    hasBox: state.player.hasBox,
    lastMode: last.mode,
    lastModeTicks: state.tick - last.tick,
    leg: state.player.hasBox ? 'return' : 'outbound',
    instructions: state.instructions.map((rt) => ({ ...rt })),
  };
  state.events.push({ kind: 'end', tick: state.tick, outcome: kind });
}

export function remainingSeconds(state: PacingTrialState): number {
  return Math.max(0, ticksToSeconds(TICKS.deadline - state.tick));
}

/** 保存用。表示層向けの出来事キューは含めない */
export function serializeTrial(state: PacingTrialState): PacingTrialState {
  return structuredClone({ ...state, events: [] });
}

export function factExists(id: string): id is FactId {
  return id in FACTS;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
