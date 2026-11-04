// Canvas renderer + hit-testing for the orbit rings.

const TAU = Math.PI * 2;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

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
    this.R = Math.max(80, (Math.min(this.w, this.h) / 2) * 0.95);
    this.hub = this.R * 0.2;
    const gap = this.R * 0.018;
    const band = (this.R - this.hub - gap * n) / n;
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
      const pad = (this.R * 0.018) / 2;
      if (r >= g.inner - pad && r <= g.outer + pad) {
        const ring = this.app.state.rings[i];
        let a = Math.atan2(dy, dx) + Math.PI / 2;
        a = ((a % TAU) + TAU) % TAU;
        const step = Math.round((a / TAU) * ring.steps) % ring.steps;
        const row = Math.max(0, Math.min(ring.rows - 1, Math.floor(((r - g.inner) / g.band) * ring.rows)));
        return { ring: i, step, row };
      }
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
      if (this.reduced) continue;
      const p = this.cellPos(ringIdx, step, row);
      const count = ring.voice === 'drums' ? (row === 0 ? 14 : 6) : ring.voice === 'pad' ? 22 : 9;
      for (let k = 0; k < count; k++) {
        const ang = p.a + (Math.random() - 0.5) * 2.2 + (ring.voice === 'pad' ? Math.random() * TAU : 0);
        const sp = (ring.voice === 'pad' ? 0.3 : 0.6) + Math.random() * 1.6;
        this.particles.push({
          x: p.x, y: p.y,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          life: 1, decay: 0.012 + Math.random() * 0.02,
          size: 1 + Math.random() * 2.2,
          color: ring.color,
        });
      }
      this.ripples.push({ x: p.x, y: p.y, r: 4, life: 1, color: ring.color, big: ring.voice === 'drums' && row === 0 });
    }
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
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

    // ambient glow that breathes with the music
    const glow = ctx.createRadialGradient(this.cx, this.cy, this.hub * 0.5, this.cx, this.cy, this.R * 1.25);
    glow.addColorStop(0, `rgba(120,90,255,${0.1 + this.energy * 0.25})`);
    glow.addColorStop(0.5, `rgba(40,120,255,${0.04 + this.energy * 0.08})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.w, this.h);

    state.rings.forEach((ring, i) => this._drawRing(ctx, ring, i, beat, playing, i === selected, now));
    this._drawFx(ctx);
    this._drawHover(ctx);
    this._drawHub(ctx, playing, beat);
  }

  _drawRing(ctx, ring, i, beat, playing, isSel, now) {
    const g = this.geom[i];
    const rgb = this.rgb(ring.color);
    const anySolo = this.app.state.rings.some((r) => r.solo);
    const dim = ring.mute || (anySolo && !ring.solo) ? 0.35 : 1;
    const pulse = this.ringPulse[i] ? Math.exp(-(now - this.ringPulse[i]) / 180) : 0;

    // band
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, g.mid, 0, TAU);
    ctx.lineWidth = g.band;
    ctx.strokeStyle = rgba(rgb, (isSel ? 0.085 : 0.035) + pulse * 0.05 * dim);
    ctx.stroke();

    // edges
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(rgb, (isSel ? 0.35 : 0.14) * dim);
    ctx.beginPath(); ctx.arc(this.cx, this.cy, g.inner, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(this.cx, this.cy, g.outer, 0, TAU); ctx.stroke();

    // pitch-lane guides on the selected / hovered ring
    if (isSel || (this.hover && this.hover.ring === i)) {
      ctx.strokeStyle = rgba(rgb, 0.07);
      for (let r = 1; r < ring.rows; r++) {
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, g.inner + (r / ring.rows) * g.band, 0, TAU);
        ctx.stroke();
      }
    }

    // step spokes
    const stepsPerBeat = ring.steps / (ring.bars * 4);
    for (let s = 0; s < ring.steps; s++) {
      const a = this.stepAngle(s, ring.steps);
      const onBeat = Number.isInteger(s / stepsPerBeat) || stepsPerBeat < 1;
      const c = Math.cos(a), sn = Math.sin(a);
      ctx.strokeStyle = rgba(rgb, (onBeat ? 0.22 : 0.09) * dim);
      ctx.lineWidth = onBeat ? 1.2 : 1;
      ctx.beginPath();
      ctx.moveTo(this.cx + c * (g.inner + 1), this.cy + sn * (g.inner + 1));
      ctx.lineTo(this.cx + c * (g.inner + g.band * 0.14), this.cy + sn * (g.inner + g.band * 0.14));
      ctx.moveTo(this.cx + c * (g.outer - g.band * 0.14), this.cy + sn * (g.outer - g.band * 0.14));
      ctx.lineTo(this.cx + c * (g.outer - 1), this.cy + sn * (g.outer - 1));
      ctx.stroke();
    }

    // playhead with comet trail
    const rev = ring.bars * 4;
    const phase = (((beat % rev) + rev) % rev) / rev;
    const pa = phase * TAU - Math.PI / 2;
    if (playing) {
      const trail = Math.min(1.4, TAU / ring.steps * 2.5);
      const segs = 18;
      for (let k = 0; k < segs; k++) {
        const a0 = pa - trail * (k + 1) / segs;
        const a1 = pa - trail * k / segs;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, g.mid, a0, a1);
        ctx.lineWidth = g.band;
        ctx.strokeStyle = rgba(rgb, 0.16 * (1 - k / segs) * dim);
        ctx.stroke();
      }
      const c = Math.cos(pa), sn = Math.sin(pa);
      ctx.beginPath();
      ctx.moveTo(this.cx + c * g.inner, this.cy + sn * g.inner);
      ctx.lineTo(this.cx + c * g.outer, this.cy + sn * g.outer);
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(rgb, 0.9 * dim);
      ctx.stroke();
    }

    // notes
    const laneH = g.band / ring.rows;
    const baseR = Math.max(2.5, Math.min(laneH * (ring.voice === 'drums' ? 0.36 : 0.45), (TAU * g.mid) / ring.steps * 0.28));
    for (let s = 0; s < ring.steps; s++) {
      const mask = ring.notes[s];
      if (!mask) continue;
      for (let row = 0; row < ring.rows; row++) {
        if (!(mask & (1 << row))) continue;
        const p = this.cellPos(i, s, row);
        const ft = this.flashes.get(`${i}:${s}:${row}`);
        const f = ft ? Math.exp(-(now - ft) / 220) : 0;
        const r = baseR * (1 + f * 0.9);
        // halo
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (2.2 + f * 2.5), 0, TAU);
        ctx.fillStyle = rgba(rgb, (0.08 + f * 0.3) * dim);
        ctx.fill();
        // core
        ctx.beginPath();
        if (ring.voice === 'drums') this._drumShape(ctx, row, p.x, p.y, r, p.a);
        else ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fillStyle = f > 0.05 ? `rgba(255,255,255,${0.85 * dim})` : rgba(rgb, 0.95 * dim);
        ctx.fill();
        if (f > 0.05) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = rgba(rgb, dim);
          ctx.stroke();
        }
      }
    }
  }

  _drumShape(ctx, row, x, y, r, a) {
    // kick = circle, snare = diamond, clap = triangle, hat = small square
    if (row === 0) { ctx.arc(x, y, r * 1.1, 0, TAU); return; }
    const sides = row === 1 ? 4 : row === 2 ? 3 : 4;
    const rr = row === 3 ? r * 0.85 : r * 1.25;
    const rot = row === 3 ? a + Math.PI / 4 : a;
    for (let k = 0; k < sides; k++) {
      const t = rot + (k / sides) * TAU;
      const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  _drawFx(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += rp.big ? 2.6 : 1.4;
      rp.life -= rp.big ? 0.025 : 0.035;
      if (rp.life <= 0) { this.ripples.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, TAU);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(this.rgb(rp.color), rp.life * 0.6);
      ctx.stroke();
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.97; p.vy *= 0.97;
      p.life -= p.decay;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, TAU);
      ctx.fillStyle = rgba(this.rgb(p.color), p.life * 0.9);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawHover(ctx) {
    const h = this.hover;
    if (!h || h.hub) return;
    const ring = this.app.state.rings[h.ring];
    const p = this.cellPos(h.ring, h.step, h.row);
    const has = ring.notes[h.step] & (1 << h.row);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(6, this.geom[h.ring].band / ring.rows * 0.7), 0, TAU);
    ctx.lineWidth = 1.5;
    ctx.setLineDash(has ? [] : [3, 3]);
    ctx.strokeStyle = has ? 'rgba(255,255,255,0.8)' : rgba(this.rgb(ring.color), 0.9);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawHub(ctx, playing, beat) {
    const { cx, cy, hub } = this;
    const spec = this.app.engine.spectrum();
    // spectrum crown
    if (spec) {
      const bins = 64;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let b = 0; b < bins; b++) {
        const v = spec[Math.floor(2 + b * 3.2)] / 255;
        const a = (b / bins) * TAU - Math.PI / 2;
        const len = v * hub * 0.55;
        const hue = 260 - (b / bins) * 110;
        ctx.strokeStyle = `hsla(${hue},95%,68%,${0.25 + v * 0.6})`;
        ctx.lineWidth = Math.max(1.5, (TAU * hub) / bins * 0.45);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * hub * 0.82, cy + Math.sin(a) * hub * 0.82);
        ctx.lineTo(cx + Math.cos(a) * (hub * 0.82 + len), cy + Math.sin(a) * (hub * 0.82 + len));
        ctx.stroke();
      }
      ctx.restore();
    }
    const beatPulse = playing ? Math.pow(1 - (beat % 1), 3) : 0;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, hub * 0.8);
    grad.addColorStop(0, `rgba(160,130,255,${0.35 + beatPulse * 0.3})`);
    grad.addColorStop(1, 'rgba(30,20,70,0.85)');
    ctx.beginPath();
    ctx.arc(cx, cy, hub * (0.76 + beatPulse * 0.03), 0, TAU);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.hover && this.hover.hub ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.18)';
    ctx.stroke();

    // play / pause glyph
    const s = hub * 0.26;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    if (playing) {
      ctx.roundRect ? ctx.roundRect(cx - s * 0.75, cy - s, s * 0.5, s * 2, 2) : ctx.rect(cx - s * 0.75, cy - s, s * 0.5, s * 2);
      ctx.roundRect ? ctx.roundRect(cx + s * 0.25, cy - s, s * 0.5, s * 2, 2) : ctx.rect(cx + s * 0.25, cy - s, s * 0.5, s * 2);
    } else {
      ctx.moveTo(cx - s * 0.6, cy - s);
      ctx.lineTo(cx + s * 1.0, cy);
      ctx.lineTo(cx - s * 0.6, cy + s);
      ctx.closePath();
    }
    ctx.fill();

    if (playing && hub > 40) {
      const bar = Math.floor(beat / 4) + 1;
      const bt = Math.floor(beat % 4) + 1;
      ctx.font = `600 ${Math.max(9, hub * 0.13)}px "Space Grotesk", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`${bar}.${bt}`, cx, cy + hub * 0.55);
    }
  }
}
