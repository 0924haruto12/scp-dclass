// 表示設定。ゲーム進行の保存とは別のキーに置き、判定には一切渡さない。

export interface Settings {
  captions: boolean;
  volume: number;
}

const KEY = 'need-to-know.settings.v1';
const DEFAULTS: Settings = { captions: true, volume: 0.8 };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      captions: typeof parsed.captions === 'boolean' ? parsed.captions : DEFAULTS.captions,
      volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULTS.volume,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくてもプレイは続ける
  }
}
