/** Reusable screens: option choosers, sliders, static info pages, progress. */

import { View } from './view.js';
import { ListView } from './list.js';
import { h, svg, ICONS, clamp } from '../util.js';

/** A setting that cycles through values when selected (Shuffle, Repeat…). */
export function cycleItem(store, label, key, options, onChange) {
  return {
    label,
    value: () => (options.find(([v]) => v === store.settings[key]) || options[0])[1],
    action: () => {
      const i = options.findIndex(([v]) => v === store.settings[key]);
      const next = options[(i + 1) % options.length][0];
      if (onChange) onChange(next);
      else store.set(key, next);
    },
  };
}

/** A sub-menu listing options with a check mark on the current one. */
export function choiceItem(app, label, key, options, { onChange, title, showValue = true } = {}) {
  const store = app.store;
  return {
    label,
    value: showValue ? () => (options.find(([v]) => v === store.settings[key]) || ['', ''])[1] : undefined,
    view: () =>
      new ListView({
        title: title || label,
        selected: Math.max(
          0,
          options.findIndex(([v]) => v === store.settings[key])
        ),
        items: options.map(([v, name]) => ({
          label: name,
          checked: () => store.settings[key] === v,
          action: () => {
            if (onChange) onChange(v);
            else store.set(key, v);
            setTimeout(() => app.os.current && app.os.pop(), 140);
          },
        })),
      }),
  };
}

/** Static page of label/value rows that scrolls with the wheel (About). */
export class StaticList extends ListView {
  get className() {
    return 'list-view static-list';
  }
  onScroll(dir) {
    const n = this.rowCount;
    const len = (this.items || []).length;
    const top = clamp(this.top + dir, 0, Math.max(0, len - n));
    if (top === this.top) return false;
    this.top = top;
    this.sel = dir > 0 ? Math.min(len - 1, top + n - 1) : top;
    this.paint();
    return true;
  }
  onSelect() {}
}

/** Horizontal level control (Brightness, Volume Limit). */
export class SliderView extends View {
  constructor({ title, get, set, step = 0.05, min = 0, max = 1, hint, icon = 'sun' }) {
    super({ title });
    this.o = { get, set, step, min, max, hint, icon };
  }
  get className() {
    return 'slider-view';
  }
  render() {
    this.fill = h('div', { class: 'np-fill' });
    const lo = this.o.icon === 'volume' ? svg(ICONS.speakerLow, 'np-spk lo') : h('div', { class: 'slider-icon' });
    const hi = this.o.icon === 'volume' ? svg(ICONS.speaker, 'np-spk hi') : h('div', { class: 'slider-icon big' });
    this.el.replaceChildren(
      h('div', { class: 'slider-row' }, lo, h('div', { class: 'np-bar' }, this.fill), hi),
      this.o.hint ? h('div', { class: 'slider-hint', text: this.o.hint }) : null
    );
    this.paint();
  }
  paint() {
    const { min, max } = this.o;
    this.fill.style.width = `${((this.o.get() - min) / (max - min)) * 100}%`;
  }
  onScroll(dir) {
    const { step, min, max } = this.o;
    const cur = this.o.get();
    const v = clamp(Math.round((cur + dir * step) * 1000) / 1000, min, max);
    if (v === cur) return false;
    this.o.set(v);
    this.paint();
    return true;
  }
  onSelect() {
    this.os.pop();
  }
}

/** Text page (Legal, notes, messages) scrolled with the wheel. */
export class TextView extends View {
  constructor({ title, heading, body }) {
    super({ title });
    this.heading = heading;
    this.body = body;
  }
  get className() {
    return 'info-view';
  }
  render() {
    this.scroller = h(
      'div',
      { class: 'info-scroll' },
      this.heading ? h('h2', { text: this.heading }) : null,
      ...String(this.body || '')
        .split(/\n{2,}/)
        .map((p) => h('p', { text: p }))
    );
    this.el.replaceChildren(this.scroller);
  }
  onScroll(dir) {
    const before = this.scroller.scrollTop;
    this.scroller.scrollTop += dir * 20;
    return this.scroller.scrollTop !== before;
  }
}

/** "Updating Library…" with a progress bar; pops itself when done. */
export class ScanView extends View {
  constructor(app) {
    super({ title: 'Music Library' });
    this.app = app;
  }
  get className() {
    return 'scan-view';
  }
  render() {
    this.label = h('div', { text: 'Updating Library…' });
    this.fill = h('div', { class: 'np-fill' });
    this.detail = h('small', { text: 'Looking for music' });
    this.el.replaceChildren(this.label, h('div', { class: 'np-bar' }, this.fill), this.detail);
    const lib = this.app.library;
    this.listen(lib, 'progress', (p) => this.paint(p));
    this.listen(lib, 'scan', (on) => {
      if (!on) this.done();
    });
    if (!lib.scanning) lib.scan();
  }
  paint(p) {
    if (!p || !p.total) return;
    this.fill.style.width = `${(p.done / p.total) * 100}%`;
    this.detail.textContent = `${p.done} of ${p.total} files`;
  }
  done() {
    this.fill.style.width = '100%';
    const n = this.app.library.music.length;
    this.label.textContent = 'Library Updated';
    this.detail.textContent = `${n} song${n === 1 ? '' : 's'}`;
    this.later(() => this.os.current === this && this.os.pop(), 1200);
  }
}

/** Two-option confirmation (Reset Settings, Clear…). */
export function confirmView(app, title, label, onConfirm) {
  return new ListView({
    title,
    items: [
      { label: 'Cancel', action: () => app.os.pop() },
      {
        label,
        action: () => {
          onConfirm();
          app.os.pop();
        },
      },
    ],
  });
}
