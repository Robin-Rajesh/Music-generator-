// Canvas renderer + hit-testing for the orbit rings.
// Look: flat ink dots on warm black, hairline rings, a clock-dial bezel, one orange hub.

const TAU = Math.PI * 2;
const INK = { bg: '#0f0e0c', text: '#f1ead9', line: '#2a2722', line2: '#3d3830', muted: '#8b8476', accent: '#ff5b14' };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
const CREAM = hexToRgb(INK.text);

export class Visualizer {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.particles = [];
    this.ripples = [];
    this.flashes = new Map(); // "ring:step:row" -> trigger time (performance.now)
    this.ringPulse = [];
    this.hover = null;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.energy = 0;
    this.kick = 0;
    this.colorCache = new Map();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  rgb(hex) {
    if (!this.colorCache.has(hex)) this.colorCache.set(hex, hexToRgb(hex));
    return this.colorCache.get(hex);
  }

  resize() {
    const el = this.canvas.parentElement;
    const rect = el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    this.dpr = dpr;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.layout();
  }

  layout() {
    const n = this.app.state.rings.length;
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    const half = Math.min(this.w, this.h) / 2;
    this.R = Math.max(80, half * (half < 260 ? 0.9 : 0.84)); // leave room for the dial bezel
    this.hub = this.R * 0.2;
    const gap = this.R * 0.022;
    const band = (this.R - this.hub - gap * n) / n;
    this.gap = gap;
    this.geom = [];
    for (let i = 0; i < n; i++) {
      const inner = this.hub + gap + i * (band + gap);
      this.geom.push({ inner, outer: inner + band, band, mid: inner + band / 2 });
    }
  }

  stepAngle(step, steps) { return (step / steps) * TAU - Math.PI / 2; }

  cellPos(ringIdx, step, row) {
    const ring = this.app.state.rings[ringIdx];
    const g = this.geom[ringIdx];
    const a = this.stepAngle(step, ring.steps);
    const r = g.inner + ((row + 0.5) / ring.rows) * g.band;
    return { x: this.cx + Math.cos(a) * r, y: this.cy + Math.sin(a) * r, a, r };
  }

  /** Like hitTest but locked to one ring (pitch clamps at the ring edges). */
  cellInRing(x, y, i) {
    const ring = this.app.state.rings[i];
    const g = this.geom[i];
    const dx = x - this.cx, dy = y - this.cy;
    const r = Math.hypot(dx, dy);
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    a = ((a % TAU) + TAU) % TAU;
    const step = Math.round((a / TAU) * ring.steps) % ring.steps;
    const row = Math.max(0, Math.min(ring.rows - 1, Math.floor(((r - g.inner) / g.band) * ring.rows)));
    return { ring: i, step, row };
  }

  /** Map a canvas point to { hub } | { ring, step, row } | null. */
  hitTest(x, y) {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const r = Math.hypot(dx, dy);
    if (r < this.hub) return { hub: true };
    for (let i = 0; i < this.geom.length; i++) {
      const g = this.geom[i];
      const pad = this.gap / 2;
      if (r >= g.inner - pad && r <= g.outer + pad) return this.cellInRing(x, y, i);
    }
    return null;
  }

  trigger(ringIdx, step, mask) {
    const ring = this.app.state.rings[ringIdx];
    const now = performance.now();
    this.ringPulse[ringIdx] = now;
    for (let row = 0; row < ring.rows; row++) {
      if (!(mask & (1 << row))) continue;
      this.flashes.set(`${ringIdx}:${step}:${row}`, now);
      if (ring.voice === 'drums' && row === 0) this.kick = 1;
      if (this.reduced) continue;
      const p = this.cellPos(ringIdx, step, row);
      const count = ring.voice === 'drums' ? (row === 0 ? 10 : 4) : ring.voice === 'pad' ? 14 : 6;
      for (let k = 0; k < count; k++) {
        // shards fly outward from the centre, like sparks off a spinning wheel
        const ang = p.a + (Math.random() - 0.5) * 1.1;
        const sp = 0.8 + Math.random() * 2.2;
        this.particles.push({
          x: p.x, y: p.y,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          life: 1, decay: 0.018 + Math.random() * 0.02,
          size: 1.5 + Math.random() * 2.5,
          rot: Math.random() * TAU,
          color: ring.color,
        });
      }
      this.ripples.push({ x: p.x, y: p.y, r: 3, life: 1, color: ring.color, big: ring.voice === 'drums' && row === 0 });
    }
    if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
    if (this.flashes.size > 300) {
      for (const [k, t0] of this.flashes) if (now - t0 > 1500) this.flashes.delete(k);
    }
  }

  draw(beat, playing) {
    const ctx = this.ctx;
    const { state, selected } = this.app;
    const now = performance.now();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const lvl = this.app.engine.level();
    this.energy += (lvl - this.energy) * 0.15;
    this.kick *= 0.9;

    this._drawDial(ctx, beat, playing);
    state.rings.forEach((ring, i) => this._drawRing(ctx, ring, i, beat, playing, i === selected, now));
    this._drawFx(ctx);
    this._drawHover(ctx);
    this._drawHub(ctx, playing, beat);
  }

  /** Watch-style bezel: 64 ticks, beat numerals, and a beat pointer. */
  _drawDial(ctx, beat, playing) {
    const { cx, cy, R } = this;
    const r0 = R + Math.max(10, R * 0.045);
    const ticks = 64;
    for (let k = 0; k < ticks; k++) {
      const a = (k / ticks) * TAU - Math.PI / 2;
      const major = k % 16 === 0;
      const mid = k % 4 === 0;
      const len = major ? 12 : mid ? 7 : 3.5;
      ctx.strokeStyle = major ? INK.text : mid ? INK.muted : INK.line2;
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      ctx.stroke();
    }
    if (R > 150) {
      ctx.font = `500 ${Math.round(Math.max(10, R * 0.03))}px "JetBrains Mono", monospace`;
      ctx.fillStyle = INK.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let b = 0; b < 4; b++) {
        const a = (b / 4) * TAU - Math.PI / 2 + 0.09;
        const rr = r0 + 22;
        ctx.fillText(String(b + 1), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
    }
    if (playing) {
      // a small orange pointer marks the beat within the bar
      const a = ((beat % 4) / 4) * TAU - Math.PI / 2;
      ctx.fillStyle = INK.accent;
      ctx.beginPath();
      const tip = r0 - 2;
      ctx.moveTo(cx + Math.cos(a) * tip, cy + Math.sin(a) * tip);
      ctx.lineTo(cx + Math.cos(a - 0.025) * (tip + 14), cy + Math.sin(a - 0.025) * (tip + 14));
      ctx.lineTo(cx + Math.cos(a + 0.025) * (tip + 14), cy + Math.sin(a + 0.025) * (tip + 14));
      ctx.closePath();
      ctx.fill();
    }
  }

  _drawRing(ctx, ring, i, beat, playing, isSel, now) {
    const g = this.geom[i];
    const rgb = this.rgb(ring.color);
    const anySolo = this.app.state.rings.some((r) => r.solo);
    const dim = ring.mute || (anySolo && !ring.solo) ? 0.3 : 1;
    const pulse = this.ringPulse[i] ? Math.exp(-(now - this.ringPulse[i]) / 160) : 0;

    // band fill — a flat tint, a little stronger when selected or just hit
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, g.mid, 0, TAU);
    ctx.lineWidth = g.band;
    ctx.strokeStyle = rgba(rgb, ((isSel ? 0.05 : 0.022) + pulse * 0.035) * dim);
    ctx.stroke();

    // hairline edges
    ctx.lineWidth = 1;
    ctx.strokeStyle = isSel ? rgba(rgb, 0.7 * dim) : INK.line2;
    ctx.beginPath(); ctx.arc(this.cx, this.cy, g.inner, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(this.cx, this.cy, g.outer, 0, TAU); ctx.stroke();

    // pitch-lane guides on the selected / hovered ring
    if (isSel || (this.hover && this.hover.ring === i)) {
      ctx.strokeStyle = rgba(rgb, 0.12);
      ctx.setLineDash([1, 5]);
      for (let r = 1; r < ring.rows; r++) {
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, g.inner + (r / ring.rows) * g.band, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // step markers: tiny ticks on the inner edge, longer on beats
    const stepsPerBeat = ring.steps / (ring.bars * 4);
    for (let s = 0; s < ring.steps; s++) {
      const a = this.stepAngle(s, ring.steps);
      const onBeat = Number.isInteger(s / stepsPerBeat) || stepsPerBeat < 1;
      const c = Math.cos(a), sn = Math.sin(a);
      const len = onBeat ? g.band * 0.22 : g.band * 0.1;
      ctx.strokeStyle = onBeat ? rgba(CREAM, 0.35 * dim) : rgba(CREAM, 0.14 * dim);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.cx + c * g.inner, this.cy + sn * g.inner);
      ctx.lineTo(this.cx + c * (g.inner + len), this.cy + sn * (g.inner + len));
      ctx.stroke();
    }

    // playhead: a flat sector the width of one step, plus a crisp leading edge
    const rev = ring.bars * 4;
    const phase = (((beat % rev) + rev) % rev) / rev;
    const pa = phase * TAU - Math.PI / 2;
    if (playing) {
      const w = Math.min(TAU / ring.steps, 0.32);
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, g.outer, pa - w, pa);
      ctx.arc(this.cx, this.cy, g.inner, pa, pa - w, true);
      ctx.closePath();
      ctx.fillStyle = rgba(rgb, 0.13 * dim);
      ctx.fill();
      const c = Math.cos(pa), sn = Math.sin(pa);
      ctx.beginPath();
      ctx.moveTo(this.cx + c * g.inner, this.cy + sn * g.inner);
      ctx.lineTo(this.cx + c * g.outer, this.cy + sn * g.outer);
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(rgb, dim);
      ctx.stroke();
    }

    // notes — flat ink dots with a dark keyline, so they read like stickers
    const laneH = g.band / ring.rows;
    const baseR = Math.max(3.2, Math.min(laneH * (ring.voice === 'drums' ? 0.4 : 0.68), (TAU * g.mid) / ring.steps * 0.3));
    for (let s = 0; s < ring.steps; s++) {
      const mask = ring.notes[s];
      if (!mask) continue;
      for (let row = 0; row < ring.rows; row++) {
        if (!(mask & (1 << row))) continue;
        const p = this.cellPos(i, s, row);
        const ft = this.flashes.get(`${i}:${s}:${row}`);
        const f = ft ? Math.exp(-(now - ft) / 200) : 0;
        const r = baseR * (1 + f * 0.8);
        ctx.beginPath();
        if (ring.voice === 'drums') this._drumShape(ctx, row, p.x, p.y, r, p.a);
        else ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fillStyle = f > 0.15 ? INK.text : rgba(rgb, dim);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = INK.bg;
        ctx.stroke();
      }
    }
  }

  _drumShape(ctx, row, x, y, r, a) {
    // kick = circle, snare = diamond, clap = triangle, hat = small square
    if (row === 0) { ctx.arc(x, y, r * 1.1, 0, TAU); return; }
    const sides = row === 2 ? 3 : 4;
    const rr = row === 3 ? r * 0.95 : r * 1.3;
    const rot = row === 3 ? a + Math.PI / 4 : a;
    for (let k = 0; k < sides; k++) {
      const t = rot + (k / sides) * TAU;
      const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  _drawFx(ctx) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += rp.big ? 2.4 : 1.3;
      rp.life -= rp.big ? 0.03 : 0.04;
      if (rp.life <= 0) { this.ripples.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, TAU);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(this.rgb(rp.color), rp.life * 0.8);
      ctx.stroke();
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.95; p.vy *= 0.95;
      p.rot += 0.12;
      p.life -= p.decay;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      const s = p.size * (0.4 + p.life * 0.6);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = rgba(this.rgb(p.color), Math.min(1, p.life * 1.3));
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }

  _drawHover(ctx) {
    const h = this.hover;
    if (!h || h.hub) return;
    const ring = this.app.state.rings[h.ring];
    const p = this.cellPos(h.ring, h.step, h.row);
    const has = ring.notes[h.step] & (1 << h.row);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(7, (this.geom[h.ring].band / ring.rows) * 0.8), 0, TAU);
    ctx.lineWidth = 1.5;
    ctx.setLineDash(has ? [] : [2, 3]);
    ctx.strokeStyle = has ? INK.text : rgba(this.rgb(ring.color), 1);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawHub(ctx, playing, beat) {
    const { cx, cy, hub } = this;
    const spec = this.app.engine.spectrum();
    // spectrum as a ring of cream hairlines around the hub
    if (spec) {
      const bins = 72;
      ctx.strokeStyle = rgba(CREAM, 0.55);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let b = 0; b < bins; b++) {
        const v = spec[Math.floor(2 + b * 2.8)] / 255;
        const a = (b / bins) * TAU - Math.PI / 2;
        const r1 = hub * 0.84;
        const r2 = r1 + 2 + v * v * hub * 0.5;
        ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      }
      ctx.stroke();
    }
    const bump = playing ? this.kick * 0.06 : 0;
    const rr = hub * (0.74 + bump);
    // orange disc with a pressed-button bottom edge
    ctx.beginPath();
    ctx.arc(cx, cy + 2, rr, 0, TAU);
    ctx.fillStyle = '#a63a0a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, TAU);
    ctx.fillStyle = this.hover && this.hover.hub ? '#ff7336' : INK.accent;
    ctx.fill();

    // play / pause glyph
    const s = hub * 0.22;
    ctx.fillStyle = '#160700';
    ctx.beginPath();
    if (playing) {
      ctx.rect(cx - s * 0.8, cy - s, s * 0.55, s * 2);
      ctx.rect(cx + s * 0.25, cy - s, s * 0.55, s * 2);
    } else {
      ctx.moveTo(cx - s * 0.55, cy - s);
      ctx.lineTo(cx + s * 1.05, cy);
      ctx.lineTo(cx - s * 0.55, cy + s);
      ctx.closePath();
    }
    ctx.fill();

    if (playing && hub > 36) {
      const bar = Math.floor(beat / 4) + 1;
      const bt = Math.floor(beat % 4) + 1;
      ctx.font = `600 ${Math.max(9, Math.round(hub * 0.12))}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(22,7,0,0.7)';
      ctx.fillText(`${String(bar).padStart(3, '0')}.${bt}`, cx, cy + hub * 0.48);
    }
  }
}
