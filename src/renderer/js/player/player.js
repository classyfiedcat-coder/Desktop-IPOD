/**
 * One player for everything. Local songs, podcast episodes and internet
 * radio play through the AudioEngine (gapless, crossfade, EQ); Spotify plays
 * through the SpotifyEngine. The Player owns the queue (with Up Next),
 * shuffle/repeat, play counts, ratings, resume positions for podcasts and
 * audiobooks, scanning with ⏮/⏭, and the Windows media controls.
 */

import { Emitter, clamp } from '../util.js';
import { AudioEngine } from './engine.js';
import { PlayQueue } from './queue.js';

const RESUMABLE = new Set(['podcast', 'audiobook']);

export class Player extends Emitter {
  constructor(store) {
    super();
    this.store = store;
    this.engine = new AudioEngine();
    this.local = this.engine; // older call sites
    this.queue = new PlayQueue();
    this.spotify = null;
    this.source = null; // 'local' (engine) | 'spotify'
    this._seek = null;
    this._counted = false;
    this._playedMarked = false;
    this.buffering = false;

    const s = store.settings;
    const e = this.engine;
    e.setEQ(s.eq, s.customEq);
    e.setSoundCheck(s.soundCheck);
    e.setCrossfade(s.crossfade);
    e.setVolume(this.effectiveVolume);
    e.getNext = () => (this.source === 'local' ? this.queue.peekNext(this.store.settings.repeat) : null);

    e.on('advance', (track) => this._advanced(track));
    e.on('ended', () => this._ended());
    e.on('state', () => this.source === 'local' && this.emit('state'));
    e.on('buffering', (b) => {
      this.buffering = b;
      if (!b) this._errorRun = 0; // something is actually playing
      if (this.source === 'local') this.emit('buffering', b);
    });
    e.on('time', () => {
      if (this.source !== 'local') return;
      this.emit('time');
      this._progress();
    });
    e.on('duration', () => this.source === 'local' && this.emit('time'));
    e.on('error', (err) => {
      if (this.source !== 'local') return;
      const t = this.track;
      console.warn('playback error', err);
      // Skip unplayable files like the iPod does, but not forever: if song
      // after song fails (their drive is unplugged, say), stop and say so.
      this._errorRun = (this._errorRun || 0) + 1;
      const giveUp = this._errorRun >= Math.min(8, this.queue.length);
      if (t && !t.live && giveUp) {
        this._errorRun = 0;
        this.engine.stop();
        this.emit('error', 'These songs can’t be played. Is their drive connected?');
        return;
      }
      this.emit('error', t && t.live ? 'Can’t connect to this station.' : 'This song can’t be played.');
      if (t && !t.live && this.queue.length > 1) setTimeout(() => this.next({ auto: true }), 500);
    });

    store.on('change:eq', (v) => e.setEQ(v, store.settings.customEq));
    store.on('change:customEq', (v) => store.settings.eq === 'Custom' && e.setEQ('Custom', v));
    store.on('change:soundCheck', (v) => e.setSoundCheck(v));
    store.on('change:crossfade', (v) => e.setCrossfade(v));
    store.on('change:volumeLimit', () => this.setVolume(this.volume));
    store.on('change:audiobookSpeed', () => this._applyRate());
    store.on('change:podcastSpeed', () => this._applyRate());
    store.on('change:repeat', () => e.invalidateNext());

    if (window.ipod && window.ipod.radio) window.ipod.radio.onMeta((m) => this._radioMeta(m));
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
      if (this.source !== 'local' || !this.engine.playing) {
        this.engine.pause();
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
    if (this.source === 'local') return this.queue.current;
    return null;
  }

  get playing() {
    if (this.source === 'spotify') return !!(this.spotify && this.spotify.playing);
    if (this.source === 'local') return this.engine.playing;
    return false;
  }

  get position() {
    if (this._seek) return this._seek.pos;
    if (this.source === 'spotify') return this.spotify ? this.spotify.position : 0;
    if (this.source === 'local') return this.engine.position;
    return 0;
  }

  get duration() {
    if (this.source === 'spotify') return this.spotify ? this.spotify.duration : 0;
    if (this.source === 'local') return this.engine.duration;
    return 0;
  }

  get live() {
    const t = this.track;
    return !!(t && t.live);
  }

  /** {index, total} for the "3 of 12" line. */
  get queueInfo() {
    if (this.source === 'spotify') return this.spotify ? this.spotify.queueInfo : null;
    if (this.source === 'local') return this.queue.info;
    return null;
  }

  get volume() {
    return clamp(this.store.settings.volume, 0, 1);
  }

  get effectiveVolume() {
    return Math.min(this.volume, this.store.settings.volumeLimit);
  }

  get rate() {
    const t = this.track;
    if (!t || this.source !== 'local') return 1;
    return this._rateFor(t);
  }

  _rateFor(t) {
    const s = this.store.settings;
    if (t.kind === 'audiobook') return s.audiobookSpeed || 1;
    if (t.kind === 'podcast') return s.podcastSpeed || 1;
    return 1;
  }

  _applyRate() {
    const t = this.track;
    if (t && this.source === 'local') {
      t.rate = this._rateFor(t);
      this.engine.setTrackRate(t.rate);
    }
  }

  // ------------------------------------------------------------ playback --

  /**
   * Play a list starting at index. Spotify tracks pass a `context`
   * ({ uri } for albums/playlists) so Spotify keeps the queue, or `single`
   * (a song picked from search) to play just that song and let Spotify
   * decide what comes next.
   */
  async playTracks(tracks, index = 0, { shuffle, context, single = false } = {}) {
    if (!tracks || !tracks.length) return;
    index = clamp(index, 0, tracks.length - 1);
    const first = tracks[index];
    this._cancelSeek();
    this._saveBookmark();
    if (first.source === 'spotify') {
      if (!this.spotify) return;
      this.engine.pause();
      this.source = 'spotify';
      this.emit('track');
      await this.spotify.playList(tracks, index, { context, single, shuffle: shuffle || this.store.settings.shuffle });
      return;
    }
    if (this.source === 'spotify' && this.spotify) this.spotify.pause({ quiet: true });
    this.source = 'local';
    // Radio and podcasts play in list order; shuffle is for music.
    const mode = first.live || first.kind === 'podcast' ? 'off' : shuffle || this.store.settings.shuffle;
    this.queue.load(tracks, index, mode);
    this._load(true);
  }

  _load(autoplay, at) {
    const t = this.track;
    if (!t) return;
    this._counted = false;
    this._playedMarked = false;
    t.rate = this._rateFor(t);
    if (at === undefined) at = this._bookmarkFor(t);
    this.engine.setVolume(this.effectiveVolume);
    this.engine.load(t, { autoplay, at });
    if (t.live) t.startedAt = Date.now();
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
    if (this.source === 'local') {
      if (this.track && this.track.live && !this.engine.playing) return this._load(true, 0);
      return this.engine.play();
    }
    if (this.spotify && this.spotify.track) {
      this.source = 'spotify';
      this.spotify.resume();
      this.emit('track');
    }
  }

  pause() {
    if (this.source === 'spotify') return this.spotify && this.spotify.pause();
    if (this.source === 'local') {
      this.engine.pause();
      this._saveBookmark();
    }
    this._saveSession();
  }

  next({ auto = false } = {}) {
    this._cancelSeek();
    if (this.source === 'spotify') return this.spotify && this.spotify.next();
    if (this.source !== 'local') return;
    const t = this.track;
    if (!auto && t && !t.live && this.engine.position < this.engine.duration * 0.5) this._skip(t);
    this._saveBookmark();
    const wasPlaying = auto || this.playing;
    const res = this.queue.advance({ repeat: this.store.settings.repeat, auto });
    if (!res.track) return this.stop();
    if (res.same) {
      this.engine.seek(0);
      this.engine.play();
      this._counted = false;
      return;
    }
    if (res.stop && auto) {
      // End of the list: stop, ready at the first song (Now Playing closes).
      return this.stop();
    }
    this._load(wasPlaying && !res.stop, res.stop ? 0 : undefined);
  }

  prev() {
    this._cancelSeek();
    if (this.source === 'spotify') return this.spotify && this.spotify.prev();
    if (this.source !== 'local') return;
    const t = this.track;
    if (!t) return;
    if ((!t.live && this.engine.position > 3) || (this.queue.pos <= 0 && !this.queue.interject)) {
      if (t.live) return;
      this.engine.seek(0);
      if (!this.playing) this.emit('time');
      return;
    }
    this._saveBookmark();
    const wasPlaying = this.playing;
    this.queue.back();
    this._load(wasPlaying, 0);
  }

  /** Jump to an entry of the current list (from the Up Next screen). */
  jumpTo(orderIndex) {
    if (this.source !== 'local') return;
    if (this.queue.jumpTo(orderIndex)) this._load(true);
  }

  playUpNextAt(i) {
    const t = this.queue.upNext[i];
    if (!t) return;
    this.queue.upNext.splice(i, 1);
    this.queue.interject = t;
    this._load(true);
  }

  stop() {
    this._saveBookmark();
    this.engine.stop();
    this.queue.clear();
    this.source = null;
    this.emit('track');
    this.emit('state');
    this.emit('stopped');
    this._saveSession();
  }

  seek(sec) {
    if (this.source === 'spotify') return this.spotify && this.spotify.seek(sec);
    if (this.source === 'local') {
      this.engine.seek(sec);
      this.emit('time');
    }
  }

  /** Hold ⏭/⏮: scan through the song, faster the longer you hold. */
  seekStart(dir) {
    if (!this.track || this.live) return;
    this._cancelSeek();
    const start = performance.now();
    const st = { dir, pos: this.position };
    this._seek = st;
    if (this.source === 'local') this.engine.setMuted(true);
    st.timer = setInterval(() => {
      const held = (performance.now() - start) / 1000;
      const rate = held > 4 ? 24 : held > 2 ? 10 : 5;
      st.pos = clamp(st.pos + dir * rate * 0.1, 0, Math.max(0, this.duration - 0.5));
      if (this.source === 'local') this.engine.seek(st.pos);
      this.emit('time');
    }, 100);
  }

  seekEnd() {
    const st = this._seek;
    if (!st) return;
    this._cancelSeek();
    if (this.source === 'local') this.engine.seek(st.pos);
    else if (this.source === 'spotify' && this.spotify) this.spotify.seek(st.pos);
    this.emit('time');
  }

  _cancelSeek() {
    if (this._seek) {
      clearInterval(this._seek.timer);
      this._seek = null;
      this.engine.setMuted(false);
    }
  }

  setVolume(v) {
    v = clamp(v, 0, 1);
    this.store.set('volume', v);
    const eff = this.effectiveVolume;
    this.engine.setVolume(eff);
    if (this.source === 'spotify' && this.spotify) this.spotify.setVolume(eff);
    this.emit('volume', v);
  }

  setShuffle(mode) {
    this.store.set('shuffle', mode);
    if (this.source === 'local' && this.queue.length) {
      this.queue.setMode(mode);
      this.engine.invalidateNext();
      this.emit('track');
    } else if (this.source === 'spotify' && this.spotify) {
      this.spotify.setShuffle(mode !== 'off');
    }
  }

  setRepeat(mode) {
    this.store.set('repeat', mode);
    if (this.source === 'spotify' && this.spotify) this.spotify.setRepeat(mode === 'one' ? 'track' : mode === 'all' ? 'context' : 'off');
  }

  // --------------------------------------------------------------- up next --

  /** "Play Next": local songs go to the iPod's Up Next, Spotify songs to Spotify's queue. */
  async playNext(tracks, { last = false } = {}) {
    tracks = (Array.isArray(tracks) ? tracks : [tracks]).filter(Boolean);
    if (!tracks.length) return false;
    if (tracks[0].source === 'spotify') {
      if (!this.spotify) return false;
      for (const t of tracks) await this.spotify.addToQueue(t);
      return true;
    }
    if (!this.track || this.source !== 'local') {
      await this.playTracks(tracks, 0);
      return true;
    }
    if (last) this.queue.addToUpNext(tracks);
    else this.queue.playNext(tracks);
    this.engine.invalidateNext();
    this.emit('queue');
    return true;
  }

  addToUpNext(tracks) {
    return this.playNext(tracks, { last: true });
  }

  removeUpNext(i) {
    this.queue.removeUpNext(i);
    this.engine.invalidateNext();
    this.emit('queue');
  }

  clearUpNext() {
    this.queue.clearUpNext();
    this.engine.invalidateNext();
    this.emit('queue');
  }

  // ------------------------------------------------------------ internals --

  _advanced() {
    // The engine moved to the preloaded song on its own.
    const prev = this.track;
    if (prev && !this._counted) this._countPlay(prev);
    this._markPlayed(prev);
    const res = this.queue.advance({ repeat: this.store.settings.repeat, auto: true });
    if (!res.track) return;
    this._counted = false;
    this._playedMarked = false;
    this.emit('track');
    this.emit('state');
    this._updateMediaSession();
    this._saveSession();
  }

  _ended() {
    if (this.source !== 'local') return;
    const t = this.track;
    if (t && !this._counted) this._countPlay(t);
    this._markPlayed(t);
    if (t && RESUMABLE.has(t.kind)) this._clearBookmark(t);
    this.next({ auto: true });
  }

  _progress() {
    const t = this.track;
    if (!t || t.live) return;
    const d = this.engine.duration;
    const p = this.engine.position;
    if (!d) return;
    if (!this._counted && p / d > 0.5) {
      this._counted = true;
      this._countPlay(t);
    }
    if (!this._playedMarked && p / d > 0.95) this._markPlayed(t);
    if (RESUMABLE.has(t.kind)) {
      const now = Date.now();
      if (!this._bmAt || now - this._bmAt > 5000) {
        this._bmAt = now;
        this._saveBookmark();
      }
    }
  }

  _bookmarkFor(t) {
    if (!RESUMABLE.has(t.kind)) return 0;
    const at = this.store.user.bookmarks[t.id] || 0;
    const d = t.duration || 0;
    return at > 5 && (!d || at < d - 15) ? at : 0;
  }

  _saveBookmark() {
    const t = this.source === 'local' ? this.track : null;
    if (!t || !RESUMABLE.has(t.kind)) return;
    const p = this.engine.position;
    if (p > 5) {
      this.store.user.bookmarks[t.id] = Math.round(p);
      this.store.touchUser();
    }
  }

  _clearBookmark(t) {
    delete this.store.user.bookmarks[t.id];
    this.store.touchUser();
  }

  _markPlayed(t) {
    if (!t || this._playedMarked || t.live) return;
    this._playedMarked = true;
    if (t.kind === 'podcast' || t.kind === 'audiobook') {
      this.store.user.played[t.id] = Date.now();
      this.store.touchUser();
      this.emit('played', t);
    }
  }

  _countPlay(t) {
    if (!t || t.live) return;
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

  _radioMeta(m) {
    const t = this.track;
    if (!t || !t.live || m.sid !== t.sid) return;
    if (m.station && !t.stationName) t.stationName = m.station;
    if (m.StreamTitle !== undefined) {
      const title = (m.title || '').trim();
      const artist = (m.artist || '').trim();
      t.title = title || t.stationName || t.station.name;
      t.artist = artist || (title ? t.station.name : t.stationTags || 'Live Radio');
      t.album = t.station.name;
      t.nowPlaying = m.StreamTitle;
      this.emit('meta', t);
      this._updateMediaSession();
    }
  }

  // ---------------------------------------------------------------- extras --

  get rating() {
    const t = this.track;
    return t && t.source === 'local' ? this.store.rating(t.id) : 0;
  }

  setRating(r) {
    const t = this.track;
    if (!t || t.source !== 'local') return;
    this.store.user.ratings[t.id] = clamp(r, 0, 5);
    this.store.touchUser();
    this.emit('rating');
  }

  addToOnTheGo(track) {
    if (!track || track.source !== 'local') return false;
    this.store.user.otg.push(track.id);
    this.store.touchUser();
    return true;
  }

  _saveSession() {
    if (this.source !== 'local' || !this.queue.length) return;
    const cur = this.track;
    if (cur && cur.source !== 'local') return; // only local music queues are restored
    this.store.user.lastSession = { ...this.queue.serialize(), at: this.engine.position };
    this.store.touchUser();
  }

  /** Bring back the last local queue (paused), like an iPod waking up. */
  restoreSession(library) {
    const s = this.store.user.lastSession;
    if (!s || !s.ids) return;
    if (!this.queue.restore(s, (id) => library.get(id))) return;
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
      ms.setActionHandler('seekforward', () => this.seek(this.position + 15));
      ms.setActionHandler('seekbackward', () => this.seek(this.position - 15));
    } catch {
      /* unsupported */
    }
    window.addEventListener('beforeunload', () => {
      this._saveBookmark();
      this._saveSession();
    });
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
