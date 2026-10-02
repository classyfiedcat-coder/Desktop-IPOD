'use strict';

/**
 * Local music library: walks the user's music folders, reads tags with
 * music-metadata, extracts album artwork to a cache and keeps an incremental
 * JSON index so rescans only parse new or changed files.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { nativeImage } = require('electron');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.m4b', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus', '.weba']);
const PLAYLIST_EXT = new Set(['.m3u', '.m3u8']);
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall'];
const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information', '.git']);
const MAX_FILES = 150000;
const LIBRARY_VERSION = 3;

let mm = null;
async function musicMetadata() {
  if (!mm) mm = await import('music-metadata');
  return mm;
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const norm = (p) => path.resolve(p).toLowerCase();

class Library {
  constructor(userDataDir) {
    this.dir = userDataDir;
    this.indexFile = path.join(userDataDir, 'library.json');
    this.artDir = path.join(userDataDir, 'artwork');
    this.data = { version: LIBRARY_VERSION, folders: [], tracks: [], playlists: [], scannedAt: 0 };
    this.byId = new Map();
    this.scanning = null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      if (raw.version === LIBRARY_VERSION) this.data = raw;
    } catch {
      /* no index yet */
    }
    this._reindex();
  }

  _reindex() {
    this.byId = new Map(this.data.tracks.map((t) => [t.id, t]));
  }

  pathFor(id) {
    const t = this.byId.get(id);
    return t ? t.path : null;
  }

  artPath(file) {
    if (!/^[a-f0-9]{40}\.jpg$/.test(file)) return null;
    return path.join(this.artDir, file);
  }

  /** Library snapshot for the renderer (no absolute paths). */
  snapshot() {
    return {
      scannedAt: this.data.scannedAt,
      folders: this.data.folders,
      tracks: this.data.tracks.map(({ path: _p, mtime: _m, size: _s, ...t }) => t),
      playlists: this.data.playlists,
    };
  }

  async scan(folders, onProgress = () => {}) {
    if (this.scanning) return this.scanning;
    this.scanning = this._scan(folders, onProgress).finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  async _scan(folders, onProgress) {
    const { parseFile } = await musicMetadata();
    await fsp.mkdir(this.artDir, { recursive: true });

    const audio = [];
    const playlists = [];
    const coverCache = new Map();
    for (const folder of folders) {
      await walk(folder, 0, (file, ext) => {
        if (AUDIO_EXT.has(ext)) audio.push(file);
        else if (PLAYLIST_EXT.has(ext)) playlists.push(file);
        return audio.length < MAX_FILES;
      });
    }

    const previous = new Map(this.data.tracks.map((t) => [t.path, t]));
    const tracks = [];
    let done = 0;
    onProgress({ phase: 'reading', done, total: audio.length });

    const worker = async (file) => {
      let st;
      try {
        st = await fsp.stat(file);
      } catch {
        return;
      }
      const prev = previous.get(file);
      if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) {
        tracks.push(prev);
        return;
      }
      let meta = null;
      try {
        meta = await parseFile(file, { duration: false, skipPostHeaders: true });
      } catch {
        meta = null;
      }
      const track = await this._toTrack(file, st, meta, prev, coverCache);
      tracks.push(track);
    };

    const queue = audio.slice();
    const runners = Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const file = queue.shift();
        await worker(file);
        done++;
        if (done % 25 === 0) onProgress({ phase: 'reading', done, total: audio.length });
      }
    });
    await Promise.all(runners);

    // Stable ordering keeps the index diff-friendly.
    tracks.sort((a, b) => (a.path < b.path ? -1 : 1));

    const byPath = new Map(tracks.map((t) => [norm(t.path), t.id]));
    const parsedPlaylists = [];
    for (const file of playlists) {
      try {
        const pl = await parsePlaylist(file, byPath);
        if (pl.trackIds.length) parsedPlaylists.push(pl);
      } catch {
        /* unreadable playlist */
      }
    }
    parsedPlaylists.sort((a, b) => a.name.localeCompare(b.name));

    this.data = {
      version: LIBRARY_VERSION,
      folders: folders.slice(),
      tracks,
      playlists: parsedPlaylists,
      scannedAt: Date.now(),
    };
    this._reindex();
    await fsp.writeFile(this.indexFile, JSON.stringify(this.data));
    onProgress({ phase: 'done', done: audio.length, total: audio.length });
    return this.snapshot();
  }

  async _toTrack(file, st, meta, prev, coverCache) {
    const c = (meta && meta.common) || {};
    const f = (meta && meta.format) || {};
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file, path.extname(file));
    const title = clean(c.title) || prettifyFileName(base);
    const artist = clean(c.artist) || (c.artists && clean(c.artists[0])) || 'Unknown Artist';
    const albumArtist = clean(c.albumartist) || artist;
    const album = clean(c.album) || 'Unknown Album';
    const genre = clean(c.genre && c.genre[0]) || '';
    let kind = 'music';
    if (ext === '.m4b' || /audio ?book|spoken/i.test(genre)) kind = 'audiobook';
    else if (/podcast/i.test(genre) || c.podcast) kind = 'podcast';

    const art = await this._artwork(file, c, albumArtist, album, coverCache);
    return {
      id: hash(file).slice(0, 20),
      path: file,
      mtime: st.mtimeMs,
      size: st.size,
      addedAt: prev ? prev.addedAt : Date.now(),
      title,
      artist,
      albumArtist,
      album,
      genre,
      composer: clean(c.composer && c.composer[0]) || '',
      year: c.year || null,
      trackNo: (c.track && c.track.no) || null,
      discNo: (c.disk && c.disk.no) || null,
      duration: typeof f.duration === 'number' && isFinite(f.duration) ? f.duration : 0,
      compilation: !!c.compilation,
      gain: c.replaygain_track_gain && typeof c.replaygain_track_gain.dB === 'number' ? c.replaygain_track_gain.dB : null,
      lyrics: extractLyrics(c),
      kind,
      art,
    };
  }

  async _artwork(file, common, albumArtist, album, coverCache) {
    const key = hash(`${albumArtist}\u0000${album}\u0000${album === 'Unknown Album' ? path.dirname(file) : ''}`);
    const out = path.join(this.artDir, `${key}.jpg`);
    if (coverCache.has(key)) return coverCache.get(key);
    if (fs.existsSync(out)) {
      coverCache.set(key, `${key}.jpg`);
      return `${key}.jpg`;
    }
    let buf = null;
    const pic = common.picture && common.picture[0];
    if (pic && pic.data) buf = Buffer.from(pic.data);
    if (!buf) buf = await findFolderCover(path.dirname(file));
    if (!buf) {
      coverCache.set(key, null);
      return null;
    }
    try {
      let img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) {
        coverCache.set(key, null);
        return null;
      }
      const { width } = img.getSize();
      if (width > 500) img = img.resize({ width: 500, quality: 'best' });
      await fsp.writeFile(out, img.toJPEG(88));
      coverCache.set(key, `${key}.jpg`);
      return `${key}.jpg`;
    } catch {
      coverCache.set(key, null);
      return null;
    }
  }
}

function clean(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\u0000/g, '').trim();
}

function extractLyrics(common) {
  const l = common.lyrics && common.lyrics[0];
  if (!l) return null;
  if (typeof l === 'string') return l.slice(0, 20000);
  if (typeof l.text === 'string') return l.text.slice(0, 20000);
  return null;
}

function prettifyFileName(name) {
  return name.replace(/^\d{1,3}[\s._-]+/, '').replace(/_/g, ' ').trim() || name;
}

async function walk(dir, depth, onFile) {
  if (depth > 14) return true;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return true;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
      const keepGoing = await walk(full, depth + 1, onFile);
      if (!keepGoing) return false;
    } else if (e.isFile()) {
      const keepGoing = onFile(full, path.extname(e.name).toLowerCase());
      if (keepGoing === false) return false;
    }
  }
  return true;
}

async function findFolderCover(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return null;
  }
  const candidates = entries.filter((n) => /\.(jpe?g|png)$/i.test(n));
  const pick =
    candidates.find((n) => COVER_NAMES.includes(path.basename(n, path.extname(n)).toLowerCase())) ||
    candidates.find((n) => /cover|front|folder/i.test(n));
  if (!pick) return null;
  try {
    return await fsp.readFile(path.join(dir, pick));
  } catch {
    return null;
  }
}

async function parsePlaylist(file, byPath) {
  const raw = await fsp.readFile(file, 'utf8');
  const dir = path.dirname(file);
  const trackIds = [];
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim().replace(/^﻿/, '');
    if (!line || line.startsWith('#')) continue;
    if (/^file:\/\//i.test(line)) {
      try {
        line = decodeURIComponent(new URL(line).pathname).replace(/^\/([a-zA-Z]:)/, '$1');
      } catch {
        continue;
      }
    }
    const abs = path.isAbsolute(line) ? line : path.join(dir, line);
    const id = byPath.get(norm(abs));
    if (id) trackIds.push(id);
  }
  return { id: hash(file).slice(0, 20), name: path.basename(file, path.extname(file)), trackIds };
}

module.exports = { Library };
