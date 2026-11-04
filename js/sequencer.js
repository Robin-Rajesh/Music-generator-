// Lookahead scheduler. A shared beat clock drives every ring, so rings with
// different step counts / lengths stay phase-locked (true polyrhythm) even
// while the tempo changes.

const LOOKAHEAD = 0.12; // seconds scheduled ahead
const TICK_MS = 25;

export class Sequencer {
  constructor(engine, getState, { onStep, onBar }) {
    this.engine = engine;
    this.getState = getState;
    this.onStep = onStep;
    this.onBar = onBar;
    this.playing = false;
    this.cursors = [];
    this.anchorTime = 0;
    this.anchorBeat = 0;
    this.bpm = 120;
    this.lastBar = -1;
    this._timer = null;
  }

  beatAt(t) { return this.anchorBeat + ((t - this.anchorTime) * this.bpm) / 60; }
  timeAt(b) { return this.anchorTime + ((b - this.anchorBeat) * 60) / this.bpm; }
  /** Current musical position in beats (what you are hearing now). */
  get beat() { return this.playing ? Math.max(0, this.beatAt(this.engine.now)) : this._pausedBeat || 0; }

  start() {
    const state = this.getState();
    this.bpm = state.bpm;
    this.anchorTime = this.engine.now + 0.06;
    this.anchorBeat = 0;
    this.lastBar = -1;
    this.cursors = state.rings.map(() => ({ k: 0, lastBeat: -1 }));
    this.playing = true;
    this._tick();
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    this._pausedBeat = 0;
    this.playing = false;
    clearInterval(this._timer);
    this._timer = null;
  }

  setBpm(bpm) {
    if (this.playing) {
      const now = this.engine.now;
      this.anchorBeat = this.beatAt(now);
      this.anchorTime = now;
    }
    this.bpm = bpm;
  }

  /** Call after a ring's steps / length change so it re-aligns without double hits. */
  resync(i) {
    if (!this.playing) return;
    const ring = this.getState().rings[i];
    const stepBeats = (ring.bars * 4) / ring.steps;
    const c = this.cursors[i];
    const from = Math.max(c.lastBeat, this.beatAt(this.engine.now));
    c.k = Math.floor(from / stepBeats + 1e-6) + 1;
  }

  _tick() {
    const state = this.getState();
    const horizon = this.engine.now + LOOKAHEAD;
    const anySolo = state.rings.some((r) => r.solo);

    // bar callbacks (used by auto-evolve)
    const bar = Math.floor(this.beatAt(horizon) / 4);
    if (bar !== this.lastBar && bar >= 0) {
      this.lastBar = bar;
      this.onBar && this.onBar(bar, this.timeAt(bar * 4));
    }

    state.rings.forEach((ring, i) => {
      const c = this.cursors[i];
      const stepBeats = (ring.bars * 4) / ring.steps;
      const stepSec = (stepBeats * 60) / this.bpm;
      let guard = 0;
      while (guard++ < 64) {
        const beat = c.k * stepBeats;
        let t = this.timeAt(beat);
        if (t >= horizon) break;
        const step = c.k % ring.steps;
        c.lastBeat = beat;
        c.k++;
        // swing every other step on even grids
        if (state.swing > 0 && ring.steps % 2 === 0 && step % 2 === 1) t += state.swing * stepSec * 0.5;
        const audible = !ring.mute && (!anySolo || ring.solo);
        const mask = ring.notes[step];
        if (!mask) continue;
        let dur = stepSec;
        if (ring.voice === 'pad' || ring.voice === 'bass') {
          // hold until the next note on this ring
          let gap = 1;
          while (gap < ring.steps && !ring.notes[(step + gap) % ring.steps]) gap++;
          dur = gap * stepSec * (ring.voice === 'bass' ? 0.9 : 1);
        }
        this.onStep(i, step, mask, t, dur, audible);
      }
    });
  }
}
