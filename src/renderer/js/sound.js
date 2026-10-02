/**
 * The click wheel "clicker", synthesised at runtime (no samples): a very short
 * band-limited transient similar to the piezo tick of a real iPod.
 */

import { store } from './state.js';

let ctx = null;
const buffers = {};
let lastTick = 0;

function context() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    buffers.tick = makeClick(ctx, { len: 0.014, freq: 2600, decay: 900, noise: 0.55, body: 0.45 });
    buffers.press = makeClick(ctx, { len: 0.022, freq: 1500, decay: 520, noise: 0.35, body: 0.65 });
    buffers.soft = makeClick(ctx, { len: 0.012, freq: 3400, decay: 1300, noise: 0.6, body: 0.3 });
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function makeClick(ac, { len, freq, decay, noise, body }) {
  const sr = ac.sampleRate;
  const n = Math.floor(sr * len);
  const buf = ac.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t * decay);
    const attack = Math.min(1, i / (sr * 0.0004));
    const white = Math.random() * 2 - 1;
    lp += 0.45 * (white - lp); // gentle low-pass so the noise isn't harsh
    const tone = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * decay * 1.6);
    d[i] = (lp * noise + tone * body) * env * attack;
  }
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
    const src = ac.createBufferSource();
    src.buffer = buffers[kind] || buffers.tick;
    const g = ac.createGain();
    g.gain.value = (mode === 'loud' ? 0.55 : 0.28) * (kind === 'press' ? 0.9 : 1);
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    src.connect(g).connect(ac.destination);
    src.start();
  } catch {
    /* audio unavailable */
  }
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
