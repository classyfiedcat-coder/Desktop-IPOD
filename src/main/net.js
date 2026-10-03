'use strict';

/**
 * Outbound HTTP for the app. Everything the iPod fetches from the internet
 * (lyrics, radio directory, podcast feeds, artwork, update checks) goes
 * through here so it gets one User-Agent, timeouts, per-host pacing, size
 * limits, private-network protection and — in development — a mock server.
 */

const electron = require('electron');
const dns = require('dns');
const nodeNet = require('net');
const { log } = require('./log');

const version = () => (electron.app && electron.app.getVersion ? electron.app.getVersion() : '0.0.0');
const UA = () => `iPodDesktop/${version()} (+https://github.com/classyfiedcat-coder/Desktop-IPOD)`;

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

/** Is this IP address on a private, loopback, link-local or otherwise non-public network? */
function isPrivateIp(ip) {
  const v = nodeNet.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast, reserved, broadcast
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    // IPv4-mapped (::ffff:127.0.0.1, or the normalised ::ffff:7f00:1).
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (dotted) return isPrivateIp(dotted[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith('64:ff9b:') || s.startsWith('::ffff:0:');
  }
  return false;
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
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (nodeNet.isIP(host)) return !isPrivateIp(host);
  // A bare name with no dot is a LAN machine ("http://router/").
  return host.includes('.');
}

// Names that resolve to private addresses (DNS rebinding) are caught when the
// request is actually made, for every redirect hop too.
const dnsCache = new Map();
async function resolvesPrivate(host) {
  if (nodeNet.isIP(host)) return isPrivateIp(host);
  const hit = dnsCache.get(host);
  if (hit && hit.at > Date.now() - 60000) return hit.priv;
  let priv = false;
  try {
    const addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
    priv = addrs.some((a) => isPrivateIp(a.address));
  } catch {
    // Can't resolve locally (offline, or a proxy does the lookups): let the
    // request go ahead; it will fail or be resolved by the proxy.
  }
  dnsCache.set(host, { priv, at: Date.now() });
  if (dnsCache.size > 500) dnsCache.delete(dnsCache.keys().next().value);
  return priv;
}

/**
 * Untrusted fetches (feeds, streams, images, anything a URL came from the
 * internet for) go through their own session, which checks every hop of a
 * redirect chain before it's followed.
 */
let guarded = null;
function guardedSession() {
  if (guarded) return guarded;
  guarded = electron.session.fromPartition('ipod-net', { cache: true });
  guarded.webRequest.onBeforeRequest((details, cb) => {
    if (mockBase()) return cb({});
    if (!isPublicUrl(details.url)) {
      log.warn('[net] blocked', details.url);
      return cb({ cancel: true });
    }
    resolvesPrivate(new URL(details.url).hostname.replace(/^\[|\]$/g, ''))
      .then((priv) => {
        if (priv) log.warn('[net] blocked (private address)', details.url);
        cb({ cancel: priv });
      })
      .catch(() => cb({ cancel: true }));
  });
  return guarded;
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
 * @param {boolean} [o.untrusted] the URL came from a feed, a stream or a user: refuse private networks
 */
async function request(url, { as = 'json', timeout = 15000, maxBytes = 8 * 1024 * 1024, headers = {}, method = 'GET', body, untrusted = false } = {}) {
  const u = new URL(url);
  if (untrusted && !isPublicUrl(url)) throw Object.assign(new Error('That address isn’t allowed.'), { status: 403 });
  await pace(u.host);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const fetcher = untrusted ? guardedSession() : electron.net;
    const res = await fetcher.fetch(rewrite(url), {
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
    if (/ERR_BLOCKED_BY_CLIENT/.test(err.message)) throw Object.assign(new Error('That address isn’t allowed.'), { status: 403 });
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

module.exports = { request, apiJson, isPublicUrl, isPrivateIp, rewrite, hostAllowed, UA };
