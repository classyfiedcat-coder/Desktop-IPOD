'use strict';

/**
 * Serves the renderer bundle and local media over the privileged app:// scheme.
 * Media files are only reachable through opaque ids handed out by the library
 * or folder listings, never by raw path.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { nativeImage } = require('electron');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.weba': 'audio/webm',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.txt': 'text/plain; charset=utf-8',
};

const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv']);
const NOTE_EXT = new Set(['.txt', '.md']);

const idFor = (p) => crypto.createHash('sha1').update(p).digest('hex').slice(0, 20);

class MediaServer {
  constructor({ rendererDir, library }) {
    this.rendererDir = path.resolve(rendererDir);
    this.library = library;
    this.photos = new Map();
    this.videos = new Map();
    this.thumbs = new Map(); // id -> Buffer (small LRU)
  }

  async handle(request) {
    const url = new URL(request.url);
    if (url.host !== 'ipod') return text(404, 'Not found');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/media/')) {
      const [, , kind, id] = pathname.split('/');
      switch (kind) {
        case 'track':
          return this._file(this.library.pathFor(id), request);
        case 'art':
          return this._file(this.library.artPath(id), request, 'public, max-age=31536000');
        case 'photo':
          return this._file(this.photos.get(id), request);
        case 'thumb':
          return this._thumb(id);
        case 'video':
          return this._file(this.videos.get(id), request);
        default:
          return text(404, 'Not found');
      }
    }

    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(this.rendererDir, rel);
    if (!file.startsWith(this.rendererDir + path.sep)) return text(403, 'Forbidden');
    return this._file(file, request, 'no-cache');
  }

  async _file(file, request, cacheControl) {
    if (!file) return text(404, 'Not found');
    let st;
    try {
      st = await fsp.stat(file);
      if (!st.isFile()) return text(404, 'Not found');
    } catch {
      return text(404, 'Not found');
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
    };
    if (cacheControl) headers['Cache-Control'] = cacheControl;

    const range = request.headers.get('range');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        let start = m[1] === '' ? null : parseInt(m[1], 10);
        let end = m[2] === '' ? null : parseInt(m[2], 10);
        if (start === null) {
          start = Math.max(0, st.size - (end || 0));
          end = st.size - 1;
        } else if (end === null || end >= st.size) {
          end = st.size - 1;
        }
        if (start >= st.size || start > end) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
        headers['Content-Length'] = String(end - start + 1);
        const stream = Readable.toWeb(fs.createReadStream(file, { start, end }));
        return new Response(stream, { status: 206, headers });
      }
    }
    headers['Content-Length'] = String(st.size);
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers });
  }

  async _thumb(id) {
    const file = this.photos.get(id);
    if (!file) return text(404, 'Not found');
    let buf = this.thumbs.get(id);
    if (!buf) {
      try {
        let img;
        if (process.platform === 'win32' || process.platform === 'darwin') {
          img = await nativeImage.createThumbnailFromPath(file, { width: 240, height: 240 });
        } else {
          img = nativeImage.createFromPath(file);
          if (!img.isEmpty()) img = img.resize({ width: 240 });
        }
        if (!img || img.isEmpty()) return this._file(file, { headers: new Headers() });
        buf = img.toJPEG(82);
      } catch {
        return this._file(file, { headers: new Headers() });
      }
      this.thumbs.set(id, buf);
      if (this.thumbs.size > 400) this.thumbs.delete(this.thumbs.keys().next().value);
    }
    return new Response(buf, { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' } });
  }

  async listPhotos(folder) {
    const files = await listFiles(folder, PHOTO_EXT, 4, 5000);
    const albums = new Map();
    const out = [];
    for (const f of files) {
      const id = idFor(f.path);
      this.photos.set(id, f.path);
      const album = path.relative(folder, path.dirname(f.path)) || path.basename(folder);
      const photo = { id, name: path.basename(f.path), album, mtime: f.mtime };
      out.push(photo);
      if (!albums.has(album)) albums.set(album, []);
      albums.get(album).push(id);
    }
    out.sort((a, b) => a.mtime - b.mtime);
    return { photos: out, albums: [...albums.entries()].map(([name, ids]) => ({ name, ids })) };
  }

  async listVideos(folder) {
    const files = await listFiles(folder, VIDEO_EXT, 4, 3000);
    return files
      .map((f) => {
        const id = idFor(f.path);
        this.videos.set(id, f.path);
        return { id, title: path.basename(f.path, path.extname(f.path)), mtime: f.mtime, size: f.size };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async listNotes(folder) {
    const files = await listFiles(folder, NOTE_EXT, 2, 500);
    const out = [];
    for (const f of files) {
      if (f.size > 256 * 1024) continue;
      try {
        const body = await fsp.readFile(f.path, 'utf8');
        out.push({ id: idFor(f.path), title: path.basename(f.path, path.extname(f.path)), body });
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }
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

function text(status, body) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

module.exports = { MediaServer };
