import { PerceptualCue } from '../core/types';

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private omenActive = false;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setOmenActive(active: boolean): void {
    this.omenActive = active;
  }

  /**
   * Plays a procedural sound effect for a PerceptualCue.
   * Per Section 3.2: Omen sounds have highest priority; intercom voice/beeps are ducked when omenActive is true
   * so instructions never mask omen audio.
   */
  public playCue(cue: PerceptualCue, masterVolume: number): void {
    if (masterVolume <= 0.001) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const isOmenCue =
      cue.audioType === 'footstep_omen_rapid' || cue.audioType === 'metal_pulse_omen';
    // Duck non-omen intercom cues if an omen is active (Section 3.2 priority rule)
    const priorityGain = !isOmenCue && this.omenActive ? 0.35 : 1.0;
    const gainValue = Math.min(1, masterVolume * priorityGain);

    if (cue.audioType === 'footstep_echo_halfbeat') {
      this.triggerStepPulse(ctx, now, 130, 0.08 * gainValue);
      // Half-beat delayed heavier echo step behind player
      this.triggerStepPulse(ctx, now + 0.24, 95, 0.12 * gainValue);
      return;
    }

    if (cue.audioType === 'footstep_omen_rapid') {
      for (let i = 0; i < 4; i++) {
        this.triggerStepPulse(ctx, now + i * 0.11, 80 + i * 12, 0.22 * gainValue);
      }
      return;
    }

    if (cue.audioType === 'footstep_receding') {
      for (let i = 0; i < 3; i++) {
        this.triggerStepPulse(
          ctx,
          now + i * 0.22,
          110 - i * 15,
          0.14 * (1 - i * 0.3) * gainValue
        );
      }
      return;
    }

    if (cue.audioType === 'intercom_beep' || cue.audioType === 'intercom_cutoff') {
      this.triggerTone(ctx, now, 780, 0.07, 0.08 * gainValue, 'square');
      this.triggerTone(ctx, now + 0.09, 620, 0.09, 0.08 * gainValue, 'square');
      return;
    }

    if (cue.audioType === 'metal_pulse_omen') {
      this.triggerTone(ctx, now, 110, 0.35, 0.2 * gainValue, 'sawtooth');
      this.triggerTone(ctx, now + 0.18, 165, 0.35, 0.18 * gainValue, 'triangle');
      return;
    }

    if (cue.audioType === 'phase_blackout' || cue.audioType === 'door_seal') {
      this.triggerTone(ctx, now, 65, 0.4, 0.24 * gainValue, 'sine');
      return;
    }

    if (cue.audioType === 'terminal_mismatch') {
      this.triggerTone(ctx, now, 310, 0.12, 0.14 * gainValue, 'sawtooth');
      this.triggerTone(ctx, now + 0.15, 260, 0.16, 0.14 * gainValue, 'sawtooth');
      return;
    }

    this.triggerTone(ctx, now, 520, 0.06, 0.08 * gainValue, 'sine');
  }

  private triggerStepPulse(
    ctx: AudioContext,
    startTime: number,
    freq: number,
    volume: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, startTime);
    osc.frequency.exponentialRampToValueAtTime(35, startTime + 0.09);

    gain.gain.setValueAtTime(Math.max(0.001, volume), startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.1);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + 0.11);
  }

  private triggerTone(
    ctx: AudioContext,
    startTime: number,
    freq: number,
    duration: number,
    volume: number,
    type: OscillatorType
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(Math.max(0.001, volume), startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }
}
