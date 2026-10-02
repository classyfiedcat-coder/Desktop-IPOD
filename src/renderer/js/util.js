/** Small DOM + formatting helpers shared by the renderer. */

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svg(markup, cls = '') {
  const wrap = document.createElement('span');
  wrap.className = `svg ${cls}`.trim();
  wrap.innerHTML = markup;
  return wrap;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function fmtTime(sec, { negative = false } = {}) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const body = hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

export function fmtClock(date, use24, { seconds = false } = {}) {
  let hh = date.getHours();
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  if (use24) return `${String(hh).padStart(2, '0')}:${mm}${seconds ? `:${ss}` : ''}`;
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  return `${hh}:${mm}${seconds ? `:${ss}` : ''} ${ampm}`;
}

export function fmtBytes(n) {
  if (!n) return '0 GB';
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  return `${(n / 1024 ** 2).toFixed(0)} MB`;
}

/** Sort key the way the iPod sorts: ignores a leading "The", "A" or "An" and punctuation. */
export function sortKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/^[^a-z0-9]+/, '')
    .trim();
}

export function byKey(a, b) {
  const ka = sortKey(a);
  const kb = sortKey(b);
  const da = /^[0-9]/.test(ka);
  const db = /^[0-9]/.test(kb);
  if (da !== db) return da ? 1 : -1; // numbers sort after letters, like the iPod
  return ka.localeCompare(kb);
}

export function indexLetter(s) {
  const k = sortKey(s);
  const c = k.charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

export function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function debounce(fn, ms) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pending = null;
  return (...args) => {
    const now = Date.now();
    pending = args;
    if (now - last >= ms) {
      last = now;
      fn(...pending);
      pending = null;
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        if (pending) fn(...pending);
        pending = null;
      }, ms - (now - last));
    }
  };
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export class Emitter {
  constructor() {
    this._l = new Map();
  }
  on(evt, fn) {
    if (!this._l.has(evt)) this._l.set(evt, new Set());
    this._l.get(evt).add(fn);
    return () => this._l.get(evt).delete(fn);
  }
  emit(evt, payload) {
    const set = this._l.get(evt);
    if (set) for (const fn of [...set]) fn(payload);
  }
}

export const ICONS = {
  play: '<svg viewBox="0 0 10 10"><path d="M1.5 0.6 L9.2 5 L1.5 9.4 Z"/></svg>',
  pause: '<svg viewBox="0 0 10 10"><rect x="1.4" y="0.8" width="2.6" height="8.4"/><rect x="6" y="0.8" width="2.6" height="8.4"/></svg>',
  next: '<svg viewBox="0 0 22 10"><path d="M0 0 L8 5 L0 10Z M8 0 L16 5 L8 10Z"/><rect x="16" y="0" width="2.4" height="10"/></svg>',
  prev: '<svg viewBox="0 0 22 10"><rect x="3.6" y="0" width="2.4" height="10"/><path d="M14 0 L6 5 L14 10Z M22 0 L14 5 L22 10Z"/></svg>',
  playpause:
    '<svg viewBox="0 0 22 10"><path d="M0 0 L8 5 L0 10Z"/><rect x="12" y="0" width="3" height="10"/><rect x="17.4" y="0" width="3" height="10"/></svg>',
  speaker: '<svg viewBox="0 0 12 10"><path d="M0 3h2.6L6 0.4v9.2L2.6 7H0z"/><path d="M7.6 2.6c1.2 1.2 1.2 3.6 0 4.8" fill="none" stroke="currentColor" stroke-width="1"/><path d="M9.2 1.2c2 2 2 5.6 0 7.6" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  speakerLow: '<svg viewBox="0 0 8 10"><path d="M0 3h2.6L6 0.4v9.2L2.6 7H0z"/></svg>',
  lock: '<svg viewBox="0 0 10 12"><path d="M2.4 5V3.6a2.6 2.6 0 0 1 5.2 0V5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="1" y="5" width="8" height="6.4" rx="1"/></svg>',
  shuffle:
    '<svg viewBox="0 0 16 12"><path d="M0 2.5h3.2c2.2 0 3.4 7 5.8 7H12" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M0 9.5h3.2c1 0 1.8-1.4 2.4-3M7.6 4.2c.4-.9.8-1.7 1.4-1.7H12" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11.5 0l3.5 2.5-3.5 2.5zM11.5 7l3.5 2.5-3.5 2.5z"/></svg>',
  repeat:
    '<svg viewBox="0 0 16 12"><path d="M2 6V4.5A2 2 0 0 1 4 2.5h8.5M14 6v1.5a2 2 0 0 1-2 2H3.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11.5 0l3.5 2.5-3.5 2.5zM4.5 7L1 9.5 4.5 12z"/></svg>',
  heart: '<svg viewBox="0 0 12 11"><path d="M6 10.5L5.2 9.8C2.2 7.1 0.2 5.3 0.2 3.1 0.2 1.4 1.6 0 3.3 0c1 0 2 .5 2.7 1.2C6.7.5 7.7 0 8.7 0c1.7 0 3.1 1.4 3.1 3.1 0 2.2-2 4-5 6.7z"/></svg>',
  star: '<svg viewBox="0 0 12 12"><path d="M6 0.4l1.7 3.6 3.9.5-2.9 2.7.7 3.9L6 9.2 2.6 11.1l.7-3.9L.4 4.5l3.9-.5z"/></svg>',
  chevron: '<svg viewBox="0 0 6 10"><path d="M1 0.8 L5 5 L1 9.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  spotify:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1ed760"/><path d="M6.2 9.3c3.9-1.1 8.4-.8 11.6 1.1M6.8 12.6c3.2-.9 6.9-.6 9.7 1M7.4 15.7c2.6-.7 5.4-.5 7.6.8" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

export function hexToHsl(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hh = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hh = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60;
  }
  return { h: Math.round(hh), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex({ h: hh, s, l }) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + hh / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
