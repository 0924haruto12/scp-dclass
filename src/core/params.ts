// 試作用の初期値。MVP仕様案 draft 0.1 の仮置き値をそのまま写したもので、
// 実測・プレイテストで検証した値ではない。

export const SIM_DT = 1 / 60;

export const SPEED = {
  slow: 1,
  normal: 2,
  run: 4,
} as const;

export const PACING = {
  roomCode: 'T-03',
  corridorLength: 24,
  corridorHalfWidth: 1.5,
  playerRadius: 0.3,
  startX: 1.2,
  boxX: 23.2,
  exitX: 0.8,
  interactRange: 1.3,

  deadline: 120,
  deadlineWarningBefore: 10,

  toleranceOptions: [1.5, 2.5] as const,
  firstFixedTolerance: 2.5,

  dangerLimit: 3,
  stopReleaseHold: 0.5,
  slowReleaseHold: 1,
  retreatDuration: 1,

  /** 停止とみなす実測速度の上限 */
  stopSpeedEpsilon: 0.05,
  /** 足音1歩あたりの移動距離 */
  stepLength: 0.7,
  followDistance: 5,

  /** 帰路の負荷指示区間。赤線から青線へ向かって走る */
  redLineX: 16,
  blueLineX: 8,
  /** 赤線を越えてから走り始めても試行開始とみなす幅 */
  runStartSlack: 1,
  /** 指示達成の判定で「走行」とみなす実測速度の下限 */
  runningSpeedMin: 3,
  runOrderDelay: 1,
  responseWindow: 10,

  scuffMarks: [3, 5.5, 8, 10.5, 13, 15.5, 18, 20.5],
  slipX: 12.4,
  slipY: -1.0,
  cameraX: 12,
  speakerX: 2.2,
} as const;

export const STATS = {
  min: 0,
  max: 3,
} as const;

export const DAY = {
  morningSlots: 2,
  nightSlots: 2,
  envelopeCapacity: 3,
  cycleLength: 7,
} as const;

/** 初回サイクルで使う固定seed。歩調の許容速度が2.5になる値を選ぶ */
export const FIRST_FIXED_SEED = 20261025;
