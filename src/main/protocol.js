'use strict';

/**
 * The privileged app:// scheme. Serves the renderer bundle and every piece of
 * media the iPod plays or shows:
 *
 *   app://ipod/<file>                    renderer files
 *   app://ipod/media/track/<id>          local songs (range requests for seeking)
 *   app://ipod/media/art/<key>           album artwork, resized on demand
 *   app://ipod/media/photo|thumb/<id>    photos and thumbnails
 *   app://ipod/media/video/<id>          videos, /media/sub/<id> subtitles (VTT)
 *   app://ipod/media/download/<id>       downloaded podcast episodes
 *   app://ipod/media/remote?u=…[&icy=1]  internet radio / podcast streams
 *   app://ipod/media/img?u=…             remote images (station logos, podcast art)
 *
 * Streams go through the main process so audio stays same-origin (the Web
 * Audio EQ can't process cross-origin audio) and so ICY "now playing" titles
 * can be read out of radio streams.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Readable } = require('stream');
const { nativeImage } = require('electron');
const { request, isPublicUrl } = require('./net');
const { createIcyTransform } = require('./icy');
const { srtToVtt } = require('./folders');
const { log } = require('./log');

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
  '.vtt': 'text/vtt; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const STREAM_TYPES = { 'audio/aacp': 'audio/aac', 'audio/x-aac': 'audio/aac', 'audio/mpegurl': 'audio/mpeg', 'application/octet-stream': 'audio/mpeg' };

class Protocol {
  constructor({ rendererDir, library, folders, podcasts, onIcy }) {
    this.rendererDir = path.resolve(rendererDir);
    this.library = library;
    this.folders = folders;
    this.podcasts = podcasts;
    this.onIcy = onIcy || (() => {});
    this.thumbs = new Map();
    this.images = new Map();
  }

  async handle(req) {
    let url;
    try {
      url = new URL(req.url);
    } catch {
      return text(400, 'Bad request');
    }
    if (url.host !== 'ipod') return text(404, 'Not found');
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (pathname.startsWith('/media/')) return await this._media(pathname, url, req);
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const file = path.resolve(this.rendererDir, rel);
      if (!file.startsWith(this.rendererDir + path.sep)) return text(403, 'Forbidden');
      return await serveFile(file, req, 'no-cache');
    } catch (err) {
      log.warn('[protocol]', pathname, err.message);
      return text(500, 'Error');
    }
  }

  async _media(pathname, url, req) {
    const [, , kind, id] = pathname.split('/');
    switch (kind) {
      case 'track':
        return serveFile(this.library.pathFor(id), req);
      case 'art':
        return serveFile(await this.library.artFile(id), req, 'public, max-age=31536000, immutable');
      case 'photo':
        return serveFile(this.folders.photos.get(id), req);
      case 'thumb':
        return this._thumb(id);
      case 'video':
        return serveFile(this.folders.videos.get(id), req);
      case 'sub':
        return this._subtitle(id);
      case 'download':
        return serveFile(this.podcasts ? this.podcasts.downloadPath(id) : null, req);
      case 'remote':
        return this._remote(url, req);
      case 'img':
        return this._image(url);
      default:
        return text(404, 'Not found');
    }
  }

  async _thumb(id) {
    const file = this.folders.photos.get(id);
    if (!file) return text(404, 'Not found');
    let buf = this.thumbs.get(id);
    if (!buf) {
      let img;
      try {
        if (process.platform === 'win32' || process.platform === 'darwin') img = await nativeImage.createThumbnailFromPath(file, { width: 240, height: 240 });
        else {
          img = nativeImage.createFromPath(file);
          if (!img.isEmpty()) img = img.resize({ width: 240 });
        }
      } catch {
        img = null;
      }
      if (!img || img.isEmpty()) return serveFile(file, { headers: new Headers() });
      buf = img.toJPEG(82);
      this.thumbs.set(id, buf);
      if (this.thumbs.size > 500) this.thumbs.delete(this.thumbs.keys().next().value);
    }
    return new Response(buf, { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' } });
  }

  async _subtitle(id) {
    const file = this.folders.subs.get(id);
    if (!file) return text(404, 'Not found');
    const raw = await fsp.readFile(file, 'utf8');
    const vtt = file.toLowerCase().endsWith('.srt') ? srtToVtt(raw) : raw;
    return new Response(vtt, { status: 200, headers: { 'Content-Type': 'text/vtt; charset=utf-8' } });
  }

  async _remote(url, req) {
    const target = url.searchParams.get('u');
    if (!target || !isPublicUrl(target)) return text(403, 'Forbidden');
    const icy = url.searchParams.get('icy') === '1';
    const sid = url.searchParams.get('sid') || '';
    const headers = { Accept: '*/*' };
    const range = req.headers.get('range');
    if (range && !icy) headers.Range = range;
    if (icy) headers['Icy-MetaData'] = '1';
    let res;
    try {
      res = await request(target, { as: 'response', headers, timeout: 20000 });
    } catch (err) {
      return text(502, err.message);
    }
    if (!res.ok && res.status !== 206) return text(res.status || 502, 'Upstream error');
    const out = new Headers();
    let type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    type = STREAM_TYPES[type] || type || 'audio/mpeg';
    out.set('Content-Type', type);
    out.set('Cache-Control', 'no-store');
    const metaint = icy ? parseInt(res.headers.get('icy-metaint') || '0', 10) : 0;
    if (icy) {
      const name = res.headers.get('icy-name');
      if (name) this.onIcy(sid, { station: name, genre: res.headers.get('icy-genre') || '', bitrate: res.headers.get('icy-br') || '' });
    }
    let body = res.body;
    if (metaint > 0 && body) {
      body = body.pipeThrough(createIcyTransform(metaint, (meta) => this.onIcy(sid, meta)));
    } else {
      for (const h of ['content-length', 'content-range', 'accept-ranges']) {
        const v = res.headers.get(h);
        if (v) out.set(h, v);
      }
    }
    return new Response(body, { status: res.status === 206 ? 206 : 200, headers: out });
  }

  async _image(url) {
    const target = url.searchParams.get('u');
    if (!target || !isPublicUrl(target)) return text(403, 'Forbidden');
    let hit = this.images.get(target);
    if (!hit) {
      try {
        const { data, type } = await request(target, { as: 'buffer', maxBytes: 3 * 1024 * 1024, timeout: 12000 });
        if (!/^image\//i.test(type)) return text(415, 'Not an image');
        hit = { data, type };
        this.images.set(target, hit);
        if (this.images.size > 300) this.images.delete(this.images.keys().next().value);
      } catch {
        return text(502, 'Image unavailable');
      }
    }
    return new Response(hit.data, { status: 200, headers: { 'Content-Type': hit.type, 'Cache-Control': 'max-age=86400' } });
  }
}

async function serveFile(file, req, cacheControl) {
  if (!file) return text(404, 'Not found');
  let st;
  try {
    st = await fsp.stat(file);
    if (!st.isFile()) return text(404, 'Not found');
  } catch {
    return text(404, 'Not found');
  }
  const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  if (cacheControl) headers['Cache-Control'] = cacheControl;
  const range = req.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10);
      let end = m[2] === '' ? null : parseInt(m[2], 10);
      if (start === null) {
        start = Math.max(0, st.size - (end || 0));
        end = st.size - 1;
      } else if (end === null || end >= st.size) end = st.size - 1;
      if (start >= st.size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
      headers['Content-Length'] = String(end - start + 1);
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers });
    }
  }
  headers['Content-Length'] = String(st.size);
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers });
}

function text(status, body) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

module.exports = { Protocol, serveFile };
