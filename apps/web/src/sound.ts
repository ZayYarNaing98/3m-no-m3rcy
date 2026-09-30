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
