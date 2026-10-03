/**
 * The click wheel "clicker", synthesised at runtime (no samples): a very short
 * band-limited transient similar to the piezo tick of a real iPod, or one of
 * a few others you can choose in Settings › Click Sound. "This iPod's Own"
 * is the piezo tick, except on the original iPod, whose wheel turned against
 * a soft mechanical detent.
 */

import { store } from './state.js';
import { getModel } from './models.js';

let ctx = null;
const buffers = {};
let lastTick = 0;

/**
 * Each sound: a tick (scrolling) and a press (buttons). len s, freq Hz,
 * decay /s, noise and body the mix of filtered noise and tone; sweep drops
 * the tone's pitch to this fraction (a pop); echo adds a second, quieter hit
 * this many seconds later (a typewriter's clack); gain scales the volume.
 */
const SOUNDS = {
  piezo: {
    tick: { len: 0.014, freq: 2600, decay: 900, noise: 0.55, body: 0.45 },
    press: { len: 0.022, freq: 1500, decay: 520, noise: 0.35, body: 0.65 },
  },
  soft: {
    tick: { len: 0.012, freq: 3400, decay: 1300, noise: 0.35, body: 0.5, gain: 0.6 },
    press: { len: 0.018, freq: 2200, decay: 800, noise: 0.3, body: 0.6, gain: 0.7 },
  },
  mechanical: {
    tick: { len: 0.024, freq: 820, decay: 380, noise: 0.75, body: 0.4, gain: 1.1 },
    press: { len: 0.034, freq: 560, decay: 260, noise: 0.6, body: 0.55 },
  },
  pop: {
    tick: { len: 0.03, freq: 1300, decay: 160, noise: 0.04, body: 1, sweep: 0.45, gain: 0.8 },
    press: { len: 0.045, freq: 900, decay: 110, noise: 0.04, body: 1, sweep: 0.4, gain: 0.85 },
  },
  typewriter: {
    tick: { len: 0.03, freq: 4200, decay: 700, noise: 0.85, body: 0.25, echo: 0.009, gain: 0.85 },
    press: { len: 0.05, freq: 1800, decay: 420, noise: 0.8, body: 0.35, echo: 0.014 },
  },
};

function context() {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** The sound in use: the setting, or this model's own. */
function soundName() {
  const s = store.settings.clickSound || 'auto';
  if (s !== 'auto' && SOUNDS[s]) return s;
  return getModel(store.settings.model).wheel.type === 'scroll' ? 'mechanical' : 'piezo';
}

function buffer(name, kind) {
  const key = `${name}:${kind}`;
  if (!buffers[key]) buffers[key] = makeClick(context(), SOUNDS[name][kind] || SOUNDS[name].tick);
  return buffers[key];
}

function makeClick(ac, { len, freq, decay, noise, body, sweep = 1, echo = 0 }) {
  const sr = ac.sampleRate;
  const n = Math.floor(sr * len);
  const buf = ac.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  let lp = 0;
  let phase = 0;
  const hit = (i0, level) => {
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / sr;
      const env = Math.exp(-t * decay);
      const attack = Math.min(1, (i - i0) / (sr * 0.0004));
      const white = Math.random() * 2 - 1;
      lp += 0.45 * (white - lp); // gentle low-pass so the noise isn't harsh
      // The pitch glides down to sweep x freq (1 = steady).
      const f = freq * (1 + (sweep - 1) * Math.min(1, t / len));
      phase += (2 * Math.PI * f) / sr;
      const tone = Math.sin(phase) * Math.exp(-t * decay * 1.6);
      d[i] += (lp * noise + tone * body) * env * attack * level;
    }
  };
  hit(0, 1);
  if (echo) hit(Math.floor(sr * echo), 0.55);
  // Normalise.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < n; i++) d[i] /= peak || 1;
  return buf;
}

export function click(kind = 'tick') {
  const mode = store.settings.clicker;
  if (mode === 'off') return;
  const now = performance.now();
  if (kind === 'tick' && now - lastTick < 12) return; // avoid a buzz on very fast spins
  lastTick = now;
  try {
    const ac = context();
    const name = soundName();
    const spec = SOUNDS[name][kind] || SOUNDS[name].tick;
    const src = ac.createBufferSource();
    src.buffer = buffer(name, SOUNDS[name][kind] ? kind : 'tick');
    const g = ac.createGain();
    g.gain.value = (mode === 'loud' ? 0.55 : 0.28) * (kind === 'press' ? 0.9 : 1) * (spec.gain || 1);
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    src.connect(g).connect(ac.destination);
    src.start();
  } catch {
    /* audio unavailable */
  }
}

/** A few ticks and a press, to hear a newly chosen click sound. */
export function previewClicks() {
  [0, 70, 140, 210].forEach((ms) => setTimeout(() => click('tick'), ms));
  setTimeout(() => click('press'), 420);
}

/** Gentle alarm chime: returns a stop() function. */
export function alarmTone() {
  const ac = context();
  const master = ac.createGain();
  master.gain.value = 0.25;
  master.connect(ac.destination);
  let stopped = false;
  const ring = () => {
    if (stopped) return;
    const t0 = ac.currentTime;
    [0, 0.18, 0.36].forEach((dt, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = [1318.5, 1568, 2093][i];
      g.gain.setValueAtTime(0, t0 + dt);
      g.gain.linearRampToValueAtTime(0.9, t0 + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + 0.5);
      o.connect(g).connect(master);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.55);
    });
  };
  ring();
  const id = setInterval(ring, 1400);
  return () => {
    stopped = true;
    clearInterval(id);
    setTimeout(() => master.disconnect(), 600);
  };
}

/** Short blips for games. */
export function blip(freq = 880, dur = 0.06, type = 'square', vol = 0.08) {
  if (store.settings.clicker === 'off') return;
  try {
    const ac = context();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + dur + 0.02);
  } catch {
    /* ignore */
  }
}
