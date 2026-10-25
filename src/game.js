// Simulation values are prototype defaults from the draft, not measured tuning.
export const VERSION = 1;
export const ROOM = 'C-04';
export const FIXED_SEED = 924;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const copy = value => JSON.parse(JSON.stringify(value));
const epsilon = 1e-8;

export function createGame(seed = FIXED_SEED, cycleId = `F-${seed.toString(16).toUpperCase()}`) {
  return {
    version: VERSION, cycleId, seed, day: 1, phase: 'morning',
    parameters: { threshold: seed === FIXED_SEED || (seed >>> 0) % 2 === 0 ? 2.5 : 1.5 },
    subject: makeSubject(1), envelope: [], reports: [], trial: null,
    morningActions: 2, nightActions: 2, processed: [], events: [], serial: 0,
  };
}

function makeSubject(number) {
  return { number, id: `D-${String(9340 + number).padStart(4, '0')}`, credit: 0,
    suspicion: 0, evaluation: 0, cards: [], hypotheses: [], effects: [], evidence: [], memoryDay: null };
}

export function emit(game, type, text) {
  const event = { id: ++game.serial, type, text };
  game.events.push(event);
  if (game.events.length > 24) game.events.shift();
  return event;
}

export function observe(game, id, text, kind = 'observation', speaker = null) {
  if (game.subject.evidence.includes(id)) return;
  game.subject.evidence.push(id);
  game.subject.cards.push({ id: `${game.subject.id}:${id}`, source: id, kind, text, speaker,
    day: game.day, room: ROOM, observer: game.subject.id, cycleId: game.cycleId });
  emit(game, 'observation', text);
}

export function startTrial(game) {
  if (game.phase !== 'morning') return false;
  game.phase = 'trial';
  game.trial = { elapsed: 0, x: 0.8, y: 0, facing: 0, hasBox: false, mode: 'following',
    danger: 0, relief: 0, reliefKind: null, retreat: 0, speed: 0, warned: false, seenWarning: false,
    stopped: false, retreated: false, timeoutWarning: false, result: null,
    instruction: { issued: false, response: null, asked: false, fulfilled: false, segment: 0, penalty: false } };
  observe(game, 'assignment', '回収指示書：C-04奥の保管箱を回収し、入室扉へ戻る。制限時間は120秒。');
  emit(game, 'voice', '研究員 A「奥の箱を持って戻ってください。足元をよく見て。」');
  return true;
}

export function respond(game, response) {
  const t = game.trial;
  if (game.phase !== 'trial' || !t?.instruction.issued) return false;
  if (response === 'question') {
    if (t.instruction.asked) return false;
    t.instruction.asked = true;
    emit(game, 'voice', '研究員 A「赤い線から青い線まで。箱を落とさず、その区間だけです。」');
    return true;
  }
  if (t.instruction.response !== null || !['obey', 'delay', 'refuse'].includes(response)) return false;
  t.instruction.response = response;
  if (response === 'refuse') t.instruction.penalty = true;
  emit(game, 'voice', { obey: '「了解。」返答を記録した。', delay: '「少し待ってください。」時計の表示は変わらない。', refuse: '「走行の指示には従えません。」返答を記録した。' }[response]);
  return true;
}

// Call with a bounded, fixed simulation timestep. Renderer and audio never affect rules.
export function tick(game, input = {}, dt = 1 / 60) {
  if (game.phase !== 'trial' || input.paused || !Number.isFinite(dt) || dt <= 0) return;
  let remaining = Math.min(dt, 1);
  let first = true;
  while (remaining > epsilon && game.phase === 'trial') {
    const step = Math.min(remaining, 1 / 120);
    advance(game, first ? input : { ...input, interact: false }, step);
    first = false;
    remaining -= step;
  }
}

function advance(game, input, dt) {
  const t = game.trial;
  const dx = clamp(Number(input.x) || 0, -1, 1), dy = clamp(Number(input.y) || 0, -1, 1);
  const length = Math.hypot(dx, dy);
  const chosenSpeed = input.slow ? 1 : input.run ? 4 : 2;
  const previousX = t.x;
  const nx = clamp(t.x + (length ? dx / Math.max(1, length) : 0) * chosenSpeed * dt, 0.6, 23.4);
  const ny = clamp(t.y + (length ? dy / Math.max(1, length) : 0) * chosenSpeed * dt, -1.05, 1.05);
  const speed = Math.hypot(nx - t.x, ny - t.y) / dt;
  t.speed = speed;
  if (Number.isFinite(input.facing)) t.facing = input.facing;

  // Release input wins at a warning boundary; its duration freezes the danger clock.
  if (t.mode === 'approaching') {
    const reliefKind = speed <= epsilon ? 'stop' : speed <= 1 + epsilon ? 'slow' : null;
    if (reliefKind !== t.reliefKind) t.relief = 0;
    t.reliefKind = reliefKind;
    if (reliefKind === 'stop') t.relief += dt / 0.5;
    else if (reliefKind === 'slow') t.relief += dt;
    else { t.relief = 0; t.danger += dt; }
    if (t.relief >= 1 - epsilon) {
      t.mode = 'retreating'; t.retreat = 0; t.relief = 0; t.retreated = true;
      observe(game, 'retreat', '停止・低速移動の後、重なっていた足音が遠のいた。');
      emit(game, 'retreat', '背後の足音が遠のいていく。');
    }
  } else if (t.mode === 'retreating') {
    if (speed > game.parameters.threshold + epsilon) beginApproach(game);
    else if ((t.retreat += dt) >= 1 - epsilon) { t.mode = 'following'; t.danger = 0; }
  } else if (speed > game.parameters.threshold + epsilon) beginApproach(game);

  t.elapsed += dt;
  t.x = nx; t.y = ny;
  if (t.mode === 'approaching' && t.danger >= 3 - epsilon && !t.reliefKind) return finishTrial(game, 'death');

  // Returning from the red line x=17 to the blue line x=9 is the instructed interval.
  const order = t.instruction;
  if (order.issued && !order.fulfilled && !order.penalty) {
    // Progress requires continuous running through the entire marked interval.
    if (input.run && !input.slow && dx < 0 && speed > 3.9) {
      order.segment += Math.max(0, Math.min(17, previousX) - Math.max(9, t.x));
    } else if (previousX > 9 && t.x < 17) order.segment = 0;
    if (order.segment >= 8 - epsilon) { order.fulfilled = true; emit(game, 'voice', '研究員 A「区間通過を記録しました。そのまま帰還してください。」'); }
  }

  if (speed <= epsilon && !t.stopped && t.elapsed > 2) {
    t.stopped = true;
    observe(game, 'stop', '自分が立ち止まると、半拍遅れていた別の足音も止まった。');
  }
  if (input.interact) interact(game);
  if (t.elapsed >= 110 && !t.timeoutWarning) {
    t.timeoutWarning = true; emit(game, 'voice', '研究員 A「残り10秒です。帰還できなければ回収班が入ります。」');
  }
  if (t.elapsed >= 120 - epsilon) finishTrial(game, 'timeout');
}

function beginApproach(game) {
  const t = game.trial;
  t.mode = 'approaching'; t.danger = 0; t.relief = 0; t.reliefKind = null; t.warned = true; t.seenWarning = true;
  observe(game, 'approach', '移動の後、背後の足音の間隔が短くなり、すぐ近くで重なった。');
  emit(game, 'warning', '右後方から足音が重なる。すぐ近くに、もう一人いる。');
}

export function interact(game) {
  if (game.phase !== 'trial') return;
  const t = game.trial;
  if (t.x >= 22 && !t.hasBox) {
    t.hasBox = true;
    observe(game, 'box', 'C-04奥で封印された保管箱を受け取った。');
    t.instruction.issued = true;
    emit(game, 'voice', '研究員 A「時間がありません、走ってください。帰路の赤線から青線までです。」');
  } else if (t.x <= 1.5) {
    if (t.mode === 'approaching') emit(game, 'perception', '扉の前でも、背後の足音が重なっている。');
    else finishTrial(game, t.hasBox ? 'success' : 'withdrawal');
  } else if (t.x >= 6 && t.x <= 9) {
    observe(game, 'scratches', '床の擦り跡が、いくつかの場所で短く途切れている。');
  } else if (t.x >= 15 && t.x <= 18) {
    observe(game, 'ticket', '破れた回収票：「……停止区間の記録を……」後半は読み取れない。');
  } else emit(game, 'perception', '冷えた壁と、天井まで続く配線。カメラの稼働灯が点いている。');
}

function once(game, id, effect) {
  const key = `${game.day}:${game.subject.id}:${id}`;
  if (game.processed.includes(key)) return false;
  game.processed.push(key); effect(); return true;
}

export function finishTrial(game, result) {
  if (game.phase !== 'trial') return false;
  const t = game.trial;
  t.result = result; t.speed = 0;
  once(game, 'trial-result', () => {
    let credit = result === 'success' ? 1 : -1;
    if (t.instruction.issued && (t.instruction.penalty || !t.instruction.fulfilled)) {
      t.instruction.penalty = true;
      if (result === 'success') credit -= 1;
    }
    if (result !== 'death') game.subject.credit = clamp(game.subject.credit + credit, 0, 3);
    const fragment = result === 'death'
      ? '移動継続中、追従音の重なりに続き被験者の反応消失を確認。回収班による応答なし。'
      : `${result === 'success' ? '回収物を受領。' : result === 'timeout' ? '期限に伴い回収班が介入。被験者は生存。' : '被験者は回収物を持たず帰還。'}${t.retreated ? '停止区間で追従音の間隔拡大を記録。' : t.seenWarning ? '移動区間で追従音の重なりを記録。' : '被験者の移動に続く足音を記録。'}`;
    game.reports.push({ id: `${game.cycleId}:${game.day}:${game.subject.id}`, cycleId: game.cycleId,
      day: game.day, subjectId: game.subject.id, room: ROOM, result, text: fragment });
  });
  game.phase = result === 'death' ? 'death' : 'debrief';
  emit(game, 'result', result === 'death' ? '被験者の反応が途絶えた。' : '扉の外で研究員が待っている。');
  return true;
}

export function interview(game, answer) {
  if (game.phase !== 'debrief' || !['observed', 'pain', 'claim', 'silent', 'surrender'].includes(answer)) return false;
  if (answer === 'observed' && !game.subject.evidence.includes('approach') && !game.subject.evidence.includes('stop')) return false;
  if (answer === 'surrender' && !game.envelope.length) return false;
  once(game, 'interview', () => {
    if (answer === 'claim' && !game.subject.evidence.includes('approach') && !game.subject.cards.some(c => c.kind === 'envelope')) game.subject.suspicion = clamp(game.subject.suspicion + 1, 0, 3);
    if (answer === 'surrender') {
      game.subject.credit = clamp(game.subject.credit + 1, 0, 3);
      game.subject.suspicion = clamp(game.subject.suspicion + 1, 0, 3);
      game.envelope = [];
    }
  });
  game.phase = 'report';
  emit(game, 'voice', '研究員 A「記録しました。本日の業務は終了です。」');
  return true;
}

export function leaveReport(game) {
  if (game.phase === 'report') { game.phase = 'night'; applyMemory(game); return true; }
  if (game.phase === 'death') {
    const oldNumber = game.subject.number;
    game.subject.effects = [];
    if (game.day >= 7) game.phase = 'complete';
    else { game.day++; game.subject = makeSubject(oldNumber + 1); game.phase = 'morning'; game.morningActions = 2; game.trial = null; }
    return true;
  }
  return false;
}

export function addHypothesis(game, text) {
  const value = String(text).trim().slice(0, 1200);
  if (!value || game.subject.hypotheses.length >= 30) return false;
  game.subject.hypotheses.push({ id: `h:${++game.serial}`, text: value, day: game.day, kind: 'hypothesis' });
  return true;
}

export function sealEnvelope(game, ids) {
  if (game.phase !== 'night' || game.nightActions < 1 || game.processed.includes(`${game.day}:${game.subject.id}:envelope`)) return false;
  const items = [...game.subject.cards, ...game.subject.hypotheses].filter(c => ids.includes(c.id)).slice(0, 3);
  if (!items.length) return false;
  once(game, 'envelope', () => { game.envelope = copy(items); game.nightActions--; });
  return true;
}

export function readEnvelope(game) {
  if (game.phase !== 'morning' || game.morningActions < 1 || !game.envelope.length) return false;
  return once(game, 'read-envelope', () => {
    game.morningActions--;
    for (const c of game.envelope) observe(game, `envelope:${c.id}`, c.text, 'envelope', c.observer || '以前の入居者');
  });
}

export function safeDuty(game) {
  if (game.phase !== 'night' || game.nightActions < 1) return false;
  return once(game, 'safe-duty', () => { game.nightActions--; game.subject.credit = clamp(game.subject.credit + 1, 0, 3); game.subject.suspicion = clamp(game.subject.suspicion - 1, 0, 3); });
}

export function applyMemory(game) {
  if (game.subject.suspicion < 3) return false;
  return once(game, 'memory', () => {
    game.subject.cards = game.subject.cards.filter(c => c.day !== game.day);
    game.subject.hypotheses = game.subject.hypotheses.filter(c => c.day !== game.day);
    game.subject.evidence = game.subject.cards.map(c => c.source);
    game.subject.suspicion = 1; game.subject.memoryDay = game.day;
    emit(game, 'voice', '処置終了。携帯ノートの直近のページは未記入になっている。');
  });
}

export function sleep(game) {
  if (game.phase !== 'night') return false;
  applyMemory(game);
  game.phase = 'complete';
  return true;
}

export function validateGame(g) {
  const phases = ['morning', 'trial', 'debrief', 'report', 'night', 'death', 'complete'];
  if (!g || g.version !== VERSION || !phases.includes(g.phase)) throw Error('保存形式が対応していません。');
  const finiteRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!Number.isInteger(g.seed) || !finiteRange(g.seed, 0, 4294967295) || !Number.isInteger(g.day) || !finiteRange(g.day, 1, 7) || typeof g.cycleId !== 'string' || g.cycleId.length > 80) throw Error('施設記録が破損しています。');
  if (![1.5, 2.5].includes(g.parameters?.threshold) || !g.subject || !Number.isInteger(g.subject.number) || !finiteRange(g.subject.number, 1, 7) || typeof g.subject.id !== 'string') throw Error('被験者記録が破損しています。');
  for (const key of ['credit', 'suspicion', 'evaluation']) if (!Number.isInteger(g.subject[key]) || !finiteRange(g.subject[key], 0, 3)) throw Error('評価記録が破損しています。');
  for (const a of [g.envelope, g.reports, g.processed, g.events, g.subject.cards, g.subject.hypotheses, g.subject.effects, g.subject.evidence]) if (!Array.isArray(a) || a.length > 500) throw Error('記録一覧が破損しています。');
  if (g.envelope.length > 3 || g.subject.hypotheses.length > 30) throw Error('ノート上限が不正です。');
  for (const c of [...g.envelope, ...g.subject.cards, ...g.subject.hypotheses]) if (!c || typeof c.id !== 'string' || typeof c.text !== 'string' || c.text.length > 5000 || !Number.isInteger(c.day) || !finiteRange(c.day, 1, 7) || !['observation', 'hearsay', 'hypothesis', 'envelope'].includes(c.kind)) throw Error('ノート記録が破損しています。');
  for (const r of g.reports) if (!r || typeof r.text !== 'string' || typeof r.subjectId !== 'string' || typeof r.cycleId !== 'string') throw Error('報告記録が破損しています。');
  if (!Number.isInteger(g.serial) || !finiteRange(g.serial, 0, 10000000) || !Number.isInteger(g.morningActions) || !finiteRange(g.morningActions, 0, 2) || !Number.isInteger(g.nightActions) || !finiteRange(g.nightActions, 0, 2)) throw Error('進行記録が破損しています。');
  for (const item of [...g.processed, ...g.subject.evidence]) if (typeof item !== 'string') throw Error('処理履歴が破損しています。');
  for (const event of g.events) if (!event || !Number.isInteger(event.id) || !finiteRange(event.id, 1, g.serial) || !['observation', 'voice', 'warning', 'retreat', 'result', 'perception'].includes(event.type) || typeof event.text !== 'string') throw Error('出来事の記録が破損しています。');
  if (g.trial) {
    const t = g.trial;
    if (!finiteRange(t.elapsed, 0, 121) || !finiteRange(t.x, 0.6, 23.4) || !finiteRange(t.y, -1.05, 1.05) || !finiteRange(t.danger, 0, 4) || !finiteRange(t.relief, 0, 1.1) || !finiteRange(t.retreat, 0, 2) || !finiteRange(t.speed, 0, 5) || !Number.isFinite(t.facing) || !['following', 'approaching', 'retreating'].includes(t.mode) || !t.instruction || typeof t.instruction.issued !== 'boolean' || !finiteRange(t.instruction.segment, 0, 30)) throw Error('実験記録が破損しています。');
    for (const key of ['hasBox', 'warned', 'seenWarning', 'stopped', 'retreated', 'timeoutWarning']) if (typeof t[key] !== 'boolean') throw Error('実験状態が破損しています。');
    for (const key of ['asked', 'fulfilled', 'penalty']) if (typeof t.instruction[key] !== 'boolean') throw Error('指示状態が破損しています。');
    if (![null, 'stop', 'slow'].includes(t.reliefKind) || ![null, 'obey', 'delay', 'refuse'].includes(t.instruction.response) || ![null, 'success', 'death', 'timeout', 'withdrawal'].includes(t.result)) throw Error('実験の判定状態が破損しています。');
  } else if (g.phase !== 'morning' && g.phase !== 'complete') throw Error('実験記録が見つかりません。');
  return copy(g);
}
