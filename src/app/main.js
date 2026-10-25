import * as model from '../core/model.js';
import { randomSeedString } from '../core/rng.js';
import { quarantineCorrupt, readSave, writeSave } from '../core/storage.js';
import { AudioEngine } from './audio.js';
import {
  renderArchive,
  renderDeath,
  renderEnding,
  renderHelp,
  renderIntercom,
  renderInterview,
  renderMorning,
  renderNight,
  renderNotebook,
  renderPause,
  renderSettings,
  renderTitle,
} from './screens.js';
import { createTrialRunner } from './trial.js';

const dom = {
  screen: document.getElementById('screen'),
  play: document.getElementById('play'),
  canvas: document.getElementById('canvas'),
  meta: document.getElementById('meta'),
  banner: document.getElementById('banner'),
  modal: document.getElementById('modal'),
  caption: document.getElementById('caption'),
  prompt: document.getElementById('prompt'),
  hudDay: document.getElementById('hud-day'),
  hudClock: document.getElementById('hud-clock'),
  hudCarry: document.getElementById('hud-carry'),
};

const audio = new AudioEngine(0.55);
let game = null;
let storage = { status: 'empty', raw: null, blocked: false, label: '未保存' };
let captionTimer = 0;
let toastTimer = 0;
let focusPaused = false;

const ui = {
  screen: 'title',
  modal: null,
  notebookTab: 'observation',
  copySelection: new Set(),
  interviewResult: null,
  deathNotice: '',
  archiveReturn: 'title',
};

const runner = createTrialRunner({
  canvas: dom.canvas,
  audio,
  onCaption: (text) => showCaption(text),
  onInstruction: () => {
    if (!game || game.cycle.phase !== 'trial') return;
    ui.modal = 'intercom';
    renderModal();
  },
  onComplete: (trial) => onTrialComplete(trial),
  onPauseRequest: (kind) => {
    if (kind === 'notebook') openNotebook();
    else {
      runner.setPaused(true);
      ui.modal = 'pause';
      renderModal();
    }
  },
  onHud: (data) => updateHud(data),
  onAutosave: () => save(),
});

const toast = document.createElement('div');
toast.className = 'toast';
toast.hidden = true;
document.getElementById('app').appendChild(toast);

boot();

function boot() {
  const loaded = readSave(localStorage);
  if (loaded.status === 'ok') {
    game = loaded.state;
    storage = { status: 'ok', raw: null, blocked: false, label: '読み込み済み' };
    ui.screen = screenForPhase(game.cycle.phase);
    audio.setVolume(game.settings.volume);
    hideBanner();
  } else if (loaded.status === 'corrupt') {
    game = null;
    storage = {
      status: 'corrupt',
      raw: loaded.raw,
      blocked: true,
      label: '破損した保存データを保持中',
    };
    ui.screen = 'title';
    showBanner(
      '保存データを読み込めませんでした。元の文字列は上書きせず保持しています。タイトルから退避して新規開始できます。',
    );
  } else {
    storage.label = loaded.status === 'empty' ? '未保存' : '保存を利用できない';
    ui.screen = 'title';
  }

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('submit', onSubmit);
  window.addEventListener('keydown', onGlobalKeyDown);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('focus', onWindowFocus);
  window.addEventListener('pagehide', () => save());
  document.addEventListener('visibilitychange', onVisibilityChange);

  if (game && game.cycle.phase === 'trial' && game.trial) {
    enterTrial(game.trial, { resume: true });
  } else {
    render();
  }
}

function screenForPhase(phase) {
  switch (phase) {
    case 'morning':
      return 'morning';
    case 'interview':
      return 'interview';
    case 'night':
      return 'night';
    case 'death':
      return 'death';
    case 'ending':
      return 'ending';
    default:
      return 'title';
  }
}

function render() {
  if (!game) {
    hidePlay();
    ui.screen = 'title';
    dom.screen.innerHTML = renderTitle({
      hasSave: false,
      corrupt: storage.status === 'corrupt',
      saveInfo: '',
      reports: [],
    });
    dom.screen.hidden = false;
    updateMeta();
    return;
  }

  if (ui.screen === 'trial' && game.cycle.phase === 'trial') {
    dom.screen.hidden = true;
    dom.play.hidden = false;
    updateMeta();
    return;
  }

  hidePlay();
  dom.screen.hidden = false;
  updateMeta();

  switch (ui.screen) {
    case 'morning':
      dom.screen.innerHTML = renderMorning(game);
      break;
    case 'interview':
      dom.screen.innerHTML = renderInterview(game, ui);
      break;
    case 'night':
      dom.screen.innerHTML = renderNight(game);
      break;
    case 'death':
      dom.screen.innerHTML = renderDeath(game, ui);
      break;
    case 'ending':
      dom.screen.innerHTML = renderEnding(game);
      break;
    case 'archive':
      dom.screen.innerHTML = renderArchive(game, 'back-from-archive');
      break;
    case 'title':
    default:
      dom.screen.innerHTML = renderTitle({
        hasSave: true,
        corrupt: storage.status === 'corrupt',
        saveInfo: `${game.cycle.facility} / 第${game.cycle.day}日 / ${game.subject.number}`,
        reports: game.reports,
      });
      ui.screen = 'title';
      break;
  }
}

function updateMeta() {
  if (!game) {
    dom.meta.textContent = '待機中 / 記録なし';
    return;
  }
  dom.meta.textContent = `${game.cycle.facility} / ${game.cycle.id} / 第${game.cycle.day}日 / ${game.subject.number}`;
}

function hidePlay() {
  dom.play.hidden = true;
}

function showPlay() {
  dom.screen.hidden = true;
  dom.play.hidden = false;
}

function startTrial() {
  if (!game) return;
  const trial = model.beginTrial(game);
  if (!trial) return;
  audio.ensure();
  ui.screen = 'trial';
  showPlay();
  toast.hidden = true;
  runner.start(trial);
  updateMeta();
  showCaption(`${trial.speaker}「突き当たりの箱を回収して戻ってください」`);
  audio.intercom();
  save();
}

function enterTrial(trial, { resume = false } = {}) {
  if (trial.outcome) {
    // 判定直後の自動保存から再開した場合。結果を再適用せず、記録だけ進める。
    model.completeTrial(game);
    hidePlay();
    ui.screen = trial.outcome === 'died' ? 'death' : 'interview';
    ui.interviewResult = null;
    save();
    render();
    return;
  }
  ui.screen = 'trial';
  showPlay();
  runner.start(trial);
  updateMeta();
  if (resume) {
    runner.setPaused(true);
    if (trial.load.offered && !trial.load.reply) {
      ui.modal = 'intercom';
    } else {
      ui.modal = 'resume';
    }
    renderModal();
  }
}

function onTrialComplete(trial) {
  if (!game) return;
  model.completeTrial(game);
  hidePlay();
  ui.modal = null;
  renderModal();
  if (trial.outcome === 'died') {
    ui.screen = 'death';
    ui.deathNotice = '';
  } else {
    ui.screen = 'interview';
    ui.interviewResult = null;
  }
  save();
  render();
}

function renderModal() {
  if (!ui.modal) {
    dom.modal.hidden = true;
    dom.modal.innerHTML = '';
    return;
  }

  let content = '';
  if (ui.modal === 'notebook') content = renderNotebook(game, ui);
  else if (ui.modal === 'settings') content = renderSettings(game, storage);
  else if (ui.modal === 'help') content = renderHelp();
  else if (ui.modal === 'pause') content = renderPause();
  else if (ui.modal === 'resume') {
    content = `
      <div class="modal-head">
        <div><h2>実験の途中から再開</h2><p class="small" style="margin:4px 0 0">保存された時計・警告・位置を復元した。再開を押すまで時計は動かない。</p></div>
      </div>
      <div class="action-list">
        <button type="button" class="btn primary" data-action="resume">再開する</button>
        <button type="button" class="btn" data-action="to-title">タイトルへ戻る</button>
      </div>
    `;
  } else if (ui.modal === 'intercom') {
    const trial = runner.getTrial() || game?.trial;
    content = trial ? renderIntercom(trial) : '<div class="empty">通話は切れている。</div>';
  }

  dom.modal.innerHTML = `<div class="modal-inner" role="dialog" aria-modal="true">${content}</div>`;
  dom.modal.hidden = false;
  const focusTarget = dom.modal.querySelector('button, input, textarea, select');
  focusTarget?.focus({ preventScroll: true });
}

function closeModal() {
  ui.modal = null;
  renderModal();
  if (runner.isRunning()) runner.setPaused(false);
}

function openNotebook() {
  if (!game) {
    flash('サイクルを開始すると、ノートを開ける。');
    return;
  }
  ui.modal = 'notebook';
  if (runner.isRunning()) runner.setPaused(true);
  renderModal();
}

function save() {
  if (!game) return;
  if (storage.blocked) return;
  game.updatedAt = Date.now();
  const result = writeSave(localStorage, game);
  if (result.ok) {
    storage.status = 'ok';
    storage.label = `保存済み ${new Date().toLocaleTimeString('ja-JP')}`;
    hideBanner();
  } else {
    storage.label = '保存に失敗（容量または権限）';
    showBanner('保存に失敗しました。現在の状態は画面内にのみ残っています。');
  }
  if (ui.modal === 'settings') renderModal();
}

function newCycle({ firstCycle = false, keepReports = true } = {}) {
  if (game && keepReports) {
    model.startNewCycle(game, { seed: randomSeedString() });
  } else {
    game = model.createGame({
      seed: randomSeedString(),
      firstCycle,
      reports: [],
    });
  }
  storage.status = 'ok';
  storage.blocked = false;
  storage.label = '新規';
  ui.screen = 'morning';
  ui.modal = null;
  ui.interviewResult = null;
  ui.deathNotice = '';
  ui.copySelection = new Set();
  audio.setVolume(game.settings.volume);
  hideBanner();
  toast.hidden = true;
  renderModal();
  save();
  render();
}

function flash(message) {
  if (!message) return;
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

function showCaption(text) {
  if (!game || !game.settings.captions) return;
  dom.caption.textContent = text;
  dom.caption.classList.add('show');
  window.clearTimeout(captionTimer);
  captionTimer = window.setTimeout(() => {
    dom.caption.classList.remove('show');
  }, 4200);
}

function updateHud(data) {
  dom.hudDay.textContent = `第${data.day}日 / 実験室 A-01`;
  const seconds = Math.max(0, Math.ceil(data.remaining));
  dom.hudClock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  dom.hudClock.classList.toggle('warn', Boolean(data.warning));
  let carry = data.collected ? '所持: 回収箱' : '目的: 奥の箱';
  if (data.slow) carry += ' / 低速';
  dom.hudCarry.textContent = carry;
  if (data.prompt) {
    dom.prompt.textContent = data.prompt;
    dom.prompt.hidden = false;
  } else {
    dom.prompt.hidden = true;
  }
}

function showBanner(text) {
  dom.banner.innerHTML = `<strong>注意。</strong> ${escapeText(text)}`;
  dom.banner.hidden = false;
}

function hideBanner() {
  dom.banner.hidden = true;
  dom.banner.innerHTML = '';
}

function escapeText(text) {
  const holder = document.createElement('span');
  holder.textContent = text;
  return holder.innerHTML;
}

function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  audio.ensure();

  switch (action) {
    case 'continue':
      if (!game) return;
      ui.screen = screenForPhase(game.cycle.phase);
      ui.interviewResult = null;
      ui.deathNotice = '';
      if (game.cycle.phase === 'trial' && game.trial) {
        enterTrial(game.trial, { resume: true });
      } else {
        render();
      }
      save();
      break;

    case 'new-cycle':
      if (storage.blocked) {
        flash('先に破損データを退避してから、新しいサイクルを始めてください。');
        return;
      }
      if (game && !window.confirm('現在の保存を上書きして、新しいサイクルを始めますか？')) return;
      newCycle({ firstCycle: !game, keepReports: Boolean(game) });
      break;

    case 'quarantine': {
      if (!storage.raw) return;
      const result = quarantineCorrupt(localStorage, storage.raw);
      if (!result.ok) {
        showBanner('退避用の保存領域を確保できませんでした。元データは変更していません。');
        return;
      }
      storage.blocked = false;
      storage.raw = null;
      storage.status = 'empty';
      hideBanner();
      newCycle({ firstCycle: true, keepReports: false });
      break;
    }

    case 'summons':
      startTrial();
      break;

    case 'answer': {
      if (!game) return;
      const choice = target.dataset.choice;
      const result = model.submitInterview(game, choice);
      if (!result) return;
      ui.interviewResult = result;
      ui.screen = 'interview';
      save();
      render();
      break;
    }

    case 'to-night':
      ui.screen = 'night';
      ui.interviewResult = null;
      save();
      render();
      break;

    case 'sleep': {
      if (!game) return;
      const result = model.sleep(game);
      if (!result) return;
      ui.interviewResult = null;
      ui.modal = null;
      if (result.ending) {
        ui.screen = 'ending';
      } else {
        ui.screen = 'morning';
      }
      save();
      render();
      break;
    }

    case 'after-death': {
      if (!game) return;
      const result = model.continueAfterDeath(game);
      if (!result) return;
      ui.deathNotice = '';
      ui.screen = result.ending ? 'ending' : 'morning';
      save();
      render();
      break;
    }

    case 'attempt-escape': {
      if (!game || !window.confirm('7日目の朝、監督用名札で門へ向かいます。よろしいですか？')) return;
      const ending = model.attemptEscape(game);
      if (!ending) {
        flash('監督用名札がない。');
        return;
      }
      ui.screen = 'ending';
      save();
      render();
      break;
    }

    case 'morning-document': {
      if (!game) return;
      const result = model.readDistribution(game);
      if (result.ok) {
        flash('配布文書: 7日目の終わりに区画の定期評価と除籍処理がある。持込枠は任意品2点。');
        save();
        render();
      }
      break;
    }

    case 'morning-talk':
    case 'night-talk': {
      if (!game) return;
      const result = model.talkToRoommate(game);
      if (!result.ok) {
        flash(result.reason === 'exhausted' ? 'これ以上、新しい話は聞けない。' : '行動枠がない。');
        return;
      }
      flash(`${result.line.speaker}: ${result.line.text}`);
      save();
      render();
      break;
    }

    case 'morning-submit': {
      if (!game) return;
      const result = model.submitEnvelope(game);
      if (result.ok) {
        flash('研究員は封筒を受け取り、内容を確認せずに回収した。');
        save();
        render();
      }
      break;
    }

    case 'night-work': {
      if (!game) return;
      const result = model.doSafeWork(game);
      if (!result.ok) {
        flash('今日はもう追加業務をこなせない。');
        return;
      }
      flash(
        result.reward.badge
          ? '安全な再評価業務を終えた。監督用名札が支給された。'
          : '安全な再評価業務を終えた。',
      );
      save();
      render();
      break;
    }

    case 'open-notebook':
      openNotebook();
      break;

    case 'open-settings':
      if (!game) {
        ui.modal = 'help';
        renderModal();
        return;
      }
      ui.modal = 'settings';
      if (runner.isRunning()) runner.setPaused(true);
      renderModal();
      break;

    case 'open-help':
      ui.modal = 'help';
      if (runner.isRunning()) runner.setPaused(true);
      renderModal();
      break;

    case 'open-envelope-copy':
      if (!game) return;
      ui.notebookTab = 'envelope';
      ui.copySelection = new Set();
      openNotebook();
      break;

    case 'notebook-tab': {
      ui.notebookTab = target.dataset.tab;
      renderModal();
      break;
    }

    case 'copy-envelope': {
      if (!game) return;
      const ids = Array.from(dom.modal.querySelectorAll('[data-copy-id]:checked')).map(
        (input) => input.dataset.copyId,
      );
      if (ids.length === 0) {
        flash('複写する項目を選ぶ。');
        return;
      }
      const result = model.copyToEnvelope(game, ids);
      if (!result.ok) {
        flash(
          result.reason === 'no-slot'
            ? '夜の行動枠がない。'
            : result.reason === 'confiscated'
              ? '封筒は没収済み。'
              : '複写できなかった。',
        );
        return;
      }
      ui.copySelection = new Set();
      flash(`${result.count}件を封筒に封入した。翌朝に読める。`);
      save();
      renderModal();
      break;
    }

    case 'close-modal':
      closeModal();
      break;

    case 'resume':
      closeModal();
      break;

    case 'reply': {
      const reply = target.dataset.reply;
      if (!runner.isRunning()) return;
      runner.reply(reply);
      closeModal();
      save();
      break;
    }

    case 'open-archive':
      ui.archiveReturn = ui.screen;
      ui.screen = 'archive';
      ui.modal = null;
      renderModal();
      render();
      break;

    case 'back-from-archive':
      ui.screen = game ? ui.archiveReturn || 'title' : 'title';
      render();
      break;

    case 'to-title':
      save();
      runner.stop();
      ui.modal = null;
      ui.screen = 'title';
      ui.interviewResult = null;
      renderModal();
      hidePlay();
      render();
      break;

    default:
      break;
  }
}

function onInput(event) {
  const target = event.target;
  if (target.matches('[data-setting="volume"]')) {
    const value = Number(target.value) / 100;
    audio.setVolume(value);
    const label = dom.modal.querySelector('[data-volume-label]');
    if (label) label.textContent = String(Math.round(value * 100));
    if (game) game.settings.volume = value;
  }
  if (target.matches('[data-setting="captions"]') && game) {
    game.settings.captions = target.checked;
    if (!target.checked) {
      dom.caption.classList.remove('show');
    }
  }
}

function onChange(event) {
  const target = event.target;
  if (target.matches('[data-setting="captions"]') && game) {
    game.settings.captions = target.checked;
    save();
  }
  if (target.matches('[data-setting="volume"]') && game) {
    game.settings.volume = Number(target.value) / 100;
    save();
  }
  if (target.matches('[data-copy-id]')) {
    if (target.checked) ui.copySelection.add(target.dataset.copyId);
    else ui.copySelection.delete(target.dataset.copyId);
  }
}

function onSubmit(event) {
  const form = event.target;
  if (!form.matches('[data-form="hypothesis"]')) return;
  event.preventDefault();
  if (!game) return;
  const data = new FormData(form);
  model.addHypothesis(game, {
    title: data.get('title') || '',
    trigger: data.get('trigger') || '',
    effect: data.get('effect') || '',
    condition: data.get('condition') || '',
    basis: data.get('basis') || '',
    note: data.get('note') || '',
  });
  flash('仮説を記録した。正誤は判定されない。');
  save();
  renderModal();
}

function onGlobalKeyDown(event) {
  if (event.defaultPrevented) return;
  if (event.code === 'Escape' && ui.modal && ui.modal !== 'intercom') {
    event.preventDefault();
    closeModal();
  }
}

function onWindowBlur() {
  if (!runner.isRunning() || ui.modal) return;
  if (game?.trial?.outcome) return;
  focusPaused = true;
  runner.setPaused(true);
}

function onWindowFocus() {
  if (!focusPaused || !runner.isRunning()) return;
  focusPaused = false;
  ui.modal = 'pause';
  renderModal();
}

function onVisibilityChange() {
  if (document.hidden) {
    save();
    if (runner.isRunning() && !ui.modal && !game?.trial?.outcome) {
      focusPaused = true;
      runner.setPaused(true);
    }
    return;
  }
  if (focusPaused && runner.isRunning()) {
    focusPaused = false;
    ui.modal = 'pause';
    renderModal();
  }
}
