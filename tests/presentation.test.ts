import { describe, expect, it } from 'vitest';
import { present, relativeDirection, type PresentationSettings } from '../src/core/presentation';
import { TICKS, type SimEvent } from '../src/core/pacing';
import { Driver, gaitInput, newTrial } from './helpers';

const CONDITIONS: Record<string, PresentationSettings> = {
  captionsOn: { captions: true, volume: 1 },
  muted: { captions: false, volume: 0 },
  normalAudio: { captions: false, volume: 1 },
};

function precursorEvents(): { events: SimEvent[]; driver: Driver } {
  const d = new Driver(newTrial(2.5));
  d.hold(2, gaitInput('normal', 1));
  d.hold(1, gaitInput('run', 1));
  d.holdTicks(TICKS.stopRelease);
  d.holdTicks(TICKS.retreat);
  const events = d.events.filter((e) => (e.kind === 'step' && e.source === 'follower') || e.kind === 'approach_start' || e.kind === 'retreat_start');
  return { events, driver: d };
}

describe('AC06 字幕ON・音量0・通常音声で、同じタイミングの知覚情報が得られる', () => {
  it('前兆の出来事は、どの条件でも同じ刻みに画面表示を伴う', () => {
    const { events } = precursorEvents();
    expect(events.some((e) => e.kind === 'approach_start')).toBe(true);
    const listener = { x: 5, y: 0, facing: 0 };
    for (const event of events) {
      const byCondition = Object.values(CONDITIONS).map((s) => present(event, listener, s));
      for (const p of byCondition) {
        expect(p.tick).toBe(event.tick);
        expect(p.visual).not.toBeNull();
      }
    }
  });

  it('字幕は字幕ONの時だけ、音は音量が0より大きい時だけ出る', () => {
    const { events } = precursorEvents();
    const step = events.find((e) => e.kind === 'step')!;
    const listener = { x: 5, y: 0, facing: 0 };
    expect(present(step, listener, CONDITIONS.captionsOn!).caption).not.toBeNull();
    expect(present(step, listener, CONDITIONS.normalAudio!).caption).toBeNull();
    expect(present(step, listener, CONDITIONS.muted!).audio).toBeNull();
    expect(present(step, listener, CONDITIONS.normalAudio!).audio).not.toBeNull();
  });

  it('字幕は知覚情報に留め、行動の指示や危険度を書かない', () => {
    const { events } = precursorEvents();
    const listener = { x: 5, y: 0, facing: 0 };
    for (const event of events) {
      const text = present(event, listener, CONDITIONS.captionsOn!).caption?.text ?? '';
      expect(text).not.toMatch(/停止|止まれ|走るな|危険|安全|速度|接近中|死/);
    }
  });

  it('方向は視線を基準にする', () => {
    expect(relativeDirection({ x: 0, y: 0, facing: 0 }, -3, 0)).toBe('後方');
    expect(relativeDirection({ x: 0, y: 0, facing: 0 }, -3, 3)).toBe('右後方');
    expect(relativeDirection({ x: 0, y: 0, facing: Math.PI }, -3, 0)).toBe('前方');
    expect(relativeDirection({ x: 0, y: 0, facing: 0 }, 0, -3)).toBe('左');
  });
});
