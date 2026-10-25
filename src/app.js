import { createGame, FIXED_SEED, startTrial, tick, respond, interview, leaveReport,
  addHypothesis, sealEnvelope, readEnvelope, safeDuty, sleep } from './game.js';
import { SaveStore } from './storage.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#scene'), ctx = canvas.getContext('2d');
const keys = new Set();
let storage;
try { storage = window.localStorage; } catch { storage = { getItem() { throw Error('ブラウザの保存が無効です。'); }, setItem() { throw Error('ブラウザの保存が無効です。'); } }; }
const store = new SaveStore(storage), loaded = store.load();
let game = loaded.game, title = true, pause = null, activeTab = 'observation';
let overlayKey = '', lastSerial = game?.serial || 0, saveAge = 0, slowLatched = false;
let lastFrame = performance.now(), accumulator = 0, footClock = 0, toastTimer;
let interactQueued = false;
let pointerFacing = 0, soundContext = null;
const activeSounds = new Set();
let subtitleType = 'voice', subtitleHold = 0;
const phaseLabels = { morning: '召集前', trial: '試験中', debrief: '聴取', report: '事後報告', night: '消灯前', death: '信号消失', complete: '試作終了' };

function el(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
}
function button(text, action, className = '') {
  const b = el('button', text, className); b.addEventListener('click', action); return b;
}
function toast(text) {
  clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function save() {
  if (!game) return;
  const result = store.save(game);
  $('#save-label').textContent = result.ok ? '● このブラウザに保存済み' : '保存停止・元データを保護中';
  if (!result.ok) showStorageError(result.error);
  saveAge = 0;
}
function changed() { processEvents(); save(); renderNotes(); renderOverlay(true); updateHUD(); }
function showStorageError(message) {
  const box = $('#storage-error'); box.hidden = false; box.replaceChildren();
  box.append(el('p', `保存停止：${message} 元の記録は自動で置き換えません。`));
  box.append(button('元の保存データを書き出す', () => {
    exportText(store.raw ?? JSON.stringify(game), 'need-to-know-preserved.txt');
    const recover = button('原本を別枠に残して新規開始', () => {
      const result = store.recoverAfterExport();
      if (!result.ok) return toast(`保存領域を確保できません：${result.error}`);
      box.hidden = true; startNew(FIXED_SEED);
    });
    box.append(recover);
  }));
}
function exportText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = el('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function startNew(seed = FIXED_SEED) {
  if (store.blocked) return toast('保存原本を書き出し、別枠を作ってから開始してください。');
  const reports = game?.reports.slice(-200) || [];
  game = createGame(seed, `F-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase().padStart(8,'0')}`);
  game.reports = reports;
  title = false; pause = null; lastSerial = 0; keys.clear(); slowLatched = false;
  $('#subtitle').textContent = '召集を待っている。向こう側の様子は分からない。';
  changed();
}
function initAudio() {
  try {
    if (!soundContext) soundContext = new (window.AudioContext || window.webkitAudioContext)();
    if (soundContext.state === 'suspended') void soundContext.resume().catch(() => {});
  } catch { /* Visual perception remains available if audio is unavailable. */ }
}
function tone(freq, duration, loudness = 0.1, type = 'sine', delay = 0) {
  if (!soundContext || soundContext.state !== 'running' || pause || title) return;
  const volume = Number($('#volume').value);
  if (!volume) return;
  const start = soundContext.currentTime + delay;
  const oscillator = soundContext.createOscillator(), gain = soundContext.createGain();
  oscillator.type = type; oscillator.frequency.setValueAtTime(freq, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(25, freq * 0.55), start + duration);
  gain.gain.setValueAtTime(loudness * volume, start); gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain); gain.connect(soundContext.destination);
  oscillator.start(start); oscillator.stop(start + duration);
  activeSounds.add(oscillator); oscillator.onended = () => activeSounds.delete(oscillator);
}
function stopSound() { for (const oscillator of activeSounds) { try { oscillator.stop(); } catch { /* Already stopped. */ } } activeSounds.clear(); }
function processEvents() {
  if (!game) return;
  const events = game.events.filter(e => e.id > lastSerial);
  if (!events.length) return;
  lastSerial = game.serial;
  const ranked = [...events].sort((a, b) => (b.type === 'warning' ? 10 : b.type === 'retreat' ? 9 : b.type === 'voice' ? 5 : 1) - (a.type === 'warning' ? 10 : a.type === 'retreat' ? 9 : a.type === 'voice' ? 5 : 1));
  const e = ranked[0];
  if (e.type === 'warning') { tone(135, .32, .35, 'triangle'); tone(105, .4, .3, 'triangle', .15); subtitleHold = 3; }
  if (e.type === 'retreat') { tone(78, .6, .12, 'sine'); subtitleHold = 1; }
  if (e.type === 'voice') tone(680, .06, .03);
  if (subtitleHold > 0 && !['warning', 'retreat', 'result'].includes(e.type)) return;
  subtitleType = e.type;
  if ($('#subtitles-toggle').checked || ['voice', 'result'].includes(e.type)) {
    $('#subtitle').textContent = e.text;
    $('#channel-name').replaceChildren(document.createTextNode(['warning', 'retreat', 'perception', 'observation'].includes(e.type) ? 'PERCEPTION' : 'INTERCOM'), el('small', ['warning', 'retreat', 'perception', 'observation'].includes(e.type) ? '音の字幕 / C-04' : '研究員 A / 音声回線'));
  }
  renderNotes();
}
function setPause(reason) {
  if (!game || game.phase !== 'trial' || title) return;
  keys.clear(); interactQueued = false; slowLatched = false; pause = reason; stopSound(); accumulator = 0;
  save(); renderOverlay(true);
}
function resume() { canvas.focus({ preventScroll: true }); pause = null; keys.clear(); interactQueued = false; initAudio(); lastFrame = performance.now(); accumulator = 0; renderOverlay(true); }

function panel(eyebrow, heading, body) {
  const node = el('div', undefined, 'overlay-panel');
  node.append(el('p', eyebrow, 'eyebrow'), el('h2', heading));
  if (body) node.append(el('p', body, 'body-copy'));
  return node;
}
function actions(node, ...buttons) { const row = el('div', undefined, 'overlay-actions'); row.append(...buttons); node.append(row); }
function renderOverlay(force = false) {
  const key = `${title}:${pause}:${game?.phase}:${game?.day}:${game?.subject.id}`;
  if (!force && key === overlayKey) return;
  overlayKey = key;
  const overlay = $('#overlay'); overlay.replaceChildren();
  if (title) {
    const p = panel('SUBJECT INDUCTION / 施設内限り', '説明は、\n必要な分だけ。', '扉の向こうにあるものを、あなたは知らない。\n観察する。記録する。生きて戻る。\n指示に従うかどうかは、あなたが決める。');
    if (game) actions(p, button('記録から再開 →', () => { title = false; pause = game.phase === 'trial' ? 'resume' : null; initAudio(); changed(); }, 'primary'));
    else actions(p, button('被験者として入る →', () => { initAudio(); startNew(); }, 'primary'));
    p.append(el('p', '所要時間は未計測 / キーボード＋マウス\nこの試作では C-04 の1回の試験を検証します。', 'notice'));
    overlay.append(p); return;
  }
  if (pause && game?.phase === 'trial') {
    if (pause === 'notebook') return;
    const p = panel('SIMULATION PAUSED', { blur: '入力待ち', settings: '設定・記録を確認中', resume: '保存した場面から再開', manual: '一時停止中', notes: '記録を確認中' }[pause] || '一時停止中', '実験の時計、指示の期限、足音の進行は止まっています。\n再開すると、保存された位置と状況から続きます。');
    actions(p, button('操作を再開 →', resume, 'primary'), button('ノートを開く', openNotebook));
    overlay.append(p); return;
  }
  if (!game || game.phase === 'trial') return;
  let p;
  if (game.phase === 'morning') {
    p = panel(`DAY ${String(game.day).padStart(2, '0')} / ${game.subject.id}`, game.day === 1 ? '本日の業務：回収' : '次の被験者が入室した。', 'C-04 の奥にある保管箱を回収し、同じ扉へ戻ってください。\n試験は入室から120秒。扉のそばで E を押すと退出できます。\n室内はカメラで記録されています。');
    p.append(el('p', 'WASD：移動 / Shift：走行 / Alt：低速 / マウス：向き\nE：調べる・持つ・退出 / N：ノート / Esc：一時停止', 'notice'));
    if (game.day > 1) p.append(el('p', '施設の日付と部屋の状態は引き継がれています。携帯品は回収済みです。', 'notice'));
    actions(p, button('C-04 に入室 →', () => { initAudio(); startTrial(game); keys.clear(); changed(); }, 'primary'), button(game.envelope.length ? '寝台下の封筒を調べる' : '寝台下を調べる', () => {
      if (readEnvelope(game)) { changed(); toast('封筒を読んだ。写しを携帯ノートに残した。'); }
      else toast(game.envelope.length ? '封筒は確認済みです。' : '封筒は空だった。');
    }));
  } else if (game.phase === 'debrief') {
    p = panel('POST-TRIAL INTERVIEW / 研究員 A', '何がありましたか。', '研究員が用紙から目を上げる。\n「行動の理由を、聞かせてください。」');
    const choices = el('div', undefined, 'choice-list');
    const option = (label, value) => choices.append(button(label, () => { interview(game, value); changed(); }));
    if (game.subject.evidence.includes('approach') || game.subject.evidence.includes('stop')) option('「足音が聞こえたので、止まりました。」', 'observed');
    option('「足が痛くて、遅れました。」', 'pain');
    option('「実験の条件は、全部知っています。」', 'claim');
    option('何も話さない。', 'silent');
    if (game.envelope.length) option('寝台下のメモを提出する。', 'surrender');
    p.append(choices);
  } else if (game.phase === 'report' || game.phase === 'death') {
    const death = game.phase === 'death', r = game.reports.at(-1);
    p = panel(`INCIDENT RECORD / ${game.subject.id}`, death ? '応答、消失。' : '試験終了。');
    if (death) p.prepend(el('span', 'SUBJECT LOST', 'stamp'));
    p.append(el('p', r?.text || '記録なし', 'report-text'));
    p.append(el('p', 'これはプレイヤー向けの事後報告です。\n次の被験者がこの文書を持つわけではありません。', 'notice'));
    actions(p, button(death ? (game.day >= 7 ? '欠員補充を終了 →' : '翌日・次の被験者へ →') : '居住区へ戻る →', () => { leaveReport(game); changed(); }, 'primary'));
  } else if (game.phase === 'night') {
    p = panel('LIGHTS OUT / 居住区', '記録を、残しておく。', '手元のノートは回収されるかもしれない。\n寝台下の封筒には、3件まで写しを入れられる。');
    const checklist = el('div', undefined, 'checklist');
    const items = [...game.subject.cards, ...game.subject.hypotheses];
    for (const item of items) {
      const label = el('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = item.id;
      input.addEventListener('change', () => { if (checklist.querySelectorAll('input:checked').length > 3) { input.checked = false; toast('封筒に複写できるのは3件までです。'); } });
      label.append(input, el('span', item.text)); checklist.append(label);
    }
    if (items.length) p.append(checklist);
    actions(p, button('選んだ記録を封筒へ', () => {
      if (!sealEnvelope(game, [...checklist.querySelectorAll('input:checked')].map(i => i.value))) return toast('記録を選んでください。同じ夜の複写は1回までです。');
      changed(); toast('封筒を寝台の下に入れた。');
    }), button('安全な整理業務を手伝う', () => { if (safeDuty(game)) { changed(); toast('整理業務を終えた。研究員から配給札を受け取った。'); } else toast('この業務は完了済み、または行動枠がありません。'); }));
    p.append(el('p', `残りの行動枠：${game.nightActions} / 封筒：${game.envelope.length}件`, 'notice'));
    actions(p, button('消灯・今回の検証を終える →', () => { sleep(game); changed(); }, 'primary'));
  } else {
    p = panel('END OF VERTICAL SLICE', '今日の記録は、ここまで。', 'C-04 の操作縦切りは終了しました。\n7日間の日程と、ほかの部屋はまだ実装していません。\n記録はこのブラウザに残っています。');
    actions(p, button('同じ初期条件で新規開始', () => startNew(FIXED_SEED), 'primary'), button('別の施設サイクルを開始', () => startNew(crypto.getRandomValues(new Uint32Array(1))[0])));
    p.append(el('p', '新しいサイクルを始めると、日付・携帯記録・封筒は初期化されます。\n必要な記録は右下から書き出してください。', 'notice'));
  }
  overlay.append(p);
}

function noteCard(c, archive = false) {
  const card = el('article', undefined, 'note-card');
  card.append(el('div', archive ? `${c.cycleId} / DAY ${c.day} / ${c.subjectId}` : `${c.kind === 'hypothesis' ? 'HYPOTHESIS' : c.kind === 'hearsay' ? 'HEARSAY' : c.kind === 'envelope' ? 'ENVELOPE COPY' : 'OBSERVATION'} / DAY ${c.day} / ${c.observer || game?.subject.id}`, 'note-meta'), el('p', c.text));
  return card;
}
function hypothesisForm() {
  const form = el('form', undefined, 'hypothesis-form');
  const label = el('label', '呼び名・きっかけ・条件・根拠を自由に記録');
  const input = document.createElement('textarea'); input.maxLength = 1200; input.placeholder = 'まだ分からないことを書いてもよい。'; input.setAttribute('aria-label', '仮説の自由記入'); label.append(input);
  const b = el('button', '仮説を記録する'); b.type = 'submit';
  form.append(label, b);
  form.addEventListener('submit', e => { e.preventDefault(); if (!game) return toast('入室前は記録できません。'); if (addHypothesis(game, input.value)) { changed(); if ($('#notebook-dialog').open) fillNotebook(); toast('仮説を記録した。'); } });
  input.addEventListener('focus', () => setPause($('#notebook-dialog').open ? 'notebook' : 'notes'));
  return form;
}
function renderNotes() {
  const content = $('#note-content'); content.replaceChildren();
  const cards = game?.subject.cards || [];
  $('#observation-count').textContent = cards.filter(c => ['observation', 'envelope'].includes(c.kind)).length;
  if (activeTab === 'archive') {
    content.append(el('p', 'プレイヤー向け事後報告。現人物の所持品ではありません。', 'archive-note'));
    for (const r of game?.reports || []) content.append(noteCard(r, true));
  } else if (activeTab === 'hypothesis') {
    for (const c of game?.subject.hypotheses || []) content.append(noteCard(c));
    content.append(hypothesisForm());
  } else {
    const matching = cards.filter(c => activeTab === 'hearsay' ? c.kind === 'hearsay' : c.kind !== 'hearsay');
    for (const c of matching) content.append(noteCard(c));
    if (!matching.length) {
      const empty = el('div', undefined, 'empty-note'); empty.append(el('div', '⌑', 'empty-mark'), el('strong', 'このページは未記入。'), el('p', activeTab === 'hearsay' ? '誰かから聞いたことは、ここに残る。\n今回の試作には会話の収集は含まれていない。' : '見たこと、聞いたことが記録される。\n意味を決めるのは、あなた自身だ。')); content.append(empty);
    }
  }
}
function fillNotebook() {
  const body = $('#notebook-body'); body.replaceChildren();
  for (const c of game?.subject.cards || []) body.append(noteCard(c));
  for (const c of game?.subject.hypotheses || []) body.append(noteCard(c));
  body.append(hypothesisForm());
}
function openNotebook() {
  if (!game || title) return;
  setPause('notebook'); fillNotebook(); $('#notebook-dialog').showModal();
}
function closeNotebook() {
  $('#notebook-dialog').close();
  if (game?.phase === 'trial') { pause = 'manual'; renderOverlay(true); }
}

function updateHUD() {
  $('#subject-id').textContent = game?.subject.id || '—';
  $('#day-label').textContent = `${String(game?.day || 1).padStart(2, '0')} / DAY`;
  $('#cycle-id').textContent = game?.cycleId || '未発行';
  $('#phase-label').textContent = title ? '待機中' : pause ? '一時停止' : phaseLabels[game?.phase] || '待機中';
  const t = game?.trial;
  const seconds = t ? Math.max(0, Math.ceil(120 - t.elapsed - 1e-8)) : 120;
  $('#clock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('#motion-label').textContent = title || !t ? '● 被験者未入室' : pause ? 'Ⅱ 一時停止' : game.phase !== 'trial' ? '■ 実験記録終了' : `● ${slowLatched ? '低速切替 ON' : t.speed < .01 ? '停止' : t.speed <= 1.01 ? '低速歩行' : t.speed <= 2.01 ? '歩行' : '走行'}${t.hasBox ? ' / 保管箱を携帯' : ''}`;
  const showOrders = game?.phase === 'trial' && t?.instruction.issued && !title;
  $('#order-actions').hidden = !showOrders;
  $('#current-order').hidden = !showOrders;
  if (showOrders) for (const b of document.querySelectorAll('[data-response]')) b.disabled = b.dataset.response === 'question' ? t.instruction.asked : t.instruction.response !== null;
  $('#visual-cue').textContent = !title && game?.phase === 'trial' ? t.mode === 'approaching' ? '前兆表示\n足音が、背後で重なる。' : t.mode === 'retreating' ? '前兆表示\n足音が遠のいていく。' : '' : '';
  const prompt = $('#context-prompt'); prompt.replaceChildren();
  if (game?.phase === 'trial' && !title && !pause) {
    const text = t.x <= 1.5 ? 'E  入室扉から退出' : t.x >= 22 && !t.hasBox ? 'E  保管箱を受け取る' : t.x >= 6 && t.x <= 9 ? 'E  床の擦り跡を調べる' : t.x >= 15 && t.x <= 18 ? 'E  破れた回収票を調べる' : '';
    if (text) prompt.append(el('span', text));
  }
}

function draw() {
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#0b100e'; ctx.fillRect(0, 0, w, h);
  const t = game?.trial, active = !!t && !title;
  const corridor = { x: 88, y: 208, width: 1024, height: 138 };
  const unit = corridor.width / 24;
  const playerX = corridor.x + (t?.x || .8) * unit, playerY = corridor.y + corridor.height / 2 + (t?.y || 0) * 40;
  // Empty service rooms remain opaque; illumination is clipped to the corridor.
  ctx.strokeStyle = '#28372a'; ctx.lineWidth = 2;
  for (let n = 0; n < 4; n++) {
    const x = 150 + n * 265;
    ctx.fillStyle = '#101a14';ctx.fillRect(x, 73, 192, 115);ctx.strokeRect(x, 73, 192, 115);
    ctx.fillStyle = '#243526';ctx.fillRect(x + 15, 88, 64, 4);ctx.fillRect(x + 15, 100, 34, 3);
    ctx.fillStyle = '#17211a';ctx.fillRect(x + 115, 98, 44, 57);ctx.strokeRect(x + 115, 98, 44, 57);
    ctx.strokeStyle = '#233529';ctx.beginPath();ctx.moveTo(x + 80,188);ctx.lineTo(x + 80,204);ctx.stroke();
  }
  ctx.fillStyle = '#273124';ctx.fillRect(corridor.x-13,corridor.y-15,corridor.width+26,corridor.height+30);
  ctx.fillStyle = '#384332';ctx.fillRect(corridor.x-7,corridor.y-9,corridor.width+14,corridor.height+18);
  ctx.fillStyle = '#242e23';ctx.fillRect(corridor.x,corridor.y,corridor.width,corridor.height);
  ctx.save();ctx.beginPath();ctx.rect(corridor.x,corridor.y,corridor.width,corridor.height);ctx.clip();
  for(let x=corridor.x; x<corridor.x+corridor.width;x+=unit){ctx.strokeStyle='#3d49332b';ctx.beginPath();ctx.moveTo(x,corridor.y);ctx.lineTo(x,corridor.y+corridor.height);ctx.stroke();}
  for(let y=corridor.y;y<corridor.y+corridor.height;y+=34){ctx.strokeStyle='#3d49332b';ctx.beginPath();ctx.moveTo(corridor.x,y);ctx.lineTo(corridor.x+corridor.width,y);ctx.stroke();}
  for (let i=0;i<80;i++) {const x=corridor.x+((i*173)%1024),y=corridor.y+((i*47)%138);ctx.strokeStyle='#53614325';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+((i*13)%17),y+3);ctx.stroke();}
  for (const [u,color] of [[9,'#638f8b'],[17,'#b47055']]) {ctx.fillStyle=color+'75';ctx.fillRect(corridor.x+u*unit-3,corridor.y+5,6,corridor.height-10);}
  ctx.strokeStyle='#7e8a5c60';ctx.lineWidth=2;
  for(let i=0;i<9;i++){const x=corridor.x+7.3*unit+i*4;ctx.beginPath();ctx.moveTo(x,300+i%3*3);ctx.lineTo(x+12,301+i%2*8);ctx.stroke();}
  ctx.fillStyle='#b6b492';ctx.save();ctx.translate(corridor.x+16.3*unit,316);ctx.rotate(-.4);ctx.fillRect(-9,-5,18,10);ctx.restore();
  if (!t?.hasBox) {const bx=corridor.x+22.8*unit;ctx.fillStyle='#10170f';ctx.fillRect(bx-18,258,33,36);ctx.fillStyle='#7c8765';ctx.fillRect(bx-16,254,32,32);ctx.strokeStyle='#a7ae80';ctx.strokeRect(bx-13,257,26,26);ctx.fillStyle='#bdba89';ctx.fillRect(bx-4,254,7,32);}
  if(active){
    const lamp=ctx.createRadialGradient(playerX,playerY,10,playerX,playerY,205);lamp.addColorStop(0,'#b2bb7540');lamp.addColorStop(.6,'#a7af7112');lamp.addColorStop(1,'#9cb05d00');ctx.fillStyle=lamp;ctx.fillRect(corridor.x,corridor.y,corridor.width,corridor.height);
    ctx.save();ctx.translate(playerX,playerY);ctx.rotate(t.facing);const beam=ctx.createRadialGradient(0,0,5,0,0,280);beam.addColorStop(0,'#d0ca794a');beam.addColorStop(1,'#c0bd6900');ctx.fillStyle=beam;ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,280,-.38,.38);ctx.closePath();ctx.fill();ctx.restore();
    // A second pair of marks is a perceptual trace, not a visible entity.
    if(t.mode==='approaching'){ctx.fillStyle='#c2865850';const behind=playerX-34;ctx.fillRect(behind,playerY-11,9,4);ctx.fillRect(behind-12,playerY+7,9,4);}
    ctx.save();ctx.translate(playerX,playerY);ctx.rotate(t.facing);ctx.fillStyle='#080d09';ctx.beginPath();ctx.ellipse(-2,3,14,10,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#be8157';ctx.beginPath();ctx.ellipse(0,0,11,8,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#e0c7a0';ctx.beginPath();ctx.arc(3,0,5.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#dcaa73';ctx.fillRect(5,5,8,3);if(t.hasBox){ctx.fillStyle='#a9a47b';ctx.fillRect(8,-8,9,9);}ctx.restore();
    const fog=ctx.createRadialGradient(playerX,playerY,55,playerX,playerY,430);fog.addColorStop(0,'#030a0500');fog.addColorStop(.55,'#030a0550');fog.addColorStop(1,'#030a05ee');ctx.fillStyle=fog;ctx.fillRect(corridor.x,corridor.y,corridor.width,corridor.height);
  }
  ctx.restore();
  ctx.fillStyle='#648778';ctx.fillRect(73,237,14,81);ctx.fillStyle='#9baf8c';ctx.fillRect(78,259,4,34);
  ctx.fillStyle='#42523b';ctx.fillRect(1115,237,9,81);
  // Lights, wiring, a clearly visible camera, and the room label.
  for(let i=0;i<5;i++){const x=145+i*211;ctx.fillStyle='#8b9b5b';ctx.fillRect(x,197,43,4);ctx.fillStyle='#a3b27522';ctx.fillRect(x-5,201,53,5);}
  ctx.strokeStyle='#405039';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(95,366);ctx.lineTo(1080,366);ctx.lineTo(1080,394);ctx.stroke();
  ctx.save();ctx.translate(214,198);ctx.rotate(.4);ctx.fillStyle='#65775c';ctx.fillRect(-10,-8,21,12);ctx.fillStyle='#a49d64';ctx.fillRect(10,-5,6,7);ctx.restore();ctx.fillStyle='#c27b59';ctx.fillRect(201,186,3,3);
  ctx.fillStyle='#566a4f';ctx.font='10px ui-monospace, monospace';ctx.fillText('C-04',92,395);ctx.fillStyle='#485b43';ctx.fillText('RETURN',92,412);ctx.fillText('AUTHORIZED PERSONNEL ONLY',770,396);
  ctx.fillStyle='#41543e';ctx.font='8px ui-monospace, monospace';ctx.fillText('SERVICE AREA — NO ACCESS',167,435);ctx.fillText('POWER 04   /   VENTILATION ACTIVE',660,435);
  const vignette=ctx.createRadialGradient(w/2,h/2,150,w/2,h/2,650);vignette.addColorStop(0,'#02060200');vignette.addColorStop(1,'#020602a0');ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);
}

document.addEventListener('keydown', e => {
  if (e.code === 'Escape' && !$('#notebook-dialog').open) { e.preventDefault(); if (pause) resume(); else setPause('manual'); return; }
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
  if (e.code === 'KeyN' && !e.repeat) { e.preventDefault(); if ($('#notebook-dialog').open) closeNotebook(); else openNotebook(); return; }
  if (e.repeat && ['KeyE', 'KeyC', 'Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) return;
  if (title || pause || game?.phase !== 'trial') return;
  if (e.code === 'KeyC' && $('#slow-toggle').checked) { e.preventDefault(); slowLatched = !slowLatched; }
  if (e.code === 'KeyE') { e.preventDefault(); interactQueued = true; }
  if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Alt(Left|Right))$/.test(e.code)) { e.preventDefault(); keys.add(e.code); }
  const response = { Digit1:'obey',Digit2:'delay',Digit3:'refuse',Digit4:'question' }[e.code];
  if (response) { e.preventDefault(); respond(game, response); changed(); }
});
document.addEventListener('keyup', e => keys.delete(e.code));
canvas.addEventListener('pointermove', e => { const r=canvas.getBoundingClientRect(), t=game?.trial; if(t) pointerFacing=Math.atan2((e.clientY-r.top)*570/r.height-(277+t.y*40),(e.clientX-r.left)*1200/r.width-(88+t.x*1024/24)); });
window.addEventListener('blur', () => setPause('blur'));
document.addEventListener('visibilitychange', () => { if(document.hidden) setPause('blur'); });
window.addEventListener('pagehide', save);
window.addEventListener('storage', e => {
  if (e.key === 'ntk-codex-vertical-v1') { store.raw = e.newValue; store.blocked = true; setPause('manual'); showStorageError('別のタブで同じ保存枠が変更されました。このタブの自動保存を停止しました。'); }
});
$('#pause-button').addEventListener('click', () => { if(pause) resume(); else setPause('manual'); });
$('#close-notebook').addEventListener('click', closeNotebook);
$('#notebook-dialog').addEventListener('cancel', e => { e.preventDefault(); closeNotebook(); });
for (const b of document.querySelectorAll('[data-response]')) b.addEventListener('click', () => { if (!pause && game) { respond(game,b.dataset.response); changed(); } });
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => {
  setPause('notes'); activeTab=b.dataset.tab;
  for (const tab of document.querySelectorAll('[data-tab]')) tab.setAttribute('aria-selected',String(tab===b));
  renderNotes();
});
$('.settings-panel').addEventListener('focusin', () => setPause('settings'));
$('.settings-panel').addEventListener('pointerdown', () => setPause('settings'));
$('#subtitles-toggle').addEventListener('change', () => { if (!$('#subtitles-toggle').checked && !['voice','result'].includes(subtitleType)) $('#subtitle').textContent='音の字幕は非表示。前兆表示は実験画面に残ります。'; });
$('#export-button').addEventListener('click', () => { if(game) exportText(JSON.stringify(game,null,2),`need-to-know-${game.cycleId}.json`); else toast('まだ記録がありません。'); });
if (loaded.error) showStorageError(loaded.error);
if (game) $('#save-label').textContent='● 保存された記録あり';
renderNotes(); renderOverlay(); updateHUD();

function frame(now) {
  const delta = Math.min((now - lastFrame)/1000, .1); lastFrame = now;
  if(game?.phase==='trial' && !pause && !title && !document.hidden) {
    accumulator += delta; saveAge += delta; subtitleHold = Math.max(0,subtitleHold-delta);
    const x=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
    const y=(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-(keys.has('KeyW')||keys.has('ArrowUp')?1:0);
    const input={x,y,run:keys.has('ShiftLeft')||keys.has('ShiftRight'),slow:slowLatched||keys.has('AltLeft')||keys.has('AltRight'),facing:pointerFacing,interact:interactQueued};
    const before=game.phase, serial=game.serial;
    while(accumulator>=1/120 && game.phase==='trial') {tick(game,input,1/120);if(input.interact){interactQueued=false;input.interact=false;}accumulator-=1/120;}
    processEvents();
    if(game.phase!==before || game.serial!==serial) { save(); renderOverlay(true); }
    else if(saveAge>=.5) save();
    if(game.trial.speed>.01) {
      footClock+=delta*game.trial.speed;
      if(footClock>.7) {footClock=0;tone(80,.085,.13,'triangle');if(game.trial.mode==='approaching')tone(105,.12,.24,'triangle',.07);else tone(65,.09,.07,'triangle',.18);}
    } else footClock=0;
  } else accumulator=0;
  updateHUD(); renderOverlay(); draw(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
