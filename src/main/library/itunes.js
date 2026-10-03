'use strict';

/**
 * Reads an iTunes or Music app library, so the iPod is "synced" with it:
 * playlists (smart playlists as they are right now, and folders), star
 * ratings, play counts, last played and date added.
 *
 * It reads the XML that iTunes and the Music app write when "Share Library
 * XML with other applications" is on:
 *   Windows (iTunes):   Music\iTunes\iTunes Music Library.xml (or iTunes Library.xml)
 *   Mac (iTunes ≤ 12.9): ~/Music/iTunes/iTunes Music Library.xml
 *   Mac (Music app):    ~/Music/Music/Library.xml
 *
 * No Electron here, so it runs in the library scanner and in tests.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e] !== undefined ? ENTITIES[e] : m;
  });
}

/**
 * Parse an Apple XML property list into plain values: dict → object,
 * array → array, date → epoch ms, data → base64 string.
 */
function parsePlist(xml) {
  const re = /<(\/?)([A-Za-z]+)\b[^>]*?(\/?)>|([^<]+)/g;
  const stack = [];
  let root;
  let scalar = null;
  let text = '';
  const put = (v) => {
    const top = stack[stack.length - 1];
    if (!top) root = v;
    else if (top.array) top.v.push(v);
    else if (top.key !== null) {
      top.v[top.key] = v;
      top.key = null;
    }
  };
  const finish = (tag, raw) => {
    if (tag === 'key') {
      const top = stack[stack.length - 1];
      if (top && !top.array) top.key = unescapeXml(raw);
      return;
    }
    if (tag === 'string') put(unescapeXml(raw));
    else if (tag === 'integer') put(Number(raw.trim()));
    else if (tag === 'real') put(parseFloat(raw));
    else if (tag === 'date') put(Date.parse(raw.trim()) || 0);
    else put(raw.replace(/\s+/g, '')); // data
  };
  let m;
  while ((m = re.exec(xml))) {
    if (m[4] !== undefined) {
      if (scalar) text += m[4];
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2];
    const empty = m[3] === '/';
    if (closing) {
      if (tag === 'dict' || tag === 'array') {
        const frame = stack.pop();
        if (frame) put(frame.v);
      } else if (tag === scalar) {
        finish(tag, text);
        scalar = null;
        text = '';
      }
      continue;
    }
    switch (tag) {
      case 'dict':
        if (empty) put({});
        else stack.push({ v: {}, key: null, array: false });
        break;
      case 'array':
        if (empty) put([]);
        else stack.push({ v: [], array: true });
        break;
      case 'true':
        put(true);
        break;
      case 'false':
        put(false);
        break;
      case 'key':
      case 'string':
      case 'integer':
      case 'real':
      case 'date':
      case 'data':
        if (empty) finish(tag, '');
        else {
          scalar = tag;
          text = '';
        }
        break;
      default:
        break; // <plist>, and anything unknown
    }
  }
  return root;
}

/** A track's "Location" (a file:// URL) as a path on this computer. */
function fileFromLocation(loc, platform = process.platform) {
  if (typeof loc !== 'string' || !/^file:\/\//i.test(loc)) return null;
  let p = loc.replace(/^file:\/\/(localhost)?/i, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    return null;
  }
  if (platform === 'win32') {
    if (p.startsWith('//')) return `\\\\${p.slice(2).replace(/\//g, '\\')}`; // \\server\share
    if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p.replace(/\//g, '\\');
  }
  return p;
}

/**
 * The parts of a parsed library the iPod uses: local files with their stats,
 * and the user's playlists as lists of files.
 */
function readLibrary(plist, platform = process.platform) {
  const byKey = new Map();
  for (const [key, t] of Object.entries((plist && plist.Tracks) || {})) {
    // Only files on this computer: not streams, and not songs only in the cloud.
    if (!t || (t['Track Type'] && t['Track Type'] !== 'File')) continue;
    const file = fileFromLocation(t.Location, platform);
    if (!file) continue;
    byKey.set(String(t['Track ID'] !== undefined ? t['Track ID'] : key), {
      file,
      // A rating the album gave the song (rather than you) doesn't count.
      rating: t['Rating Computed'] ? 0 : Math.max(0, Math.min(5, Math.round((t.Rating || 0) / 20))),
      plays: t['Play Count'] || 0,
      lastPlayed: t['Play Date UTC'] || 0,
      added: t['Date Added'] || 0,
      skips: t['Skip Count'] || 0,
      loved: !!(t.Loved || t.Favorited),
    });
  }
  const playlists = [];
  for (const p of (plist && plist.Playlists) || []) {
    // Skip the whole library, the built-in lists (Music, Movies, Podcasts…) and hidden ones.
    if (!p || p.Master || p['Distinguished Kind'] !== undefined || p.Visible === false) continue;
    const name = String(p.Name || 'Untitled Playlist');
    playlists.push({
      id: String(p['Playlist Persistent ID'] || crypto.createHash('sha1').update(name).digest('hex').slice(0, 16)),
      parent: p['Parent Persistent ID'] ? String(p['Parent Persistent ID']) : null,
      name,
      folder: !!p.Folder,
      smart: !!p['Smart Info'],
      files: p.Folder ? [] : (p['Playlist Items'] || []).map((i) => byKey.get(String(i && i['Track ID']))).filter(Boolean).map((t) => t.file),
    });
  }
  return {
    musicFolder: fileFromLocation(plist && plist['Music Folder'], platform),
    tracks: [...byKey.values()],
    playlists,
  };
}

/** Where iTunes / Music keep the library XML, newest first. */
function libraryCandidates(musicDir, platform = process.platform) {
  const list = [path.join(musicDir, 'iTunes', 'iTunes Music Library.xml'), path.join(musicDir, 'iTunes', 'iTunes Library.xml')];
  if (platform === 'darwin') list.unshift(path.join(musicDir, 'Music', 'Library.xml'));
  return list;
}

/** The library XML that exists and was written most recently, or null. */
function findLibrary(musicDir, platform = process.platform) {
  let best = null;
  for (const file of libraryCandidates(musicDir, platform)) {
    try {
      const st = fs.statSync(file);
      if (st.isFile() && (!best || st.mtimeMs > best.mtime)) best = { file, mtime: st.mtimeMs };
    } catch {
      /* not there */
    }
  }
  return best ? best.file : null;
}

/** Normalise a path for matching: iTunes and the file system can disagree on case. */
const matchKey = (p) => path.resolve(p).normalize('NFC').toLowerCase();

/**
 * Match a read library against the iPod's own index (tracks with .path and .id).
 * Returns stats by track id and playlists as track ids.
 */
function matchLibrary(read, indexTracks) {
  const byPath = new Map(indexTracks.map((t) => [matchKey(t.path), t.id]));
  const idOf = (file) => byPath.get(matchKey(file));
  const stats = {};
  let matched = 0;
  for (const t of read.tracks) {
    const id = idOf(t.file);
    if (!id) continue;
    matched++;
    // Short keys and no zeros: this goes over IPC and into the index.
    const s = {};
    if (t.plays) s.p = t.plays;
    if (t.lastPlayed) s.l = t.lastPlayed;
    if (t.rating) s.r = t.rating;
    if (t.added) s.a = t.added;
    if (t.skips) s.s = t.skips;
    if (t.loved) s.f = 1;
    stats[id] = s;
  }
  let playlists = read.playlists.map((p) => ({
    id: `itunes:${p.id}`,
    parent: p.parent ? `itunes:${p.parent}` : null,
    name: p.name,
    folder: p.folder,
    smart: p.smart,
    trackIds: [...new Set(p.files.map(idOf).filter(Boolean))],
  }));
  // Drop empty playlists, then folders with nothing left in them (inner ones first).
  const keep = (list) => {
    const ids = new Set(list.map((p) => p.id));
    const hasChild = new Set(list.filter((p) => p.parent && ids.has(p.parent)).map((p) => p.parent));
    return list.filter((p) => (p.folder ? hasChild.has(p.id) : p.trackIds.length > 0));
  };
  for (let i = 0, n = -1; i < 8 && n !== playlists.length; i++) {
    n = playlists.length;
    playlists = keep(playlists);
  }
  return { stats, playlists, matched, total: read.tracks.length };
}

module.exports = { parsePlist, fileFromLocation, readLibrary, libraryCandidates, findLibrary, matchLibrary, matchKey };
