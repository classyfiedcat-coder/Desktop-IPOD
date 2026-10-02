/**
 * The iPod list: row-based (not pixel) scrolling, selection highlight,
 * scroll bar, marquee for long titles, wheel acceleration with the big
 * letter overlay and lazy loading.
 */

import { View } from './view.js';
import { h, svg, ICONS, clamp, indexLetter } from '../util.js';

export class ListView extends View {
  /**
   * @param {object} o
   * @param {string} o.title
   * @param {Array|Function} [o.items] items or () => items
   * @param {Function} [o.load] async () => items | {items, more}
   * @param {Function} [o.loadMore] async (offset) => {items, more}
   * @param {boolean} [o.thumbs] two-line rows with artwork
   * @param {boolean} [o.index] show letter overlay when spinning fast
   * @param {string} [o.empty]
   */
  constructor(o) {
    super(o);
    this.o = o;
    this.sel = o.selected || 0;
    this.top = 0;
    this.items = Array.isArray(o.items) ? o.items : null;
    this.loading = false;
    this.more = false;
    this.error = null;
    this._letterTimer = null;
    this._marqueeTimer = null;
  }

  get className() {
    return 'list-view';
  }

  get rowCount() {
    if (this.o.rows) return this.o.rows;
    const n = this.os.ui.rows;
    return this.o.thumbs ? Math.max(3, Math.round(n * 0.62)) : n;
  }

  render() {
    const el = this.el;
    el.replaceChildren();
    el.classList.toggle('thumbs', !!this.o.thumbs);
    el.style.setProperty('--rows', this.rowCount);

    this.listEl = h('div', { class: 'list' });
    this.rowsEl = h('div', { class: 'rows' });
    this.rows = [];
    for (let i = 0; i < this.rowCount; i++) {
      const row = h(
        'div',
        { class: 'row' },
        h('img', { class: 'thumb', alt: '', draggable: 'false' }),
        h('div', { class: 'label' }, h('span', { class: 'label-inner' }), h('span', { class: 'sub' })),
        h('span', { class: 'value' }),
        h('span', { class: 'icon' }),
        svg(ICONS.chevron, 'arrow')
      );
      const img = row.querySelector('.thumb');
      img.addEventListener('error', () => row.classList.add('no-art'));
      img.addEventListener('load', () => row.classList.remove('no-art'));
      this.rows.push(row);
      this.rowsEl.append(row);
    }
    this.scrollbar = h('div', { class: 'scrollbar' }, h('div', { class: 'thumb-bar' }));
    this.listEl.append(this.rowsEl, this.scrollbar);
    this.messageEl = h('div', { class: 'list-message' });
    this.listEl.append(this.messageEl);
    el.append(this.listEl);

    this.letterEl = h('div', { class: 'letter-overlay' });
    el.append(this.letterEl);

    if (!this.items && typeof this.o.items === 'function') this.items = this.o.items();
    if (!this.items && this.o.load && !this.loading) this.reload();
    this.paint();
  }

  async reload() {
    if (!this.o.load) {
      if (typeof this.o.items === 'function') this.setItems(this.o.items(), true);
      return;
    }
    this.loading = true;
    this.error = null;
    this.paint();
    try {
      const res = await this.o.load();
      const items = Array.isArray(res) ? res : res.items;
      this.more = !Array.isArray(res) && !!res.more;
      this.loading = false;
      this.setItems(items, true);
    } catch (err) {
      console.warn(err);
      this.loading = false;
      this.error = err && err.message ? err.message : 'Could not load.';
      this.items = [];
      this.paint();
    }
  }

  async _loadMore() {
    if (!this.more || this._loadingMore || !this.o.loadMore) return;
    this._loadingMore = true;
    try {
      const res = await this.o.loadMore(this.items.length);
      this.items = this.items.concat(res.items || []);
      this.more = !!res.more;
      if (this.mounted) this.paint();
    } catch (err) {
      console.warn(err);
      this.more = false;
    } finally {
      this._loadingMore = false;
    }
  }

  setItems(items, keepSel = true) {
    this.items = items || [];
    if (!keepSel) this.sel = 0;
    this.sel = clamp(this.sel, 0, Math.max(0, this.items.length - 1));
    if (this.mounted) this.paint();
  }

  refresh() {
    if (typeof this.o.items === 'function' && !this.o.load) this.items = this.o.items();
    if (this.mounted) this.paint();
  }

  get selected() {
    return this.items ? this.items[this.sel] : null;
  }

  paint() {
    if (!this.rows) return;
    const items = this.items || [];
    const n = this.rowCount;
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + n) this.top = this.sel - n + 1;
    this.top = clamp(this.top, 0, Math.max(0, items.length - n));

    const showMsg = this.loading || this.error || (!items.length && this.o.empty !== undefined);
    this.messageEl.classList.toggle('show', !!showMsg);
    if (this.loading) {
      this.messageEl.replaceChildren(h('div', { class: 'spinner' }), h('div', { text: 'Loading…' }));
    } else if (this.error) {
      this.messageEl.replaceChildren(h('div', { text: this.error }));
    } else if (!items.length) {
      this.messageEl.replaceChildren(h('div', { text: this.o.empty || '' }));
    }

    for (let i = 0; i < n; i++) {
      const idx = this.top + i;
      const row = this.rows[i];
      const item = items[idx];
      if (!item || showMsg) {
        row.className = 'row empty';
        continue;
      }
      const selected = idx === this.sel;
      const value = typeof item.value === 'function' ? item.value() : item.value;
      const checked = typeof item.checked === 'function' ? item.checked() : item.checked;
      const icon = typeof item.icon === 'function' ? item.icon() : item.icon;
      const hasArrow = item.arrow !== undefined ? item.arrow : !!item.view;
      row.className = [
        'row',
        selected ? 'sel' : '',
        hasArrow ? 'has-arrow' : '',
        value !== undefined && value !== null && value !== '' ? 'has-value' : '',
        checked ? 'checked' : '',
        icon ? `has-icon icon-${icon}` : '',
        item.disabled ? 'disabled' : '',
        this.o.thumbs ? 'with-thumb' : '',
        item.center ? 'centered' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const inner = row.querySelector('.label-inner');
      const label = typeof item.label === 'function' ? item.label() : item.label;
      if (inner.textContent !== label) inner.textContent = label;
      inner.classList.remove('marquee');
      row.querySelector('.sub').textContent = item.sub || '';
      row.querySelector('.value').textContent = value === undefined || value === null ? '' : value;
      const iconEl = row.querySelector('.icon');
      if (iconEl.dataset.icon !== (icon || '')) {
        iconEl.dataset.icon = icon || '';
        iconEl.innerHTML = icon && ICONS[icon] ? ICONS[icon] : icon === 'check' ? '✓' : '';
      }
      if (this.o.thumbs) {
        const img = row.querySelector('.thumb');
        const src = item.thumb || '';
        if (img.dataset.src !== src) {
          img.dataset.src = src;
          row.classList.toggle('no-art', !src);
          if (src) img.src = src;
          else img.removeAttribute('src');
        } else if (!src) row.classList.add('no-art');
      }
    }

    const total = items.length;
    const showBar = total > n && !showMsg;
    this.scrollbar.classList.toggle('show', showBar);
    this.el.classList.toggle('has-scrollbar', showBar);
    if (showBar) {
      const bar = this.scrollbar.firstChild;
      const hPct = Math.max(8, (n / total) * 100);
      const tPct = (this.top / Math.max(1, total - n)) * (100 - hPct);
      bar.style.height = `${hPct}%`;
      bar.style.top = `${tPct}%`;
    }

    this._scheduleMarquee();
    if (this.more && this.sel > total - n * 2) this._loadMore();
    if (this.o.onFocus) this.o.onFocus(this.selected, this);
  }

  _scheduleMarquee() {
    if (this._marqueeTimer) this.clear(this._marqueeTimer);
    this._marqueeTimer = this.later(() => {
      const row = this.rows[this.sel - this.top];
      if (!row) return;
      const inner = row.querySelector('.label-inner');
      const box = inner.parentElement;
      const overflow = Math.max(inner.scrollWidth, box.scrollWidth) - box.clientWidth;
      if (overflow > 2) {
        inner.style.setProperty('--dist', `${-overflow - 6}px`);
        inner.style.setProperty('--dur', `${Math.max(3, (overflow + 40) / 26)}s`);
        inner.classList.add('marquee');
      }
    }, 900);
  }

  onScroll(dir, speed) {
    const items = this.items || [];
    if (!items.length || this.loading) return false;
    let step = 1;
    if (items.length > 40) {
      if (speed > 34) step = items.length > 600 ? 12 : items.length > 150 ? 6 : 3;
      else if (speed > 24) step = items.length > 300 ? 4 : 2;
    }
    const next = clamp(this.sel + dir * step, 0, items.length - 1);
    if (next === this.sel) return false;
    this.sel = next;
    this.paint();
    if (this.o.index && step > 1) this._showLetter();
    return true;
  }

  _showLetter() {
    const item = this.selected;
    if (!item) return;
    this.letterEl.textContent = indexLetter(item.sortName || item.label);
    this.letterEl.classList.add('show');
    if (this._letterTimer) this.clear(this._letterTimer);
    this._letterTimer = this.later(() => this.letterEl.classList.remove('show'), 650);
  }

  /** Jump to the first item starting with a typed letter. */
  onChar(key) {
    if (!this.o.index || !this.items) return false;
    const k = key.toUpperCase();
    const idx = this.items.findIndex((it) => indexLetter(it.sortName || it.label) === k);
    if (idx >= 0) {
      this.sel = idx;
      this.top = idx;
      this.paint();
      this._showLetter();
      return true;
    }
    return false;
  }

  onSelect() {
    const item = this.selected;
    if (!item || item.disabled) return;
    if (item.view) {
      const v = item.view(item, this);
      if (v) this.os.push(v);
    } else if (item.action) {
      Promise.resolve(item.action(item, this)).finally(() => this.mounted && this.paint());
    }
  }

  /** Blink the selected row (song added to On-The-Go). */
  flashSelected() {
    const row = this.rows && this.rows[this.sel - this.top];
    if (!row) return;
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
    this.later(() => row.classList.remove('flash'), 900);
  }

  onSelectHold() {
    const item = this.selected;
    if (item && item.onHold) item.onHold(item, this);
  }

  onEnter() {
    if (this.o.refreshOnEnter) this.refresh();
    else if (this.mounted) this.paint();
  }
}
