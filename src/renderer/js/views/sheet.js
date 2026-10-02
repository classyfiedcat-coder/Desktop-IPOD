/** Pop-up option sheet (hold the centre button on a song). */

import { ListView } from './list.js';
import { h } from '../util.js';

export class SheetView extends ListView {
  constructor({ title, items }) {
    const wrapped = items.map((it) => ({
      ...it,
      action: async (item, view) => {
        view.os.closeModal();
        if (it.action) await it.action(item, view);
      },
    }));
    wrapped.push({ label: 'Cancel', action: (_i, view) => view.os.closeModal() });
    super({ title, items: wrapped, rows: Math.min(wrapped.length, 5) });
  }

  render() {
    this.el.style.setProperty('--rows', this.rowCount);
    this.el.style.setProperty('--sheet-head', this.title ? '24px' : '0px');
    super.render();
    if (this.title) this.el.prepend(h('div', { class: 'sheet-title', text: this.title }));
  }
}

export function showSheet(os, opts) {
  os.sheet(new SheetView(opts));
}
