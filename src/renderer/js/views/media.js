/** Photos (thumbnail grid, full-screen viewer, slideshow) and Videos. */

import { View } from './view.js';
import { ListView } from './list.js';
import { h, ICONS, clamp, fmtTime } from '../util.js';

export function createMedia(app) {
  const cache = { photos: null, videos: null };
  const photosFolder = () => app.store.settings.photosFolder || app.store.env.defaults.pictures;
  const videosFolder = () => app.store.settings.videosFolder || app.store.env.defaults.videos;

  const loadPhotos = async () => {
    if (!cache.photos) cache.photos = await window.ipod.media.photos(photosFolder());
    return cache.photos;
  };
  const loadVideos = async () => {
    if (!cache.videos) cache.videos = await window.ipod.media.videos(videosFolder());
    return cache.videos;
  };

  return {
    invalidate() {
      cache.photos = null;
      cache.videos = null;
    },
    cachedCount(kind) {
      const c = cache[kind];
      if (!c) return null;
      return kind === 'photos' ? c.photos.length : c.length;
    },
    photosMenu() {
      return new ListView({
        title: 'Photos',
        empty: 'No photos found. Choose a folder in Settings › Music Library.',
        load: async () => {
          const { photos, albums } = await loadPhotos();
          if (!photos.length) return [];
          const byId = new Map(photos.map((p) => [p.id, p]));
          const items = [{ label: 'Photo Library', view: () => new PhotoGrid(app, 'Photo Library', photos) }];
          if (albums.length > 1) {
            for (const al of albums) {
              const list = al.ids.map((id) => byId.get(id)).filter(Boolean);
              items.push({ label: al.name.split(/[\\/]/).pop(), view: () => new PhotoGrid(app, al.name.split(/[\\/]/).pop(), list) });
            }
          }
          items.push({ label: 'Slideshow', arrow: false, action: () => app.os.push(new PhotoViewer(app, photos, 0, { slideshow: true })) });
          return items;
        },
      });
    },
    videosMenu() {
      return new ListView({
        title: 'Videos',
        empty: 'No videos found. Choose a folder in Settings › Music Library.',
        load: async () => {
          const vids = await loadVideos();
          return vids.map((v) => ({ label: v.title, sortName: v.title, view: () => new VideoView(app, v) }));
        },
      });
    },
  };
}

class PhotoGrid extends View {
  constructor(app, title, photos) {
    super({ title });
    this.app = app;
    this.photos = photos;
    this.sel = 0;
    this.cols = 5;
    this.rows = 4;
    this.top = 0;
  }
  get className() {
    return 'photo-grid';
  }
  render() {
    this.grid = h('div', { class: 'pg-grid' });
    this.cells = [];
    for (let i = 0; i < this.cols * this.rows; i++) {
      const img = h('img', { draggable: 'false', alt: '' });
      const cell = h('div', { class: 'pg-cell' }, img);
      this.cells.push(cell);
      this.grid.append(cell);
    }
    this.count = h('div', { class: 'pg-count' });
    this.el.replaceChildren(this.grid, this.count);
    this.paint();
  }
  paint() {
    const per = this.cols;
    const row = Math.floor(this.sel / per);
    if (row < this.top) this.top = row;
    if (row >= this.top + this.rows) this.top = row - this.rows + 1;
    this.cells.forEach((cell, i) => {
      const idx = this.top * per + i;
      const p = this.photos[idx];
      const img = cell.firstChild;
      cell.classList.toggle('empty', !p);
      cell.classList.toggle('sel', idx === this.sel);
      if (p) {
        const src = `app://ipod/media/thumb/${p.id}`;
        if (img.dataset.src !== src) {
          img.dataset.src = src;
          img.src = src;
        }
      }
    });
    this.count.textContent = `${this.sel + 1} of ${this.photos.length}`;
  }
  onScroll(dir) {
    const next = clamp(this.sel + dir, 0, this.photos.length - 1);
    if (next === this.sel) return false;
    this.sel = next;
    this.paint();
    return true;
  }
  onSelect() {
    this.os.push(new PhotoViewer(this.app, this.photos, this.sel));
  }
  onPlay() {
    this.os.push(new PhotoViewer(this.app, this.photos, this.sel, { slideshow: true }));
    return true;
  }
}

class PhotoViewer extends View {
  constructor(app, photos, index, { slideshow = false } = {}) {
    super({ title: 'Photo' });
    this.app = app;
    this.photos = photos;
    this.index = index;
    this.slideshow = slideshow;
  }
  get fullscreen() {
    return true;
  }
  get keepAwake() {
    return this.slideshow;
  }
  get className() {
    return 'photo-viewer';
  }
  render() {
    this.a = h('div', { class: 'pv-photo' });
    this.b = h('div', { class: 'pv-photo' });
    this.badge = h('div', { class: 'pv-badge' });
    this.el.replaceChildren(this.a, this.b, this.badge);
    this.show(false);
    if (this.slideshow) this._startShow();
  }
  show(animate = true) {
    const p = this.photos[this.index];
    if (!p) return;
    const [front, back] = this._flip ? [this.a, this.b] : [this.b, this.a];
    this._flip = !this._flip;
    front.style.backgroundImage = `url("app://ipod/media/photo/${p.id}")`;
    front.classList.toggle('kenburns', this.slideshow);
    front.classList.add('show');
    back.classList.remove('show');
    if (!animate) back.style.transition = 'none';
    this.badge.textContent = this.slideshow ? '' : `${this.index + 1} of ${this.photos.length}`;
  }
  _startShow() {
    if (this._timer) this.clear(this._timer);
    this._timer = this.every(() => {
      this.index = (this.index + 1) % this.photos.length;
      this.show();
    }, 3500);
  }
  onScroll(dir) {
    const next = clamp(this.index + dir, 0, this.photos.length - 1);
    if (next === this.index) return false;
    this.index = next;
    this.show();
    if (this.slideshow) this._startShow();
    return true;
  }
  onSelect() {
    this.slideshow = !this.slideshow;
    if (this.slideshow) this._startShow();
    else if (this._timer) this.clear(this._timer);
    this.show();
  }
  onPlay() {
    this.onSelect();
    return true;
  }
  onNext() {
    this.onScroll(1);
    return true;
  }
  onPrev() {
    this.onScroll(-1);
    return true;
  }
}

class VideoView extends View {
  constructor(app, video) {
    super({ title: video.title });
    this.app = app;
    this.video = video;
    this.mode = 'progress';
  }
  get fullscreen() {
    return true;
  }
  get keepAwake() {
    return this.v && !this.v.paused;
  }
  get className() {
    return 'video-view';
  }
  render() {
    this.app.player.pause();
    this.v = h('video', { class: 'vv-video', src: `app://ipod/media/video/${this.video.id}`, autoplay: true, playsinline: true });
    this.v.volume = this.app.player.effectiveVolume;
    this.fill = h('div', { class: 'np-fill' });
    this.time = h('span');
    this.remain = h('span');
    this.hud = h(
      'div',
      { class: 'vv-hud' },
      h('div', { class: 'vv-title', text: this.video.title }),
      h('div', { class: 'np-bar' }, this.fill),
      h('div', { class: 'np-times' }, this.time, this.remain)
    );
    this.icon = h('div', { class: 'vv-icon' });
    this.el.replaceChildren(this.v, this.icon, this.hud);
    this.v.addEventListener('timeupdate', () => this.paint());
    this.v.addEventListener('ended', () => this.os.current === this && this.os.pop());
    this.v.addEventListener('error', () => {
      this.os.alert('This video format can’t be played.');
      this.later(() => this.os.current === this && this.os.pop(), 1200);
    });
    this.v.addEventListener('pause', () => this.flashHud());
    this.v.addEventListener('play', () => this.flashHud());
    this.flashHud();
  }
  onUnmount() {
    if (this.v) {
      this.v.pause();
      this.v.removeAttribute('src');
      this.v.load();
    }
  }
  paint() {
    const d = this.v.duration || 0;
    const t = this.v.currentTime || 0;
    this.fill.style.width = d ? `${(t / d) * 100}%` : '0%';
    this.time.textContent = fmtTime(t);
    this.remain.textContent = d ? fmtTime(d - t, { negative: true }) : '';
    this.icon.innerHTML = this.v.paused ? ICONS.pause : '';
  }
  flashHud() {
    this.hud.classList.add('show');
    if (this._hudT) this.clear(this._hudT);
    this._hudT = this.later(() => !this.v.paused && this.hud.classList.remove('show'), 2500);
    this.paint();
  }
  onPlay() {
    if (this.v.paused) this.v.play();
    else this.v.pause();
    return true;
  }
  onSelect() {
    this.mode = this.mode === 'scrub' ? 'progress' : 'scrub';
    this.el.classList.toggle('scrub', this.mode === 'scrub');
    this.flashHud();
  }
  onScroll(dir) {
    if (this.mode === 'scrub') {
      const d = this.v.duration || 0;
      this.v.currentTime = clamp(this.v.currentTime + dir * Math.max(2, d / 100), 0, d);
    } else {
      this.v.volume = clamp(this.v.volume + dir * 0.04, 0, this.app.store.settings.volumeLimit);
      this.os.alert(`Volume ${Math.round(this.v.volume * 100)}%`, 500);
    }
    this.flashHud();
    return true;
  }
  onNext() {
    this.v.currentTime = Math.min(this.v.duration || 0, this.v.currentTime + 30);
    this.flashHud();
    return true;
  }
  onPrev() {
    this.v.currentTime = Math.max(0, this.v.currentTime - 15);
    this.flashHud();
    return true;
  }
}

