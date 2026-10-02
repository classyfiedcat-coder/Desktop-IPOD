/** Podcasts: subscriptions, downloads, top charts, search, add by URL, OPML. */

import { ListView } from './list.js';
import { SearchView } from './search.js';
import { songOptions } from './options.js';
import { askText } from './textinput.js';
import { songsView } from './menus.js';

export function createPodcastMenus(app) {
  const pods = app.podcasts;
  const played = (id) => !!app.store.user.played[id];

  const fmtDate = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    const days = (Date.now() - ms) / 86400000;
    if (days < 6.5) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(days > 330 ? { year: '2-digit' } : {}) });
  };

  const episodeItems = (tracks, view) =>
    tracks.map((t, i) => ({
      label: t.title,
      value: () => {
        const p = pods.progress[t.episode.id];
        if (p && p.total) return `${Math.round((p.got / p.total) * 100)}%`;
        if (p) return '↓';
        return (pods.isDownloaded(t.episode) ? '✓ ' : '') + fmtDate(t.date);
      },
      dot: () => !played(t.id),
      arrow: false,
      icon: () => (app.player.track && app.player.track.id === t.id ? 'speaker' : null),
      action: () => {
        // Rebuild so freshly downloaded episodes play from disk.
        const fresh = tracks.map((x) => pods.track({ title: x.album, author: x.artist, feedUrl: x.feedUrl, art: x.episode.art }, x.episode));
        app.player.playTracks(fresh, i);
        app.nav.nowPlaying();
      },
      onHold: () => songOptions(app, pods.track({ title: t.album, author: t.artist, feedUrl: t.feedUrl }, t.episode), { view }),
    }));

  /** A show you're subscribed to. */
  const showView = (sub) => {
    const view = new ListView({
      title: sub.title,
      empty: 'No episodes',
      refreshOnEnter: true,
      items: () => {
        const tracks = pods.tracks(sub, pods.episodes(sub.feedUrl));
        return [
          ...episodeItems(tracks, view),
          {
            label: 'Refresh',
            arrow: false,
            action: async () => {
              app.os.alert('Checking for new episodes…', 900);
              try {
                const n = await pods.refresh(sub);
                app.os.alert(n ? `${n} new episode${n === 1 ? '' : 's'}` : 'No new episodes', 1200);
                view.refresh();
              } catch (err) {
                app.os.alert(err.message || 'Couldn’t refresh');
              }
            },
          },
          {
            label: 'Mark All as Played',
            arrow: false,
            action: () => {
              for (const t of tracks) app.store.user.played[t.id] = app.store.user.played[t.id] || Date.now();
              app.store.touchUser('played');
              view.refresh();
            },
          },
          {
            label: 'Unsubscribe',
            arrow: false,
            action: () => {
              pods.unsubscribe(sub.feedUrl);
              app.os.pop();
              app.os.alert(`Unsubscribed from ${sub.title}`, 1400);
            },
          },
        ];
      },
    });
    const off = pods.on('download', () => view.mounted && view.paint());
    const destroy = view.destroy.bind(view);
    view.destroy = () => {
      off();
      destroy();
    };
    return view;
  };

  /** A show from search or the charts (not subscribed yet). */
  const previewView = (result) =>
    new ListView({
      title: result.title,
      empty: 'No episodes',
      load: async () => {
        const existing = pods.sub(result.feedUrl);
        if (existing) return showView(existing).o.items();
        const show = await pods.fetch(result.feedUrl);
        const tracks = pods.tracks(show, show.episodes.slice(0, 100));
        return [
          {
            label: 'Subscribe',
            arrow: false,
            icon: 'check',
            action: async () => {
              try {
                await pods.subscribe(result.feedUrl);
                app.os.alert(`Subscribed to ${show.title}`, 1400);
              } catch (err) {
                app.os.alert(err.message || 'Couldn’t subscribe');
              }
            },
          },
          ...(show.author ? [{ label: show.author, disabled: true, arrow: false }] : []),
          ...episodeItems(tracks),
        ];
      },
    });

  const resultItems = (results) => results.map((r) => ({ label: r.title, value: pods.sub(r.feedUrl) ? '✓' : '', sortName: r.title, view: () => previewView(r) }));

  const addByUrl = async () => {
    const url = await askText(app, {
      title: 'Add Podcast',
      prompt: 'Paste or type the feed address',
      keys: 'url',
      value: 'https://',
      working: 'Fetching feed…',
      validate: async (v) => {
        if (!/^https?:\/\/\S+\.\S+/.test(v)) return 'That isn’t a web address.';
        try {
          await pods.subscribe(v);
          return null;
        } catch (err) {
          return err.message || 'Couldn’t load that feed.';
        }
      },
    });
    if (url) app.os.alert('Subscribed', 1200);
  };

  return {
    root() {
      const view = new ListView({
        title: 'Podcasts',
        refreshOnEnter: true,
        items: () => {
          const items = [];
          const subs = pods.subs.slice().sort((a, b) => (b.latest || 0) - (a.latest || 0));
          if (subs.length) items.push({ label: 'Subscriptions', header: true });
          for (const s of subs) {
            const n = pods.unplayed(s);
            items.push({ label: s.title, value: n ? String(n) : '', dot: n > 0, view: () => showView(s) });
          }
          const downloaded = pods.downloadedEpisodes();
          const local = app.library.shows;
          items.push({ label: 'More', header: true });
          if (downloaded.length) items.push({ label: 'Downloaded', value: String(downloaded.length), view: () => new ListView({ title: 'Downloaded', items: () => episodeItems(pods.downloadedEpisodes()) }) });
          if (local.length) items.push({ label: 'On This Computer', view: () => new ListView({ title: 'On This Computer', items: () => local.map((s) => ({ label: s.name, view: () => songsView(app, s.name, s.episodes) })) }) });
          items.push({ label: 'Top Podcasts', view: () => new ListView({ title: 'Top Podcasts', load: async () => resultItems(await pods.top(app.radio.localCountry())) }) });
          items.push({ label: 'Search Podcasts', view: () => new SearchView(app, { title: 'Search Podcasts', debounce: 500, search: async (q) => resultItems(await pods.search(q)) }) });
          items.push({ label: 'Add by Address…', arrow: false, action: addByUrl });
          if (subs.length) {
            items.push({
              label: 'Refresh All',
              arrow: false,
              action: async () => {
                app.os.alert('Checking for new episodes…', 1000);
                const n = await pods.refreshAll();
                app.os.alert(n ? `${n} new episode${n === 1 ? '' : 's'}` : 'No new episodes', 1400);
                view.refresh();
              },
            });
          }
          items.push({
            label: 'Import OPML…',
            arrow: false,
            action: async () => {
              const r = await pods.importOpml();
              if (r) app.os.alert(`Added ${r.added} of ${r.found} podcasts`, 1600);
              view.refresh();
            },
          });
          if (subs.length) items.push({ label: 'Export OPML…', arrow: false, action: () => pods.exportOpml() });
          return items;
        },
      });
      return view;
    },
    showView,
  };
}
