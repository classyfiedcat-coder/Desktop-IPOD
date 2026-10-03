'use strict';

/** Photos, videos, notes, contacts and calendars from user folders, served by opaque id over app://. */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv']);
const SUB_EXT = ['.vtt', '.srt'];
const idFor = (p) => crypto.createHash('sha1').update(p).digest('hex').slice(0, 20);

class Folders {
  constructor() {
    this.photos = new Map();
    this.videos = new Map();
    this.subs = new Map();
  }

  async listPhotos(folder) {
    const files = await listFiles(folder, PHOTO_EXT, 4, 8000);
    const albums = new Map();
    const photos = [];
    for (const f of files) {
      const id = idFor(f.path);
      this.photos.set(id, f.path);
      const album = path.relative(folder, path.dirname(f.path)) || path.basename(folder);
      photos.push({ id, name: path.basename(f.path), album, mtime: f.mtime });
      if (!albums.has(album)) albums.set(album, []);
      albums.get(album).push(id);
    }
    photos.sort((a, b) => a.mtime - b.mtime);
    return { photos, albums: [...albums.entries()].map(([name, ids]) => ({ name, ids })) };
  }

  async listVideos(folder) {
    const files = await listFiles(folder, VIDEO_EXT, 5, 5000);
    const out = [];
    for (const f of files) {
      const id = idFor(f.path);
      this.videos.set(id, f.path);
      const rel = path.relative(folder, f.path).split(/[\\/]/);
      const dirs = rel.slice(0, -1);
      let category = 'movies';
      let show = null;
      const idx = dirs.findIndex((d) => /^(tv( shows)?|series|shows)$/i.test(d));
      if (dirs.some((d) => /^music ?videos?$/i.test(d))) category = 'music-videos';
      else if (idx >= 0) {
        category = 'tv';
        show = dirs[idx + 1] || 'TV Shows';
      } else if (dirs.some((d) => /^(video )?podcasts?$/i.test(d))) category = 'video-podcasts';
      const base = path.basename(f.path, path.extname(f.path));
      const ep = /s(\d{1,2})e(\d{1,3})/i.exec(base);
      let sub = null;
      for (const ext of SUB_EXT) {
        for (const candidate of [`${base}${ext}`, `${base}.en${ext}`, `${base}.eng${ext}`]) {
          const p = path.join(path.dirname(f.path), candidate);
          if (fs.existsSync(p)) {
            sub = idFor(p);
            this.subs.set(sub, p);
            break;
          }
        }
        if (sub) break;
      }
      out.push({
        id,
        title: base.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim(),
        category,
        show,
        season: ep ? +ep[1] : null,
        episode: ep ? +ep[2] : null,
        mtime: f.mtime,
        size: f.size,
        sub,
      });
    }
    return out.sort((a, b) => (a.show || '').localeCompare(b.show || '') || (a.season || 0) - (b.season || 0) || (a.episode || 0) - (b.episode || 0) || a.title.localeCompare(b.title));
  }

  async readTexts(folder, exts, { depth = 2, limit = 500, maxBytes = 512 * 1024 } = {}) {
    const files = await listFiles(folder, new Set(exts), depth, limit);
    const out = [];
    for (const f of files) {
      if (f.size > maxBytes) continue;
      try {
        out.push({ id: idFor(f.path), name: path.basename(f.path, path.extname(f.path)), text: await fsp.readFile(f.path, 'utf8') });
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** SubRip → WebVTT so <track> can show it. */
function srtToVtt(srt) {
  return (
    'WEBVTT\n\n' +
    String(srt)
      .replace(/\r/g, '')
      .replace(/^﻿/, '')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
      .replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}\.\d{3})/gm, '')
  );
}

async function listFiles(root, exts, maxDepth, limit) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > maxDepth || out.length >= limit) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || out.length >= limit) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) {
        try {
          const st = await fsp.stat(full);
          out.push({ path: full, mtime: st.mtimeMs, size: st.size });
        } catch {
          /* skip */
        }
      }
    }
  }
  if (root) await walk(root, 0);
  return out;
}

module.exports = { Folders, srtToVtt, listFiles };
