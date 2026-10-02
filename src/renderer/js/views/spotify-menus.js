/** Spotify menus: Playlists, Liked Songs, Albums, Artists, Podcasts… */

import { ListView } from './list.js';
import { trackHold } from './menus.js';
import { SearchView } from './search.js';

export function createSpotifyMenus(app) {
  const api = app.spotifyApi;

  const trackItem = (tracks, t, context) => ({
    label: t.title,
    sortName: t.title,
    disabled: t.playable === false,
    icon: () => {
      const cur = app.player.track;
      return cur && cur.uri && cur.uri === t.uri ? 'speaker' : null;
    },
    action: () => {
      const i = tracks.indexOf(t);
      app.player.playTracks(tracks, Math.max(0, i), { context });
      app.nav.nowPlaying();
    },
    onHold: (_item, view) => trackHold(app, t, view),
  });

  /** A lazily-paged list of tracks sharing one queue array. */
  const tracksView = (title, fetchPage, { context, empty = 'No songs', fallback } = {}) => {
    const tracks = [];
    const add = (res) => {
      tracks.push(...res.items);
      return { items: res.items.map((t) => trackItem(tracks, t, context)), more: res.more };
    };
    return new ListView({
      title,
      empty,
      load: async () => {
        try {
          tracks.length = 0;
          return add(await fetchPage(0));
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
    app.player.local.pause();
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
          { label: 'Search', view: () => spotifySearch() },
          { label: 'Devices', view: () => devicesView() },
        ],
      });
    },
    openAlbum(al) {
      app.os.push(albumView(al));
    },
    devices: devicesView,
  };

  function spotifySearch() {
    return new SearchView(app, {
      title: 'Search',
      debounce: 380,
      search: async (q) => {
        const r = await api.search(q);
        const items = [];
        const tracks = r.tracks;
        for (const t of tracks) items.push({ ...trackItem(tracks, t), sub: t.artist, value: 'Song' });
        for (const al of r.albums) items.push({ label: al.title, sub: al.artist, view: () => albumView(al), value: 'Album' });
        for (const ar of r.artists) items.push({ label: ar.name, view: () => artistView(ar), value: 'Artist' });
        for (const pl of r.playlists) items.push({ label: pl.name, view: () => playlistView(pl), value: 'Playlist' });
        return items;
      },
    });
  }
}
