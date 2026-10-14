/** Tiny synthesized kitchen sounds (WebAudio, no assets). Off by default. */
export class Sounds {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    const unlock = () => {
      if (!this.ctx) {
        try {
          this.ctx = new AudioContext();
        } catch {
          this.ctx = null;
        }
      }
      this.ctx?.resume?.();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  tone(freq, start, dur, type = 'sine', gain = 0.12) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime + start);
    g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + start);
    o.stop(ctx.currentTime + start + dur + 0.05);
  }

  noise(start, dur, gain = 0.08) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = gain;
    src.buffer = buf;
    src.connect(g).connect(ctx.destination);
    src.start(ctx.currentTime + start);
  }

  play(kind) {
    if (!this.settings.sound || !this.ctx || this.ctx.state !== 'running') return;
    switch (kind) {
      case 'order': this.tone(880, 0, 0.18, 'triangle'); this.tone(1320, 0.12, 0.25, 'triangle'); break;
      case 'served': this.tone(1046, 0, 0.12, 'square', 0.06); this.tone(1568, 0.09, 0.35, 'square', 0.06); break;
      case 'fire': this.noise(0, 0.6, 0.12); this.tone(220, 0, 0.4, 'sawtooth', 0.05); break;
      case 'chop': this.noise(0, 0.05, 0.05); break;
      case 'failed': this.tone(330, 0, 0.2, 'sawtooth', 0.06); this.tone(247, 0.18, 0.3, 'sawtooth', 0.06); break;
      default: break;
    }
  }
}
