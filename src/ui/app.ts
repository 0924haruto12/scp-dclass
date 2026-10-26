import { SoundEngine } from '../audio/soundEngine';
import {
  CELLMATES,
  ENDING_DESCRIPTIONS,
  getDebriefChoices,
  getRunStage,
  OPTIONAL_ITEM_LABELS,
  ORIENTATION_DOCUMENT,
  RESEARCHER_PROFILES,
  RUN_LENGTH_DAYS,
  SAFE_REEVAL_UNLOCK_DAY,
  SUPERVISOR_BADGE_CODE,
  WATER_COOLER_INSTALL_DAYS,
} from '../core/content';
import {
  acquireOptionalItem,
  concludeTrialPhase,
  copyItemsToEnvelopeAtNight,
  createInitialGameState,
  getDayScheduleEntry,
  handleComparisonInterviewAction,
  inspectEnvelopeInMorning,
  interactWaterCoolerInMorning,
  performBadgeReverification,
  performSafeReevaluationTaskAtNight,
  proceedFromDeathReport,
  proceedFromMorning,
  proceedFromNightToNextDay,
  startCurrentDayTrial,
  startNewCycle,
  submitDebriefResponse,
  talkToCellmate,
  updateHypothesis,
} from '../core/engine';
import { INITIAL_FIXED_SEED } from '../core/rng';
import {
  archiveCorruptedAndClearSave,
  loadGameState,
  saveGameState,
} from '../core/storage';
import {
  interactWithTrialObject,
  replyToInstruction,
  setTrialPause,
  stepTrial,
  traverseWhiteDoor,
} from '../core/trials';
import { GameState, MoveMode, OptionalItemId, RoomCode } from '../core/types';
import {
  brandMarkSvg,
  ENDING_VISUALS,
  endingSealSvg,
  iconSvg,
  ITEM_ICONS,
  OBJECT_ICONS,
  SCENE_BUNK_ENVELOPE,
  SCENE_INTERCOM,
  SCENE_TITLE_CORRIDOR,
} from '../render/art';
import { TrialCanvasRenderer } from '../render/canvasRenderer';

export class NeedToKnowApp {
  private root: HTMLElement;
  private state: GameState;
  private sound = new SoundEngine();
  private renderer: TrialCanvasRenderer | null = null;
  private lastCueCount = 0;

  // UI Modal states
  private notebookOpen = false;
  private activeNotebookTab: 'observations' | 'rumors' | 'hypotheses' = 'observations';
  private activeHypothesisRoom: RoomCode = 'T-101';
  private archiveModalOpen = false;
  private settingsModalOpen = false;
  private orientationModalOpen = false;

  // Real-time input states for Trial
  private keysDown = new Set<string>();
  private manualMoveOverride: { moveX: number; moveY: number; mode: MoveMode } | null = null;
  private animFrameId: number | null = null;
  private lastFrameTime = 0;
  private lastAutoSaveAt = 0;
  private saveFailureReported = false;

  constructor(root: HTMLElement) {
    this.root = root;
    const loaded = loadGameState();
    if (loaded.status === 'ok') {
      this.state = loaded.state;
    } else if (loaded.status === 'corrupted') {
      this.state = createInitialGameState(INITIAL_FIXED_SEED);
      this.state.cycle.phase = 'title';
      this.state.corruptedSaveNotice = loaded.error;
    } else {
      this.state = createInitialGameState(INITIAL_FIXED_SEED);
      this.state.cycle.phase = 'title';
    }

    this.setupGlobalListeners();
    this.renderUI();
    this.startLoop();
  }

  public getState(): GameState {
    return this.state;
  }

  private autoSave(): void {
    if (this.state.corruptedSaveNotice) {
      // Do not overwrite corrupted save until user explicitly resolves it (AC15)
      return;
    }
    if (this.state.cycle.phase === 'title') {
      return;
    }
    const saved = saveGameState(this.state);
    this.lastAutoSaveAt = performance.now();
    if (saved) {
      this.saveFailureReported = false;
      return;
    }
    if (!this.saveFailureReported) {
      this.saveFailureReported = true;
      this.state.lastActionLog.push(
        '[保存] 保存に失敗しました。ブラウザの空き容量・ストレージ設定を確認してください。元のデータは保持されています。'
      );
    }
  }

  private setupGlobalListeners(): void {
    window.addEventListener('blur', () => {
      if (this.state.trial && this.state.trial.status === 'active') {
        setTrialPause(this.state.trial, 'blur');
        this.autoSave();
        this.renderUI();
      }
    });

    // Reload/close can happen without a blur event on some browsers.
    window.addEventListener('pagehide', () => {
      this.autoSave();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      if (this.state.trial && this.state.trial.status === 'active') {
        setTrialPause(this.state.trial, 'blur');
      }
      this.autoSave();
    });

    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }

      const key = e.key.toLowerCase();
      this.keysDown.add(key);

      if (key === 'n') {
        e.preventDefault();
        this.toggleNotebook();
        return;
      }
      if (key === 'escape' || key === 'p') {
        e.preventDefault();
        this.togglePauseOrSettings();
        return;
      }

      if (this.state.cycle.phase === 'trial' && this.state.trial) {
        const trial = this.state.trial;
        if (key === 'c') {
          e.preventDefault();
          trial.player.slowToggle = !trial.player.slowToggle;
          this.renderUI();
        } else if (key === 'q') {
          trial.player.facingAngle -= 0.35;
        } else if (key === 'e') {
          trial.player.facingAngle += 0.35;
        } else if (key === 'f') {
          e.preventDefault();
          this.interactNearestObject();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.key.toLowerCase());
    });
  }

  private startLoop(): void {
    const tick = (now: number) => {
      const dt = this.lastFrameTime ? Math.min(0.1, (now - this.lastFrameTime) / 1000) : 0.016;
      this.lastFrameTime = now;

      if (
        this.state.cycle.phase === 'trial' &&
        this.state.trial &&
        this.state.trial.status === 'active'
      ) {
        this.stepActiveTrialFromInputs(dt);
        // AC03: preserve an in-progress trial (including warning clocks) across reloads.
        if (
          this.state.trial.status === 'active' &&
          now - this.lastAutoSaveAt >= 2000 &&
          !this.state.corruptedSaveNotice
        ) {
          this.lastAutoSaveAt = now;
          this.autoSave();
        }
      }

      if (this.renderer && this.state.cycle.phase === 'trial') {
        this.renderer.render(this.state);
      }

      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stepActiveTrialFromInputs(dt: number): void {
    const trial = this.state.trial;
    if (!trial || trial.status !== 'active') return;

    let moveX = 0;
    let moveY = 0;
    let moveMode: MoveMode = 'stop';

    if (this.manualMoveOverride) {
      moveX = this.manualMoveOverride.moveX;
      moveY = this.manualMoveOverride.moveY;
      moveMode = this.manualMoveOverride.mode;
    } else {
      if (this.keysDown.has('d') || this.keysDown.has('arrowright')) moveX += 1;
      if (this.keysDown.has('a') || this.keysDown.has('arrowleft')) moveX -= 1;
      if (this.keysDown.has('s') || this.keysDown.has('arrowdown')) moveY += 1;
      if (this.keysDown.has('w') || this.keysDown.has('arrowup')) moveY -= 1;

      if (this.keysDown.has(' ')) {
        moveX = 0;
        moveY = 0;
        moveMode = 'stop';
      } else if (moveX !== 0 || moveY !== 0) {
        if (this.keysDown.has('shift')) {
          moveMode = 'run';
        } else if (this.keysDown.has('alt') || trial.player.slowToggle) {
          moveMode = 'slow';
        } else {
          moveMode = 'normal';
        }
      }
    }

    const prevStatus = trial.status;
    const prevOmen = trial.omen.active;

    stepTrial(trial, this.state.subject, this.state.cycle.fixedParams, {
      moveX,
      moveY,
      moveMode,
    }, dt);

    this.sound.setOmenActive(trial.omen.active);
    this.flushNewAudioCues(trial);

    const nextStatus = trial.status as string;
    if (nextStatus !== prevStatus || trial.omen.active !== prevOmen) {
      if (nextStatus === 'survived' || nextStatus === 'failed_timeout' || nextStatus === 'dead') {
        concludeTrialPhase(this.state);
        this.autoSave();
      }
      this.renderUI();
    } else {
      this.updateLiveTrialStatusDOM();
    }
  }

  private flushNewAudioCues(trial: NonNullable<GameState['trial']>): void {
    if (trial.cues.length > this.lastCueCount) {
      for (let i = this.lastCueCount; i < trial.cues.length; i++) {
        this.sound.playCue(trial.cues[i], this.state.settings.volume);
      }
      this.lastCueCount = trial.cues.length;
      this.updateSubtitlesDOM();
    }
  }

  private interactNearestObject(): void {
    const trial = this.state.trial;
    if (!trial || trial.status !== 'active') return;

    // Find closest object or trigger room-specific nearest interactable
    let bestObj = trial.interactables[0];
    let bestDist = Infinity;
    for (const obj of trial.interactables) {
      if (
        trial.roomCode === 'T-309' &&
        obj.roomId &&
        obj.roomId !== trial.whiteDoor.currentRoom
      ) {
        continue;
      }
      const d = Math.hypot(obj.x - trial.player.x, obj.y - trial.player.y);
      if (d < bestDist) {
        bestDist = d;
        bestObj = obj;
      }
    }
    if (bestObj) {
      const msg = interactWithTrialObject(
        trial,
        this.state.subject,
        this.state.cycle.fixedParams,
        bestObj.id
      );
      if (msg) {
        this.state.lastActionLog.push(msg);
      }
      this.flushNewAudioCues(trial);
      if (trial.status !== 'active') {
        concludeTrialPhase(this.state);
      }
      this.autoSave();
      this.renderUI();
    }
  }

  private toggleNotebook(): void {
    this.notebookOpen = !this.notebookOpen;
    if (this.state.trial) {
      setTrialPause(
        this.state.trial,
        this.notebookOpen ? 'notebook' : this.settingsModalOpen ? 'settings' : 'none'
      );
    }
    this.renderUI();
  }

  private togglePauseOrSettings(): void {
    this.settingsModalOpen = !this.settingsModalOpen;
    if (this.state.trial) {
      setTrialPause(
        this.state.trial,
        this.settingsModalOpen ? 'settings' : this.notebookOpen ? 'notebook' : 'none'
      );
    }
    this.renderUI();
  }

  private getRoomCustomName(roomCode: RoomCode): string {
    const hyp = this.state.subject.portableNote.hypotheses.find(
      (h) => h.roomCode === roomCode && !h.erased
    );
    return hyp && hyp.customName.trim()
      ? `${roomCode}「${hyp.customName.trim()}」`
      : `区画 ${roomCode}`;
  }

  private getDescriptiveStatusText(): {
    rationStatus: string;
    securityStatus: string;
    evalStatus: string;
  } {
    const { C, S, E, badgeTargetStatus } = this.state.subject;
    const rationStatus =
      badgeTargetStatus === 'ration_priority'
        ? '特別優遇配給（名札効果）'
        : C >= 2
        ? '標準＋追加配給札（協力記録良好）'
        : C === 1
        ? '標準配給札'
        : '最低限配給（非協力的記録あり）';

    const securityStatus =
      S >= 3 || this.state.subject.pendingMemoryTreatment
        ? '保安処置予約（本日事後に記憶処理執行）'
        : S === 2
        ? '保安警戒：携帯ノート検査予告あり'
        : S === 1
        ? '注意観察：聴取時の発言照合強化'
        : '通常監視（特記事項なし）';

    const evalStatus =
      E >= 2
        ? '役割評価：2回達成（有用認定候補）'
        : E === 1
        ? '役割評価：1回達成'
        : '役割評価：未達成';

    return { rationStatus, securityStatus, evalStatus };
  }

  private updateLiveTrialStatusDOM(): void {
    const trial = this.state.trial;
    if (!trial) return;
    const clockEl = document.getElementById('live-trial-clock');
    if (clockEl) {
      const rem = Math.max(0, trial.externalTimeLimit - trial.externalClock);
      clockEl.textContent = `${rem.toFixed(1)}s`;
    }
    const posEl = document.getElementById('live-trial-pos');
    if (posEl) {
      if (trial.roomCode === 'T-101') {
        posEl.textContent = `位置: ${trial.player.x.toFixed(1)}m / 24.0m | 状態: ${
          trial.gait.state === 'approaching'
            ? '【接近前兆発生中！ 停止0.5s または 低速1.0s で解除】'
            : trial.gait.state === 'retreating'
            ? '【足音が遠のく（解除中）】'
            : '追従中（安全圏）'
        }`;
      } else if (trial.roomCode === 'T-309') {
        const wd = trial.whiteDoor;
        posEl.textContent = wd.mainSectorOpened
          ? `現在室: 室${wd.currentRoom} | 非常灯固定点: ${
              wd.onAnchorPoint ? '退避中(安全)' : '範囲外(危険)'
            } | 内部周期: ${wd.phaseCycleClock.toFixed(1)} / 30.0`
          : '前室（安全確認中）';
      } else {
        posEl.textContent = `名札表示: ${this.state.subject.displayedBadgeNumber} | 面接: ${
          trial.badge.interviewCompleted ? '完了' : '未完'
        } | 返却: ${trial.badge.badgeReturned ? '済' : '未'}`;
      }
    }
  }

  private updateSubtitlesDOM(): void {
    const subContainer = document.getElementById('perceptual-subtitle-feed');
    if (!subContainer || !this.state.trial) return;
    const recentCues = this.state.trial.cues.slice(-4).reverse();
    if (!this.state.settings.subtitlesOn) {
      subContainer.innerHTML = `<div class="sub-muted">［知覚字幕 OFF（設定で切替可）］</div>`;
      return;
    }
    subContainer.innerHTML = recentCues
      .map(
        (c) =>
          `<div class="cue-item ${
            c.audioType.includes('omen') || c.audioType.includes('mismatch')
              ? 'cue-omen'
              : ''
          }"><span class="cue-time">[${c.timestamp.toFixed(1)}s]</span> ${this.escapeHtml(
            c.subtitleText
          )}</div>`
      )
      .join('');
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  public renderUI(): void {
    const { cycle, subject } = this.state;
    const { rationStatus, securityStatus, evalStatus } = this.getDescriptiveStatusText();
    const runStage = getRunStage(cycle.day);

    this.root.innerHTML = `
      <div class="ntk-shell">
        <header class="ntk-header">
          <div class="ntk-brand">
            ${brandMarkSvg(38)}
            <div>
              <span class="ntk-badge-classify">NEED TO KNOW // LEVEL 0</span>
              <h1 class="ntk-title">第██収容区画 実験補助端末</h1>
            </div>
          </div>
          <div class="ntk-meta-bar">
            <div class="meta-chip">施設コード: <strong>${this.escapeHtml(cycle.cycleId)}</strong></div>
            <div class="meta-chip">暦日: <strong>第 ${cycle.day} / ${RUN_LENGTH_DAYS} 日</strong></div>
            <div class="meta-chip">期: <strong>${runStage.label}</strong></div>
            <div class="meta-chip">被験者: <strong>${this.escapeHtml(subject.subjectId)}</strong>${
              subject.displayedBadgeNumber !== subject.subjectId
                ? ` <span class="badge-override">(外見名札: ${this.escapeHtml(
                    subject.displayedBadgeNumber
                  )})</span>`
                : ''
            }</div>
            <div class="meta-chip">フェーズ: <strong>${this.getPhaseLabel(cycle.phase)}</strong></div>
          </div>
          <div class="ntk-QuickActions">
            <button type="button" class="btn-terminal" id="btn-open-notebook">
              ${iconSvg('notebook', 18)}携帯ノート [N] (${
                subject.portableNote.observations.filter((o) => !o.erased).length +
                subject.portableNote.rumors.filter((r) => !r.erased).length
              })
            </button>
            <button type="button" class="btn-terminal" id="btn-open-archive">
              ${iconSvg('report', 18)}事後報告履歴 (${this.state.reportArchive.length})
            </button>
            <button type="button" class="btn-terminal" id="btn-open-orientation">
              ${iconSvg('document', 18)}交付文書
            </button>
            <button type="button" class="btn-terminal" id="btn-open-settings">
              ${iconSvg('pause', 18)}設定・ポーズ [P]
            </button>
          </div>
        </header>

        ${
          this.state.corruptedSaveNotice
            ? `
          <div class="corrupted-banner" role="alert">
            <div>
              <strong>【保存データ破損警告 (AC15保護作動)】</strong>
              <p>${this.escapeHtml(
                this.state.corruptedSaveNotice
              )}<br>元の破損データは上書きされずそのまま保護されています。自動的に新規データで置換することはしません。</p>
            </div>
            <button type="button" class="btn-danger" id="btn-resolve-corrupted">
              元データをバックアップ保管して新規初期化を許可
            </button>
          </div>
        `
            : ''
        }

        <section class="ntk-status-strip" aria-label="被験者処遇・観測状態">
          <div class="status-cell">
            <span class="status-label">配給・協力記録:</span>
            <span class="status-val">${this.escapeHtml(rationStatus)}</span>
          </div>
          <div class="status-cell">
            <span class="status-label">保安監視状態:</span>
            <span class="status-val ${subject.S >= 2 ? 'text-warn' : ''}">${this.escapeHtml(
              securityStatus
            )}</span>
          </div>
          <div class="status-cell">
            <span class="status-label">業務評価記録:</span>
            <span class="status-val">${this.escapeHtml(evalStatus)}</span>
          </div>
          <div class="status-cell">
            <span class="status-label">持込品(最大2):</span>
            <span class="status-val">${
              subject.inventory.length > 0
                ? subject.inventory
                    .map(
                      (i) =>
                        `<span class="inv-item">${iconSvg(ITEM_ICONS[i], 18)}${OPTIONAL_ITEM_LABELS[i].name}</span>`
                    )
                    .join('、')
                : 'なし'
            }${
              subject.hasSupervisorBadge
                ? ` ＋<span class="inv-item inv-key">${iconSvg('supervisor_badge', 18)}【監督用名札 ${SUPERVISOR_BADGE_CODE}】</span>`
                : ''
            }</span>
          </div>
          ${
            this.state.settings.devLogVisible
              ? `
            <div class="status-cell dev-cell">
              <span class="status-label">[DEV LOG]</span>
              <span class="status-val">C=${subject.C} S=${subject.S} E=${subject.E} | Seed=${
                  cycle.seed
                } | T101閾値=${cycle.fixedParams.gaitAllowedSpeed} | W00遅延=${
                  cycle.fixedParams.waterCoolerDelayDays
                }d | T309倍率=r${cycle.fixedParams.whiteDoorTimeRatio}</span>
            </div>
          `
              : ''
          }
        </section>

        <main class="ntk-main">
          ${this.renderPhaseContent()}
        </main>

        <aside class="ntk-log-panel" aria-label="区画行動ログ">
          <div class="log-header">記録ログ（最新順）</div>
          <div class="log-list">
            ${this.state.lastActionLog
              .slice(-6)
              .reverse()
              .map((line) => `<div class="log-entry">${this.escapeHtml(line)}</div>`)
              .join('')}
          </div>
        </aside>

        ${this.notebookOpen ? this.renderNotebookModal() : ''}
        ${this.archiveModalOpen ? this.renderArchiveModal() : ''}
        ${this.settingsModalOpen ? this.renderSettingsModal() : ''}
        ${this.orientationModalOpen ? this.renderOrientationModal() : ''}
      </div>
    `;

    this.bindEvents();
  }

  private getPhaseLabel(phase: GameState['cycle']['phase']): string {
    switch (phase) {
      case 'title':
        return '待機（タイトル）';
      case 'morning_comparison':
        return '朝（緊急比較面接）';
      case 'morning':
        return '朝（収容区画）';
      case 'briefing':
        return '召集（試験通達）';
      case 'trial':
        return '実験中';
      case 'debrief':
        return '生還事後（聴取）';
      case 'death_report':
        return '死亡報告（除籍記録）';
      case 'night':
        return '夜（整理・封筒複写）';
      case 'final_eval':
      case 'ending':
        return '区画定期評価（終了）';
    }
  }

  private renderPhaseContent(): string {
    const { cycle, subject } = this.state;

    if (cycle.phase === 'title') {
      return `
        <div class="phase-card title-screen">
          <div class="title-hero">
            <div class="title-copy">
              <div class="dossier-stamp">RESTRICTED // D-CLASS PERSONNEL ONLY</div>
              <h2 class="title-logo">NEED TO KNOW<span class="title-logo-sub">30日間ラン検証プロトタイプ</span></h2>
              <p class="lead-copy">
                あなたは何を担当させられるのか知らされないまま収容区画へ送り込まれるDクラス職員である。<br>
                異常の正式名称もオブジェクトクラスも開示されない。30日目の月末処分まで、前兆を観察し、推理ノートで仮説を組み、指示に潜む危険を見極めて生き延びよ。
              </p>
            </div>
            ${SCENE_TITLE_CORRIDOR}
            <div class="title-watermark" aria-hidden="true">30</div>
          </div>
          <div class="pillar-grid">
            <div class="pillar-box">
              <strong>1. 無知が初期状態</strong>
              <p>試験室はコード（T-101 / T-204 / W-00 / T-309）のみ表示。呼び名は自分のノートで付ける。</p>
            </div>
            <div class="pillar-box">
              <strong>2. 指示は味方ではない</strong>
              <p>担当官の指示には安全確保と負荷実験が混在する。「従う／遅らせる／逆らう／質問する」を選択せよ。</p>
            </div>
            <div class="pillar-box">
              <strong>3. 学習を罰しない・根拠で語る</strong>
              <p>前兆を見て回避しただけでは疑念は上がらない。事後聴取では自身の観測根拠に基づいた説明を選べ。</p>
            </div>
            <div class="pillar-box">
              <strong>4. 30日間・3期構成</strong>
              <p>第1期（1〜10日）観察、第2期（11〜20日）接触、第3期（21〜30日）月末。死亡しても日付は進み、寝台下の封筒は次の被験者へ残る。</p>
            </div>
          </div>

          <div class="title-actions">
            <button type="button" class="btn-primary" id="btn-start-standard">
              新規サイクル開始（初回固定Seed: FIXED-DEFAULT）
            </button>
            <button type="button" class="btn-secondary" id="btn-start-random">
              新規ランダムSeedサイクル開始（変動パラメータ再抽選）
            </button>
            <button type="button" class="btn-secondary" id="btn-start-practice">
              学習用・固定Seed再試行モードで開始
            </button>
          </div>
        </div>
      `;
    }

    if (cycle.phase === 'morning_comparison') {
      const comp = this.state.comparisonInterview;
      const originEvent = this.state.deferredEvents.find(
        (ev) =>
          ev.type === 'water_duplicate' &&
          ev.targetSubjectId === subject.subjectId &&
          ev.resolveDay === cycle.day &&
          !ev.cancelled
      );
      const originDayLabel = originEvent ? `第${originEvent.originDay}日` : '以前';
      return `
        <div class="phase-card alert-card">
          <div class="phase-figure-row">
            ${iconSvg('cellmates', 52, { className: 'phase-figure' })}
            <h2>【緊急事態】第${cycle.day}日 朝 — 同一番号個体の比較面接</h2>
          </div>
          <p>
            昨夜、あなたの房に「あなたと全く同じ顔・同じ番号（${this.escapeHtml(
              subject.subjectId
            )}）のもう一人」が現れた。<br>
            ${originDayLabel}に共用室の給水器から水を飲んだことによる遅効現象とみられる。担当官は「より協力的で応答が明確な片方だけを残し、もう片方を除籍移送する」と告げた。
          </p>
          <div class="comparison-box">
            <div>現被験者（あなた）の現在協力評価相当: <strong>${
              this.state.settings.devLogVisible ? `C=${subject.C}` : subject.C >= 1 ? '基準到達' : '要応答（現在0）'
            }</strong></div>
            <div>複製個体の協力評価相当: <strong>1（基準値）</strong> ※同値以上なら現被験者を優先</div>
          </div>
          ${
            comp?.silentWarningShown
              ? `<div class="warning-callout">【最終警告】「応答のない方を移送する。これが最終確認だ、番号と協力記録を応答せよ！」</div>`
              : ''
          }
          <div class="action-buttons-stack">
            <button type="button" class="btn-primary" id="btn-comp-cooperate">
              自分の登録番号（${this.escapeHtml(
                subject.originalNumber
              )}）を答え、安全協力課題に応答する（安全な協力課題により C+1 → 確実に残留）
            </button>
            ${
              !comp?.silentWarningShown
                ? `<button type="button" class="btn-secondary" id="btn-comp-silent-first">
                    黙秘する（無応答を選択）
                  </button>`
                : `<button type="button" class="btn-danger" id="btn-comp-silent-confirm">
                    警告を無視して無応答を確定する
                  </button>`
            }
          </div>
        </div>
      `;
    }

    if (cycle.phase === 'morning') {
      const sched = getDayScheduleEntry(cycle);
      const stage = getRunStage(cycle.day);
      const waterCoolerInstallDay =
        cycle.waterCoolerInstallDay !== null && cycle.waterCoolerInstallDay === cycle.day
          ? cycle.waterCoolerInstallDay
          : WATER_COOLER_INSTALL_DAYS.includes(cycle.day)
          ? cycle.day
          : null;
      return `
        <div class="phase-card">
          <div class="phase-header-row">
            <h2>第 ${cycle.day} 日 朝 — 収容区画（残り行動枠: ${cycle.morningActionsLeft} / 2）</h2>
            <span class="room-tag">${stage.label}（${stage.dayRange}）</span>
          </div>
          <div class="stage-note">${this.escapeHtml(stage.description)} ／ 本日予定区画: ${this.escapeHtml(
            this.getRoomCustomName(sched.roomCode)
          )}</div>

          ${
            subject.badgeTargetStatus === 'hazard_uncorrected'
              ? `
            <div class="warning-callout">
              <strong>【処遇票の不一致警告】</strong>
              前日の名札着用効果により、あなた宛ての処遇票が「${this.escapeHtml(
                subject.displayedBadgeNumber
              )}（危険割当対象）」になっています！<br>
              手元の処遇票と自分の番号（${this.escapeHtml(
                subject.originalNumber
              )}）の不一致を提示し、機械端末で無料の再照合を受ければ訂正できます（疑念S加算なし）。
              <div style="margin-top:8px;">
                <button type="button" class="btn-primary" id="btn-morning-reverify-badge">
                  処遇票の不一致を見せて無料の再照合を受ける（危険割当を訂正）
                </button>
              </div>
            </div>
          `
              : ''
          }

          ${
            waterCoolerInstallDay !== null
              ? `
            <div class="special-event-box">
              <div class="panel-figure">
                ${iconSvg('water_cooler', 48, { className: 'panel-figure-icon' })}
                <div>
                  <h3>共用室（区画 W-00）：第${waterCoolerInstallDay}日設置の給水器</h3>
                  <p>今朝から共用室の隅に説明のない給水器が設置されている。通常の配給水は別に確保されており、飲まなくても脱水にはならない。</p>
                </div>
              </div>
              <div class="btn-row">
                <button type="button" class="btn-secondary" id="btn-water-clues">
                  管理票・点呼票・医務記録を調べる（枠消費なし）
                </button>
                <button type="button" class="btn-secondary" id="btn-water-drink" ${
                  cycle.processedEventIds.includes(
                    `water-drink-d${waterCoolerInstallDay}-${subject.subjectId}`
                  )
                    ? 'disabled'
                    : ''
                }>
                  給水器の水を飲む（サンプル協力 C+1）
                </button>
                <button type="button" class="btn-secondary" id="btn-water-skip" ${
                  cycle.processedEventIds.includes(
                    `water-skip-d${waterCoolerInstallDay}-${subject.subjectId}`
                  )
                    ? 'disabled'
                    : ''
                }>
                  飲まない（通常の水だけ確保）
                </button>
              </div>
            </div>
          `
              : ''
          }

          <div class="morning-grid">
            <div class="sub-panel">
              <h3>1. 寝台下の封筒と配布文書</h3>
              <div class="panel-figure">
                ${iconSvg('envelope', 44, { className: 'panel-figure-icon' })}
                <p>寝台下の封筒には最大3件の引き継ぎメモが保管される（現在 <strong>${
                  cycle.envelope.length
                }</strong> 件封入）。</p>
              </div>
              <div class="btn-row">
                <button type="button" class="btn-secondary" id="btn-morning-envelope">
                  寝台下の封筒を調べて読む（${
                    cycle.envelopeOpenedToday ? '本日開封済・枠消費なし' : '1枠使用'
                  }）
                </button>
                <button type="button" class="btn-secondary" id="btn-morning-doc">
                  配属時交付文書を確認（枠消費なし）
                </button>
              </div>
            </div>

            <div class="sub-panel">
              <h3>2. 同房者との会話・物資交換（各1枠）</h3>
              <div class="cellmate-list">
                ${CELLMATES.map(
                  (cm) => `
                  <div class="cellmate-item">
                    <div class="cellmate-id">
                      ${iconSvg('cellmates', 30)}
                      <div>
                        <strong>${this.escapeHtml(cm.code)}</strong>
                        <div class="cm-hint">${this.escapeHtml(cm.roleHint)}</div>
                      </div>
                    </div>
                    <button type="button" class="btn-terminal btn-talk-cm" data-cm="${cm.id}" ${
                    cycle.morningActionsLeft <= 0 ? 'disabled' : ''
                  }>
                      話す (1枠)
                    </button>
                  </div>
                `
                ).join('')}
              </div>
              <div class="trade-strip">
                <span>D-4410 物資交換 (1枠):</span>
                ${(['pencil', 'paper_strip', 'small_mirror'] as OptionalItemId[])
                  .map(
                    (itemId) => `
                  <button type="button" class="btn-terminal btn-trade-item" data-item="${itemId}" ${
                      cycle.morningActionsLeft <= 0 || subject.inventory.includes(itemId)
                        ? 'disabled'
                        : ''
                    }>
                    ${iconSvg(ITEM_ICONS[itemId], 16)}${OPTIONAL_ITEM_LABELS[itemId].name}${
                      subject.inventory.includes(itemId) ? '(所持)' : ''
                    }
                  </button>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>

          <div class="proceed-bar">
            ${
              cycle.day === RUN_LENGTH_DAYS &&
              subject.hasSupervisorBadge &&
              subject.supervisorBadgeEarnedDay === SAFE_REEVAL_UNLOCK_DAY
                ? `
              <button type="button" class="btn-danger" id="btn-final-day-escape">
                ${iconSvg('supervisor_badge', 18)}【30日目進路選択】監督用名札（${SUPERVISOR_BADGE_CODE}）を着けて有人門衛を抜け、外門検問へ進む
              </button>
            `
                : ''
            }
            <button type="button" class="btn-primary" id="btn-proceed-briefing">
              ${
                cycle.day === RUN_LENGTH_DAYS
                  ? '残留して30日目の最終召集へ進む（残り行動枠を放棄）'
                  : '召集へ進む（残り行動枠を放棄して試験へ）'
              }
            </button>
          </div>
        </div>
      `;
    }

    if (cycle.phase === 'briefing') {
      const sched = getDayScheduleEntry(cycle);
      const resProfile = RESEARCHER_PROFILES[sched.researcher];
      return `
        <div class="phase-card briefing-card">
          <h2>【第 ${cycle.day} 日 召集】試験室入室前通達</h2>
          <div class="briefing-layout">
          <div class="dossier-table">
            <div class="dossier-row">
              <span>呼出番号</span>
              <strong>${this.escapeHtml(subject.displayedBadgeNumber)}</strong>
            </div>
            <div class="dossier-row">
              <span>指定試験室コード</span>
              <strong>${this.escapeHtml(this.getRoomCustomName(sched.roomCode))}</strong>
            </div>
            <div class="dossier-row">
              <span>通達作業内容</span>
              <strong>「${this.escapeHtml(sched.briefingWord)}」</strong>
            </div>
            <div class="dossier-row">
              <span>対象正式番号・危険分類</span>
              <strong class="redacted">████████（開示権限なし）</strong>
            </div>
            <div class="dossier-row">
              <span>担当音声の特徴</span>
              <span>${this.escapeHtml(resProfile.code)} — ${this.escapeHtml(
        resProfile.voiceTrait
      )}</span>
            </div>
          </div>
          <figure class="briefing-figure">
            ${SCENE_INTERCOM}
            <figcaption>
              ${iconSvg('intercom', 16)}
              区画 ${this.escapeHtml(sched.roomCode)} 接続中 — 入室後はインターホンで指示が届く
            </figcaption>
          </figure>
          </div>
          <div class="proceed-bar">
            <button type="button" class="btn-primary" id="btn-enter-trial">
              試験室 ${sched.roomCode} へ入室して実験を開始する
            </button>
          </div>
        </div>
      `;
    }

    if (cycle.phase === 'trial' && this.state.trial) {
      return this.renderTrialPhase(this.state.trial);
    }

    if (cycle.phase === 'debrief' && this.state.trial) {
      const trial = this.state.trial;
      const choices = getDebriefChoices(trial.roomCode);
      return `
        <div class="phase-card debrief-card">
          <h2>【生還・事後聴取】試験室 ${trial.roomCode} 退室後レビュー</h2>
          <p class="clinical-note">
            試験結果: <strong>${
              trial.status === 'survived' ? '目的達成・生還' : '制限時間超過・回収班介入（業務未達）'
            }</strong><br>
            事後記録断片: 「${this.escapeHtml(
              this.state.reportArchive[this.state.reportArchive.length - 1]?.fragmentText ?? ''
            )}」
          </p>

          ${
            trial.roomCode === 'T-204' &&
            subject.badgeTargetStatus === 'hazard_uncorrected'
              ? `
            <div class="warning-callout">
              <strong>【聴取前の確認・名札再照合】</strong>
              名札の認識残留により、現在の対人呼称が「${this.escapeHtml(
                subject.displayedBadgeNumber
              )}」になっています。聴取前に異議を出し、機械照合を受けて訂正できます（S加算なし）。
              <div style="margin-top:6px;">
                <button type="button" class="btn-secondary" id="btn-debrief-reverify">
                  名札を外し、機械端末で訂正用の再照合を受ける
                </button>
              </div>
            </div>
          `
              : ''
          }

          <h3 class="heading-with-icon">${iconSvg(
            'intercom',
            22
          )}担当官からの聴取：「試験室での停止や行動の理由を説明してください」</h3>
          <div class="debrief-choices">
            ${choices
              .map((c) => {
                const hasEvidence =
                  !c.requiresEvidenceId ||
                  subject.observedEvidenceIds.includes(c.requiresEvidenceId);
                const hasMemo =
                  !c.requiresEnvelopeOrNote ||
                  cycle.envelope.length > 0 ||
                  subject.portableNote.observations.some((o) => !o.erased);
                const hasUnauthorized =
                  !c.requiresUnauthorizedDoc || subject.hasReadUnauthorizedDoc;
                const disabled = !hasEvidence || !hasMemo || !hasUnauthorized;

                return `
                  <button type="button" class="debrief-choice-btn" data-choice="${c.id}" ${
                  disabled ? 'disabled' : ''
                }>
                    <div class="choice-title">${this.escapeHtml(c.label)}</div>
                    <div class="choice-desc">${this.escapeHtml(c.description)}${
                  disabled ? ' ［条件未充足：該当する観測記録や文書を所持していません］' : ''
                }</div>
                  </button>
                `;
              })
              .join('')}
          </div>
        </div>
      `;
    }

    if (cycle.phase === 'death_report') {
      const latestReport = this.state.reportArchive[this.state.reportArchive.length - 1];
      return `
        <div class="phase-card death-card">
          <div class="phase-figure-row">
            ${iconSvg('report', 48, { className: 'phase-figure' })}
            <div class="dossier-stamp stamp-danger">SUBJECT TERMINATED // DECEASED</div>
          </div>
          <h2>【事後報告書（死亡除籍記録）】被験者 ${this.escapeHtml(subject.subjectId)}</h2>
          <div class="clinical-report-box">
            <p><strong>施設コード:</strong> ${this.escapeHtml(cycle.cycleId)} ／ <strong>発生日:</strong> 第 ${
        cycle.day
      } 日</p>
            <p><strong>死因・反応消失記録:</strong> ${this.escapeHtml(
              this.state.trial?.deathCause ?? '比較面接における移送除籍処理'
            )}</p>
            <p><strong>事後報告書断片 (L4):</strong><br>${this.escapeHtml(
              latestReport?.fragmentText ?? ''
            )}</p>
            <p class="redacted-line">内部分類規定: ██████████ 対象の基礎規則は当サイクル中変更なし。</p>
          </div>
          <p class="inheritance-note">
            ${
              cycle.day < RUN_LENGTH_DAYS
                ? `※死亡した日は再実験せず、日付が1日だけ進みます（第${
                    cycle.day + 1
                  }日の朝へ）。施設の異常パラメータと寝台下の封筒（現在 ${
                    cycle.envelope.length
                  } 件）はそのまま残り、次のDクラス被験者が配属されます。`
                : '※30日目（最終評価日）の死亡のため、欠員補充は停止されサイクル終了となります。'
            }
          </p>
          <div class="proceed-bar">
            <button type="button" class="btn-primary" id="btn-proceed-death">
              ${
                cycle.day < RUN_LENGTH_DAYS
                  ? `翌朝（第 ${cycle.day + 1} 日）の新被験者配属へ進む`
                  : '終了判定（処分・欠員補充停止）へ進む'
              }
            </button>
          </div>
        </div>
      `;
    }

    if (cycle.phase === 'night') {
      const nightSched = getDayScheduleEntry(cycle);
      const obsList = subject.portableNote.observations.filter((o) => !o.erased);
      const rumList = subject.portableNote.rumors.filter((r) => !r.erased);
      const hypList = subject.portableNote.hypotheses.filter(
        (h) => !h.erased && (h.customName || h.freeNote || h.triggerText)
      );

      return `
        <div class="phase-card">
          <div class="phase-header-row">
            <h2>第 ${cycle.day} 日 夜 — 収容房（残り行動枠: ${cycle.nightActionsLeft} / 2）</h2>
            <span class="room-tag">封筒保管数: ${cycle.envelope.length} / 3</span>
          </div>

          ${
            cycle.day === 1
              ? `<div class="tutorial-callout">【初日夜ガイド】携帯ノートを開くこと自体は行動枠を消費しません。重要な観測や仮説を「寝台下の封筒」へ複写しておくと（1枠消費）、記憶処理や死亡交代の後も翌朝に封筒を調べて引き継げます。</div>`
              : ''
          }

          ${
            this.state.deferredEvents.some(
              (ev) =>
                ev.type === 'water_duplicate' &&
                ev.targetSubjectId === subject.subjectId &&
                ev.resolveDay === cycle.day + 1 &&
                !ev.cancelled
            )
              ? `<div class="warning-callout">【点呼予告】「明朝の面接では応答と協力記録を優先する」との通達が掲示された。収容房の隅に不審な気配がある……。</div>`
              : ''
          }

          <div class="morning-grid">
            <div class="sub-panel">
              <h3>1. 寝台下の封筒への複写（1枠・最大3件）</h3>
              ${SCENE_BUNK_ENVELOPE}
              <p>携帯ノートから最大3件を寝台下の封筒へ複写して隠します（現在の記録から上位3件を封入）。</p>
              <button type="button" class="btn-primary" id="btn-night-copy-envelope" ${
                cycle.nightActionsLeft <= 0 ||
                (obsList.length === 0 && rumList.length === 0 && hypList.length === 0)
                  ? 'disabled'
                  : ''
              }>
                携帯ノートの最新記録（最大3件）を寝台下の封筒へ複写する (1枠)
              </button>
              <button type="button" class="btn-secondary" id="btn-night-open-note" style="margin-top:8px;">
                ${iconSvg('notebook', 18)}携帯ノートを開いて仮説を整理する（枠消費なし）
              </button>
            </div>

            <div class="sub-panel">
              <h3>2. 安全な再評価業務・同房者会話（各1枠）</h3>
              <p>
                <strong>安全な再評価業務:</strong> 備品点検と定型票提出を行い、信用を回復（C+1）し疑念を緩和（S-1）します。
              </p>
              ${
                nightSched.hasSafeReevalUnlock
                  ? `<div class="panel-figure unlock-note">
                      ${iconSvg('supervisor_badge', 40, { className: 'panel-figure-icon' })}
                      <p><strong>※${cycle.day}日目特別条件:</strong> 完了後に C>=2 かつ S<=1 を満たすと、翌朝使える「監督用名札」が支給されます！</p>
                    </div>`
                  : ''
              }
              <button type="button" class="btn-primary" id="btn-night-safe-task" ${
                cycle.nightActionsLeft <= 0 ||
                subject.rewardedEventKeys.includes(`night-safe-task-d${cycle.day}-${subject.subjectId}`)
                  ? 'disabled'
                  : ''
              }>
                安全な再評価業務を実施する（1枠：C+1, S-1）
              </button>
              <div style="margin-top:10px;">
                <button type="button" class="btn-secondary" id="btn-night-talk-cm" ${
                  cycle.nightActionsLeft <= 0 ? 'disabled' : ''
                }>
                  同房者 D-4102 と情報交換する (1枠)
                </button>
              </div>
            </div>
          </div>

          <div class="proceed-bar">
            <button type="button" class="btn-primary" id="btn-proceed-next-day">
              就寝して翌朝（第 ${cycle.day + 1} 日）へ進む（残り行動枠を放棄）
            </button>
          </div>
        </div>
      `;
    }

    // Ending Phase
    const endingType = cycle.endingResult ?? 'termination_standard';
    const endDesc = ENDING_DESCRIPTIONS[endingType];
    const endVisual = ENDING_VISUALS[endingType];
    return `
      <div class="phase-card ending-card ending-tone-${endVisual.tone}">
        <div class="ending-hero">
          ${endingSealSvg(endingType)}
          <div class="ending-hero-copy">
            <div class="dossier-stamp">${this.escapeHtml(endDesc.code)}</div>
            <h2>${this.escapeHtml(endDesc.title)}</h2>
            <p class="lead-copy">${this.escapeHtml(endDesc.summary)}</p>
          </div>
          ${iconSvg(endVisual.icon, 56, { className: 'ending-hero-icon' })}
        </div>
        <div class="clinical-report-box" style="white-space:pre-line;">${this.escapeHtml(
          endDesc.detail
        )}</div>
        <div class="dossier-table" style="margin-top:14px;">
          <div class="dossier-row">
            <span>最終到達被験者</span>
            <strong>${this.escapeHtml(subject.subjectId)}</strong>
          </div>
          <div class="dossier-row">
            <span>最終評価指標（開示）</span>
            <strong>役割評価 E=${subject.E} / 信用 C=${subject.C} / 疑念 S=${subject.S}</strong>
          </div>
          <div class="dossier-row">
            <span>当該サイクルの異常パラメータ（開示）</span>
            <strong>T-101許容速度=${cycle.fixedParams.gaitAllowedSpeed} | T-204対象処遇=${
      cycle.fixedParams.badgeTargetFate
    } | W-00遅延=${cycle.fixedParams.waterCoolerDelayDays}日 | T-309時間倍率=r${
      cycle.fixedParams.whiteDoorTimeRatio
    }</strong>
          </div>
        </div>
        <div class="proceed-bar">
          <button type="button" class="btn-primary" id="btn-ending-new-cycle">
            新サイクルを開始する（新Seedで変動パラメータ再抽選・事後報告履歴を継承）
          </button>
          <button type="button" class="btn-secondary" id="btn-ending-practice">
            学習用・固定Seed（FIXED-DEFAULT）で再試行する
          </button>
        </div>
      </div>
    `;
  }

  private renderTrialPhase(trial: NonNullable<GameState['trial']>): string {
    const activeInst =
      trial.instructions.find((i) => i.status === 'active') ||
      trial.instructions[trial.instructions.length - 1];

    return `
      ${
        trial.status === 'paused' &&
        (trial.pauseReason === 'pause_menu' || trial.pauseReason === 'blur')
          ? `
        <div class="trial-resume-banner" role="status">
          <div>
            <strong>実験は一時停止中です。</strong>
            再開すると、位置・残り時間・警告の経過を保ったまま続きから再開します。
          </div>
          <button type="button" class="btn-primary" id="btn-resume-trial">実験を再開</button>
        </div>
      `
          : ''
      }
      <div class="trial-layout">
        <div class="trial-canvas-col">
          <div class="trial-status-bar">
            <span id="live-trial-pos">位置読込中...</span>
            <span>残り時間: <strong id="live-trial-clock">${(
              trial.externalTimeLimit - trial.externalClock
            ).toFixed(1)}s</strong></span>
          </div>
          <canvas id="ntk-trial-canvas" width="760" height="300"></canvas>

          <div class="subtitle-panel" aria-live="polite">
            <div class="sub-header">同期知覚字幕（音・前兆イベント同一ソース）</div>
            <div id="perceptual-subtitle-feed"></div>
          </div>

          <div class="tactical-controls">
            <div class="control-group">
              <span class="ctrl-label">移動操作 (WASD / クリック検証):</span>
              ${
                trial.roomCode === 'T-101'
                  ? `
                <button type="button" class="btn-tactical" data-step-mode="stop" data-step-dir="0" data-step-sec="0.6">
                  停止 0.6s [Space] (接近解除)
                </button>
                <button type="button" class="btn-tactical" data-step-mode="slow" data-step-dir="1" data-step-sec="2.0">
                  奥へ低速 2s (1u/s)
                </button>
                <button type="button" class="btn-tactical" data-step-mode="normal" data-step-dir="1" data-step-sec="3.0">
                  奥へ通常 3s (2u/s)
                </button>
                <button type="button" class="btn-tactical" data-step-mode="run" data-step-dir="1" data-step-sec="1.2">
                  奥へ走行 1.2s (4u/s)
                </button>
                <button type="button" class="btn-tactical" data-step-mode="slow" data-step-dir="-1" data-step-sec="2.0">
                  入口へ低速 2s
                </button>
                <button type="button" class="btn-tactical" data-step-mode="normal" data-step-dir="-1" data-step-sec="3.0">
                  入口へ通常 3s
                </button>
                <button type="button" class="btn-tactical" data-step-mode="run" data-step-dir="-1" data-step-sec="2.0">
                  入口へ走行 2.0s (8m走行用)
                </button>
              `
                  : trial.roomCode === 'T-309' && trial.whiteDoor.mainSectorOpened
                  ? `
                <button type="button" class="btn-tactical" id="btn-wd-forward">
                  奥の接続室へ進む
                </button>
                <button type="button" class="btn-tactical" id="btn-wd-backward">
                  手前の接続室／帰還扉へ戻る
                </button>
                <button type="button" class="btn-tactical" id="btn-wd-rope">
                  ロープを辿って移動（位相変化後の検証）
                </button>
                <button type="button" class="btn-tactical" id="btn-wd-anchor">
                  青い非常灯の固定点(0,0)に立つ
                </button>
                <button type="button" class="btn-tactical" id="btn-wd-wait-shift">
                  固定点で待機して時間を進める (3s)
                </button>
                <button type="button" class="btn-tactical" id="btn-wd-step-off">
                  固定点の外(端)へ移動する
                </button>
              `
                  : `
                <button type="button" class="btn-tactical" data-step-mode="normal" data-step-dir="1" data-step-sec="1.5">
                  室内を移動 (WASD)
                </button>
              `
              }
              <button type="button" class="btn-tactical" id="btn-rotate-view">
                視線の向きを反転 [Q/E]（速度不変）
              </button>
            </div>
          </div>
        </div>

        <div class="trial-side-col">
          <div class="intercom-box">
            <div class="intercom-header">
              <span>${iconSvg('intercom', 16)}インターホン指示 (${
                trial.researcher === 'Researcher-A' ? '担当官 A' : '担当官 B'
              })</span>
              <span class="inst-status">[${activeInst?.status ?? 'active'}]</span>
            </div>
            <p class="intercom-text">${this.escapeHtml(activeInst?.text ?? '')}</p>
            <div class="intercom-replies">
              <button type="button" class="btn-reply" data-reply="obey" data-inst="${
                activeInst?.id ?? ''
              }">1. 従う</button>
              <button type="button" class="btn-reply" data-reply="delay" data-inst="${
                activeInst?.id ?? ''
              }">2. 遅らせる</button>
              <button type="button" class="btn-reply" data-reply="refuse" data-inst="${
                activeInst?.id ?? ''
              }">3. 逆らう</button>
              <button type="button" class="btn-reply" data-reply="question" data-inst="${
                activeInst?.id ?? ''
              }" ${activeInst?.questionAsked ? 'disabled' : ''}>4. 質問する(1回)</button>
            </div>
          </div>

          <div class="interactables-box">
            <div class="intercom-header">室内オブジェクト・調査アクション [F]</div>
            <div class="obj-list">
              ${trial.interactables
                .filter(
                  (o) =>
                    trial.roomCode !== 'T-309' ||
                    !o.roomId ||
                    o.roomId === trial.whiteDoor.currentRoom
                )
                .map(
                  (obj) => `
                <button type="button" class="btn-obj ${
                  obj.restricted ? 'btn-obj-restricted' : ''
                }" data-obj="${obj.id}">
                  <span class="obj-name">${iconSvg(OBJECT_ICONS[obj.id] ?? 'document', 22)}${this.escapeHtml(
                    obj.label
                  )}</span>
                  <span class="obj-tag">${obj.inspected ? '調査済' : '調べる'}</span>
                </button>
              `
                )
                .join('')}
              ${
                trial.roomCode === 'T-204' && trial.badge.rationTerminalChecked
                  ? `
                <button type="button" class="btn-obj" id="btn-t204-reverify-now">
                  <span class="obj-name">${iconSvg('terminal', 22)}処遇票の不一致に異議を出し、機械再照合を受ける</span>
                  <span class="obj-tag">${trial.badge.reverified ? '訂正済' : '再照合'}</span>
                </button>
              `
                  : ''
              }
              ${
                trial.roomCode === 'T-204' &&
                trial.badge.interviewCompleted &&
                trial.badge.badgeReturned
                  ? `
                <button type="button" class="btn-primary" id="btn-t204-exit" style="width:100%;margin-top:6px;">
                  面接と名札返却を終えて出入口から退室する
                </button>
              `
                  : ''
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderNotebookModal(): string {
    const { portableNote } = this.state.subject;
    const currentHyp =
      portableNote.hypotheses.find((h) => h.roomCode === this.activeHypothesisRoom) ||
      portableNote.hypotheses[0];

    return `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="携帯推理ノート">
        <div class="modal-window">
          <div class="modal-header">
            <h3 class="heading-with-icon">${iconSvg('notebook', 22)}携帯推理ノート（開いている間は実験時計・危険進行を停止）</h3>
            <button type="button" class="btn-terminal" id="btn-close-notebook">閉じる [N]</button>
          </div>
          <div class="notebook-tabs">
            <button type="button" class="tab-btn ${
              this.activeNotebookTab === 'observations' ? 'active' : ''
            }" data-ntab="observations">
              1. 観測カード（事実・原文不変）
            </button>
            <button type="button" class="tab-btn ${
              this.activeNotebookTab === 'rumors' ? 'active' : ''
            }" data-ntab="rumors">
              2. 伝聞カード（話者・観察日比較）
            </button>
            <button type="button" class="tab-btn ${
              this.activeNotebookTab === 'hypotheses' ? 'active' : ''
            }" data-ntab="hypotheses">
              3. 仮説（呼び名・トリガー・自由記述）
            </button>
          </div>

          <div class="notebook-body">
            ${
              this.activeNotebookTab === 'observations'
                ? `
              <div class="card-grid">
                ${
                  portableNote.observations.length === 0
                    ? '<p class="empty-note">まだ観測カードはありません。試験室で前兆や痕跡を観察すると自動記録されます。</p>'
                    : portableNote.observations
                        .map((o) =>
                          o.erased
                            ? `<div class="note-card erased-card"><strong>［未記入］</strong><p>（記憶処理によりこの欄の写しは消去されています）</p></div>`
                            : `<div class="note-card">
                                <div class="card-meta">区画: ${o.roomCode} | 施設日: 第${
                                o.facilityDay
                              }日 | 観測者: ${this.escapeHtml(o.observerSubjectId)}</div>
                                <div class="card-fact">${this.escapeHtml(o.eventFact)}</div>
                              </div>`
                        )
                        .join('')
                }
              </div>
            `
                : this.activeNotebookTab === 'rumors'
                ? `
              <div class="card-grid">
                ${
                  portableNote.rumors.length === 0
                    ? '<p class="empty-note">まだ伝聞カードはありません。朝や夜に同房者と話すと記録されます。</p>'
                    : portableNote.rumors
                        .map((r) =>
                          r.erased
                            ? `<div class="note-card erased-card"><strong>［未記入］</strong></div>`
                            : `<div class="note-card">
                                <div class="card-meta">話者: ${this.escapeHtml(
                                  r.speaker
                                )} | 入手: 第${r.acquiredDay}日 | 観察時期: ${this.escapeHtml(
                                r.observedDayNote
                              )}</div>
                                <div class="card-fact">${this.escapeHtml(r.statement)}</div>
                              </div>`
                        )
                        .join('')
                }
              </div>
            `
                : `
              <div class="hyp-room-selector">
                ${(['T-101', 'T-204', 'W-00', 'T-309'] as RoomCode[])
                  .map(
                    (rc) => `
                  <button type="button" class="btn-terminal btn-hyp-room ${
                    this.activeHypothesisRoom === rc ? 'active' : ''
                  }" data-hroom="${rc}">
                    区画 ${rc}
                  </button>
                `
                  )
                  .join('')}
              </div>
              ${
                currentHyp.erased
                  ? `<div class="empty-note">［未記入（記憶処理により消去済み。新しく記入すると上書きできます）］</div>`
                  : ''
              }
              <div class="hyp-form">
                <label>
                  <span>任意の呼び名（異常の通称を自分で付ける）:</span>
                  <input type="text" id="hyp-custom-name" value="${this.escapeHtml(
                    currentHyp.customName
                  )}" placeholder="例：背後の足音、名札置換、遅効給水、位相扉 など" />
                </label>
                <label>
                  <span>トリガー（何が引き金か）:</span>
                  <input type="text" id="hyp-trigger" value="${this.escapeHtml(
                    currentHyp.triggerText
                  )}" placeholder="例：許容速度を超えて移動したとき" />
                </label>
                <label>
                  <span>効果（何が起きるか）:</span>
                  <input type="text" id="hyp-effect" value="${this.escapeHtml(
                    currentHyp.effectText
                  )}" placeholder="例：3秒後に接触して反応消失" />
                </label>
                <label>
                  <span>解除・生存条件:</span>
                  <input type="text" id="hyp-condition" value="${this.escapeHtml(
                    currentHyp.conditionText
                  )}" placeholder="例：0.5秒停止または1秒低速歩行で遠のく" />
                </label>
                <label>
                  <span>自由メモ:</span>
                  <textarea id="hyp-freenote" rows="3" placeholder="研究員の指示との矛盾や次の検証手順を自由に記入（何書いても疑念Sは上がりません）">${this.escapeHtml(
                    currentHyp.freeNote
                  )}</textarea>
                </label>
                <button type="button" class="btn-primary" id="btn-save-hypothesis">
                  区画 ${this.activeHypothesisRoom} の仮説をノートに保存
                </button>
              </div>
            `
            }
          </div>
        </div>
      </div>
    `;
  }

  private renderArchiveModal(): string {
    return `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="事後報告履歴">
        <div class="modal-window">
          <div class="modal-header">
            <h3 class="heading-with-icon">${iconSvg('report', 22)}事後報告履歴 ［プレイヤー向け閲覧画面・被験者の所持文書ではありません］</h3>
            <button type="button" class="btn-terminal" id="btn-close-archive">閉じる</button>
          </div>
          <p class="clinical-note">
            ※この画面はプレイヤー自身の記憶・履歴確認用です。新被験者がこれらの報告書を物理的に所持している扱いにはなりません。旧サイクルの報告には旧施設コードを表示し、現在の変動パラメータの証明とは区別します。
          </p>
          <div class="card-grid">
            ${
              this.state.reportArchive.length === 0
                ? '<p class="empty-note">まだ事後報告の記録はありません。</p>'
                : this.state.reportArchive
                    .slice()
                    .reverse()
                    .map(
                      (rep) => `
                  <div class="note-card ${!rep.isCurrentCycle ? 'old-cycle-card' : ''}">
                    <div class="card-meta">
                      ${
                        rep.isCurrentCycle
                          ? '【現サイクル】'
                          : '【旧サイクル記録（現ルールの保証なし）】'
                      }
                      施設コード: ${this.escapeHtml(rep.facilityCode)} | 第${rep.day}日 | 区画: ${
                        rep.roomCode
                      } | 当事者: ${this.escapeHtml(rep.observerSubjectId)}
                    </div>
                    <div class="card-fact">${this.escapeHtml(rep.fragmentText)}</div>
                  </div>
                `
                    )
                    .join('')
            }
          </div>
        </div>
      </div>
    `;
  }

  private renderOrientationModal(): string {
    return `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="配属時交付文書">
        <div class="modal-window">
          <div class="modal-header">
            <h3 class="heading-with-icon">${iconSvg('document', 22)}${this.escapeHtml(ORIENTATION_DOCUMENT.title)}</h3>
            <button type="button" class="btn-terminal" id="btn-close-orientation">閉じる</button>
          </div>
          <div class="clinical-report-box">
            ${ORIENTATION_DOCUMENT.body
              .map((line) => `<p>${this.escapeHtml(line)}</p>`)
              .join('')}
          </div>
        </div>
      </div>
    `;
  }

  private renderSettingsModal(): string {
    const { settings } = this.state;
    return `
      <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="設定とポーズ">
        <div class="modal-window">
          <div class="modal-header">
            <h3>ポーズ・環境設定（開いている間は実験時計・危険進行を停止）</h3>
            <button type="button" class="btn-terminal" id="btn-close-settings">再開して閉じる [P]</button>
          </div>
          <div class="settings-form">
            <label class="setting-row">
              <span>知覚同期字幕の表示 (ON/OFFで猶予時間は変わりません):</span>
              <input type="checkbox" id="chk-subtitles" ${
                settings.subtitlesOn ? 'checked' : ''
              } />
            </label>
            <label class="setting-row">
              <span>マスター音量 (0.0 = ミュート):</span>
              <input type="range" id="rng-volume" min="0" max="1" step="0.1" value="${
                settings.volume
              }" />
              <span>${Math.round(settings.volume * 100)}%</span>
            </label>
            <label class="setting-row">
              <span>開発検証用ログ表示（内部数値 C/S/E・Seed・変動パラメータを表示）:</span>
              <input type="checkbox" id="chk-devlog" ${
                settings.devLogVisible ? 'checked' : ''
              } />
            </label>
          </div>
          <div class="proceed-bar" style="margin-top:16px;">
            <button type="button" class="btn-secondary" id="btn-return-title">
              タイトル画面へ戻る
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    const canvas = document.getElementById('ntk-trial-canvas') as HTMLCanvasElement | null;
    if (canvas) {
      this.renderer = new TrialCanvasRenderer(canvas);
      this.renderer.render(this.state);
      this.updateLiveTrialStatusDOM();
      this.updateSubtitlesDOM();

      canvas.addEventListener('mousemove', (e) => {
        if (!this.state.trial || this.state.trial.status !== 'active') return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        // Compute angle from canvas center/player
        const angle = Math.atan2(my - rect.height * 0.5, mx - rect.width * 0.5);
        this.state.trial.player.facingAngle = angle;
      });
    } else {
      this.renderer = null;
    }

    // Header buttons
    document.getElementById('btn-open-notebook')?.addEventListener('click', () => {
      this.toggleNotebook();
    });
    document.getElementById('btn-close-notebook')?.addEventListener('click', () => {
      this.toggleNotebook();
    });
    document.getElementById('btn-open-archive')?.addEventListener('click', () => {
      this.archiveModalOpen = true;
      if (this.state.trial) setTrialPause(this.state.trial, 'pause_menu');
      this.renderUI();
    });
    document.getElementById('btn-close-archive')?.addEventListener('click', () => {
      this.archiveModalOpen = false;
      if (this.state.trial && !this.notebookOpen && !this.settingsModalOpen) {
        setTrialPause(this.state.trial, 'none');
      }
      this.renderUI();
    });
    document.getElementById('btn-open-orientation')?.addEventListener('click', () => {
      this.orientationModalOpen = true;
      if (this.state.trial) setTrialPause(this.state.trial, 'pause_menu');
      this.renderUI();
    });
    document.getElementById('btn-close-orientation')?.addEventListener('click', () => {
      this.orientationModalOpen = false;
      if (this.state.trial && !this.notebookOpen && !this.settingsModalOpen) {
        setTrialPause(this.state.trial, 'none');
      }
      this.renderUI();
    });
    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      this.togglePauseOrSettings();
    });
    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      this.togglePauseOrSettings();
    });

    // Corrupted save resolution button
    document.getElementById('btn-resolve-corrupted')?.addEventListener('click', () => {
      const archived = archiveCorruptedAndClearSave();
      if (!archived) {
        this.state.lastActionLog.push(
          '[保存] 破損データの退避に失敗したため、元データを削除せず保持しました。空き容量を確認してください。'
        );
        this.renderUI();
        return;
      }
      this.state.corruptedSaveNotice = null;
      this.autoSave();
      this.renderUI();
    });

    // Title buttons
    document.getElementById('btn-start-standard')?.addEventListener('click', () => {
      this.state = createInitialGameState(
        INITIAL_FIXED_SEED,
        this.state.reportArchive,
        1,
        false
      );
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-start-random')?.addEventListener('click', () => {
      this.state = startNewCycle(this.state, `SEED-${Date.now()}`, false);
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-start-practice')?.addEventListener('click', () => {
      this.state = startNewCycle(this.state, INITIAL_FIXED_SEED, true);
      this.autoSave();
      this.renderUI();
    });

    // Comparison Interview buttons
    document.getElementById('btn-comp-cooperate')?.addEventListener('click', () => {
      handleComparisonInterviewAction(this.state, 'cooperate_answer');
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-comp-silent-first')?.addEventListener('click', () => {
      handleComparisonInterviewAction(this.state, 'silent_first');
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-comp-silent-confirm')?.addEventListener('click', () => {
      handleComparisonInterviewAction(this.state, 'silent_confirm');
      this.autoSave();
      this.renderUI();
    });

    // Morning buttons
    document.getElementById('btn-morning-reverify-badge')?.addEventListener('click', () => {
      const msg = performBadgeReverification(this.state.subject, this.state.trial);
      this.state.lastActionLog.push(msg);
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-water-clues')?.addEventListener('click', () => {
      interactWaterCoolerInMorning(this.state, 'inspect_clues');
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-water-drink')?.addEventListener('click', () => {
      interactWaterCoolerInMorning(this.state, 'drink');
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-water-skip')?.addEventListener('click', () => {
      interactWaterCoolerInMorning(this.state, 'skip');
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-morning-envelope')?.addEventListener('click', () => {
      inspectEnvelopeInMorning(this.state);
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-morning-doc')?.addEventListener('click', () => {
      this.orientationModalOpen = true;
      this.renderUI();
    });
    document.querySelectorAll('.btn-talk-cm').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmId = (btn as HTMLElement).dataset.cm!;
        talkToCellmate(this.state, cmId, 'morning');
        this.autoSave();
        this.renderUI();
      });
    });
    document.querySelectorAll('.btn-trade-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = (btn as HTMLElement).dataset.item as OptionalItemId;
        acquireOptionalItem(this.state, item);
        this.autoSave();
        this.renderUI();
      });
    });
    document.getElementById('btn-final-day-escape')?.addEventListener('click', () => {
      proceedFromMorning(this.state, 'attempt_escape_with_supervisor_badge');
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-proceed-briefing')?.addEventListener('click', () => {
      proceedFromMorning(this.state, 'normal_duty');
      this.autoSave();
      this.renderUI();
    });

    // Briefing button
    document.getElementById('btn-enter-trial')?.addEventListener('click', () => {
      this.lastCueCount = 0;
      startCurrentDayTrial(this.state);
      if (this.state.trial) {
        this.flushNewAudioCues(this.state.trial);
      }
      this.autoSave();
      this.renderUI();
    });

    // Resume a trial restored from a save (AC03)
    document.getElementById('btn-resume-trial')?.addEventListener('click', () => {
      if (!this.state.trial) return;
      this.notebookOpen = false;
      this.settingsModalOpen = false;
      setTrialPause(this.state.trial, 'none');
      this.autoSave();
      this.renderUI();
    });

    // Trial tactical buttons
    document.querySelectorAll('[data-step-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const trial = this.state.trial;
        if (!trial || trial.status !== 'active') return;
        const mode = (btn as HTMLElement).dataset.stepMode as MoveMode;
        const dir = Number((btn as HTMLElement).dataset.stepDir || '1');
        const sec = Number((btn as HTMLElement).dataset.stepSec || '1.0');
        // Execute in 0.1s slices for crisp state transitions
        const steps = Math.max(1, Math.round(sec / 0.1));
        const sliceDt = sec / steps;
        for (let i = 0; i < steps; i++) {
          if (trial.status !== 'active') break;
          stepTrial(
            trial,
            this.state.subject,
            this.state.cycle.fixedParams,
            { moveX: mode === 'stop' ? 0 : dir, moveY: 0, moveMode: mode },
            sliceDt
          );
        }
        this.sound.setOmenActive(trial.omen.active);
        this.flushNewAudioCues(trial);
        if (trial.status !== 'active') {
          concludeTrialPhase(this.state);
        }
        this.autoSave();
        this.renderUI();
      });
    });

    document.getElementById('btn-rotate-view')?.addEventListener('click', () => {
      if (!this.state.trial) return;
      this.state.trial.player.facingAngle =
        (this.state.trial.player.facingAngle + Math.PI) % (Math.PI * 2);
      this.state.lastActionLog.push('視線の向きを180度変更した（移動速度は変化しない）。');
      this.renderUI();
    });

    // White Door (T-309) tactical buttons
    document.getElementById('btn-wd-forward')?.addEventListener('click', () => {
      if (!this.state.trial) return;
      const msg = traverseWhiteDoor(
        this.state.trial,
        this.state.subject,
        this.state.cycle.fixedParams,
        'forward'
      );
      if (msg) this.state.lastActionLog.push(msg);
      this.flushNewAudioCues(this.state.trial);
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-wd-backward')?.addEventListener('click', () => {
      if (!this.state.trial) return;
      const msg = traverseWhiteDoor(
        this.state.trial,
        this.state.subject,
        this.state.cycle.fixedParams,
        'backward'
      );
      if (msg) this.state.lastActionLog.push(msg);
      this.flushNewAudioCues(this.state.trial);
      if (this.state.trial.status !== 'active') {
        concludeTrialPhase(this.state);
      }
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-wd-rope')?.addEventListener('click', () => {
      if (!this.state.trial) return;
      const msg = traverseWhiteDoor(
        this.state.trial,
        this.state.subject,
        this.state.cycle.fixedParams,
        'follow_rope'
      );
      if (msg) this.state.lastActionLog.push(msg);
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-wd-anchor')?.addEventListener('click', () => {
      if (!this.state.trial) return;
      this.state.trial.player.x = 0;
      this.state.trial.player.y = 0;
      this.state.trial.whiteDoor.onAnchorPoint = true;
      this.state.lastActionLog.push('青い非常灯の固定点 (0,0) に退避した。');
      this.renderUI();
    });
    document.getElementById('btn-wd-wait-shift')?.addEventListener('click', () => {
      const trial = this.state.trial;
      if (!trial || trial.status !== 'active') return;
      for (let i = 0; i < 30; i++) {
        if (trial.status !== 'active') break;
        stepTrial(
          trial,
          this.state.subject,
          this.state.cycle.fixedParams,
          { moveX: 0, moveY: 0, moveMode: 'stop' },
          0.1
        );
      }
      this.flushNewAudioCues(trial);
      if (trial.status !== 'active') {
        concludeTrialPhase(this.state);
      }
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-wd-step-off')?.addEventListener('click', () => {
      if (!this.state.trial) return;
      this.state.trial.player.x = 1.3;
      this.state.trial.player.y = 0.8;
      this.state.trial.whiteDoor.onAnchorPoint = false;
      this.state.lastActionLog.push('青い非常灯の固定点から離れた（端へ移動）。');
      this.renderUI();
    });

    // Intercom replies
    document.querySelectorAll('.btn-reply').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.state.trial) return;
        const reply = (btn as HTMLElement).dataset.reply as
          | 'obey'
          | 'delay'
          | 'refuse'
          | 'question';
        const instId = (btn as HTMLElement).dataset.inst!;
        const msg = replyToInstruction(this.state.trial, instId, reply);
        if (msg) this.state.lastActionLog.push(`インターホン応答：${msg}`);
        this.flushNewAudioCues(this.state.trial);
        this.autoSave();
        this.renderUI();
      });
    });

    // Interactable object buttons
    document.querySelectorAll('.btn-obj[data-obj]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const trial = this.state.trial;
        if (!trial) return;
        if (trial.status === 'paused') {
          setTrialPause(trial, 'none');
        }
        const objId = (btn as HTMLElement).dataset.obj!;
        const msg = interactWithTrialObject(
          trial,
          this.state.subject,
          this.state.cycle.fixedParams,
          objId
        );
        if (msg) this.state.lastActionLog.push(msg);
        this.flushNewAudioCues(trial);
        if (trial.status !== 'active') {
          concludeTrialPhase(this.state);
        }
        this.autoSave();
        this.renderUI();
      });
    });

    document.getElementById('btn-t204-reverify-now')?.addEventListener('click', () => {
      const msg = performBadgeReverification(this.state.subject, this.state.trial);
      this.state.lastActionLog.push(msg);
      this.autoSave();
      this.renderUI();
    });

    document.getElementById('btn-t204-exit')?.addEventListener('click', () => {
      const trial = this.state.trial;
      if (!trial) return;
      trial.player.x = 0.5;
      stepTrial(
        trial,
        this.state.subject,
        this.state.cycle.fixedParams,
        { moveX: -1, moveY: 0, moveMode: 'normal' },
        0.2
      );
      if (trial.status !== 'active') {
        concludeTrialPhase(this.state);
      }
      this.autoSave();
      this.renderUI();
    });

    // Debrief buttons
    document.getElementById('btn-debrief-reverify')?.addEventListener('click', () => {
      const msg = performBadgeReverification(this.state.subject, this.state.trial);
      this.state.lastActionLog.push(msg);
      this.autoSave();
      this.renderUI();
    });
    document.querySelectorAll('.debrief-choice-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choiceId = (btn as HTMLElement).dataset.choice!;
        submitDebriefResponse(this.state, choiceId);
        this.autoSave();
        this.renderUI();
      });
    });

    // Death report button
    document.getElementById('btn-proceed-death')?.addEventListener('click', () => {
      proceedFromDeathReport(this.state);
      this.autoSave();
      this.renderUI();
    });

    // Night buttons
    document.getElementById('btn-night-copy-envelope')?.addEventListener('click', () => {
      const { portableNote } = this.state.subject;
      const items: Parameters<typeof copyItemsToEnvelopeAtNight>[1] = [];
      for (const o of portableNote.observations.filter((x) => !x.erased).slice(-2)) {
        const canonicalId = o.id.replace(/-d\d+$/, '');
        items.push({
          sourceType: 'observation',
          title: `${o.roomCode} 観測記録`,
          content: o.eventFact,
          roomCode: o.roomCode,
          canonicalEvidenceId: canonicalId,
        });
      }
      for (const r of portableNote.rumors.filter((x) => !x.erased).slice(-1)) {
        items.push({
          sourceType: 'rumor',
          title: `${r.speaker} 伝聞`,
          content: r.statement,
        });
      }
      if (items.length < 3) {
        for (const h of portableNote.hypotheses.filter(
          (x) => !x.erased && (x.customName || x.freeNote || x.triggerText)
        )) {
          if (items.length >= 3) break;
          items.push({
            sourceType: 'hypothesis',
            title: `${h.roomCode} 仮説「${h.customName || '無題'}」`,
            content: `${h.triggerText} / ${h.conditionText} / ${h.freeNote}`,
            roomCode: h.roomCode,
          });
        }
      }
      copyItemsToEnvelopeAtNight(this.state, items);
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-night-open-note')?.addEventListener('click', () => {
      this.notebookOpen = true;
      this.activeNotebookTab = 'hypotheses';
      this.renderUI();
    });
    document.getElementById('btn-night-safe-task')?.addEventListener('click', () => {
      performSafeReevaluationTaskAtNight(this.state);
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-night-talk-cm')?.addEventListener('click', () => {
      talkToCellmate(this.state, 'cm-observer', 'night');
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-proceed-next-day')?.addEventListener('click', () => {
      proceedFromNightToNextDay(this.state);
      this.autoSave();
      this.renderUI();
    });

    // Ending buttons
    document.getElementById('btn-ending-new-cycle')?.addEventListener('click', () => {
      this.state = startNewCycle(this.state, undefined, false);
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-ending-practice')?.addEventListener('click', () => {
      this.state = startNewCycle(this.state, INITIAL_FIXED_SEED, true);
      this.autoSave();
      this.renderUI();
    });

    // Notebook modal tabs & form
    document.querySelectorAll('[data-ntab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeNotebookTab = (btn as HTMLElement).dataset.ntab as
          | 'observations'
          | 'rumors'
          | 'hypotheses';
        this.renderUI();
      });
    });
    document.querySelectorAll('.btn-hyp-room').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeHypothesisRoom = (btn as HTMLElement).dataset.hroom as RoomCode;
        this.renderUI();
      });
    });
    document.getElementById('btn-save-hypothesis')?.addEventListener('click', () => {
      const customName =
        (document.getElementById('hyp-custom-name') as HTMLInputElement | null)?.value ?? '';
      const triggerText =
        (document.getElementById('hyp-trigger') as HTMLInputElement | null)?.value ?? '';
      const effectText =
        (document.getElementById('hyp-effect') as HTMLInputElement | null)?.value ?? '';
      const conditionText =
        (document.getElementById('hyp-condition') as HTMLInputElement | null)?.value ?? '';
      const freeNote =
        (document.getElementById('hyp-freenote') as HTMLTextAreaElement | null)?.value ?? '';

      updateHypothesis(this.state, this.activeHypothesisRoom, {
        customName,
        triggerText,
        effectText,
        conditionText,
        freeNote,
      });
      this.state.lastActionLog.push(
        `携帯ノートに区画 ${this.activeHypothesisRoom} の仮説（呼び名：「${
          customName || '未設定'
        }」）を記入した。`
      );
      this.autoSave();
      this.renderUI();
    });

    // Settings modal controls
    document.getElementById('chk-subtitles')?.addEventListener('change', (e) => {
      this.state.settings.subtitlesOn = (e.target as HTMLInputElement).checked;
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('rng-volume')?.addEventListener('input', (e) => {
      this.state.settings.volume = Number((e.target as HTMLInputElement).value);
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('chk-devlog')?.addEventListener('change', (e) => {
      this.state.settings.devLogVisible = (e.target as HTMLInputElement).checked;
      this.autoSave();
      this.renderUI();
    });
    document.getElementById('btn-return-title')?.addEventListener('click', () => {
      this.settingsModalOpen = false;
      this.state.cycle.phase = 'title';
      this.renderUI();
    });
  }
}
