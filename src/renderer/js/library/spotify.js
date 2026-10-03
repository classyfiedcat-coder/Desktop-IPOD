/**
 * Spotify Web API client. Written against the 2026 Development Mode API:
 * playlist contents come from /playlists/{id}/items (entries expose `item`),
 * search is capped at 10 results, and saving uses /me/library with URIs —
 * with fallbacks to the older shapes so Extended Quota apps keep working.
 */

import { Emitter, sleep } from '../util.js';

const API = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  constructor(message, status, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

function image(images, target = 300) {
  if (!images || !images.length) return null;
  const sized = images.filter((i) => i && i.url);
  if (!sized.length) return null;
  const withW = sized.filter((i) => i.width);
  if (!withW.length) return sized[0].url;
  const ok = withW.filter((i) => i.width >= target).sort((a, b) => a.width - b.width);
  return (ok[0] || withW.sort((a, b) => b.width - a.width)[0]).url;
}

export function normTrack(t, album) {
  if (!t) return null;
  const al = t.album || album || {};
  if (t.type === 'episode' || t.show) {
    const show = t.show || {};
    return {
      id: `sp:${t.id}`,
      spotifyId: t.id,
      uri: t.uri,
      source: 'spotify',
      kind: 'podcast',
      title: t.name,
      artist: show.publisher || show.name || 'Podcast',
      album: show.name || '',
      albumArtist: show.name || '',
      art: image(t.images) || image(show.images),
      duration: (t.duration_ms || 0) / 1000,
      date: t.release_date || '',
      playable: t.is_playable !== false,
    };
  }
  const artists = (t.artists || []).map((a) => a.name).filter(Boolean);
  return {
    id: `sp:${t.id || t.uri}`,
    spotifyId: t.id,
    uri: t.uri,
    source: 'spotify',
    kind: 'music',
    title: t.name || 'Unknown',
    artist: artists.join(', ') || 'Unknown Artist',
    artistIds: (t.artists || []).map((a) => a.id || (a.uri || '').split(':').pop()).filter(Boolean),
    album: al.name || '',
    albumArtist: (al.artists && al.artists[0] && al.artists[0].name) || artists[0] || '',
    albumId: al.id || (al.uri || '').split(':').pop() || null,
    albumUri: al.uri || null,
    art: image(al.images),
    duration: (t.duration_ms || 0) / 1000,
    trackNo: t.track_number || null,
    discNo: t.disc_number || null,
    // The album's year tells versions apart (the original, the remaster, the soundtrack…).
    year: parseInt(String(al.release_date || al.year || '').slice(0, 4), 10) || null,
    explicit: !!t.explicit,
    playable: t.is_playable !== false && !t.is_local,
  };
}

const normAlbum = (a) =>
  a && {
    id: a.id,
    uri: a.uri,
    title: a.name,
    artist: (a.artists || []).map((x) => x.name).join(', '),
    art: image(a.images),
    total: a.total_tracks || 0,
    year: (a.release_date || '').slice(0, 4),
    type: a.album_type,
  };

const normPlaylist = (p) =>
  p && {
    id: p.id,
    uri: p.uri,
    name: p.name,
    art: image(p.images),
    total: (p.items && p.items.total) ?? (p.tracks && p.tracks.total) ?? 0,
    owner: p.owner && p.owner.id,
    ownerName: p.owner && (p.owner.display_name || p.owner.id),
    collaborative: !!p.collaborative,
  };

const normArtist = (a) => a && { id: a.id, uri: a.uri, name: a.name, art: image(a.images) };

const normShow = (s) => s && { id: s.id, uri: s.uri, name: s.name, publisher: s.publisher || '', art: image(s.images), total: s.total_episodes || 0 };

export class SpotifyAPI extends Emitter {
  constructor() {
    super();
    this.status = { configured: false, connected: false };
    this.user = null;
    this._limits = {};
    this._liked = new Map();
  }

  async init() {
    try {
      this.status = await window.ipod.spotify.status();
    } catch {
      /* not available */
    }
    window.ipod.spotify.onChange((s) => {
      const was = this.status.connected;
      this.status = s;
      if (s.connected && !was) this.loadUser();
      if (!s.connected) this.user = null;
      this.emit('status', s);
    });
    if (this.status.connected) this.loadUser();
  }

  get connected() {
    return !!(this.status && this.status.connected);
  }

  async loadUser() {
    try {
      this.user = await this.get('/me');
      window.ipod.spotify.setUser(this.user);
      this.emit('user', this.user);
    } catch (err) {
      console.warn('spotify /me failed', err);
    }
  }

  async token(force = false) {
    return window.ipod.spotify.token(force ? { force: true } : undefined);
  }

  async req(method, path, { query, body, retry = 1 } = {}) {
    const token = await this.token();
    if (!token) throw new SpotifyError('Not connected to Spotify.', 401);
    let url = path.startsWith('http') ? path : API + path;
    if (query) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
      const qs = q.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    }
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && retry > 0) {
      await this.token(true);
      return this.req(method, path, { query, body, retry: retry - 1 });
    }
    if (res.status === 429 && retry > 0) {
      const wait = Math.min(10, parseInt(res.headers.get('Retry-After') || '2', 10)) * 1000;
      await sleep(wait);
      return this.req(method, path, { query, body, retry: retry - 1 });
    }
    if (res.status === 204 || res.status === 202) return null;
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const e = (data && data.error) || {};
      throw new SpotifyError(e.message || res.statusText || 'Spotify error', res.status, e.reason);
    }
    return data;
  }

  get(path, query) {
    return this.req('GET', path, { query });
  }
  put(path, body, query) {
    return this.req('PUT', path, { body, query });
  }
  post(path, body, query) {
    return this.req('POST', path, { body, query });
  }
  del(path, body, query) {
    return this.req('DELETE', path, { body, query });
  }

  /** GET a paging object, stepping the page size down if Spotify rejects it. */
  async page(path, offset = 0, query = {}) {
    const key = path.replace(/\/[A-Za-z0-9]{22}(?=\/|$)/g, '/:id');
    let limit = this._limits[key] || 50;
    for (;;) {
      try {
        const data = await this.get(path, { ...query, limit, offset });
        this._limits[key] = limit;
        return data;
      } catch (err) {
        if (err.status === 400 && /limit/i.test(err.message) && limit > 10) {
          limit = limit > 20 ? 20 : 10;
          continue;
        }
        throw err;
      }
    }
  }

  // ------------------------------------------------------------- library --

  async playlists(offset = 0) {
    const d = await this.page('/me/playlists', offset);
    return { items: (d.items || []).filter(Boolean).map(normPlaylist), more: !!d.next };
  }

  async playlistTracks(playlistId, offset = 0) {
    let d;
    try {
      d = await this.page(`/playlists/${playlistId}/items`, offset);
    } catch (err) {
      if (err.status !== 404) throw err;
      d = await this.page(`/playlists/${playlistId}/tracks`, offset);
    }
    const items = (d.items || []).map((e) => normTrack(e.item || e.track)).filter((t) => t && t.uri);
    return { items, more: !!d.next, total: d.total };
  }

  async liked(offset = 0) {
    const d = await this.page('/me/tracks', offset);
    return { items: (d.items || []).map((e) => normTrack(e.track || e.item)).filter(Boolean), more: !!d.next, total: d.total };
  }

  async savedAlbums(offset = 0) {
    const d = await this.page('/me/albums', offset);
    return { items: (d.items || []).map((e) => normAlbum(e.album)).filter(Boolean), more: !!d.next };
  }

  async album(id) {
    const a = await this.get(`/albums/${id}`);
    return normAlbum(a);
  }

  async albumTracks(album, offset = 0) {
    const d = await this.page(`/albums/${album.id}/tracks`, offset);
    const al = { name: album.title, id: album.id, uri: album.uri, images: album.art ? [{ url: album.art }] : [], artists: [{ name: album.artist }], year: album.year };
    return { items: (d.items || []).map((t) => normTrack(t, al)).filter(Boolean), more: !!d.next };
  }

  async followedArtists(after) {
    const d = await this.get('/me/following', { type: 'artist', limit: 50, after });
    const a = d.artists || {};
    return { items: (a.items || []).map(normArtist), after: a.cursors && a.cursors.after, more: !!a.next };
  }

  async artistAlbums(artistId, offset = 0) {
    const d = await this.page(`/artists/${artistId}/albums`, offset, { include_groups: 'album,single,compilation' });
    return { items: (d.items || []).map(normAlbum).filter(Boolean), more: !!d.next };
  }

  async shows(offset = 0) {
    const d = await this.page('/me/shows', offset);
    return { items: (d.items || []).map((e) => normShow(e.show)).filter(Boolean), more: !!d.next };
  }

  async showEpisodes(show, offset = 0) {
    const d = await this.page(`/shows/${show.id}/episodes`, offset);
    const s = { name: show.name, publisher: show.publisher, images: show.art ? [{ url: show.art }] : [] };
    return { items: (d.items || []).filter(Boolean).map((e) => normTrack({ ...e, show: s })), more: !!d.next };
  }

  async recentlyPlayed() {
    const d = await this.get('/me/player/recently-played', { limit: 50 });
    const seen = new Set();
    const items = [];
    for (const e of d.items || []) {
      const t = normTrack(e.track);
      if (t && !seen.has(t.uri)) {
        seen.add(t.uri);
        items.push(t);
      }
    }
    return items;
  }

  async search(q) {
    const d = await this.get('/search', { q, type: 'track,album,artist,playlist', limit: 10 });
    return {
      tracks: ((d.tracks && d.tracks.items) || []).filter(Boolean).map((t) => normTrack(t)),
      albums: ((d.albums && d.albums.items) || []).filter(Boolean).map(normAlbum),
      artists: ((d.artists && d.artists.items) || []).filter(Boolean).map(normArtist),
      playlists: ((d.playlists && d.playlists.items) || []).filter(Boolean).map(normPlaylist),
    };
  }

  // ------------------------------------------------------- liked songs --

  async isLiked(uri) {
    if (this._liked.has(uri)) return this._liked.get(uri);
    let res = null;
    try {
      res = await this.get('/me/library/contains', { uris: uri });
    } catch (err) {
      if (err.status !== 404 && err.status !== 400) throw err;
      const id = uri.split(':').pop();
      res = await this.get('/me/tracks/contains', { ids: id });
    }
    const v = Array.isArray(res) ? !!res[0] : false;
    this._liked.set(uri, v);
    return v;
  }

  async setLiked(uri, on) {
    try {
      if (on) await this.put('/me/library', null, { uris: uri });
      else await this.del('/me/library', null, { uris: uri });
    } catch (err) {
      if (err.status !== 404 && err.status !== 400) throw err;
      const id = uri.split(':').pop();
      if (on) await this.put('/me/tracks', null, { ids: id });
      else await this.del('/me/tracks', null, { ids: id });
    }
    this._liked.set(uri, on);
  }

  // -------------------------------------------------------------- player --

  playerState() {
    return this.get('/me/player', { additional_types: 'episode' });
  }
  async devices() {
    const d = await this.get('/me/player/devices');
    return (d && d.devices) || [];
  }
  play({ deviceId, contextUri, uris, offset, positionMs } = {}) {
    const body = {};
    if (contextUri) body.context_uri = contextUri;
    if (uris) body.uris = uris;
    if (offset) body.offset = offset;
    if (positionMs) body.position_ms = Math.round(positionMs);
    return this.put('/me/player/play', Object.keys(body).length ? body : null, { device_id: deviceId });
  }
  pause(deviceId) {
    return this.put('/me/player/pause', null, { device_id: deviceId });
  }
  next(deviceId) {
    return this.post('/me/player/next', null, { device_id: deviceId });
  }
  previous(deviceId) {
    return this.post('/me/player/previous', null, { device_id: deviceId });
  }
  seek(ms, deviceId) {
    return this.put('/me/player/seek', null, { position_ms: Math.round(ms), device_id: deviceId });
  }
  volume(percent, deviceId) {
    return this.put('/me/player/volume', null, { volume_percent: Math.round(percent), device_id: deviceId });
  }
  shuffle(on, deviceId) {
    return this.put('/me/player/shuffle', null, { state: on ? 'true' : 'false', device_id: deviceId });
  }
  repeat(state, deviceId) {
    return this.put('/me/player/repeat', null, { state, device_id: deviceId });
  }
  transfer(deviceId, play = true) {
    return this.put('/me/player', { device_ids: [deviceId], play });
  }
  addToQueue(uri, deviceId) {
    return this.post('/me/player/queue', null, { uri, device_id: deviceId });
  }
  async queue() {
    const d = await this.get('/me/player/queue');
    return {
      current: d && d.currently_playing ? normTrack(d.currently_playing) : null,
      queue: ((d && d.queue) || []).map((t) => normTrack(t)).filter(Boolean),
    };
  }

  /** Playlists the user can add songs to (owned or collaborative). */
  async editablePlaylists() {
    const out = [];
    let offset = 0;
    for (let i = 0; i < 6; i++) {
      const page = await this.playlists(offset);
      out.push(...page.items);
      if (!page.more) break;
      offset += page.items.length;
    }
    const me = this.user && this.user.id;
    return out.filter((p) => p.collaborative || !me || p.owner === me);
  }

  async addToPlaylist(playlistId, uris) {
    try {
      await this.post(`/playlists/${playlistId}/items`, { uris });
    } catch (err) {
      if (err.status !== 404) throw err;
      await this.post(`/playlists/${playlistId}/tracks`, { uris });
    }
  }
}
