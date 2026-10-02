/** The 5th gen "Do not disconnect." screen, shown while dropped music is added. */

import { View } from './view.js';
import { h } from '../util.js';

export class SyncView extends View {
  constructor(app, { folders }) {
    super({ title: 'Syncing' });
    this.app = app;
    this.folders = folders;
  }

  get fullscreen() {
    return true;
  }

  get keepAwake() {
    return true;
  }

  get className() {
    return 'sync-view';
  }

  render() {
    this.icon = h('div', { class: 'sync-icon' });
    this.title = h('div', { class: 'sync-title', text: 'Do not disconnect.' });
    this.fill = h('div', { class: 'np-fill' });
    this.detail = h('div', { class: 'sync-detail', text: 'Adding music…' });
    this.el.replaceChildren(this.icon, this.title, h('div', { class: 'np-bar' }, this.fill), this.detail);
    const lib = this.app.library;
    this.listen(lib, 'progress', (p) => {
      if (p && p.total) {
        this.fill.style.width = `${(p.done / p.total) * 100}%`;
        this.detail.textContent = `Syncing ${p.done} of ${p.total}`;
      }
    });
    if (!this.started) {
      this.started = true;
      this.run();
    }
  }

  async run() {
    const { store, library } = this.app;
    const before = library.music.length;
    const list = store.musicFolders();
    const add = this.folders.filter((f) => !list.includes(f));
    if (add.length) store.set('folders', [...list, ...add]);
    await library.scan();
    const added = Math.max(0, library.music.length - before);
    if (!this.mounted) return;
    this.el.classList.add('complete');
    this.title.textContent = 'Sync is complete.';
    this.fill.style.width = '100%';
    this.detail.textContent = added ? `${added} new song${added === 1 ? '' : 's'}. OK to disconnect.` : 'OK to disconnect.';
    this.later(() => this.os.current === this && this.os.pop(), 2200);
  }

  onMenu() {
    return !this.el.classList.contains('complete');
  }
}
