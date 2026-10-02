/**
 * One player for everything: local files (LocalEngine) and Spotify
 * (SpotifyEngine). Handles the queue, shuffle/repeat, play counts, ratings,
 * seeking by holding ⏮/⏭, and Windows media controls via MediaSession.
 */

import { Emitter, shuffled, clamp } from '../util.js';
import { LocalEngine } from './local-engine.js';

export class Player extends Emitter {
  constructor(store) {
    super();
    this.store = store;
    this.local = new LocalEngine();
    this.spotify = null;
    this.source = null; // 'local' | 'spotify'
    this.queue = [];
    this.order = [];
    this.pos = -1;
    this._seek = null;
    this._counted = false;

    const s = store.settings;
    this.local.setEQ(s.eq);
    this.local.setSoundCheck(s.soundCheck);
    this.local.setVolume(this.volume);

    this.local.on('ended', () => this._ended());
    this.local.on('state', () => this.source === 'local' && this.emit('state'));
    this.local.on('time', () => {
      if (this.source !== 'local') return;
      this.emit('time');
      if (!this._counted && this.local.duration && this.local.position / this.local.duration > 0.5) {
        this._counted = true;
        this._countPlay(this.track);
      }
    });
    this.local.on('duration', () => this.source === 'local' && this.emit('time'));
    this.local.on('error', (err) => {
      if (this.source !== 'local') return;
      console.warn('playback error', err);
      this.emit('error', 'This song can’t be played.');
      // Skip unplayable files like the iPod does.
      if (this.queue.length > 1) setTimeout(() => this.next({ auto: true }), 400);
    });

    store.on('change:eq', (v) => this.local.setEQ(v));
    store.on('change:soundCheck', (v) => this.local.setSoundCheck(v));
    store.on('change:volumeLimit', () => this.setVolume(this.volume));
    store.on('change:audiobookSpeed', (v) => {
      const t = this.source === 'local' && this.track;
      if (t && t.kind === 'audiobook') this.local.audio.playbackRate = v || 1;
    });
    this._initMediaSession();
  }

  attachSpotify(engine) {
    this.spotify = engine;
    engine.on('state', () => this.source === 'spotify' && this.emit('state'));
    engine.on('time', () => this.source === 'spotify' && this.emit('time'));
    engine.on('track', () => {
      if (this.source === 'spotify') {
        this.emit('track');
        this._updateMediaSession();
      }
    });
    engine.on('takeover', () => {
      // Something started playing on Spotify while we were idle: follow it.
      if (this.source !== 'local' || !this.local.playing) {
        this.local.pause();
        this.source = 'spotify';
        this.emit('track');
        this.emit('state');
      }
    });
    engine.on('error', (msg) => this.emit('error', msg));
  }

  // ------------------------------------------------------------- getters --

  get track() {
    if (this.source === 'spotify') return this.spotify ? this.spotify.track : null;
    if (this.source === 'local') return this.queue[this.order[this.pos]] || null;
    return null;
  }

  get playing() {
    if (this.source === 'spotify') return !!(this.spotify && this.spotify.playing);
    if (this.source === 'local') return this.local.playing;
    return false;
  }

  get position() {
    if (this._seek) return this._seek.pos;
    if (this.source === 'spotify') return this.spotify ? this.spotify.position : 0;
    if (this.source === 'local') return this.local.position;
    return 0;
  }

  get duration() {
    if (this.source === 'spotify') return this.spotify ? this.spotify.duration : 0;
    if (this.source === 'local') return this.local.duration;
    return 0;
  }

  /** {index, total} for the "3 of 12" line. */
  get queueInfo() {
    if (this.source === 'spotify') return this.spotify ? this.spotify.queueInfo : null;
    if (this.source === 'local' && this.pos >= 0) return { index: this.pos + 1, total: this.order.length };
    return null;
  }

  get volume() {
    return clamp(this.store.settings.volume, 0, 1);
  }

  get effectiveVolume() {
    return Math.min(this.volume, this.store.settings.volumeLimit);
  }

  // ------------------------------------------------------------ playback --

  /**
   * Play a list of tracks starting at index.
   * Spotify tracks pass a `context` ({ uri } for albums/playlists) so the
   * Spotify app keeps the queue; otherwise up to 200 URIs are sent.
   */
  async playTracks(tracks, index = 0, { shuffle, context } = {}) {
    if (!tracks || !tracks.length) return;
    index = clamp(index, 0, tracks.length - 1);
    const first = tracks[index];
    this._cancelSeek();
    if (first.source === 'spotify') {
      if (!this.spotify) return;
      this.local.pause();
      this.source = 'spotify';
      this.emit('track');
      await this.spotify.playList(tracks, index, { context, shuffle: shuffle || this.store.settings.shuffle });
      return;
    }
    if (this.source === 'spotify' && this.spotify) this.spotify.pause({ quiet: true });
    this.source = 'local';
    this.queue = tracks.slice();
    const { order, pos } = this._buildOrder(index, shuffle || this.store.settings.shuffle);
    this.order = order;
    this.pos = pos;
    this._load(true);
  }

  /** Returns { order, pos } for the queue starting at startIdx. */
  _buildOrder(startIdx, mode) {
    const n = this.queue.length;
    const idx = [...Array(n).keys()];
    if (mode === 'songs') {
      return { order: [startIdx, ...shuffled(idx.filter((i) => i !== startIdx))], pos: 0 };
    }
    if (mode === 'albums') {
      const groups = new Map();
      idx.forEach((i) => {
        const t = this.queue[i];
        const k = `${t.albumArtist}\u0000${t.album}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(i);
      });
      const st = this.queue[startIdx];
      const startKey = `${st.albumArtist}\u0000${st.album}`;
      const first = groups.get(startKey);
      groups.delete(startKey);
      const fromStart = first.slice(first.indexOf(startIdx));
      return { order: [...fromStart, ...shuffled([...groups.values()]).flat()], pos: 0 };
    }
    return { order: idx, pos: startIdx };
  }

  _load(autoplay, at = 0) {
    const t = this.track;
    if (!t) return;
    this._counted = false;
    this.local.load(t);
    this.local.setVolume(this.effectiveVolume);
    const rate = t.kind === 'audiobook' ? this.store.settings.audiobookSpeed || 1 : 1;
    this.local.audio.defaultPlaybackRate = rate;
    this.local.audio.playbackRate = rate;
    if (at) this.local.audio.addEventListener('loadedmetadata', () => this.local.seek(at), { once: true });
    if (autoplay) this.local.play();
    this.emit('track');
    this.emit('state');
    this._updateMediaSession();
    this._saveSession();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  play() {
    if (this.source === 'spotify') return this.spotify && this.spotify.resume();
    if (this.source === 'local') return this.local.play();
    // Nothing queued: resume Spotify if it has something, like the iPod resuming last song.
    if (this.spotify && this.spotify.track) {
      this.source = 'spotify';
      this.spotify.resume();
      this.emit('track');
    }
  }

  pause() {
    if (this.source === 'spotify') return this.spotify && this.spotify.pause();
    if (this.source === 'local') this.local.pause();
    this._saveSession();
  }

  next({ auto = false } = {}) {
    this._cancelSeek();
    if (this.source === 'spotify') return this.spotify && this.spotify.next();
    if (this.source !== 'local') return;
    const t = this.track;
    if (!auto && t && this.local.position < this.local.duration * 0.5) this._skip(t);
    if (auto && this.store.settings.repeat === 'one') {
      this.local.seek(0);
      this.local.play();
      this._counted = false;
      return;
    }
    if (this.pos + 1 >= this.order.length) {
      if (this.store.settings.repeat === 'all' || this.store.settings.repeat === 'one') {
        if (this.store.settings.shuffle === 'songs') this.order = shuffled(this.order);
        this.pos = 0;
        this._load(true);
      } else if (auto) {
        this.stop();
      } else {
        this.pos = 0;
        this._load(false);
      }
      return;
    }
    const wasPlaying = auto || this.playing;
    this.pos++;
    this._load(wasPlaying);
  }

  prev() {
    this._cancelSeek();
    if (this.source === 'spotify') return this.spotify && this.spotify.prev();
    if (this.source !== 'local') return;
    if (this.local.position > 3 || this.pos === 0) {
      this.local.seek(0);
      if (!this.playing) this.emit('time');
      return;
    }
    const wasPlaying = this.playing;
    this.pos--;
    this._load(wasPlaying);
  }

  stop() {
    this.local.stop();
    this.queue = [];
    this.order = [];
    this.pos = -1;
    this.source = null;
    this.emit('track');
    this.emit('state');
    this.emit('stopped');
    this._saveSession();
  }

  seek(sec) {
    if (this.source === 'spotify') return this.spotify && this.spotify.seek(sec);
    if (this.source === 'local') {
      this.local.seek(sec);
      this.emit('time');
    }
  }

  /** Hold ⏭/⏮: scan through the song, faster the longer you hold. */
  seekStart(dir) {
    if (!this.track) return;
    this._cancelSeek();
    const start = performance.now();
    const st = { dir, pos: this.position, wasPlaying: this.playing };
    this._seek = st;
    if (this.source === 'local') this.local.audio.muted = true;
    st.timer = setInterval(() => {
      const held = (performance.now() - start) / 1000;
      const rate = held > 4 ? 24 : held > 2 ? 10 : 5;
      st.pos = clamp(st.pos + dir * rate * 0.1, 0, Math.max(0, this.duration - 0.5));
      if (this.source === 'local') this.local.seek(st.pos);
      this.emit('time');
    }, 100);
  }

  seekEnd() {
    const st = this._seek;
    if (!st) return;
    this._cancelSeek();
    if (this.source === 'local') {
      this.local.audio.muted = false;
      this.local.seek(st.pos);
    } else if (this.source === 'spotify' && this.spotify) {
      this.spotify.seek(st.pos);
    }
    this.emit('time');
  }

  _cancelSeek() {
    if (this._seek) {
      clearInterval(this._seek.timer);
      this._seek = null;
      this.local.audio.muted = false;
    }
  }

  setVolume(v) {
    v = clamp(v, 0, 1);
    this.store.set('volume', v);
    const eff = this.effectiveVolume;
    this.local.setVolume(eff);
    if (this.source === 'spotify' && this.spotify) this.spotify.setVolume(eff);
    this.emit('volume', v);
  }

  setShuffle(mode) {
    this.store.set('shuffle', mode);
    if (this.source === 'local' && this.queue.length) {
      const cur = this.order[this.pos];
      const { order, pos } = this._buildOrder(cur, mode);
      this.order = order;
      this.pos = pos;
      this.emit('track');
    } else if (this.source === 'spotify' && this.spotify) {
      this.spotify.setShuffle(mode !== 'off');
    }
  }

  setRepeat(mode) {
    this.store.set('repeat', mode);
    if (this.source === 'spotify' && this.spotify) this.spotify.setRepeat(mode === 'one' ? 'track' : mode === 'all' ? 'context' : 'off');
  }

  _ended() {
    if (this.source !== 'local') return;
    const t = this.track;
    if (t && !this._counted) this._countPlay(t);
    this.next({ auto: true });
  }

  _countPlay(t) {
    if (!t || t.source !== 'local') return;
    const u = this.store.user;
    u.plays[t.id] = (u.plays[t.id] || 0) + 1;
    u.lastPlayed[t.id] = Date.now();
    this.store.touchUser();
  }

  _skip(t) {
    if (!t || t.source !== 'local') return;
    const u = this.store.user;
    u.skips[t.id] = (u.skips[t.id] || 0) + 1;
    this.store.touchUser();
  }

  // -------------------------------------------------------------- extras --

  get rating() {
    const t = this.track;
    return t && t.source === 'local' ? this.store.user.ratings[t.id] || 0 : 0;
  }

  setRating(r) {
    const t = this.track;
    if (!t || t.source !== 'local') return;
    this.store.user.ratings[t.id] = clamp(r, 0, 5);
    this.store.touchUser();
    this.emit('rating');
  }

  addToOnTheGo(track) {
    if (!track) return false;
    const u = this.store.user;
    if (track.source === 'local') {
      u.otg.push(track.id);
      this.store.touchUser();
      return true;
    }
    return false;
  }

  _saveSession() {
    if (this.source !== 'local' || !this.queue.length) return;
    const u = this.store.user;
    const ids = this.queue.slice(0, 2000).map((t) => t.id);
    u.lastSession = { ids, order: this.order.filter((i) => i < ids.length), pos: this.pos, at: this.local.position };
    this.store.touchUser();
  }

  /** Bring back the last local queue (paused), like an iPod waking up. */
  restoreSession(library) {
    const s = this.store.user.lastSession;
    if (!s || !s.ids || !s.ids.length) return;
    const tracks = s.ids.map((id) => library.get(id));
    if (tracks.some((t) => !t)) return;
    this.queue = tracks;
    this.order = s.order && s.order.length ? s.order : [...tracks.keys()];
    this.pos = clamp(s.pos || 0, 0, this.order.length - 1);
    this.source = 'local';
    this._load(false, s.at || 0);
  }

  _initMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => this.play());
    ms.setActionHandler('pause', () => this.pause());
    ms.setActionHandler('nexttrack', () => this.next());
    ms.setActionHandler('previoustrack', () => this.prev());
    try {
      ms.setActionHandler('seekto', (d) => this.seek(d.seekTime));
    } catch {
      /* unsupported */
    }
    window.addEventListener('beforeunload', () => this._saveSession());
    setInterval(() => this.playing && this._saveSession(), 15000);
  }

  _updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = this.track;
    if (!t) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const meta = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: [] });
    navigator.mediaSession.metadata = meta;
    if (!t.art) return;
    if (/^(https?|data|blob):/.test(t.art)) {
      meta.artwork = [{ src: t.art, sizes: '300x300', type: 'image/jpeg' }];
      return;
    }
    // Windows media controls only accept http(s)/data/blob artwork.
    fetch(t.art)
      .then((r) => r.blob())
      .then((blob) => {
        if (navigator.mediaSession.metadata !== meta) return;
        if (this._artBlob) URL.revokeObjectURL(this._artBlob);
        this._artBlob = URL.createObjectURL(blob);
        meta.artwork = [{ src: this._artBlob, sizes: '500x500', type: blob.type || 'image/jpeg' }];
      })
      .catch(() => {});
  }
}
