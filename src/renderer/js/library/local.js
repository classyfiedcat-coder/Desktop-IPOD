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
  }

  async init() {
    try {
      const data = await window.ipod.library.get();
      this._set(data);
      const foldersChanged = JSON.stringify(data.folders || []) !== JSON.stringify(this.store.musicFolders());
      if (!data.scannedAt || foldersChanged) this.scan();
      else if (Date.now() - data.scannedAt > 1000 * 60 * 60 * 6) this.scan(); // background refresh
    } catch (err) {
      console.warn('library unavailable', err);
    }
  }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    this.emit('scan', true);
    try {
      const data = await window.ipod.library.scan(this.store.musicFolders());
      this._set(data);
    } catch (err) {
      console.warn('scan failed', err);
    } finally {
      this.scanning = false;
      this.progress = null;
      this.emit('scan', false);
    }
  }

  _set(data) {
    this.scannedAt = data.scannedAt || 0;
    this.tracks = (data.tracks || []).map((t) => ({
      ...t,
      source: 'local',
      art: ART_URL(t.art),
      src: TRACK_URL(t.id),
    }));
    this.byId = new Map(this.tracks.map((t) => [t.id, t]));
    this.playlists = data.playlists || [];
    this._build();
    this.emit('change');
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
    const u = this.store.user;
    const music = this.music;
    const recentlyAdded = music
      .slice()
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 100);
    const top25 = music
      .filter((t) => u.plays[t.id])
      .sort((a, b) => u.plays[b.id] - u.plays[a.id])
      .slice(0, 25);
    const recentlyPlayed = music
      .filter((t) => u.lastPlayed[t.id])
      .sort((a, b) => u.lastPlayed[b.id] - u.lastPlayed[a.id])
      .slice(0, 50);
    const topRated = music
      .filter((t) => (u.ratings[t.id] || 0) >= 4)
      .sort((a, b) => (u.ratings[b.id] || 0) - (u.ratings[a.id] || 0) || byKey(a.title, b.title));
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
