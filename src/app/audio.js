// 音は前兆の一部として扱う。音量0でも字幕は同じタイミングで出す（main.js 側）。
// 初回のユーザー操作後に AudioContext を作る。

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class AudioEngine {
  constructor(volume = 0.55) {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.volume = clamp(volume, 0, 1);
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.#makeNoise(1.2);
      return this.ctx;
    } catch {
      this.ctx = null;
      return null;
    }
  }

  setVolume(value) {
    this.volume = clamp(Number(value) || 0, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  }

  #makeNoise(seconds) {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = 0.98 * last + 0.02 * white;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  #output(pan = 0) {
    if (!this.master) return null;
    if (typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      panner.connect(this.master);
      return panner;
    }
    return this.master;
  }

  #noise({ duration = 0.1, volume = 0.2, frequency = 500, q = 1, pan = 0, type = 'lowpass' }) {
    if (!this.ensure()) return;
    const destination = this.#output(pan);
    if (!destination) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(destination);
    source.start(now);
    source.stop(now + duration + 0.05);
  }

  #tone({ frequency = 220, duration = 0.2, volume = 0.12, pan = 0, type = 'sine', slideTo = null }) {
    if (!this.ensure()) return;
    const destination = this.#output(pan);
    if (!destination) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  playerStep(speed) {
    const volume = speed >= 4 ? 0.11 : speed >= 2 ? 0.07 : 0.04;
    this.#noise({ duration: 0.055, volume, frequency: 420, q: 0.8, type: 'bandpass' });
  }

  followStep({ intensity = 0.1, pan = -0.35, frequency = 240 }) {
    this.#noise({
      duration: 0.09,
      volume: 0.06 + intensity * 0.35,
      frequency,
      q: 1.4,
      pan,
      type: 'lowpass',
    });
  }

  approachAlert() {
    this.#tone({ frequency: 92, slideTo: 55, duration: 0.7, volume: 0.16, pan: -0.2, type: 'sine' });
    this.#noise({ duration: 0.35, volume: 0.1, frequency: 300, pan: -0.3 });
  }

  retreat() {
    this.#noise({ duration: 0.9, volume: 0.09, frequency: 900, q: 0.7, pan: -0.3 });
    this.#tone({ frequency: 300, slideTo: 120, duration: 0.8, volume: 0.05, pan: -0.2 });
  }

  intercom() {
    this.#tone({ frequency: 760, duration: 0.09, volume: 0.09, type: 'square' });
    window.setTimeout(() => this.#tone({ frequency: 520, duration: 0.12, volume: 0.08, type: 'square' }), 120);
    this.#noise({ duration: 0.24, volume: 0.03, frequency: 2200, type: 'highpass' });
  }

  alarm() {
    [0, 260, 520].forEach((delay) => {
      window.setTimeout(
        () => this.#tone({ frequency: 880, duration: 0.16, volume: 0.08, type: 'triangle' }),
        delay,
      );
    });
  }

  collect() {
    this.#noise({ duration: 0.06, volume: 0.12, frequency: 1400, type: 'bandpass' });
    this.#tone({ frequency: 330, duration: 0.08, volume: 0.06, type: 'triangle' });
  }

  door() {
    this.#noise({ duration: 0.4, volume: 0.16, frequency: 260 });
    this.#tone({ frequency: 70, duration: 0.5, volume: 0.12 });
  }

  death() {
    this.#noise({ duration: 0.6, volume: 0.3, frequency: 180 });
    this.#tone({ frequency: 55, slideTo: 30, duration: 1.1, volume: 0.24 });
    this.#tone({ frequency: 1200, duration: 0.18, volume: 0.05, type: 'sawtooth' });
  }

  breath() {
    this.#noise({ duration: 0.5, volume: 0.07, frequency: 700, q: 0.4 });
  }

  ui() {
    this.#noise({ duration: 0.03, volume: 0.03, frequency: 2000, type: 'highpass' });
  }
}
