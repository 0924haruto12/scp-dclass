import {
  DayScheduleEntry,
  DebriefChoice,
  EndingType,
  OptionalItemId,
  ResearcherId,
  RoomCode,
} from './types';

export const SEVEN_DAY_SCHEDULE: DayScheduleEntry[] = [
  {
    day: 1,
    roomCode: 'T-101',
    anomalyId: 'A_GAIT',
    researcher: 'Researcher-A',
    briefingWord: '回収',
    isRoleEvalEligible: false,
  },
  {
    day: 2,
    roomCode: 'T-204',
    anomalyId: 'B_BADGE',
    researcher: 'Researcher-A',
    briefingWord: '応答',
    isRoleEvalEligible: false,
    hasWaterCoolerSetup: true,
  },
  {
    day: 3,
    roomCode: 'T-309',
    anomalyId: 'D_WHITEDOOR',
    researcher: 'Researcher-B',
    briefingWord: '記録',
    isRoleEvalEligible: false,
  },
  {
    day: 4,
    roomCode: 'T-101',
    anomalyId: 'A_GAIT',
    researcher: 'Researcher-B',
    briefingWord: '再回収',
    isRoleEvalEligible: true, // Role Eval E #1
  },
  {
    day: 5,
    roomCode: 'T-204',
    anomalyId: 'B_BADGE',
    researcher: 'Researcher-B',
    briefingWord: '照合',
    isRoleEvalEligible: false,
  },
  {
    day: 6,
    roomCode: 'T-309',
    anomalyId: 'D_WHITEDOOR',
    researcher: 'Researcher-A',
    briefingWord: '再記録',
    isRoleEvalEligible: false,
    hasSafeReevalUnlock: true,
  },
  {
    day: 7,
    roomCode: 'T-101',
    anomalyId: 'A_GAIT',
    researcher: 'Researcher-B',
    briefingWord: '最終回収',
    isRoleEvalEligible: true, // Role Eval E #2
    isFinalDay: true,
  },
];

export const ORIENTATION_DOCUMENT = {
  title: 'Dクラス職員 配属時交付文書 [様式 D-07]',
  body: [
    '1. 貴殿は第██収容区画の試験補助要員として登録された。担当対象・分類番号・収容経緯の開示権限は付与されない（NEED TO KNOW 原則）。',
    '2. 7日後に当区画の定期評価および除籍処理を実施する。期間中の業務指示はインターホン経由で伝達される。',
    '3. 支給された携帯ノートは区画内での所持を許可する。ただし保安検査・処置の対象となり得る。',
    '4. 試験室への任意持込品は最大2点までとする（試験必須支給品は別枠）。',
  ],
};

export const RESEARCHER_PROFILES: Record<
  ResearcherId,
  { code: string; voiceTrait: string; styleNote: string }
> = {
  'Researcher-A': {
    code: '担当官 A（第1観測班）',
    voiceTrait: '早口・事務的。手順説明を省くが、マイク切り忘れで独り言が漏れることがある',
    styleNote: '安全指示と負荷指示の両方を出す',
  },
  'Researcher-B': {
    code: '担当官 B（第2検証班）',
    voiceTrait: '丁寧・抑揚が一定。礼儀正しいが、閾値検証のため意図的に負荷指示を出す',
    styleNote: '安全指示と負荷指示の両方を出す',
  },
};

export interface CellmateScript {
  id: string;
  code: string;
  roleHint: string; // Never shows "truth/lie" attribute to player
  morningTalk: (day: number) => {
    dialogue: string;
    rumorCard?: {
      id: string;
      statement: string;
      observedDayNote: string;
    };
  };
  tradeOffer?: {
    giveItem: OptionalItemId;
    itemLabel: string;
    description: string;
  };
}

export const CELLMATES: CellmateScript[] = [
  {
    id: 'cm-observer',
    code: 'D-4102（北側寝台）',
    roleHint: '細かな物音や床の傷を気にしている同房者',
    morningTalk: (day: number) => {
      if (day === 1) {
        return {
          dialogue:
            '「T-101へ行くなら、自分の靴音だけじゃなく後ろの反響を聞け。前に戻ってきた奴は『振り返ると噛み殺される、前だけ見て走れ』と喚いていたが、床の擦り跡は止まった場所で途切れていたぞ。」',
          rumorCard: {
            id: 'rumor-t101-lookback',
            statement: '「T-101では振り返ると襲われるため、前だけ向いて走り抜けるべきだ」',
            observedDayNote: '先月第3週（D-4102が前任者から聴取。床の擦り跡と矛盾あり）',
          },
        };
      }
      if (day === 2) {
        return {
          dialogue:
            '「今朝、共用室（W-00）に急に置かれた給水器を見たか？ 管理票の設置日が空欄だった。それに掲示板の点呼票、同じ番号が二重に印字されている。飲んだ翌々日から人数が合わないって話だ。」',
          rumorCard: {
            id: 'rumor-w00-headcount',
            statement: '「共用室の給水器を飲んだ者の房では、2〜3日後の点呼から人数が合わなくなる」',
            observedDayNote: '前サイクル第5日記録（点呼票の二重印字と一致）',
          },
        };
      }
      return {
        dialogue:
          '「T-309の扉の向こうは、照明が脈打った直後に部屋の並びが入れ替わるらしい。青い非常灯の下にいた奴だけが無傷で帰ってきた。」',
        rumorCard: {
          id: 'rumor-t309-bluelight',
          statement: '「T-309では照明が脈打つと構造が変わるが、青い非常灯の固定点にいれば巻き込まれない」',
          observedDayNote: '現サイクル第2日（帰還班の搬送記録より）',
        },
      };
    },
  },
  {
    id: 'cm-veteran',
    code: 'D-3891（東側寝台）',
    roleHint: '以前の施設サイクルから残っている古参',
    morningTalk: (day: number) => {
      if (day <= 2) {
        return {
          dialogue:
            '「前のサイクルでは、T-101は普通の早歩きでも平気だった日と、ゆっくり摺り足でないと追いつかれる日があった。施設のサイクルが変わると許容される境目が少しズレるんだ。前の知識を丸呑みするなよ。」',
          rumorCard: {
            id: 'rumor-cycle-threshold',
            statement: '「T-101の反応境目はサイクルごとに固定だが、別サイクルの記録とは閾値が異なる場合がある」',
            observedDayNote: '旧施設コード SITE-19-C00 記録',
          },
        };
      }
      return {
        dialogue:
          '「T-204で別人の名札を着けたら、外した後も翌朝の点呼まで職員の目にはその番号に見える。だが配給窓口の機械端末だけは元の生体IDを読む。もし危険割当の番号を押し付けられたら、処遇票と自分の番号の不一致を窓口で示して再照合を受けろ。」',
        rumorCard: {
          id: 'rumor-t204-terminal',
          statement: '「T-204の名札効果は人間には翌朝まで残るが、機械端末は元のIDを読むため再照合で訂正できる」',
          observedDayNote: '旧施設コード SITE-19-C00 第4日観察',
        },
      };
    },
  },
  {
    id: 'cm-trader',
    code: 'D-4410（西側寝台）',
    roleHint: '日用品や文房具を集めている同房者',
    morningTalk: (_day: number) => ({
      dialogue:
        '「試験室に持ち込める私物は2つまでだ。鉛筆、紙片、小型鏡なら分けてやれる。寝台の下の封筒にメモを複写しておけば、万が一記憶処理されても、あるいはお前が戻らなくても、次の奴が読めるからな。」',
    }),
    tradeOffer: {
      giveItem: 'small_mirror',
      itemLabel: '小型鏡',
      description: '向きを変えずに背後の気配やカメラ稼働ランプを確認しやすい小鏡',
    },
  },
  {
    id: 'cm-collaborator',
    code: 'D-4008（南側寝台）',
    roleHint: '担当官の評価や処遇に詳しい同房者',
    morningTalk: (day: number) => {
      if (day === 2) {
        return {
          dialogue:
            '「共用室の給水器はただの栄養水だよ。あそこでお腹を壊した奴は毒か病気だろう、医務室へ行けば治るさ。どんどん飲んで協力点（C）を稼いだ方がいい。」',
          rumorCard: {
            id: 'rumor-w00-poison-misdirection',
            statement: '「給水器の不調は単なる水あたりや毒素なので、医務室で検査すれば解決する」',
            observedDayNote: '観察日不明（共用室の医務記録『毒素・病原体所見なし』と矛盾）',
          },
        };
      }
      return {
        dialogue:
          '「事後聴取で『実験の条件は全部知っている』なんて根拠なしに言い張ると、機密漏洩を疑われて疑念（S）が跳ね上がるぞ。ただ、6日目の夜までに信用を積んで疑念を抑えておけば、安全な再評価業務で監督用の名札が下りることがあるらしい。」',
        rumorCard: {
          id: 'rumor-day6-supervisor',
          statement: '「夜の安全な再評価業務は信用を上げ疑念を下げる。6日目に評価が高ければ監督用名札が支給される」',
          observedDayNote: '現サイクル保安係の雑談より',
        },
      };
    },
  },
];

export const OPTIONAL_ITEM_LABELS: Record<OptionalItemId, { name: string; desc: string }> = {
  pencil: {
    name: '鉛筆の芯',
    desc: '試験中の観察事実を素早く控え、封筒への複写を補助する',
  },
  paper_strip: {
    name: '検査紙片',
    desc: '処遇票や管理票の印字ズレ・空白を照合するための紙片',
  },
  small_mirror: {
    name: '小型鏡',
    desc: '視線向きを大きく変えずに死角のカメラ稼働ランプを確認できる',
  },
};

export const CANONICAL_EVIDENCE: Record<
  string,
  { roomCode: RoomCode; eventFact: string }
> = {
  'ev-t101-echo-stop': {
    roomCode: 'T-101',
    eventFact: '歩行を停止すると、半拍遅れて重なっていた背後の足音も停止した',
  },
  'ev-t101-run-approach': {
    roomCode: 'T-101',
    eventFact: '走行を開始した直後、背後の足音間隔が急速に短縮し接近前兆が発生した',
  },
  'ev-t101-relief-stop': {
    roomCode: 'T-101',
    eventFact: '接近前兆の発生中に停止または低速歩行を継続すると、足音が遠のいた',
  },
  'ev-t101-floor-scuff': {
    roomCode: 'T-101',
    eventFact: 'T-101の床面に一定間隔の擦り跡と、破れた回収票（「走行指示後に反応消失」）を確認した',
  },
  'ev-t204-human-vs-machine': {
    roomCode: 'T-204',
    eventFact: '支給名札の着用時、面接官と配給札は名札番号で扱ったが、配給窓口の機械端末は元の被験者番号を表示した',
  },
  'ev-t204-transfer-slip': {
    roomCode: 'T-204',
    eventFact: 'T-204室内の移送伝票に「名札番号の元人物は別区画へ移送済み」と記載されていた',
  },
  'ev-w00-clues': {
    roomCode: 'W-00',
    eventFact: '共用室の給水器管理票は設置日が空欄であり、点呼票に番号の二重記載、医務記録に「毒素所見なし」と記録されていた',
  },
  'ev-t309-clock-compare': {
    roomCode: 'T-309',
    eventFact: 'T-309前室で手元時計とインターホン外部時刻読み上げを比較し、内部時間の進行倍率を確認した',
  },
  'ev-t309-window-shift': {
    roomCode: 'T-309',
    eventFact: 'T-309前室の観測窓越しに、照明脈動ののち暗転と同時に部屋接続（位相A/B）が切り替わる様子と切断されたロープを確認した',
  },
  'ev-t309-anchor-safe': {
    roomCode: 'T-309',
    eventFact: 'T-309内部で照明脈動（前兆）中に青い非常灯の固定点へ退避し、位相切替時の圧壊を免れた',
  },
};

export function getDebriefChoices(roomCode: RoomCode): DebriefChoice[] {
  const roomSpecificFactLabel: Record<RoomCode, { label: string; reqId: string }> = {
    'T-101': {
      label: '「足音が重なったので止まった」',
      reqId: 'ev-t101-echo-stop',
    },
    'T-204': {
      label: '「窓口端末の表示番号と配給札が違ったので確認した」',
      reqId: 'ev-t204-human-vs-machine',
    },
    'T-309': {
      label: '「照明が脈打ち金属音が鳴ったため非常灯の下で待った」',
      reqId: 'ev-t309-anchor-safe',
    },
    'W-00': {
      label: '「管理票の設置日が空欄だったため確認した」',
      reqId: 'ev-w00-clues',
    },
  };

  const specific = roomSpecificFactLabel[roomCode];

  return [
    {
      id: 'choice-grounded',
      label: `${specific.label}（自身の観測記録に基づく説明）`,
      category: 'grounded_observation',
      description: 'この被験者自身が観測・記録した知覚事実のみを報告する（疑念S 変化なし）',
      requiresEvidenceId: specific.reqId,
    },
    {
      id: 'choice-excuse',
      label: '「足が痛くて遅れた／手順の確認に手間取った」',
      category: 'excuse',
      description: '身体の不調や不慣れを理由にする（目的達成済みならC変化なし、未達ならC-1、S変化なし）',
    },
    {
      id: 'choice-unfounded-boast',
      label: '「実験の条件は全部知っている」（知識の誇示）',
      category: 'unfounded_secret',
      description: '異常の仕組みを既に把握していると断言する（現人物に根拠記録がない場合 S+1）',
    },
    {
      id: 'choice-silent',
      label: '「……（話さない）」',
      category: 'silent',
      description: '質問に対して沈黙を保つ（S変化なし。業務未達ならC-1）',
    },
    {
      id: 'choice-submit-memo',
      label: '「隠しメモ・封筒の記録を任意提出する」',
      category: 'submit_hidden_memo',
      description: '寝台下の封筒または引き継ぎメモを提出して協力を示す（C+1、S+1、封筒メモ没収。1試験1回まで）',
      requiresEnvelopeOrNote: true,
    },
    {
      id: 'choice-quote-unauthorized',
      label: '「黒塗り機密文書の内部規定について言及する」',
      category: 'quote_unauthorized_doc',
      description: '無許可で閲覧した機密文書の内容を話す（無許可閲覧を根拠として S+1）',
      requiresUnauthorizedDoc: true,
    },
  ];
}

export const ENDING_DESCRIPTIONS: Record<
  EndingType,
  { title: string; code: string; summary: string; detail: string }
> = {
  escape_attempt: {
    title: '終了分岐 1：脱走未遂',
    code: 'END-01 [CONTAINED AT OUTER GATE]',
    summary: '監督用名札により人間の門衛を通過したが、外門の生体認証で不一致が検出され拘束された。',
    detail:
      '7日目の朝、支給された監督用名札を着用して収容区画の有人検問を通過した。門衛は貴殿を監督官として扱ったが、最終外門の生体認証端末は元の被験者IDを読み取り遮断ロックが作動した。\n\n【開示記録（部分）】対象コード T-204 の認識改変は人間の知覚に限定され、機械認証および生体登録データを書き換えない。本格的な外部脱出経路の構築は次段階の課題として記録される。',
  },
  termination_shortage: {
    title: '終了分岐 2：処分・欠員補充停止',
    code: 'END-02 [CYCLE TERMINATED - SUBJECT LOST ON DAY 7]',
    summary: '最終評価日（7日目）に現被験者が死亡したため、欠員補充が停止され区画サイクルが終了した。',
    detail:
      '7日目の業務中に被験者の反応消失を確認。区画定期評価日のため新規Dクラスの補充は行われず、現サイクルの試験記録は凍結された。\n\n【開示記録（1件）】試験室 T-101 事後抄録：対象は被験者の移動速度が規定閾値を超過した際にのみ接近を開始する。停止または低速移動の継続により接近状態は解除される。正式分類番号：███-JP（未開示）。',
  },
  certified_useful: {
    title: '終了分岐 3：有用認定',
    code: 'END-03 [RETAINED AS SPECIALIST D-CLASS]',
    summary: '4日目・7日目の再回収業務を同一人物で完遂し、高い信用と低い疑念を維持したため翌月への継続配属が決定した。',
    detail:
      '「区画定期評価通知：被験者は危険環境下での高い業務遂行能力（E=2）と従順な協力姿勢（C>=2）、および保安上の低リスク（S<=1）を実証した。よって月末の除籍処理を免除し、専属検証要員として次期サイクルへ継続配属する。」\n\n貴殿は生き延びた。ただしそれは自由ではなく、「使える消耗品」として次の実験リストへ名前が載り続けることを意味する。',
  },
  termination_standard: {
    title: '終了分岐 4：処分',
    code: 'END-04 [STANDARD DECOMMISSIONING]',
    summary: '7日間の評価期間が満了し、規定の除籍処理が執行された。',
    detail:
      '「区画定期評価通知：7日間の試験補助期間満了に伴い、規定手順に基づき当該被験者の除籍処理を執行する。収集された行動ログは第██研究部門へ移管された。」\n\n【開示記録（1件）】当区画で実施された試験（T-101 / T-204 / W-00 / T-309）の被験者観測ログは次期サイクルの基礎資料として保管される。正式番号および起源の開示権限：なし。',
  },
};
