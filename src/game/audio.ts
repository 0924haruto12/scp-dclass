// Web Audio による合成音。音声素材は使わない。
// 前兆音は研究員の声（インターホン）で打ち消さない。声側を小さく短くし、足音は減衰させない。

import type { AudioCue, SoundId } from '../core/presentation';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private hum: { osc: OscillatorNode; gain: GainNode } | null = null;
  private volume = 0.8;

  /** ブラウザの自動再生制限のため、利用者の操作から呼ぶ */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const length = Math.floor(this.ctx.sampleRate * 1.5);
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master) this.master.gain.value = volume;
  }

  ambience(on: boolean): void {
    if (!this.ctx || !this.master) return;
    if (on && !this.hum) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 55;
      gain.gain.value = 0.02;
      osc.connect(gain).connect(this.master);
      osc.start();
      this.hum = { osc, gain };
    } else if (!on && this.hum) {
      this.hum.osc.stop();
      this.hum = null;
    }
  }

  play(cue: AudioCue): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = cue.pan;
    panner.connect(this.master);
    SOUNDS[cue.sound](this.ctx, this.noise, panner, t, cue.gain, cue.rate);
  }
}

type Synth = (ctx: AudioContext, noise: AudioBuffer, out: AudioNode, t: number, gain: number, rate: number) => void;

function noiseBurst(ctx: AudioContext, noise: AudioBuffer, out: AudioNode, t: number, opts: { freq: number; q: number; gain: number; dur: number; type?: BiquadFilterType }): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.value = opts.freq;
  filter.Q.value = opts.q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  src.connect(filter).connect(env).connect(out);
  src.start(t, Math.random() * 1.2, opts.dur + 0.05);
}

function tone(ctx: AudioContext, out: AudioNode, t: number, opts: { freq: number; gain: number; dur: number; type: OscillatorType; slideTo?: number }): void {
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + opts.dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + opts.dur + 0.05);
}

const SOUNDS: Record<SoundId, Synth> = {
  step_self: (ctx, noise, out, t, gain) => {
    noiseBurst(ctx, noise, out, t, { freq: 520, q: 1.2, gain: gain * 0.5, dur: 0.07 });
  },
  step_other: (ctx, noise, out, t, gain, rate) => {
    noiseBurst(ctx, noise, out, t, { freq: 300 * rate, q: 1.6, gain: gain * 0.7, dur: 0.09 });
    tone(ctx, out, t, { freq: 70 * rate, gain: gain * 0.25, dur: 0.08, type: 'sine' });
  },
  approach: (ctx, noise, out, t, gain) => {
    tone(ctx, out, t, { freq: 48, gain: gain * 0.6, dur: 0.5, type: 'sine', slideTo: 38 });
    noiseBurst(ctx, noise, out, t, { freq: 240, q: 0.8, gain: gain * 0.5, dur: 0.25 });
  },
  intercom: (ctx, noise, out, t, gain) => {
    noiseBurst(ctx, noise, out, t, { freq: 1800, q: 2, gain: gain * 0.25, dur: 0.18 });
    tone(ctx, out, t + 0.02, { freq: 980, gain: gain * 0.08, dur: 0.06, type: 'square' });
  },
  door: (ctx, noise, out, t, gain) => {
    tone(ctx, out, t, { freq: 140, gain: gain * 0.3, dur: 0.18, type: 'square' });
    noiseBurst(ctx, noise, out, t, { freq: 900, q: 3, gain: gain * 0.4, dur: 0.12 });
  },
  pickup: (ctx, noise, out, t, gain) => {
    noiseBurst(ctx, noise, out, t, { freq: 700, q: 0.7, gain: gain * 0.4, dur: 0.15, type: 'lowpass' });
  },
  paper: (ctx, noise, out, t, gain) => {
    noiseBurst(ctx, noise, out, t, { freq: 3500, q: 0.6, gain: gain * 0.3, dur: 0.22, type: 'highpass' });
  },
  shutter: (ctx, noise, out, t, gain) => {
    noiseBurst(ctx, noise, out, t, { freq: 400, q: 0.5, gain: gain * 0.6, dur: 1.1, type: 'lowpass' });
    tone(ctx, out, t + 1, { freq: 90, gain: gain * 0.5, dur: 0.3, type: 'square' });
  },
};
