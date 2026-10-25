import { describe, expect, it } from 'vitest';
import { PACING } from '../src/core/params';
import { availableResponses, TICKS } from '../src/core/pacing';
import { TrialRunner } from '../src/core/runner';
import { createRng, nextFloat } from '../src/core/rng';
import { Driver, gaitInput, newTrial, type Gait } from './helpers';

const TOLERANCES = PACING.toleranceOptions;

describe('AC04 歩調: 低速往復と致死の解除', () => {
  it.each(TOLERANCES)('許容速度 %s で低速の往復が可能', (tolerance) => {
    const d = new Driver(newTrial(tolerance));
    d.walkTo(22.5, 'slow');
    d.interact();
    expect(d.state.player.hasBox).toBe(true);
    d.walkTo(0.5, 'slow');
    expect(d.state.outcome?.kind).toBe('survived');
    expect(d.count('approach_start')).toBe(0);
    expect(d.state.tick).toBeLessThan(TICKS.deadline);
  });

  it.each(TOLERANCES)('許容速度 %s で閾値超過後、停止0.5秒で接近を解除できる', (tolerance) => {
    const d = new Driver(newTrial(tolerance));
    d.hold(1, gaitInput('run', 1));
    expect(d.state.follower.state).toBe('approach');
    d.holdTicks(TICKS.stopRelease);
    expect(d.state.follower.state).toBe('retreat');
    expect(d.last('retreat_start')?.by).toBe('stop');
    d.holdTicks(TICKS.retreat);
    expect(d.state.follower.state).toBe('follow');
    expect(d.state.follower.clockTicks).toBe(0);
    expect(d.state.outcome).toBeNull();
  });

  it.each(TOLERANCES)('許容速度 %s で閾値超過後、低速移動1秒で接近を解除できる', (tolerance) => {
    const d = new Driver(newTrial(tolerance));
    d.hold(1, gaitInput('run', 1));
    d.holdTicks(TICKS.slowRelease, gaitInput('slow', 1));
    expect(d.state.follower.state).toBe('retreat');
    expect(d.last('retreat_start')?.by).toBe('slow');
    expect(d.state.outcome).toBeNull();
  });

  it('許容速度2.5では通常歩行で接近しない。1.5では接近する', () => {
    const safe = new Driver(newTrial(2.5));
    safe.hold(5, gaitInput('normal', 1));
    expect(safe.count('approach_start')).toBe(0);
    expect(safe.state.observed).toContain('pacing.normal_steady');

    const unsafe = new Driver(newTrial(1.5));
    unsafe.hold(1, gaitInput('normal', 1));
    expect(unsafe.first('approach_start')?.cause).toBe('normal');
    expect(unsafe.state.observed).toContain('pacing.approach.normal');
  });

  it('接近中に通常歩行へ戻すだけでは解除せず、3秒で接触する（許容速度2.5）', () => {
    const d = new Driver(newTrial(2.5));
    d.hold(0.5, gaitInput('run', 1));
    const approach = d.first('approach_start');
    d.hold(4, gaitInput('normal', 1));
    expect(d.state.outcome?.kind).toBe('death');
    expect(d.state.outcome!.tick - approach!.tick).toBe(TICKS.dangerLimit);
  });

  it('解除入力を途中で破棄すると、元の危険時計から再開する', () => {
    const d = new Driver(newTrial(2.5));
    d.step(gaitInput('run', 1));
    const approachTick = d.first('approach_start')!.tick;
    d.holdTicks(60, gaitInput('run', 1));
    expect(d.state.follower.clockTicks).toBe(60);
    d.holdTicks(18);
    expect(d.state.follower.clockTicks).toBe(60);
    d.hold(5, gaitInput('run', 1));
    expect(d.state.outcome?.kind).toBe('death');
    expect(d.state.outcome!.tick).toBe(approachTick + 60 + 18 + (TICKS.dangerLimit - 60));
  });

  it('期限ちょうどの解除入力を受理する', () => {
    const d = new Driver(newTrial(2.5));
    d.step(gaitInput('run', 1));
    d.holdTicks(TICKS.dangerLimit - 1, gaitInput('run', 1));
    expect(d.state.follower.clockTicks).toBe(TICKS.dangerLimit - 1);
    expect(d.state.outcome).toBeNull();
    d.holdTicks(TICKS.stopRelease);
    expect(d.state.outcome).toBeNull();
    expect(d.state.follower.state).toBe('retreat');
  });

  it('後退中に再び閾値を超えると、新しい前兆付きの接近へ戻る', () => {
    const d = new Driver(newTrial(2.5));
    d.hold(1, gaitInput('run', 1));
    d.holdTicks(TICKS.stopRelease);
    expect(d.state.follower.state).toBe('retreat');
    d.step(gaitInput('run', 1));
    expect(d.count('approach_start')).toBe(2);
    expect(d.state.follower.clockTicks).toBe(0);
    d.holdTicks(TICKS.dangerLimit - 1, gaitInput('run', -1));
    expect(d.state.outcome).toBeNull();
  });

  it('振り返りには効果がない', () => {
    const forward = new Driver(newTrial(2.5));
    const lookingBack = new Driver(newTrial(2.5));
    forward.hold(4, gaitInput('normal', 1));
    lookingBack.hold(4, { ...gaitInput('normal', 1), facing: Math.PI });
    expect(lookingBack.state.follower).toEqual(forward.state.follower);
    expect(lookingBack.state.observed).toContain('pacing.look_back');
  });

  it('自分が止まると、もう一つの足音も止まる', () => {
    const d = new Driver(newTrial(2.5));
    d.hold(2, gaitInput('normal', 1));
    const before = d.events.filter((e) => e.kind === 'step' && e.source === 'follower').length;
    d.hold(2);
    const after = d.events.filter((e) => e.kind === 'step' && e.source === 'follower').length;
    expect(before).toBeGreaterThan(0);
    expect(after - before).toBeLessThanOrEqual(1);
    expect(d.state.observed).toContain('pacing.stop_silence');
  });
});

describe('歩調: 指示・退出・時間切れ', () => {
  it.each([
    [2.5, 'normal'],
    [1.5, 'slow'],
  ] as const)('許容速度 %s: 赤線から青線まで走り、止まれば生還できる', (tolerance, gait: Gait) => {
    const d = new Driver(newTrial(tolerance));
    d.walkTo(22.5, gait);
    d.interact();
    d.walkTo(16.5, gait);
    const run = d.state.instructions.find((rt) => rt.id === 'pacing.run');
    expect(run?.issuedTick).not.toBeNull();
    d.walkTo(7.9, 'run');
    expect(run?.achieved).toBe(true);
    d.holdTicks(TICKS.stopRelease);
    d.holdTicks(TICKS.retreat);
    d.walkTo(0.5, gait);
    expect(d.state.outcome?.kind).toBe('survived');
    expect(d.state.outcome?.instructions.find((rt) => rt.id === 'pacing.run')?.achieved).toBe(true);
  });

  it('未解除の危険を持ったまま出口に触れても生還扱いにしない', () => {
    const d = new Driver(newTrial(2.5));
    d.state.player.hasBox = true;
    d.state.player.x = 3;
    d.hold(1, gaitInput('run', -1));
    expect(d.count('door_locked')).toBe(1);
    expect(d.state.outcome).toBeNull();
    // 壁に押し付けて実測速度0になれば停止として扱い、後退後に退出できる
    d.hold(1, gaitInput('run', -1));
    expect(d.count('retreat_start')).toBe(1);
    expect(d.state.outcome?.kind).toBe('survived');
    expect(d.state.outcome!.tick).toBeGreaterThan(d.first('retreat_start')!.tick - 1);
  });

  it('120秒で時間切れ（死亡ではない）。10秒前に予告する', () => {
    const d = new Driver(newTrial(2.5));
    d.hold(PACING.deadline + 1);
    expect(d.state.outcome?.kind).toBe('timeout');
    expect(d.state.outcome?.tick).toBe(TICKS.deadline);
    const warning = d.events.find((e) => e.kind === 'intercom' && e.text.includes('残り10秒'));
    expect(warning?.tick).toBe(TICKS.deadlineWarning);
  });

  it('危険時計の満了と実験期限が同じ刻みなら死亡を優先する', () => {
    const d = new Driver(newTrial(2.5));
    d.state.tick = TICKS.deadline - TICKS.dangerLimit - 1;
    d.state.player.x = 14;
    d.hold(10, gaitInput('run', -1));
    expect(d.state.outcome?.tick).toBe(TICKS.deadline);
    expect(d.state.outcome?.kind).toBe('death');
  });

  it('質問は指示ごとに1回。返答後は従う・逆らうを重ねられない', () => {
    const d = new Driver(newTrial(2.5));
    const intercomBefore = d.count('intercom');
    d.step({ response: 'question' });
    d.step({ response: 'question' });
    expect(d.count('intercom') - intercomBefore).toBe(1);
    expect(availableResponses(d.state)).toEqual(['comply', 'delay', 'refuse']);
    d.step({ response: 'comply' });
    d.step({ response: 'refuse' });
    const brief = d.state.instructions.find((rt) => rt.id === 'pacing.brief');
    expect(brief?.response).toBe('comply');
    expect(availableResponses(d.state)).toEqual([]);
  });
});

describe('AC05 前兆なしの致死・一時停止中の進行がない', () => {
  it('無作為な操作でも、全ての死亡の2秒以上前に前兆がある', () => {
    let deaths = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const rng = createRng(seed, 'cosmetic');
      const tolerance = nextFloat(rng) < 0.5 ? 1.5 : 2.5;
      const d = new Driver(newTrial(tolerance));
      while (!d.state.outcome) {
        const roll = nextFloat(rng);
        const gait: Gait | 'still' = roll < 0.2 ? 'still' : roll < 0.45 ? 'slow' : roll < 0.75 ? 'normal' : 'run';
        const dir = nextFloat(rng) < 0.55 ? 1 : -1;
        const seconds = 0.1 + nextFloat(rng) * 2;
        const input = gait === 'still' ? {} : { ...gaitInput(gait, dir), moveY: nextFloat(rng) - 0.5 };
        d.hold(seconds, { ...input, interact: nextFloat(rng) < 0.1 });
      }
      if (d.state.outcome.kind !== 'death') continue;
      deaths += 1;
      const deathTick = d.state.outcome.tick;
      const precursor = d.events.filter((e) => e.kind === 'approach_start' && e.tick <= deathTick).pop();
      expect(precursor, `seed ${seed}`).toBeDefined();
      expect(deathTick - precursor!.tick).toBeGreaterThanOrEqual(120);
    }
    expect(deaths).toBeGreaterThan(0);
  });

  it.each(['menu', 'notes', 'settings', 'focus'] as const)('一時停止（%s）中は実験時計も危険時計も進まない', (reason) => {
    const state = newTrial(2.5);
    const runner = new TrialRunner(state);
    const running = { ...gaitInput('run', 1), moveY: 0, run: true, slow: false, facing: 0, moveX: 1 };
    runner.advance(0.5, running);
    expect(state.follower.state).toBe('approach');
    const snapshot = structuredClone({ ...state, events: [] });
    runner.pause(reason);
    for (let i = 0; i < 600; i++) runner.advance(1 / 60, running);
    expect({ ...state, events: [] }).toEqual(snapshot);
    runner.resume(reason);
    expect(runner.advance(1 / 60 + 1e-9, running)).toBe(1);
  });

  it('一時停止中の押下は捨て、再開後の刻みに持ち越さない', () => {
    const state = newTrial(2.5);
    state.player.x = PACING.boxX - 0.5;
    const runner = new TrialRunner(state);
    const idle = { moveX: 0, moveY: 0, run: false, slow: false, facing: 0 };
    runner.pause('notes');
    runner.queueInteract();
    runner.resume('notes');
    runner.advance(1 / 60 + 1e-9, idle);
    expect(state.player.hasBox).toBe(false);
    runner.queueInteract();
    runner.advance(1 / 240, idle);
    runner.advance(1 / 60, idle);
    expect(state.player.hasBox).toBe(true);
  });
});
