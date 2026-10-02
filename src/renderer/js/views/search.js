/**
 * Search with the click wheel: spin through the letter strip at the bottom
 * and press the centre button to type. Choose DONE (or press ⏭) to move into
 * the results. You can also just type on the keyboard.
 */

import { View } from './view.js';
import { ListView } from './list.js';
import { h } from '../util.js';

const KEYS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map((c) => ({ k: c, label: c })).concat([
  { k: ' ', label: 'SPACE' },
  { k: 'DEL', label: 'DEL' },
  { k: 'DONE', label: 'DONE' },
]);

export class SearchView extends View {
  constructor(app, { title = 'Search', search, debounce = 0 }) {
    super({ title });
    this.app = app;
    this.searchFn = search;
    this.debounceMs = debounce;
    this.query = '';
    this.keyIdx = 0;
    this.focus = 'keys';
    this.results = new ListView({ title, rows: 6, items: [], empty: '' });
    this._seq = 0;
  }

  get className() {
    return 'search-view';
  }

  render() {
    this.queryText = h('span', { class: 'sq-text' });
    this.queryEl = h('div', { class: 'search-query' }, h('span', { class: 'sq-glass' }), this.queryText, h('span', { class: 'sq-caret' }));
    this.resultsEl = h('div', { class: 'search-results' });
    this.strip = h('div', { class: 'search-strip' });
    this.keyEls = KEYS.map((key) => {
      const el = h('div', { class: `sk ${key.label.length > 1 ? 'wide' : ''}`, text: key.label });
      this.strip.append(el);
      return el;
    });
    this.stripWrap = h('div', { class: 'search-keys' }, this.strip);
    this.el.replaceChildren(this.queryEl, this.resultsEl, this.stripWrap);
    if (this.results.mounted) this.results.unmount();
    this.results.mount(this.resultsEl, this.os);
    this.app.device._typing = true;
    this.paint();
  }

  onUnmount() {
    if (this.results.mounted) this.results.unmount();
    this.app.device._typing = false;
  }

  onEnter() {
    this.app.device._typing = true;
  }

  onLeave() {
    this.app.device._typing = false;
  }

  paint() {
    this.queryText.textContent = this.query;
    this.el.classList.toggle('focus-results', this.focus === 'results');
    this.el.classList.toggle('has-query', !!this.query);
    this.keyEls.forEach((el, i) => el.classList.toggle('on', i === this.keyIdx));
    const cur = this.keyEls[this.keyIdx];
    if (cur) {
      const offset = cur.offsetLeft + cur.offsetWidth / 2;
      this.strip.style.transform = `translateX(${-offset}px)`;
    }
    this.results.el.classList.toggle('inactive', this.focus !== 'results');
  }

  onScroll(dir, speed) {
    if (this.focus === 'results') return this.results.onScroll(dir, speed);
    const next = (this.keyIdx + dir + KEYS.length) % KEYS.length;
    this.keyIdx = next;
    this.paint();
    return true;
  }

  onSelect() {
    if (this.focus === 'results') return this.results.onSelect();
    const key = KEYS[this.keyIdx];
    if (key.k === 'DEL') this.query = this.query.slice(0, -1);
    else if (key.k === 'DONE') {
      this.focusResults();
      return;
    } else this.query += key.k;
    this.changed();
  }

  onSelectHold() {
    if (this.focus === 'results') this.results.onSelectHold();
  }

  onNext() {
    this.focusResults();
    return true;
  }

  onMenu() {
    if (this.focus === 'results') {
      this.focus = 'keys';
      this.paint();
      return true;
    }
    return false;
  }

  focusResults() {
    if (!(this.results.items || []).length) return;
    this.focus = 'results';
    this.paint();
  }

  onChar(key) {
    if (key === 'Backspace') this.query = this.query.slice(0, -1);
    else if (key.length === 1) this.query += key.toUpperCase();
    this.focus = 'keys';
    this.changed();
  }

  changed() {
    this.paint();
    clearTimeout(this._t);
    const q = this.query.trim();
    const seq = ++this._seq;
    if (!q) {
      this.results.setItems([], false);
      this.results.o.empty = '';
      return;
    }
    const run = async () => {
      this.results.loading = true;
      this.results.paint();
      try {
        const items = await this.searchFn(q);
        if (seq !== this._seq) return;
        this.results.loading = false;
        this.results.o.empty = 'No results';
        this.results.setItems(items, false);
      } catch (err) {
        if (seq !== this._seq) return;
        this.results.loading = false;
        this.results.error = err.message || 'Search failed';
        this.results.setItems([], false);
        this.results.error = null;
      }
    };
    if (this.debounceMs) this._t = setTimeout(run, this.debounceMs);
    else run();
  }
}

/** Search the local library. */
export function localSearch(app) {
  return new SearchView(app, {
    title: 'Search',
    search: async (q) => {
      const { songsView, artistView, trackItems } = await import('./menus.js');
      const r = app.library.search(q, 40);
      const items = [];
      for (const ar of r.artists) {
        const artist = app.library.artists.find((a) => a.name === ar.name);
        items.push({ label: ar.name, value: 'Artist', view: () => artistView(app, artist) });
      }
      for (const al of r.albums) items.push({ label: al.title, value: 'Album', view: () => songsView(app, al.title, al.tracks) });
      const songs = trackItems(app, r.songs).map((it) => ({ ...it, value: 'Song' }));
      return items.concat(songs);
    },
  });
}
