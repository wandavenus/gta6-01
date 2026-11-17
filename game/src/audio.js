// All sound is synthesized with WebAudio — no audio files. One AudioContext, a master gain,
// an engine voice whose pitch follows the player's speed, a two-tone siren voice, short
// noise/oscillator one-shots, and a step-sequenced synthwave loop (bass, pad, hats, kick)
// in A minor. Nothing starts until the first user gesture calls unlock().

export class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this._musicTimer = null;
    this._step = 0;
    this._engine = null;
    this._siren = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.85 : 0;
    this.master.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.34;
    this.musicGain.connect(this.master);
    this._noiseBuf = this._makeNoise();
    if (this.musicOn) this.startMusic();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.03);
  }
  setMusic(on) {
    this.musicOn = on;
    if (!this.ctx) return;
    if (on) this.startMusic(); else this.stopMusic();
  }

  _makeNoise() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _env(gain, t, a, peak, dec) {
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.001, t + a + dec);
  }

  /** Short oscillator blip. type/freq/dur/vol, optional pitch slide to freq2. */
  blip(freq, dur = 0.12, vol = 0.25, type = 'square', freq2 = null, dest = null) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
    this._env(g, t, 0.005, vol, dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** Filtered noise burst: gunshots, crashes, punches, hats. */
  noise(dur = 0.15, vol = 0.4, freq = 1200, q = 0.8, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this._noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, 0.004, vol, dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  click() { this.blip(880, 0.05, 0.12, 'square'); }
  cash() { this.blip(1320, 0.09, 0.22, 'sine'); setTimeout(() => this.blip(1760, 0.14, 0.22, 'sine'), 70); }
  pickup() { this.blip(660, 0.08, 0.2, 'triangle', 990); }
  punch() { this.noise(0.09, 0.5, 300, 1, 'lowpass'); this.blip(90, 0.1, 0.4, 'sine', 45); }
  gunshot() { this.noise(0.16, 0.65, 2600, 0.4, 'lowpass'); this.blip(160, 0.1, 0.3, 'sawtooth', 40); }
  reload() { this.blip(500, 0.05, 0.15, 'square'); setTimeout(() => this.blip(340, 0.05, 0.15, 'square'), 110); setTimeout(() => this.blip(720, 0.06, 0.18, 'square'), 260); }
  crash(hard = 1) { this.noise(0.3, 0.35 + 0.3 * hard, 500, 0.6, 'lowpass'); this.blip(70, 0.25, 0.3 * hard, 'sine', 30); }
  hurt() { this.blip(220, 0.16, 0.25, 'sawtooth', 110); }
  door() { this.noise(0.07, 0.25, 900, 1, 'bandpass'); }
  jingle(win = true) {
    if (!this.ctx) return;
    const notes = win ? [523, 659, 784, 1047] : [392, 330, 262, 196];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 0.22, 'triangle'), i * 110));
  }
  radioBlip() { this.blip(1180, 0.05, 0.1, 'square'); setTimeout(() => this.blip(1180, 0.05, 0.1, 'square'), 90); }

  /** Continuous engine voice; call setEngine(rpm01, load) every frame, stopEngine() on exit. */
  startEngine() {
    if (!this.ctx || this._engine) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 28;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0.0;
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
    o.start(); o2.start();
    this._engine = { o, o2, f, g };
  }
  setEngine(rpm, on) {
    if (!this._engine) return;
    const t = this.ctx.currentTime;
    const fr = 50 + rpm * 165;
    this._engine.o.frequency.setTargetAtTime(fr, t, 0.06);
    this._engine.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.06);
    this._engine.f.frequency.setTargetAtTime(380 + rpm * 1500, t, 0.08);
    this._engine.g.gain.setTargetAtTime(on ? 0.05 + rpm * 0.075 : 0, t, 0.09);
  }
  stopEngine() {
    if (!this._engine) return;
    const e = this._engine; this._engine = null;
    e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    setTimeout(() => { try { e.o.stop(); e.o2.stop(); } catch { /* already stopped */ } }, 300);
  }

  /** Police siren voice; audible when any unit is near. setSiren(rate) with distance falloff. */
  setSiren(level) {
    if (!this.ctx) return;
    if (level > 0.02 && !this._siren) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'triangle';
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.55;
      const lg = ctx.createGain(); lg.gain.value = 190;
      lfo.connect(lg); lg.connect(o.frequency);
      o.frequency.value = 760;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(this.master);
      o.start(); lfo.start();
      this._siren = { o, lfo, g };
    }
    if (this._siren) {
      this._siren.g.gain.setTargetAtTime(level * 0.055, this.ctx.currentTime, 0.15);
      if (level <= 0.02) {
        const s = this._siren; this._siren = null;
        setTimeout(() => { try { s.o.stop(); s.lfo.stop(); } catch { /* done */ } }, 400);
      }
    }
  }

  // ---- Synthwave loop: 8 bars of A-minor at 96 BPM, scheduled a step ahead. ----
  startMusic() {
    if (!this.ctx || this._musicTimer) return;
    const bassLine = [55, 0, 55, 55, 0, 55, 0, 55, 65.4, 0, 65.4, 65.4, 0, 65.4, 0, 0,
      49, 0, 49, 49, 0, 49, 0, 49, 58.3, 0, 58.3, 0, 73.4, 0, 82.4, 0];
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [130.8, 164.8, 196], [196, 246.9, 293.7]];
    const stepDur = 60 / 96 / 2; // eighth notes
    this._step = 0;
    const tick = () => {
      if (!this.ctx) return;
      const s = this._step;
      const b = bassLine[s % bassLine.length];
      if (b) this.blip(b, stepDur * 0.95, 0.30, 'sawtooth', null, this.musicGain);
      if (s % 16 === 0) {
        const ch = chords[(s / 16 | 0) % chords.length];
        for (const f of ch) this.blip(f, stepDur * 14, 0.05, 'triangle', null, this.musicGain);
      }
      if (s % 4 === 2) this.noise(0.05, 0.05, 6000, 0.5, 'highpass'); // hat (routed via master, quiet)
      if (s % 8 === 0) this.blip(120, 0.12, 0.16, 'sine', 40, this.musicGain); // kick
      this._step++;
    };
    tick();
    this._musicTimer = setInterval(tick, stepDur * 1000);
  }
  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }
}
