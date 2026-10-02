/** Main menu and the local Music library menus, following the 5th gen iPod. */

import { ListView } from './list.js';
import { NowPlayingView } from './nowplaying.js';
import { showSheet } from './sheet.js';
import { shuffled } from '../util.js';

/** Navigation helpers shared by every screen (attached to app.nav). */
export function createNav(app) {
  const push = (v) => app.os.push(v);
  return {
    nowPlaying() {
      if (app.os.current instanceof NowPlayingView) return;
      if (app.os.modal) app.os.closeModal();
      push(new NowPlayingView(app));
    },
    album(album) {
      push(songsView(app, album.title, album.tracks));
    },
    artist(name) {
      const artist = app.library.artists.find((a) => a.name === name);
      if (artist) push(artistView(app, artist));
    },
    spotifyAlbum(album) {
      app.spotifyMenus.openAlbum(album);
    },
  };
}

export function trackItems(app, tracks, { context, showArtist = false } = {}) {
  return tracks.map((t, i) => ({
    label: t.title,
    sub: showArtist ? t.artist : undefined,
    sortName: t.title,
    disabled: t.playable === false,
    icon: () => {
      const cur = app.player.track;
      return cur && (cur.id === t.id || (t.uri && cur.uri === t.uri)) ? 'speaker' : null;
    },
    action: () => {
      app.player.playTracks(tracks, i, { context });
      app.nav.nowPlaying();
    },
    onHold: (_item, view) => trackHold(app, t, view),
  }));
}

/** Hold the centre button on a song: On-The-Go (local) or options (Spotify). */
export function trackHold(app, t, view) {
  if (t.source === 'local') {
    app.player.addToOnTheGo(t);
    if (view && view.flashSelected) view.flashSelected();
    app.os.alert('Added to On-The-Go', 1100);
    return;
  }
  showSheet(app.os, {
    title: t.title,
    items: [
      {
        label: 'Add to Liked Songs',
        action: async () => {
          try {
            await app.spotifyApi.setLiked(t.uri, true);
            app.os.alert('Added to Liked Songs');
          } catch {
            app.os.alert('Couldn’t update Liked Songs.');
          }
        },
      },
      ...(t.albumId
        ? [{ label: 'Browse Album', action: () => app.nav.spotifyAlbum({ id: t.albumId, uri: t.albumUri, title: t.album, artist: t.albumArtist, art: t.art }) }]
        : []),
    ],
  });
}

export function songsView(app, title, tracks, opts = {}) {
  return new ListView({
    title,
    index: tracks.length > 30,
    empty: opts.empty || 'No songs',
    items: () => trackItems(app, tracks, opts),
  });
}

// ------------------------------------------------------------------ main --

export class MainMenu extends ListView {
  constructor(app) {
    super({ title: 'iPod', items: () => mainItems(app) });
    this.app = app;
  }

  onEnter() {
    this.refresh();
  }

  render() {
    super.render();
    this.listen(this.app.player, 'track', () => this.refresh());
    this.listen(this.app.store, 'change:mainMenu', () => this.refresh());
    this.listen(this.app.spotifyApi, 'status', () => this.refresh());
  }

  /** Menu does nothing on the main menu. */
  onMenu() {
    return true;
  }
}

function mainItems(app) {
  const m = app.store.settings.mainMenu;
  const items = [];
  if (m.music) items.push({ label: 'Music', view: () => musicMenu(app) });
  if (m.spotify && app.store.settings.spotifyEnabled) items.push({ label: 'Spotify', view: () => app.spotifyMenus.root() });
  if (m.photos) items.push({ label: 'Photos', view: () => app.media.photosMenu() });
  if (m.videos) items.push({ label: 'Videos', view: () => app.media.videosMenu() });
  if (m.podcasts) items.push({ label: 'Podcasts', view: () => podcastsView(app) });
  if (m.extras) items.push({ label: 'Extras', view: () => app.extras.menu() });
  if (m.games) items.push({ label: 'Games', view: () => app.extras.games() });
  if (m.clock) items.push({ label: 'Clock', view: () => app.extras.clock() });
  if (m.settings !== false) items.push({ label: 'Settings', view: () => app.settingsMenu() });
  if (m.shuffle) items.push({ label: 'Shuffle Songs', arrow: false, action: () => shuffleSongs(app) });
  if (app.player.track) items.push({ label: 'Now Playing', arrow: true, action: () => app.nav.nowPlaying() });
  return items;
}

export async function shuffleSongs(app) {
  const music = app.library.music;
  if (music.length) {
    const i = Math.floor(Math.random() * music.length);
    app.player.playTracks(music, i, { shuffle: 'songs' });
    app.nav.nowPlaying();
    return;
  }
  if (app.spotifyApi.connected) {
    try {
      app.os.alert('Shuffling Liked Songs…', 1200);
      let all = [];
      let page = await app.spotifyApi.liked(0);
      all = all.concat(page.items);
      if (page.more) {
        page = await app.spotifyApi.liked(all.length);
        all = all.concat(page.items);
      }
      if (all.length) {
        const list = shuffled(all);
        app.player.playTracks(list, 0, { shuffle: 'songs' });
        app.nav.nowPlaying();
        return;
      }
    } catch (err) {
      app.os.alert(err.message || 'Couldn’t reach Spotify.');
      return;
    }
  }
  app.os.alert('No songs yet. Add a music folder in Settings › Music Library.', 2600);
}

// ----------------------------------------------------------------- music --

export function musicMenu(app) {
  const view = new ListView({
    title: 'Music',
    items: () => {
      const m = app.store.settings.musicMenu;
      const lib = app.library;
      const items = [];
      if (m.playlists) items.push({ label: 'Playlists', view: () => playlistsView(app) });
      if (m.artists) items.push({ label: 'Artists', view: () => artistsView(app) });
      if (m.albums) items.push({ label: 'Albums', view: () => albumsView(app, 'Albums', lib.albums) });
      if (m.compilations && lib.compilations.length) items.push({ label: 'Compilations', view: () => albumsView(app, 'Compilations', lib.compilations) });
      if (m.songs) items.push({ label: 'Songs', view: () => songsView(app, 'Songs', lib.music, { empty: emptyText(app) }) });
      if (m.podcasts) items.push({ label: 'Podcasts', view: () => podcastsView(app) });
      if (m.genres) items.push({ label: 'Genres', view: () => genresView(app) });
      if (m.composers) items.push({ label: 'Composers', view: () => composersView(app) });
      if (m.audiobooks) items.push({ label: 'Audiobooks', view: () => audiobooksView(app) });
      if (m.search) items.push({ label: 'Search', view: () => app.search() });
      return items;
    },
  });
  return view;
}

function emptyText(app) {
  if (app.library.scanning) return 'Updating Library…';
  return 'No songs. Add a music folder in Settings › Music Library.';
}

export function playlistsView(app) {
  return new ListView({
    title: 'Playlists',
    refreshOnEnter: true,
    items: () => {
      const lib = app.library;
      const items = lib.smartPlaylists().map((pl) => ({
        label: pl.name,
        view: () => songsView(app, pl.name, pl.tracks, { empty: 'No songs' }),
      }));
      for (const pl of lib.fileplaylists()) items.push({ label: pl.name, view: () => songsView(app, pl.name, pl.tracks) });
      items.push({ label: 'On-The-Go', view: () => onTheGoView(app) });
      return items;
    },
  });
}

function onTheGoView(app) {
  const view = new ListView({
    title: 'On-The-Go',
    refreshOnEnter: true,
    empty: 'Hold the centre button on any song to add it here.',
    items: () => {
      const tracks = app.library.otgTracks();
      if (!tracks.length) return [];
      return [
        ...trackItems(app, tracks),
        {
          label: 'Clear Playlist',
          view: () =>
            new ListView({
              title: 'Clear',
              items: [
                { label: 'Cancel', action: () => app.os.pop() },
                {
                  label: 'Clear Playlist',
                  action: () => {
                    app.store.user.otg = [];
                    app.store.touchUser();
                    app.os.pop();
                  },
                },
              ],
            }),
        },
      ];
    },
  });
  return view;
}

export function artistsView(app, artists = app.library.artists, title = 'Artists') {
  return new ListView({
    title,
    index: true,
    empty: emptyText(app),
    items: () => {
      const items = artists.map((a) => ({ label: a.name, sortName: a.name, view: () => artistView(app, a) }));
      if (items.length > 1) {
        const all = artists.flatMap((a) => a.tracks);
        items.unshift({ label: 'All', sortName: ' ', view: () => songsView(app, title, uniqueTracks(all)) });
      }
      return items;
    },
  });
}

export function artistView(app, artist) {
  return new ListView({
    title: artist.name,
    items: () => {
      const items = artist.albums.map((al) => ({
        label: al.title,
        view: () => songsView(app, al.title, al.tracks.filter((t) => artist.tracks.includes(t))),
      }));
      if (items.length > 1) items.unshift({ label: 'All', view: () => songsView(app, artist.name, artist.albums.flatMap((al) => al.tracks.filter((t) => artist.tracks.includes(t)))) });
      return items;
    },
  });
}

export function albumsView(app, title, albums) {
  return new ListView({
    title,
    index: true,
    empty: emptyText(app),
    items: () => albums.map((al) => ({ label: al.title, sortName: al.title, view: () => songsView(app, al.title, al.tracks) })),
  });
}

function genresView(app) {
  return new ListView({
    title: 'Genres',
    index: true,
    empty: 'No genres',
    items: () =>
      app.library.genres.map((g) => ({
        label: g.name,
        sortName: g.name,
        view: () => {
          const byArtist = new Map();
          for (const t of g.tracks) {
            if (!byArtist.has(t.artist)) byArtist.set(t.artist, { name: t.artist, tracks: [], albums: new Set() });
            byArtist.get(t.artist).tracks.push(t);
          }
          const artists = [...byArtist.values()].map((a) => {
            const albums = app.library.albums.filter((al) => al.tracks.some((t) => a.tracks.includes(t)));
            return { ...a, albums };
          });
          artists.sort((a, b) => a.name.localeCompare(b.name));
          return artistsView(app, artists, g.name);
        },
      })),
  });
}

function composersView(app) {
  return new ListView({
    title: 'Composers',
    index: true,
    empty: 'No composers',
    items: () => app.library.composers.map((c) => ({ label: c.name, sortName: c.name, view: () => songsView(app, c.name, c.tracks) })),
  });
}

export function podcastsView(app) {
  return new ListView({
    title: 'Podcasts',
    empty: 'No podcasts',
    items: () =>
      app.library.shows.map((s) => ({
        label: s.name,
        view: () => songsView(app, s.name, s.episodes),
      })),
  });
}

function audiobooksView(app) {
  return new ListView({
    title: 'Audiobooks',
    empty: 'No audiobooks',
    items: () => {
      const books = new Map();
      for (const t of app.library.audiobooks) {
        if (!books.has(t.album)) books.set(t.album, []);
        books.get(t.album).push(t);
      }
      return [...books.entries()].map(([name, tracks]) =>
        tracks.length === 1
          ? { label: name, action: () => (app.player.playTracks(tracks, 0), app.nav.nowPlaying()) }
          : { label: name, view: () => songsView(app, name, tracks) }
      );
    },
  });
}

function uniqueTracks(list) {
  return [...new Set(list)];
}
