// 推理ノート（携帯写し）と寝台下の封筒。仕様案4節に対応する。
// ゲームは仮説の文字列・正しさを読まない。判定に使うのは Subject.evidence（観測の原記録）だけ。

import { factCardText, type FactId } from './facts';

export interface ObservationCard {
  kind: 'observation';
  id: string;
  fact: FactId;
  text: string;
  day: number;
  roomCode: string;
  observer: string;
}

export interface HearsayCard {
  kind: 'hearsay';
  id: string;
  text: string;
  speaker: string;
  acquiredDay: number;
  /** 話者が観察した時期。分かる範囲で文字列のまま持つ */
  speakerObserved: string | null;
}

export interface Hypothesis {
  kind: 'hypothesis';
  id: string;
  name: string;
  trigger: string;
  effect: string;
  condition: string;
  evidence: string[];
  note: string;
  createdDay: number;
  updatedDay: number;
}

/** 記憶処理で消えた項目。内容は残さず「未記入」とだけ表示する */
export interface ErasedEntry {
  kind: 'erased';
  id: string;
}

export type NotebookEntry = ObservationCard | HearsayCard | Hypothesis | ErasedEntry;

export interface Notebook {
  observations: (ObservationCard | ErasedEntry)[];
  hearsay: (HearsayCard | ErasedEntry)[];
  hypotheses: (Hypothesis | ErasedEntry)[];
  nextId: number;
}

export interface EnvelopeItem {
  id: string;
  source: 'observation' | 'hearsay' | 'hypothesis' | 'free';
  text: string;
  writtenDay: number;
}

export function emptyNotebook(): Notebook {
  return { observations: [], hearsay: [], hypotheses: [], nextId: 1 };
}

function nextId(nb: Notebook, prefix: string): string {
  const id = `${prefix}${nb.nextId}`;
  nb.nextId += 1;
  return id;
}

export function addObservation(nb: Notebook, fact: FactId, day: number, roomCode: string, observer: string): ObservationCard | null {
  const exists = nb.observations.some((c) => c.kind === 'observation' && c.fact === fact && c.day === day && c.roomCode === roomCode);
  if (exists) return null;
  const card: ObservationCard = { kind: 'observation', id: nextId(nb, 'o'), fact, text: factCardText(fact), day, roomCode, observer };
  nb.observations.push(card);
  return card;
}

export function addHearsay(nb: Notebook, text: string, speaker: string, acquiredDay: number, speakerObserved: string | null): HearsayCard {
  const card: HearsayCard = { kind: 'hearsay', id: nextId(nb, 'h'), text, speaker, acquiredDay, speakerObserved };
  nb.hearsay.push(card);
  return card;
}

export interface HypothesisDraft {
  name: string;
  trigger: string;
  effect: string;
  condition: string;
  evidence: string[];
  note: string;
}

export function addHypothesis(nb: Notebook, draft: HypothesisDraft, day: number): Hypothesis {
  const h: Hypothesis = { kind: 'hypothesis', id: nextId(nb, 'p'), ...sanitizeDraft(draft), createdDay: day, updatedDay: day };
  nb.hypotheses.push(h);
  return h;
}

export function updateHypothesis(nb: Notebook, id: string, draft: HypothesisDraft, day: number): boolean {
  const index = nb.hypotheses.findIndex((h) => h.id === id && h.kind === 'hypothesis');
  const current = nb.hypotheses[index];
  if (!current || current.kind !== 'hypothesis') return false;
  nb.hypotheses[index] = { ...current, ...sanitizeDraft(draft), updatedDay: day };
  return true;
}

export function removeHypothesis(nb: Notebook, id: string): boolean {
  const before = nb.hypotheses.length;
  nb.hypotheses = nb.hypotheses.filter((h) => h.id !== id);
  return nb.hypotheses.length !== before;
}

const FIELD_LIMIT = 200;

function sanitizeDraft(draft: HypothesisDraft): HypothesisDraft {
  const cut = (s: string) => s.slice(0, FIELD_LIMIT);
  return {
    name: cut(draft.name),
    trigger: cut(draft.trigger),
    effect: cut(draft.effect),
    condition: cut(draft.condition),
    evidence: [...new Set(draft.evidence)].slice(0, 12),
    note: draft.note.slice(0, FIELD_LIMIT * 2),
  };
}

export function findEntry(nb: Notebook, id: string): NotebookEntry | null {
  return [...nb.observations, ...nb.hearsay, ...nb.hypotheses].find((e) => e.id === id) ?? null;
}

/**
 * 記憶処理。直近1日（day）に書かれた携帯写しだけを消す。
 * 観測の原記録（Subject.evidence）、封筒、プレイヤー向け報告履歴には触れない。
 */
export function eraseRecentCopies(nb: Notebook, day: number): number {
  let erased = 0;
  const erase = <T extends NotebookEntry>(entry: T, isRecent: boolean): T | ErasedEntry => {
    if (!isRecent) return entry;
    erased += 1;
    return { kind: 'erased', id: entry.id };
  };
  nb.observations = nb.observations.map((e) => (e.kind === 'observation' ? erase(e, e.day === day) : e));
  nb.hearsay = nb.hearsay.map((e) => (e.kind === 'hearsay' ? erase(e, e.acquiredDay === day) : e));
  nb.hypotheses = nb.hypotheses.map((e) => (e.kind === 'hypothesis' ? erase(e, e.updatedDay === day) : e));
  return erased;
}

/** 封筒へ複写する文面。カードの由来は残すが、筆者名は書かない */
export function envelopeTextFor(entry: NotebookEntry, roomLabel: (code: string) => string): string | null {
  switch (entry.kind) {
    case 'observation':
      return `${entry.text}（${entry.day}日目・${roomLabel(entry.roomCode)}）`;
    case 'hearsay':
      return `${entry.speaker}いわく「${entry.text}」`;
    case 'hypothesis': {
      const parts = [
        entry.name && `呼び名: ${entry.name}`,
        entry.trigger && `きっかけ: ${entry.trigger}`,
        entry.effect && `起きること: ${entry.effect}`,
        entry.condition && `条件: ${entry.condition}`,
        entry.note && entry.note,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(' / ') : null;
    }
    case 'erased':
      return null;
  }
}

export const FREE_TEXT_LIMIT = 200;
