/** The play queue: the list (maybe shuffled) plus Up Next, which plays first. Pure logic. */

import { shuffled } from '../util.js';

export const albumKey = (t) => `${t.albumArtist || t.artist}\u0000${t.album}`;

/** Order of indices for a list, starting from startIdx. Returns { order, pos }. */
export function buildOrder(items, startIdx, mode, rand = shuffled) {
  const n = items.length;
  const idx = [...Array(n).keys()];
  if (!n) return { order: [], pos: -1 };
  if (mode === 'songs') return { order: [startIdx, ...rand(idx.filter((i) => i !== startIdx))], pos: 0 };
  if (mode === 'albums') {
    const groups = new Map();
    for (const i of idx) {
      const k = albumKey(items[i]);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    const startKey = albumKey(items[startIdx]);
    const first = groups.get(startKey);
    groups.delete(startKey);
    return { order: [...first.slice(first.indexOf(startIdx)), ...rand([...groups.values()]).flat(), ...first.slice(0, first.indexOf(startIdx))], pos: 0 };
  }
  return { order: idx, pos: startIdx };
}

export class PlayQueue {
  constructor(rand = shuffled) {
    this.rand = rand;
    this.items = [];
    this.order = [];
    this.pos = -1;
    this.upNext = [];
    this.interject = null; // a song from Up Next that is playing right now
    this.mode = 'off';
  }

  get current() {
    if (this.interject) return this.interject;
    return this.pos >= 0 ? this.items[this.order[this.pos]] || null : null;
  }

  get length() {
    return this.order.length;
  }

  /** "3 of 12" for the context list (Up Next songs show the context position). */
  get info() {
    if (this.pos < 0 || !this.order.length) return null;
    return { index: this.pos + 1, total: this.order.length };
  }

  load(items, startIdx = 0, mode = 'off') {
    this.items = items.slice();
    this.mode = mode;
    this.interject = null;
    const { order, pos } = buildOrder(this.items, Math.max(0, Math.min(startIdx, items.length - 1)), mode, this.rand);
    this.order = order;
    this.pos = pos;
    return this.current;
  }

  clear() {
    this.items = [];
    this.order = [];
    this.pos = -1;
    this.interject = null;
  }

  /** What would play automatically after the current song (for preloading). */
  peekNext(repeat = 'off') {
    if (repeat === 'one') return this.current;
    if (this.upNext.length) return this.upNext[0];
    if (this.pos + 1 < this.order.length) return this.items[this.order[this.pos + 1]];
    if (repeat === 'all' && this.order.length) return this.mode === 'songs' ? null : this.items[this.order[0]];
    return null;
  }

  /** Move forward (auto = it finished). Returns { track, wrapped, stop }. */
  advance({ repeat = 'off', auto = false } = {}) {
    if (auto && repeat === 'one' && this.current) return { track: this.current, wrapped: false, stop: false, same: true };
    if (this.upNext.length) {
      this.interject = this.upNext.shift();
      return { track: this.interject, wrapped: false, stop: false };
    }
    this.interject = null;
    if (!this.order.length) return { track: null, wrapped: false, stop: true };
    if (this.pos + 1 < this.order.length) {
      this.pos++;
      return { track: this.current, wrapped: false, stop: false };
    }
    // A shuffled list gets a fresh shuffle each time it starts over.
    if (this.mode === 'songs') this.order = this.rand(this.order);
    this.pos = 0;
    const loop = repeat === 'all' || repeat === 'one';
    return { track: this.current, wrapped: true, stop: !loop };
  }

  /** Move back one song. */
  back() {
    if (this.interject) {
      this.interject = null;
      return this.current;
    }
    if (this.pos > 0) this.pos--;
    return this.current;
  }

  jumpTo(orderIndex) {
    if (orderIndex < 0 || orderIndex >= this.order.length) return null;
    this.interject = null;
    this.pos = orderIndex;
    return this.current;
  }

  playNext(tracks) {
    this.upNext.unshift(...tracks);
  }

  addToUpNext(tracks) {
    this.upNext.push(...tracks);
  }

  removeUpNext(i) {
    this.upNext.splice(i, 1);
  }

  clearUpNext() {
    this.upNext = [];
  }

  /** Re-order for a new shuffle mode, keeping the current song where it is. */
  setMode(mode) {
    this.mode = mode;
    if (!this.order.length) return;
    const cur = this.order[this.pos];
    const { order, pos } = buildOrder(this.items, cur, mode, this.rand);
    this.order = order;
    this.pos = pos;
  }

  /** Songs coming up: Up Next first, then the rest of the list. */
  upcoming(limit = 200) {
    const rest = this.order.slice(this.pos + 1, this.pos + 1 + limit).map((i) => this.items[i]);
    return { upNext: this.upNext.slice(), rest };
  }

  serialize(maxItems = 2000) {
    const items = this.items.slice(0, maxItems).map((t) => t.id);
    return {
      ids: items,
      order: this.order.filter((i) => i < items.length),
      pos: this.pos,
      upNext: this.upNext.filter((t) => t.source === 'local').map((t) => t.id),
      mode: this.mode,
    };
  }

  restore(data, lookup) {
    if (!data || !data.ids || !data.ids.length) return false;
    const items = data.ids.map(lookup);
    if (items.some((t) => !t)) return false;
    this.items = items;
    this.order = data.order && data.order.length === items.length ? data.order : [...items.keys()];
    this.pos = Math.max(0, Math.min(data.pos || 0, this.order.length - 1));
    this.upNext = (data.upNext || []).map(lookup).filter(Boolean);
    this.mode = data.mode || 'off';
    this.interject = null;
    return true;
  }
}
