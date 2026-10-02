/**
 * Podcast subscriptions: search (iTunes directory), top charts, RSS feeds,
 * episode downloads, played state and resume positions.
 */

import { Emitter } from '../util.js';

const EP_CACHE = (feedUrl) => `podcast-episodes:${feedUrl}`;
const MAX_EPISODES = 200;
const REFRESH_EVERY = 6 * 3600 * 1000;
const enc = encodeURIComponent;

export const proxied = (url) => (url && /^https?:/.test(url) ? `app://ipod/media/img?u=${enc(url)}` : null);

export class PodcastService extends Emitter {
  constructor(store) {
    super();
    this.store = store;
    this.downloads = {};
    this.progress = {};
    if (window.ipod && window.ipod.podcasts) {
      window.ipod.podcasts.onProgress((p) => {
        this.progress[p.id] = p;
        if (p.done) {
          this.downloads[p.id] = { done: true, size: p.total };
          delete this.progress[p.id];
        }
        if (p.error) delete this.progress[p.id];
        this.emit('download', p);
      });
    }
  }

  async init() {
    try {
      this.downloads = await window.ipod.podcasts.downloads();
    } catch {
      this.downloads = {};
    }
    const stale = this.subs.filter((s) => Date.now() - (s.refreshedAt || 0) > REFRESH_EVERY);
    if (stale.length) setTimeout(() => this.refreshAll().catch(() => {}), 15000);
  }

  get subs() {
    return this.store.user.podcasts;
  }

  sub(feedUrl) {
    return this.subs.find((s) => s.feedUrl === feedUrl) || null;
  }

  // ------------------------------------------------------------ directory --

  async search(term) {
    const res = await window.ipod.net.json(`https://itunes.apple.com/search?media=podcast&limit=25&term=${enc(term)}`);
    return (res.results || [])
      .filter((r) => r.feedUrl)
      .map((r) => ({ feedUrl: r.feedUrl, title: r.collectionName || r.trackName, author: r.artistName || '', art: r.artworkUrl600 || r.artworkUrl100 || null, genre: r.primaryGenreName || '' }));
  }

  async top(country = 'us') {
    const chart = await window.ipod.net.json(`https://rss.applemarketingtools.com/api/v2/${enc(country.toLowerCase())}/podcasts/top/30/podcasts.json`);
    const items = (chart.feed && chart.feed.results) || [];
    if (!items.length) return [];
    const look = await window.ipod.net.json(`https://itunes.apple.com/lookup?id=${items.map((i) => i.id).join(',')}`);
    const feeds = new Map((look.results || []).map((r) => [String(r.collectionId), r]));
    return items
      .map((i) => {
        const r = feeds.get(String(i.id));
        return r && r.feedUrl ? { feedUrl: r.feedUrl, title: i.name, author: i.artistName, art: r.artworkUrl600 || i.artworkUrl100, genre: (i.genres && i.genres[0] && i.genres[0].name) || '' } : null;
      })
      .filter(Boolean);
  }

  // -------------------------------------------------------------- feeds --

  async fetch(feedUrl) {
    return window.ipod.podcasts.feed(feedUrl);
  }

  episodes(feedUrl) {
    try {
      return JSON.parse(localStorage.getItem(EP_CACHE(feedUrl)) || '[]');
    } catch {
      return [];
    }
  }

  _storeEpisodes(feedUrl, episodes) {
    const slim = episodes.slice(0, MAX_EPISODES).map((e) => ({ ...e, description: (e.description || '').slice(0, 1500) }));
    try {
      localStorage.setItem(EP_CACHE(feedUrl), JSON.stringify(slim));
    } catch {
      try {
        localStorage.setItem(EP_CACHE(feedUrl), JSON.stringify(slim.slice(0, 30).map((e) => ({ ...e, description: '' }))));
      } catch {
        /* storage full */
      }
    }
  }

  async subscribe(feedUrl) {
    if (this.sub(feedUrl)) return this.sub(feedUrl);
    const show = await this.fetch(feedUrl);
    const sub = { feedUrl, title: show.title, author: show.author, art: show.art, description: show.description.slice(0, 600), addedAt: Date.now(), refreshedAt: Date.now(), latest: show.episodes[0] ? show.episodes[0].date : 0 };
    this._storeEpisodes(feedUrl, show.episodes);
    // Only the newest episode starts unplayed, like iTunes.
    for (const ep of show.episodes.slice(1)) this.store.user.played[`pod:${ep.id}`] = this.store.user.played[`pod:${ep.id}`] || 1;
    this.store.user.podcasts.push(sub);
    this.store.touchUser('podcasts');
    this.emit('change');
    return sub;
  }

  unsubscribe(feedUrl) {
    this.store.user.podcasts = this.subs.filter((s) => s.feedUrl !== feedUrl);
    try {
      localStorage.removeItem(EP_CACHE(feedUrl));
    } catch {
      /* ignore */
    }
    this.store.touchUser('podcasts');
    this.emit('change');
  }

  async refresh(sub) {
    const show = await this.fetch(sub.feedUrl);
    const known = new Set(this.episodes(sub.feedUrl).map((e) => e.id));
    const fresh = show.episodes.filter((e) => !known.has(e.id));
    this._storeEpisodes(sub.feedUrl, show.episodes);
    Object.assign(sub, { title: show.title, author: show.author, art: show.art || sub.art, refreshedAt: Date.now(), latest: show.episodes[0] ? show.episodes[0].date : sub.latest });
    this.store.touchUser('podcasts');
    return fresh.length;
  }

  async refreshAll(onProgress = () => {}) {
    let added = 0;
    const subs = this.subs.slice();
    for (let i = 0; i < subs.length; i++) {
      onProgress({ done: i, total: subs.length, title: subs[i].title });
      try {
        added += await this.refresh(subs[i]);
      } catch (err) {
        console.warn('podcast refresh failed', subs[i].feedUrl, err);
      }
    }
    this.emit('change');
    return added;
  }

  // ------------------------------------------------------------- tracks --

  isDownloaded(ep) {
    return !!(this.downloads[ep.id] && this.downloads[ep.id].done);
  }

  track(show, ep) {
    const downloaded = this.isDownloaded(ep);
    return {
      id: `pod:${ep.id}`,
      source: 'podcast',
      kind: 'podcast',
      title: ep.title,
      artist: show.author || show.title,
      album: show.title,
      albumArtist: show.title,
      art: proxied(ep.art || show.art),
      duration: ep.duration || 0,
      date: ep.date,
      episode: ep,
      feedUrl: show.feedUrl,
      downloaded,
      src: downloaded ? `app://ipod/media/download/${ep.id}` : `app://ipod/media/remote?u=${enc(ep.url)}`,
    };
  }

  tracks(show, episodes) {
    return episodes.map((ep) => this.track(show, ep));
  }

  unplayed(sub) {
    const played = this.store.user.played;
    return this.episodes(sub.feedUrl).filter((e) => !played[`pod:${e.id}`]).length;
  }

  async download(ep) {
    this.progress[ep.id] = { id: ep.id, got: 0, total: ep.size || 0 };
    this.emit('download', this.progress[ep.id]);
    return window.ipod.podcasts.download({ id: ep.id, url: ep.url, title: ep.title, size: ep.size });
  }

  async removeDownload(ep) {
    await window.ipod.podcasts.remove(ep.id);
    delete this.downloads[ep.id];
    this.emit('download', { id: ep.id, removed: true });
  }

  downloadedEpisodes() {
    const out = [];
    for (const sub of this.subs) for (const ep of this.episodes(sub.feedUrl)) if (this.isDownloaded(ep)) out.push(this.track(sub, ep));
    return out.sort((a, b) => (b.date || 0) - (a.date || 0));
  }

  // --------------------------------------------------------------- OPML --

  async importOpml() {
    const list = await window.ipod.podcasts.importOpml();
    if (!list) return null;
    let added = 0;
    for (const item of list) {
      if (this.sub(item.feedUrl)) continue;
      try {
        await this.subscribe(item.feedUrl);
        added++;
      } catch (err) {
        console.warn('OPML subscribe failed', item.feedUrl, err);
      }
    }
    return { found: list.length, added };
  }

  exportOpml() {
    return window.ipod.podcasts.exportOpml(this.subs.map((s) => ({ title: s.title, feedUrl: s.feedUrl })));
  }
}
