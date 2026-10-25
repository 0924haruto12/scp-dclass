import { createPacingTrial, IDLE_INPUT, secondsToTicks, stepTrial, type PacingTrialState, type SimEvent, type TrialInput } from '../src/core/pacing';

export type Gait = 'slow' | 'normal' | 'run';

export function newTrial(tolerance: number): PacingTrialState {
  return createPacingTrial({ trialId: 't', subjectNumber: 'D-0001', day: 1, researcher: 'A', tolerance });
}

/** 刻みごとに出来事を回収しながら進める */
export class Driver {
  readonly events: SimEvent[] = [];
  constructor(readonly state: PacingTrialState) {
    this.drain();
  }

  private drain(): void {
    this.events.push(...this.state.events.splice(0));
  }

  step(input: Partial<TrialInput> = {}): void {
    stepTrial(this.state, { ...IDLE_INPUT, facing: this.state.player.facing, ...input });
    this.drain();
  }

  hold(seconds: number, input: Partial<TrialInput> = {}): void {
    const ticks = secondsToTicks(seconds);
    for (let i = 0; i < ticks && !this.state.outcome; i++) this.step(input);
  }

  holdTicks(ticks: number, input: Partial<TrialInput> = {}): void {
    for (let i = 0; i < ticks && !this.state.outcome; i++) this.step(input);
  }

  /** 指定のx座標まで歩く。到達するか終了したら止まる */
  walkTo(x: number, gait: Gait, maxSeconds = 130): void {
    const dir = x > this.state.player.x ? 1 : -1;
    const limit = secondsToTicks(maxSeconds);
    for (let i = 0; i < limit && !this.state.outcome; i++) {
      if ((dir > 0 && this.state.player.x >= x) || (dir < 0 && this.state.player.x <= x)) return;
      this.step(gaitInput(gait, dir));
    }
  }

  interact(): void {
    this.step({ interact: true });
  }

  count(kind: SimEvent['kind']): number {
    return this.events.filter((e) => e.kind === kind).length;
  }

  first<K extends SimEvent['kind']>(kind: K): Extract<SimEvent, { kind: K }> | undefined {
    return this.events.find((e) => e.kind === kind) as Extract<SimEvent, { kind: K }> | undefined;
  }

  last<K extends SimEvent['kind']>(kind: K): Extract<SimEvent, { kind: K }> | undefined {
    return [...this.events].reverse().find((e) => e.kind === kind) as Extract<SimEvent, { kind: K }> | undefined;
  }
}

export function gaitInput(gait: Gait, dirX: number): Partial<TrialInput> {
  return {
    moveX: dirX,
    moveY: 0,
    run: gait === 'run',
    slow: gait === 'slow',
    facing: dirX > 0 ? 0 : Math.PI,
  };
}
