/** Spotify playback: as a Connect speaker (Web Playback SDK, needs Widevine) or as a remote for the Spotify app (Web API). */

import { Emitter, sleep, throttle } from '../util.js';
import { normTrack } from '../library/spotify.js';

async function hasWidevine() {
  if (!navigator.requestMediaKeySystemAccess) return false;
  try {
    await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
      { initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4;codecs="mp4a.40.2"' }] },
    ]);
    return true;
  } catch {
    return false;
  }
}

export class SpotifyEngine extends Emitter {
  constructor(api, store) {
    super();
    this.api = api;
    this.store = store;
    this.track = null;
    this.playing = false;
    this._pos = 0;
    this._posAt = performance.now();
    this._dur = 0;
    this.device = null;
    this.list = null;
    this.contextUri = null;
    this.shuffleState = false;
    this.repeatState = 'off';
    this.sdk = { supported: false, ready: false, deviceId: null, player: null, error: null };
    this.active = false; // true while the iPod is the one driving playback
    this._pollTimer = null;
    this._busyUntil = 0;
    this._volume = throttle((v) => this._sendVolume(v), 300);
  }

  async init() {
    this.api.on('status', (s) => {
      if (s.connected) this.start();
      else this.stopPolling();
    });
    if (this.api.connected) this.start();
  }

  async start() {
    this._schedule(400);
    if (this.store.settings.spotifyOutput !== 'connect' && !this.sdk.player) {
      this.sdk.supported = await hasWidevine();
      if (this.sdk.supported) this._initSDK();
    }
  }

  stopPolling() {
    clearTimeout(this._pollTimer);
    this._pollTimer = null;
  }

  // ------------------------------------------------------------------ SDK --

  _initSDK() {
    const boot = () => {
      const Player = window.Spotify && window.Spotify.Player;
      if (!Player) return;
      const player = new Player({
        name: 'iPod',
        getOAuthToken: (cb) => window.ipod.spotify.token().then((t) => cb(t)),
        volume: Math.min(this.store.settings.volume, this.store.settings.volumeLimit),
      });
      this.sdk.player = player;
      player.addListener('ready', ({ device_id: id }) => {
        this.sdk.ready = true;
        this.sdk.deviceId = id;
        this.emit('devices');
      });
      player.addListener('not_ready', () => {
        this.sdk.ready = false;
      });
      player.addListener('player_state_changed', (state) => this._fromSDK(state));
      const fail = (kind) => ({ message }) => {
        this.sdk.error = `${kind}: ${message}`;
        console.warn('Spotify SDK', kind, message);
        if (kind === 'account') this.emit('error', 'Playing on the iPod needs Spotify Premium.');
      };
      player.addListener('initialization_error', fail('init'));
      player.addListener('authentication_error', fail('auth'));
      player.addListener('account_error', fail('account'));
      player.addListener('playback_error', fail('playback'));
      player.connect();
    };
    if (window.Spotify && window.Spotify.Player) return boot();
    window.onSpotifyWebPlaybackSDKReady = boot;
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => {
      this.sdk.error = 'Could not load the Spotify player.';
    };
    document.head.append(s);
  }

  _fromSDK(state) {
    if (!state || !this.active) return;
    const cur = state.track_window && state.track_window.current_track;
    if (cur) {
      const t = normTrack({ ...cur, album: { ...cur.album, images: cur.album && cur.album.images } });
      if (!this.track || this.track.uri !== t.uri) {
        this.track = t;
        this.emit('track');
      }
    }
    this._pos = state.position / 1000;
    this._posAt = performance.now();
    this._dur = state.duration / 1000;
    const playing = !state.paused;
    if (playing !== this.playing) {
      this.playing = playing;
      this.emit('state');
    }
    this.emit('time');
  }

  // ------------------------------------------------------------ polling --

  _schedule(ms) {
    clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(() => this.refresh(), ms);
  }

  async refresh() {
    if (!this.api.connected) return;
    // Poll often while in use, rarely otherwise (rate limits; this runs all day).
    let next = this.active ? (this.playing ? 1500 : 3000) : 20000;
    if (document.hidden) next = Math.max(next, this.active && this.playing ? 5000 : 30000);
    if (performance.now() < this._busyUntil) {
      this._schedule(600);
      return;
    }
    try {
      const st = await this.api.playerState();
      this._fromState(st);
    } catch (err) {
      if (err.status === 401) next = 20000;
      else if (err.status === 429) next = 15000;
    }
    this._schedule(next);
  }

  _fromState(st) {
    if (!st || !st.item) {
      if (this.playing) {
        this.playing = false;
        this.emit('state');
      }
      return;
    }
    const usingSDK = this.sdk.ready && st.device && st.device.id === this.sdk.deviceId;
    this.device = st.device || null;
    const t = normTrack(st.item);
    const changed = !this.track || this.track.uri !== t.uri;
    if (changed) this.track = t;
    this._dur = (st.item.duration_ms || 0) / 1000;
    if (!usingSDK || !this.active) {
      this._pos = (st.progress_ms || 0) / 1000;
      this._posAt = performance.now();
    }
    this.shuffleState = !!st.shuffle_state;
    this.repeatState = st.repeat_state || 'off';
    this.contextUri = (st.context && st.context.uri) || this.contextUri;
    const playing = !!st.is_playing;
    const stateChanged = playing !== this.playing;
    this.playing = playing;
    if (!this.active && playing) {
      // Music started from the Spotify app itself: let the iPod show it.
      this.active = true;
      this.list = null;
      this.emit('takeover');
    }
    if (changed) this.emit('track');
    if (stateChanged) this.emit('state');
    this.emit('time');
  }

  // ------------------------------------------------------------ getters --

  get position() {
    const p = this.playing ? this._pos + (performance.now() - this._posAt) / 1000 : this._pos;
    return Math.max(0, this._dur ? Math.min(p, this._dur) : p);
  }

  get duration() {
    return this._dur || (this.track && this.track.duration) || 0;
  }

  get queueInfo() {
    if (!this.track || !this.list) return null;
    const i = this.list.findIndex((t) => t.uri === this.track.uri);
    return i >= 0 ? { index: i + 1, total: this.list.length } : null;
  }

  get deviceName() {
    if (this.sdk.ready && this.device && this.device.id === this.sdk.deviceId) return 'This iPod';
    return this.device ? this.device.name : null;
  }

  // ------------------------------------------------------------ control --

  async _targetDevice({ wait = true } = {}) {
    const mode = this.store.settings.spotifyOutput;
    if (mode !== 'connect' && this.sdk.ready) return this.sdk.deviceId;
    let devices = [];
    try {
      devices = await this.api.devices();
    } catch {
      devices = [];
    }
    const pick = (list) => {
      const pref = this.store.settings.spotifyDevice;
      return (
        (pref && list.find((d) => d.id === pref)) ||
        list.find((d) => d.is_active) ||
        list.find((d) => d.type === 'Computer' && !d.is_restricted) ||
        list.find((d) => !d.is_restricted)
      );
    };
    let d = pick(devices);
    if (d) return d.id;
    if (!wait) return null;
    // Nothing to play on: start the Spotify app on this PC and wait for it.
    this.emit('notice', 'Opening Spotify…');
    window.ipod.spotify.openApp();
    for (let i = 0; i < 10; i++) {
      await sleep(1500);
      try {
        devices = await this.api.devices();
      } catch {
        devices = [];
      }
      d = pick(devices);
      if (d) return d.id;
    }
    throw new Error('No Spotify device found. Open Spotify on this PC or your phone, then try again.');
  }

  _explain(err) {
    if (err.status === 403) return 'Spotify Premium is needed to control playback.';
    if (err.status === 404) return 'Spotify isn’t open on any device.';
    if (err.status === 401) return 'Reconnect Spotify in Settings.';
    return err.message || 'Spotify had a problem.';
  }

  _optimistic(fields) {
    Object.assign(this, fields);
    this._busyUntil = performance.now() + 1200;
  }

  /** Play from a list: a context keeps Spotify's queue; `single` plays the song, then a mix like it (else its album). */
  async playList(tracks, index, { context, shuffle, single = false } = {}) {
    this.active = true;
    this.list = single ? null : tracks;
    this.track = tracks[index];
    this._pos = 0;
    this._posAt = performance.now();
    this._dur = tracks[index].duration || 0;
    this.playing = true;
    this.emit('track');
    this.emit('state');
    this._busyUntil = performance.now() + 2500;
    try {
      const t = tracks[index];
      const like = single ? this._songsLike(t) : null;
      const deviceId = await this._targetDevice();
      const want = shuffle && shuffle !== 'off';
      if (!single && want !== this.shuffleState) {
        await this.api.shuffle(want, deviceId).catch(() => {});
        this.shuffleState = want;
      }
      if (single) {
        const after = await like;
        if (!after.length && t.albumUri) {
          await this.api.play({ deviceId, contextUri: t.albumUri, offset: { uri: t.uri } });
          this.contextUri = t.albumUri;
        } else {
          await this.api.play({ deviceId, uris: [t.uri, ...after.map((x) => x.uri)] });
          this.contextUri = null;
        }
      } else if (context && context.uri) {
        await this.api.play({ deviceId, contextUri: context.uri, offset: { uri: t.uri } });
        this.contextUri = context.uri;
      } else {
        const start = Math.max(0, index - 20);
        const uris = tracks.slice(start, start + 200).map((x) => x.uri);
        await this.api.play({ deviceId, uris, offset: { position: index - start } });
        this.contextUri = null;
      }
      this._busyUntil = performance.now() + 800;
      this._schedule(900);
    } catch (err) {
      console.warn(err);
      this.playing = false;
      this.emit('state');
      this.emit('error', this._explain(err));
    }
  }

  /** What to play after a song picked on its own; waits at most a few seconds. */
  _songsLike(track) {
    const timeout = new Promise((resolve) => setTimeout(() => resolve([]), 4000));
    return Promise.race([this.api.songsLike(track).catch(() => []), timeout]);
  }

  async playContext(contextUri, { offsetUri, positionMs } = {}) {
    this.active = true;
    try {
      const deviceId = await this._targetDevice();
      await this.api.play({ deviceId, contextUri, offset: offsetUri ? { uri: offsetUri } : undefined, positionMs });
      this.contextUri = contextUri;
      this._schedule(700);
    } catch (err) {
      this.emit('error', this._explain(err));
    }
  }

  async resume() {
    this.active = true;
    this._optimistic({ playing: true, _pos: this.position, _posAt: performance.now() });
    this.emit('state');
    try {
      if (this.sdk.ready && this.device && this.device.id === this.sdk.deviceId) {
        await this.sdk.player.resume();
      } else {
        const deviceId = await this._targetDevice();
        const transfer = !this.device || this.device.id !== deviceId;
        if (transfer) await this.api.transfer(deviceId, true);
        else await this.api.play({ deviceId });
      }
    } catch (err) {
      this.playing = false;
      this.emit('state');
      this.emit('error', this._explain(err));
    }
    this._schedule(800);
  }

  async pause({ quiet = false } = {}) {
    if (!this.playing && quiet) return;
    this._optimistic({ _pos: this.position, _posAt: performance.now(), playing: false });
    this.emit('state');
    try {
      if (this.sdk.ready && this.device && this.device.id === this.sdk.deviceId) await this.sdk.player.pause();
      else await this.api.pause();
    } catch (err) {
      if (!quiet && err.status !== 404) this.emit('error', this._explain(err));
    }
    this._schedule(900);
  }

  async next() {
    this._busyUntil = performance.now() + 900;
    this._advanceLocally(1);
    try {
      await this.api.next();
    } catch (err) {
      this.emit('error', this._explain(err));
    }
    this._schedule(700);
  }

  async prev() {
    if (this.position > 3) return this.seek(0);
    this._busyUntil = performance.now() + 900;
    this._advanceLocally(-1);
    try {
      await this.api.previous();
    } catch (err) {
      this.emit('error', this._explain(err));
    }
    this._schedule(700);
  }

  /** Show the next/previous song instantly instead of waiting for the API. */
  _advanceLocally(dir) {
    if (!this.list || !this.track || this.shuffleState) return;
    const i = this.list.findIndex((t) => t.uri === this.track.uri);
    const n = this.list[i + dir];
    if (!n) return;
    this.track = n;
    this._pos = 0;
    this._posAt = performance.now();
    this._dur = n.duration || 0;
    this.emit('track');
  }

  async seek(sec) {
    this._optimistic({ _pos: sec, _posAt: performance.now() });
    this.emit('time');
    try {
      await this.api.seek(sec * 1000);
    } catch (err) {
      this.emit('error', this._explain(err));
    }
  }

  setVolume(v) {
    if (this.sdk.ready && this.device && this.device.id === this.sdk.deviceId) {
      this.sdk.player.setVolume(v);
      return;
    }
    this._volume(v);
  }

  async _sendVolume(v) {
    try {
      await this.api.volume(v * 100);
    } catch (err) {
      if (err.status === 403) this.emit('error', 'This device doesn’t allow volume control.');
    }
  }

  async setShuffle(on) {
    this.shuffleState = on;
    try {
      await this.api.shuffle(on);
    } catch {
      /* ignore */
    }
  }

  async setRepeat(state) {
    this.repeatState = state;
    try {
      await this.api.repeat(state);
    } catch {
      /* ignore */
    }
  }

  async transferTo(deviceId) {
    this.active = true;
    if (deviceId === this.sdk.deviceId) this.store.set('spotifyOutput', 'ipod');
    else {
      this.store.set('spotifyOutput', 'connect');
      this.store.set('spotifyDevice', deviceId);
    }
    await this.api.transfer(deviceId, true);
    this._schedule(800);
  }

  async addToQueue(track) {
    try {
      await this.api.addToQueue(track.uri);
      return true;
    } catch (err) {
      this.emit('error', this._explain(err));
      return false;
    }
  }

  async liked() {
    if (!this.track || !this.track.uri || !this.track.uri.startsWith('spotify:track:')) return false;
    try {
      return await this.api.isLiked(this.track.uri);
    } catch {
      return false;
    }
  }

  async toggleLiked() {
    if (!this.track || !this.track.uri) return null;
    const now = !(await this.liked());
    await this.api.setLiked(this.track.uri, now);
    return now;
  }
}
