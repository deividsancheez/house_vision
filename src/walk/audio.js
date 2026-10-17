// Sounds, all generated in code with the Web Audio API (no sound files): footsteps (softer and
// duller on a rug), pick up, drop, store, a refused drop, and a goal sparkle.
export class Sounds {
  constructor(muted) {
    this.muted = muted;
    this.ctx = null;
    this.noise = null;
  }

  /** Browsers only allow audio after a tap or key press: call this from one. */
  unlock() {
    if (this.muted) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.5;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { this.ctx = null; }
  }

  setMuted(m) {
    this.muted = m;
    if (!m) this.unlock();
  }

  get ready() { return !this.muted && this.ctx && this.ctx.state === 'running'; }

  tone(freq, start, dur, { type = 'sine', gain = 0.25, to = null } = {}) {
    const c = this.ctx, t = c.currentTime + start;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hiss(start, dur, { freq = 800, q = 0.8, gain = 0.3, type = 'lowpass' } = {}) {
    const c = this.ctx, t = c.currentTime + start;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.3);
    s.stop(t + dur + 0.02);
  }

  play(name, opts = {}) {
    if (!this.ready) return;
    switch (name) {
      case 'step':
        // a soft heel tap; on a rug it's quieter and duller
        if (opts.rug) this.hiss(0, 0.09, { freq: 380, gain: 0.07 });
        else { this.hiss(0, 0.07, { freq: 1400, gain: 0.12, q: 1.2 }); this.tone(95, 0, 0.06, { gain: 0.08 }); }
        break;
      case 'pickup': this.tone(330, 0, 0.12, { type: 'triangle', to: 520, gain: 0.18 }); break;
      case 'drop': this.tone(180, 0, 0.14, { type: 'triangle', to: 110, gain: 0.22 }); this.hiss(0, 0.08, { freq: 600, gain: 0.12 }); break;
      case 'store': this.tone(520, 0, 0.09, { type: 'triangle', gain: 0.15 }); this.tone(780, 0.08, 0.12, { type: 'triangle', gain: 0.13 }); break;
      case 'invalid': this.tone(150, 0, 0.11, { type: 'square', gain: 0.08 }); this.tone(130, 0.12, 0.14, { type: 'square', gain: 0.08 }); break;
      case 'goal': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.07, 0.35, { type: 'sine', gain: 0.14 })); this.hiss(0.05, 0.4, { freq: 6000, type: 'highpass', gain: 0.05 }); break;
      case 'click': this.tone(660, 0, 0.05, { type: 'sine', gain: 0.08 }); break;
      default:
    }
  }
}
