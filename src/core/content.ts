import {
  DayScheduleEntry,
  DebriefChoice,
  EndingType,
  OptionalItemId,
  ResearcherId,
  RoomCode,
} from './types';

/** 1ラン（施設サイクル）の暦日数。死亡しても施設日付は進み、30日目で終了判定に入る。 */
export const RUN_LENGTH_DAYS = 30;

/** 共用室の給水器が設置される朝。各設置回ごとに別の遅効イベントとして扱う。 */
export const WATER_COOLER_INSTALL_DAYS: readonly number[] = [2, 12, 22];

/** 同一人物がE=2へ到達できる指定評価業務。16日目と最終日（30日目）はT-101。 */
export const ROLE_EVAL_DAYS: readonly number[] = [16, 30];

/** 29日目の夜の安全な再評価業務が監督用名札の支給機会。 */
export const SAFE_REEVAL_UNLOCK_DAY = RUN_LENGTH_DAYS - 1;

/** 脱走未遂の検問で使用する監督用名札の表示コード。 */
export const SUPERVISOR_BADGE_CODE = 'SUP-30';

export const FINAL_DAY = RUN_LENGTH_DAYS;

export type RunStageId = 'observation' | 'contact' | 'month_end';

export interface RunStage {
  id: RunStageId;
  label: string;
  dayRange: string;
  description: string;
}

/** 30日ランを3期に分ける。既存の4異常を各期で反復し、日数に応じた空気を作る。 */
export function getRunStage(day: number): RunStage {
  if (day <= 10) {
    return {
      id: 'observation',
      label: '第1期 観察',
      dayRange: '1〜10日',
      description: '低リスクの反復業務で、前兆・速度・呼称・位相の違いを学ぶ時期。',
    };
  }
  if (day <= 20) {
    return {
      id: 'contact',
      label: '第2期 接触',
      dayRange: '11〜20日',
      description: '同じ試験室の再割当が増え、過去の自分の記録と照合する時期。',
    };
  }
  return {
    id: 'month_end',
    label: '第3期 月末',
    dayRange: '21〜30日',
    description: '月末処分が迫り、脱走・有用認定・通常処分の分岐が近づく時期。',
  };
}

const ROOM_ROTATION: ReadonlyArray<{
  roomCode: RoomCode;
  anomalyId: DayScheduleEntry['anomalyId'];
}> = [
  { roomCode: 'T-101', anomalyId: 'A_GAIT' },
  { roomCode: 'T-204', anomalyId: 'B_BADGE' },
  { roomCode: 'T-309', anomalyId: 'D_WHITEDOOR' },
];

// 初回7日間の担当官配置を繰り返し、声の聞き分けを各期で再確認できるようにする。
const RESEARCHER_ROTATION: readonly ResearcherId[] = [
  'Researcher-A',
  'Researcher-A',
  'Researcher-B',
  'Researcher-B',
  'Researcher-B',
  'Researcher-A',
  'Researcher-B',
];

function briefingWordFor(day: number, roomCode: RoomCode): string {
  if (roomCode === 'T-101') {
    return day === FINAL_DAY ? '最終回収' : day <= 10 ? '回収' : '再回収';
  }
  if (roomCode === 'T-204') {
    return day <= 10 ? '応答' : '照合';
  }
  return day <= 10 ? '記録' : '再記録';
}

/**
 * 30日間の固定割当表。
 * 1〜29日目は T-101 / T-204 / T-309 の3室を順に巡回し、30日目だけ最終回収としてT-101へ戻す。
 * 異常の変動パラメータは施設サイクル内で固定されるため、日ごとに抽選し直さない。
 */
export const THIRTY_DAY_SCHEDULE: DayScheduleEntry[] = Array.from(
  { length: RUN_LENGTH_DAYS },
  (_, index) => {
    const day = index + 1;
    const base =
      day === FINAL_DAY
        ? { roomCode: 'T-101' as RoomCode, anomalyId: 'A_GAIT' as const }
        : ROOM_ROTATION[(day - 1) % ROOM_ROTATION.length];

    return {
      day,
      roomCode: base.roomCode,
      anomalyId: base.anomalyId,
      researcher: RESEARCHER_ROTATION[(day - 1) % RESEARCHER_ROTATION.length],
      briefingWord: briefingWordFor(day, base.roomCode),
      isRoleEvalEligible: ROLE_EVAL_DAYS.includes(day),
      hasWaterCoolerSetup: WATER_COOLER_INSTALL_DAYS.includes(day),
      hasSafeReevalUnlock: day === SAFE_REEVAL_UNLOCK_DAY,
      isFinalDay: day === FINAL_DAY,
    };
  }
);

/** @deprecated 7日MVPの互換用。新規実装は THIRTY_DAY_SCHEDULE を使う。 */
export const SEVEN_DAY_SCHEDULE: DayScheduleEntry[] = THIRTY_DAY_SCHEDULE.slice(0, 7);

export const ORIENTATION_DOCUMENT = {
  title: 'Dクラス職員 配属時交付文書 [様式 D-07]',
  body: [
    '1. 貴殿は第██収容区画の試験補助要員として登録された。担当対象・分類番号・収容経緯の開示権限は付与されない（NEED TO KNOW 原則）。',
    '2. 30日後に当区画の定期評価および除籍処理を実施する。期間中の業務指示はインターホン経由で伝達される。',
    '3. 期間は第1期（1〜10日）観察、第2期（11〜20日）接触、第3期（21〜30日）月末評価に区分される。各期の割当内容は当日まで開示されない。',
    '4. 支給された携帯ノートは区画内での所持を許可する。ただし保安検査・処置の対象となり得る。',
    '5. 試験室への任意持込品は最大2点までとする（試験必須支給品は別枠）。',
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
      if (WATER_COOLER_INSTALL_DAYS.includes(day)) {
        return {
          dialogue:
            '「今朝、共用室（W-00）にまた給水器が置かれた。管理票の設置日が空欄で、掲示板の点呼票には同じ番号が二重に印字されている。飲んだ翌々日から人数が合わないって話だ。」',
          rumorCard: {
            id: 'rumor-w00-headcount',
            statement: '「共用室の給水器を飲んだ者の房では、2〜3日後の点呼から人数が合わなくなる」',
            observedDayNote: `現サイクル第${day}日（点呼票の二重印字と一致）`,
          },
        };
      }
      if (day <= 20) {
        return {
          dialogue:
            '「T-309の扉の向こうは、照明が脈打った直後に部屋の並びが入れ替わるらしい。青い非常灯の下にいた奴だけが無傷で帰ってきた。」',
          rumorCard: {
            id: 'rumor-t309-bluelight',
            statement: '「T-309では照明が脈打つと構造が変わるが、青い非常灯の固定点にいれば巻き込まれない」',
            observedDayNote: '現サイクル第2日（帰還班の搬送記録より）',
          },
        };
      }
      return {
        dialogue:
          '「月末の朝、区画の外門へ続く検問は監督官用の名札で通れる。だが最後の外門は生体認証だ。名札で人の目は誤魔化せても、機械の登録は変わらないらしい。」',
        rumorCard: {
          id: 'rumor-final-day-gate',
          statement:
            '「30日目の朝、監督用名札で有人検問は通過できるが、外門の生体認証は名札では通過できない」',
          observedDayNote: `現サイクル第${day}日（搬送班の会話より）`,
        },
      };
    },
  },
  {
    id: 'cm-veteran',
    code: 'D-3891（東側寝台）',
    roleHint: '以前の施設サイクルから残っている古参',
    morningTalk: (day: number) => {
      if (day <= 10) {
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
      if (day <= 20) {
        return {
          dialogue:
            '「T-204で別人の名札を着けたら、外した後も翌朝の点呼まで職員の目にはその番号に見える。だが配給窓口の機械端末だけは元の生体IDを読む。もし危険割当の番号を押し付けられたら、処遇票と自分の番号の不一致を窓口で示して再照合を受けろ。」',
          rumorCard: {
            id: 'rumor-t204-terminal',
            statement: '「T-204の名札効果は人間には翌朝まで残るが、機械端末は元のIDを読むため再照合で訂正できる」',
            observedDayNote: '旧施設コード SITE-19-C00 第4日観察',
          },
        };
      }
      return {
        dialogue:
          '「月末評価は、同じ人物で指定評価業務を2回通したかを見る。途中で死んで次の奴に代わっても、前の奴の評価は引き継がれない。29日目の夜まで生きて、信用を積んでおけ。」',
        rumorCard: {
          id: 'rumor-useful-certification',
          statement:
            '「指定評価業務を同一人物で2回完遂し、信用が高く疑念が低ければ、月末の除籍を免れて継続配属になる」',
          observedDayNote: '旧施設コード SITE-19-C00 第29日記録',
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
      if (WATER_COOLER_INSTALL_DAYS.includes(day)) {
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
      if (day >= 25) {
        return {
          dialogue:
            '「29日目の夜までに信用を積んで疑念を抑えておけば、安全な再評価業務の後に監督用の名札が下りることがあるらしい。30日目の朝、それでどこまで通れるかは……試した奴の記録が残っていない。」',
          rumorCard: {
            id: 'rumor-day29-supervisor',
            statement:
              '「29日目の夜の安全な再評価業務で、信用が高く疑念が低ければ監督用名札が支給される」',
            observedDayNote: '現サイクル保安係の雑談より',
          },
        };
      }
      return {
        dialogue:
          '「事後聴取で『実験の条件は全部知っている』なんて根拠なしに言い張ると、機密漏洩を疑われて疑念（S）が跳ね上がるぞ。月末まで生きるなら、余計な知識の誇示は控えろ。」',
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
      description: '自分で観測して記録した事実だけを話す（疑念は上がらない）',
      requiresEvidenceId: specific.reqId,
    },
    {
      id: 'choice-excuse',
      label: '「足が痛くて遅れた／手順の確認に手間取った」',
      category: 'excuse',
      description: '体調や不慣れのせいにする（作業を終えていれば信用は変わらない。未達なら信用-1。疑念は上がらない）',
    },
    {
      id: 'choice-unfounded-boast',
      label: '「実験の条件は全部知っている」（知識の誇示）',
      category: 'unfounded_secret',
      description: '仕組みを全部知っていると言い張る（自分の観測記録が根拠になければ疑念+1）',
    },
    {
      id: 'choice-silent',
      label: '「……（話さない）」',
      category: 'silent',
      description: '何も話さない（疑念は上がらない。作業が未達なら信用-1）',
    },
    {
      id: 'choice-submit-memo',
      label: '「隠しメモ・封筒の記録を任意提出する」',
      category: 'submit_hidden_memo',
      description: '封筒やメモを差し出して協力を示す（信用+1・疑念+1。封筒のメモは没収。1回の試験で1度まで）',
      requiresEnvelopeOrNote: true,
    },
    {
      id: 'choice-quote-unauthorized',
      label: '「黒塗り機密文書の内部規定について言及する」',
      category: 'quote_unauthorized_doc',
      description: '無許可で読んだ機密文書の内容を話す（疑念+1）',
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
    summary:
      '監督用名札により人間の門衛を通過したが、外門の生体認証で不一致が検出され拘束された。',
    detail:
      '30日目の朝、支給された監督用名札を着用して収容区画の有人検問を通過した。門衛は貴殿を監督官として扱ったが、最終外門の生体認証端末は元の被験者IDを読み取り遮断ロックが作動した。\n\n【開示記録（部分）】対象コード T-204 の認識改変は人間の知覚に限定され、機械認証および生体登録データを書き換えない。本格的な外部脱出経路の構築は次段階の課題として記録される。',
  },
  termination_shortage: {
    title: '終了分岐 2：処分・欠員補充停止',
    code: 'END-02 [CYCLE TERMINATED - SUBJECT LOST ON DAY 30]',
    summary:
      '最終評価日（30日目）に現被験者が死亡したため、欠員補充が停止され区画サイクルが終了した。',
    detail:
      '30日目の業務中に被験者の反応消失を確認。区画定期評価日のため新規Dクラスの補充は行われず、現サイクルの試験記録は凍結された。\n\n【開示記録（1件）】試験室 T-101 事後抄録：対象は被験者の移動速度が規定閾値を超過した際にのみ接近を開始する。停止または低速移動の継続により接近状態は解除される。正式分類番号：███-JP（未開示）。',
  },
  certified_useful: {
    title: '終了分岐 3：有用認定',
    code: 'END-03 [RETAINED AS SPECIALIST D-CLASS]',
    summary:
      '16日目・30日目の指定評価業務を同一人物で完遂し、高い信用と低い疑念を維持したため翌月への継続配属が決定した。',
    detail:
      '「区画定期評価通知：被験者は危険環境下での高い業務遂行能力（評価2回）と従順な協力姿勢（信用2以上）、および保安上の低リスク（疑念1以下）を実証した。よって月末の除籍処理を免除し、専属検証要員として次期サイクルへ継続配属する。」\n\n貴殿は生き延びた。ただしそれは自由ではなく、「使える消耗品」として次の実験リストへ名前が載り続けることを意味する。',
  },
  termination_standard: {
    title: '終了分岐 4：処分',
    code: 'END-04 [STANDARD DECOMMISSIONING]',
    summary: '30日間の評価期間が満了し、規定の除籍処理が執行された。',
    detail:
      '「区画定期評価通知：30日間の試験補助期間満了に伴い、規定手順に基づき当該被験者の除籍処理を執行する。収集された行動ログは第██研究部門へ移管された。」\n\n【開示記録（1件）】当区画で実施された試験（T-101 / T-204 / W-00 / T-309）の被験者観測ログは次期サイクルの基礎資料として保管される。正式番号および起源の開示権限：なし。',
  },
};
