import { BASE_SPEED } from './constants.js';

export function clampStat(value) {
  return Math.max(0, Math.min(3, value));
}

export function trialCredit(trial) {
  let credit = 0;
  const success = trial.outcome === 'survived' && trial.box.collected;
  if (success) credit += 1;
  // 期限超過は死亡ではなく業務未達として扱う。
  if (trial.outcome === 'timeout') credit -= 1;

  const instructionLive = trial.load.offered;
  const refused = trial.load.reply === 'refuse';
  const unmet =
    instructionLive &&
    !refused &&
    !trial.load.spanSatisfied;

  if (refused || unmet) credit -= 1;

  // 同じ実験での信用収支は -1〜+1 に収める。
  return Math.max(-1, Math.min(1, credit));
}

export function isRoleEligible(trial, day, subject) {
  if (trial.outcome !== 'survived' || !trial.box.collected) return false;
  if (day !== 4 && day !== 7) return false;
  return !subject.eDays.includes(day);
}

export function applyTrialResult(game) {
  const trial = game.trial;
  const subject = game.subject;
  const before = subject.C;
  const credit = trialCredit(trial);

  subject.C = clampStat(subject.C + credit);
  const appliedCredit = subject.C - before;

  const roleEligible = isRoleEligible(trial, game.cycle.day, subject);
  if (roleEligible) {
    subject.E = clampStat(subject.E + 1);
    subject.eDays.push(game.cycle.day);
  }

  game.interview = {
    trialOutcome: trial.outcome,
    success: trial.outcome === 'survived' && trial.box.collected,
    creditDelta: appliedCredit,
    roleEligible,
    resolved: false,
    choice: null,
  };

  return { credit: appliedCredit, roleEligible };
}

export const INTERVIEW_LABELS = Object.freeze({
  footsteps: '「足音が重なったので止まりました」',
  pain: '「足が痛くて遅れました」',
  knowAll: '「実験の条件は全部知っています」',
  silent: '何も言わない',
  submit: '隠していたメモを任意提出する',
});

export function hasEvidence(subject, game) {
  return subject.observations.length > 0 || game.cycle.envelope.items.length > 0;
}

export function interviewOptions(game) {
  const options = ['footsteps', 'pain', 'knowAll', 'silent'];
  if (game.cycle.envelope.items.length > 0) options.push('submit');
  return options;
}

export function resolveInterview(game, choice) {
  if (!game.interview || game.interview.resolved) return null;
  if (!interviewOptions(game).includes(choice)) return null;

  const subject = game.subject;
  const interview = game.interview;
  const before = { C: subject.C, S: subject.S };
  let creditDelta = 0;
  let suspicionDelta = 0;
  let confiscated = false;
  let memoryProcessed = false;
  let text = '';

  switch (choice) {
    case 'footsteps':
      // 観測記録の有無にかかわらず、この返答自体では疑念を動かさない。
      text = '研究員は記録端末に短く何かを打ち込んだ。';
      break;
    case 'pain':
      if (!interview.success) creditDelta -= 1;
      text = interview.success
        ? '研究員は回収物と退出の記録を確認した。'
        : '研究員は未達成の記録を確認した。';
      break;
    case 'knowAll':
      if (!hasEvidence(subject, game)) suspicionDelta += 1;
      text = '研究員はしばらく黙っていた。';
      break;
    case 'silent':
      if (!interview.success) creditDelta -= 1;
      text = '研究員は返答を待たずに記録を閉じた。';
      break;
    case 'submit':
      creditDelta += 1;
      suspicionDelta += 1;
      confiscated = true;
      text = '研究員はメモを受け取り、封筒ごと回収した。内容の正誤は告げられなかった。';
      break;
    default:
      return null;
  }

  // 同じ実験での信用減点は合計 1 まで。
  const allowance = Math.max(-1 - interview.creditDelta, -1);
  const appliedCredit = Math.max(creditDelta, allowance);
  interview.creditDelta += appliedCredit;
  subject.C = clampStat(subject.C + appliedCredit);
  subject.S = clampStat(subject.S + suspicionDelta);

  if (confiscated) {
    game.cycle.envelope.items = [];
    game.cycle.envelope.confiscated = true;
  }

  if (subject.S >= 3) {
    memoryProcessed = true;
    clearRecentCopies(game);
    subject.S = 1;
    game.cycle.lastMemoryProcessingDay = game.cycle.day;
  }

  interview.resolved = true;
  interview.choice = choice;
  interview.text = text;
  interview.before = before;

  return {
    choice,
    before,
    after: { C: subject.C, S: subject.S },
    appliedCredit,
    suspicionDelta,
    confiscated,
    memoryProcessed,
    text,
  };
}

export function clearRecentCopies(game) {
  const day = game.cycle.day;
  const subject = game.subject;
  subject.observations = subject.observations.filter((card) => card.day !== day);
  subject.hearsays = subject.hearsays.filter((card) => card.day !== day);
  subject.hypotheses = subject.hypotheses.map((card) =>
    card.day === day ? { ...card, cleared: true, title: '', trigger: '', effect: '', condition: '', basis: '', note: '' } : card,
  );
  game.cycle.lastClear = { day, at: Date.now() };
}

export function safeWorkReward(game) {
  const subject = game.subject;
  const day = game.cycle.day;
  if (game.cycle.dailySafeWorkDone) return null;
  game.cycle.dailySafeWorkDone = true;

  const beforeC = subject.C;
  const beforeS = subject.S;
  subject.C = clampStat(subject.C + 1);
  subject.S = clampStat(subject.S - 1);
  const reward = {
    credit: subject.C - beforeC,
    suspicion: subject.S - beforeS,
    badge: false,
  };

  if (day === 6 && subject.C >= 2 && subject.S <= 1 && !game.cycle.flags.supervisorBadge) {
    game.cycle.flags.supervisorBadge = true;
    reward.badge = true;
  }
  return reward;
}

export function evaluateEnding(game, reason) {
  const subject = game.subject;

  if (reason === 'escape') {
    return {
      kind: '脱走未遂',
      title: '脱走未遂',
      body:
        '監督用名札で門衛は通過した。外門の生体認証は開かない。職員に確保され、実験はそこで打ち切られた。',
    };
  }

  if (reason === 'day7-death') {
    return {
      kind: '処分',
      title: '処分（欠員補充停止）',
      body:
        '7日目の死亡は、生前の認定条件があっても上書きされない。区画の評価は欠員補充停止として記録された。',
    };
  }

  const eligible = subject.E >= 2 && subject.C >= 2 && subject.S <= 1;
  if (eligible) {
    return {
      kind: '有用認定',
      title: '有用認定',
      body:
        '4日目と7日目の指定業務を、同じ人物が生還して完了した。翌月の継続配属が通知され、MVPはここで終了する。',
    };
  }

  return {
    kind: '処分',
    title: '処分',
    body:
      '最終評価の条件を満たさなかった。経験した異常の事務記録が1件だけ手元に残る。',
  };
}

export function perceivedStatus(subject) {
  const ration = subject.C >= 3 ? '追加配給' : subject.C >= 2 ? '通常配給' : '減量配給';
  const watch =
    subject.S >= 3
      ? '事後に記憶処理が予定されている'
      : subject.S >= 2
        ? 'ノート検査の予告が出ている'
        : subject.S >= 1
          ? '聴取が長めである'
          : '目立った監視はない';
  const role = subject.E >= 2 ? '指定業務の実績あり' : subject.E >= 1 ? '実績1件' : '実績なし';
  return { ration, watch, role };
}

export function movementLabel(speed) {
  if (speed >= BASE_SPEED.run) return '走行';
  if (speed >= BASE_SPEED.normal) return '通常歩行';
  if (speed > 0) return '低速歩行';
  return '停止';
}
