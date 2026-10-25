// 生還後の聴取。仕様案5.2の返答表に対応する。
// 研究員が使えるのは、カメラで見える行動・インターホンへの返答・聴取で示された証拠だけ。
// 前兆への反応、仮説の文章、選ばなかった選択肢では疑念を動かさない。

import type { FactId } from './facts';
import { shortfallKey, type DeltaPart } from './ledger';

export type InterrogationOptionId = 'footsteps' | 'sore_leg' | 'know_all' | 'silent' | 'submit_memo';

export interface InterrogationContext {
  trialId: string;
  /** 回収物を持ち帰ったか */
  retrieved: boolean;
  /** その試験で現人物が観測した事実 */
  observedThisTrial: FactId[];
  /** 現人物がこれまでに観測した事実（記憶処理で消えない原記録） */
  subjectEvidence: FactId[];
  /** 現人物が封筒を読み、提出できるメモがあるか */
  memoAvailable: boolean;
}

export interface InterrogationOption {
  id: InterrogationOptionId;
  label: string;
}

export interface InterrogationResolution {
  parts: DeltaPart[];
  reply: string;
  confiscateEnvelope: boolean;
}

export const INTERROGATION_PROMPT = '通路で何があったか、説明してください。';

const PERCEIVED_SECOND_STEPS: readonly FactId[] = ['pacing.echo', 'pacing.approach.normal', 'pacing.approach.run'];
const STOPPED_FOR_IT: readonly FactId[] = ['pacing.stop_silence', 'pacing.retreat.stop', 'pacing.retreat.slow'];
const ANOMALY_EVIDENCE: readonly FactId[] = [
  'pacing.echo',
  'pacing.stop_silence',
  'pacing.approach.normal',
  'pacing.approach.run',
  'pacing.retreat.stop',
  'pacing.retreat.slow',
  'pacing.normal_steady',
];

export function availableOptions(ctx: InterrogationContext): InterrogationOption[] {
  const options: InterrogationOption[] = [];
  const heard = ctx.observedThisTrial.some((f) => PERCEIVED_SECOND_STEPS.includes(f));
  const stopped = ctx.observedThisTrial.some((f) => STOPPED_FOR_IT.includes(f));
  if (heard && stopped) options.push({ id: 'footsteps', label: '「足音が重なったので、止まりました」' });
  options.push({ id: 'sore_leg', label: '「足が痛くて、遅れました」' });
  // 具体的な正解は選択肢に出さない。抽象的な断言だけを常に選べる
  options.push({ id: 'know_all', label: '「この実験の条件は、全部知っています」' });
  options.push({ id: 'silent', label: '（何も話さない）' });
  if (ctx.memoAvailable) options.push({ id: 'submit_memo', label: '寝台の下にあったメモを提出する' });
  return options;
}

export function hasEvidenceForClaim(ctx: InterrogationContext): boolean {
  return ctx.subjectEvidence.some((f) => ANOMALY_EVIDENCE.includes(f));
}

export function resolveOption(ctx: InterrogationContext, id: InterrogationOptionId): InterrogationResolution {
  const t = ctx.trialId;
  switch (id) {
    case 'footsteps':
      return { parts: [], reply: '足音、ですか。……記録します。', confiscateEnvelope: false };
    case 'sore_leg':
      return ctx.retrieved
        ? { parts: [], reply: '回収はされています。次は時間内に。', confiscateEnvelope: false }
        : { parts: [{ key: shortfallKey(t), credit: -1 }], reply: '回収できていません。記録します。', confiscateEnvelope: false };
    case 'know_all':
      return hasEvidenceForClaim(ctx)
        ? { parts: [], reply: '見聞きした範囲の話ですね。記録します。', confiscateEnvelope: false }
        : { parts: [{ key: `suspicion:claim:${t}`, suspicion: 1 }], reply: '……全部、ですか。記録しておきます。', confiscateEnvelope: false };
    case 'silent':
      return ctx.retrieved
        ? { parts: [], reply: '……結構です。', confiscateEnvelope: false }
        : { parts: [{ key: shortfallKey(t), credit: -1 }], reply: '……結構です。未達として記録します。', confiscateEnvelope: false };
    case 'submit_memo':
      return {
        parts: [
          { key: `credit:memo:${t}`, credit: 1 },
          { key: `suspicion:memo:${t}`, suspicion: 1 },
        ],
        reply: '預かります。協力に感謝します。',
        confiscateEnvelope: true,
      };
  }
}
