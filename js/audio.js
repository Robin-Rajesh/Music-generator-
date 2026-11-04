// Web Audio engine: hand-built synth voices, FX buses, analyser and recorder tap.
import { midiToFreq } from './music.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ringOuts = [];
  }

  get ready() { return !!this.ctx; }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  init(ringCount, sends) {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));

    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.8;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);

    this.recDest = ctx.createMediaStreamDestination ? ctx.createMediaStreamDestination() : null;

    // FX: reverb + tempo-synced ping-pong delay
    this.reverbIn = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this._impulse(3.4, 2.6);
    this.reverbIn.connect(this.convolver).connect(this.comp);

    this.delayIn = ctx.createGain();
    const dl = (this.delayL = ctx.createDelay(2));
    const dr = (this.delayR = ctx.createDelay(2));
    const fb = (this.delayFb = ctx.createGain());
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = 3200;
    const merger = ctx.createChannelMerger(2);
    this.delayIn.connect(tone).connect(dl);
    dl.connect(dr); dr.connect(fb).connect(dl);
    dl.connect(merger, 0, 0); dr.connect(merger, 0, 1);
    merger.connect(this.comp);
    merger.connect(this.reverbIn);

    this.comp.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    if (this.recDest) this.master.connect(this.recDest);

    for (let i = 0; i < ringCount; i++) {
      const out = ctx.createGain();
      const rs = ctx.createGain();
      const ds = ctx.createGain();
      rs.gain.value = sends[i] ?? 0.3;
      ds.gain.value = sends[i] ?? 0.3;
      out.connect(this.comp);
      out.connect(rs).connect(this.reverbIn);
      out.connect(ds).connect(this.delayIn);
      this.ringOuts.push(out);
    }

    // shared noise buffer for percussion
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  }

  resume() { return this.ctx && this.ctx.state !== 'running' ? this.ctx.resume() : Promise.resolve(); }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  setMix({ reverb, delay, master, bpm }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (reverb != null) this.reverbIn.gain.setTargetAtTime(reverb * 0.9, t, 0.05);
    if (delay != null) this.delayIn.gain.setTargetAtTime(delay * 0.7, t, 0.05);
    if (master != null) this.master.gain.setTargetAtTime(master, t, 0.03);
    if (bpm) {
      const beat = 60 / bpm;
      this.delayL.delayTime.setTargetAtTime(beat * 0.75, t, 0.05); // dotted 8th
      this.delayR.delayTime.setTargetAtTime(beat * 0.75, t, 0.05);
    }
  }

  setRingGain(i, v) {
    if (!this.ctx) return;
    this.ringOuts[i].gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Play one note. `pitch` is a MIDI note for melodic voices, a drum index for drums. */
  play(voice, ringIdx, pitch, t, dur, vel = 1) {
    if (!this.ctx) return;
    const out = this.ringOuts[ringIdx];
    t = Math.max(t, this.ctx.currentTime);
    switch (voice) {
      case 'drums': return [this._kick, this._snare, this._clap, this._hat][pitch].call(this, t, out, vel);
      case 'bass': return this._bass(t, out, pitch, dur, vel);
      case 'pluck': return this._pluck(t, out, pitch, dur, vel);
      case 'bell': return this._bell(t, out, pitch, dur, vel);
      case 'pad': return this._pad(t, out, pitch, dur, vel);
    }
  }

  // ---------- helpers ----------
  _env(g, t, peak, attack, decayEnd) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, decayEnd);
  }
  _noiseSrc(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
    return src;
  }

  // ---------- drums ----------
  _kick(t, out, vel) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    this._env(g, t, 1.1 * vel, 0.003, t + 0.48);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.5);
    // click
    const n = this._noiseSrc(t, 0.02);
    const ng = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 2500;
    this._env(ng, t, 0.25 * vel, 0.001, t + 0.015);
    n.connect(f).connect(ng).connect(out);
  }
  _snare(t, out, vel) {
    const ctx = this.ctx;
    const n = this._noiseSrc(t, 0.25);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 1400;
    const g = ctx.createGain();
    this._env(g, t, 0.55 * vel, 0.002, t + 0.2);
    n.connect(f).connect(g).connect(out);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.1);
    this._env(og, t, 0.5 * vel, 0.002, t + 0.12);
    o.connect(og).connect(out);
    o.start(t); o.stop(t + 0.15);
  }
  _clap(t, out, vel) {
    const ctx = this.ctx;
    const n = this._noiseSrc(t, 0.35);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1150; f.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.011;
      g.gain.setValueAtTime(0.7 * vel, s);
      g.gain.exponentialRampToValueAtTime(0.08, s + 0.009);
    }
    g.gain.setValueAtTime(0.6 * vel, t + 0.034);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    n.connect(f).connect(g).connect(out);
  }
  _hat(t, out, vel) {
    const ctx = this.ctx;
    const n = this._noiseSrc(t, 0.1);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7800;
    const g = ctx.createGain();
    this._env(g, t, 0.32 * vel, 0.001, t + 0.06 + Math.random() * 0.02);
    n.connect(f).connect(g).connect(out);
  }

  // ---------- melodic ----------
  _bass(t, out, midi, dur, vel) {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const end = t + Math.min(Math.max(dur, 0.12), 1.2);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f / 2;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 7;
    flt.frequency.setValueAtTime(f * 9, t);
    flt.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * vel, t + 0.006);
    g.gain.setTargetAtTime(0.35 * vel, t + 0.05, 0.1);
    g.gain.setTargetAtTime(0.0001, end, 0.04);
    const sg = ctx.createGain(); sg.gain.value = 0.6;
    o1.connect(flt); o2.connect(sg).connect(flt);
    flt.connect(g).connect(out);
    [o1, o2].forEach((o) => { o.start(t); o.stop(end + 0.3); });
  }
  _pluck(t, out, midi, dur, vel) {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const g = ctx.createGain();
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 2;
    flt.frequency.setValueAtTime(Math.min(f * 12, 12000), t);
    flt.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.35);
    this._env(g, t, 0.28 * vel, 0.003, t + 0.9);
    const osc = [];
    for (const [type, det] of [['sawtooth', -7], ['sawtooth', 7], ['triangle', 0]]) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = f; o.detune.value = det;
      o.connect(flt);
      osc.push(o);
    }
    flt.connect(g).connect(out);
    osc.forEach((o) => { o.start(t); o.stop(t + 1); });
  }
  _bell(t, out, midi, dur, vel) {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const len = 2.4;
    const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = f * 3.5;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 5, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.15, t + 1.2);
    mod.connect(mg).connect(car.frequency);
    const shimmer = ctx.createOscillator(); shimmer.type = 'sine'; shimmer.frequency.value = f * 2.001;
    const sg = ctx.createGain();
    this._env(sg, t, 0.05 * vel, 0.002, t + 0.9);
    shimmer.connect(sg).connect(out);
    const g = ctx.createGain();
    this._env(g, t, 0.2 * vel, 0.002, t + len);
    car.connect(g).connect(out);
    [car, mod, shimmer].forEach((o) => { o.start(t); o.stop(t + len + 0.05); });
  }
  /** `midi` is an array of chord tones for pads. */
  _pad(t, out, chord, dur, vel) {
    const ctx = this.ctx;
    const hold = Math.min(Math.max(dur, 0.5), 12);
    const rel = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09 * vel, t + Math.min(0.6, hold * 0.4));
    g.gain.setValueAtTime(0.09 * vel, t + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + hold + rel);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 0.8;
    flt.frequency.setValueAtTime(500, t);
    flt.frequency.linearRampToValueAtTime(1600, t + hold * 0.6);
    flt.frequency.linearRampToValueAtTime(700, t + hold + rel);
    flt.connect(g).connect(out);
    const notes = Array.isArray(chord) ? chord : [chord];
    for (const m of notes) {
      for (const det of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToFreq(m);
        o.detune.value = det + (Math.random() * 4 - 2);
        o.connect(flt);
        o.start(t); o.stop(t + hold + rel + 0.05);
      }
    }
  }

  /** Overall loudness 0..1 for visuals. */
  level() {
    if (!this.ctx) return 0;
    this.analyser.getByteTimeDomainData(this.timeData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i += 4) {
      const v = (this.timeData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / (this.timeData.length / 4)) * 3);
  }
  spectrum() {
    if (!this.ctx) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }
}
