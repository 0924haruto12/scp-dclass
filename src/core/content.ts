// 朝・夜の脚本イベントの文面。同房者の発言は伝聞カードになり、正誤は表示しない。
// 世界観（SCP名義か独自組織か）は未決のため、固有名は最小限にしている。

export interface CellmateLine {
  id: string;
  speaker: string;
  text: string;
  speakerObserved: string | null;
}

export const MORNING_CELLMATE: CellmateLine = {
  id: 'cellmate.d2261.corridor',
  speaker: 'D-2261（向かいの寝台）',
  text: '通路の部屋か。前に行った奴は、帰りに足音が二つ聞こえたって言ってた。……そいつは戻ってこなかったがな。',
  speakerObserved: '本人の話では3日前',
};

export const NIGHT_CELLMATE: CellmateLine = {
  id: 'cellmate.d0390.lookback',
  speaker: 'D-0390（古株）',
  text: '通路のやつなら知ってる。振り返るな。昔からそう決まってる。',
  speakerObserved: '不明（昔の話）',
};

export const DISTRIBUTED_NOTICE = [
  '区画通知',
  '本区画の被験者は、7日後に定期評価と除籍処理を受ける。',
  '召集時は番号を確認すること。試験室への持込は任意品2点までとする。',
  '試験室内の行動は記録される。',
];

export const SAFE_TASK = {
  title: '清掃業務',
  lines: ['通路の床を拭き、用具を返却した。', '監督の職員が、作業票に印を押した。'],
};

export function rationText(credit: number): string {
  switch (credit) {
    case 0:
      return '配給札: 標準';
    case 1:
      return '配給札: 標準（茶つき）';
    case 2:
      return '配給札: 追加1';
    default:
      return '配給札: 追加2・優先';
  }
}

export function suspicionNotices(suspicion: number): string[] {
  switch (suspicion) {
    case 0:
      return [];
    case 1:
      return ['警備員が一人、次の召集から同行すると告げた。'];
    case 2:
      return ['警備員が同行している。', '「携帯品検査の予告」と書かれた票を渡された。'];
    default:
      return ['警備員が二人、寝台の前に立っている。'];
  }
}

export const MEMORY_TREATMENT_LINES = [
  '医務区画へ連れて行かれた。',
  '……気がつくと寝台にいる。ノートの一部が、書いた覚えのない空白になっている。',
];

export const SLICE_END_LINES = [
  'この縦切りで実装している割当はここまで。',
  '2日目以降の割当（名札・給水器・白い扉・歩調の再試験）は未実装。',
];

export function roomLabel(code: string): string {
  return `試験室 ${code}`;
}
