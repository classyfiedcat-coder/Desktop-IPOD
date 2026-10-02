/**
 * Cover Flow: spin through your albums in 3D. Select flips the album over to
 * its track list; ▶❚❚ plays the album; type a letter to jump.
 */

import { View } from './view.js';
import { ListView } from './list.js';
import { h, clamp, indexLetter } from '../util.js';
import { songOptions } from './options.js';

const WINDOW = 7;

export class CoverFlowView extends View {
  /**
   * @param {object} app
   * @param {object} [o]
   * @param {Array} [o.albums] albums { title, artist, art, tracks? , spotify? }
   * @param {Function} [o.loadTracks] async (album) => tracks
   */
  constructor(app, o = {}) {
    super({ title: 'Cover Flow' });
    this.app = app;
    this.o = o;
    this.index = o.index || 0;
    this.els = new Map();
    this.flipped = null;
  }

  get fullscreen() {
    return true;
  }

  get className() {
    return 'coverflow-view';
  }

  get albums() {
    return this.o.albums || this.app.library.albums;
  }

  render() {
    this.stage = h('div', { class: 'cf-stage' });
    this.title = h('div', { class: 'cf-album' });
    this.artist = h('div', { class: 'cf-artist' });
    this.count = h('div', { class: 'cf-count' });
    this.letter = h('div', { class: 'letter-overlay' });
    this.empty = h('div', { class: 'cf-empty', text: 'No albums yet' });
    this.el.replaceChildren(this.stage, h('div', { class: 'cf-caption' }, this.title, this.artist), this.count, this.letter, this.empty);
    this.els.clear();
    this.el.classList.toggle('none', !this.albums.length);
    this.index = clamp(this.index, 0, Math.max(0, this.albums.length - 1));
    this.layout(false);
    if (this.flipped) {
      const list = this.flipped.list;
      this.flipped = null;
      this.flip(list);
    }
  }

  _cover(i) {
    const al = this.albums[i];
    const el = h('div', { class: 'cf-cover' });
    if (al.art) {
      el.style.backgroundImage = `url("${al.art}")`;
    } else {
      el.classList.add('no-art');
      el.append(h('span', { text: al.title }));
    }
    return el;
  }

  layout(animate = true) {
    const n = this.albums.length;
    const lo = Math.max(0, this.index - WINDOW);
    const hi = Math.min(n - 1, this.index + WINDOW);
    for (const [i, el] of this.els) {
      if (i < lo || i > hi) {
        el.remove();
        this.els.delete(i);
      }
    }
    for (let i = lo; i <= hi; i++) {
      let el = this.els.get(i);
      if (!el) {
        el = this._cover(i);
        el.style.transition = 'none';
        this.els.set(i, el);
        this.stage.append(el);
        this._place(el, i - this.index + (i > this.index ? 1 : i < this.index ? -1 : 0));
        void el.offsetWidth;
      }
      el.style.transition = animate ? '' : 'none';
      this._place(el, i - this.index);
    }
    const al = this.albums[this.index];
    this.title.textContent = al ? al.title : '';
    this.artist.textContent = al ? al.artist : '';
    this.count.textContent = n ? `${this.index + 1} of ${n}` : '';
  }

  _place(el, d) {
    const s = Math.sign(d);
    const a = Math.abs(d);
    let x = 0;
    let z = 70;
    let ry = 0;
    if (a > 0) {
      x = s * (78 + (a - 1) * 26);
      z = 0;
      ry = -s * 68;
    }
    el.style.transform = `translate(-50%, -50%) translateX(${x}px) translateZ(${z}px) rotateY(${ry}deg)`;
    el.style.zIndex = String(100 - a);
    el.classList.toggle('center', a === 0);
    el.style.filter = a > 4 ? `brightness(${Math.max(0.35, 1 - (a - 4) * 0.2)})` : '';
  }

  onScroll(dir, speed) {
    if (this.flipped) return this.flipped.list.onScroll(dir, speed);
    const n = this.albums.length;
    const step = speed > 30 && n > 60 ? 3 : 1;
    const next = clamp(this.index + dir * step, 0, n - 1);
    if (next === this.index) return false;
    this.index = next;
    this.layout(true);
    if (step > 1) this._showLetter();
    return true;
  }

  _showLetter() {
    const al = this.albums[this.index];
    if (!al) return;
    this.letter.textContent = indexLetter(al.title);
    this.letter.classList.add('show');
    if (this._lt) this.clear(this._lt);
    this._lt = this.later(() => this.letter.classList.remove('show'), 600);
  }

  onChar(key) {
    if (this.flipped) return;
    const k = key.toUpperCase();
    const i = this.albums.findIndex((a) => indexLetter(a.title) === k);
    if (i >= 0) {
      this.index = i;
      this.layout(true);
      this._showLetter();
    }
  }

  async _tracks(al) {
    if (al.tracks) return al.tracks;
    if (this.o.loadTracks) {
      al.tracks = await this.o.loadTracks(al);
      return al.tracks;
    }
    return [];
  }

  async onSelect() {
    if (this.flipped) return this.flipped.list.onSelect();
    const al = this.albums[this.index];
    if (!al) return;
    const list = new ListView({
      title: al.title,
      rows: 6,
      empty: 'No songs',
      load: async () => {
        const tracks = await this._tracks(al);
        return tracks.map((t, i) => ({
          label: t.title,
          value: t.trackNo ? String(t.trackNo) : String(i + 1),
          arrow: false,
          icon: () => (this.app.player.track && (this.app.player.track.id === t.id || (t.uri && this.app.player.track.uri === t.uri)) ? 'speaker' : null),
          action: () => this.app.player.playTracks(tracks, i, { context: al.uri ? { uri: al.uri } : undefined }),
          onHold: () => songOptions(this.app, t),
        }));
      },
    });
    this.flip(list);
  }

  flip(list) {
    const al = this.albums[this.index];
    const front = h('div', { class: 'cf-face cf-front' });
    if (al.art) front.style.backgroundImage = `url("${al.art}")`;
    const listEl = h('div', { class: 'cf-list' });
    const back = h('div', { class: 'cf-face cf-back' }, h('div', { class: 'cf-back-head' }, h('b', { text: al.title }), h('span', { text: al.artist })), listEl);
    const card = h('div', { class: 'cf-card' }, front, back);
    this.el.append(card);
    this.el.classList.add('is-flipped');
    list.mount(listEl, this.os);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('open')));
    this.flipped = { card, list };
  }

  unflip() {
    const f = this.flipped;
    if (!f) return;
    this.flipped = null;
    f.card.classList.remove('open');
    this.el.classList.remove('is-flipped');
    setTimeout(() => {
      f.list.unmount();
      f.card.remove();
    }, 420);
  }

  onMenu() {
    if (this.flipped) {
      this.unflip();
      return true;
    }
    return false;
  }

  onSelectHold() {
    if (this.flipped) this.flipped.list.onSelectHold();
  }

  /** ▶❚❚ with nothing playing starts the album under the cursor. */
  onPlay() {
    if (this.flipped || this.app.player.track) return false;
    const al = this.albums[this.index];
    if (!al) return false;
    this._tracks(al).then((tracks) => {
      if (tracks.length) this.app.player.playTracks(tracks, 0, { context: al.uri ? { uri: al.uri } : undefined });
    });
    return true;
  }

  onUnmount() {
    if (this.flipped) this.flipped.list.unmount();
  }
}
