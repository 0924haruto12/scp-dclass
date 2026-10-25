// 試作用の初期値。実測値ではない。
// 距離は「距離単位」、時間は秒。描画側で 1 単位 = 52px 前後に対応させる。

export const BASE_SPEED = Object.freeze({
  slow: 1,
  normal: 2,
  run: 4,
});

export const GAIT = Object.freeze({
  contactSeconds: 3,
  stopClearSeconds: 0.5,
  slowClearSeconds: 1,
  backoffSeconds: 1,
  deadlineSeconds: 120,
  deadlineWarningSeconds: 10,
});

export const ROOM = Object.freeze({
  minX: 0,
  maxX: 24,
  playerMinX: 0.6,
  playerMaxX: 23.4,
  halfWidth: 1.8,
  playerHalfWidth: 1.5,
  startX: 1,
  exitX: 1.2,
  boxX: 23,
  redLineX: 9,
  blueLineX: 1,
  collectRadius: 0.8,
});

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'need-to-know.save.v1';

export const FACILITY_CODE = 'SITE-12';
