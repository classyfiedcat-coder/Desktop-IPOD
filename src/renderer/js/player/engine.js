/** Two-deck audio engine: gapless preloading, crossfade (not within an album), and one Web Audio graph for EQ, Sound Check and the analyser. */

import { Emitter, clamp } from '../util.js';
import { EQ_BANDS, EQ_PRESETS } from './eq.js';

class Deck {
  constructor(engine, index) {
    this.engine = engine;
    this.index = index;
    this.track = null;
    this.ready = false;
    const a = new Audio();
    a.preload = 'auto';
    this.audio = a;
    const active = () => engine.deck === this;
    a.addEventListener('ended', () => engine._ended(this));
    a.addEventListener('timeupdate', () => active() && engine.emit('time'));
    a.addEventListener('play', () => active() && engine.emit('state'));
    a.addEventListener('pause', () => active() && engine.emit('state'));
    a.addEventListener('playing', () => {
      if (active()) {
        engine._reconnects = 0;
        engine.emit('buffering', false);
      }
    });
    a.addEventListener('waiting', () => active() && engine.emit('buffering', true));
    a.addEventListener('canplay', () => {
      this.ready = true;
    });
    a.addEventListener('loadedmetadata', () => active() && engine.emit('duration', a.duration));
    a.addEventListener('error', () => {
      if (!a.getAttribute('src')) return;
      engine._error(this, a.error);
    });
  }

  connect(ctx, dest) {
    this.src = ctx.createMediaElementSource(this.audio);
    this.level = ctx.createGain();
    this.fade = ctx.createGain();
    this.src.connect(this.level).connect(this.fade).connect(dest);
  }

  set(track) {
    this.track = track;
    this.ready = false;
    this.audio.src = track.src;
    this.audio.load();
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.track = null;
    this.ready = false;
  }
}

export class AudioEngine extends Emitter {
  constructor() {
    super();
    this.decks = [new Deck(this, 0), new Deck(this, 1)];
    this.active = 0;
    this.ctx = null;
    this.crossfade = 0;
    this.soundCheck = false;
    this.volume = 1;
    this.rate = 1;
    this.eqName = 'Off';
    this.customEq = null;
    this.next = null;
    this.getNext = () => null;
    this._fading = null;
    this._tail = null;
    this._badPreloads = new WeakSet();
    this._reconnects = 0;
    this._monitor = setInterval(() => this._tick(), 40);
  }

  get deck() {
    return this.decks[this.active];
  }

  get idle() {
    return this.decks[1 - this.active];
  }

  get track() {
    return this.deck.track;
  }

  get playing() {
    const a = this.deck.audio;
    return !!a.getAttribute('src') && !a.paused && !a.ended;
  }

  get position() {
    return this.deck.audio.currentTime || 0;
  }

  get duration() {
    const d = this.deck.audio.duration;
    if (isFinite(d) && d > 0) return d;
    const t = this.track;
    return t && !t.live ? t.duration || 0 : 0;
  }

  get audio() {
    return this.deck.audio;
  }

  // ------------------------------------------------------------------ graph --

  _graph() {
    if (this.ctx) return;
    try {
      const ctx = new AudioContext({ latencyHint: 'playback' });
      this.pre = ctx.createGain();
      this.filters = EQ_BANDS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f;
        b.Q.value = 1.1;
        return b;
      });
      this.master = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.78;
      let node = this.pre;
      for (const f of this.filters) node = node.connect(f);
      node.connect(this.master).connect(this.analyser).connect(ctx.destination);
      for (const d of this.decks) d.connect(ctx, this.pre);
      this.ctx = ctx;
      this.setEQ(this.eqName, this.customEq);
    } catch (err) {
      console.warn('Web Audio unavailable, EQ disabled', err);
    }
  }

  _gainFor(track) {
    if (!this.soundCheck || !track || typeof track.gain !== 'number') return 1;
    return Math.pow(10, clamp(track.gain, -14, 8) / 20);
  }

  _prepare(deck) {
    const t = deck.track;
    deck.audio.volume = this.volume;
    const rate = t && t.rate ? t.rate : this.rate;
    deck.audio.defaultPlaybackRate = rate;
    deck.audio.playbackRate = rate;
    deck.audio.preservesPitch = true;
    if (deck.level) deck.level.gain.value = this._gainFor(t);
    if (deck.fade) deck.fade.gain.value = 1;
  }

  // -------------------------------------------------------------- transport --

  /** Load a track on the active deck (reusing the preloaded deck when it matches). */
  load(track, { autoplay = true, at = 0 } = {}) {
    this._graph();
    this._cancelFade();
    this._endTail();
    if (this.next && this.idle.track === track && !track.live) {
      // The song we preloaded: switch decks for an instant start.
      this.deck.stop();
      this.active = 1 - this.active;
    } else {
      this.idle.stop();
      this.deck.set(track);
    }
    this.next = null;
    this._reconnects = 0;
    const deck = this.deck;
    this._prepare(deck);
    if (at > 0) {
      const seek = () => {
        if (deck.track === track) deck.audio.currentTime = Math.min(at, Math.max(0, (deck.audio.duration || at + 1) - 1));
      };
      if (deck.audio.readyState >= 1) seek();
      else deck.audio.addEventListener('loadedmetadata', seek, { once: true });
    }
    if (autoplay) this.play();
    else this.emit('state');
    this.emit('time');
  }

  async play() {
    const a = this.deck.audio;
    if (!a.getAttribute('src')) return;
    this._graph();
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
    try {
      await a.play();
    } catch (err) {
      if (err.name !== 'AbortError') this.emit('error', err);
    }
  }

  pause() {
    this.deck.audio.pause();
    if (this._fading) {
      this._fading.out.audio.pause();
      this._finishFade();
    }
  }

  stop() {
    this._cancelFade();
    this._endTail();
    for (const d of this.decks) d.stop();
    this.next = null;
    this.emit('state');
  }

  seek(sec) {
    if (!isFinite(sec) || (this.track && this.track.live)) return;
    const d = this.duration;
    this.deck.audio.currentTime = Math.max(0, d ? Math.min(sec, d - 0.25) : sec);
    if (this.next) this.invalidateNext();
  }

  setMuted(m) {
    this.deck.audio.muted = m;
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    for (const d of this.decks) d.audio.volume = this.volume;
  }

  setRate(r) {
    this.rate = clamp(r, 0.5, 3);
    const t = this.track;
    if (t && !t.rate) {
      this.deck.audio.playbackRate = this.rate;
      this.deck.audio.defaultPlaybackRate = this.rate;
    }
  }

  setTrackRate(r) {
    const t = this.track;
    if (!t) return;
    t.rate = r;
    this.deck.audio.playbackRate = r;
    this.deck.audio.defaultPlaybackRate = r;
  }

  setEQ(name, custom) {
    this.eqName = name;
    this.customEq = custom || this.customEq;
    if (!this.filters) return;
    const gains = name === 'Custom' ? this.customEq : EQ_PRESETS[name] || null;
    const max = gains ? Math.max(0, ...gains) : 0;
    const now = this.ctx.currentTime;
    this.filters.forEach((f, i) => f.gain.setTargetAtTime(gains ? gains[i] || 0 : 0, now, 0.04));
    // Pre-amp down so boosted presets don't clip.
    this.pre.gain.setTargetAtTime(Math.pow(10, (-max * 0.6) / 20), now, 0.04);
  }

  setSoundCheck(on) {
    this.soundCheck = on;
    for (const d of this.decks) if (d.level) d.level.gain.value = this._gainFor(d.track);
  }

  setCrossfade(sec) {
    this.crossfade = clamp(sec || 0, 0, 12);
  }

  /** Forget the preloaded song (the queue changed). */
  invalidateNext() {
    if (this._fading) return;
    this.next = null;
    if (!this._tail) this.idle.stop();
  }

  /** Frequency bins 0..255 for the visualizer. */
  spectrum(out) {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(out);
    return out;
  }

  // ----------------------------------------------------------- transitions --

  _tick() {
    const d = this.deck;
    const t = d.track;
    if (!t || t.live || d.audio.paused || this._fading) return;
    const dur = d.audio.duration;
    if (!isFinite(dur) || dur <= 0) return;
    const rate = d.audio.playbackRate || 1;
    const remaining = (dur - d.audio.currentTime) / rate;
    // Don't reuse the idle deck while the last song is still playing out its tail.
    if (!this.next && !this._tail && remaining < Math.max(25, this.crossfade + 12)) {
      const n = this.getNext();
      // A song that failed to preload isn't retried every tick; it gets its
      // normal chance (and error handling) when it's actually played.
      if (n && !n.live && n.src && !this._badPreloads.has(n)) {
        this.next = n;
        if (n !== t) {
          this.idle.set(n);
          this._prepare(this.idle);
        }
      }
    }
    if (!this.next) return;
    const xf = this._crossfadeFor(t, this.next, dur);
    if (xf > 0 && remaining <= xf) this._startFade(xf);
    else if (xf === 0 && remaining <= 0.045) this._advance();
  }

  _crossfadeFor(cur, next, dur) {
    if (this.crossfade <= 0 || !next || next === cur) return 0;
    const sameAlbum = cur.album && cur.album === next.album && (cur.albumArtist || cur.artist) === (next.albumArtist || next.artist);
    if (sameAlbum && next.trackNo && cur.trackNo && next.trackNo === cur.trackNo + 1) return 0;
    return Math.min(this.crossfade, dur / 3);
  }

  _advance() {
    const next = this.next;
    if (!next) return;
    this.next = null;
    if (next === this.deck.track) {
      // Repeat One: loop the same deck.
      this.deck.audio.currentTime = 0;
      this.deck.audio.play();
      this.emit('advance', next);
      return;
    }
    const out = this.deck;
    const inn = this.idle;
    this.active = 1 - this.active;
    this._prepare(inn);
    inn.audio.play().catch(() => {});
    // Let the old song play its last few milliseconds instead of cutting them
    // off; it stops by itself (or here, at the latest).
    const left = Math.max(0, (out.audio.duration - out.audio.currentTime) / (out.audio.playbackRate || 1));
    this._endTail();
    this._tail = { deck: out, timer: setTimeout(() => this._endTail(), Math.min(400, left * 1000 + 60)) };
    this.emit('advance', next);
    this.emit('state');
  }

  _endTail() {
    const t = this._tail;
    if (!t) return;
    clearTimeout(t.timer);
    this._tail = null;
    if (t.deck !== this.deck) t.deck.stop();
  }

  _startFade(sec) {
    const next = this.next;
    if (!next || !this.ctx || next === this.deck.track) return this._advance();
    this.next = null;
    const out = this.deck;
    const inn = this.idle;
    const now = this.ctx.currentTime;
    inn.fade.gain.cancelScheduledValues(now);
    inn.fade.gain.setValueAtTime(0.0001, now);
    inn.fade.gain.exponentialRampToValueAtTime(1, now + sec);
    out.fade.gain.cancelScheduledValues(now);
    out.fade.gain.setValueAtTime(out.fade.gain.value || 1, now);
    out.fade.gain.linearRampToValueAtTime(0.0001, now + sec);
    inn.audio.play().catch(() => {});
    this.active = 1 - this.active;
    this._fading = { out, timer: setTimeout(() => this._finishFade(), sec * 1000 + 80) };
    this.emit('advance', next);
    this.emit('state');
  }

  _finishFade() {
    const f = this._fading;
    if (!f) return;
    clearTimeout(f.timer);
    this._fading = null;
    f.out.stop();
    if (f.out.fade) f.out.fade.gain.value = 1;
    if (this.deck.fade) {
      this.deck.fade.gain.cancelScheduledValues(0);
      this.deck.fade.gain.value = 1;
    }
  }

  _cancelFade() {
    if (this._fading) this._finishFade();
  }

  _ended(deck) {
    if (this._tail && deck === this._tail.deck) return this._endTail();
    if (deck !== this.deck) return;
    if (this.next) return this._advance();
    if (deck.track && deck.track.live) return this._reconnects < 3 ? this._reconnect() : this.emit('error', new Error('The station stopped streaming.'));
    this.emit('ended');
  }

  _error(deck, err) {
    if (deck !== this.deck) {
      // The preload failed: remember it, so we don't hammer a broken file.
      if (deck.track) this._badPreloads.add(deck.track);
      if (this.next && deck.track === this.next) this.next = null;
      deck.stop();
      return;
    }
    if (deck.track && deck.track.live && this._reconnects < 3) return this._reconnect();
    this.emit('error', err);
  }

  /** Internet radio dropped: try to pick the stream back up. */
  _reconnect() {
    const t = this.deck.track;
    if (!t) return;
    this._reconnects++;
    this.emit('buffering', true);
    setTimeout(() => {
      if (this.deck.track !== t) return;
      this.deck.set(t);
      this._prepare(this.deck);
      this.play();
    }, 1500 * this._reconnects);
  }
}
