// 指示データ。仕様案6.2の項目に対応する。intent は開発用で、通常UIには出さない。

export type ResearcherId = 'A' | 'B';

export type InstructionTrigger = 'trialStart' | 'boxAcquired';

export type InstructionCompletion = 'retrieveAndExit' | 'runSegment';

export type InstructionIntent = 'honest' | 'experiment' | 'misdirection' | 'silence';

export type ResponseKind = 'comply' | 'delay' | 'refuse' | 'question';

export interface InstructionDef {
  id: string;
  speaker: ResearcherId;
  trigger: InstructionTrigger;
  /** 発話条件の成立から本文開始までの秒数 */
  delay: number;
  text: string;
  /** 期限。'trialEnd' は退出または実験期限まで */
  deadline: 'trialEnd';
  purpose: string;
  completion: InstructionCompletion;
  /** 明示的な拒否・期限までの未達で信用-1（同一試験の未達減点は合計1まで） */
  failureCreditPenalty: boolean;
  replies: Record<ResponseKind, string | null>;
  intent: InstructionIntent;
}

export const RESEARCHER_LABEL: Record<ResearcherId, string> = {
  A: 'インターホン — 低い声',
  B: 'インターホン — 丁寧な声',
};

export const RESPONSE_LABEL: Record<ResponseKind, string> = {
  comply: '従う「了解」',
  delay: '遅らせる「少し待ってください」',
  refuse: '逆らう「できません」',
  question: '質問する「なぜですか」',
};

export const PACING_INSTRUCTIONS: readonly InstructionDef[] = [
  {
    id: 'pacing.brief',
    speaker: 'A',
    trigger: 'trialStart',
    delay: 0,
    text: '{subject}、通路の奥にある箱を回収し、入口まで戻ってください。時間は120秒です。',
    deadline: 'trialEnd',
    purpose: '回収',
    completion: 'retrieveAndExit',
    failureCreditPenalty: true,
    replies: {
      comply: null,
      delay: '時間は延びません。',
      refuse: '……記録します。',
      question: '回収してください。それ以上の説明はありません。',
    },
    intent: 'honest',
  },
  {
    id: 'pacing.run',
    speaker: 'A',
    trigger: 'boxAcquired',
    delay: 1,
    text: '時間がありません、走ってください。赤い線から青い線まで。',
    deadline: 'trialEnd',
    purpose: '負荷',
    completion: 'runSegment',
    failureCreditPenalty: true,
    replies: {
      comply: null,
      delay: '急いでください。',
      refuse: '……記録します。',
      question: '記録のためです。……線の外では走らなくていい。',
    },
    intent: 'experiment',
  },
];

export const PACING_LINES = {
  warning: '残り10秒です。',
  doorWithoutBox: '回収物を持って戻ってください。',
  doorLocked: '（扉は開かない）',
  exitOk: '回収を確認しました。その場で待機してください。',
  timeout: '時間です。遮蔽を閉じます。回収班を入れます。',
} as const;

export function instructionText(def: InstructionDef, subjectNumber: string): string {
  return def.text.replace('{subject}', subjectNumber);
}
