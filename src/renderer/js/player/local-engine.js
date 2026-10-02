/** Plays local files through Web Audio so the EQ and Sound Check work. */

import { Emitter } from '../util.js';
import { EQ_BANDS, EQ_PRESETS } from './eq.js';

export class LocalEngine extends Emitter {
  constructor() {
    super();
    const a = new Audio();
    a.preload = 'auto';
    this.audio = a;
    this.ctx = null;
    this.track = null;
    this._eq = 'Off';
    this._soundCheck = false;
    a.addEventListener('ended', () => this.emit('ended'));
    a.addEventListener('timeupdate', () => this.emit('time'));
    a.addEventListener('play', () => this.emit('state'));
    a.addEventListener('pause', () => this.emit('state'));
    a.addEventListener('loadedmetadata', () => this.emit('duration', a.duration));
    a.addEventListener('error', () => {
      if (a.getAttribute('src')) this.emit('error', a.error);
    });
  }

  _graph() {
    if (this.ctx) return;
    try {
      const ctx = new AudioContext({ latencyHint: 'playback' });
      const src = ctx.createMediaElementSource(this.audio);
      this.pre = ctx.createGain();
      this.filters = EQ_BANDS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f;
        b.Q.value = 1.1;
        b.gain.value = 0;
        return b;
      });
      this.level = ctx.createGain();
      let node = src.connect(this.pre);
      for (const f of this.filters) node = node.connect(f);
      node.connect(this.level).connect(ctx.destination);
      this.ctx = ctx;
      this.setEQ(this._eq);
      this._applyGain();
    } catch (err) {
      console.warn('Web Audio unavailable, EQ disabled', err);
    }
  }

  load(track) {
    this._graph();
    this.track = track;
    this.audio.src = track.src;
    this.audio.load();
    this._applyGain();
  }

  async play() {
    if (!this.audio.getAttribute('src')) return;
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
    try {
      await this.audio.play();
    } catch (err) {
      if (err.name !== 'AbortError') this.emit('error', err);
    }
  }

  pause() {
    this.audio.pause();
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.track = null;
  }

  seek(sec) {
    const d = this.duration;
    if (!isFinite(sec)) return;
    this.audio.currentTime = Math.max(0, d ? Math.min(sec, d - 0.25) : sec);
  }

  get playing() {
    return !!this.audio.getAttribute('src') && !this.audio.paused && !this.audio.ended;
  }

  get position() {
    return this.audio.currentTime || 0;
  }

  get duration() {
    const d = this.audio.duration;
    return isFinite(d) && d > 0 ? d : (this.track && this.track.duration) || 0;
  }

  setVolume(v) {
    this.audio.volume = Math.max(0, Math.min(1, v));
  }

  setEQ(name) {
    this._eq = name;
    if (!this.filters) return;
    const gains = EQ_PRESETS[name] || null;
    const max = gains ? Math.max(0, ...gains) : 0;
    this.filters.forEach((f, i) => f.gain.setTargetAtTime(gains ? gains[i] : 0, this.ctx.currentTime, 0.05));
    // Pre-amp down so boosted presets don't clip.
    this.pre.gain.setTargetAtTime(Math.pow(10, (-max * 0.6) / 20), this.ctx.currentTime, 0.05);
  }

  setSoundCheck(on) {
    this._soundCheck = on;
    this._applyGain();
  }

  _applyGain() {
    if (!this.level) return;
    let db = 0;
    if (this._soundCheck && this.track && typeof this.track.gain === 'number') db = Math.max(-12, Math.min(8, this.track.gain));
    this.level.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.05);
  }
}
