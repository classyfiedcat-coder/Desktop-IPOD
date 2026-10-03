/** Persistent settings and user data (play counts, ratings, playlists, podcasts…). */

import { Emitter, debounce } from './util.js';

export const SCHEMA = 2;

export const DEFAULT_SETTINGS = {
  schema: SCHEMA,
  model: 'video',
  color: 'white',
  size: 'medium',
  shadow: true,
  customColors: { front: '#2f6fb3', wheel: '#eef1f4', label: '#8f9aa6', center: '#f6f7f8', dark: false },
  engraving: '',
  wheelGlow: false,
  startupAnimation: true,
  motion: 'cursor', // cursor | hover | off
  motionAmount: 'normal', // subtle | normal | dramatic
  reflections: true,
  idleFloat: true,
  wear: 'light', // none | light | worn: scratches and smudges on the steel back
  backFinish: 'auto', // auto | steel | black
  detail: 'high', // high (3D model, WebGL) | light (CSS)

  shuffle: 'off', // off | songs | albums
  repeat: 'off', // off | one | all
  volume: 0.6,
  volumeLimit: 1,
  eq: 'Off',
  customEq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  soundCheck: false,
  crossfade: 0, // seconds, 0 = gapless
  audiobookSpeed: 1,
  podcastSpeed: 1,
  compilations: false,

  backlight: 10, // seconds, 0 = always on
  brightness: 1,
  clicker: 'on', // off | on | loud
  clickSound: 'auto', // auto (the model's own) | piezo | soft | mechanical | pop | typewriter
  npColors: 'classic', // classic | album (Now Playing takes the album art's colours)
  wheelSpeed: 'medium',
  timeFormat: '12',
  timeInTitle: false,
  lyrics: true,
  lyricsOnline: true,
  holdSelect: 'options', // options | otg
  visualizer: true,

  alwaysOnTop: true,
  showInTaskbar: true,
  openAtLogin: false,
  startHidden: false,
  snapToEdges: true,
  opacity: 1,
  notifications: false,
  globalShortcuts: true,
  autoUpdate: true, // install downloaded updates by themselves when the iPod is quiet
  lastVersion: null, // the version that last ran, to say "Updated to …" once

  folders: null, // null = use the system Music folder
  itunes: true, // use the iTunes / Music library (playlists, ratings, play counts) when there is one
  itunesFile: null, // null = find it in the Music folder
  autoUpdateLibrary: true,
  autoArtwork: false,
  photosFolder: null,
  videosFolder: null,
  notesFolder: null,
  contactsFolder: null,
  calendarsFolder: null,
  videoFit: 'contain',
  subtitles: true,

  spotifyEnabled: true,
  spotifyOutput: 'auto', // auto | ipod | connect
  spotifyDevice: null,
  radioCountry: null,

  mainMenu: {
    music: true,
    spotify: true,
    radio: true,
    podcasts: false,
    photos: true,
    videos: true,
    extras: true,
    settings: true,
    shuffle: true,
    coverflow: false,
    games: false,
    clock: false,
  },
  musicMenu: {
    coverflow: true,
    playlists: true,
    artists: true,
    albums: true,
    compilations: false,
    songs: true,
    podcasts: true,
    genres: true,
    composers: true,
    audiobooks: true,
    search: true,
  },

  lockCode: null,
  worldClocks: ['local', 'Europe/London', 'America/New_York', 'Asia/Tokyo'],
  alarms: [],
};

const DEFAULT_USER = {
  plays: {},
  lastPlayed: {},
  ratings: {},
  skips: {},
  otg: [],
  playlists: [], // [{ id, name, trackIds, createdAt }]
  highScores: {},
  bookmarks: {},
  played: {},
  podcasts: [], // subscriptions with cached episodes
  radioFavorites: [],
  radioRecent: [],
  searches: [],
  lastSession: null,
  serial: null,
};

/** Upgrade saved settings from older versions. */
export function migrate(settings) {
  const s = { ...settings };
  if (!s.schema || s.schema < 2) {
    // 1.x stored colours of other models; the 5th gen has white/black/U2/custom.
    if (!['white', 'black', 'u2', 'custom'].includes(s.color)) s.color = 'white';
    s.model = 'video';
    delete s.crossfade;
    s.schema = 2;
  }
  return s;
}

export function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      base[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      base[k] = v;
    }
  }
  return base;
}

class Store extends Emitter {
  constructor() {
    super();
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.user = structuredClone(DEFAULT_USER);
    this.env = { platform: 'win32', version: '2.0.0', defaults: {}, packaged: false };
    this._save = debounce(() => this.flush(), 400);
    /** Ratings, plays and dates from iTunes by track id (set by the library), or null. */
    this.itunesStats = null;
  }

  // Stats: the iPod's own plus iTunes'. Plays add up, the latest play wins, the iPod's rating wins.

  plays(id) {
    const it = this.itunesStats && this.itunesStats[id];
    return (this.user.plays[id] || 0) + ((it && it.p) || 0);
  }

  lastPlayed(id) {
    const it = this.itunesStats && this.itunesStats[id];
    return Math.max(this.user.lastPlayed[id] || 0, (it && it.l) || 0);
  }

  rating(id) {
    if (Object.prototype.hasOwnProperty.call(this.user.ratings, id)) return this.user.ratings[id] || 0;
    const it = this.itunesStats && this.itunesStats[id];
    return (it && it.r) || 0;
  }

  async load() {
    try {
      const data = await window.ipod.state.load();
      this.env = { platform: data.platform, version: data.version, defaults: data.defaults || {}, packaged: !!data.packaged };
      const saved = data.app || {};
      this.firstRun = !data.app;
      this.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), migrate(saved.settings || {}));
      this.user = deepMerge(structuredClone(DEFAULT_USER), saved.user || {});
    } catch (err) {
      console.warn('Could not load saved state', err);
    }
    return this;
  }

  set(key, value) {
    if (this.settings[key] === value) return;
    this.settings[key] = value;
    this.emit('change', { key, value });
    this.emit(`change:${key}`, value);
    this._save();
  }

  setIn(group, key, value) {
    this.settings[group] = { ...this.settings[group], [key]: value };
    this.emit('change', { key: group, value: this.settings[group] });
    this.emit(`change:${group}`, this.settings[group]);
    this._save();
  }

  touchUser(what) {
    if (what) this.emit(`user:${what}`);
    this._save();
  }

  reset() {
    const keep = ['folders', 'photosFolder', 'videosFolder', 'notesFolder', 'contactsFolder', 'calendarsFolder'];
    const kept = Object.fromEntries(keep.map((k) => [k, this.settings[k]]));
    this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...kept };
    this.emit('reset');
    this.flush();
  }

  musicFolders() {
    if (Array.isArray(this.settings.folders)) return this.settings.folders;
    return this.env.defaults.music ? [this.env.defaults.music] : [];
  }

  /** Everything worth backing up, as JSON. */
  exportData() {
    return JSON.stringify({ app: 'iPod Desktop', schema: SCHEMA, exportedAt: new Date().toISOString(), settings: this.settings, user: this.user }, null, 1);
  }

  importData(json) {
    const data = JSON.parse(json);
    if (!data || data.app !== 'iPod Desktop') throw new Error('Not an iPod backup');
    this.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), migrate(data.settings || {}));
    this.user = deepMerge(structuredClone(DEFAULT_USER), data.user || {});
    this.emit('reset');
    this.flush();
  }

  flush() {
    if (this._save.cancel) this._save.cancel();
    window.ipod.state.save({ settings: this.settings, user: this.user });
  }
}

export const store = new Store();
