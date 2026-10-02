/** Persistent settings and user data (play counts, ratings, On-The-Go…). */

import { Emitter, debounce } from './util.js';

export const DEFAULT_SETTINGS = {
  model: 'video',
  color: 'white',
  size: 'medium',
  shadow: true,

  shuffle: 'off', // off | songs | albums
  repeat: 'off', // off | one | all
  volume: 0.6,
  volumeLimit: 1,
  eq: 'Off',
  soundCheck: false,
  audiobookSpeed: 1,
  compilations: false,

  backlight: 10, // seconds, 0 = always on
  brightness: 1,
  clicker: 'on', // off | on | loud
  wheelSpeed: 'medium',
  timeFormat: '12',
  timeInTitle: false,
  lyrics: true,

  alwaysOnTop: true,
  showInTaskbar: true,
  openAtLogin: false,
  opacity: 1,

  folders: null, // null = use the system Music folder
  photosFolder: null,
  videosFolder: null,
  notesFolder: null,

  spotifyEnabled: true,
  spotifyOutput: 'auto', // auto | ipod | connect
  spotifyDevice: null,

  mainMenu: {
    music: true,
    spotify: true,
    photos: true,
    videos: true,
    extras: true,
    settings: true,
    shuffle: true,
    podcasts: false,
    games: false,
    clock: false,
  },
  musicMenu: {
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
  sleepTimer: 0,
};

const DEFAULT_USER = {
  plays: {},
  lastPlayed: {},
  ratings: {},
  skips: {},
  otg: [],
  highScores: {},
  bookmarks: {},
  lastSession: null,
};

class Store extends Emitter {
  constructor() {
    super();
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.user = structuredClone(DEFAULT_USER);
    this.env = { platform: 'win32', version: '1.0.0', defaults: {} };
    this._save = debounce(() => this.flush(), 400);
  }

  async load() {
    try {
      const data = await window.ipod.state.load();
      this.env = { platform: data.platform, version: data.version, defaults: data.defaults || {} };
      const saved = data.app || {};
      this.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), saved.settings || {});
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

  touchUser() {
    this._save();
  }

  reset() {
    const keep = { folders: this.settings.folders, photosFolder: this.settings.photosFolder, videosFolder: this.settings.videosFolder };
    this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...keep };
    this.emit('reset');
    this.flush();
  }

  musicFolders() {
    if (Array.isArray(this.settings.folders)) return this.settings.folders;
    return this.env.defaults.music ? [this.env.defaults.music] : [];
  }

  flush() {
    window.ipod.state.save({ settings: this.settings, user: this.user });
  }
}

function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      base[k] = deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

export const store = new Store();
