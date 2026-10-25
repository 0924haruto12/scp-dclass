import { envelopeReadable, collectibleNotes } from '../core/model.js';
import {
  INTERVIEW_LABELS,
  interviewOptions,
  perceivedStatus,
} from '../core/progress.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function slots(count) {
  return `
    <span class="slot-meter" aria-label="残り行動枠 ${count}">
      ${Array.from({ length: 2 }, (_, index) => `<span class="slot-dot ${index < count ? 'full' : 'used'}"></span>`).join('')}
      <span>残り ${count}</span>
    </span>
  `;
}

function statusChips(game) {
  const status = perceivedStatus(game.subject);
  return `
    <div class="stat-row">
      <span class="chip">配給札 <strong>${escapeHtml(status.ration)}</strong></span>
      <span class="chip">監視 <strong>${escapeHtml(status.watch)}</strong></span>
      <span class="chip">役割 <strong>${escapeHtml(status.role)}</strong></span>
      ${game.cycle.flags.supervisorBadge ? '<span class="chip">所持 <strong>監督用名札</strong></span>' : ''}
    </div>
  `;
}

function reportItems(reports, limit = 6) {
  if (reports.length === 0) return '<div class="empty">記録はまだない。</div>';
  return `
    <div class="report-list">
      ${reports
        .slice(-limit)
        .reverse()
        .map(
          (report) => `
        <article class="report-item">
          <header>
            <span>${escapeHtml(report.facility)} / ${escapeHtml(report.cycleId)} / 第${report.day}日 / ${escapeHtml(report.subject)}</span>
            <span>${escapeHtml(report.kind)}</span>
          </header>
          <h4>${escapeHtml(report.title)}</h4>
          <p>${escapeHtml((report.lines || []).join('\n'))}</p>
        </article>`,
        )
        .join('')}
    </div>
  `;
}

export function renderTitle(state) {
  const { hasSave, corrupt, saveInfo } = state;
  return `
    <div class="eyebrow">SITE-12 / D-CLASS ORIENTATION</div>
    <h1>NEED TO KNOW</h1>
    <p class="lede">
      説明されない実験に送り込まれ、観察と推理だけで生存手順を組み立てるサバイバルホラー。
      この試作は通路試験1室の縦切りで、朝・召集・実験・聴取・夜・死亡継承・保存までを実装している。
    </p>

    ${
      corrupt
        ? `<div class="notice danger">
            <strong>保存データを読み込めなかった。</strong>
            元の文字列は上書きせず保持している。退避してから新しいサイクルを始められる。
            <div class="actions">
              <button type="button" class="btn danger" data-action="quarantine">破損データを退避して新規開始</button>
            </div>
          </div>`
        : ''
    }

    <div class="grid">
      <section class="panel">
        <div class="panel-title"><span>この試作にあるもの</span></div>
        <ul class="plain">
          <li>通路試験の移動・速度・前兆の判定</li>
          <li>回収後の走行指示と評価の交換</li>
          <li>観測・伝聞・仮説のノート、夜の封筒複写</li>
          <li>聴取、疑念、記憶処理</li>
          <li>死亡後の被験者交代と日付の継承</li>
          <li>保存と破損時の上書き防止</li>
        </ul>
      </section>
      <section class="panel dim">
        <div class="panel-title"><span>この試作にないもの</span></div>
        <ul class="plain">
          <li>名札・給水器・白い扉（未実装）</li>
          <li>手続き生成、幻覚、体力、NPCの自律生活</li>
          <li>脱走の成功、本編の30日構造</li>
          <li>人によるプレイテストと数値の実測</li>
        </ul>
        <p class="small">距離・秒数・閾値はすべて試作用の初期値で、実測値ではない。</p>
      </section>
    </div>

    <div class="actions">
      ${hasSave ? `<button type="button" class="btn primary" data-action="continue">続きから<span class="sub">${escapeHtml(saveInfo)}</span></button>` : ''}
      <button type="button" class="btn ${hasSave ? '' : 'primary'}" data-action="new-cycle">新しいサイクル<span class="sub">${hasSave ? '現在の保存を上書きする' : '第1日から開始'}</span></button>
      <button type="button" class="btn" data-action="open-help">遊び方</button>
      ${state.reports.length ? '<button type="button" class="btn" data-action="open-archive">事後報告履歴</button>' : ''}
    </div>

    <p class="small" style="margin-top:26px">
      音と字幕は同じイベントから出る。音量0でも字幕で前兆が届く。数値ゲージは表示しない。
    </p>
  `;
}

export function renderMorning(game) {
  const envelope = game.cycle.envelope;
  const readable = envelopeReadable(game);
  const day = game.cycle.day;
  const isFinal = day === 7;

  return `
    <div class="eyebrow">第${day}日 / 朝 / ${escapeHtml(game.cycle.facility)} 収容区画</div>
    <h2>朝 — 行動枠 ${game.cycle.slots.morning}</h2>
    <p class="lede">被験者 ${escapeHtml(game.subject.number)}。今日の召集までは自由時間がある。</p>

    ${statusChips(game)}

    <div class="grid">
      <section class="panel">
        <div class="panel-title">
          <span>朝の行動</span>
          ${slots(game.cycle.slots.morning)}
        </div>
        <div class="action-list">
          <button type="button" class="btn" data-action="morning-document" ${game.cycle.slots.morning <= 0 ? 'disabled' : ''}>
            配布文書を読む <span class="cost">1枠</span>
          </button>
          <button type="button" class="btn" data-action="morning-talk" ${game.cycle.slots.morning <= 0 ? 'disabled' : ''}>
            同房者と話す <span class="cost">1枠</span>
          </button>
          <button type="button" class="btn" data-action="morning-submit" ${!readable || game.cycle.slots.morning <= 0 ? 'disabled' : ''}>
            封筒を研究員に提出する <span class="cost">1枠 / 物証を渡す</span>
          </button>
        </div>
        <div class="actions">
          <button type="button" class="btn" data-action="open-notebook">ノートを開く <span class="sub">枠を消費しない</span></button>
          <button type="button" class="btn primary" data-action="summons">召集に応じる<span class="sub">実験室 A-01 へ</span></button>
        </div>
        ${
          isFinal && game.cycle.flags.supervisorBadge
            ? `<div class="notice" style="margin-top:18px">
                監督用名札がある。門衛の検問を通過できるかもしれない。
                <div class="actions">
                  <button type="button" class="btn danger" data-action="attempt-escape">脱走を試みる</button>
                </div>
              </div>`
            : ''
        }
      </section>

      <section class="panel dim">
        <div class="panel-title"><span>寝台下の封筒</span></div>
        ${
          envelope.confiscated
            ? '<p class="small">提出済み。手元にはない。</p>'
            : envelope.items.length === 0
              ? '<p class="small">空。夜に携帯ノートから3件まで複写できる。</p>'
              : readable
                ? `
                  <p class="small">封が切られている。昨日の筆跡で、次のように書かれている。</p>
                  <div class="card-list">
                    ${envelope.items
                      .map(
                        (item) => `
                      <div class="card">
                        <div class="card-meta">第${item.day}日 / ${escapeHtml(item.room || item.speaker || '複写')}</div>
                        <div class="card-text">${escapeHtml(item.text)}</div>
                      </div>`,
                      )
                      .join('')}
                  </div>
                `
                : `<p class="small">封をされている。第${envelope.readableOn}日の朝に読める。</p>`
        }
      </section>
    </div>

    <p class="small">行動枠を使い切っても召集はできる。ノートを開くこと自体は枠を使わない。</p>
  `;
}

export function renderNight(game) {
  const envelope = game.cycle.envelope;
  return `
    <div class="eyebrow">第${game.cycle.day}日 / 夜 / ${escapeHtml(game.cycle.facility)} 収容区画</div>
    <h2>夜 — 行動枠 ${game.cycle.slots.night}</h2>
    <p class="lede">消灯前。ノートを整理し、翌朝に残すものを選ぶ。</p>

    ${statusChips(game)}

    <div class="grid">
      <section class="panel">
        <div class="panel-title">
          <span>夜の行動</span>
          ${slots(game.cycle.slots.night)}
        </div>
        <div class="action-list">
          <button type="button" class="btn" data-action="open-notebook">ノートを整理する <span class="cost">0枠</span></button>
          <button type="button" class="btn" data-action="open-envelope-copy" ${game.cycle.slots.night <= 0 ? 'disabled' : ''}>
            封筒へ複写する <span class="cost">1枠 / 最大3件</span>
          </button>
          <button type="button" class="btn" data-action="night-talk" ${game.cycle.slots.night <= 0 ? 'disabled' : ''}>
            同房者と話す <span class="cost">1枠</span>
          </button>
          <button type="button" class="btn" data-action="night-work" ${game.cycle.slots.night <= 0 || game.cycle.dailySafeWorkDone ? 'disabled' : ''}>
            安全な追加業務をこなす <span class="cost">1枠 / 評価の立て直し</span>
          </button>
        </div>
        <div class="actions">
          <button type="button" class="btn primary" data-action="sleep">就寝する<span class="sub">${game.cycle.day >= 7 ? '最終評価へ' : '翌朝へ'}</span></button>
        </div>
      </section>

      <section class="panel dim">
        <div class="panel-title"><span>封筒</span></div>
        ${
          envelope.confiscated
            ? '<p class="small">提出済み。手元にはない。</p>'
            : envelope.items.length === 0
              ? '<p class="small">まだ何も入っていない。複写は夜の行動枠を1つ使う。</p>'
              : `<p class="small">${envelope.items.length}件を封入済み。第${envelope.readableOn}日の朝に読める。</p>
                 <div class="card-list">
                   ${envelope.items
                     .map(
                       (item) => `<div class="card"><div class="card-meta">${escapeHtml(item.text.slice(0, 28))}…</div></div>`,
                     )
                     .join('')}
                 </div>`
        }
        <hr />
        <p class="small">携帯ノートは記憶処理で直近1日の写しが消える。封筒は残るが、研究員に見せると没収される。</p>
      </section>
    </div>
  `;
}

export function renderInterview(game, ui) {
  const interview = game.interview;
  if (!interview) return '<div class="empty">聴取データがない。</div>';
  const trial = game.trial;

  const summary = [
    `回収物: ${trial?.box.collected ? '受領' : '未回収'}`,
    `退出: ${trial?.outcome === 'survived' ? '確認' : trial?.outcome === 'timeout' ? '期限超過' : '未確認'}`,
    `走行区間: ${trial?.load.spanSatisfied ? '走破' : '未達'}`,
    `観測カード: ${game.subject.observations.length}件`,
  ].join(' / ');

  if (interview.resolved) {
    const result = ui.interviewResult;
    const notices = [];
    if (result?.appliedCredit > 0) notices.push('配給記録に加点が入った。');
    if (result?.appliedCredit < 0) notices.push('配給記録に減点が入った。');
    if (result?.suspicionDelta > 0) notices.push('聴取の記録に、こちらの発言が残った。');
    if (result?.confiscated) notices.push('メモは没収された。');
    if (result?.memoryProcessed) notices.push('記憶処理が行われ、直近1日の携帯写しが消えた。封筒は残っている。');

    return `
      <div class="eyebrow">事後 / 聴取</div>
      <h2>聴取を終えた</h2>
      <div class="panel">
        <p>${escapeHtml(interview.text || '')}</p>
        ${notices.map((text) => `<div class="notice">${escapeHtml(text)}</div>`).join('')}
      </div>
      <p class="small">${escapeHtml(summary)}</p>
      <div class="actions">
        <button type="button" class="btn primary" data-action="to-night">夜へ</button>
        <button type="button" class="btn" data-action="open-notebook">ノートを確認する</button>
      </div>
    `;
  }

  return `
    <div class="eyebrow">第${game.cycle.day}日 / 事後 / 聴取</div>
    <h2>聴取</h2>
    <div class="paper" style="margin-bottom:18px">
      <span class="stamp">DEBRIEF</span>
      <h2>実験後聴取 / 第${game.cycle.day}日</h2>
      <div class="line">被験者: ${escapeHtml(game.subject.number)}</div>
      <div class="line">${escapeHtml(summary)}</div>
      <div class="line">研究員: 「では、なぜそう動いた？」</div>
      <div class="line fine">返答の正しさは採点されない。観測と説明の選び方が記録される。</div>
    </div>
    <div class="action-list">
      ${interviewOptions(game)
        .map((choice) => {
          const label = INTERVIEW_LABELS[choice];
          const hint =
            choice === 'submit'
              ? '封筒の中身を渡す。評価と引き換えに、物証と秘密を渡すことになる。'
              : '';
          return `<button type="button" class="btn" data-action="answer" data-choice="${choice}">
            ${escapeHtml(label)}${hint ? `<span class="sub">${escapeHtml(hint)}</span>` : ''}
          </button>`;
        })
        .join('')}
    </div>
    <p class="small">迷ったら、実際に見たことを選ぶ。ゲームは仮説の文章や正解の選択を読んで判定しない。</p>
  `;
}

export function renderDeath(game, ui) {
  const report = game.pendingDeath;
  const isFinal = game.cycle.day >= 7;
  return `
    <div class="eyebrow">第${game.cycle.day}日 / 死亡報告</div>
    <div class="paper">
      <span class="stamp">DECEASED</span>
      <h2>${escapeHtml(report?.title || '死亡報告')}</h2>
      ${(report?.lines || [])
        .map(
          (line, index) =>
            `<div class="line">${escapeHtml(line)}${index === 1 ? ' <span class="redacted">REDACTED</span>' : ''}</div>`,
        )
        .join('')}
      <div class="line fine">施設コード ${escapeHtml(game.cycle.facility)} / 記録 ${escapeHtml(report?.id || '')}</div>
      <div class="sign">被験者管理課</div>
    </div>
    <div class="actions">
      <button type="button" class="btn primary" data-action="after-death">
        ${isFinal ? '終了判定へ' : '翌朝へ（新しい被験者）'}
      </button>
      <button type="button" class="btn" data-action="open-notebook">ノートを確認する</button>
    </div>
    <p class="small">死亡した日は再実験しない。日付は1つだけ進み、同日の事後と夜は飛ばされる。</p>
    ${ui.deathNotice ? `<div class="notice">${escapeHtml(ui.deathNotice)}</div>` : ''}
  `;
}

export function renderEnding(game) {
  const ending = game.cycle.ending;
  return `
    <div class="eyebrow">${escapeHtml(game.cycle.facility)} / 第${game.cycle.number}サイクル / 終了</div>
    <h1 style="font-size:24px; letter-spacing:0.14em">${escapeHtml(ending?.title || '終了')}</h1>
    <p class="lede">${escapeHtml(ending?.body || '')}</p>

    <div class="grid-3">
      <div class="panel"><div class="panel-title"><span>到達日</span></div><div class="mono">第${game.cycle.day}日</div></div>
      <div class="panel"><div class="panel-title"><span>被験者</span></div><div class="mono">${escapeHtml(game.subject.number)}</div></div>
      <div class="panel"><div class="panel-title"><span>交代回数</span></div><div class="mono">${game.cycle.subjectSerial - 1}</div></div>
    </div>

    <section class="panel">
      <div class="panel-title"><span>事後報告履歴</span><span class="value">${game.reports.length}件</span></div>
      ${reportItems(game.reports, 8)}
    </section>

    <div class="actions">
      <button type="button" class="btn primary" data-action="new-cycle">新しいサイクル<span class="sub">新しいseedで開始</span></button>
      <button type="button" class="btn" data-action="open-archive">履歴をすべて見る</button>
      <button type="button" class="btn" data-action="to-title">タイトルへ</button>
    </div>
  `;
}

export function renderArchive(game, returnAction = 'to-title') {
  return `
    <div class="eyebrow">${escapeHtml(game.cycle.facility)} / 記録</div>
    <h2>事後報告履歴</h2>
    <p class="lede">プレイヤーだけが閲覧できる画面。現在の被験者がこの文書を持っている扱いにはしない。旧サイクルの記録は当時の施設コードで表示する。</p>
    <section class="panel">
      ${reportItems(game.reports, 60)}
    </section>
    <div class="actions">
      <button type="button" class="btn" data-action="${returnAction}">戻る</button>
    </div>
  `;
}

export function renderHelp() {
  return `
    <div class="eyebrow">操作と公正さの契約</div>
    <h2>遊び方</h2>
    <div class="grid">
      <section class="panel">
        <h3>操作</h3>
        <dl class="kbd-list">
          <dt>W A S D / 矢印</dt><dd>移動</dd>
          <dt>Shift（保持）</dt><dd>走行</dd>
          <dt>C</dt><dd>低速歩行の切替</dd>
          <dt>Z（保持）</dt><dd>低速歩行</dd>
          <dt>E / クリック</dt><dd>調べる・回収する</dd>
          <dt>マウス</dt><dd>向き。向きだけでは速度は変わらない</dd>
          <dt>Tab</dt><dd>ノート（実験時計を止める）</dd>
          <dt>Esc</dt><dd>ポーズ</dd>
        </dl>
        <p class="small">低速の切替状態はHUDに表示する。メニューを開いても勝手に歩き続けない。</p>
      </section>
      <section class="panel dim">
        <h3>この試作で守る約束</h3>
        <ul class="plain">
          <li>前兆は、致死より先に音・字幕・画面のいずれかで届く。</li>
          <li>前兆のあとには、入力を選べる猶予がある。</li>
          <li>ポーズ・ノート・設定・フォーカス喪失中は時計が止まる。</li>
          <li>施設内のルールはサイクル中に変わらない。同じ条件なら同じことが起きる。</li>
          <li>前兆に反応したこと自体では疑念は増えない。</li>
          <li>死んでも日付は1つだけ進み、施設のルールと隠したものは残る。</li>
        </ul>
        <p class="small">解除の具体的な条件は表示しない。実験の中で観察する。</p>
      </section>
    </div>
    <div class="actions">
      <button type="button" class="btn primary" data-action="close-modal">閉じる</button>
    </div>
  `;
}

export function renderNotebook(game, ui) {
  const subject = game.subject;
  const tab = ui.notebookTab || 'observation';
  const notes = collectibleNotes(game);
  const tabs = [
    ['observation', `観測 ${subject.observations.length}`],
    ['hearsay', `伝聞 ${subject.hearsays.length}`],
    ['hypothesis', `仮説 ${subject.hypotheses.filter((entry) => !entry.cleared).length}`],
    ['envelope', '封筒'],
    ['reports', '事後報告'],
  ];

  let body = '';
  if (tab === 'observation' || tab === 'hearsay') {
    const list = tab === 'observation' ? subject.observations : subject.hearsays;
    body = list.length
      ? `<div class="card-list">${list
          .map(
            (card) => `
          <article class="card">
            <div class="card-meta">${
              tab === 'observation'
                ? `第${card.day}日 / ${escapeHtml(card.room)} / ${escapeHtml(card.observer)}`
                : `第${card.day}日 入手 / ${escapeHtml(card.speaker)} / 観察日 ${card.observedDay ? `第${card.observedDay}日` : '不明'}`
            }</div>
            <div class="card-text">${escapeHtml(card.text)}</div>
          </article>`,
          )
          .join('')}</div>`
      : `<div class="empty">${tab === 'observation' ? '観測はまだない。' : '伝聞はまだない。誰かと話すと増える。'}</div>`;
    if (tab === 'observation') {
      body += `<p class="small">観測カードの内容は書き換えられない。記憶処理では直近1日の写しが消える。</p>`;
    } else {
      body += `<p class="small">伝聞は正誤を表示しない。話者・入手日・話者の観察日を手がかりに、他の記録と比べる。</p>`;
    }
  }

  if (tab === 'hypothesis') {
    const cards = subject.hypotheses;
    body = `
      ${
        cards.length
          ? `<div class="card-list">${cards
              .map((card) =>
                card.cleared
                  ? `<article class="card hypothesis"><div class="card-meta">第${card.day}日 / 記憶処理</div><div class="card-text">未記入</div></article>`
                  : `<article class="card hypothesis">
                      <div class="card-meta">第${card.day}日 / 仮説</div>
                      <div class="card-text"><strong>${escapeHtml(card.title || '（無題）')}</strong>
                      ${card.trigger ? `\nきっかけ: ${escapeHtml(card.trigger)}` : ''}
                      ${card.effect ? `\n起きること: ${escapeHtml(card.effect)}` : ''}
                      ${card.condition ? `\n条件: ${escapeHtml(card.condition)}` : ''}
                      ${card.basis ? `\n根拠: ${escapeHtml(card.basis)}` : ''}
                      ${card.note ? `\n${escapeHtml(card.note)}` : ''}</div>
                    </article>`,
              )
              .join('')}</div>`
          : '<div class="empty">仮説はまだない。正誤は判定されない。</div>'
      }
      <hr />
      <h3>仮説を追加する</h3>
      <form data-form="hypothesis">
        <div class="grid">
          <div class="field"><label for="h-title">呼び名</label><input id="h-title" name="title" maxlength="80" placeholder="自分で付ける" /></div>
          <div class="field"><label for="h-trigger">きっかけ</label><input id="h-trigger" name="trigger" maxlength="200" placeholder="何をした時か" /></div>
          <div class="field"><label for="h-effect">起きること</label><input id="h-effect" name="effect" maxlength="200" placeholder="何が起きたか" /></div>
          <div class="field"><label for="h-condition">条件</label><input id="h-condition" name="condition" maxlength="200" placeholder="いつ成り立つか" /></div>
          <div class="field"><label for="h-basis">根拠にしたカード</label><input id="h-basis" name="basis" maxlength="200" placeholder="観測・伝聞との対応" /></div>
          <div class="field"><label for="h-note">自由文</label><textarea id="h-note" name="note" maxlength="600" placeholder="確かめたいこと、疑っていること"></textarea></div>
        </div>
        <button type="submit" class="btn primary">仮説を記録する</button>
      </form>
      <p class="small">空欄も許可される。ゲームは仮説の文字列を読んで疑念・割当・終了を決めない。</p>
    `;
  }

  if (tab === 'envelope') {
    const canCopy =
      game.cycle.phase === 'night' &&
      game.cycle.slots.night > 0 &&
      !game.cycle.envelope.confiscated &&
      game.cycle.envelope.sealedDay !== game.cycle.day;
    const selected = ui.copySelection || new Set();
    body = `
      <p class="small">夜の行動枠1つで、観測・伝聞・仮説を合計3件まで封筒へ複写できる。封筒は翌朝に読める。</p>
      ${
        game.cycle.envelope.items.length
          ? `<h3>封入済み</h3><div class="card-list">${game.cycle.envelope.items
              .map(
                (item) =>
                  `<article class="card"><div class="card-meta">第${item.day}日 / ${escapeHtml(item.room || item.speaker || '複写')}</div><div class="card-text">${escapeHtml(item.text)}</div></article>`,
              )
              .join('')}</div>`
          : '<div class="empty">封筒は空。</div>'
      }
      ${
        canCopy
          ? `<hr /><h3>携帯ノートから選ぶ</h3>
            ${
              notes.length
                ? `<div class="action-list">${notes
                    .map(
                      (card) => `
                  <label class="option">
                    <input type="checkbox" data-copy-id="${card.id}" ${selected.has(card.id) ? 'checked' : ''} />
                    <span>${escapeHtml(card.text)}<small>第${card.day}日 / ${card.source === 'observation' ? '観測' : card.source === 'hearsay' ? '伝聞' : '仮説'}</small></span>
                  </label>`,
                    )
                    .join('')}</div>
                <div class="actions">
                  <button type="button" class="btn primary" data-action="copy-envelope">選択した項目を封入する<span class="sub">1枠 / 最大3件</span></button>
                </div>`
                : '<div class="empty">複写できるカードがない。</div>'
            }`
          : `<p class="small">${game.cycle.phase === 'night' ? '行動枠がないか、封筒は没収済み。' : '複写は夜にだけできる。'}</p>`
      }
    `;
  }

  if (tab === 'reports') {
    body = reportItems(game.reports, 40);
  }

  return `
    <div class="modal-head">
      <div>
        <h2>推理ノート</h2>
        <p class="small" style="margin:4px 0 0">${escapeHtml(subject.number)} / 第${game.cycle.day}日 / 観測・伝聞・仮説は由来が違う。</p>
      </div>
      <button type="button" class="link-button" data-action="close-modal">閉じる</button>
    </div>
    <div class="tabs">
      ${tabs
        .map(
          ([id, label]) =>
            `<button type="button" class="tab ${tab === id ? 'active' : ''}" data-action="notebook-tab" data-tab="${id}">${escapeHtml(label)}</button>`,
        )
        .join('')}
    </div>
    ${body}
  `;
}

export function renderSettings(game, storage) {
  return `
    <div class="modal-head">
      <div><h2>設定</h2><p class="small" style="margin:4px 0 0">字幕と音量は独立。片方を切っても他方は残る。</p></div>
      <button type="button" class="link-button" data-action="close-modal">閉じる</button>
    </div>
    <label class="checkline">
      <input type="checkbox" data-setting="captions" ${game.settings.captions ? 'checked' : ''} />
      字幕を表示する（音・画面の前兆と同じタイミングで出る）
    </label>
    <label class="checkline">
      音量
      <input type="range" min="0" max="100" value="${Math.round(game.settings.volume * 100)}" data-setting="volume" />
      <span class="mono" data-volume-label>${Math.round(game.settings.volume * 100)}</span>
    </label>
    <hr />
    <p class="small">保存: ${escapeHtml(storage.label)}</p>
    <div class="actions">
      <button type="button" class="btn" data-action="to-title">タイトルへ戻る<span class="sub">現在の状態を保存して中断する</span></button>
      <button type="button" class="btn" data-action="open-help">遊び方</button>
    </div>
    <p class="small" style="margin-top:18px">試作版 0.1 / 歩調の縦切り。名札・給水器・白い扉は未実装。</p>
  `;
}

export function renderPause() {
  return `
    <div class="modal-head">
      <div><h2>ポーズ</h2><p class="small" style="margin:4px 0 0">実験時計・指示期限・危険進行は止まっている。</p></div>
    </div>
    <div class="action-list">
      <button type="button" class="btn primary" data-action="resume">再開する</button>
      <button type="button" class="btn" data-action="open-notebook">ノートを開く</button>
      <button type="button" class="btn" data-action="open-settings">設定</button>
      <button type="button" class="btn" data-action="to-title">タイトルへ戻る<span class="sub">現在の状態を保存する</span></button>
    </div>
  `;
}

export function renderIntercom(trial) {
  return `
    <div class="modal-head">
      <div>
        <h2>インターホン</h2>
        <p class="small" style="margin:4px 0 0">${escapeHtml(trial.speaker)} / 実験室 ${escapeHtml(trial.roomCode)}</p>
      </div>
    </div>
    <p style="font-size:17px">「時間がありません。走ってください」</p>
    <p class="small">返答は行動を自動実行しない。走るかどうかは、実際の操作で判定される。返答中は実験時計が止まる。</p>
    <div class="action-list">
      <button type="button" class="btn primary" data-action="reply" data-reply="obey">従う</button>
      <button type="button" class="btn" data-action="reply" data-reply="delay">遅らせる<span class="sub">猶予を求める。時計は延びない</span></button>
      <button type="button" class="btn" data-action="reply" data-reply="refuse">逆らう<span class="sub">拒否を伝えた後も操作は続けられる</span></button>
      <button type="button" class="btn" data-action="reply" data-reply="question">質問する<span class="sub">指示ごとに1回だけ</span></button>
    </div>
  `;
}
