/** The click-wheel keyboard: a key strip scrolling under a fixed highlight. */

import { h } from '../util.js';

const UPPER = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const LOWER = [...'abcdefghijklmnopqrstuvwxyz'];
const DIGITS = [...'0123456789'];

export const KEYSETS = {
  search: () => [...UPPER, ...DIGITS, ' ', 'DEL', 'DONE'],
  name: (upper) => [...(upper ? UPPER : LOWER), ...DIGITS, ' ', ...".,'-&!?()", 'SHIFT', 'DEL', 'DONE'],
  url: (upper) => [...(upper ? UPPER : LOWER), ...DIGITS, ...':/.-_?=&%~+#@', 'SHIFT', 'DEL', 'DONE'],
  digits: () => [...DIGITS, 'DEL', 'DONE'],
};

const LABELS = { ' ': 'SPACE', SHIFT: '⇧', DEL: '⌫', DONE: 'DONE' };

export class KeyStrip {
  constructor(set = 'search', { upper = true } = {}) {
    this.set = set;
    this.upper = upper;
    this.keys = KEYSETS[set](upper);
    this.idx = 0;
    this.el = null;
  }

  get key() {
    return this.keys[this.idx];
  }

  render() {
    this.strip = h('div', { class: 'search-strip' });
    this.el = h('div', { class: 'search-keys' }, this.strip);
    this._build();
    return this.el;
  }

  _build() {
    this.keyEls = this.keys.map((k) => {
      const label = LABELS[k] || k;
      const el = h('div', { class: `sk ${label.length > 1 ? 'wide' : ''} ${k === 'DONE' ? 'done' : ''}`, text: label });
      return el;
    });
    this.strip.replaceChildren(...this.keyEls);
    this.paint();
  }

  toggleCase() {
    const current = this.key;
    this.upper = !this.upper;
    this.keys = KEYSETS[this.set](this.upper);
    const same = this.keys.findIndex((k) => k.toLowerCase() === String(current).toLowerCase());
    this.idx = same >= 0 ? same : 0;
    this._build();
  }

  move(dir) {
    this.idx = (this.idx + dir + this.keys.length) % this.keys.length;
    this.paint();
  }

  paint() {
    if (!this.keyEls) return;
    this.keyEls.forEach((el, i) => el.classList.toggle('on', i === this.idx));
    const cur = this.keyEls[this.idx];
    if (cur && cur.offsetWidth) this.strip.style.transform = `translateX(${-(cur.offsetLeft + cur.offsetWidth / 2)}px)`;
    else requestAnimationFrame(() => cur && (this.strip.style.transform = `translateX(${-(cur.offsetLeft + cur.offsetWidth / 2)}px)`));
  }
}
