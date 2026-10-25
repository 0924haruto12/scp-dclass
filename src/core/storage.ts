import {
  ComparisonInterviewState,
  DeferredEvent,
  FacilityCycle,
  GameState,
  ReportArchive,
  Subject,
  Trial,
} from './types';

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
    cycle.day > 7 ||
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
  const existingRaw = backend.getItem(SAVE_STORAGE_KEY);
  if (existingRaw !== null) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (!isValidSerializedSave(parsed)) {
        backend.setItem(CORRUPTED_BACKUP_KEY, existingRaw);
        return false;
      }
    } catch {
      backend.setItem(CORRUPTED_BACKUP_KEY, existingRaw);
      return false;
    }
  }

  const serialized = serializeGameState(state);
  backend.setItem(SAVE_STORAGE_KEY, serialized);
  return true;
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
  const raw = backend.getItem(SAVE_STORAGE_KEY);
  if (raw === null) {
    return { status: 'empty' };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!isValidSerializedSave(parsed)) {
      backend.setItem(CORRUPTED_BACKUP_KEY, raw);
      return {
        status: 'corrupted',
        error: '保存データのスキーマ検証に失敗しました。元データは上書きせず保持されています。',
        rawOriginal: raw,
        originalPreserved: backend.getItem(SAVE_STORAGE_KEY) === raw,
      };
    }

    const restoredTrial = parsed.Trial ? structuredClone(parsed.Trial) : null;
    if (restoredTrial && restoredTrial.status === 'active') {
      // Section 9: 中断時は実験内の状態・警告経過も復元し、フォーカス復帰時はポーズで再開する
      restoredTrial.status = 'paused';
      restoredTrial.pauseReason = 'pause_menu';
      restoredTrial.player.moveMode = 'stop';
    }

    const restoredState: GameState = {
      cycle: structuredClone(parsed.FacilityCycle),
      subject: structuredClone(parsed.Subject),
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
      ],
    };

    return { status: 'ok', state: restoredState };
  } catch (err) {
    backend.setItem(CORRUPTED_BACKUP_KEY, raw);
    return {
      status: 'corrupted',
      error: `保存データのJSON解析に失敗しました（${
        err instanceof Error ? err.message : 'parse error'
      }）。元データは上書きせず保持されています。`,
      rawOriginal: raw,
      originalPreserved: backend.getItem(SAVE_STORAGE_KEY) === raw,
    };
  }
}

/**
 * Explicit user action to archive corrupted save and reset storage slot.
 */
export function archiveCorruptedAndClearSave(
  backend: StorageBackend = getDefaultStorageBackend()
): void {
  const raw = backend.getItem(SAVE_STORAGE_KEY);
  if (raw !== null) {
    backend.setItem(CORRUPTED_BACKUP_KEY, raw);
  }
  backend.removeItem(SAVE_STORAGE_KEY);
}
