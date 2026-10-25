import './style.css';
import { roomLabel } from '../core/content';
import {
  acknowledgeDeath,
  answerInterrogation,
  answerSummons,
  beginTrial,
  copyToEnvelope,
  createInitialState,
  cycleParamsForSeed,
  interrogationOptions,
  morningAction,
  morningSlotsLeft,
  morningStatus,
  nightAction,
  nightSlotsLeft,
  proceedToNight,
  resolveTrial,
  sleep,
  startNewCycle,
  summonsText,
  type ActionResult,
  type EnvelopeSelection,
  type FacilityCycle,
  type GameState,
} from '../core/cycle';
import { RESEARCHER_LABEL, RESPONSE_LABEL, type ResponseKind } from '../core/instructions';
import { INTERROGATION_PROMPT } from '../core/interrogation';
import { addObservation, emptyNotebook, FREE_TEXT_LIMIT, type Notebook } from '../core/notebook';
import { availableResponses, createPacingTrial, interactTarget, ticksToSeconds, type InteractTarget, type PacingTrialState } from '../core/pacing';
import { DAY, FIRST_FIXED_SEED } from '../core/params';
import { present } from '../core/presentation';
import { buildTrialReport, type ArchivedReport } from '../core/reports';
import { TrialRunner } from '../core/runner';
import { CorruptSaveProtectedError, loadGame, preserveCorrupt, saveGame, type KeyValueStore, type LoadResult } from '../core/save';
import { AudioEngine } from './audio';
import { button, clear, h, paragraphs } from './dom';
import { Input } from './input';
import { renderNotes } from './notes';
import { Renderer, type Effects, type EndingFx } from './render';
import { loadSettings, saveSettings, type Settings } from './settings';

const DEV = new URLSearchParams(location.search).has('dev');

const INTERACT_LABEL: Record<InteractTarget, string> = {
  box: '箱を持つ',
  slip: '紙片を調べる',
  camera: 'カメラを見る',
  lines: '床の線を調べる',
  scuff: '床の跡を調べる',
  door: '扉を調べる',
};

const RESPONSE_KEYS: ResponseKind[] = ['comply', 'delay', 'refuse', 'question'];

const CONTROLS = [
  'WASD: 移動　矢印キー／マウス: 視線（移動とは別）',
  'Shift（押す間）: 走る　C（押す間）: 低速　V: 低速の切替',
  'E／Space: 調べる・持つ　1〜4: インターホンへ返答',
  'Tab／N: ノート　Esc／P: 一時停止（ノート・一時停止中は時間が止まる）',
];

function safeStore(): KeyValueStore {
  try {
    const probe = '__ntk_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} がない`);
  return found as T;
}

interface PracticeRun {
  notebook: Notebook;
}

class App {
  private readonly store = safeStore();
  private state: GameState = createInitialState();
  private load: LoadResult;
  private preservedKey: string | null = null;
  private settings: Settings = loadSettings();
  private readonly audio = new AudioEngine();
  private readonly renderer: Renderer;
  private readonly input: Input;

  private readonly screen = el<HTMLElement>('screen');
  private readonly stage = el<HTMLElement>('stage');
  private readonly modalRoot = el<HTMLElement>('modal');
  private readonly topinfo = el<HTMLElement>('topinfo');
  private readonly dialogueEl = el<HTMLElement>('dialogue');
  private readonly responsesEl = el<HTMLElement>('responses');
  private readonly captionsEl = el<HTMLElement>('captions');
  private readonly statusEl = el<HTMLElement>('status');
  private readonly devEl = el<HTMLElement>('dev');

  private inGame = false;
  private runner: TrialRunner | null = null;
  private practice: PracticeRun | null = null;
  private fx: Effects = { cues: [], speakerAt: -1e9 };
  private dialogue: { speaker: string; text: string; at: number } | null = null;
  private readonly captions = new Map<string, { text: string; at: number }>();
  private ending: EndingFx | null = null;
  private modal: 'none' | 'pause' | 'notes' | 'settings' = 'none';
  private devVisible = DEV;
  private lastFrame = performance.now();
  private lastAutosave = 0;
  private lastResult: ActionResult | null = null;
  private envelopeOpen = false;
  private notesFlashAt = -1e9;
  private hudCache = { dialogue: '', responses: '', captions: '', status: '', dev: '' };
  private saveError: string | null = null;

  constructor() {
    this.renderer = new Renderer(el<HTMLCanvasElement>('view'));
    this.input = new Input((x, y) => this.renderer.screenToWorld(x, y));
    this.audio.setVolume(this.settings.volume);
    this.load = loadGame(this.store);
    if (this.load.status === 'ok') this.state = this.load.state;

    window.addEventListener('blur', () => this.onFocusLost());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.onFocusLost();
    });
    window.addEventListener('beforeunload', () => this.persist());
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: false });
    window.addEventListener('keydown', () => this.audio.unlock());

    this.showTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- 保存 ----------

  private persist(): void {
    if (!this.state.cycle && this.state.meta.archive.length === 0) return;
    if (this.load.status === 'corrupt' && !this.preservedKey) return;
    try {
      saveGame(this.store, this.state);
      this.saveError = null;
    } catch (err) {
      this.saveError = err instanceof CorruptSaveProtectedError ? err.message : `保存できない: ${(err as Error).message}`;
    }
    this.updateTopbar();
  }

  private updateTopbar(): void {
    const c = this.state.cycle;
    const parts: string[] = [];
    if (this.practice) parts.push('練習（固定seed・記録しない）');
    else if (this.inGame && c) parts.push(`${c.facilityCode}・${c.day}日目・${c.subject.number}`);
    if (this.saveError) parts.push(`⚠ ${this.saveError}`);
    this.topinfo.textContent = parts.join('　');
  }

  // ---------- 画面切替 ----------

  private showScreen(...children: (HTMLElement | null)[]): void {
    this.stage.hidden = true;
    this.screen.hidden = false;
    this.input.enabled = false;
    clear(this.screen);
    for (const child of children) if (child) this.screen.append(child);
    this.updateTopbar();
    this.screen.scrollTop = 0;
  }

  private cycle(): FacilityCycle {
    const c = this.state.cycle;
    if (!c) throw new Error('サイクルがない');
    return c;
  }

  private route(): void {
    if (!this.inGame || !this.state.cycle) {
      this.showTitle();
      return;
    }
    const c = this.state.cycle;
    switch (c.phase) {
      case 'morning':
        this.showMorning();
        break;
      case 'summons':
        this.showSummons();
        break;
      case 'trial':
        if (c.trial) this.startStage(c.trial, true);
        break;
      case 'interrogation':
        this.showInterrogation();
        break;
      case 'report':
        this.showReport();
        break;
      case 'night':
        this.showNight();
        break;
      case 'death_report':
        this.showDeathReport();
        break;
      case 'slice_end':
      case 'ended':
        this.showSliceEnd();
        break;
    }
  }

  private showTitle(): void {
    this.inGame = false;
    const c = this.state.cycle;
    const warn =
      this.load.status === 'corrupt' && !this.preservedKey
        ? h(
            'div',
            { class: 'warn' },
            h('p', {}, '保存データを読み込めませんでした。元のデータは変更していません。'),
            h('p', { class: 'meta' }, `理由: ${this.load.reason}`),
            h('p', { class: 'meta' }, '新しいサイクルを始めると、元のデータを退避用の領域へ複写し、読み戻して一致を確かめてから新しい保存を書きます。'),
          )
        : null;
    this.showScreen(
      h(
        'div',
        { class: 'title' },
        h('h1', {}, 'NEED TO KNOW'),
        h('p', { class: 'subtitle' }, '仮題／歩調 縦切り試作'),
        h('p', { class: 'meta' }, '判定と受入条件を確かめるための試作です。面白さ・難易度・所要時間は未検証です。'),
        warn,
        h(
          'div',
          { class: 'menu' },
          button('新しいサイクルを始める', () => this.newCycle()),
          c ? button(`続きから（${c.facilityCode}・${c.day}日目）`, () => this.continueCycle()) : null,
          button('練習（固定seed・歩調のみ・記録しない）', () => this.startPractice(), { class: 'ghost' }),
          button('報告履歴', () => this.showArchive(), { class: 'ghost' }),
          button('設定', () => this.showSettingsScreen(), { class: 'ghost' }),
        ),
        h('div', { class: 'controls' }, ...paragraphs(CONTROLS)),
      ),
    );
  }

  private newCycle(): void {
    const c = this.state.cycle;
    if (c && c.phase !== 'slice_end' && c.phase !== 'ended' && !window.confirm('進行中のサイクルを終えて、新しいサイクルを始めますか？')) return;
    if (this.load.status === 'corrupt' && !this.preservedKey) {
      try {
        this.preservedKey = preserveCorrupt(this.store, this.load.raw);
      } catch (err) {
        window.alert(`元のデータを退避できなかったため、新しいサイクルを始めません。\n${(err as Error).message}`);
        return;
      }
    }
    startNewCycle(this.state);
    this.lastResult = null;
    this.inGame = true;
    this.persist();
    this.route();
  }

  private continueCycle(): void {
    this.inGame = true;
    this.lastResult = null;
    this.route();
  }

  private statusBlock(lines: string[]): HTMLElement {
    return h('div', { class: 'status-block' }, ...paragraphs(lines));
  }

  private resultBlock(): HTMLElement | null {
    const r = this.lastResult;
    if (!r) return null;
    return h('div', { class: r.title ? 'doc' : 'note-line' }, r.title ? h('h3', {}, r.title) : null, ...paragraphs(r.lines));
  }

  private showMorning(): void {
    const c = this.cycle();
    const left = morningSlotsLeft(c);
    const act = (a: 'notice' | 'cellmate' | 'envelope') => () => {
      this.lastResult = morningAction(this.state, a);
      this.persist();
      this.showMorning();
    };
    this.showScreen(
      h('h2', {}, `${c.day}日目　朝`),
      this.statusBlock(morningStatus(c)),
      this.resultBlock(),
      h('p', { class: 'meta' }, left > 0 ? `召集まで、あと${left}つのことができる。` : '召集の時間だ。'),
      h(
        'div',
        { class: 'menu' },
        button('配布文書を読む', act('notice'), { disabled: left <= 0 }),
        button('同房者と話す', act('cellmate'), { disabled: left <= 0 }),
        button('寝台の下を調べる', act('envelope'), { disabled: left <= 0 }),
        button('ノートを開く', () => this.openNotesFromScreen(), { class: 'ghost' }),
        button('召集に応じる', () => {
          this.lastResult = null;
          answerSummons(this.state);
          this.persist();
          this.route();
        }),
      ),
    );
  }

  private showSummons(): void {
    const c = this.cycle();
    this.showScreen(
      h('h2', {}, '召集'),
      h('div', { class: 'doc' }, ...paragraphs(summonsText(c))),
      h('div', { class: 'controls' }, h('h3', {}, '操作'), ...paragraphs(CONTROLS)),
      h('p', { class: 'meta' }, '音が聞こえない環境でも、足音の方向は画面上の弧で示されます。字幕は設定で切り替えられます。'),
      h(
        'div',
        { class: 'menu' },
        button('試験室へ入る', () => {
          const trial = beginTrial(this.state);
          this.persist();
          this.startStage(trial, false);
        }),
      ),
    );
  }

  // ---------- 実験 ----------

  private startPractice(): void {
    this.practice = { notebook: emptyNotebook() };
    const trial = createPacingTrial({
      trialId: 'practice',
      subjectNumber: 'D-0000',
      day: 0,
      researcher: 'A',
      tolerance: cycleParamsForSeed(FIRST_FIXED_SEED).pacingTolerance,
    });
    this.startStage(trial, false);
  }

  private startStage(trial: PacingTrialState, resumed: boolean): void {
    this.runner = new TrialRunner(trial);
    this.fx = { cues: [], speakerAt: -1e9 };
    this.dialogue = null;
    this.captions.clear();
    this.ending = null;
    this.hudCache = { dialogue: '', responses: '', captions: '', status: '', dev: '' };
    this.input.releaseAll();
    this.input.slowToggled = false;
    this.input.resetFacing(trial.player.facing);
    this.screen.hidden = true;
    this.stage.hidden = false;
    this.input.enabled = true;
    this.audio.ambience(true);
    this.lastFrame = performance.now();
    this.lastAutosave = performance.now();
    this.updateTopbar();
    if (resumed) this.openPause('resume');
  }

  private onFocusLost(): void {
    this.input.releaseAll();
    if (this.runner && !this.ending && this.modal === 'none') this.openPause('focus');
  }

  private openPause(reason: 'menu' | 'focus' | 'resume' = 'menu'): void {
    if (!this.runner) return;
    this.runner.pause(reason);
    this.runner.pause('menu');
    this.persist();
    this.modal = 'pause';
    this.renderModal();
  }

  private closeModal(): void {
    if (!this.runner) return;
    for (const r of ['menu', 'notes', 'settings', 'focus', 'resume'] as const) this.runner.resume(r);
    this.modal = 'none';
    this.modalRoot.hidden = true;
    clear(this.modalRoot);
    this.input.releaseAll();
    this.lastFrame = performance.now();
  }

  private activeNotebook(): { notebook: Notebook; day: number; owner: string } {
    if (this.practice) return { notebook: this.practice.notebook, day: 0, owner: '練習' };
    const c = this.cycle();
    return { notebook: c.subject.notebook, day: c.day, owner: c.subject.number };
  }

  private renderModal(): void {
    const root = this.modalRoot;
    clear(root);
    root.hidden = false;
    if (this.modal === 'pause') {
      const reasons = this.runner?.pauseReasons ?? [];
      root.append(
        h(
          'div',
          { class: 'panel' },
          h('h2', {}, '一時停止'),
          h('p', { class: 'meta' }, reasons.includes('resume') ? '保存した実験を再開します。時計と警告の経過は保存時のままです。' : '実験の時計は止まっています。'),
          h(
            'div',
            { class: 'menu' },
            button('再開', () => this.closeModal()),
            button('ノート', () => {
              this.modal = 'notes';
              this.runner?.pause('notes');
              this.renderModal();
            }, { class: 'ghost' }),
            button('設定', () => {
              this.modal = 'settings';
              this.runner?.pause('settings');
              this.renderModal();
            }, { class: 'ghost' }),
            button(this.practice ? '練習をやめる' : '保存してタイトルへ', () => this.quitToTitle(), { class: 'ghost' }),
          ),
          h('div', { class: 'controls' }, ...paragraphs(CONTROLS)),
        ),
      );
    } else if (this.modal === 'notes') {
      const nb = this.activeNotebook();
      renderNotes(root, { ...nb, onChange: () => this.persist(), onClose: () => this.closeModal() });
    } else if (this.modal === 'settings') {
      root.append(h('div', { class: 'panel' }, this.settingsForm(), h('div', { class: 'menu' }, button('戻る', () => this.closeModal()))));
    }
  }

  private quitToTitle(): void {
    this.closeModal();
    this.runner = null;
    this.audio.ambience(false);
    if (this.practice) {
      this.practice = null;
    } else {
      this.persist();
    }
    this.showTitle();
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.runner) this.tickStage(now, dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  private tickStage(now: number, dt: number): void {
    const runner = this.runner!;
    const trial = runner.state;
    const input = this.input;

    if (DEV && input.take('dev')) this.devVisible = !this.devVisible;
    if (this.modal !== 'none') {
      if (input.take('pause') || (this.modal === 'notes' && input.take('notes'))) this.closeModal();
      input.clearPressed();
    } else if (!this.ending) {
      if (input.take('pause')) {
        this.openPause();
      } else if (input.take('notes')) {
        this.modal = 'notes';
        runner.pause('notes');
        this.renderModal();
      } else {
        if (input.take('interact')) runner.queueInteract();
        const keys = ['respond1', 'respond2', 'respond3', 'respond4'] as const;
        keys.forEach((k, i) => {
          if (input.take(k)) runner.queueResponse(RESPONSE_KEYS[i]!);
        });
        runner.advance(dt, input.held(trial.player));
      }
    }

    this.drainEvents(trial, now);
    if (trial.outcome && !this.ending) {
      this.ending = { kind: trial.outcome.kind, startedAt: now };
      this.input.enabled = false;
      if (!this.practice) this.persist();
    }
    if (!this.practice && !this.ending && now - this.lastAutosave > 5000 && !runner.paused) {
      this.lastAutosave = now;
      this.persist();
    }

    this.renderer.draw(trial, this.fx, now, { dev: this.devVisible, ending: this.ending });
    this.updateHud(trial, now);

    if (this.ending && now - this.ending.startedAt > 1800) this.finishStage(trial);
  }

  private drainEvents(trial: PacingTrialState, now: number): void {
    const listener = { x: trial.player.x, y: trial.player.y, facing: trial.player.facing };
    for (const ev of trial.events.splice(0)) {
      const p = present(ev, listener, this.settings, trial.researcher);
      if (p.audio) this.audio.play(p.audio);
      if (p.caption) this.captions.set(p.caption.key, { text: p.caption.text, at: now });
      if (p.visual) {
        this.fx.cues.push({ ...p.visual, born: now });
        if (ev.kind === 'step' && ev.source === 'follower') this.fx.cues.push({ type: 'dust', x: ev.x, y: ev.y, strength: ev.loudness, born: now });
      }
      if (p.dialogue) {
        this.dialogue = { ...p.dialogue, at: now };
        this.fx.speakerAt = now;
      }
      if (ev.kind === 'observe') {
        const nb = this.activeNotebook();
        addObservation(nb.notebook, ev.fact, nb.day, trial.roomCode, trial.subjectNumber);
        this.notesFlashAt = now;
      }
    }
    this.fx.cues = this.fx.cues.filter((c) => now - c.born < 1500);
  }

  /** 内容が変わった時だけ DOM を作り直す */
  private updateIf(key: keyof App['hudCache'], value: string, build: () => void): void {
    if (this.hudCache[key] === value) return;
    this.hudCache[key] = value;
    build();
  }

  private updateHud(trial: PacingTrialState, now: number): void {
    const d = this.dialogue && now - this.dialogue.at < 8000 ? this.dialogue : null;
    this.updateIf('dialogue', d ? `${d.speaker}|${d.text}` : '', () => {
      clear(this.dialogueEl);
      if (d) this.dialogueEl.append(h('span', { class: 'speaker' }, d.speaker), h('span', {}, d.text));
    });

    const responses = this.ending ? [] : availableResponses(trial);
    this.updateIf('responses', responses.join(','), () => {
      clear(this.responsesEl);
      for (const r of responses) {
        const key = RESPONSE_KEYS.indexOf(r) + 1;
        this.responsesEl.append(button(`${key}　${RESPONSE_LABEL[r]}`, () => this.runner?.queueResponse(r), { class: 'response' }));
      }
    });

    const caps = [...this.captions.values()].filter((c) => now - c.at < 1800).map((c) => c.text);
    this.updateIf('captions', caps.join('|'), () => {
      clear(this.captionsEl);
      for (const text of caps) this.captionsEl.append(h('p', {}, `［${text}］`));
    });

    const target = this.ending ? null : interactTarget(trial);
    const flash = now - this.notesFlashAt < 1200;
    const status = [
      target ? `E: ${INTERACT_LABEL[target]}` : '',
      this.input.slowToggled ? '低速歩行: 切替中（V で解除）' : '',
      flash ? 'ノートに書き留めた（Tab）' : 'Tab: ノート　Esc: 一時停止',
    ]
      .filter(Boolean)
      .join('　／　');
    this.updateIf('status', status, () => {
      this.statusEl.textContent = status;
    });

    if (this.devVisible) {
      const f = trial.follower;
      const c = this.state.cycle;
      const dev = [
        `DEV  tolerance=${trial.tolerance}  follower=${f.state}  clock=${ticksToSeconds(f.clockTicks).toFixed(2)}s`,
        `stop=${ticksToSeconds(f.stopTicks).toFixed(2)} slow=${ticksToSeconds(f.slowTicks).toFixed(2)} retreat=${ticksToSeconds(f.retreatTicks).toFixed(2)}`,
        `speed=${trial.player.speed.toFixed(2)} mode=${trial.player.mode} x=${trial.player.x.toFixed(2)} runAttempt=${trial.runAttempt}`,
        c && !this.practice ? `seed=${c.seed} C=${c.subject.stats.credit} S=${c.subject.stats.suspicion} E=${c.subject.stats.evaluation}` : 'practice',
        `observed=${trial.observed.join(',')}`,
      ].join('\n');
      this.devEl.hidden = false;
      this.updateIf('dev', dev, () => {
        this.devEl.textContent = dev;
      });
    } else {
      this.devEl.hidden = true;
    }
  }

  private finishStage(trial: PacingTrialState): void {
    this.runner = null;
    this.ending = null;
    this.audio.ambience(false);
    if (this.practice) {
      const report = buildTrialReport({
        cycleId: 'practice',
        facilityCode: '練習',
        day: 0,
        subjectNumber: trial.subjectNumber,
        roomCode: trial.roomCode,
        outcome: trial.outcome!,
        observed: trial.observed,
      });
      this.practice = null;
      this.showScreen(
        h('h2', {}, '練習の記録'),
        h('p', { class: 'meta' }, '練習は通常のサイクル・報告履歴に記録しません。'),
        this.reportDoc(report),
        h('div', { class: 'menu' }, button('もう一度', () => this.startPractice()), button('タイトルへ', () => this.showTitle(), { class: 'ghost' })),
      );
      return;
    }
    resolveTrial(this.state);
    this.persist();
    this.route();
  }

  // ---------- 事後 ----------

  private showInterrogation(): void {
    const c = this.cycle();
    const options = interrogationOptions(c);
    this.showScreen(
      h('h2', {}, '聴取'),
      h('div', { class: 'speech' }, h('span', { class: 'speaker' }, RESEARCHER_LABEL.A), h('span', {}, INTERROGATION_PROMPT)),
      h(
        'div',
        { class: 'menu column' },
        ...options.map((o) =>
          button(o.label, () => {
            answerInterrogation(this.state, o.id);
            this.persist();
            this.route();
          }),
        ),
      ),
    );
  }

  private reportDoc(report: ArchivedReport, dark = false): HTMLElement {
    return h(
      'div',
      { class: dark ? 'doc report dark' : 'doc report' },
      h('h3', {}, report.kind === 'death' ? '事後報告書（被験者死亡）' : '事後報告書'),
      ...paragraphs(report.lines),
      h('p', { class: 'fragment' }, report.fragment),
      h('p', { class: 'redacted' }, '所見: ', h('span', { class: 'bar' }, '██████████████'), '　分類: ', h('span', { class: 'bar' }, '████')),
    );
  }

  private showReport(): void {
    const c = this.cycle();
    this.showScreen(
      h('h2', {}, '事後'),
      c.interrogationReply ? h('div', { class: 'speech' }, h('span', { class: 'speaker' }, RESEARCHER_LABEL.A), h('span', {}, c.interrogationReply)) : null,
      c.notices.length > 0 ? this.statusBlock(c.notices) : null,
      c.currentReport ? this.reportDoc(c.currentReport) : null,
      h(
        'div',
        { class: 'menu' },
        button('夜へ', () => {
          proceedToNight(this.state);
          this.lastResult = null;
          this.persist();
          this.route();
        }),
      ),
    );
  }

  private showDeathReport(): void {
    const c = this.cycle();
    this.showScreen(
      h('h2', {}, '記録'),
      c.currentReport ? this.reportDoc(c.currentReport, true) : null,
      h('p', { class: 'meta' }, '携帯ノートと所持品は回収された。寝台の下に挟んだものは、施設に残っている。'),
      h('p', { class: 'meta' }, 'この報告書はプレイヤー向けの記録で、次の被験者は持っていない。'),
      h(
        'div',
        { class: 'menu' },
        button('翌朝へ（次の被験者）', () => {
          acknowledgeDeath(this.state);
          this.lastResult = null;
          this.persist();
          this.route();
        }),
      ),
    );
  }

  private showNight(): void {
    const c = this.cycle();
    const left = nightSlotsLeft(c);
    const act = (a: 'cellmate' | 'safe_task') => () => {
      this.lastResult = nightAction(this.state, a);
      this.persist();
      this.showNight();
    };
    this.showScreen(
      h('h2', {}, `${c.day}日目　夜`),
      this.resultBlock(),
      h('p', { class: 'meta' }, left > 0 ? `消灯まで、あと${left}つのことができる。ノートを開くだけなら時間は使わない。` : '消灯の時間だ。'),
      this.envelopeOpen ? this.envelopeEditor(c) : null,
      h(
        'div',
        { class: 'menu' },
        button('寝台の下へメモを隠す', () => {
          this.envelopeOpen = true;
          this.showNight();
        }, { disabled: left <= 0 || this.envelopeOpen }),
        button('同房者と話す', act('cellmate'), { disabled: left <= 0 }),
        button('清掃業務を引き受ける', act('safe_task'), { disabled: left <= 0 }),
        button('ノートを開く', () => this.openNotesFromScreen(), { class: 'ghost' }),
        button('就寝', () => {
          this.envelopeOpen = false;
          this.lastResult = null;
          sleep(this.state);
          this.persist();
          this.route();
        }),
      ),
    );
  }

  private envelopeEditor(c: FacilityCycle): HTMLElement {
    const nb = c.subject.notebook;
    const selected = new Set<string>();
    let free = '';
    const entries = [...nb.observations, ...nb.hearsay, ...nb.hypotheses].filter((e) => e.kind !== 'erased');
    const counter = h('p', { class: 'meta' }, `選択: 0／${DAY.envelopeCapacity}`);
    const update = () => {
      const total = selected.size + (free.trim() ? 1 : 0);
      counter.textContent = `選択: ${total}／${DAY.envelopeCapacity}`;
      return total;
    };
    const label = (e: (typeof entries)[number]) => {
      switch (e.kind) {
        case 'observation':
          return `［観測］${e.text}`;
        case 'hearsay':
          return `［伝聞］${e.text}`;
        case 'hypothesis':
          return `［仮説］${e.name || '（呼び名なし）'}`;
        default:
          return '';
      }
    };
    return h(
      'div',
      { class: 'doc envelope' },
      h('h3', {}, '寝台の下の封筒へ写す'),
      h('p', { class: 'meta' }, `携帯ノートから、合計${DAY.envelopeCapacity}件まで紙に写せる。封筒は翌朝に調べて初めて読める。研究員に見せると没収される。`),
      ...entries.map((e) =>
        h(
          'label',
          { class: 'evidence-item' },
          h('input', {
            type: 'checkbox',
            onchange: (ev) => {
              const box = ev.target as HTMLInputElement;
              if (box.checked) selected.add(e.id);
              else selected.delete(e.id);
              if (update() > DAY.envelopeCapacity) {
                box.checked = false;
                selected.delete(e.id);
                update();
              }
            },
          }),
          h('span', {}, label(e)),
        ),
      ),
      h(
        'label',
        { class: 'field' },
        h('span', {}, '自由に書く（1件）'),
        h('textarea', {
          rows: 2,
          maxLength: FREE_TEXT_LIMIT,
          oninput: (ev) => {
            const area = ev.target as HTMLTextAreaElement;
            free = area.value;
            if (update() > DAY.envelopeCapacity) {
              area.value = '';
              free = '';
              update();
            }
          },
        }),
      ),
      counter,
      h(
        'div',
        { class: 'row' },
        button('写して隠す', () => {
          const selections: EnvelopeSelection[] = [...selected].map((entryId) => ({ entryId }));
          if (free.trim()) selections.push({ freeText: free });
          const result = copyToEnvelope(this.state, selections);
          if (!result.ok) {
            window.alert(result.lines.join('\n'));
            return;
          }
          this.envelopeOpen = false;
          this.lastResult = result;
          this.persist();
          this.showNight();
        }),
        button('やめる', () => {
          this.envelopeOpen = false;
          this.showNight();
        }, { class: 'ghost' }),
      ),
    );
  }

  private openNotesFromScreen(): void {
    const nb = this.activeNotebook();
    this.modal = 'notes';
    renderNotes(this.modalRoot, {
      ...nb,
      onChange: () => this.persist(),
      onClose: () => {
        this.modal = 'none';
        this.modalRoot.hidden = true;
        clear(this.modalRoot);
      },
    });
    this.modalRoot.hidden = false;
  }

  private showSliceEnd(): void {
    const c = this.cycle();
    this.showScreen(
      h('h2', {}, `${c.day}日目　召集`),
      h('div', { class: 'doc' }, ...paragraphs(summonsText(c))),
      this.statusBlock([`現在の被験者: ${c.subject.number}`, `このサイクルの報告: ${this.state.meta.archive.filter((r) => r.cycleId === c.cycleId).length}件`]),
      h(
        'div',
        { class: 'menu' },
        button('報告履歴', () => this.showArchive()),
        button('新しいサイクルを始める', () => this.newCycle(), { class: 'ghost' }),
        button('タイトルへ', () => this.showTitle(), { class: 'ghost' }),
      ),
    );
  }

  private showArchive(): void {
    const current = this.state.cycle?.cycleId;
    const reports = [...this.state.meta.archive].reverse();
    this.showScreen(
      h('h2', {}, '報告履歴（プレイヤー向け）'),
      h('p', { class: 'meta' }, 'ここにある報告書は、ゲーム内の被験者が持っている文書ではありません。過去のサイクルの報告は、現在の施設のルールを保証しません。'),
      reports.length === 0 ? h('p', { class: 'blank' }, '記録なし') : null,
      ...reports.map((r) =>
        h(
          'div',
          { class: 'archive-item' },
          h('p', { class: 'meta' }, `${r.facilityCode}・${r.day}日目・${roomLabel(r.roomCode)}${r.cycleId === current ? '' : '（過去のサイクル・旧施設コード）'}`),
          this.reportDoc(r, r.kind === 'death'),
        ),
      ),
      h('div', { class: 'menu' }, button('戻る', () => (this.inGame ? this.route() : this.showTitle()))),
    );
  }

  private settingsForm(): HTMLElement {
    const volumeLabel = h('span', {}, `${Math.round(this.settings.volume * 100)}`);
    return h(
      'div',
      { class: 'settings' },
      h('h2', {}, '設定'),
      h(
        'label',
        { class: 'field inline' },
        h('input', {
          type: 'checkbox',
          checked: this.settings.captions,
          onchange: (ev) => {
            this.settings.captions = (ev.target as HTMLInputElement).checked;
            saveSettings(this.settings);
          },
        }),
        h('span', {}, '効果音の字幕（足音などの知覚情報）'),
      ),
      h(
        'label',
        { class: 'field inline' },
        h('span', {}, '音量'),
        h('input', {
          type: 'range',
          min: '0',
          max: '100',
          step: '5',
          value: String(Math.round(this.settings.volume * 100)),
          oninput: (ev) => {
            this.settings.volume = Number((ev.target as HTMLInputElement).value) / 100;
            volumeLabel.textContent = String(Math.round(this.settings.volume * 100));
            this.audio.setVolume(this.settings.volume);
            saveSettings(this.settings);
          },
        }),
        volumeLabel,
      ),
      h('p', { class: 'meta' }, '足音の方向を示す画面上の弧は、設定によらず常に表示されます。字幕・音量の設定で前兆の時刻や猶予は変わりません。'),
      h('p', { class: 'meta' }, '研究員の発話は音声素材がないため、常に台詞として表示します。'),
    );
  }

  private showSettingsScreen(): void {
    this.showScreen(this.settingsForm(), h('div', { class: 'menu' }, button('戻る', () => this.showTitle())));
  }
}

new App();
