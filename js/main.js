// Orbitals — wiring: state, input, UI panels, transport.
import { AudioEngine } from './audio.js';
import { Sequencer } from './sequencer.js';
import { Visualizer } from './visuals.js';
import { NOTE_NAMES, SCALE_NAMES, degreeToMidi, midiName, generateAll, generateRing, mutate } from './music.js';
import { PRESETS, encodeState, decodeState, resampleNotes, DRUM_NAMES, BAR_OPTIONS } from './state.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const shared = decodeState(location.hash.slice(1));
const app = {
  state: shared || PRESETS['Neon Drift'](),
  selected: 3,
  engine: new AudioEngine(),
  evolve: false,
  undoStack: [],
  painted: false,
};
const { engine } = app;

const seq = new Sequencer(engine, () => app.state, { onStep, onBar });
const canvas = $('#orbit');
const vis = new Visualizer(canvas, app);

// ---------------------------------------------------------------- audio glue
function ensureAudio() {
  if (!engine.ready) {
    // iOS: let Web Audio play even when the ring/silent switch is on
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    engine.init(app.state.rings.length, app.state.rings.map((r) => r.send));
    applyMix();
  }
  return engine.resume();
}

function latency() {
  const c = engine.ctx;
  return c ? c.outputLatency || c.baseLatency || 0 : 0;
}

function pitchFor(i, row) {
  const { state } = app;
  const ring = state.rings[i];
  if (ring.voice === 'drums') return row;
  if (ring.voice === 'pad') return [row, row + 2, row + 4].map((d) => degreeToMidi(state.root, state.scale, ring.octave, d));
  return degreeToMidi(state.root, state.scale, ring.octave, row);
}

function noteLabel(i, row) {
  const ring = app.state.rings[i];
  if (ring.voice === 'drums') return DRUM_NAMES[row];
  if (ring.voice === 'pad') {
    const ch = pitchFor(i, row);
    const third = (ch[1] - ch[0] + 12) % 12;
    const fifth = (ch[2] - ch[0] + 12) % 12;
    const q = third === 3 ? (fifth === 6 ? '°' : 'm') : third === 4 ? (fifth === 8 ? '+' : '') : ' sus';
    return NOTE_NAMES[ch[0] % 12] + q + ' chord';
  }
  return midiName(pitchFor(i, row));
}

function onStep(i, step, mask, t, dur, audible) {
  if (!audible) return;
  const ring = app.state.rings[i];
  const stepsPerBeat = ring.steps / (ring.bars * 4);
  const accent = Number.isInteger(step / stepsPerBeat) ? 1 : 0.78;
  for (let row = 0; row < ring.rows; row++) {
    if (!(mask & (1 << row))) continue;
    let vel = accent;
    if (ring.voice === 'drums' && row === 3) vel *= 0.6 + Math.random() * 0.4;
    engine.play(ring.voice, i, pitchFor(i, row), t, dur, vel);
  }
  const delay = Math.max(0, (t - engine.now + latency()) * 1000);
  setTimeout(() => vis.trigger(i, step, mask), delay);
}

function onBar(bar) {
  if (!app.evolve || bar === 0) return;
  if (bar % 2 === 0) {
    mutate(app.state, bar % 8 === 0 ? 3 : 1);
    if (bar % 16 === 0) {
      const candidates = app.state.rings.filter((r) => r.voice === 'bell' || r.voice === 'pluck');
      const r = candidates[Math.floor(Math.random() * candidates.length)];
      generateRing(r);
      resyncAll();
    }
    changed();
  }
}

function resyncAll() { app.state.rings.forEach((_, i) => seq.resync(i)); }

function applyMix() {
  const s = app.state;
  engine.setMix({ reverb: s.reverb, delay: s.delay, master: s.master, bpm: s.bpm });
  s.rings.forEach((r, i) => engine.setRingGain(i, r.vol));
}

// ---------------------------------------------------------------- transport
async function play() {
  await ensureAudio();
  if (seq.playing) return;
  seq.start();
  document.body.classList.add('is-playing');
  $('#playBtn').setAttribute('aria-label', 'Pause');
}
function stop() {
  seq.stop();
  document.body.classList.remove('is-playing');
  $('#playBtn').setAttribute('aria-label', 'Play');
}
function togglePlay() { seq.playing ? stop() : play(); }

// ---------------------------------------------------------------- state changes
let hashTimer = null;
function changed({ structure = false } = {}) {
  if (structure) resyncAll();
  renderRings();
  renderEditor();
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, '', '#' + encodeState(app.state)), 250);
}

function pushUndo() {
  const snap = encodeState(app.state);
  if (app.undoStack[app.undoStack.length - 1] !== snap) app.undoStack.push(snap);
  if (app.undoStack.length > 60) app.undoStack.shift();
}

function undo() {
  const snap = app.undoStack.pop();
  if (!snap) { toast('Nothing to undo'); return; }
  const s = decodeState(snap);
  if (!s) return;
  loadState(s, { keepUndo: true });
  toast('Undone');
}

function loadState(s, { keepUndo = false } = {}) {
  if (!keepUndo) pushUndo();
  s.master = app.state.master;
  app.state = s;
  syncGlobalControls();
  applyMix();
  changed({ structure: true });
}

// ---------------------------------------------------------------- canvas input
let drag = null;
let lastPreview = 0;

function localXY(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function preview(i, row) {
  const now = performance.now();
  if (now - lastPreview < 40) return;
  lastPreview = now;
  const ring = app.state.rings[i];
  const stepSec = ((ring.bars * 4) / ring.steps) * 60 / app.state.bpm;
  engine.play(ring.voice, i, pitchFor(i, row), engine.now + 0.005, ring.voice === 'pad' ? 1.2 : stepSec, 0.85);
}

function applyCell(hit) {
  const ring = app.state.rings[hit.ring];
  const bit = 1 << hit.row;
  const key = `${hit.step}:${hit.row}`;
  if (drag.last === key) return;
  drag.last = key;

  if (drag.mode === 'erase') {
    if (ring.voice === 'drums') {
      if (!(ring.notes[hit.step] & bit)) return;
      ring.notes[hit.step] &= ~bit;
    } else {
      if (!ring.notes[hit.step]) return;
      ring.notes[hit.step] = 0;
    }
  } else {
    if (ring.voice === 'drums') {
      if (ring.notes[hit.step] & bit) return;
      ring.notes[hit.step] |= bit;
    } else {
      if (ring.notes[hit.step] === bit) return;
      ring.notes[hit.step] = bit; // one note per step on melodic rings — drag radially to re-pitch
    }
    ensureAudio().then(() => preview(hit.ring, hit.row));
    vis.trigger(hit.ring, hit.step, bit);
    if (!app.painted) { app.painted = true; $('#hint').classList.add('gone'); }
  }
  changed();
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  const [x, y] = localXY(e);
  const hit = vis.hitTest(x, y);
  if (!hit) return;
  e.preventDefault();
  if (hit.hub) { togglePlay(); return; }
  pushUndo();
  if (app.selected !== hit.ring) { app.selected = hit.ring; renderRings(); renderEditor(); }
  const ring = app.state.rings[hit.ring];
  const has = ring.notes[hit.step] & (1 << hit.row);
  drag = { mode: has ? 'erase' : 'paint', ring: hit.ring, last: null };
  canvas.setPointerCapture(e.pointerId);
  applyCell(hit);
});

canvas.addEventListener('pointermove', (e) => {
  const [x, y] = localXY(e);
  if (drag) {
    applyCell(vis.cellInRing(x, y, drag.ring));
    vis.hover = vis.cellInRing(x, y, drag.ring);
  } else {
    vis.hover = vis.hitTest(x, y);
  }
  updateTip(x, y, e.pointerType);
});

function endDrag() { drag = null; }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { if (!drag) { vis.hover = null; $('#tip').classList.remove('show'); } });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function updateTip(x, y, type) {
  const tip = $('#tip');
  const h = vis.hover;
  canvas.style.cursor = h ? 'pointer' : 'default';
  if (!h || type === 'touch' && !drag) { tip.classList.remove('show'); return; }
  if (h.hub) {
    tip.textContent = seq.playing ? 'Pause' : 'Play';
  } else {
    const ring = app.state.rings[h.ring];
    tip.innerHTML = `<i style="background:${ring.color}"></i>${ring.name} · <b>${noteLabel(h.ring, h.row)}</b>`;
  }
  tip.style.transform = `translate(${x + 14}px, ${y - 30}px)`;
  tip.classList.add('show');
}

// ---------------------------------------------------------------- rings panel
const ringList = $('#ringList');

function barsLabel(b) { return b === 0.5 ? '½ bar' : b === 1 ? '1 bar' : `${b} bars`; }

function buildRingList() {
  ringList.innerHTML = '';
  app.state.rings.forEach((ring, i) => {
    const li = document.createElement('li');
    li.className = 'ring-item';
    li.style.setProperty('--c', ring.color);
    li.innerHTML = `
      <button class="ring-sel" data-i="${i}" title="Select ${ring.name} (${i + 1})">
        <span class="swatch"></span>
        <span class="ring-name">${ring.name}</span>
        <span class="ring-meta"></span>
      </button>
      <button class="chip mute" data-i="${i}" title="Mute">M</button>
      <button class="chip solo" data-i="${i}" title="Solo">S</button>
      <input class="vol" type="range" min="0" max="1" step="0.01" data-i="${i}" aria-label="${ring.name} volume">`;
    ringList.appendChild(li);
  });
}

function renderRings() {
  $$('.ring-item', ringList).forEach((li, i) => {
    const ring = app.state.rings[i];
    li.classList.toggle('selected', i === app.selected);
    li.classList.toggle('muted', ring.mute);
    $('.ring-meta', li).textContent = `${ring.steps} · ${barsLabel(ring.bars)}`;
    $('.mute', li).setAttribute('aria-pressed', ring.mute);
    $('.solo', li).setAttribute('aria-pressed', ring.solo);
    const vol = $('.vol', li);
    if (document.activeElement !== vol) vol.value = ring.vol;
    vol.style.setProperty('--p', ring.vol * 100 + '%');
  });
}

ringList.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const i = +b.dataset.i;
  const ring = app.state.rings[i];
  if (b.classList.contains('ring-sel')) { app.selected = i; }
  else if (b.classList.contains('mute')) { ring.mute = !ring.mute; }
  else if (b.classList.contains('solo')) { ring.solo = !ring.solo; }
  changed();
});
ringList.addEventListener('input', (e) => {
  if (!e.target.classList.contains('vol')) return;
  const i = +e.target.dataset.i;
  app.state.rings[i].vol = +e.target.value;
  engine.setRingGain(i, +e.target.value);
  renderRings();
  changed();
});

// ---------------------------------------------------------------- ring editor
const ed = {
  steps: $('#edSteps'), stepsVal: $('#edStepsVal'), bars: $('#edBars'),
  name: $('#edName'), desc: $('#edDesc'), card: $('#ringEditor'),
};
let stepsOrigin = null;

function polyDesc(ring) {
  const perBeat = ring.steps / (ring.bars * 4);
  const pretty = Number.isInteger(perBeat) ? `${perBeat} per beat` : perBeat > 1 ? `${perBeat.toFixed(2)} per beat` : `1 every ${(1 / perBeat).toFixed(perBeat < 0.5 ? 0 : 2).replace(/\.00$/, '')} beats`;
  const filled = ring.notes.filter(Boolean).length;
  const note = ring.voice === 'drums'
    ? 'Inside to out: kick ●, snare ◆, clap ▲, hat ■.'
    : ring.voice === 'pad'
      ? 'Each dot holds a chord until the next one. Further out is a higher chord.'
      : 'Further out is higher. Drag a dot in or out to change its pitch.';
  return `<b>${ring.steps} steps</b> over ${barsLabel(ring.bars)} — ${pretty}. ${filled} note${filled === 1 ? '' : 's'}.<br>${note}`;
}

function renderEditor() {
  const ring = app.state.rings[app.selected];
  ed.card.style.setProperty('--c', ring.color);
  ed.name.textContent = ring.name;
  if (document.activeElement !== ed.steps) ed.steps.value = ring.steps;
  ed.steps.style.setProperty('--p', ((ring.steps - 1) / 31) * 100 + '%');
  ed.stepsVal.textContent = ring.steps;
  $$('button', ed.bars).forEach((b) => b.setAttribute('aria-pressed', +b.dataset.bars === ring.bars));
  ed.desc.innerHTML = polyDesc(ring);
}

ed.steps.addEventListener('input', () => {
  const ring = app.state.rings[app.selected];
  if (!stepsOrigin) { pushUndo(); stepsOrigin = { notes: ring.notes.slice() }; }
  const n = +ed.steps.value;
  ring.steps = n;
  ring.notes = resampleNotes(stepsOrigin.notes, n);
  changed({ structure: true });
});
ed.steps.addEventListener('change', () => { stepsOrigin = null; });

ed.bars.innerHTML = BAR_OPTIONS.map((b) => `<button data-bars="${b}">${b === 0.5 ? '½' : b}</button>`).join('');
ed.bars.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  pushUndo();
  app.state.rings[app.selected].bars = +b.dataset.bars;
  changed({ structure: true });
});

function rotateSelected(dir) {
  const ring = app.state.rings[app.selected];
  pushUndo();
  ring.notes = dir > 0 ? ring.notes.slice(-1).concat(ring.notes.slice(0, -1)) : ring.notes.slice(1).concat(ring.notes.slice(0, 1));
  changed();
}
function clearSelected() {
  pushUndo();
  const ring = app.state.rings[app.selected];
  ring.notes = ring.notes.map(() => 0);
  changed();
}
$('#edGen').addEventListener('click', () => {
  pushUndo();
  generateRing(app.state.rings[app.selected]);
  changed({ structure: true });
  flashCanvas();
});
$('#edRotL').addEventListener('click', () => rotateSelected(-1));
$('#edRotR').addEventListener('click', () => rotateSelected(1));
$('#edClear').addEventListener('click', clearSelected);

// ---------------------------------------------------------------- global controls
const rootSel = $('#root');
const scaleSel = $('#scale');
const bpmIn = $('#bpm');
rootSel.innerHTML = NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('');
scaleSel.innerHTML = SCALE_NAMES.map((n) => `<option>${n}</option>`).join('');
$('#presetSel').innerHTML = '<option value="">Presets…</option>' + Object.keys(PRESETS).map((n) => `<option>${n}</option>`).join('');

const sliders = {
  swing: { el: $('#swing'), max: 0.6, fmt: (v) => Math.round((v / 0.6) * 100) + '%' },
  reverb: { el: $('#reverb'), max: 1, fmt: (v) => Math.round(v * 100) + '%' },
  delay: { el: $('#delay'), max: 1, fmt: (v) => Math.round(v * 100) + '%' },
  master: { el: $('#master'), max: 1, fmt: (v) => Math.round(v * 100) + '%' },
};

function syncGlobalControls() {
  const s = app.state;
  rootSel.value = s.root;
  scaleSel.value = s.scale;
  bpmIn.value = s.bpm;
  seq.setBpm(s.bpm);
  for (const [k, cfg] of Object.entries(sliders)) {
    cfg.el.value = s[k];
    cfg.el.style.setProperty('--p', (s[k] / cfg.max) * 100 + '%');
    cfg.el.nextElementSibling.textContent = cfg.fmt(s[k]);
  }
}

for (const [k, cfg] of Object.entries(sliders)) {
  cfg.el.max = cfg.max;
  cfg.el.addEventListener('input', () => {
    app.state[k] = +cfg.el.value;
    cfg.el.style.setProperty('--p', (app.state[k] / cfg.max) * 100 + '%');
    cfg.el.nextElementSibling.textContent = cfg.fmt(app.state[k]);
    applyMix();
    changed();
  });
}

function setBpm(v) {
  const bpm = Math.max(40, Math.min(200, Math.round(v) || 100));
  app.state.bpm = bpm;
  bpmIn.value = bpm;
  seq.setBpm(bpm);
  applyMix();
  changed();
}
bpmIn.addEventListener('change', () => setBpm(+bpmIn.value));
$$('[data-bpm]').forEach((b) => b.addEventListener('click', () => setBpm(app.state.bpm + +b.dataset.bpm)));
$('.bpm').addEventListener('wheel', (e) => { e.preventDefault(); setBpm(app.state.bpm + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });

rootSel.addEventListener('change', () => { pushUndo(); app.state.root = +rootSel.value; changed(); });
scaleSel.addEventListener('change', () => { pushUndo(); app.state.scale = scaleSel.value; changed(); });

const PRESET_NOTES = {
  'Neon Drift': 'A minor · synthwave',
  'Polyrhythm 3·4·5·7': 'D dorian · 4 rhythms at once',
  'Lo-fi Sunday': 'F major · swung & dusty',
  'Gamelan Garden': 'E hirajoshi · bells',
  'Midnight House': 'C minor · 124 bpm',
};
function loadPreset(name) {
  loadState(PRESETS[name]());
  toast(`Loaded “${name}”`);
  flashCanvas();
  play();
}
$('#presetGrid').innerHTML = Object.keys(PRESETS).map((n) => `<button data-preset="${n}">${n}<small>${PRESET_NOTES[n] || ''}</small></button>`).join('');
$('#presetGrid').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) loadPreset(b.dataset.preset);
});
$('#presetSel').addEventListener('change', (e) => {
  const name = e.target.value;
  if (!name) return;
  e.target.value = '';
  loadPreset(name);
});

function doGenerate(randomKey) {
  pushUndo();
  const s = app.state;
  generateAll(s, { keepKey: !randomKey });
  syncGlobalControls();
  applyMix();
  changed({ structure: true });
  flashCanvas();
  toast(randomKey ? `${NOTE_NAMES[s.root]} ${s.scale.toLowerCase()}, ${s.bpm} bpm` : 'New loop');
  play();
}
function doMutate() {
  pushUndo();
  mutate(app.state, 3);
  changed();
  toast('Nudged a few notes');
}
function toggleEvolve() {
  app.evolve = !app.evolve;
  $('#evolveBtn').setAttribute('aria-pressed', app.evolve);
  toast(app.evolve ? 'Evolve on: the loop drifts every couple of bars' : 'Evolve off');
  if (app.evolve) play();
}

$('#playBtn').addEventListener('click', togglePlay);
$('#genBtn').addEventListener('click', (e) => doGenerate(e.shiftKey));
$('#diceBtn').addEventListener('click', () => doGenerate(true));
$('#mutateBtn').addEventListener('click', doMutate);
$('#evolveBtn').addEventListener('click', toggleEvolve);
$('#undoBtn').addEventListener('click', undo);
$('#shareBtn').addEventListener('click', share);
$('#recBtn').addEventListener('click', toggleRec);
$('#panelToggle').addEventListener('click', (e) => {
  const open = document.body.classList.toggle('panel-open');
  e.currentTarget.setAttribute('aria-pressed', open);
});

async function share() {
  history.replaceState(null, '', '#' + encodeState(app.state));
  const url = location.href;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: 'Orbitals', text: 'Listen to the loop I made', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Link copied. Whoever opens it hears this loop.');
  } catch {
    prompt('Copy this link', url);
  }
}

// ---------------------------------------------------------------- recording
let rec = null;
let recStart = 0;
let recTimer = null;
async function toggleRec() {
  await ensureAudio();
  if (rec) { rec.stop(); return; }
  if (!engine.recDest || !window.MediaRecorder) { toast('Recording is not supported in this browser'); return; }
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  const chunks = [];
  rec = new MediaRecorder(engine.recDest.stream, mimeType ? { mimeType } : undefined);
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const type = rec.mimeType || mimeType || 'audio/webm';
    const blob = new Blob(chunks, { type });
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orbitals-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    rec = null;
    clearInterval(recTimer);
    $('#recBtn').setAttribute('aria-pressed', 'false');
    $('#recTime').textContent = 'Rec';
    toast('Recording saved');
  };
  rec.start();
  recStart = performance.now();
  $('#recBtn').setAttribute('aria-pressed', 'true');
  recTimer = setInterval(() => {
    const s = Math.floor((performance.now() - recStart) / 1000);
    $('#recTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  play();
}

// ---------------------------------------------------------------- keyboard
window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if ((tag === 'INPUT' && e.target.type !== 'range') || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'g' || k === 'G') doGenerate(e.shiftKey);
  else if (k === 'm' || k === 'M') doMutate();
  else if (k === 'e' || k === 'E') toggleEvolve();
  else if (k === 'r' || k === 'R') toggleRec();
  else if (k === 's' || k === 'S') share();
  else if (k === 'c' || k === 'C') {
    if (e.shiftKey) { pushUndo(); app.state.rings.forEach((r) => (r.notes = r.notes.map(() => 0))); changed(); toast('Cleared everything'); }
    else clearSelected();
  }
  else if (/^[1-9]$/.test(k) && +k <= app.state.rings.length) { app.selected = +k - 1; changed(); }
  else if (tag === 'INPUT') return; // let range sliders keep arrow keys
  else if (k === 'ArrowLeft') { e.preventDefault(); rotateSelected(-1); }
  else if (k === 'ArrowRight') { e.preventDefault(); rotateSelected(1); }
  else if (k === 'ArrowUp') { e.preventDefault(); setBpm(app.state.bpm + (e.shiftKey ? 10 : 1)); }
  else if (k === 'ArrowDown') { e.preventDefault(); setBpm(app.state.bpm - (e.shiftKey ? 10 : 1)); }
});

// ---------------------------------------------------------------- misc ui
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function flashCanvas() {
  const o = $('.orbit');
  o.classList.remove('flash');
  void o.offsetWidth;
  o.classList.add('flash');
}

// intro
const intro = $('#intro');
if (shared) {
  $('#introTitle').innerHTML = 'Someone sent you <em>a&nbsp;loop.</em>';
  $('#introPlay').textContent = 'Play it';
  app.painted = true;
  $('#hint').classList.add('gone');
}
function closeIntro() { intro.classList.add('gone'); setTimeout(() => intro.remove(), 600); }
$('#introPlay').addEventListener('click', () => { closeIntro(); play(); });
$('#introSurprise').addEventListener('click', () => { closeIntro(); ensureAudio(); doGenerate(true); });
$('#introBlank').addEventListener('click', () => {
  closeIntro();
  ensureAudio();
  const s = app.state;
  s.rings.forEach((r) => { r.notes = r.notes.map(() => 0); });
  app.selected = 3;
  changed({ structure: true });
  toast('Empty. Tap a ring to start.');
});

// boot
buildRingList();
syncGlobalControls();
renderRings();
renderEditor();

function frame() {
  const beat = seq.playing ? Math.max(0, seq.beatAt(engine.now - latency())) : 0;
  vis.draw(beat, seq.playing);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose for debugging / tests
window.orbitals = { app, seq, engine, vis };
