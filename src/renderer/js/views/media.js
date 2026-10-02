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
      const resume = (v) => app.store.user.bookmarks[`vid:${v.id}`];
      const item = (v, label = v.title) => ({ label, sortName: label, value: resume(v) ? 'Resume' : '', dot: () => !app.store.user.played[`vid:${v.id}`], view: () => new VideoView(app, v) });
      const list = (title, vids, label) => new ListView({ title, index: vids.length > 30, refreshOnEnter: true, items: () => vids.map((v) => item(v, label ? label(v) : v.title)) });
      return new ListView({
        title: 'Videos',
        empty: 'No videos found. Choose a folder in Settings › Music Library.',
        load: async () => {
          const vids = await loadVideos();
          if (!vids.length) return [];
          const by = (c) => vids.filter((v) => v.category === c);
          const items = [];
          const movies = by('movies');
          const mv = by('music-videos');
          const tv = by('tv');
          const vp = by('video-podcasts');
          if (movies.length) items.push({ label: 'Movies', value: String(movies.length), view: () => list('Movies', movies) });
          if (mv.length) items.push({ label: 'Music Videos', value: String(mv.length), view: () => list('Music Videos', mv) });
          if (tv.length) {
            const shows = new Map();
            for (const v of tv) {
              if (!shows.has(v.show)) shows.set(v.show, []);
              shows.get(v.show).push(v);
            }
            items.push({
              label: 'TV Shows',
              value: String(shows.size),
              view: () =>
                new ListView({
                  title: 'TV Shows',
                  items: () => [...shows.entries()].map(([name, eps]) => ({ label: name, value: String(eps.length), view: () => list(name, eps, (v) => (v.season ? `S${v.season} E${v.episode} · ${v.title.replace(/.*s\d+e\d+\s*/i, '') || v.title}` : v.title)) })),
                }),
            });
          }
          if (vp.length) items.push({ label: 'Video Podcasts', value: String(vp.length), view: () => list('Video Podcasts', vp) });
          const recent = vids.filter((v) => resume(v));
          if (recent.length) items.push({ label: 'Continue Watching', value: String(recent.length), view: () => list('Continue Watching', recent) });
          items.push({ label: 'All Videos', value: String(vids.length), view: () => list('All Videos', vids) });
          items.push({ label: 'Video Settings', view: () => videoSettings(app) });
          return items;
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

function videoSettings(app) {
  const { store } = app;
  return new ListView({
    title: 'Video Settings',
    items: () => [
      { label: 'Fit to Screen', value: () => (store.settings.videoFit === 'cover' ? 'Fill' : 'Fit'), arrow: false, action: () => store.set('videoFit', store.settings.videoFit === 'cover' ? 'contain' : 'cover') },
      { label: 'Captions', value: () => (store.settings.subtitles ? 'On' : 'Off'), arrow: false, action: () => store.set('subtitles', !store.settings.subtitles) },
    ],
  });
}

/** Full-screen video with resume, captions, scrubbing and fit/fill. */
class VideoView extends View {
  constructor(app, video) {
    super({ title: video.title });
    this.app = app;
    this.video = video;
    this.mode = 'volume';
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
  get key() {
    return `vid:${this.video.id}`;
  }
  render() {
    this.app.player.pause();
    const s = this.app.store.settings;
    this.v = h('video', { class: 'vv-video', src: `app://ipod/media/video/${this.video.id}`, autoplay: true, playsinline: true });
    this.v.style.objectFit = s.videoFit === 'cover' ? 'cover' : 'contain';
    this.v.volume = this.app.player.effectiveVolume;
    if (this.video.sub) {
      const track = h('track', { kind: 'subtitles', src: `app://ipod/media/sub/${this.video.sub}`, default: s.subtitles ? true : undefined, srclang: 'en', label: 'Captions' });
      this.v.append(track);
      this.v.addEventListener('loadedmetadata', () => {
        for (const t of this.v.textTracks) t.mode = s.subtitles ? 'showing' : 'hidden';
      });
    }
    const at = this.app.store.user.bookmarks[this.key];
    if (at) this.v.addEventListener('loadedmetadata', () => (this.v.currentTime = Math.min(at, (this.v.duration || at) - 3)), { once: true });
    this.fill = h('div', { class: 'np-fill' });
    this.diamond = h('div', { class: 'np-diamond' });
    this.time = h('span');
    this.remain = h('span');
    this.modeLabel = h('div', { class: 'vv-mode' });
    this.hud = h(
      'div',
      { class: 'vv-hud' },
      h('div', { class: 'vv-title', text: this.video.title }),
      h('div', { class: 'np-bar' }, this.fill, this.diamond),
      h('div', { class: 'np-times' }, this.time, this.modeLabel, this.remain)
    );
    this.icon = h('div', { class: 'vv-icon' });
    this.el.replaceChildren(this.v, this.icon, this.hud);
    this.v.addEventListener('timeupdate', () => this.paint());
    this.v.addEventListener('ended', () => {
      delete this.app.store.user.bookmarks[this.key];
      this.app.store.user.played[this.key] = Date.now();
      this.app.store.touchUser();
      if (this.os.current === this) this.os.pop();
    });
    this.v.addEventListener('error', () => {
      this.os.alert('This video format can’t be played.');
      this.later(() => this.os.current === this && this.os.pop(), 1200);
    });
    this.v.addEventListener('pause', () => this.flashHud());
    this.v.addEventListener('play', () => this.flashHud());
    this.every(() => this.save(), 5000);
    this.flashHud();
  }
  save() {
    const t = this.v ? this.v.currentTime : 0;
    const d = this.v ? this.v.duration : 0;
    if (t > 10 && (!d || t < d - 20)) this.app.store.user.bookmarks[this.key] = Math.round(t);
    else if (d && t >= d - 20) delete this.app.store.user.bookmarks[this.key];
    this.app.store.touchUser();
  }
  onUnmount() {
    if (this.v) {
      this.save();
      this.v.pause();
      this.v.removeAttribute('src');
      this.v.load();
    }
  }
  paint() {
    const d = this.v.duration || 0;
    const t = this.v.currentTime || 0;
    const pct = d ? (t / d) * 100 : 0;
    this.fill.style.width = `${pct}%`;
    this.diamond.style.left = `${pct}%`;
    this.time.textContent = fmtTime(t);
    this.remain.textContent = d ? fmtTime(d - t, { negative: true }) : '';
    this.modeLabel.textContent = this.mode === 'scrub' ? 'Scrubbing' : '';
    this.icon.innerHTML = this.v.paused ? ICONS.pause : '';
  }
  flashHud() {
    this.hud.classList.add('show');
    if (this._hudT) this.clear(this._hudT);
    this._hudT = this.later(() => !this.v.paused && this.mode !== 'scrub' && this.hud.classList.remove('show'), 2500);
    this.paint();
  }
  onPlay() {
    if (this.v.paused) this.v.play();
    else this.v.pause();
    return true;
  }
  onSelect() {
    this.mode = this.mode === 'scrub' ? 'volume' : 'scrub';
    this.el.classList.toggle('scrub', this.mode === 'scrub');
    this.flashHud();
  }
  onSelectHold() {
    const s = this.app.store;
    s.set('videoFit', s.settings.videoFit === 'cover' ? 'contain' : 'cover');
    this.v.style.objectFit = s.settings.videoFit;
    this.os.alert(s.settings.videoFit === 'cover' ? 'Fill Screen' : 'Fit to Screen', 800);
  }
  onScroll(dir, speed) {
    if (this.mode === 'scrub') {
      const d = this.v.duration || 0;
      this.v.currentTime = clamp(this.v.currentTime + dir * Math.max(2, d / 100) * (speed > 24 ? 3 : 1), 0, d);
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
