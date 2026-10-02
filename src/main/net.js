'use strict';

/**
 * Outbound HTTP for the app. Everything the iPod fetches from the internet
 * (lyrics, radio directory, podcast feeds, artwork, update checks) goes
 * through here so it gets one User-Agent, timeouts, per-host pacing, size
 * limits, private-network protection and — in development — a mock server.
 */

const electron = require('electron');
const { log } = require('./log');

const version = () => (electron.app && electron.app.getVersion ? electron.app.getVersion() : '0.0.0');
const UA = () => `iPodDesktop/${version()} (+https://github.com/classyfiedcat-coder/Ipod)`;

/** Hosts the renderer may query for JSON. */
const API_HOSTS = [
  'lrclib.net',
  'itunes.apple.com',
  'rss.applemarketingtools.com',
  'musicbrainz.org',
  'coverartarchive.org',
  /^[a-z0-9-]+\.api\.radio-browser\.info$/,
  'api.radio-browser.info',
];

/** Minimum gap between requests to a host (ms). MusicBrainz asks for 1/s. */
const PACE = { 'musicbrainz.org': 1100, 'lrclib.net': 120 };

const packaged = () => !!(electron.app && electron.app.isPackaged);
const mockBase = () => (!packaged() && process.env.IPOD_MOCK_NET ? process.env.IPOD_MOCK_NET.replace(/\/$/, '') : null);

const lastHit = new Map();
const chains = new Map();

function hostAllowed(host) {
  return API_HOSTS.some((h) => (typeof h === 'string' ? h === host : h.test(host)));
}

/** Reject loopback/private targets for URLs that came from feeds or users. */
function isPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (mockBase()) return true;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0') return false;
  if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(host)) return false;
  const m = /^172\.(\d+)\./.exec(host);
  if (m && +m[1] >= 16 && +m[1] <= 31) return false;
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return false;
  return true;
}

/** In development, send requests to a local mock server instead. */
function rewrite(raw) {
  const mock = mockBase();
  if (!mock) return raw;
  const u = new URL(raw);
  return `${mock}/${u.protocol.replace(':', '')}/${u.host}${u.pathname}${u.search}`;
}

async function pace(host) {
  const gap = PACE[host];
  if (!gap) return;
  const prev = chains.get(host) || Promise.resolve();
  const next = prev.then(async () => {
    const wait = (lastHit.get(host) || 0) + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastHit.set(host, Date.now());
  });
  chains.set(host, next.catch(() => {}));
  return next;
}

/**
 * @param {string} url
 * @param {object} [o]
 * @param {'json'|'text'|'buffer'|'response'} [o.as]
 * @param {number} [o.timeout]
 * @param {number} [o.maxBytes]
 * @param {object} [o.headers]
 */
async function request(url, { as = 'json', timeout = 15000, maxBytes = 8 * 1024 * 1024, headers = {}, method = 'GET', body } = {}) {
  const u = new URL(url);
  await pace(u.host);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await electron.net.fetch(rewrite(url), {
      method,
      body,
      headers: { 'User-Agent': UA(), Accept: as === 'json' ? 'application/json' : '*/*', ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (as === 'response') return res;
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${u.host}`);
      err.status = res.status;
      throw err;
    }
    const len = +res.headers.get('content-length') || 0;
    if (len > maxBytes) throw new Error('Response too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('Response too large');
    if (as === 'buffer') return { data: buf, type: res.headers.get('content-type') || '' };
    const text = buf.toString('utf8');
    if (as === 'text') return text;
    return JSON.parse(text);
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`Timed out contacting ${u.host}`);
      e.status = 408;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** JSON GET for the renderer, limited to the known API hosts. */
async function apiJson(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !hostAllowed(u.hostname)) throw new Error(`Host not allowed: ${u.hostname}`);
  try {
    return await request(url, { as: 'json' });
  } catch (err) {
    log.warn('[net]', u.host, err.message);
    throw err;
  }
}

module.exports = { request, apiJson, isPublicUrl, rewrite, hostAllowed, UA };
