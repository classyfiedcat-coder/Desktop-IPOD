'use strict';

/**
 * Finds missing album artwork online, like iTunes' "Get Album Artwork":
 * the iTunes Search API first, then MusicBrainz + the Cover Art Archive.
 */

const { request } = require('./net');
const { log } = require('./log');

const simplify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function similar(a, b) {
  const x = simplify(a);
  const y = simplify(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

async function fromItunes(artist, album) {
  const q = new URLSearchParams({ term: `${artist} ${album}`, entity: 'album', limit: '8', media: 'music' });
  const res = await request(`https://itunes.apple.com/search?${q}`, { as: 'json', timeout: 10000 });
  const hit = (res.results || []).find((r) => similar(r.collectionName, album) && similar(r.artistName, artist)) || (res.results || []).find((r) => similar(r.collectionName, album));
  if (!hit || !hit.artworkUrl100) return null;
  return hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.');
}

async function fromCoverArtArchive(artist, album) {
  const query = `releasegroup:"${album.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`;
  const res = await request(`https://musicbrainz.org/ws/2/release-group/?${new URLSearchParams({ query, fmt: 'json', limit: '3' })}`, { as: 'json', timeout: 12000 });
  const rg = (res['release-groups'] || []).find((g) => similar(g.title, album));
  if (!rg) return null;
  return `https://coverartarchive.org/release-group/${rg.id}/front-500`;
}

/** No HTTP status means we never reached the server (offline, DNS, timeout). */
const unreachable = (err) => !err.status || err.status === 408;

async function findArtwork({ artist, album }) {
  let reached = false;
  for (const source of [fromItunes, fromCoverArtArchive]) {
    try {
      const url = await source(artist, album);
      reached = true;
      if (!url) continue;
      const { data, type } = await request(url, { as: 'buffer', maxBytes: 6 * 1024 * 1024, timeout: 15000, untrusted: true });
      if (/^image\//.test(type) && data.length > 1000) return data;
    } catch (err) {
      if (!unreachable(err)) reached = true;
      log.warn('[artwork]', source.name, album, err.message);
    }
  }
  if (!reached) throw Object.assign(new Error('Can’t reach the artwork services.'), { offline: true });
  return null;
}

/** Look up artwork for every album missing it. */
async function fillMissing(library, onProgress = () => {}, { limit = 500 } = {}) {
  const todo = library.missingArt().slice(0, limit);
  let found = 0;
  let offline = 0;
  for (let i = 0; i < todo.length; i++) {
    const a = todo[i];
    onProgress({ done: i, total: todo.length, found, album: a.album });
    let buf = null;
    try {
      buf = await findArtwork(a);
      offline = 0;
    } catch (err) {
      // Offline: stop after a few albums in a row instead of timing out on all of them.
      if (err.offline && ++offline >= 3) {
        onProgress({ done: i, total: todo.length, found, finished: true, error: 'Couldn’t connect to the internet.' });
        return { checked: i, found, offline: true };
      }
    }
    if (buf) {
      await library.setArt(a.key, buf);
      found++;
    }
  }
  onProgress({ done: todo.length, total: todo.length, found, finished: true });
  return { checked: todo.length, found };
}

module.exports = { findArtwork, fillMissing, similar };
