# Orbitals — paint music on spinning rings

Orbitals is a music machine that runs in your browser. You paint notes onto rings that orbit a glowing core. Each ring is an instrument and keeps its own rhythm, so you can make polyrhythms just by changing a number. Every note is locked to a key, so whatever you paint sounds musical.

There are no dependencies, no build step and no samples. All the sound is made live with the Web Audio API.

## What you can do

| | |
|---|---|
| **Paint** | Tap or drag on a ring to drop notes. Tap a note again to remove it. Drag along a ring to draw a melody. |
| **Pitch by distance** | Further from the centre means a higher note. Drag a dot in or out to change its pitch. |
| **5 instruments** | Pad (sustained chords), Bass, Drums (kick ● snare ◆ clap ▲ hat ■), Pluck, and an FM Bell. |
| **Polyrhythm** | Each ring has its own step count (1–32) and loop length (½–4 bars). Put 5 against 7 against 16 and they stay locked to one clock. |
| **Always in key** | Pick from 10 scales and any root note. Change them while it plays and every note follows. |
| **Generate** | Builds a whole piece that fits together: a chord progression, Euclidean drum patterns, bass that follows the chords, and melodies. ⇧ or 🎲 also picks a random key and tempo. |
| **Mutate / Evolve** | Mutate makes small musical changes. Evolve keeps changing the loop every few bars, so it never repeats exactly. |
| **Share** | The whole song is stored in the URL. Send the link and the other person hears exactly your loop. |
| **Record** | Records the output to an audio file you can download. |
| **Mix** | Swing, reverb ("Space"), a ping-pong delay synced to the tempo ("Echo"), and mute, solo and volume for each ring. |
| **Undo** | ⌘/Ctrl Z undoes changes. |

### Keyboard

`Space` play/pause · `G` generate (`⇧G` random key) · `M` mutate · `E` evolve · `1–5` select ring · `← →` rotate ring · `↑ ↓` tempo · `C` clear ring (`⇧C` all) · `S` share · `R` record

## Run it

It's a static site that uses ES modules, so serve it over HTTP. Opening the file directly won't work.

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

### Deploy on GitHub Pages

Go to **Settings → Pages**, set **Source** to *Deploy from a branch*, then pick your branch and `/ (root)`. That's all; there's nothing to build.

## How it's built

```
index.html        layout + intro
css/style.css     styles (dark, glassy, responsive; bottom sheet on mobile)
js/main.js        UI wiring, painting input, transport, share/record/undo
js/audio.js       Web Audio engine: synth voices, reverb, delay, compressor, analyser
js/sequencer.js   lookahead scheduler on a shared beat clock (polyrhythms stay in phase)
js/visuals.js     canvas renderer: rings, comet playheads, particles, spectrum hub
js/music.js       scales, Euclidean rhythms, generator & mutator
js/state.js       ring definitions, presets, URL encoding
```

- **Timing**: notes are scheduled about 120 ms ahead on the audio clock, so playback stays tight even when the page is busy. Every ring's position comes from one shared beat clock, so changing the tempo or a ring's step count never knocks the rings out of sync.
- **Sounds**: everything is synthesised. The kick is a sine with a pitch drop, the snare, clap and hat are filtered noise, the bass and pluck are filtered sawtooth stacks, the bell uses FM synthesis, and the pad is detuned sawtooth chords.
