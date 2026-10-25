// 事後報告書。仕様案3.1・7.A・AC13に対応する。
// 生還・死亡のどちらでも、その試験で観測した事実から断片を1件だけ載せる。
// 死亡回数で開示量を増やさず、未発生の変種ルールを説明しない。

import { FACTS, type FactId } from './facts';
import type { MoveMode, TrialOutcome } from './pacing';
import { ticksToSeconds } from './pacing';

export type ReportKind = 'survived' | 'timeout' | 'death';

export interface ArchivedReport {
  id: string;
  cycleId: string;
  facilityCode: string;
  day: number;
  subjectNumber: string;
  roomCode: string;
  kind: ReportKind;
  lines: string[];
  fragment: string;
}

export interface ReportInput {
  cycleId: string;
  facilityCode: string;
  day: number;
  subjectNumber: string;
  roomCode: string;
  outcome: TrialOutcome;
  observed: readonly FactId[];
}

/** 観測済みの事実から優先度の最も高いものを1件選ぶ */
export function selectFragmentFact(observed: readonly FactId[]): FactId | null {
  let best: FactId | null = null;
  for (const fact of observed) {
    if (best === null || FACTS[fact].reportPriority < FACTS[best].reportPriority) best = fact;
  }
  return best;
}

const MODE_WORD: Record<MoveMode, string> = {
  still: '停止',
  slow: '低速歩行',
  normal: '通常歩行',
  run: '走行',
};

export function buildTrialReport(input: ReportInput): ArchivedReport {
  const { outcome } = input;
  const header = `試験室 ${input.roomCode}／${input.day}日目／被験者 ${input.subjectNumber}`;
  const lines = [header];
  switch (outcome.kind) {
    case 'survived':
      lines.push('回収物を受領。被験者は自力で退出。');
      break;
    case 'timeout':
      lines.push(outcome.hasBox ? '期限到達。回収物は被験者が保持したまま搬出。' : '期限到達。回収物未受領。');
      break;
    case 'death': {
      const leg = outcome.leg === 'return' ? '帰路' : '往路';
      const seconds = ticksToSeconds(outcome.lastModeTicks).toFixed(1);
      const action = outcome.lastMode === 'still' ? `停止から${seconds}秒後` : `${MODE_WORD[outcome.lastMode]}の開始から${seconds}秒後`;
      lines.push(`被験者は${leg}にて、${action}に反応消失。`);
      lines.push('背部に圧迫痕。呼吸・脈拍停止を確認。');
      break;
    }
  }
  const fact = selectFragmentFact(input.observed);
  const fragment = fact ? FACTS[fact].report : '被験者の行動に特記事項なし。';
  return {
    id: `${input.cycleId}:d${input.day}:${input.roomCode}:${input.subjectNumber}`,
    cycleId: input.cycleId,
    facilityCode: input.facilityCode,
    day: input.day,
    subjectNumber: input.subjectNumber,
    roomCode: input.roomCode,
    kind: outcome.kind,
    lines,
    fragment,
  };
}
