/**
 * Internet radio from the community-run Radio Browser directory
 * (https://www.radio-browser.info). Streams play through the app:// proxy so
 * the EQ works and "now playing" titles can be read from the stream.
 */

const SERVERS = ['de1', 'fi1', 'nl1', 'at1', 'de2'].map((s) => `https://${s}.api.radio-browser.info`);
const PLAYABLE = /^(mp3|aac|aac\+|ogg|opus|flac|mpeg|unknown|)$/i;

export function stationTrack(s) {
  const enc = encodeURIComponent;
  const tags = (s.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(', ');
  return {
    id: `radio:${s.uuid}`,
    sid: s.uuid,
    source: 'radio',
    kind: 'radio',
    live: true,
    station: s,
    stationTags: tags,
    title: s.name,
    artist: tags || 'Live Radio',
    album: s.country || 'Radio',
    art: s.favicon && /^https?:/.test(s.favicon) ? `app://ipod/media/img?u=${enc(s.favicon)}` : null,
    src: `app://ipod/media/remote?icy=1&sid=${enc(s.uuid)}&u=${enc(s.url)}`,
  };
}

export function normalizeStation(s) {
  return {
    uuid: s.stationuuid,
    name: (s.name || 'Station').trim(),
    url: s.url_resolved || s.url,
    favicon: s.favicon || '',
    tags: s.tags || '',
    country: s.country || '',
    countrycode: s.countrycode || '',
    language: s.language || '',
    codec: s.codec || '',
    bitrate: s.bitrate || 0,
    votes: s.votes || 0,
    homepage: s.homepage || '',
    hls: !!s.hls,
  };
}

export class RadioService {
  constructor(store) {
    this.store = store;
    this.base = null;
    this.cache = new Map();
  }

  async api(path, params = {}) {
    const qs = new URLSearchParams({ hidebroken: 'true', ...params }).toString();
    const key = `${path}?${qs}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
    const order = this.base ? [this.base, ...SERVERS.filter((s) => s !== this.base)] : SERVERS.slice().sort(() => Math.random() - 0.5);
    let lastErr;
    for (const base of order) {
      try {
        const data = await window.ipod.net.json(`${base}${path}${qs ? `?${qs}` : ''}`);
        this.base = base;
        this.cache.set(key, { at: Date.now(), data });
        return data;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(lastErr && /Timed out|ENOTFOUND|net::/.test(lastErr.message) ? 'Can’t reach the radio directory.' : 'Radio is unavailable right now.');
  }

  _stations(list) {
    const seen = new Set();
    const out = [];
    for (const raw of list || []) {
      const s = normalizeStation(raw);
      if (!s.url || s.hls || !PLAYABLE.test(s.codec)) continue;
      const k = s.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  async top(limit = 80) {
    return this._stations(await this.api(`/json/stations/topclick/${limit}`));
  }

  async popular(limit = 80) {
    return this._stations(await this.api(`/json/stations/topvote/${limit}`));
  }

  async byTag(tag) {
    return this._stations(await this.api(`/json/stations/bytagexact/${encodeURIComponent(tag)}`, { order: 'clickcount', reverse: 'true', limit: '150' }));
  }

  async byCountry(code) {
    return this._stations(await this.api(`/json/stations/bycountrycodeexact/${encodeURIComponent(code)}`, { order: 'clickcount', reverse: 'true', limit: '150' }));
  }

  async search(q) {
    return this._stations(await this.api('/json/stations/search', { name: q, order: 'clickcount', reverse: 'true', limit: '60' }));
  }

  async tags() {
    const list = await this.api('/json/tags', { order: 'stationcount', reverse: 'true', limit: '120' });
    return (list || []).filter((t) => t.stationcount >= 40 && /^[a-z0-9 &'-]{2,24}$/i.test(t.name)).map((t) => ({ name: t.name, count: t.stationcount }));
  }

  async countries() {
    const list = await this.api('/json/countries', { order: 'stationcount', reverse: 'true' });
    return (list || []).filter((c) => c.stationcount >= 15 && c.iso_3166_1).map((c) => ({ name: c.name, code: c.iso_3166_1, count: c.stationcount }));
  }

  /** Tell the directory a station was played (it uses this for its charts). */
  click(s) {
    this.api(`/json/url/${encodeURIComponent(s.uuid)}`).catch(() => {});
  }

  localCountry() {
    if (this.store.settings.radioCountry) return this.store.settings.radioCountry;
    const loc = navigator.language || 'en-US';
    const m = /-([A-Z]{2})$/i.exec(loc);
    return m ? m[1].toUpperCase() : 'US';
  }

  // ------------------------------------------------------------ favorites --

  get favorites() {
    return this.store.user.radioFavorites;
  }

  isFavorite(s) {
    return !!s && this.favorites.some((f) => f.uuid === s.uuid);
  }

  toggleFavorite(s) {
    const u = this.store.user;
    if (this.isFavorite(s)) u.radioFavorites = u.radioFavorites.filter((f) => f.uuid !== s.uuid);
    else u.radioFavorites.push(s);
    this.store.touchUser('radio');
  }

  addRecent(s) {
    const u = this.store.user;
    u.radioRecent = [s, ...u.radioRecent.filter((r) => r.uuid !== s.uuid)].slice(0, 25);
    this.store.touchUser('radio');
  }
}
