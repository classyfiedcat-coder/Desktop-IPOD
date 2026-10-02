'use strict';

/**
 * Lyrics from LRCLIB (https://lrclib.net), a free, open lyrics database with
 * time-synced LRC lyrics. Results (including misses) are cached on disk.
 */

const fs = require('fs');
const path = require('path');
const { request } = require('./net');

const MISS_TTL = 7 * 24 * 3600 * 1000;
const MAX_ENTRIES = 5000;

/** Strip "(Remastered 2011)", "- Live", "feat. X" so lookups match more often. */
function cleanTitle(title) {
  return String(title || '')
    .replace(/\s*[([](?:feat\.?|ft\.?|with)[^)\]]*[)\]]/gi, '')
    .replace(/\s*[([][^)\]]*(?:remaster|version|edit|mono|stereo|deluxe|bonus|live|mix)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|live|single version|radio edit|mono|stereo).*$/i, '')
    .trim();
}

function firstArtist(artist) {
  return String(artist || '')
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|;)\s*/i)[0]
    .trim();
}

class Lyrics {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'lyrics-cache.json');
    this.cache = {};
    try {
      this.cache = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.cache = {};
    }
    this._saveTimer = null;
  }

  _key(artist, title) {
    return `${firstArtist(artist).toLowerCase()}\u0000${cleanTitle(title).toLowerCase()}`;
  }

  _store(key, value) {
    this.cache[key] = { ...value, at: Date.now() };
    const keys = Object.keys(this.cache);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => this.cache[a].at - this.cache[b].at);
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete this.cache[k];
    }
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        fs.writeFileSync(this.file, JSON.stringify(this.cache));
      } catch {
        /* ignore */
      }
    }, 1000);
  }

  async get({ title, artist, album, duration }) {
    if (!title || !artist) return null;
    const key = this._key(artist, title);
    const hit = this.cache[key];
    if (hit && (hit.found || Date.now() - hit.at < MISS_TTL)) return hit.found ? hit : null;

    const t = cleanTitle(title);
    const a = firstArtist(artist);
    let rec = null;
    try {
      const q = new URLSearchParams({ track_name: t, artist_name: a });
      if (album) q.set('album_name', album);
      if (duration) q.set('duration', String(Math.round(duration)));
      rec = await request(`https://lrclib.net/api/get?${q}`, { as: 'json', timeout: 10000 });
    } catch (err) {
      if (err.status && err.status !== 404) throw err;
    }
    if (!rec || (!rec.syncedLyrics && !rec.plainLyrics && !rec.instrumental)) {
      try {
        const list = await request(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: t, artist_name: a })}`, { as: 'json', timeout: 10000 });
        if (Array.isArray(list) && list.length) {
          const scored = list
            .filter((r) => r.syncedLyrics || r.plainLyrics)
            .map((r) => ({ r, d: duration && r.duration ? Math.abs(r.duration - duration) : 0, s: r.syncedLyrics ? 0 : 1 }))
            .sort((x, y) => x.d - y.d || x.s - y.s);
          if (scored.length && (!duration || scored[0].d < 8)) rec = scored[0].r;
        }
      } catch (err) {
        if (err.status && err.status !== 404) throw err;
      }
    }
    const value = rec
      ? { found: true, synced: rec.syncedLyrics || null, plain: rec.plainLyrics || null, instrumental: !!rec.instrumental, source: 'LRCLIB' }
      : { found: false };
    this._store(key, value);
    return value.found ? value : null;
  }
}

module.exports = { Lyrics, cleanTitle, firstArtist };
