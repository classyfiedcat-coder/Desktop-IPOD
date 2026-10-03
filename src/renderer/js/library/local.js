/** Indexes the scanned local library into artists, albums, genres… */

import { Emitter, byKey, sortKey } from '../util.js';

const ART_URL = (f) => (f ? `app://ipod/media/art/${f}` : null);
const TRACK_URL = (id) => `app://ipod/media/track/${id}`;

export class LocalLibrary extends Emitter {
  constructor(store) {
    super();
    this.store = store;
    this.tracks = [];
    this.byId = new Map();
    this.playlists = [];
    this.scanning = false;
    this.progress = null;
    this.scannedAt = 0;
    this._build();
    window.ipod.library.onProgress((p) => {
      this.progress = p;
      this.emit('progress', p);
    });
    window.ipod.library.onFoldersChanged(() => {
      if (this.store.settings.autoUpdateLibrary) this.scan();
    });
    window.ipod.library.onArtUpdated(() => this.reload());
    store.on('change:autoUpdateLibrary', (v) => window.ipod.library.autoUpdate(v));
    // iTunes: re-read when iTunes saves its library, or the setting changes.
    this.itunes = null; // { file, stats, playlists, matched, total, … } while in use
    this.itunesStatus = null; // the last answer, including "not found" and errors
    window.ipod.library.onITunesChanged(() => this.syncITunes());
    store.on('change:itunes', () => this.syncITunes());
    store.on('change:itunesFile', () => this.syncITunes({ force: true }));
  }

  normalize(t) {
    return { ...t, fileAddedAt: t.addedAt, source: 'local', art: ART_URL(t.art), artKey: t.art || null, src: TRACK_URL(t.id) };
  }

  // ---- iTunes -----------------------------------------------------------

  /**
   * Read the iTunes / Music library and use its playlists, ratings, play
   * counts and dates (see main/library/itunes.js). Turned off, they go away
   * again; nothing of the iPod's own is changed either way.
   */
  async syncITunes({ force = false } = {}) {
    const s = this.store.settings;
    let res = null;
    if (s.itunes) {
      try {
        res = await window.ipod.library.itunes({ file: s.itunesFile, force });
      } catch (err) {
        res = { found: false, error: err.message };
      }
    } else window.ipod.library.itunesOff().catch(() => {});
    // The setting may have changed while it was reading.
    if (!this.store.settings.itunes) res = null;
    this.itunesStatus = res;
    this.itunes = res && res.found ? res : null;
    this._applyITunes();
    this.emit('itunes', res);
    return res;
  }

  _applyITunes() {
    const stats = this.itunes ? this.itunes.stats : null;
    this.store.itunesStats = stats;
    // iTunes knows when you really added a song; the file only knows when the iPod first saw it.
    for (const t of this.tracks) t.addedAt = (stats && stats[t.id] && stats[t.id].a) || t.fileAddedAt;
    this._build();
    this.emit('change');
  }

  /** iTunes playlists inside a folder (null: at the top level), as on an iPod synced with iTunes. */
  itunesPlaylists(parent = null) {
    if (!this.itunes) return [];
    return this.itunes.playlists
      .filter((p) => p.parent === parent || (parent === null && p.parent && !this.itunes.playlists.some((q) => q.id === p.parent)))
      .map((p) => ({ ...p, tracks: p.folder ? [] : p.trackIds.map((id) => this.byId.get(id)).filter(Boolean) }));
  }

  /** Re-read the index (after artwork was added). */
  async reload() {
    try {
      this._set(await window.ipod.library.get());
    } catch {
      /* ignore */
    }
  }

  /** Tracks opened with the iPod that aren't in the library. */
  transient(tracks) {
    return tracks.map((t) => this.byId.get(t.id) || this.normalize(t));
  }

  async init() {
    try {
      const data = await window.ipod.library.get();
      this._set(data);
      window.ipod.library.autoUpdate(this.store.settings.autoUpdateLibrary);
      // iTunes playlists and stats right away (a scan below matches them again when it's done).
      if (data.scannedAt && this.store.settings.itunes) this.syncITunes();
      const foldersChanged = JSON.stringify(data.folders || []) !== JSON.stringify(this.store.musicFolders());
      if (!data.scannedAt || foldersChanged) this.scan();
      else if (Date.now() - data.scannedAt > 1000 * 60 * 60 * 6) this.scan(); // background refresh
    } catch (err) {
      console.warn('library unavailable', err);
    }
  }

  scan() {
    if (this._scanJob) {
      // A scan is running; run once more afterwards so new folders are included.
      this._again = true;
      return this._scanJob;
    }
    this.scanning = true;
    this.emit('scan', true);
    this._scanJob = (async () => {
      try {
        do {
          this._again = false;
          this._set(await window.ipod.library.scan(this.store.musicFolders()));
        } while (this._again);
        // Songs moved, appeared or went: match iTunes against the new index.
        if (this.store.settings.itunes) await this.syncITunes();
        if (this.store.settings.autoArtwork && this.albums.some((a) => !a.art && a.title !== 'Unknown Album')) {
          window.ipod.library.fillArtwork().catch(() => {});
        }
      } catch (err) {
        console.warn('scan failed', err);
      } finally {
        this.scanning = false;
        this.progress = null;
        this._scanJob = null;
        this.emit('scan', false);
      }
    })();
    return this._scanJob;
  }

  _set(data) {
    this.scannedAt = data.scannedAt || 0;
    this.tracks = (data.tracks || []).map((t) => this.normalize(t));
    this.byId = new Map(this.tracks.map((t) => [t.id, t]));
    this.playlists = data.playlists || [];
    this._applyITunes(); // builds and announces the change
  }

  _build() {
    const music = this.tracks.filter((t) => t.kind === 'music');
    this.music = music.slice().sort((a, b) => byKey(a.title, b.title));
    this.podcasts = this.tracks.filter((t) => t.kind === 'podcast');
    this.audiobooks = this.tracks.filter((t) => t.kind === 'audiobook').sort((a, b) => byKey(a.album, b.album) || (a.trackNo || 0) - (b.trackNo || 0));

    const albums = new Map();
    const artists = new Map();
    const albumArtists = new Map();
    const genres = new Map();
    const composers = new Map();
    for (const t of music) {
      const albumArtist = t.compilation ? 'Various Artists' : t.albumArtist || t.artist;
      const key = `${albumArtist}\u0000${t.album}`;
      let al = albums.get(key);
      if (!al) {
        al = { key, title: t.album, artist: albumArtist, art: t.art, year: t.year, compilation: !!t.compilation, tracks: [] };
        albums.set(key, al);
      }
      if (!al.art && t.art) al.art = t.art;
      al.tracks.push(t);

      for (const [map, name] of [
        [artists, t.artist],
        [albumArtists, albumArtist],
      ]) {
        let ar = map.get(name);
        if (!ar) {
          ar = { name, albums: new Set(), tracks: [] };
          map.set(name, ar);
        }
        ar.albums.add(al);
        ar.tracks.push(t);
      }
      if (t.genre) {
        if (!genres.has(t.genre)) genres.set(t.genre, []);
        genres.get(t.genre).push(t);
      }
      if (t.composer) {
        if (!composers.has(t.composer)) composers.set(t.composer, []);
        composers.get(t.composer).push(t);
      }
    }
    for (const al of albums.values()) al.tracks.sort(trackOrder);
    this.albums = [...albums.values()].sort((a, b) => byKey(a.title, b.title));
    this.compilations = this.albums.filter((a) => a.compilation);
    const finish = (map) =>
      [...map.values()]
        .map((a) => ({ ...a, albums: [...a.albums].sort((x, y) => (x.year || 0) - (y.year || 0) || byKey(x.title, y.title)) }))
        .sort((a, b) => byKey(a.name, b.name));
    this.artists = finish(artists);
    this.albumArtists = finish(albumArtists);
    this.genres = [...genres.entries()].map(([name, tracks]) => ({ name, tracks: tracks.sort(trackOrder) })).sort((a, b) => byKey(a.name, b.name));
    this.composers = [...composers.entries()]
      .map(([name, tracks]) => ({ name, tracks: tracks.sort((a, b) => byKey(a.title, b.title)) }))
      .sort((a, b) => byKey(a.name, b.name));

    const shows = new Map();
    for (const t of this.podcasts) {
      const key = t.album || t.artist;
      if (!shows.has(key)) shows.set(key, { name: key, art: t.art, episodes: [] });
      shows.get(key).episodes.push(t);
    }
    this.shows = [...shows.values()]
      .map((s) => ({ ...s, episodes: s.episodes.sort((a, b) => (b.year || 0) - (a.year || 0) || b.addedAt - a.addedAt) }))
      .sort((a, b) => byKey(a.name, b.name));
  }

  get(id) {
    return this.byId.get(id);
  }

  artistAlbums(name, { albumArtist = false } = {}) {
    const list = albumArtist ? this.albumArtists : this.artists;
    const ar = list.find((a) => a.name === name);
    return ar ? ar.albums : [];
  }

  // ---- smart playlists --------------------------------------------------
  smartPlaylists() {
    const st = this.store;
    const music = this.music;
    const recentlyAdded = music
      .slice()
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 100);
    const top25 = music
      .filter((t) => st.plays(t.id))
      .sort((a, b) => st.plays(b.id) - st.plays(a.id))
      .slice(0, 25);
    const recentlyPlayed = music
      .filter((t) => st.lastPlayed(t.id))
      .sort((a, b) => st.lastPlayed(b.id) - st.lastPlayed(a.id))
      .slice(0, 50);
    const topRated = music
      .filter((t) => st.rating(t.id) >= 4)
      .sort((a, b) => st.rating(b.id) - st.rating(a.id) || byKey(a.title, b.title));
    return [
      { id: 'smart:recent', name: 'Recently Added', tracks: recentlyAdded, smart: true },
      { id: 'smart:top25', name: 'Top 25 Most Played', tracks: top25, smart: true },
      { id: 'smart:played', name: 'Recently Played', tracks: recentlyPlayed, smart: true },
      { id: 'smart:rated', name: 'My Top Rated', tracks: topRated, smart: true },
    ];
  }

  otgTracks() {
    return this.store.user.otg.map((id) => this.byId.get(id)).filter(Boolean);
  }

  fileplaylists() {
    return this.playlists.map((p) => ({ id: p.id, name: p.name, tracks: p.trackIds.map((id) => this.byId.get(id)).filter(Boolean) }));
  }

  search(q, limit = 60) {
    const k = sortKey(q);
    if (!k) return { songs: [], albums: [], artists: [] };
    const match = (s) => sortKey(s).includes(k) || String(s || '').toLowerCase().includes(q.toLowerCase());
    return {
      artists: this.artists.filter((a) => match(a.name)).slice(0, limit),
      albums: this.albums.filter((a) => match(a.title)).slice(0, limit),
      songs: this.tracks.filter((t) => match(t.title)).slice(0, limit),
    };
  }

  randomArt(n = 12) {
    const arts = [...new Set(this.albums.map((a) => a.art).filter(Boolean))];
    for (let i = arts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arts[i], arts[j]] = [arts[j], arts[i]];
    }
    return arts.slice(0, n);
  }
}

function trackOrder(a, b) {
  return (a.discNo || 1) - (b.discNo || 1) || (a.trackNo || 999) - (b.trackNo || 999) || byKey(a.title, b.title);
}
