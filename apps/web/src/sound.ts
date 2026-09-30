/**
 * Tiny synthesized sound effects (Web Audio API), so there are no audio files
 * to load. Browsers only allow audio after a user gesture, so the context is
 * resumed on the first pointer or key press.
 */

const STORAGE_KEY = 'nomercy:sound';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage unavailable; the setting just won't be remembered.
  }
}

function audio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function unlock() {
  const c = audio();
  if (c && c.state === 'suspended') void c.resume();
}

if (typeof window !== 'undefined') {
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise) {
    noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.25), c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** A short card "flick", like a card sliding off the deck. */
export function playCardDraw(delayMs = 0): void {
  if (!soundEnabled()) return;
  const c = audio();
  if (!c || c.state !== 'running') return;

  const t = c.currentTime + delayMs / 1000;
  // Vary pitch slightly so a run of draws doesn't sound robotic.
  const pitch = 0.85 + Math.random() * 0.3;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);

  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.9;
  filter.frequency.setValueAtTime(1600 * pitch, t);
  filter.frequency.exponentialRampToValueAtTime(4200 * pitch, t + 0.12);

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.35, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

  src.connect(filter).connect(gain).connect(c.destination);
  src.start(t);
  src.stop(t + 0.2);
}

/** A card slapped onto the discard pile: a low thud with a soft snap. */
export function playCardPlay(delayMs = 0): void {
  if (!soundEnabled()) return;
  const c = audio();
  if (!c || c.state !== 'running') return;

  const t = c.currentTime + delayMs / 1000;

  // Snap: a very short burst of low-passed noise.
  const snap = c.createBufferSource();
  snap.buffer = noiseBuffer(c);
  const lowpass = c.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 2400;
  const snapGain = c.createGain();
  snapGain.gain.setValueAtTime(0.0001, t);
  snapGain.gain.exponentialRampToValueAtTime(0.4, t + 0.004);
  snapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  snap.connect(lowpass).connect(snapGain).connect(c.destination);
  snap.start(t);
  snap.stop(t + 0.1);

  // Thud: a quick downward sine sweep for weight.
  const thud = c.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(170, t);
  thud.frequency.exponentialRampToValueAtTime(80, t + 0.09);
  const thudGain = c.createGain();
  thudGain.gain.setValueAtTime(0.0001, t);
  thudGain.gain.exponentialRampToValueAtTime(0.45, t + 0.006);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  thud.connect(thudGain).connect(c.destination);
  thud.start(t);
  thud.stop(t + 0.14);
}

/** Someone called UNO: a bright two-note rising chime. */
export function playUnoCall(delayMs = 0): void {
  if (!soundEnabled()) return;
  const c = audio();
  if (!c || c.state !== 'running') return;

  const t = c.currentTime + delayMs / 1000;
  const note = (freq: number, start: number, length: number) => {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    // A soft octave overtone makes it ring like a bell.
    const overtone = c.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(freq * 2, start);
    const overtoneGain = c.createGain();
    overtoneGain.gain.value = 0.25;

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);

    osc.connect(gain);
    overtone.connect(overtoneGain).connect(gain);
    gain.connect(c.destination);
    osc.start(start);
    overtone.start(start);
    osc.stop(start + length + 0.02);
    overtone.stop(start + length + 0.02);
  };
  note(784, t, 0.14); // G5
  note(1175, t + 0.11, 0.32); // D6
}

/** Someone was caught without calling UNO: a low, descending "wah-wah" buzzer. */
export function playUnoCaught(delayMs = 0): void {
  if (!soundEnabled()) return;
  const c = audio();
  if (!c || c.state !== 'running') return;

  const t = c.currentTime + delayMs / 1000;
  const note = (from: number, to: number, start: number, length: number) => {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + length);
    // Soften the buzzy sawtooth so it reads as "oops", not an alarm.
    const lowpass = c.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 900;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
    gain.gain.setValueAtTime(0.22, start + length * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(lowpass).connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + length + 0.02);
  };
  note(311, 294, t, 0.22); // E♭4, sagging
  note(233, 196, t + 0.24, 0.42); // B♭3 sliding down to G3
}

/** Someone won the round: a quick rising run into a ringing major chord. */
export function playRoundWon(delayMs = 0): void {
  if (!soundEnabled()) return;
  const c = audio();
  if (!c || c.state !== 'running') return;

  const t = c.currentTime + delayMs / 1000;
  const tone = (freq: number, start: number, length: number, peak: number) => {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + length + 0.02);
  };
  // Run: C5 E5 G5 C6.
  [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.1, 0.18, 0.22));
  // Final chord (C6 E6 G6), held and ringing out.
  const chordAt = t + 0.42;
  [1047, 1319, 1568].forEach((f) => tone(f, chordAt, 1.1, 0.12));
}

// --- Emoji reaction sounds -------------------------------------------------

/** One oscillator note with a quick attack and exponential release. */
function blip(
  c: AudioContext,
  opts: { type: OscillatorType; from: number; to?: number; start: number; length: number; peak: number; lowpass?: number },
): void {
  const osc = c.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.from, opts.start);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, opts.start + opts.length);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, opts.start);
  gain.gain.exponentialRampToValueAtTime(opts.peak, opts.start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.length);
  let node: AudioNode = osc;
  if (opts.lowpass) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = opts.lowpass;
    node = osc.connect(f);
  }
  node.connect(gain).connect(c.destination);
  osc.start(opts.start);
  osc.stop(opts.start + opts.length + 0.02);
}

/** A filtered noise burst (claps, whooshes). */
function noiseBurst(
  c: AudioContext,
  opts: { start: number; length: number; peak: number; type: BiquadFilterType; from: number; to?: number },
): void {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = opts.type;
  f.Q.value = 1;
  f.frequency.setValueAtTime(opts.from, opts.start);
  if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, opts.start + opts.length);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, opts.start);
  gain.gain.exponentialRampToValueAtTime(opts.peak, opts.start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.length);
  src.connect(f).connect(gain).connect(c.destination);
  src.start(opts.start);
  src.stop(opts.start + Math.min(opts.length + 0.02, 0.24));
}

/** A short sound matching an emoji reaction. */
export function playReaction(emoji: string): void {
  if (!soundEnabled()) return;
  const c = audio();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;

  switch (emoji) {
    case '😂':
    case '🤣': // bouncy "ha-ha-ha"
      [620, 560, 500, 440].forEach((f, i) =>
        blip(c, { type: 'square', from: f, to: f * 0.9, start: t + i * 0.11, length: 0.08, peak: 0.08, lowpass: 1800 }),
      );
      break;
    case '😎':
    case '😏': // smooth "whoop"
      blip(c, { type: 'sine', from: 330, to: 880, start: t, length: 0.28, peak: 0.2 });
      break;
    case '😱': // rising shriek with a wobble
      blip(c, { type: 'sawtooth', from: 500, to: 1400, start: t, length: 0.45, peak: 0.1, lowpass: 2600 });
      blip(c, { type: 'sine', from: 520, to: 1460, start: t, length: 0.45, peak: 0.1 });
      break;
    case '😭': // sobbing "wah-wah"
      blip(c, { type: 'triangle', from: 520, to: 400, start: t, length: 0.3, peak: 0.2 });
      blip(c, { type: 'triangle', from: 440, to: 300, start: t + 0.32, length: 0.45, peak: 0.2 });
      break;
    case '😡':
    case '🤬': // low rumbling growl
      [0, 0.07, 0.14, 0.21].forEach((d) =>
        blip(c, { type: 'sawtooth', from: 95, to: 80, start: t + d, length: 0.09, peak: 0.18, lowpass: 500 }),
      );
      break;
    case '😈':
    case '💀': // spooky "dun-dun"
      blip(c, { type: 'triangle', from: 196, start: t, length: 0.22, peak: 0.25 });
      blip(c, { type: 'triangle', from: 185, start: t + 0.26, length: 0.5, peak: 0.25 });
      break;
    case '🤡': // clown horn honk-honk
      blip(c, { type: 'square', from: 370, start: t, length: 0.12, peak: 0.1, lowpass: 1500 });
      blip(c, { type: 'square', from: 370, start: t + 0.16, length: 0.2, peak: 0.1, lowpass: 1500 });
      break;
    case '🔥': // whoosh
      noiseBurst(c, { start: t, length: 0.22, peak: 0.3, type: 'bandpass', from: 300, to: 2400 });
      break;
    case '👏': // a burst of claps
      [0, 0.12, 0.2, 0.33, 0.42].forEach((d) =>
        noiseBurst(c, { start: t + d, length: 0.06, peak: 0.35, type: 'bandpass', from: 1500 }),
      );
      break;
    case '🙏': // soft bell chime
      blip(c, { type: 'sine', from: 1175, start: t, length: 0.7, peak: 0.15 });
      blip(c, { type: 'sine', from: 2350, start: t, length: 0.4, peak: 0.04 });
      break;
    case '👍': // bright pop, up
      blip(c, { type: 'sine', from: 500, to: 900, start: t, length: 0.12, peak: 0.25 });
      break;
    case '👎': // low boop, down
      blip(c, { type: 'sine', from: 300, to: 150, start: t, length: 0.18, peak: 0.25 });
      break;
  }
}
