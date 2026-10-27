import { describe, expect, it } from 'vitest';
import { getDebriefChoices } from '../src/core/content';
import { createInitialGameState, performSafeReevaluationTaskAtNight } from '../src/core/engine';

// Internal letters (C/S/E) are developer notation; players read 信用・疑念・評価.
const LETTER_NOTATION = /(^|[^A-Za-z0-9-])[CSE]\s?([+-]\d|=\d|>=|<=|変化)/;

describe('画面の文章は内部記号ではなく信用・疑念で書く', () => {
  it('事後聴取の選択肢の説明に C/S の記号を使わない', () => {
    for (const room of ['T-101', 'T-204', 'T-309', 'W-00'] as const) {
      for (const choice of getDebriefChoices(room)) {
        expect(choice.description).not.toMatch(LETTER_NOTATION);
      }
    }
  });

  it('夜の安全な再評価業務の記録は信用・疑念の言葉で変化を伝える', () => {
    const state = createInitialGameState('FIXED-DEFAULT');
    state.cycle.phase = 'night';
    state.cycle.nightActionsLeft = 2;
    performSafeReevaluationTaskAtNight(state);
    const message = state.lastActionLog[state.lastActionLog.length - 1];
    expect(message).toContain('信用+1');
    expect(message).not.toMatch(LETTER_NOTATION);
  });
});
