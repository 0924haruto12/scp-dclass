import { FACILITY_CODE, SAVE_VERSION } from './constants.js';
import { createTrial } from './footstep.js';
import {
  applyTrialResult,
  clampStat,
  evaluateEnding,
  movementLabel,
  resolveInterview,
  safeWorkReward,
} from './progress.js';
import { hashSeed, rngFrom, trialSeed } from './rng.js';

// 施設サイクル・被験者・ノート・保存データの遷移。
// 判定は progress.js / footstep.js に置き、ここでは記録と画面遷移だけを扱う。

export function createGame({ seed, now = Date.now(), firstCycle = true, reports = [] } = {}) {
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    cycle: createCycle({ seed, number: 1, firstCycle }),
    subject: createSubject(1),
    trial: null,
    interview: null,
    pendingDeath: null,
    reports: [...reports],
    noteSeq: 1,
    settings: { captions: true, volume: 0.55 },
  };
}

export function createCycle({ seed, number = 1, firstCycle = true }) {
  const rng = rngFrom(`${seed}:cycle:${number}`);
  const tolerance = firstCycle ? 2.5 : rng.pick([1.5, 2.5]);
  return {
    id: `C-${String(number).padStart(3, '0')}`,
    number,
    seed,
    tolerance,
    facility: FACILITY_CODE,
    day: 1,
    phase: 'morning',
    subjectSerial: 1,
    envelope: {
      items: [],
      readableOn: 0,
      read: false,
      confiscated: false,
      sealedDay: null,
    },
    slots: { morning: 2, night: 2 },
    flags: { supervisorBadge: false, escapeAttempted: false },
    dailySafeWorkDone: false,
    ending: null,
    lastMemoryProcessingDay: null,
    lastClear: null,
  };
}

export function createSubject(serial) {
  return {
    id: `S-${serial}`,
    number: `D-${9341 + serial - 1}`,
    serial,
    C: 0,
    S: 0,
    E: 0,
    observations: [],
    hearsays: [],
    hypotheses: [],
    eDays: [],
    lastTrialCredit: 0,
  };
}

export function beginTrial(game) {
  if (game.cycle.phase !== 'morning') return null;
  const day = game.cycle.day;
  const trial = createTrial({
    tolerance: game.cycle.tolerance,
    seed: trialSeed(game.cycle.seed, day),
    day,
    subjectNumber: game.subject.number,
    speaker: day >= 4 ? '研究員B' : '研究員A',
  });
  game.trial = trial;
  game.cycle.phase = 'trial';
  game.cycle.slots.morning = 0;
  return trial;
}

export function completeTrial(game) {
  const trial = game.trial;
  if (!trial?.outcome) return null;

  if (trial.outcome !== 'died') addTrialFindings(game, trial);
  const applied = applyTrialResult(game);
  const report = buildTrialReport(game, trial, applied);
  game.reports.push(report);
  game.subject.lastTrialCredit = applied.credit;

  if (trial.outcome === 'died') {
    game.pendingDeath = report;
    game.cycle.phase = 'death';
  } else {
    game.cycle.phase = 'interview';
    game.cycle.slots.night = 2;
  }
  return report;
}

export function submitInterview(game, choice) {
  if (game.cycle.phase !== 'interview') return null;
  const result = resolveInterview(game, choice);
  if (!result) return null;

  if (result.memoryProcessed) {
    game.reports.push(
      makeReport(game, {
        kind: 'memory',
        title: `第${game.cycle.day}日 記憶処理記録`,
        lines: [
          `対象: ${game.subject.number}`,
          '直近1日の携帯ノート写しを消去。',
          '封筒とプレイヤー向け事後報告履歴は保持。',
        ],
      }),
    );
  }

  game.cycle.phase = 'night';
  game.cycle.slots.night = 2;
  game.cycle.dailySafeWorkDone = false;
  return result;
}

export function continueAfterDeath(game) {
  if (game.cycle.phase !== 'death') return null;
  if (game.cycle.day >= 7) {
    return { ending: finishCycle(game, 'day7-death') };
  }

  game.cycle.day += 1;
  game.cycle.subjectSerial += 1;
  game.subject = createSubject(game.cycle.subjectSerial);
  game.cycle.phase = 'morning';
  game.cycle.slots = { morning: 2, night: 2 };
  game.cycle.dailySafeWorkDone = false;
  game.trial = null;
  game.interview = null;
  game.pendingDeath = null;
  return { ending: null };
}

export function envelopeReadable(game) {
  const envelope = game.cycle.envelope;
  return (
    envelope.items.length > 0 &&
    !envelope.confiscated &&
    game.cycle.day >= envelope.readableOn
  );
}

export function collectibleNotes(game) {
  const subject = game.subject;
  return [
    ...subject.observations.map((card) => ({ ...card, source: 'observation' })),
    ...subject.hearsays.map((card) => ({ ...card, source: 'hearsay' })),
    ...subject.hypotheses
      .filter((card) => !card.cleared)
      .map((card) => ({ ...card, source: 'hypothesis', text: card.title || '（無題の仮説）' })),
  ];
}

export function copyToEnvelope(game, ids = []) {
  if (game.cycle.phase !== 'night') return { ok: false, reason: 'night-only' };
  if (game.cycle.slots.night <= 0) return { ok: false, reason: 'no-slot' };
  if (game.cycle.envelope.confiscated) return { ok: false, reason: 'confiscated' };
  if (game.cycle.envelope.sealedDay === game.cycle.day) {
    return { ok: false, reason: 'already-sealed' };
  }

  const all = collectibleNotes(game);
  const picked = ids
    .map((id) => all.find((card) => card.id === id))
    .filter(Boolean)
    .slice(0, 3);
  if (picked.length === 0) return { ok: false, reason: 'empty' };

  game.cycle.envelope.items = picked.map((card) => ({ ...card, copiedOn: game.cycle.day }));
  game.cycle.envelope.sealedDay = game.cycle.day;
  game.cycle.envelope.readableOn = game.cycle.day + 1;
  game.cycle.envelope.read = false;
  game.cycle.slots.night -= 1;
  return { ok: true, count: picked.length };
}

export function submitEnvelope(game) {
  if (game.cycle.phase !== 'morning') return { ok: false, reason: 'morning-only' };
  if (!envelopeReadable(game)) return { ok: false, reason: 'not-readable' };
  if (game.cycle.slots.morning <= 0) return { ok: false, reason: 'no-slot' };

  game.cycle.envelope.items = [];
  game.cycle.envelope.confiscated = true;
  game.cycle.envelope.read = false;
  game.cycle.slots.morning -= 1;
  game.subject.C = clampStat(game.subject.C + 1);
  game.subject.S = clampStat(game.subject.S + 1);
  return { ok: true };
}

const DOCUMENT_TEXT =
  '7日目の終わりに区画の定期評価と除籍処理がある。持込枠は任意品2点。必須支給品は別枠。';

export function readDistribution(game) {
  if (game.cycle.phase !== 'morning') return { ok: false, reason: 'morning-only' };
  if (game.cycle.slots.morning <= 0) return { ok: false, reason: 'no-slot' };
  game.cycle.slots.morning -= 1;
  addHearsay(game, {
    key: 'distribution',
    text: DOCUMENT_TEXT,
    speaker: '配布文書',
    observedDay: null,
  });
  return { ok: true };
}

const ROOMMATE_LINES = [
  {
    key: 'pace-run',
    text: '「歩調の試験は、走った奴から順に戻ってこないらしい。止まってた奴は戻ってきた」',
    speaker: '同房者A',
  },
  {
    key: 'pace-scratch',
    text: '「通路の床の跡は、掃除の跡じゃない。同じ間隔で続いてた」',
    speaker: '同房者B',
  },
  {
    key: 'researcher-a',
    text: '「研究員Aは説明を省く。でも、危ない時は声が少し変わる」',
    speaker: '同房者C',
  },
  {
    key: 'old-subject',
    text: '「前の被験者は、扉の前で立ち止まったまま動かなかったと聞いた」',
    speaker: '同房者D',
  },
  {
    key: 'evaluation',
    text: '「7日目に残るのは、4日目と7日目の仕事を同じ体で終えた奴だけだって」',
    speaker: '同房者B',
  },
];

export function talkToRoommate(game) {
  if (!['morning', 'night'].includes(game.cycle.phase)) return { ok: false, reason: 'phase' };
  const slotKey = game.cycle.phase;
  if (game.cycle.slots[slotKey] <= 0) return { ok: false, reason: 'no-slot' };

  const existing = new Set(game.subject.hearsays.map((card) => card.key));
  const available = ROOMMATE_LINES.filter((line) => !existing.has(line.key));
  if (available.length === 0) return { ok: false, reason: 'exhausted' };

  const rng = rngFrom(hashSeed(`${game.cycle.seed}:talk:${game.cycle.day}:${slotKey}:${game.subject.hearsays.length}`));
  const line = rng.pick(available);
  addHearsay(game, {
    key: line.key,
    text: line.text,
    speaker: line.speaker,
    observedDay: null,
  });
  game.cycle.slots[slotKey] -= 1;
  return { ok: true, line };
}

export function doSafeWork(game) {
  if (game.cycle.phase !== 'night') return { ok: false, reason: 'night-only' };
  if (game.cycle.slots.night <= 0) return { ok: false, reason: 'no-slot' };
  const reward = safeWorkReward(game);
  if (!reward) return { ok: false, reason: 'done' };
  game.cycle.slots.night -= 1;
  return { ok: true, reward };
}

export function sleep(game) {
  if (game.cycle.phase !== 'night') return null;
  if (game.cycle.day >= 7) return { ending: finishCycle(game, 'normal') };
  advanceDay(game);
  return { ending: null };
}

export function advanceDay(game) {
  game.cycle.day += 1;
  game.cycle.phase = 'morning';
  game.cycle.slots = { morning: 2, night: 2 };
  game.cycle.dailySafeWorkDone = false;
  game.trial = null;
  game.interview = null;
  game.pendingDeath = null;
}

export function attemptEscape(game) {
  if (game.cycle.day !== 7 || game.cycle.phase !== 'morning') return null;
  if (!game.cycle.flags.supervisorBadge) return null;
  game.cycle.flags.escapeAttempted = true;
  return finishCycle(game, 'escape');
}

export function finishCycle(game, reason = 'normal') {
  const ending = evaluateEnding(game, reason);
  game.cycle.ending = { ...ending, at: Date.now() };
  game.cycle.phase = 'ending';
  game.reports.push(
    makeReport(game, {
      kind: 'ending',
      title: ending.title,
      lines: [ending.body],
    }),
  );
  return ending;
}

export function startNewCycle(game, { seed }) {
  game.cycle = createCycle({
    seed,
    number: game.cycle.number + 1,
    firstCycle: false,
  });
  game.subject = createSubject(1);
  game.trial = null;
  game.interview = null;
  game.pendingDeath = null;
  game.noteSeq = 1;
  game.updatedAt = Date.now();
  return game;
}

export function addObservation(game, { key, text, room = 'A-01' }) {
  if (key && game.subject.observations.some((card) => card.key === key)) return null;
  const card = {
    id: `N${game.noteSeq++}`,
    key,
    kind: 'observation',
    text,
    day: game.cycle.day,
    room,
    observer: game.subject.number,
  };
  game.subject.observations.push(card);
  return card;
}

export function addHearsay(game, { key, text, speaker, observedDay = null }) {
  if (key && game.subject.hearsays.some((card) => card.key === key)) return null;
  const card = {
    id: `N${game.noteSeq++}`,
    key,
    kind: 'hearsay',
    text,
    speaker,
    day: game.cycle.day,
    observedDay,
  };
  game.subject.hearsays.push(card);
  return card;
}

export function addHypothesis(game, fields) {
  const card = {
    id: `N${game.noteSeq++}`,
    kind: 'hypothesis',
    title: String(fields.title || '').slice(0, 80),
    trigger: String(fields.trigger || '').slice(0, 200),
    effect: String(fields.effect || '').slice(0, 200),
    condition: String(fields.condition || '').slice(0, 200),
    basis: String(fields.basis || '').slice(0, 200),
    note: String(fields.note || '').slice(0, 600),
    day: game.cycle.day,
    cleared: false,
  };
  game.subject.hypotheses.push(card);
  return card;
}

function addTrialFindings(game, trial) {
  addObservation(game, {
    key: 'scratches',
    text: '床に一定間隔の擦り跡があり、破れた回収票が落ちていた。',
  });
  if (trial.stats.approachCount > 0) {
    addObservation(game, {
      key: 'pace-short',
      text: '走行を始めた直後、自分の足音に半拍遅れて別の足音が重なり、間隔が短くなった。',
    });
  }
  if (trial.follow.stopClears > 0) {
    addObservation(game, {
      key: 'pace-stop',
      text: 'その場で止まると、遅れてきた足音も止まった。',
    });
  }
  if (trial.follow.slowClears > 0) {
    addObservation(game, {
      key: 'pace-slow',
      text: '速度を落として歩くと、足音が遠のいた。',
    });
  }
  if (trial.box.collected) {
    addObservation(game, {
      key: 'box',
      text: '突き当たりの箱を回収した。回収票は破れていた。',
    });
  }
  if (trial.outcome === 'timeout') {
    addObservation(game, {
      key: 'shield',
      text: '期限を過ぎると入口の遮蔽が閉じ、回収班が入ってきた。',
    });
  }
}

function makeReport(game, { kind, title, lines }) {
  return {
    id: `R-${game.cycle.id}-${game.cycle.day}-${kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    cycleId: game.cycle.id,
    cycleNumber: game.cycle.number,
    facility: game.cycle.facility,
    day: game.cycle.day,
    subject: game.subject.number,
    kind,
    title,
    lines,
    createdAt: Date.now(),
  };
}

function buildTrialReport(game, trial, applied) {
  const lines = [];
  const day = game.cycle.day;

  if (trial.outcome === 'died') {
    lines.push(`実験室 A-01 / 被験者 ${game.subject.number}`);
    lines.push(`最終入力: ${movementLabel(trial.death?.speed ?? 0)}`);
    lines.push(
      trial.stats.approachCount > 0
        ? '追従音の接近を確認。'
        : '追従音の接近は記録されなかった。',
    );
    lines.push('停止または低速化の継続は記録されなかった。');
    lines.push(
      trial.stats.approachCount > 0
        ? '事後断片: 走行開始後、追従音の間隔短縮を記録。'
        : '事後断片: 移動中の追従音は記録されなかった。',
    );
    return makeReport(game, { kind: 'death', title: `第${day}日 死亡報告`, lines });
  }

  if (trial.box.collected) lines.push('回収物を受領。');
  else lines.push('回収物の受領なし。');
  if (trial.outcome === 'survived') lines.push('入口からの退出を確認。');
  if (trial.outcome === 'timeout') lines.push('期限超過。回収班が介入。');
  if (trial.follow.stopClears > 0) lines.push('停止区間で追従音の間隔拡大を記録。');
  else if (trial.follow.slowClears > 0) lines.push('低速区間で追従音の減衰を記録。');
  else lines.push('事後断片: 指定区間の移動を記録。');
  if (trial.load.spanSatisfied) lines.push('指定区間の走行を確認。');
  if (trial.load.offered && trial.load.reply === 'refuse') lines.push('走行指示への拒否を記録。');
  else if (trial.load.offered && !trial.load.spanSatisfied) lines.push('走行区間の未達を記録。');
  if (applied.roleEligible) lines.push('役割評価の対象業務として記録。');

  return makeReport(game, {
    kind: trial.outcome === 'timeout' ? 'timeout' : 'survival',
    title: `第${day}日 事後報告`,
    lines,
  });
}
