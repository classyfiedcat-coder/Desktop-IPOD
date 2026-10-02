'use strict';

/**
 * Podcast feeds (RSS 2.0 + iTunes tags) and episode downloads.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const { request, isPublicUrl } = require('./net');
const { log } = require('./log');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => name === 'item' || name === 'entry' || name === 'outline',
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

const idFor = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 20);

function txt(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return txt(v['#text'] !== undefined ? v['#text'] : '');
  return String(v).trim();
}

function stripHtml(html) {
  return txt(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "1:02:03", "62:03", "3723" → seconds */
function parseDuration(v) {
  const s = txt(v);
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  const parts = s.split(':').map((x) => parseInt(x, 10) || 0);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Parse an RSS podcast feed into a show and its episodes (newest first). */
function parseFeed(xml, feedUrl = '') {
  const doc = parser.parse(xml);
  const ch = doc && doc.rss && doc.rss.channel;
  if (!ch) throw new Error('This doesn’t look like a podcast feed.');
  const chImage = (ch['itunes:image'] && ch['itunes:image']['@_href']) || (ch.image && txt(ch.image.url)) || null;
  const items = Array.isArray(ch.item) ? ch.item : [];
  const episodes = [];
  for (const it of items) {
    const enc = it.enclosure || (Array.isArray(it['media:content']) ? it['media:content'][0] : it['media:content']);
    const url = enc && (enc['@_url'] || enc.url);
    if (!url) continue;
    const guid = txt(it.guid) || url;
    const date = Date.parse(txt(it.pubDate)) || 0;
    episodes.push({
      id: idFor(`${feedUrl}\u0000${guid}`),
      guid,
      title: txt(it.title) || 'Episode',
      date,
      duration: parseDuration(it['itunes:duration']),
      url,
      type: (enc && enc['@_type']) || 'audio/mpeg',
      size: parseInt((enc && enc['@_length']) || '0', 10) || 0,
      description: stripHtml(it['content:encoded'] || it.description || it['itunes:summary'] || '').slice(0, 8000),
      art: (it['itunes:image'] && it['itunes:image']['@_href']) || chImage,
      season: parseInt(txt(it['itunes:season']), 10) || null,
      episode: parseInt(txt(it['itunes:episode']), 10) || null,
      explicit: /yes|true/i.test(txt(it['itunes:explicit'])),
    });
  }
  episodes.sort((a, b) => b.date - a.date);
  return {
    feedUrl,
    title: txt(ch.title) || 'Podcast',
    author: txt(ch['itunes:author']) || txt(ch.managingEditor) || '',
    description: stripHtml(ch.description || ch['itunes:summary'] || '').slice(0, 4000),
    art: chImage,
    link: txt(ch.link),
    episodes,
  };
}

/** OPML (podcast subscription export) → feed URLs with titles. */
function parseOpml(xml) {
  const doc = parser.parse(xml);
  const out = [];
  const visit = (nodes) => {
    for (const n of nodes || []) {
      const url = n['@_xmlUrl'] || n['@_xmlurl'];
      if (url) out.push({ feedUrl: url, title: n['@_text'] || n['@_title'] || url });
      if (n.outline) visit(n.outline);
    }
  };
  visit(doc && doc.opml && doc.opml.body && doc.opml.body.outline);
  return out;
}

function toOpml(subs) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const body = subs.map((s) => `    <outline type="rss" text="${esc(s.title)}" title="${esc(s.title)}" xmlUrl="${esc(s.feedUrl)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>iPod Podcasts</title></head>\n  <body>\n${body}\n  </body>\n</opml>\n`;
}

class Podcasts {
  constructor(userDataDir, onProgress) {
    this.dir = path.join(userDataDir, 'podcasts');
    this.indexFile = path.join(this.dir, 'downloads.json');
    this.onProgress = onProgress || (() => {});
    this.downloads = {};
    this.active = new Map();
    try {
      this.downloads = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch {
      this.downloads = {};
    }
  }

  async fetchFeed(url) {
    if (!isPublicUrl(url)) throw new Error('That feed address isn’t allowed.');
    const xml = await request(url, { as: 'text', untrusted: true, maxBytes: 25 * 1024 * 1024, timeout: 25000, headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
    return parseFeed(xml, url);
  }

  downloadPath(id) {
    const d = this.downloads[id];
    return d && d.done ? path.join(this.dir, d.file) : null;
  }

  list() {
    return Object.fromEntries(Object.entries(this.downloads).map(([id, d]) => [id, { done: !!d.done, size: d.size || 0 }]));
  }

  async download(ep) {
    if (!ep || !ep.id || !isPublicUrl(ep.url)) throw new Error('Can’t download this episode.');
    if (this.active.has(ep.id)) return this.active.get(ep.id);
    const job = (async () => {
      await fsp.mkdir(this.dir, { recursive: true });
      const ext = (/\.(mp3|m4a|aac|ogg|opus|mp4|m4v)(\?|$)/i.exec(ep.url) || [, 'mp3'])[1].toLowerCase();
      const file = `${ep.id}.${ext}`;
      const tmp = path.join(this.dir, `${file}.part`);
      const res = await request(ep.url, { as: 'response', timeout: 30000, untrusted: true });
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
      const total = +res.headers.get('content-length') || ep.size || 0;
      const out = fs.createWriteStream(tmp);
      let got = 0;
      let lastEmit = 0;
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
          if (Date.now() - lastEmit > 300) {
            lastEmit = Date.now();
            this.onProgress({ id: ep.id, got, total });
          }
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      await fsp.rename(tmp, path.join(this.dir, file));
      this.downloads[ep.id] = { file, done: true, size: got, title: ep.title, at: Date.now() };
      await this._save();
      this.onProgress({ id: ep.id, got, total: got, done: true });
      return { id: ep.id, size: got };
    })()
      .catch((err) => {
        log.warn('[podcasts] download failed', ep.url, err.message);
        this.onProgress({ id: ep.id, error: err.message });
        throw err;
      })
      .finally(() => this.active.delete(ep.id));
    this.active.set(ep.id, job);
    return job;
  }

  async remove(id) {
    const d = this.downloads[id];
    if (!d) return;
    await fsp.rm(path.join(this.dir, d.file), { force: true });
    delete this.downloads[id];
    await this._save();
  }

  async _save() {
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(this.indexFile, JSON.stringify(this.downloads));
  }
}

module.exports = { Podcasts, parseFeed, parseOpml, toOpml, parseDuration, stripHtml };
