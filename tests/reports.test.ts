import { describe, expect, it } from 'vitest';
import { FACTS, type FactId } from '../src/core/facts';
import type { TrialOutcome } from '../src/core/pacing';
import { buildTrialReport, selectFragmentFact } from '../src/core/reports';
import { createRng, nextFloat } from '../src/core/rng';

const ALL_FACTS = Object.keys(FACTS) as FactId[];

function outcome(kind: TrialOutcome['kind']): TrialOutcome {
  return { kind, tick: 900, hasBox: kind !== 'timeout', lastMode: 'run', lastModeTicks: 132, leg: 'return', instructions: [] };
}

function report(kind: TrialOutcome['kind'], observed: FactId[]) {
  return buildTrialReport({ cycleId: 'c1', facilityCode: '区画7-C', day: 1, subjectNumber: 'D-1234', roomCode: 'T-03', outcome: outcome(kind), observed });
}

describe('AC13 生還・死亡の双方で観測事実に基づく断片を1件だけ出す', () => {
  it('生還・時間切れ・死亡のいずれも断片は1件で、観測した事実から選ばれる', () => {
    const observed: FactId[] = ['pacing.echo', 'pacing.approach.run', 'pacing.retreat.stop'];
    for (const kind of ['survived', 'timeout', 'death'] as const) {
      const r = report(kind, observed);
      expect(r.fragment).toBe(FACTS['pacing.retreat.stop'].report);
    }
  });

  it('無作為な観測集合でも、断片は必ずその集合のどれかから選ばれる', () => {
    const rng = createRng(7, 'cosmetic');
    for (let i = 0; i < 200; i++) {
      const observed = ALL_FACTS.filter(() => nextFloat(rng) < 0.3);
      const fact = selectFragmentFact(observed);
      if (observed.length === 0) {
        expect(fact).toBeNull();
      } else {
        expect(observed).toContain(fact);
      }
    }
  });

  it('死亡回数では開示が増えない', () => {
    const observed: FactId[] = ['pacing.echo'];
    const first = report('death', observed);
    const tenth = report('death', observed);
    const survived = report('survived', observed);
    expect(tenth.fragment).toBe(first.fragment);
    expect(survived.fragment).toBe(first.fragment);
  });

  it('報告書は変動パラメータや未発生のルールを書かない', () => {
    for (const kind of ['survived', 'timeout', 'death'] as const) {
      const text = [...report(kind, ALL_FACTS).lines, report(kind, ALL_FACTS).fragment].join('\n');
      expect(text).not.toMatch(/許容|閾値|1\.5|2\.5|振り返|ルール|原因|ため死亡/);
    }
  });

  it('死亡報告は直前の入力と身体反応を記す', () => {
    const r = report('death', []);
    expect(r.lines.join('')).toContain('走行の開始から2.2秒後');
    expect(r.lines.join('')).toContain('背部に圧迫痕');
    expect(r.fragment).toBe('被験者の行動に特記事項なし。');
  });
});
