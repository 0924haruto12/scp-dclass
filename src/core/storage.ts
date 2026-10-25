import {
  ComparisonInterviewState,
  DeferredEvent,
  FacilityCycle,
  GameState,
  ReportArchive,
  Subject,
  Trial,
} from './types';
import { RUN_LENGTH_DAYS } from './content';
import { ensureThirtyDaySchedule } from './engine';

export const SAVE_STORAGE_KEY = 'need_to_know_mvp_save_v1';
export const CORRUPTED_BACKUP_KEY = 'need_to_know_mvp_corrupted_backup_v1';

/**
 * Separated record structure matching Section 9:
 * FacilityCycle, Subject, Trial, DeferredEvent, ReportArchive
 */
export interface SerializedSaveRecords {
  schemaVersion: '1.0';
  savedAt: string;
  FacilityCycle: FacilityCycle;
  Subject: Subject;
  Trial: Trial | null;
  DeferredEvent: DeferredEvent[];
  ReportArchive: ReportArchive[];
  ComparisonInterview: ComparisonInterviewState | null;
  Settings: GameState['settings'];
}

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorageBackend implements StorageBackend {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export function getDefaultStorageBackend(): StorageBackend {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return new MemoryStorageBackend();
}

function tryGetItem(backend: StorageBackend, key: string): { ok: boolean; value: string | null } {
  try {
    return { ok: true, value: backend.getItem(key) };
  } catch {
    return { ok: false, value: null };
  }
}

function trySetItem(backend: StorageBackend, key: string, value: string): boolean {
  try {
    backend.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function serializeGameState(state: GameState): string {
  const payload: SerializedSaveRecords = {
    schemaVersion: '1.0',
    savedAt: new Date().toISOString(),
    FacilityCycle: structuredClone(state.cycle),
    Subject: structuredClone(state.subject),
    Trial: state.trial ? structuredClone(state.trial) : null,
    DeferredEvent: structuredClone(state.deferredEvents),
    ReportArchive: structuredClone(state.reportArchive),
    ComparisonInterview: state.comparisonInterview
      ? structuredClone(state.comparisonInterview)
      : null,
    Settings: structuredClone(state.settings),
  };
  return JSON.stringify(payload);
}

function isValidSerializedSave(obj: unknown): obj is SerializedSaveRecords {
  if (!obj || typeof obj !== 'object') return false;
  const r = obj as Record<string, unknown>;
  if (r.schemaVersion !== '1.0') return false;
  const cycle = r.FacilityCycle as FacilityCycle | undefined;
  const subject = r.Subject as Subject | undefined;
  if (
    !cycle ||
    typeof cycle.cycleId !== 'string' ||
    typeof cycle.seed !== 'string' ||
    typeof cycle.day !== 'number' ||
    cycle.day < 1 ||
    cycle.day > RUN_LENGTH_DAYS ||
    !cycle.fixedParams ||
    !Array.isArray(cycle.processedEventIds)
  ) {
    return false;
  }
  if (
    !subject ||
    typeof subject.subjectId !== 'string' ||
    typeof subject.C !== 'number' ||
    typeof subject.S !== 'number' ||
    typeof subject.E !== 'number'
  ) {
    return false;
  }
  if (!Array.isArray(r.DeferredEvent) || !Array.isArray(r.ReportArchive)) {
    return false;
  }
  return true;
}

export type LoadSaveResult =
  | { status: 'empty' }
  | { status: 'ok'; state: GameState }
  | {
      status: 'corrupted';
      error: string;
      rawOriginal: string;
      originalPreserved: boolean;
    };

/**
 * Saves current GameState into storage ONLY if existing save is not in an unacknowledged corrupted state.
 */
export function saveGameState(
  state: GameState,
  backend: StorageBackend = getDefaultStorageBackend()
): boolean {
  // Per Section 9 & AC15: Never overwrite unreadable/corrupted save automatically
  const existing = tryGetItem(backend, SAVE_STORAGE_KEY);
  if (!existing.ok) {
    return false;
  }
  const existingRaw = existing.value;
  if (existingRaw !== null) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (!isValidSerializedSave(parsed)) {
        trySetItem(backend, CORRUPTED_BACKUP_KEY, existingRaw);
        return false;
      }
    } catch {
      trySetItem(backend, CORRUPTED_BACKUP_KEY, existingRaw);
      return false;
    }
  }

  const serialized = serializeGameState(state);
  return trySetItem(backend, SAVE_STORAGE_KEY, serialized);
}

/**
 * Loads GameState from storage.
 * - Restores active trials in paused state ('pause_menu') while preserving hazardTimer and clocks (AC03).
 * - If save data is corrupted/unreadable, preserves the original data without overwriting it or silently
 *   replacing it with a fresh game (AC15).
 */
export function loadGameState(
  backend: StorageBackend = getDefaultStorageBackend()
): LoadSaveResult {
  const stored = tryGetItem(backend, SAVE_STORAGE_KEY);
  if (!stored.ok) {
    return {
      status: 'corrupted',
      error: '保存領域を読み取れませんでした。ブラウザのストレージ設定を確認してください。',
      rawOriginal: '',
      originalPreserved: false,
    };
  }
  const raw = stored.value;
  if (raw === null) {
    return { status: 'empty' };
  }

  const preserveOriginal = (): boolean => {
    const current = tryGetItem(backend, SAVE_STORAGE_KEY);
    return current.ok && current.value === raw;
  };

  try {
    const parsed = JSON.parse(raw);
    if (!isValidSerializedSave(parsed)) {
      trySetItem(backend, CORRUPTED_BACKUP_KEY, raw);
      return {
        status: 'corrupted',
        error: '保存データのスキーマ検証に失敗しました。元データは上書きせず保持されています。',
        rawOriginal: raw,
        originalPreserved: preserveOriginal(),
      };
    }

    const restoredTrial = parsed.Trial ? structuredClone(parsed.Trial) : null;
    if (restoredTrial && restoredTrial.status === 'active') {
      // Section 9: 中断時は実験内の状態・警告経過も復元し、フォーカス復帰時はポーズで再開する
      restoredTrial.status = 'paused';
      restoredTrial.pauseReason = 'pause_menu';
      restoredTrial.player.moveMode = 'stop';
    }

    const restoredCycle = structuredClone(parsed.FacilityCycle);
    const scheduleMigrated = ensureThirtyDaySchedule(restoredCycle);
    restoredCycle.version = '0.2.0-30d';

    // Legacy 7-day event keys must not allow the same action twice under the
    // 30-day keys (e.g. drinking from the day-2 water cooler).
    let legacyWaterKeyMigrated = false;
    restoredCycle.processedEventIds = restoredCycle.processedEventIds.map((eventId) => {
      if (eventId.startsWith('day2-water-drink-')) {
        legacyWaterKeyMigrated = true;
        return eventId.replace('day2-water-drink-', 'water-drink-d2-');
      }
      return eventId;
    });

    const restoredSubject = structuredClone(parsed.Subject);
    if (restoredSubject.supervisorBadgeEarnedDay === undefined) {
      restoredSubject.supervisorBadgeEarnedDay = null;
    }

    // Evaluation credits and the supervisor badge earned in the former 7-day
    // cycle are not valid for the 30-day certification / escape milestones.
    let legacyProgressReset = false;
    if (scheduleMigrated) {
      const hadLegacyEvaluation =
        restoredSubject.E > 0 ||
        restoredSubject.rewardedEventKeys.some((key) => key.startsWith('role-eval-d'));
      if (hadLegacyEvaluation) {
        restoredSubject.E = 0;
        restoredSubject.rewardedEventKeys = restoredSubject.rewardedEventKeys.filter(
          (key) => !key.startsWith('role-eval-d')
        );
        legacyProgressReset = true;
      }
    }
    if (
      restoredSubject.hasSupervisorBadge &&
      restoredSubject.supervisorBadgeEarnedDay === null
    ) {
      restoredSubject.hasSupervisorBadge = false;
      restoredSubject.mandatoryEquipment = restoredSubject.mandatoryEquipment.filter(
        (item) => item !== 'supervisor_badge'
      );
      legacyProgressReset = true;
    }

    const migrationNotes: string[] = [];
    if (scheduleMigrated) {
      migrationNotes.push(
        '[保存] 旧7日間サイクルの保存データを30日間スケジュールへ移行しました。現在の日付・被験者・封筒・事後報告履歴は保持されています。'
      );
    }
    if (legacyProgressReset) {
      migrationNotes.push(
        '[保存] 旧7日間サイクルの役割評価Eおよび監督用名札は、30日ランの16日目・29日目の条件へ引き継がないため初期化しました。'
      );
    }
    if (legacyWaterKeyMigrated) {
      migrationNotes.push(
        '[保存] 旧給水器イベントの処理済み記録を30日ラン形式へ移行しました（同じ設置回の再飲用を防止）。'
      );
    }

    const restoredState: GameState = {
      cycle: restoredCycle,
      subject: restoredSubject,
      trial: restoredTrial,
      deferredEvents: structuredClone(parsed.DeferredEvent),
      reportArchive: structuredClone(parsed.ReportArchive),
      comparisonInterview: parsed.ComparisonInterview
        ? structuredClone(parsed.ComparisonInterview)
        : null,
      settings: parsed.Settings
        ? structuredClone(parsed.Settings)
        : { subtitlesOn: true, volume: 0.7, devLogVisible: false },
      corruptedSaveNotice: null,
      lastActionLog: [
        `[${parsed.FacilityCycle.cycleId} / 第${parsed.FacilityCycle.day}日] 保存データを復元しました（seed・異常パラメータ・警告時計を保持）。`,
        ...migrationNotes,
      ],
    };

    return { status: 'ok', state: restoredState };
  } catch (err) {
    trySetItem(backend, CORRUPTED_BACKUP_KEY, raw);
    return {
      status: 'corrupted',
      error: `保存データのJSON解析に失敗しました（${
        err instanceof Error ? err.message : 'parse error'
      }）。元データは上書きせず保持されています。`,
      rawOriginal: raw,
      originalPreserved: preserveOriginal(),
    };
  }
}

/**
 * Explicit user action to archive corrupted save and reset storage slot.
 * Returns false without deleting the slot if the backup cannot be written.
 */
export function archiveCorruptedAndClearSave(
  backend: StorageBackend = getDefaultStorageBackend()
): boolean {
  const stored = tryGetItem(backend, SAVE_STORAGE_KEY);
  if (!stored.ok) {
    return false;
  }
  const raw = stored.value;
  if (raw !== null) {
    if (!trySetItem(backend, CORRUPTED_BACKUP_KEY, raw)) {
      return false;
    }
  }
  try {
    backend.removeItem(SAVE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
