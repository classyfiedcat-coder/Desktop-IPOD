'use strict';

/**
 * Library scanner. Runs in an Electron utility process so tag parsing for
 * large libraries never blocks the main process (which serves the audio).
 *
 * Messages in:  { type: 'scan', folders, previous, artDir }
 *               { type: 'files', paths, artDir }
 * Messages out: { type: 'progress', done, total, phase }
 *               { type: 'done', tracks, playlists }   |   { type: 'error', message }
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { parseM3U } = require('./playlist-files');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.m4b', '.aac', '.flac', '.wav', '.ogg', '.oga', '.opus', '.weba', '.alac']);
const PLAYLIST_EXT = new Set(['.m3u', '.m3u8']);
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall', 'artwork'];
const SKIP_DIRS = new Set(['node_modules', '$recycle.bin', 'system volume information', '.git', '@eadir']);
const MAX_FILES = 200000;
const CONCURRENCY = 8;

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const norm = (p) => path.resolve(p).toLowerCase();

let mm = null;
async function musicMetadata() {
  if (!mm) mm = await import('music-metadata');
  return mm;
}

const post = (msg) => process.parentPort && process.parentPort.postMessage(msg);

if (process.parentPort) process.parentPort.on('message', async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'scan') post({ type: 'done', ...(await scan(msg)) });
    else if (msg.type === 'files') post({ type: 'done', tracks: await parseFiles(msg), playlists: [] });
  } catch (err) {
    post({ type: 'error', message: err && err.stack ? err.stack : String(err) });
  }
});

async function scan({ folders, previous = [], artDir }) {
  await fsp.mkdir(artDir, { recursive: true });
  const audio = [];
  const playlists = [];
  for (const folder of folders) {
    await walk(folder, 0, (file, ext) => {
      if (AUDIO_EXT.has(ext)) audio.push(file);
      else if (PLAYLIST_EXT.has(ext)) playlists.push(file);
      return audio.length < MAX_FILES;
    });
  }
  post({ type: 'progress', phase: 'reading', done: 0, total: audio.length });

  const prev = new Map(previous.map((t) => [t.path, t]));
  const ctx = { artDir, covers: new Map() };
  const tracks = [];
  let done = 0;
  const queue = audio.slice();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const file = queue.shift();
        const t = await trackFor(file, prev.get(file), ctx);
        if (t) tracks.push(t);
        done++;
        if (done % 40 === 0) post({ type: 'progress', phase: 'reading', done, total: audio.length });
      }
    })
  );
  tracks.sort((a, b) => (a.path < b.path ? -1 : 1));

  const byPath = new Map(tracks.map((t) => [norm(t.path), t.id]));
  const lists = [];
  for (const file of playlists) {
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const trackIds = parseM3U(raw, path.dirname(file))
        .map((p) => byPath.get(norm(p)))
        .filter(Boolean);
      if (trackIds.length) lists.push({ id: hash(file).slice(0, 20), name: path.basename(file, path.extname(file)), trackIds, file });
    } catch {
      /* unreadable playlist */
    }
  }
  lists.sort((a, b) => a.name.localeCompare(b.name));
  post({ type: 'progress', phase: 'done', done: audio.length, total: audio.length });
  return { tracks, playlists: lists };
}

async function parseFiles({ paths, artDir }) {
  await fsp.mkdir(artDir, { recursive: true });
  const ctx = { artDir, covers: new Map() };
  const out = [];
  for (const p of paths) {
    if (!AUDIO_EXT.has(path.extname(p).toLowerCase())) continue;
    const t = await trackFor(p, null, ctx);
    if (t) out.push(t);
  }
  return out;
}

async function trackFor(file, prev, ctx) {
  let st;
  try {
    st = await fsp.stat(file);
  } catch {
    return null;
  }
  if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) return prev;
  const { parseFile } = await musicMetadata();
  let meta = null;
  try {
    meta = await parseFile(file, { duration: false, skipPostHeaders: true });
  } catch {
    meta = null;
  }
  return buildTrack(file, st, meta, prev, ctx);
}

function clean(v) {
  return typeof v === 'string' ? v.replace(/\u0000/g, '').trim() : '';
}

function prettify(name) {
  return name.replace(/^\d{1,3}[\s._-]+/, '').replace(/_/g, ' ').trim() || name;
}

async function buildTrack(file, st, meta, prev, ctx) {
  const c = (meta && meta.common) || {};
  const f = (meta && meta.format) || {};
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file, path.extname(file));
  const artist = clean(c.artist) || (c.artists && clean(c.artists[0])) || 'Unknown Artist';
  const albumArtist = clean(c.albumartist) || artist;
  const album = clean(c.album) || 'Unknown Album';
  const genre = clean(c.genre && c.genre[0]);
  let kind = 'music';
  if (ext === '.m4b' || /audio ?book|spoken/i.test(genre)) kind = 'audiobook';
  else if (/podcast/i.test(genre) || c.podcast) kind = 'podcast';
  const artKey = hash(`${albumArtist.toLowerCase()}\u0000${album.toLowerCase()}\u0000${album === 'Unknown Album' ? path.dirname(file) : ''}`);
  const art = await artwork(file, c, artKey, ctx);
  const lyric = c.lyrics && c.lyrics[0];
  return {
    id: hash(file).slice(0, 20),
    path: file,
    mtime: st.mtimeMs,
    size: st.size,
    addedAt: prev ? prev.addedAt : Math.min(Date.now(), st.birthtimeMs || st.mtimeMs || Date.now()),
    title: clean(c.title) || prettify(base),
    artist,
    albumArtist,
    album,
    genre,
    composer: clean(c.composer && c.composer[0]),
    year: c.year || null,
    trackNo: (c.track && c.track.no) || null,
    trackOf: (c.track && c.track.of) || null,
    discNo: (c.disk && c.disk.no) || null,
    duration: typeof f.duration === 'number' && isFinite(f.duration) ? f.duration : 0,
    compilation: !!c.compilation,
    gain: c.replaygain_track_gain && typeof c.replaygain_track_gain.dB === 'number' ? c.replaygain_track_gain.dB : null,
    albumGain: c.replaygain_album_gain && typeof c.replaygain_album_gain.dB === 'number' ? c.replaygain_album_gain.dB : null,
    bpm: c.bpm || null,
    lyrics: lyric ? String(typeof lyric === 'string' ? lyric : lyric.text || '').slice(0, 20000) || null : null,
    codec: f.codec || f.container || ext.slice(1).toUpperCase(),
    bitrate: f.bitrate ? Math.round(f.bitrate / 1000) : null,
    sampleRate: f.sampleRate || null,
    lossless: !!f.lossless,
    kind,
    artKey,
    art,
  };
}

/** Writes the source image as <key>.src once per album; the main process resizes it on demand. */
async function artwork(file, common, key, ctx) {
  if (ctx.covers.has(key)) return ctx.covers.get(key);
  const out = path.join(ctx.artDir, `${key}.src`);
  const remember = (v) => {
    ctx.covers.set(key, v);
    return v;
  };
  if (fs.existsSync(out)) return remember(key);
  let buf = null;
  const pic = common.picture && (common.picture.find((p) => /front|cover/i.test(p.type || '')) || common.picture[0]);
  if (pic && pic.data) buf = Buffer.from(pic.data);
  if (!buf) buf = await folderCover(path.dirname(file));
  if (!buf || buf.length < 64) return remember(null);
  try {
    await fsp.writeFile(out, buf);
    return remember(key);
  } catch {
    return remember(null);
  }
}

async function folderCover(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return null;
  }
  const images = entries.filter((n) => /\.(jpe?g|png)$/i.test(n));
  const pick =
    images.find((n) => COVER_NAMES.includes(path.basename(n, path.extname(n)).toLowerCase())) ||
    images.find((n) => /cover|front|folder/i.test(n)) ||
    (images.length === 1 ? images[0] : null);
  if (!pick) return null;
  try {
    return await fsp.readFile(path.join(dir, pick));
  } catch {
    return null;
  }
}

async function walk(dir, depth, onFile) {
  if (depth > 16) return true;
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
      if (!(await walk(full, depth + 1, onFile))) return false;
    } else if (e.isFile()) {
      if (onFile(full, path.extname(e.name).toLowerCase()) === false) return false;
    }
  }
  return true;
}

module.exports = { buildTrack, prettify, AUDIO_EXT };
