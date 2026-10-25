// 実時間から固定刻みへの変換と一時停止。仕様案3.3に対応する。
// ポーズ・ノート・設定・フォーカス喪失のいずれかが有効な間は、実験時計・指示期限・危険進行を止める。

import { stepTrial, type PacingTrialState, type TrialInput } from './pacing';
import type { ResponseKind } from './instructions';
import { SIM_DT } from './params';

export type PauseReason = 'menu' | 'notes' | 'settings' | 'focus' | 'resume';

export type HeldInput = Omit<TrialInput, 'interact' | 'response'>;

const MAX_STEPS_PER_ADVANCE = 8;

export class TrialRunner {
  private accumulator = 0;
  private readonly pauses = new Set<PauseReason>();
  private pendingInteract = false;
  private pendingResponse: ResponseKind | null = null;

  constructor(readonly state: PacingTrialState) {}

  get paused(): boolean {
    return this.pauses.size > 0;
  }

  get pauseReasons(): PauseReason[] {
    return [...this.pauses];
  }

  pause(reason: PauseReason): void {
    this.pauses.add(reason);
    this.accumulator = 0;
    this.pendingInteract = false;
    this.pendingResponse = null;
  }

  resume(reason: PauseReason): void {
    this.pauses.delete(reason);
  }

  /** 押下入力は次の刻みで1回だけ使う。一時停止中の押下は捨てる */
  queueInteract(): void {
    if (!this.paused) this.pendingInteract = true;
  }

  queueResponse(response: ResponseKind): void {
    if (!this.paused) this.pendingResponse = response;
  }

  /** 実時間 realDt 秒ぶん進める。一時停止中は何もしない。戻り値は進めた刻み数 */
  advance(realDt: number, held: HeldInput): number {
    if (this.paused || this.state.outcome) return 0;
    this.accumulator += Math.max(0, realDt);
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < MAX_STEPS_PER_ADVANCE && !this.state.outcome) {
      stepTrial(this.state, { ...held, interact: this.pendingInteract, response: this.pendingResponse });
      this.pendingInteract = false;
      this.pendingResponse = null;
      this.accumulator -= SIM_DT;
      steps += 1;
    }
    // 処理落ちで溜まった分は捨てる。早送りで判定を飛ばさない
    if (steps === MAX_STEPS_PER_ADVANCE) this.accumulator = 0;
    return steps;
  }
}
