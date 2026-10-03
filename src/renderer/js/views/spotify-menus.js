/** Spotify menus: Playlists, Liked Songs, Albums, Artists, Podcasts… */

import { ListView } from './list.js';
import { SearchView } from './search.js';
import { songOptions } from './options.js';
import { CoverFlowView } from './coverflow.js';
import { versionLine } from '../util.js';

export function createSpotifyMenus(app) {
  const api = app.spotifyApi;

  const trackItem = (tracks, t, context) => ({
    label: t.title,
    sortName: t.title,
    disabled: t.playable === false,
    value: t.explicit ? 'E' : '',
    explicit: !!t.explicit,
    icon: () => {
      const cur = app.player.track;
      return cur && cur.uri && cur.uri === t.uri ? 'speaker' : null;
    },
    action: () => {
      const i = tracks.indexOf(t);
      app.player.playTracks(tracks, Math.max(0, i), { context });
      app.nav.nowPlaying();
    },
    onHold: (_item, view) => songOptions(app, t, { view }),
  });

  /**
   * A song found by searching: art, and who / which album / which year
   * underneath, so one version can be told from another at a glance.
   * Choosing it plays just that song; then Spotify carries on as it would
   * itself (your queue, then songs like it), not with the other results.
   */
  const searchTrackItem = (t) => ({
    ...trackItem([t], t),
    thumb: t.art || '',
    sub: versionLine(t),
    value: t.explicit ? 'E' : '',
    explicit: t.explicit,
    action: () => {
      app.player.playTracks([t], 0, { single: true });
      app.nav.nowPlaying();
    },
  });

  /** A lazily-paged list of tracks sharing one queue array, with Shuffle at the top. */
  const tracksView = (title, fetchPage, { context, empty = 'No songs', fallback } = {}) => {
    const tracks = [];
    const shuffle = {
      label: 'Shuffle',
      icon: 'shuffle',
      arrow: false,
      action: () => {
        if (!tracks.length) return;
        app.player.playTracks(tracks, Math.floor(Math.random() * tracks.length), { context, shuffle: 'songs' });
        app.nav.nowPlaying();
      },
    };
    const add = (res, first) => {
      tracks.push(...res.items);
      const items = res.items.map((t) => trackItem(tracks, t, context));
      return { items: first && res.items.length > 1 ? [shuffle, ...items] : items, more: res.more };
    };
    return new ListView({
      title,
      empty,
      load: async () => {
        try {
          tracks.length = 0;
          return add(await fetchPage(0), true);
        } catch (err) {
          if (fallback && (err.status === 403 || err.status === 404)) return fallback(err);
          throw friendly(err);
        }
      },
      loadMore: async () => add(await fetchPage(tracks.length)),
    });
  };

  const friendly = (err) => {
    if (err.status === 401) return new Error('Spotify needs you to sign in again. Settings › Spotify.');
    if (err.status === 403) return new Error('Spotify didn’t allow this. Your account may need Premium.');
    if (err.status === 429) return new Error('Spotify is busy. Try again in a moment.');
    return new Error(err.message && err.message !== 'Failed to fetch' ? err.message : 'Couldn’t reach Spotify.');
  };

  const pagedList = (title, fetchPage, toItem, { empty = 'Nothing here yet', index = false } = {}) =>
    new ListView({
      title,
      empty,
      index,
      load: async () => {
        try {
          const res = await fetchPage(0);
          return { items: res.items.map(toItem), more: res.more };
        } catch (err) {
          throw friendly(err);
        }
      },
      loadMore: async (offset) => {
        const res = await fetchPage(offset);
        return { items: res.items.map(toItem), more: res.more };
      },
    });

  const playlistView = (pl) =>
    tracksView(pl.name, (offset) => api.playlistTracks(pl.id, offset), {
      context: { uri: pl.uri },
      empty: 'This playlist is empty',
      // Development-mode Spotify apps can only list playlists you own or collaborate on.
      fallback: () => [
        { label: 'Play Playlist', arrow: false, action: () => playContext(pl.uri) },
        { label: 'Shuffle Playlist', arrow: false, action: () => playContext(pl.uri, true) },
        { label: 'Songs are hidden by Spotify', disabled: true, arrow: false },
      ],
    });

  const playContext = async (uri, shuffle = false) => {
    app.player.engine.pause();
    app.player.source = 'spotify';
    if (shuffle !== app.spotify.shuffleState) await app.spotify.setShuffle(shuffle);
    app.spotify.list = null;
    await app.spotify.playContext(uri);
    app.player.emit('track');
    app.nav.nowPlaying();
  };

  const albumView = (al) =>
    tracksView(al.title, (offset) => api.albumTracks(al, offset), { context: { uri: al.uri }, empty: 'No songs' });

  const artistView = (ar) =>
    pagedList(ar.name, (offset) => api.artistAlbums(ar.id, offset), (al) => ({ label: al.title, view: () => albumView(al) }), {
      empty: 'No albums',
    });

  const showView = (show) =>
    tracksView(show.name, (offset) => api.showEpisodes(show, offset), { context: { uri: show.uri }, empty: 'No episodes' });

  const artistsView = () => {
    let after = null;
    const toItem = (ar) => ({ label: ar.name, sortName: ar.name, view: () => artistView(ar) });
    return new ListView({
      title: 'Artists',
      index: true,
      empty: 'Follow artists on Spotify to see them here.',
      load: async () => {
        try {
          const res = await api.followedArtists();
          after = res.after;
          return { items: res.items.map(toItem), more: res.more };
        } catch (err) {
          throw friendly(err);
        }
      },
      loadMore: async () => {
        const res = await api.followedArtists(after);
        after = res.after;
        return { items: res.items.map(toItem), more: res.more };
      },
    });
  };

  const notConnected = () =>
    new ListView({
      title: 'Spotify',
      refreshOnEnter: true,
      items: () => {
        const st = api.status || {};
        return [
          {
            label: st.configured ? 'Connect to Spotify' : 'Set Up Spotify…',
            arrow: false,
            action: () => {
              window.ipod.spotify.openSetup();
              app.os.alert('Finish setup in the Spotify window', 1800);
            },
          },
          { label: 'Play your Spotify library', disabled: true, arrow: false },
          { label: 'right here on your iPod.', disabled: true, arrow: false },
        ];
      },
    });

  const devicesView = () =>
    new ListView({
      title: 'Devices',
      empty: 'No devices. Open Spotify on this PC or your phone.',
      load: async () => {
        const items = [];
        const sdk = app.spotify.sdk;
        let devices = [];
        try {
          devices = await api.devices();
        } catch (err) {
          throw friendly(err);
        }
        if (sdk.ready && !devices.some((d) => d.id === sdk.deviceId)) devices.unshift({ id: sdk.deviceId, name: 'This iPod', is_active: false });
        for (const d of devices) {
          items.push({
            label: d.id === sdk.deviceId ? 'This iPod' : d.name,
            checked: () => !!d.is_active,
            arrow: false,
            disabled: d.is_restricted,
            action: async () => {
              try {
                await app.spotify.transferTo(d.id);
                devices.forEach((x) => (x.is_active = x === d));
                app.os.alert(`Playing on ${d.id === sdk.deviceId ? 'this iPod' : d.name}`);
              } catch (err) {
                app.os.alert(friendly(err).message);
              }
            },
          });
        }
        items.push({ label: 'Open Spotify App', arrow: false, action: () => window.ipod.spotify.openApp() });
        return items;
      },
    });

  return {
    root() {
      if (!api.connected) return notConnected();
      return new ListView({
        title: 'Spotify',
        split: true,
        items: [
          {
            label: 'Playlists',
            view: () => pagedList('Playlists', (o) => api.playlists(o), (pl) => ({ label: pl.name, view: () => playlistView(pl) }), { empty: 'No playlists' }),
          },
          { label: 'Liked Songs', view: () => tracksView('Liked Songs', (o) => api.liked(o), { empty: 'No liked songs yet' }) },
          {
            label: 'Albums',
            view: () => pagedList('Albums', (o) => api.savedAlbums(o), (al) => ({ label: al.title, sortName: al.title, view: () => albumView(al) }), { empty: 'No saved albums' }),
          },
          { label: 'Artists', view: () => artistsView() },
          {
            label: 'Podcasts',
            view: () => pagedList('Podcasts', (o) => api.shows(o), (s) => ({ label: s.name, view: () => showView(s) }), { empty: 'No saved podcasts' }),
          },
          {
            label: 'Recently Played',
            view: () => tracksView('Recently Played', async () => ({ items: await api.recentlyPlayed(), more: false }), { empty: 'Nothing played recently' }),
          },
          {
            label: 'Cover Flow',
            arrow: true,
            action: async () => {
              app.os.alert('Loading albums…', 900);
              try {
                app.os.push(await app.spotifyMenus.coverFlow());
              } catch (err) {
                app.os.alert(friendly(err).message);
              }
            },
          },
          { label: 'Search', view: () => spotifySearch() },
          { label: 'Devices', view: () => devicesView() },
        ],
      });
    },
    openAlbum(al) {
      app.os.push(albumView(al));
    },
    openArtist(ar) {
      app.os.push(artistView(ar));
    },
    devices: devicesView,
    /** Spotify results for the unified Music › Search. */
    async searchItems(q) {
      return searchResultItems(await api.search(q));
    },
    /** Cover Flow over your saved Spotify albums. */
    async coverFlow() {
      const all = [];
      let offset = 0;
      for (let i = 0; i < 8; i++) {
        const page = await api.savedAlbums(offset);
        all.push(...page.items);
        if (!page.more) break;
        offset += page.items.length;
      }
      return new CoverFlowView(app, {
        albums: all.map((al) => ({ ...al, spotify: true })),
        loadTracks: async (al) => {
          const out = [];
          let off = 0;
          for (let i = 0; i < 4; i++) {
            const page = await api.albumTracks(al, off);
            out.push(...page.items);
            if (!page.more) break;
            off += page.items.length;
          }
          return out;
        },
      });
    },
  };

  /** Search results as two-line rows with art: songs, then albums, artists and playlists. */
  function searchResultItems(r) {
    const items = [];
    for (const t of r.tracks) items.push(searchTrackItem(t));
    for (const al of r.albums) items.push({ label: al.title, thumb: al.art || '', sub: ['Album', al.artist, al.year].filter(Boolean).join(' · '), view: () => albumView(al) });
    for (const ar of r.artists) items.push({ label: ar.name, thumb: ar.art || '', sub: 'Artist', view: () => artistView(ar) });
    for (const pl of r.playlists) items.push({ label: pl.name, thumb: pl.art || '', sub: ['Playlist', pl.ownerName && `by ${pl.ownerName}`].filter(Boolean).join(' · '), view: () => playlistView(pl) });
    return items;
  }

  function spotifySearch() {
    return new SearchView(app, {
      title: 'Search',
      debounce: 380,
      thumbs: true,
      search: async (q) => searchResultItems(await api.search(q)),
    });
  }
}
