// Music theory helpers + the generative brain of Orbitals.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = {
  'Minor': [0, 2, 3, 5, 7, 8, 10],
  'Major': [0, 2, 4, 5, 7, 9, 11],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Lydian': [0, 2, 4, 6, 7, 9, 11],
  'Phrygian': [0, 1, 3, 5, 7, 8, 10],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Pentatonic Major': [0, 2, 4, 7, 9],
  'Pentatonic Minor': [0, 3, 5, 7, 10],
  'Hirajoshi': [0, 2, 3, 7, 8],
};
export const SCALE_NAMES = Object.keys(SCALES);

export function degreeToMidi(root, scaleName, octave, degree) {
  const s = SCALES[scaleName] || SCALES.Minor;
  const oct = Math.floor(degree / s.length);
  const idx = ((degree % s.length) + s.length) % s.length;
  return 12 * (octave + 1) + root + s[idx] + 12 * oct;
}

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const midiName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

/** Evenly distribute `pulses` hits across `steps` (Euclidean rhythm), then rotate. */
export function euclid(steps, pulses, rotate = 0) {
  const out = new Array(steps).fill(false);
  if (pulses <= 0) return out;
  for (let i = 0; i < steps; i++) out[i] = ((i * pulses) % steps) < pulses;
  if (!rotate) return out;
  const r = ((rotate % steps) + steps) % steps;
  return out.slice(steps - r).concat(out.slice(0, steps - r));
}

// ---------- randomness ----------
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const DRUM = { KICK: 0, SNARE: 1, CLAP: 2, HAT: 3 };

const PROGRESSIONS = [
  [0, 5, 3, 4], [0, 3, 4, 3], [0, 5, 2, 6], [0, 4, 5, 3],
  [0, 2, 3, 4], [0, 6, 5, 4], [0, 3, 0, 4], [5, 3, 0, 4],
];

function emptyNotes(steps) { return new Array(steps).fill(0); }

function genDrums(ring, energy) {
  const steps = 16;
  ring.steps = steps; ring.bars = 1;
  const n = emptyNotes(steps);
  const kickStyle = pick(['four', 'broken', 'euclid']);
  let kick;
  if (kickStyle === 'four' && energy > 0.45) kick = euclid(16, 4);
  else if (kickStyle === 'euclid') kick = euclid(16, pick([3, 5]), 0);
  else kick = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0].map(Boolean);
  const snare = new Array(16).fill(false); snare[4] = snare[12] = true;
  if (chance(0.3)) snare[15] = true;
  const hatPulses = Math.round(clamp(energy * 12 + rand(-2, 2), 3, 12));
  const hats = euclid(16, hatPulses, pick([0, 1, 2]));
  for (let i = 0; i < steps; i++) {
    if (kick[i]) n[i] |= 1 << DRUM.KICK;
    if (snare[i] && chance(0.85)) n[i] |= 1 << (chance(0.4) ? DRUM.CLAP : DRUM.SNARE);
    if (hats[i]) n[i] |= 1 << DRUM.HAT;
  }
  ring.notes = n;
}

function genBass(ring, prog) {
  ring.bars = 4; ring.steps = pick([16, 32]);
  const perBar = ring.steps / 4;
  const rhythm = euclid(perBar, randInt(Math.ceil(perBar / 4), Math.ceil(perBar / 2)), 0);
  const n = emptyNotes(ring.steps);
  for (let s = 0; s < ring.steps; s++) {
    const bar = Math.floor(s / perBar);
    if (!rhythm[s % perBar]) continue;
    let deg = prog[bar];
    if (s % perBar !== 0 && chance(0.3)) deg += pick([4, 7, 2]);
    while (deg > 7) deg -= 7;
    n[s] = 1 << clamp(deg, 0, 7);
  }
  ring.notes = n;
}

function genPad(ring, prog) {
  ring.bars = 4; ring.steps = 4;
  ring.notes = prog.map((d) => 1 << clamp(d, 0, 7));
}

function walkMelody(ring, steps, pulses, startDeg, spread) {
  const rhythm = euclid(steps, pulses, randInt(0, steps - 1));
  const n = emptyNotes(steps);
  let deg = startDeg;
  for (let s = 0; s < steps; s++) {
    if (!rhythm[s]) continue;
    deg = clamp(deg + pick([-2, -1, -1, 0, 1, 1, 2, spread, -spread]), 0, 7);
    n[s] = 1 << deg;
  }
  ring.steps = steps;
  ring.notes = n;
}

function genPluck(ring, energy) {
  ring.bars = pick([1, 2]);
  const steps = ring.bars === 1 ? pick([12, 16, 10]) : pick([16, 24]);
  const pulses = Math.round(clamp(steps * (0.3 + energy * 0.4), 3, steps));
  walkMelody(ring, steps, pulses, randInt(1, 4), 3);
}

function genBell(ring) {
  ring.bars = pick([2, 4]);
  const steps = pick([5, 7, 9, 11, 13]);
  walkMelody(ring, steps, randInt(2, Math.max(3, Math.floor(steps / 2))), randInt(2, 5), 4);
}

/** Generate a single ring in place (used for "regenerate ring"). */
export function generateRing(ring, energy = rand(0.35, 0.8), prog = pick(PROGRESSIONS)) {
  switch (ring.voice) {
    case 'drums': genDrums(ring, energy); break;
    case 'bass': genBass(ring, prog); break;
    case 'pad': genPad(ring, prog); break;
    case 'pluck': genPluck(ring, energy); break;
    case 'bell': genBell(ring); break;
  }
}

/** Generate a full, harmonically coherent piece across every ring. */
export function generateAll(state, { keepKey = true } = {}) {
  const energy = rand(0.3, 0.9);
  const prog = pick(PROGRESSIONS);
  if (!keepKey) {
    state.root = randInt(0, 11);
    state.scale = pick(['Minor', 'Dorian', 'Major', 'Pentatonic Minor', 'Lydian', 'Mixolydian']);
    state.bpm = randInt(84, 126);
  }
  state.rings.forEach((r) => {
    generateRing(r, energy, prog);
    if (r.voice === 'bell' && chance(0.25)) r.notes = r.notes.map(() => 0);
  });
}

/** Small, musical change: flip a note, nudge a pitch, rotate a rhythm. */
export function mutate(state, amount = 1) {
  const melodic = state.rings.filter((r) => r.voice !== 'pad');
  for (let k = 0; k < amount; k++) {
    const ring = pick(melodic);
    const op = pick(['nudge', 'nudge', 'toggle', 'rotate', 'toggle']);
    const steps = ring.notes.length;
    if (op === 'rotate' && ring.voice !== 'drums') {
      ring.notes = ring.notes.slice(-1).concat(ring.notes.slice(0, -1));
    } else if (op === 'nudge') {
      const filled = ring.notes.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
      if (!filled.length) continue;
      const s = pick(filled);
      if (ring.voice === 'drums') {
        // move a hat or kick to a neighbouring step
        const dest = (s + pick([1, -1]) + steps) % steps;
        const bit = ring.notes[s] & (1 << DRUM.HAT) ? DRUM.HAT : -1;
        if (bit >= 0) { ring.notes[s] &= ~(1 << bit); ring.notes[dest] |= 1 << bit; }
      } else {
        const row = Math.log2(ring.notes[s] & -ring.notes[s]);
        const nr = clamp(row + pick([-2, -1, 1, 2]), 0, ring.rows - 1);
        ring.notes[s] = 1 << nr;
      }
    } else {
      const s = randInt(0, steps - 1);
      if (ring.voice === 'drums') {
        ring.notes[s] ^= 1 << pick([DRUM.HAT, DRUM.HAT, DRUM.KICK, DRUM.CLAP]);
      } else if (ring.notes[s]) {
        ring.notes[s] = 0;
      } else {
        ring.notes[s] = 1 << randInt(1, ring.rows - 2);
      }
    }
  }
}
