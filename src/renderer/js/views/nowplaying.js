/**
 * Now Playing, laid out like the iPod 5th generation: "6 of 15" in the
 * corner, artwork on the left, title / artist / album, and the glossy blue
 * progress bar with elapsed and remaining time.
 *
 * Wheel: volume. The centre button cycles through the scrubber, rating
 * (Spotify: Liked Songs, podcasts: playback speed), lyrics, the visualizer
 * and full-screen artwork. Hold the centre button for options.
 */

import { View } from './view.js';
import { h, svg, ICONS, fmtTime, clamp, debounce } from '../util.js';
import { songOptions } from './options.js';
import { upNextView } from './upnext.js';
import { showSheet } from './sheet.js';
import { lineAt } from '../library/lyrics.js';

const MODE_TIMEOUT = 4500;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MODE_LABEL = { scrub: 'Scrubbing', rating: 'Rating', like: 'Liked Songs', speed: 'Speed', lyrics: 'Lyrics', visualizer: 'Visualizer', art: 'Album Art' };

export class NowPlayingView extends View {
  constructor(app) {
    super({ title: 'Now Playing' });
    this.app = app;
    this.mode = 'progress';
    this.liked = null;
    this._seekPos = null;
    this._lyrics = null;
    this._lyricsFor = null;
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

  get keepAwake() {
    return this.mode === 'visualizer' || this.mode === 'lyrics';
  }

  render() {
    const el = this.el;
    this.countEl = h('div', { class: 'np-count' });
    this.spinner = h('div', { class: 'np-buffering' });
    this.flags = h('div', { class: 'np-flags' });
    this.deviceEl = h('div', { class: 'np-device' });
    this.artA = h('div', { class: 'np-art-layer' });
    this.artB = h('div', { class: 'np-art-layer' });
    this.artEl = h('div', { class: 'np-art' }, this.artA, this.artB);
    this.titleEl = h('div', { class: 'np-line np-title' }, h('span', { class: 'np-text' }));
    this.artistEl = h('div', { class: 'np-line' }, h('span', { class: 'np-text' }));
    this.albumEl = h('div', { class: 'np-line' }, h('span', { class: 'np-text' }));
    this.metaEl = h('div', { class: 'np-meta' }, this.titleEl, this.artistEl, this.albumEl);

    // Bottom area (progress / volume / scrub / rating / like / speed).
    this.fill = h('div', { class: 'np-fill' });
    this.diamond = h('div', { class: 'np-diamond' });
    this.bar = h('div', { class: 'np-bar' }, this.fill, this.diamond);
    this.elapsed = h('span', { class: 'np-elapsed' });
    this.rateEl = h('span', { class: 'np-rate' });
    this.remain = h('span', { class: 'np-remain' });
    this.liveEl = h('div', { class: 'np-live' }, h('span', { class: 'np-live-dot' }), 'LIVE');
    this.progressEl = h('div', { class: 'np-progress' }, this.bar, this.liveEl, h('div', { class: 'np-times' }, this.elapsed, this.rateEl, this.remain));

    this.volFill = h('div', { class: 'np-fill' });
    this.volumeEl = h('div', { class: 'np-volume' }, svg(ICONS.speakerLow, 'np-spk lo'), h('div', { class: 'np-bar' }, this.volFill), svg(ICONS.speaker, 'np-spk hi'));

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

    this.speedFill = h('div', { class: 'np-fill' });
    this.speedText = h('span', { class: 'np-speed-text' });
    this.speedEl = h('div', { class: 'np-speed' }, h('span', { class: 'np-speed-ico', text: '🐢' }), h('div', { class: 'np-bar' }, this.speedFill), h('span', { class: 'np-speed-ico', text: '🐇' }), this.speedText);

    this.modeTag = h('div', { class: 'np-mode-tag' });

    this.lyricsInner = h('div', { class: 'np-lyrics-inner' });
    this.lyricsStatus = h('div', { class: 'np-lyrics-status' });
    this.lyricsEl = h('div', { class: 'np-lyrics' }, this.lyricsStatus, this.lyricsInner);

    this.canvas = h('canvas', { class: 'np-viz' });
    this.vizCaption = h('div', { class: 'np-viz-caption' });
    this.vizEl = h('div', { class: 'np-viz-wrap' }, this.canvas, this.vizCaption);

    this.bigArt = h('div', { class: 'np-bigart' }, h('div', { class: 'np-bigart-img' }), h('div', { class: 'np-bigart-caption' }));

    this.bottom = h('div', { class: 'np-bottom' }, this.progressEl, this.volumeEl, this.ratingEl, this.likeEl, this.speedEl);
    this.emptyEl = h('div', { class: 'np-empty', text: 'Nothing is playing' });
    el.replaceChildren(this.countEl, this.spinner, this.flags, this.deviceEl, this.artEl, this.metaEl, this.bottom, this.modeTag, this.lyricsEl, this.vizEl, this.bigArt, this.emptyEl);

    const p = this.app.player;
    this.listen(p, 'track', () => this.updateTrack());
    this.listen(p, 'meta', () => this.updateTrack(true));
    this.listen(p, 'state', () => this.updateTime());
    this.listen(p, 'time', () => this.updateTime());
    this.listen(p, 'rating', () => this.updateRating());
    this.listen(p, 'volume', () => this.updateVolume());
    this.listen(p, 'buffering', (b) => this.el.classList.toggle('buffering', !!b));
    this.listen(p, 'stopped', () => this.os.current === this && this.os.pop());
    this.listen(this.app.store, 'change:shuffle', () => this.updateFlags());
    this.listen(this.app.store, 'change:repeat', () => this.updateFlags());
    this.every(() => this.updateTime(), 250);
    this._artUrl = undefined;
    this.updateTrack();
    this.setMode(['visualizer', 'lyrics', 'art'].includes(this.mode) ? this.mode : 'progress', false);
  }

  onUnmount() {
    this._stopViz();
  }

  // ---------------------------------------------------------- rendering --

  updateTrack(metaOnly = false) {
    const p = this.app.player;
    const t = p.track;
    this.el.classList.toggle('empty', !t);
    if (!t) return;
    this.el.classList.toggle('live', !!t.live);
    this.el.classList.toggle('buffering', !!p.buffering);
    this._setText(this.titleEl, t.title);
    this._setText(this.artistEl, t.artist);
    this._setText(this.albumEl, t.album);
    this._setArt(t.art);
    this.updateFlags();
    this.updateDevice();
    if (!metaOnly) {
      this.liked = null;
      if (this.mode === 'like') this._loadLiked();
      if (this.mode === 'rating') this.updateRating();
      if (this.mode === 'speed') this.updateSpeed();
      if (!this._modes().includes(this.mode)) this.setMode('progress', false);
    }
    if (this.mode === 'lyrics') this._loadLyrics();
    if (this.mode === 'art') this._paintBigArt();
    this.updateTime();
    this.later(() => this._marquee(), 1200);
  }

  updateFlags() {
    const s = this.app.store.settings;
    const t = this.app.player.track;
    const parts = [];
    if (t && !t.live && s.shuffle !== 'off') parts.push(svg(ICONS.shuffle, 'np-flag'));
    if (t && !t.live && s.repeat !== 'off') {
      const r = svg(ICONS.repeat, 'np-flag');
      if (s.repeat === 'one') r.append(h('b', { text: '1' }));
      parts.push(r);
    }
    this.flags.replaceChildren(...parts);
  }

  updateDevice() {
    const p = this.app.player;
    const name = p.source === 'spotify' && this.app.spotify ? this.app.spotify.deviceName : null;
    this.deviceEl.textContent = name ? `on ${name}` : '';
  }

  _setText(lineEl, text) {
    const span = lineEl.firstChild;
    if (span.textContent === (text || '')) return;
    span.textContent = text || '';
    span.classList.remove('marquee');
    this.later(() => this._marquee(), 1200);
  }

  _marquee() {
    for (const line of [this.titleEl, this.artistEl, this.albumEl]) {
      const span = line.firstChild;
      const overflow = span.scrollWidth - line.clientWidth;
      if (overflow > 2 && !span.classList.contains('marquee')) {
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
    const [show, hide] = this._artFlip ? [this.artA, this.artB] : [this.artB, this.artA];
    this._artFlip = !this._artFlip;
    if (url) {
      const img = new Image();
      img.onload = () => {
        if (this._artUrl !== url) return;
        show.style.backgroundImage = `url("${url}")`;
        show.classList.add('show');
        hide.classList.remove('show');
        if (this.mode === 'art') this._paintBigArt();
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
    const t = p.track;
    if (!t) {
      this.el.classList.add('empty');
      return;
    }
    const q = p.queueInfo;
    const count = t.live ? t.station?.country || 'Radio' : q ? `${q.index} of ${q.total}` : '';
    if (this.countEl.textContent !== count) this.countEl.textContent = count;
    if (t.live) {
      const secs = t.startedAt ? (Date.now() - t.startedAt) / 1000 : 0;
      this.elapsed.textContent = p.playing ? fmtTime(secs) : 'Paused';
      this.remain.textContent = t.station?.bitrate ? `${t.station.bitrate} kbps` : '';
      this.rateEl.textContent = '';
      return;
    }
    const dur = p.duration || 0;
    const pos = this._seekPos !== null ? this._seekPos : p.position;
    const pct = dur ? clamp(pos / dur, 0, 1) : 0;
    this.fill.style.width = `${pct * 100}%`;
    this.diamond.style.left = `${pct * 100}%`;
    this.elapsed.textContent = fmtTime(pos);
    const rate = p.rate;
    this.rateEl.textContent = rate !== 1 ? `${rate}×` : '';
    this.remain.textContent = dur ? fmtTime((dur - pos) / rate, { negative: true }) : '--:--';
    if (this.mode === 'lyrics') this._syncLyrics(pos);
  }

  updateVolume() {
    this.volFill.style.width = `${this.app.player.volume * 100}%`;
  }

  updateRating() {
    const r = this.app.player.rating;
    this.stars.forEach((s, i) => s.classList.toggle('on', i < r));
  }

  updateSpeed() {
    const r = this.app.player.rate;
    const i = SPEEDS.indexOf(r);
    this.speedFill.style.width = `${((i < 0 ? 2 : i) / (SPEEDS.length - 1)) * 100}%`;
    this.speedText.textContent = `${r}×`;
  }

  // -------------------------------------------------------------- modes --

  setMode(mode, user = true) {
    const prev = this.mode;
    this.mode = mode;
    this.el.dataset.mode = mode;
    if (mode === 'volume') this.updateVolume();
    if (mode === 'rating') this.updateRating();
    if (mode === 'speed') this.updateSpeed();
    if (mode === 'like') this._loadLiked();
    if (mode === 'lyrics') this._loadLyrics();
    if (mode === 'art') this._paintBigArt();
    if (mode === 'visualizer') this._startViz();
    else if (prev === 'visualizer') this._stopViz();
    if (user && MODE_LABEL[mode] && ['lyrics', 'visualizer', 'art'].includes(mode)) {
      this.modeTag.textContent = MODE_LABEL[mode];
      this.modeTag.classList.remove('show');
      void this.modeTag.offsetWidth;
      this.modeTag.classList.add('show');
    }
    if (this._modeTimer) this.clear(this._modeTimer);
    if (user && ['volume', 'scrub', 'rating', 'like', 'speed'].includes(mode)) {
      this._modeTimer = this.later(() => this.setMode('progress', false), mode === 'volume' ? 1800 : MODE_TIMEOUT);
    }
  }

  _modes() {
    const p = this.app.player;
    const t = p.track;
    const s = this.app.store.settings;
    if (!t) return ['progress'];
    const list = ['progress'];
    if (!t.live) list.push('scrub');
    if (t.source === 'local' && t.kind === 'music') list.push('rating');
    if ((t.kind === 'podcast' || t.kind === 'audiobook') && p.source === 'local') list.push('speed');
    if (t.source === 'spotify' && t.uri && t.uri.startsWith('spotify:track:')) list.push('like');
    if (s.lyrics && t.kind !== 'podcast') list.push('lyrics');
    if (s.visualizer && p.source === 'local') list.push('visualizer');
    if (t.art) list.push('art');
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
      case 'speed': {
        const cur = SPEEDS.indexOf(p.rate);
        const next = clamp((cur < 0 ? 2 : cur) + dir, 0, SPEEDS.length - 1);
        if (SPEEDS[next] === p.rate) return false;
        const t = p.track;
        this.app.store.set(t.kind === 'audiobook' ? 'audiobookSpeed' : 'podcastSpeed', SPEEDS[next]);
        this.updateSpeed();
        this.updateTime();
        this.setMode('speed');
        return true;
      }
      case 'lyrics': {
        const box = this.lyricsEl;
        const before = box.scrollTop;
        box.scrollTop += dir * 20;
        this._lyricsManual = performance.now();
        return box.scrollTop !== before;
      }
      default: {
        const v = clamp(Math.round((p.volume + dir * 0.03) * 100) / 100, 0, 1);
        if (this.mode === 'visualizer' || this.mode === 'art') this._flashVolume();
        else this.setMode('volume');
        if (v === p.volume) return false;
        p.setVolume(v);
        return true;
      }
    }
  }

  _flashVolume() {
    this.os.alert(`Volume ${Math.round(this.app.player.volume * 100)}%`, 500);
  }

  onMenu() {
    if (['lyrics', 'visualizer', 'art'].includes(this.mode)) {
      this.setMode('progress', false);
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------- liked --

  async _loadLiked() {
    this.likeText.textContent = '…';
    this.liked = await this.app.spotify.liked();
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

  // ------------------------------------------------------------- lyrics --

  async _loadLyrics() {
    const t = this.app.player.track;
    const key = t ? `${t.id}\u0000${t.title}` : null;
    if (key === this._lyricsFor) return;
    this._lyricsFor = key;
    this._lyrics = null;
    this.lyricsInner.replaceChildren();
    this.lyricsStatus.textContent = 'Looking for lyrics…';
    this.lyricsEl.scrollTop = 0;
    const res = t ? await this.app.lyrics.get(t) : null;
    if (key !== this._lyricsFor || !this.mounted) return;
    if (!res || (!res.synced && !res.plain)) {
      this.lyricsStatus.textContent = res && res.instrumental ? '♪ Instrumental ♪' : this.app.store.settings.lyricsOnline ? 'No lyrics found' : 'No lyrics';
      return;
    }
    this._lyrics = res;
    this.lyricsStatus.textContent = '';
    const lines = res.synced ? res.synced.map((l) => l.text || '♪') : res.plain.split(/\r?\n/);
    this.lyricsInner.replaceChildren(...lines.map((l) => h('p', { text: l || ' ' })), h('p', { class: 'np-lyrics-src', text: res.source ? `Lyrics: ${res.source}` : '' }));
    this.el.classList.toggle('synced', !!res.synced);
    this._lastLine = -2;
    this._syncLyrics(this.app.player.position);
  }

  _syncLyrics(pos) {
    const res = this._lyrics;
    if (!res || !res.synced) return;
    const idx = lineAt(res.synced, pos);
    if (idx === this._lastLine) return;
    this._lastLine = idx;
    const lines = this.lyricsInner.children;
    for (let i = 0; i < lines.length; i++) lines[i].classList.toggle('cur', i === idx);
    if (this._lyricsManual && performance.now() - this._lyricsManual < 4000) return;
    if (idx >= 0 && lines[idx]) {
      const line = lines[idx];
      this.lyricsEl.scrollTo({ top: line.offsetTop - this.lyricsEl.clientHeight / 2 + line.offsetHeight / 2, behavior: 'smooth' });
    }
  }

  // ---------------------------------------------------------- big art --

  _paintBigArt() {
    const t = this.app.player.track;
    if (!t) return;
    this.bigArt.firstChild.style.backgroundImage = t.art ? `url("${t.art}")` : '';
    this.bigArt.lastChild.replaceChildren(h('b', { text: t.title || '' }), h('span', { text: [t.artist, t.album].filter(Boolean).join(' — ') }));
  }

  // --------------------------------------------------------- visualizer --

  _startViz() {
    if (this._vizRaf) return;
    const scale = (window.devicePixelRatio || 1) * (this.app.device.zoom || 1);
    const W = this.el.clientWidth || 320;
    const H = this.el.clientHeight || 218;
    this.canvas.width = Math.round(W * scale);
    this.canvas.height = Math.round(H * scale);
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const bins = new Uint8Array(128);
    const bars = 32;
    const peaks = new Float32Array(bars);
    const levels = new Float32Array(bars);
    const draw = () => {
      if (!this.mounted || this.mode !== 'visualizer') {
        this._vizRaf = null;
        return;
      }
      const t = this.app.player.track;
      this.vizCaption.textContent = t ? `${t.title}${t.artist ? ` — ${t.artist}` : ''}` : '';
      const data = this.app.player.engine.spectrum(bins);
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#04070d');
      bg.addColorStop(1, '#0d1a2e');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const gap = 2;
      const bw = (W - 16 - gap * (bars - 1)) / bars;
      const base = H - 26;
      for (let i = 0; i < bars; i++) {
        // Log-spaced bins so bass doesn't take over.
        const a = Math.floor(Math.pow(i / bars, 1.6) * 100);
        const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / bars, 1.6) * 100));
        let v = 0;
        if (data) for (let k = a; k < b; k++) v = Math.max(v, data[k]);
        const target = (v / 255) * (base - 12);
        levels[i] += (target - levels[i]) * 0.45;
        peaks[i] = Math.max(peaks[i] - 0.9, levels[i]);
        const x = 8 + i * (bw + gap);
        const g = ctx.createLinearGradient(0, base - levels[i], 0, base);
        g.addColorStop(0, '#9fd2ff');
        g.addColorStop(0.5, '#3d8ef0');
        g.addColorStop(1, '#1b55c4');
        ctx.fillStyle = g;
        ctx.fillRect(x, base - levels[i], bw, levels[i]);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(x, base - peaks[i] - 3, bw, 2);
        ctx.fillStyle = 'rgba(80,150,255,0.18)';
        ctx.fillRect(x, base + 2, bw, levels[i] * 0.25);
      }
      this._vizRaf = requestAnimationFrame(draw);
    };
    this._vizRaf = requestAnimationFrame(draw);
  }

  _stopViz() {
    if (this._vizRaf) cancelAnimationFrame(this._vizRaf);
    this._vizRaf = null;
  }

  // ------------------------------------------------------------- options --

  onSelectHold() {
    const { player } = this.app;
    const t = player.track;
    if (!t) return;
    // Now Playing adds "Up Next" and quick toggles to the song's options.
    const extra = [
      { label: 'Up Next…', action: () => this.os.push(upNextView(this.app)) },
      ...(t.live
        ? []
        : [
            {
              label: `Shuffle: ${{ off: 'Off', songs: 'Songs', albums: 'Albums' }[this.app.store.settings.shuffle]}`,
              action: () => {
                const order = ['off', 'songs', 'albums'];
                player.setShuffle(order[(order.indexOf(this.app.store.settings.shuffle) + 1) % 3]);
              },
            },
            {
              label: `Repeat: ${{ off: 'Off', one: 'One', all: 'All' }[this.app.store.settings.repeat]}`,
              action: () => {
                const order = ['off', 'one', 'all'];
                player.setRepeat(order[(order.indexOf(this.app.store.settings.repeat) + 1) % 3]);
              },
            },
          ]),
    ];
    if (this.app.store.settings.holdSelect === 'otg' && t.source === 'local' && t.kind === 'music') {
      return songOptions(this.app, t);
    }
    showSheet(this.os, {
      title: t.title,
      items: [
        ...extra,
        { label: 'More Options…', action: () => setTimeout(() => songOptions(this.app, t), 200) },
      ],
    });
  }

  onEnter() {
    this.updateTrack();
  }
}
