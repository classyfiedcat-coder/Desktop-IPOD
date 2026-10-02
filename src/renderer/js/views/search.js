/**
 * Search with the click wheel: spin through the letter strip at the bottom
 * and press the centre button to type. Choose DONE (or press ⏭) to move into
 * the results. You can also just type, or paste.
 */

import { View } from './view.js';
import { ListView } from './list.js';
import { KeyStrip } from './keystrip.js';
import { h } from '../util.js';

export class SearchView extends View {
  constructor(app, { title = 'Search', search, debounce = 0, initial = '', recent = null }) {
    super({ title });
    this.app = app;
    this.searchFn = search;
    this.debounceMs = debounce;
    this.recentKey = recent;
    this.query = initial;
    this.focus = 'keys';
    this.strip = new KeyStrip('search');
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
    this.el.replaceChildren(this.queryEl, this.resultsEl, this.strip.render());
    if (this.results.mounted) this.results.unmount();
    this.results.mount(this.resultsEl, this.os);
    this.app.device._typing = true;
    this.paint();
    if (this.query && !(this.results.items || []).length) this.changed();
    else if (!this.query) this._showRecent();
    requestAnimationFrame(() => this.strip.paint());
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
    this._remember();
  }

  get recent() {
    const all = this.app.store.user.searches || [];
    return this.recentKey ? all.filter((s) => s.k === this.recentKey).map((s) => s.q) : [];
  }

  _remember() {
    const q = this.query.trim();
    if (!this.recentKey || q.length < 2) return;
    const u = this.app.store.user;
    u.searches = [{ k: this.recentKey, q }, ...(u.searches || []).filter((s) => !(s.k === this.recentKey && s.q === q))].slice(0, 40);
    this.app.store.touchUser();
  }

  _showRecent() {
    const recent = this.recent.slice(0, 8);
    this.results.o.empty = '';
    this.results.setItems(
      recent.length
        ? [
            { label: 'Recent Searches', header: true },
            ...recent.map((q) => ({
              label: q,
              arrow: false,
              action: () => {
                this.query = q;
                this.focus = 'keys';
                this.changed();
              },
            })),
          ]
        : [],
      false
    );
  }

  paint() {
    this.queryText.textContent = this.query;
    this.el.classList.toggle('focus-results', this.focus === 'results');
    this.el.classList.toggle('has-query', !!this.query);
    this.results.el.classList.toggle('inactive', this.focus !== 'results');
  }

  onScroll(dir, speed) {
    if (this.focus === 'results') return this.results.onScroll(dir, speed);
    this.strip.move(dir);
    return true;
  }

  onSelect() {
    if (this.focus === 'results') return this.results.onSelect();
    const k = this.strip.key;
    if (k === 'DEL') this.query = this.query.slice(0, -1);
    else if (k === 'DONE') {
      this.focusResults();
      return;
    } else this.query += k;
    this.changed();
  }

  onSelectHold() {
    if (this.focus === 'results') this.results.onSelectHold();
    else {
      this.query = '';
      this.changed();
    }
  }

  onNext() {
    this.focusResults();
    return true;
  }

  onPrev() {
    if (this.focus === 'results') {
      this.focus = 'keys';
      this.paint();
    }
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
    if (!(this.results.items || []).some((i) => !i.header)) return;
    this.focus = 'results';
    this.paint();
  }

  onChar(key) {
    if (key === 'Backspace') this.query = this.query.slice(0, -1);
    else if (key === 'Enter') return this.focusResults();
    else if (key.length === 1) this.query += key.toUpperCase();
    this.focus = 'keys';
    this.changed();
  }

  onPaste(text) {
    this.query += String(text).replace(/\s+/g, ' ').toUpperCase();
    this.changed();
  }

  changed() {
    this.paint();
    clearTimeout(this._t);
    const q = this.query.trim();
    const seq = ++this._seq;
    if (!q) return this._showRecent();
    const run = async () => {
      this.results.loading = true;
      this.results.paint();
      try {
        const items = await this.searchFn(q, (more) => {
          // Late results (e.g. Spotify) append to what's shown.
          if (seq === this._seq) this.results.setItems((this.results.items || []).concat(more), true);
        });
        if (seq !== this._seq) return;
        this.results.loading = false;
        this.results.o.empty = 'No results';
        this.results.setItems(items, false);
      } catch (err) {
        if (seq !== this._seq) return;
        this.results.loading = false;
        this.results.o.empty = err.message || 'Search failed';
        this.results.setItems([], false);
      }
    };
    if (this.debounceMs) this._t = setTimeout(run, this.debounceMs);
    else run();
  }
}

/** Music › Search: your library, plus Spotify when connected. */
export function localSearch(app, initial = '') {
  return new SearchView(app, {
    title: 'Search',
    initial,
    recent: 'music',
    debounce: 120,
    search: async (q, append) => {
      const { songsView, artistView, trackItems } = await import('./menus.js');
      const r = app.library.search(q, 40);
      const items = [];
      if (r.artists.length) items.push({ label: 'Artists', header: true });
      for (const ar of r.artists) items.push({ label: ar.name, view: () => artistView(app, ar) });
      if (r.albums.length) items.push({ label: 'Albums', header: true });
      for (const al of r.albums) items.push({ label: al.title, value: al.artist, view: () => songsView(app, al.title, al.tracks) });
      if (r.songs.length) items.push({ label: 'Songs', header: true });
      items.push(...trackItems(app, r.songs).map((it, i) => ({ ...it, value: r.songs[i].artist })));
      if (app.spotifyApi.connected && q.length >= 2) {
        app.spotifyMenus
          .searchItems(q)
          .then((sp) => sp.length && append([{ label: 'Spotify', header: true }, ...sp]))
          .catch(() => {});
      }
      return items;
    },
  });
}
