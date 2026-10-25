// 出来事から音・字幕・画面表示を作る。仕様案3.2・AC06に対応する。
// 3つの経路は同じ出来事・同じ刻みから出す。設定で変わるのは音と字幕の有無だけで、
// 画面上の前兆表示と判定の猶予は設定に依存しない。
// 字幕は知覚情報に留め、「停止せよ」「危険」などの解釈は書かない。

import type { SimEvent } from './pacing';
import type { ResearcherId } from './instructions';
import { RESEARCHER_LABEL } from './instructions';

export interface PresentationSettings {
  captions: boolean;
  /** 0〜1 */
  volume: number;
}

export interface Listener {
  x: number;
  y: number;
  facing: number;
}

export type SoundId = 'step_self' | 'step_other' | 'approach' | 'intercom' | 'door' | 'pickup' | 'paper' | 'shutter';

export interface AudioCue {
  sound: SoundId;
  gain: number;
  /** -1（左）〜1（右） */
  pan: number;
  rate: number;
}

export interface CaptionCue {
  /** 同じ key の字幕は積み重ねず、表示時間だけ更新する */
  key: string;
  text: string;
}

export interface VisualCue {
  type: 'ring' | 'pulse' | 'dust';
  x: number;
  y: number;
  strength: number;
}

export interface DialogueCue {
  speaker: string;
  text: string;
}

export interface Presentation {
  tick: number;
  audio: AudioCue | null;
  caption: CaptionCue | null;
  visual: VisualCue | null;
  /** 研究員の発話。音声素材がないため、設定によらず台詞として表示する */
  dialogue: DialogueCue | null;
}

const DIRECTIONS = ['前方', '右前方', '右', '右後方', '後方', '左後方', '左', '左前方'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** 視線を基準にした8方向。画面座標（yは下向き）なので、正の角度が右回り */
export function relativeDirection(listener: Listener, x: number, y: number): Direction {
  const rel = normalizeAngle(Math.atan2(y - listener.y, x - listener.x) - listener.facing);
  const index = Math.round(rel / (Math.PI / 4));
  return DIRECTIONS[((index % 8) + 8) % 8] as Direction;
}

function relativePan(listener: Listener, x: number, y: number): number {
  const rel = normalizeAngle(Math.atan2(y - listener.y, x - listener.x) - listener.facing);
  return Math.max(-1, Math.min(1, Math.sin(rel)));
}

function attenuation(listener: Listener, x: number, y: number): number {
  return 1 / (1 + Math.hypot(x - listener.x, y - listener.y) / 6);
}

function audio(settings: PresentationSettings, cue: AudioCue): AudioCue | null {
  if (settings.volume <= 0) return null;
  return { ...cue, gain: cue.gain * settings.volume };
}

function caption(settings: PresentationSettings, cue: CaptionCue): CaptionCue | null {
  return settings.captions ? cue : null;
}

export function present(event: SimEvent, listener: Listener, settings: PresentationSettings, speaker: ResearcherId = 'A'): Presentation {
  const base: Presentation = { tick: event.tick, audio: null, caption: null, visual: null, dialogue: null };
  switch (event.kind) {
    case 'step': {
      if (event.source === 'player') {
        return { ...base, audio: audio(settings, { sound: 'step_self', gain: event.loudness, pan: 0, rate: 1 }) };
      }
      const dir = relativeDirection(listener, event.x, event.y);
      const text =
        event.phase === 'follow'
          ? `${dir}で、足音が半拍遅れて重なる`
          : event.phase === 'approach'
            ? `${dir}から、足音が速く近づく`
            : `${dir}の足音が遠のいていく`;
      return {
        ...base,
        audio: audio(settings, {
          sound: 'step_other',
          gain: event.loudness * attenuation(listener, event.x, event.y) * 1.6,
          pan: relativePan(listener, event.x, event.y),
          rate: event.phase === 'approach' ? 1.12 : 0.92,
        }),
        caption: caption(settings, { key: 'other-steps', text }),
        visual: { type: 'ring', x: event.x, y: event.y, strength: event.loudness },
      };
    }
    case 'approach_start': {
      const dir = relativeDirection(listener, event.x, event.y);
      return {
        ...base,
        audio: audio(settings, { sound: 'approach', gain: 0.9, pan: relativePan(listener, event.x, event.y), rate: 1 }),
        caption: caption(settings, { key: 'other-steps', text: `${dir}の足音が急に速まり、迫ってくる` }),
        visual: { type: 'pulse', x: event.x, y: event.y, strength: 1 },
      };
    }
    case 'retreat_start': {
      const dir = relativeDirection(listener, event.x, event.y);
      return {
        ...base,
        caption: caption(settings, { key: 'other-steps', text: `${dir}の足音が離れていく` }),
        visual: { type: 'ring', x: event.x, y: event.y, strength: 0.3 },
      };
    }
    case 'intercom':
      return {
        ...base,
        audio: audio(settings, { sound: 'intercom', gain: 0.5, pan: 0, rate: 1 }),
        dialogue: { speaker: RESEARCHER_LABEL[speaker], text: event.text },
      };
    case 'door_locked':
      return {
        ...base,
        audio: audio(settings, { sound: 'door', gain: 0.7, pan: 0, rate: 1 }),
        caption: caption(settings, { key: 'door', text: '扉に手をかけた。開かない' }),
        visual: { type: 'pulse', x: listener.x, y: listener.y, strength: 0.4 },
      };
    case 'pickup':
      return { ...base, audio: audio(settings, { sound: 'pickup', gain: 0.6, pan: 0, rate: 1 }), caption: caption(settings, { key: 'self', text: '箱を抱えた' }) };
    case 'examine':
      return event.target === 'box' || event.target === 'door' ? base : { ...base, audio: audio(settings, { sound: 'paper', gain: 0.3, pan: 0, rate: 1 }) };
    case 'end':
      return event.outcome === 'timeout' ? { ...base, audio: audio(settings, { sound: 'shutter', gain: 0.9, pan: 0, rate: 1 }) } : base;
    case 'release_hold':
    case 'follow_resume':
    case 'observe':
      return base;
  }
}

function normalizeAngle(a: number): number {
  let d = a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
