// App state, presets, and share-link encoding.
import { SCALE_NAMES } from './music.js';

export const RING_DEFS = [
  // inner → outer. `rows` = pitch lanes across the ring band (inner = low).
  { voice: 'pad', name: 'Pad', rows: 8, octave: 3, color: '#8a7cff', send: 0.55 },
  { voice: 'bass', name: 'Bass', rows: 8, octave: 1, color: '#ff5b14', send: 0.08 },
  { voice: 'drums', name: 'Drums', rows: 4, octave: 0, color: '#f5c518', send: 0.12 },
  { voice: 'pluck', name: 'Pluck', rows: 8, octave: 4, color: '#19c39c', send: 0.3 },
  { voice: 'bell', name: 'Bell', rows: 8, octave: 5, color: '#ff6fae', send: 0.6 },
];

export const DRUM_NAMES = ['Kick', 'Snare', 'Clap', 'Hat'];
export const BAR_OPTIONS = [0.5, 1, 2, 4];

export function makeRing(def, steps = 16, bars = 1) {
  return {
    ...def,
    steps,
    bars,
    vol: 0.8,
    mute: false,
    solo: false,
    notes: new Array(steps).fill(0),
  };
}

export function defaultState() {
  return {
    bpm: 104,
    root: 9, // A
    scale: 'Minor',
    swing: 0,
    reverb: 0.45,
    delay: 0.3,
    master: 0.85,
    rings: RING_DEFS.map((d) => makeRing(d, d.voice === 'pad' ? 4 : 16, d.voice === 'pad' ? 4 : 1)),
  };
}

/** Remap a ring's notes to a new step count, keeping notes at the same angle. */
export function resampleNotes(notes, newSteps) {
  const out = new Array(newSteps).fill(0);
  const old = notes.length;
  for (let i = 0; i < old; i++) {
    if (!notes[i]) continue;
    out[Math.round((i * newSteps) / old) % newSteps] |= notes[i];
  }
  return out;
}

// ---------- presets ----------
// Melodic lanes: one char per step, digit = pitch lane (0 low … 7 high), '.' = rest.
// Drums: one string per drum, 'x' = hit.
function mel(str) { return [...str].map((c) => (c === '.' ? 0 : 1 << Number(c))); }
function drums(kick, snare, clap, hat) {
  const len = Math.max(kick.length, snare.length, clap.length, hat.length);
  const n = new Array(len).fill(0);
  [kick, snare, clap, hat].forEach((p, row) => [...p].forEach((c, i) => { if (c === 'x') n[i] |= 1 << row; }));
  return n;
}

function preset(meta, rings) {
  const s = defaultState();
  Object.assign(s, meta);
  s.rings.forEach((r) => {
    const cfg = rings[r.voice];
    if (!cfg || !cfg.notes) { r.notes = new Array(r.steps).fill(0); return; }
    r.notes = cfg.notes;
    r.steps = cfg.notes.length;
    r.bars = cfg.bars;
    if (cfg.vol != null) r.vol = cfg.vol;
  });
  return s;
}

export const PRESETS = {
  'Neon Drift': () => preset({ bpm: 100, root: 9, scale: 'Minor', swing: 0.1, reverb: 0.45, delay: 0.35 }, {
    pad: { bars: 4, notes: mel('0534') },
    bass: { bars: 4, notes: mel('0..0..0.5..5..5.3..3..3.4..4..6.') },
    drums: { bars: 1, notes: drums('x.....x...x.....', '....x.......x...', '', '..x...x...x...xx') },
    pluck: { bars: 1, notes: mel('4.2.6.4.2.7.') },
    bell: { bars: 2, notes: mel('6..4.5.') },
  }),
  'Polyrhythm 3·4·5·7': () => preset({ bpm: 96, root: 2, scale: 'Dorian', swing: 0, reverb: 0.55, delay: 0.25 }, {
    pad: { bars: 4, notes: mel('0.3.') },
    bass: { bars: 1, notes: mel('0.4') },
    drums: { bars: 1, notes: drums('x...', '..x.', '', 'xxxx') },
    pluck: { bars: 1, notes: mel('24675') },
    bell: { bars: 1, notes: mel('7.5.4.2') },
  }),
  'Lo-fi Sunday': () => preset({ bpm: 82, root: 5, scale: 'Major', swing: 0.45, reverb: 0.5, delay: 0.2 }, {
    pad: { bars: 4, notes: mel('3254') },
    bass: { bars: 4, notes: mel('3.....3.2.....2.5.....5.4...4.4.') },
    drums: { bars: 1, notes: drums('x.......x.x.....', '....x.......x...', '', 'x.x.x.x.x.x.x.xx') },
    pluck: { bars: 2, notes: mel('4...2.....6.5.......4...3.......') },
    bell: { bars: 4, notes: mel('7....5...') },
  }),
  'Gamelan Garden': () => preset({ bpm: 92, root: 4, scale: 'Hirajoshi', swing: 0, reverb: 0.65, delay: 0.4 }, {
    pad: { bars: 4, notes: mel('0...') },
    bass: { bars: 2, notes: mel('0.....3.....') },
    drums: { bars: 1, notes: drums('x.....x.....', '', '...x.....x..', 'x.xx.xx.xx.x') },
    pluck: { bars: 1, notes: mel('2457.5427') },
    bell: { bars: 2, notes: mel('57.4.6.75.3') },
  }),
  'Midnight House': () => preset({ bpm: 124, root: 0, scale: 'Minor', swing: 0.15, reverb: 0.35, delay: 0.3 }, {
    pad: { bars: 4, notes: mel('0563') },
    bass: { bars: 1, notes: mel('..0...0...0.0.3.') },
    drums: { bars: 1, notes: drums('x...x...x...x...', '', '....x.......x...', '..x...x...x...x.') },
    pluck: { bars: 2, notes: mel('..4..4..6..4..2...4..4..7..6..5.') },
    bell: {},
  }),
};

// ---------- share links ----------
const hex = (n) => n.toString(16).padStart(2, '0');

export function encodeState(s) {
  const data = {
    v: 1, b: s.bpm, k: s.root, s: SCALE_NAMES.indexOf(s.scale),
    w: +s.swing.toFixed(2), r: +s.reverb.toFixed(2), d: +s.delay.toFixed(2),
    g: s.rings.map((r) => [r.steps, r.bars, +r.vol.toFixed(2), r.mute ? 1 : 0, r.notes.map(hex).join('')]),
  };
  return btoa(JSON.stringify(data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeState(str) {
  try {
    const json = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const d = JSON.parse(json);
    if (d.v !== 1 || !Array.isArray(d.g)) return null;
    const s = defaultState();
    s.bpm = clampNum(d.b, 40, 200, 104);
    s.root = clampNum(d.k, 0, 11, 9) | 0;
    s.scale = SCALE_NAMES[d.s] || 'Minor';
    s.swing = clampNum(d.w, 0, 0.6, 0);
    s.reverb = clampNum(d.r, 0, 1, 0.45);
    s.delay = clampNum(d.d, 0, 1, 0.3);
    s.rings.forEach((r, i) => {
      const g = d.g[i];
      if (!g) return;
      r.steps = clampNum(g[0], 1, 32, 16) | 0;
      r.bars = BAR_OPTIONS.includes(g[1]) ? g[1] : 1;
      r.vol = clampNum(g[2], 0, 1, 0.8);
      r.mute = !!g[3];
      const notes = [];
      for (let j = 0; j < r.steps; j++) notes.push(parseInt(String(g[4]).substr(j * 2, 2), 16) || 0);
      r.notes = notes.map((m) => m & ((1 << r.rows) - 1));
    });
    return s;
  } catch {
    return null;
  }
}

function clampNum(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}
