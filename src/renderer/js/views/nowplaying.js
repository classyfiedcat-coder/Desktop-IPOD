/**
 * Now Playing, laid out like the iPod 5th generation: "6 of 15" in the
 * corner, artwork on the left, title / artist / album, and the glossy blue
 * progress bar with elapsed and remaining time.
 *
 * Wheel: volume. Centre button cycles scrubber → rating (or Spotify like)
 * → lyrics. Hold centre for options.
 */

import { View } from './view.js';
import { h, svg, ICONS, fmtTime, clamp, debounce } from '../util.js';
import { showSheet } from './sheet.js';

const MODE_TIMEOUT = 4000;

export class NowPlayingView extends View {
  constructor(app) {
    super({ title: 'Now Playing' });
    this.app = app;
    this.mode = 'progress';
    this.liked = null;
    this._seekPos = null;
    this._commitSeek = debounce(() => {
      if (this._seekPos !== null) this.app.player.seek(this._seekPos);
      this._seekPos = null;
    }, 350);
  }

  get isNowPlaying() {
    return true;
  }

  get className() {
    return 'np-view';
  }

  render() {
    const el = this.el;
    this.countEl = h('div', { class: 'np-count' });
    this.artA = h('div', { class: 'np-art-layer' });
    this.artB = h('div', { class: 'np-art-layer' });
    this.artEl = h('div', { class: 'np-art' }, this.artA, this.artB);
    this.titleEl = h('div', { class: 'np-line np-title' }, h('span', { class: 'np-text' }));
    this.artistEl = h('div', { class: 'np-line' }, h('span', { class: 'np-text' }));
    this.albumEl = h('div', { class: 'np-line' }, h('span', { class: 'np-text' }));
    this.metaEl = h('div', { class: 'np-meta' }, this.titleEl, this.artistEl, this.albumEl);

    // Bottom area (progress / volume / scrub / rating / like).
    this.fill = h('div', { class: 'np-fill' });
    this.diamond = h('div', { class: 'np-diamond' });
    this.bar = h('div', { class: 'np-bar' }, this.fill, this.diamond);
    this.elapsed = h('span', { class: 'np-elapsed' });
    this.remain = h('span', { class: 'np-remain' });
    this.progressEl = h('div', { class: 'np-progress' }, this.bar, h('div', { class: 'np-times' }, this.elapsed, this.remain));

    this.volFill = h('div', { class: 'np-fill' });
    this.volumeEl = h(
      'div',
      { class: 'np-volume' },
      svg(ICONS.speakerLow, 'np-spk lo'),
      h('div', { class: 'np-bar' }, this.volFill),
      svg(ICONS.speaker, 'np-spk hi')
    );

    this.stars = [];
    const starRow = h('div', { class: 'np-stars' });
    for (let i = 0; i < 5; i++) {
      const s = h('span', { class: 'np-star' });
      this.stars.push(s);
      starRow.append(s);
    }
    this.ratingEl = h('div', { class: 'np-rating' }, starRow);

    this.likeIcon = svg(ICONS.heart, 'np-heart');
    this.likeText = h('span', { class: 'np-like-text' });
    this.likeEl = h('div', { class: 'np-like' }, this.likeIcon, this.likeText);

    this.lyricsInner = h('div', { class: 'np-lyrics-inner' });
    this.lyricsEl = h('div', { class: 'np-lyrics' }, this.lyricsInner);

    this.bottom = h('div', { class: 'np-bottom' }, this.progressEl, this.volumeEl, this.ratingEl, this.likeEl);
    this.emptyEl = h('div', { class: 'np-empty', text: 'Nothing is playing' });
    el.replaceChildren(this.countEl, this.artEl, this.metaEl, this.bottom, this.lyricsEl, this.emptyEl);

    const p = this.app.player;
    this.listen(p, 'track', () => this.updateTrack());
    this.listen(p, 'state', () => this.updateTime());
    this.listen(p, 'time', () => this.updateTime());
    this.listen(p, 'rating', () => this.updateRating());
    this.listen(p, 'volume', () => this.updateVolume());
    this.listen(p, 'stopped', () => this.os.current === this && this.os.pop());
    this.every(() => this.updateTime(), 250);
    this._artUrl = undefined;
    this.updateTrack();
    this.setMode(this.mode === 'lyrics' ? 'progress' : this.mode, false);
  }

  // ---------------------------------------------------------- rendering --

  updateTrack() {
    const t = this.app.player.track;
    this.el.classList.toggle('empty', !t);
    if (!t) return;
    const q = this.app.player.queueInfo;
    this.countEl.textContent = q ? `${q.index} of ${q.total}` : '';
    this._setText(this.titleEl, t.title);
    this._setText(this.artistEl, t.artist);
    this._setText(this.albumEl, t.album);
    this._setArt(t.art);
    this.liked = null;
    if (this.mode === 'like') this._loadLiked();
    if (this.mode === 'rating') this.updateRating();
    if (this.mode === 'lyrics') this._renderLyrics();
    this.updateTime();
    this.later(() => this._marquee(), 1200);
  }

  _setText(lineEl, text) {
    const span = lineEl.firstChild;
    span.textContent = text || '';
    span.classList.remove('marquee');
  }

  _marquee() {
    for (const line of [this.titleEl, this.artistEl, this.albumEl]) {
      const span = line.firstChild;
      const overflow = span.scrollWidth - line.clientWidth;
      if (overflow > 2) {
        span.style.setProperty('--dist', `${-overflow - 8}px`);
        span.style.setProperty('--dur', `${Math.max(4, (overflow + 60) / 22)}s`);
        span.classList.add('marquee');
      }
    }
  }

  _setArt(url) {
    if (url === this._artUrl) return;
    this._artUrl = url;
    this.el.classList.toggle('no-art', !url);
    // Cross-fade between two layers.
    const [show, hide] = this._artFlip ? [this.artA, this.artB] : [this.artB, this.artA];
    this._artFlip = !this._artFlip;
    if (url) {
      const img = new Image();
      img.onload = () => {
        if (this._artUrl !== url) return;
        show.style.backgroundImage = `url("${url}")`;
        show.classList.add('show');
        hide.classList.remove('show');
      };
      img.onerror = () => {
        if (this._artUrl === url) this.el.classList.add('no-art');
      };
      img.src = url;
    } else {
      show.classList.remove('show');
      hide.classList.remove('show');
    }
  }

  updateTime() {
    const p = this.app.player;
    if (!p.track) {
      this.el.classList.add('empty');
      return;
    }
    const dur = p.duration || 0;
    const pos = this._seekPos !== null ? this._seekPos : p.position;
    const pct = dur ? clamp(pos / dur, 0, 1) : 0;
    this.fill.style.width = `${pct * 100}%`;
    this.diamond.style.left = `${pct * 100}%`;
    this.elapsed.textContent = fmtTime(pos);
    this.remain.textContent = dur ? fmtTime(dur - pos, { negative: true }) : '--:--';
    const q = p.queueInfo;
    const count = q ? `${q.index} of ${q.total}` : '';
    if (this.countEl.textContent !== count) this.countEl.textContent = count;
    if (this.mode === 'lyrics') this._syncLyrics(pos);
  }

  updateVolume() {
    this.volFill.style.width = `${this.app.player.volume * 100}%`;
  }

  updateRating() {
    const r = this.app.player.rating;
    this.stars.forEach((s, i) => s.classList.toggle('on', i < r));
  }

  // -------------------------------------------------------------- modes --

  setMode(mode, user = true) {
    this.mode = mode;
    this.el.dataset.mode = mode;
    if (mode === 'volume') this.updateVolume();
    if (mode === 'rating') this.updateRating();
    if (mode === 'like') this._loadLiked();
    if (mode === 'lyrics') this._renderLyrics();
    if (this._modeTimer) this.clear(this._modeTimer);
    if (user && mode !== 'progress' && mode !== 'lyrics') {
      this._modeTimer = this.later(() => this.setMode('progress', false), mode === 'volume' ? 1800 : MODE_TIMEOUT);
    }
  }

  _modes() {
    const t = this.app.player.track;
    const list = ['progress', 'scrub'];
    if (t && t.source === 'local') list.push('rating');
    if (t && t.source === 'spotify' && t.uri && t.uri.startsWith('spotify:track:')) list.push('like');
    if (t && t.lyrics && this.app.store.settings.lyrics) list.push('lyrics');
    return list;
  }

  onSelect() {
    if (!this.app.player.track) return;
    const modes = this._modes();
    const cur = this.mode === 'volume' ? 'progress' : this.mode;
    const next = modes[(modes.indexOf(cur) + 1) % modes.length];
    this.setMode(next);
  }

  onScroll(dir, speed) {
    const p = this.app.player;
    if (!p.track && this.mode !== 'volume') return false;
    switch (this.mode) {
      case 'scrub': {
        const dur = p.duration || 0;
        if (!dur) return false;
        const base = this._seekPos !== null ? this._seekPos : p.position;
        const step = Math.max(1.5, dur / 120) * (speed > 24 ? 3 : 1);
        this._seekPos = clamp(base + dir * step, 0, Math.max(0, dur - 1));
        if (p.source === 'local') {
          p.seek(this._seekPos);
          this._seekPos = null;
        } else this._commitSeek();
        this.updateTime();
        this.setMode('scrub');
        return true;
      }
      case 'rating': {
        const r = clamp(p.rating + dir, 0, 5);
        if (r === p.rating) return false;
        p.setRating(r);
        this.setMode('rating');
        return true;
      }
      case 'like': {
        const want = dir > 0;
        if (this.liked === want) return false;
        this._toggleLike(want);
        this.setMode('like');
        return true;
      }
      case 'lyrics': {
        const box = this.lyricsEl;
        const before = box.scrollTop;
        box.scrollTop += dir * 18;
        this._lyricsManual = performance.now();
        return box.scrollTop !== before;
      }
      default: {
        const v = clamp(Math.round((p.volume + dir * 0.03) * 100) / 100, 0, 1);
        if (this.mode !== 'volume') this.setMode('volume');
        else this.setMode('volume');
        if (v === p.volume) return false;
        p.setVolume(v);
        return true;
      }
    }
  }

  onMenu() {
    if (this.mode === 'lyrics') {
      this.setMode('progress', false);
      return true;
    }
    return false;
  }

  async _loadLiked() {
    const sp = this.app.spotify;
    this.likeText.textContent = '…';
    const v = await sp.liked();
    this.liked = v;
    this._paintLike();
  }

  async _toggleLike(want) {
    const sp = this.app.spotify;
    this.liked = want;
    this._paintLike();
    try {
      await sp.api.setLiked(sp.track.uri, want);
    } catch {
      this.liked = !want;
      this._paintLike();
      this.os.alert('Couldn’t update Liked Songs.');
    }
  }

  _paintLike() {
    this.likeEl.classList.toggle('on', !!this.liked);
    this.likeText.textContent = this.liked ? 'In Liked Songs' : 'Add to Liked Songs';
  }

  _renderLyrics() {
    const t = this.app.player.track;
    const text = (t && t.lyrics) || '';
    this._lrc = parseLrc(text);
    this.lyricsInner.replaceChildren(
      ...(this._lrc ? this._lrc.map((l) => h('p', { text: l.text || ' ' })) : text.split(/\r?\n/).map((l) => h('p', { text: l || ' ' })))
    );
    this.lyricsEl.scrollTop = 0;
  }

  _syncLyrics(pos) {
    if (!this._lrc || (this._lyricsManual && performance.now() - this._lyricsManual < 4000)) return;
    let idx = -1;
    for (let i = 0; i < this._lrc.length; i++) if (this._lrc[i].t <= pos) idx = i;
    const lines = this.lyricsInner.children;
    for (let i = 0; i < lines.length; i++) lines[i].classList.toggle('cur', i === idx);
    if (idx >= 0) {
      const line = lines[idx];
      this.lyricsEl.scrollTop = line.offsetTop - this.lyricsEl.clientHeight / 2 + line.offsetHeight / 2;
    }
  }

  onSelectHold() {
    const { player, library } = this.app;
    const t = player.track;
    if (!t) return;
    const items = [];
    if (t.source === 'local') {
      items.push({
        label: 'Add to On-The-Go',
        action: () => {
          player.addToOnTheGo(t);
          this.os.alert('Added to On-The-Go');
        },
      });
      const album = library.albums.find((a) => a.tracks.includes(t));
      if (album) items.push({ label: 'Browse Album', action: () => this.app.nav.album(album) });
      items.push({ label: 'Browse Artist', action: () => this.app.nav.artist(t.artist) });
    } else {
      items.push({
        label: 'Add to Liked Songs',
        action: async () => {
          try {
            await this.app.spotify.api.setLiked(t.uri, true);
            this.os.alert('Added to Liked Songs');
          } catch {
            this.os.alert('Couldn’t update Liked Songs.');
          }
        },
      });
      if (t.albumId) items.push({ label: 'Browse Album', action: () => this.app.nav.spotifyAlbum({ id: t.albumId, uri: t.albumUri, title: t.album, artist: t.albumArtist, art: t.art }) });
    }
    showSheet(this.os, { title: t.title, items });
  }

  onEnter() {
    this.updateTrack();
  }
}

/** Parse [mm:ss.xx] synced lyrics; returns null for plain text. */
function parseLrc(text) {
  if (!/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(text)) return null;
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const words = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: +m[1] * 60 + +m[2] + (m[3] ? +`0.${m[3]}` : 0), text: words });
  }
  return out.sort((a, b) => a.t - b.t);
}
