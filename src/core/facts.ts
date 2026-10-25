// 観測カードの文面。知覚できた出来事だけを書き、因果・正解・危険度は書かない。
// 事後報告の断片も、その試験で現人物が観測した事実からだけ選ぶ。

export type FactId =
  | 'pacing.echo'
  | 'pacing.stop_silence'
  | 'pacing.approach.normal'
  | 'pacing.approach.run'
  | 'pacing.retreat.stop'
  | 'pacing.retreat.slow'
  | 'pacing.normal_steady'
  | 'pacing.look_back'
  | 'pacing.scuff'
  | 'pacing.slip'
  | 'pacing.camera'
  | 'pacing.lines'
  | 'pacing.timeout';

interface FactText {
  /** 観測カード（ノート）に載る文面 */
  card: string;
  /** 事後報告書の断片。財団の事務書式 */
  report: string;
  /** 事後報告で優先して記載する順。小さいほど優先 */
  reportPriority: number;
}

export const FACTS: Record<FactId, FactText> = {
  'pacing.echo': {
    card: '移動中、自分の足音に半拍遅れて別の足音が重なった。',
    report: '被験者の移動中、第二の足音を記録。',
    reportPriority: 5,
  },
  'pacing.stop_silence': {
    card: '立ち止まると、もう一つの足音も止んだ。',
    report: '被験者の停止と同時に、第二の足音の停止を記録。',
    reportPriority: 4,
  },
  'pacing.approach.normal': {
    card: '通常の歩行中に、もう一つの足音の間隔が短くなり、近づいてきた。',
    report: '通常歩行中、追従音の間隔短縮を記録。',
    reportPriority: 2,
  },
  'pacing.approach.run': {
    card: '走り出した後、もう一つの足音の間隔が短くなり、近づいてきた。',
    report: '走行開始後、追従音の間隔短縮を記録。',
    reportPriority: 2,
  },
  'pacing.retreat.stop': {
    card: '足音が迫った後、立ち止まっていると足音が遠のいた。',
    report: '停止区間で追従音の間隔拡大を記録。',
    reportPriority: 1,
  },
  'pacing.retreat.slow': {
    card: '足音が迫った後、ゆっくり歩き続けると足音が遠のいた。',
    report: '低速移動区間で追従音の間隔拡大を記録。',
    reportPriority: 1,
  },
  'pacing.normal_steady': {
    card: '通常の歩行をしばらく続けても、もう一つの足音の間隔は変わらなかった。',
    report: '通常歩行中、追従音の間隔に変化なし。',
    reportPriority: 3,
  },
  'pacing.look_back': {
    card: '後ろを向くと、足音に合わせて床の埃が舞った。姿は見えなかった。',
    report: '被験者の後方確認時、視覚的な対象を確認できず。',
    reportPriority: 6,
  },
  'pacing.scuff': {
    card: '床に一定の間隔で擦れた跡が続いている。',
    report: '被験者は床面の擦過痕を確認。',
    reportPriority: 8,
  },
  'pacing.slip': {
    card: '破れた回収票。「回収物: 箱 1／状態: 未回収／備考: 帰路にて██」と読める。',
    report: '被験者は前回の回収票を確認。',
    reportPriority: 9,
  },
  'pacing.camera': {
    card: '天井の中央にカメラがある。赤い稼働ランプが点いている。',
    report: '被験者は記録装置を確認。',
    reportPriority: 10,
  },
  'pacing.lines': {
    card: '床の帰路側に、赤い線と青い線が引かれている。',
    report: '被験者は床面の区画線を確認。',
    reportPriority: 11,
  },
  'pacing.timeout': {
    card: '時間切れで入口の遮蔽が閉じ、回収班に連れ出された。',
    report: '期限到達。遮蔽を閉鎖し回収班が被験者を搬出。',
    reportPriority: 7,
  },
};

export function factCardText(id: FactId): string {
  return FACTS[id].card;
}
