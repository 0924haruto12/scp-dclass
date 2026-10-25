// 推理ノートの画面。観測・伝聞・仮説の3ページ。ページ名は由来を示し、真偽の評価ではない。
// 枠のラベルは最初から見せるが、正解候補の選択肢は並べない。消えた項目は「未記入」とだけ示す。

import { roomLabel } from '../core/content';
import {
  addHypothesis,
  removeHypothesis,
  updateHypothesis,
  type Hypothesis,
  type HypothesisDraft,
  type Notebook,
} from '../core/notebook';
import { button, clear, h } from './dom';

export type NotesTab = 'observation' | 'hearsay' | 'hypothesis';

export interface NotesContext {
  notebook: Notebook;
  day: number;
  owner: string;
  onChange: () => void;
  onClose: () => void;
}

const TAB_LABEL: Record<NotesTab, string> = {
  observation: '観測',
  hearsay: '伝聞',
  hypothesis: '仮説',
};

export function renderNotes(root: HTMLElement, ctx: NotesContext, tab: NotesTab = 'observation', editingId: string | null = null): void {
  clear(root);
  const rerender = (nextTab: NotesTab = tab, nextEditing: string | null = null) => renderNotes(root, ctx, nextTab, nextEditing);
  const tabs = h(
    'div',
    { class: 'tabs' },
    ...(Object.keys(TAB_LABEL) as NotesTab[]).map((t) => button(TAB_LABEL[t], () => rerender(t), { class: t === tab ? 'tab active' : 'tab' })),
  );
  const body = h('div', { class: 'notes-body' });
  switch (tab) {
    case 'observation':
      renderObservations(body, ctx);
      break;
    case 'hearsay':
      renderHearsay(body, ctx);
      break;
    case 'hypothesis':
      renderHypotheses(body, ctx, editingId, rerender);
      break;
  }
  root.append(
    h(
      'div',
      { class: 'panel notes' },
      h('div', { class: 'notes-head' }, h('h2', {}, `推理ノート — ${ctx.owner}`), button('閉じる（Tab）', ctx.onClose, { class: 'ghost' })),
      tabs,
      body,
    ),
  );
}

function blank(): HTMLElement {
  return h('p', { class: 'blank' }, '未記入');
}

function renderObservations(body: HTMLElement, ctx: NotesContext): void {
  const items = ctx.notebook.observations;
  if (items.length === 0) {
    body.append(blank());
    return;
  }
  for (const card of items) {
    if (card.kind === 'erased') {
      body.append(h('div', { class: 'card erased' }, '未記入'));
      continue;
    }
    body.append(
      h('div', { class: 'card' }, h('p', {}, card.text), h('p', { class: 'meta' }, `${card.day}日目・${roomLabel(card.roomCode)}・観測者 ${card.observer}`)),
    );
  }
}

function renderHearsay(body: HTMLElement, ctx: NotesContext): void {
  const items = ctx.notebook.hearsay;
  if (items.length === 0) {
    body.append(blank());
    return;
  }
  for (const card of items) {
    if (card.kind === 'erased') {
      body.append(h('div', { class: 'card erased' }, '未記入'));
      continue;
    }
    const observed = card.speakerObserved ? `・話者の観察: ${card.speakerObserved}` : '';
    body.append(h('div', { class: 'card' }, h('p', {}, card.text), h('p', { class: 'meta' }, `話者: ${card.speaker}・入手: ${card.acquiredDay}日目${observed}`)));
  }
}

function renderHypotheses(body: HTMLElement, ctx: NotesContext, editingId: string | null, rerender: (tab?: NotesTab, editing?: string | null) => void): void {
  const nb = ctx.notebook;
  const editing = editingId === 'new' ? null : (nb.hypotheses.find((x) => x.id === editingId && x.kind === 'hypothesis') as Hypothesis | undefined);
  if (editingId) {
    body.append(hypothesisForm(ctx, editing ?? null, rerender));
    return;
  }
  body.append(h('div', { class: 'row' }, button('新しい仮説を書く', () => rerender('hypothesis', 'new'))));
  if (nb.hypotheses.length === 0) body.append(blank());
  for (const hyp of nb.hypotheses) {
    if (hyp.kind === 'erased') {
      body.append(h('div', { class: 'card erased' }, '未記入'));
      continue;
    }
    const fields: [string, string][] = [
      ['きっかけ', hyp.trigger],
      ['起きること', hyp.effect],
      ['条件', hyp.condition],
    ];
    body.append(
      h(
        'div',
        { class: 'card hypothesis' },
        h('p', { class: 'hyp-name' }, hyp.name || '（呼び名なし）'),
        ...fields.map(([label, value]) => h('p', {}, h('span', { class: 'label' }, `${label}: `), value || '—')),
        hyp.evidence.length > 0 ? h('p', { class: 'meta' }, `根拠: ${hyp.evidence.length}件`) : null,
        hyp.note ? h('p', { class: 'note' }, hyp.note) : null,
        h('div', { class: 'row' }, button('書き直す', () => rerender('hypothesis', hyp.id), { class: 'ghost' })),
      ),
    );
  }
}

function hypothesisForm(ctx: NotesContext, current: Hypothesis | null, rerender: (tab?: NotesTab, editing?: string | null) => void): HTMLElement {
  const nb = ctx.notebook;
  const draft: HypothesisDraft = current
    ? { name: current.name, trigger: current.trigger, effect: current.effect, condition: current.condition, evidence: [...current.evidence], note: current.note }
    : { name: '', trigger: '', effect: '', condition: '', evidence: [], note: '' };

  const field = (label: string, key: 'name' | 'trigger' | 'effect' | 'condition') =>
    h(
      'label',
      { class: 'field' },
      h('span', {}, label),
      h('input', {
        type: 'text',
        value: draft[key],
        maxLength: 200,
        oninput: (ev) => {
          draft[key] = (ev.target as HTMLInputElement).value;
        },
      }),
    );

  const cards = [...nb.observations, ...nb.hearsay].filter((c) => c.kind !== 'erased');
  const evidenceList = h(
    'div',
    { class: 'evidence' },
    ...cards.map((c) => {
      const text = c.kind === 'observation' || c.kind === 'hearsay' ? c.text : '';
      const box = h('input', {
        type: 'checkbox',
        checked: draft.evidence.includes(c.id),
        onchange: (ev) => {
          const on = (ev.target as HTMLInputElement).checked;
          draft.evidence = on ? [...draft.evidence, c.id] : draft.evidence.filter((id) => id !== c.id);
        },
      });
      return h('label', { class: 'evidence-item' }, box, h('span', {}, text.length > 48 ? `${text.slice(0, 48)}…` : text));
    }),
  );

  const save = () => {
    if (current) updateHypothesis(nb, current.id, draft, ctx.day);
    else addHypothesis(nb, draft, ctx.day);
    ctx.onChange();
    rerender('hypothesis', null);
  };
  const remove = () => {
    if (current) removeHypothesis(nb, current.id);
    ctx.onChange();
    rerender('hypothesis', null);
  };

  return h(
    'div',
    { class: 'card form' },
    field('呼び名', 'name'),
    field('きっかけ', 'trigger'),
    field('起きること', 'effect'),
    field('条件', 'condition'),
    h('p', { class: 'label' }, '根拠にするカード（任意）'),
    cards.length > 0 ? evidenceList : h('p', { class: 'blank' }, '未記入'),
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'メモ'),
      h('textarea', {
        rows: 3,
        value: draft.note,
        maxLength: 400,
        oninput: (ev) => {
          draft.note = (ev.target as HTMLTextAreaElement).value;
        },
      }),
    ),
    h(
      'div',
      { class: 'row' },
      button('書き留める', save),
      current ? button('消す', remove, { class: 'ghost' }) : null,
      button('やめる', () => rerender('hypothesis', null), { class: 'ghost' }),
    ),
  );
}
