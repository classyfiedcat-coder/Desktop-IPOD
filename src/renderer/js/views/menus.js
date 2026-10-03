/** Main menu and the Music library menus, following the 5th gen iPod. */

import { ListView } from './list.js';
import { NowPlayingView } from './nowplaying.js';
import { CoverFlowView } from './coverflow.js';
import { songOptions, playlistPicker } from './options.js';
import { showSheet } from './sheet.js';
import { askText } from './textinput.js';
import { confirmView } from './common.js';
import { upNextView } from './upnext.js';
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
    upNext() {
      push(upNextView(app));
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
    spotifyArtist(artist) {
      app.spotifyMenus.openArtist(artist);
    },
    coverFlow(albums) {
      push(new CoverFlowView(app, albums ? { albums } : {}));
    },
  };
}

const playingIcon = (app, t) => () => {
  const cur = app.player.track;
  return cur && (cur.id === t.id || (t.uri && cur.uri === t.uri)) ? 'speaker' : null;
};

export function trackItems(app, tracks, { context, playlist } = {}) {
  return tracks.map((t, i) => ({
    label: t.title,
    sortName: t.title,
    disabled: t.playable === false,
    icon: playingIcon(app, t),
    action: () => {
      app.player.playTracks(tracks, i, { context });
      app.nav.nowPlaying();
    },
    onHold: (_item, view) => songOptions(app, t, { view, playlist: playlist ? { id: playlist.id, index: i } : null }),
  }));
}

/** Kept for older call sites. */
export function trackHold(app, t, view) {
  songOptions(app, t, { view });
}

export function songsView(app, title, tracks, opts = {}) {
  return new ListView({
    title,
    index: tracks.length > 30,
    empty: opts.empty || 'No songs',
    refreshOnEnter: !!opts.refresh,
    items: () => {
      const list = typeof tracks === 'function' ? tracks() : tracks;
      return trackItems(app, list, opts);
    },
  });
}

// ------------------------------------------------------------------ main --

export class MainMenu extends ListView {
  constructor(app) {
    super({ title: 'iPod', split: true, items: () => mainItems(app) });
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
  if (m.coverflow) items.push({ label: 'Cover Flow', arrow: true, action: () => app.nav.coverFlow() });
  if (m.spotify && app.store.settings.spotifyEnabled) items.push({ label: 'Spotify', view: () => app.spotifyMenus.root() });
  if (m.radio) items.push({ label: 'Radio', view: () => app.radioMenus.root() });
  if (m.podcasts) items.push({ label: 'Podcasts', view: () => app.podcastMenus.root() });
  if (m.photos) items.push({ label: 'Photos', view: () => app.media.photosMenu() });
  if (m.videos) items.push({ label: 'Videos', view: () => app.media.videosMenu() });
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
    app.player.playTracks(music, Math.floor(Math.random() * music.length), { shuffle: 'songs' });
    app.nav.nowPlaying();
    return;
  }
  if (app.spotifyApi.connected) {
    try {
      app.os.alert('Shuffling Liked Songs…', 1200);
      let all = [];
      for (let i = 0; i < 4; i++) {
        const page = await app.spotifyApi.liked(all.length);
        all = all.concat(page.items);
        if (!page.more) break;
      }
      if (all.length) {
        app.player.playTracks(shuffled(all), 0, { shuffle: 'songs' });
        app.nav.nowPlaying();
        return;
      }
    } catch (err) {
      app.os.alert(err.message || 'Couldn’t reach Spotify.');
      return;
    }
  }
  app.os.alert('No songs yet. Drop a music folder here, or add one in Settings › Music Library.', 3000);
}

// ----------------------------------------------------------------- music --

export function musicMenu(app) {
  return new ListView({
    title: 'Music',
    split: true,
    items: () => {
      const m = app.store.settings.musicMenu;
      const lib = app.library;
      const items = [];
      if (m.coverflow) items.push({ label: 'Cover Flow', arrow: true, action: () => app.nav.coverFlow() });
      if (m.playlists) items.push({ label: 'Playlists', view: () => playlistsView(app) });
      if (m.artists) items.push({ label: 'Artists', view: () => artistsView(app) });
      if (m.albums) items.push({ label: 'Albums', view: () => albumsView(app, 'Albums', lib.albums) });
      if (m.compilations && lib.compilations.length) items.push({ label: 'Compilations', view: () => albumsView(app, 'Compilations', lib.compilations) });
      if (m.songs) items.push({ label: 'Songs', view: () => songsView(app, 'Songs', lib.music, { empty: emptyText(app) }) });
      if (m.podcasts) items.push({ label: 'Podcasts', view: () => app.podcastMenus.root() });
      if (m.genres) items.push({ label: 'Genres', view: () => genresView(app) });
      if (m.composers) items.push({ label: 'Composers', view: () => composersView(app) });
      if (m.audiobooks) items.push({ label: 'Audiobooks', view: () => audiobooksView(app) });
      if (m.search) items.push({ label: 'Search', view: () => app.search() });
      return items;
    },
  });
}

function emptyText(app) {
  if (app.library.scanning) return 'Updating Library…';
  return 'No songs. Drop a music folder here, or add one in Settings › Music Library.';
}

// ------------------------------------------------------------- playlists --

export function playlistsView(app) {
  const view = new ListView({
    title: 'Playlists',
    refreshOnEnter: true,
    items: () => {
      const lib = app.library;
      const items = [];
      items.push({
        label: 'New Playlist…',
        arrow: false,
        action: async () => {
          const name = await askText(app, { title: 'New Playlist', prompt: 'Name your playlist', value: app.playlists.uniqueName() });
          if (name) app.os.push(userPlaylistView(app, app.playlists.create(name)));
        },
      });
      for (const pl of app.playlists.all) {
        items.push({ label: pl.name, value: String(pl.trackIds.length), view: () => userPlaylistView(app, pl), onHold: () => playlistActions(app, pl, view) });
      }
      for (const pl of lib.smartPlaylists()) items.push({ label: pl.name, view: () => songsView(app, pl.name, pl.tracks, { empty: 'No songs' }) });
      for (const pl of lib.fileplaylists()) items.push({ label: pl.name, view: () => songsView(app, pl.name, pl.tracks) });
      for (const pl of lib.itunesPlaylists()) items.push(itunesPlaylistItem(app, pl));
      items.push({ label: 'On-The-Go', view: () => onTheGoView(app) });
      return items;
    },
  });
  return view;
}

/** A playlist from iTunes, or a playlist folder (a menu of what's inside it). */
function itunesPlaylistItem(app, pl) {
  if (pl.folder) {
    return {
      label: pl.name,
      view: () => new ListView({ title: pl.name, refreshOnEnter: true, items: () => app.library.itunesPlaylists(pl.id).map((p) => itunesPlaylistItem(app, p)) }),
    };
  }
  return { label: pl.name, view: () => songsView(app, pl.name, pl.tracks, { empty: 'No songs' }), onHold: () => groupActions(app, pl.name, pl.tracks) };
}

function playlistActions(app, pl, view) {
  showSheet(app.os, {
    title: pl.name,
    items: [
      {
        label: 'Play',
        action: () => {
          const tracks = app.playlists.tracks(pl);
          if (tracks.length) (app.player.playTracks(tracks, 0, { shuffle: 'off' }), app.nav.nowPlaying());
        },
      },
      {
        label: 'Shuffle',
        action: () => {
          const tracks = app.playlists.tracks(pl);
          if (tracks.length) (app.player.playTracks(tracks, Math.floor(Math.random() * tracks.length), { shuffle: 'songs' }), app.nav.nowPlaying());
        },
      },
      { label: 'Play Next', action: () => app.player.playNext(app.playlists.tracks(pl)) },
      {
        label: 'Rename…',
        action: async () => {
          const name = await askText(app, { title: 'Rename Playlist', value: pl.name });
          if (name) app.playlists.rename(pl.id, name);
          view.refresh();
        },
      },
      {
        label: 'Export as .m3u8…',
        action: async () => {
          const n = await window.ipod.library.exportPlaylist({ name: pl.name, trackIds: pl.trackIds });
          if (n !== null) app.os.alert(`Exported ${n} songs`, 1400);
        },
      },
      {
        label: 'Delete Playlist',
        action: () =>
          setTimeout(
            () =>
              app.os.push(
                confirmView(app, 'Delete', `Delete “${pl.name}”`, () => {
                  app.playlists.remove(pl.id);
                  view.refresh();
                })
              ),
            200
          ),
      },
    ],
  });
}

function userPlaylistView(app, pl) {
  const view = new ListView({
    title: pl.name,
    refreshOnEnter: true,
    empty: 'Hold the centre button on any song and choose “Add to Playlist…”.',
    items: () => {
      const tracks = app.playlists.tracks(pl);
      return trackItems(app, tracks, { playlist: pl });
    },
  });
  view.onSelectHold = () => {
    const item = view.selected;
    if (item && item.onHold) item.onHold(item, view);
    else playlistActions(app, pl, view);
  };
  return view;
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
          label: 'Save Playlist',
          arrow: false,
          action: () => {
            const pl = app.playlists.saveOnTheGo();
            if (pl) app.os.alert(`Saved as “${pl.name}”`, 1400);
            view.refresh();
          },
        },
        {
          label: 'Clear Playlist',
          view: () =>
            confirmView(app, 'Clear', 'Clear Playlist', () => {
              app.store.user.otg = [];
              app.store.touchUser('otg');
            }),
        },
      ];
    },
  });
  return view;
}

// ---------------------------------------------------------------- browse --

export function artistsView(app, artists = app.library.artists, title = 'Artists') {
  return new ListView({
    title,
    index: true,
    empty: emptyText(app),
    items: () => {
      const items = artists.map((a) => ({
        label: a.name,
        sortName: a.name,
        view: () => artistView(app, a),
        onHold: () => groupActions(app, a.name, a.tracks),
      }));
      if (items.length > 1) {
        const all = [...new Set(artists.flatMap((a) => a.tracks))];
        items.unshift({ label: 'All', sortName: ' ', view: () => songsView(app, title, all) });
      }
      return items;
    },
  });
}

export function artistView(app, artist) {
  return new ListView({
    title: artist.name,
    items: () => {
      const items = artist.albums.map((al) => {
        const tracks = al.tracks.filter((t) => artist.tracks.includes(t));
        return { label: al.title, view: () => songsView(app, al.title, tracks), onHold: () => groupActions(app, al.title, tracks) };
      });
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
    items: () =>
      albums.map((al) => ({
        label: al.title,
        sortName: al.title,
        view: () => songsView(app, al.title, al.tracks),
        onHold: () => groupActions(app, al.title, al.tracks),
      })),
  });
}

/** Hold on an album or artist: play / shuffle / queue / add to playlist. */
function groupActions(app, title, tracks) {
  showSheet(app.os, {
    title,
    items: [
      { label: 'Play', action: () => (app.player.playTracks(tracks, 0, { shuffle: 'off' }), app.nav.nowPlaying()) },
      { label: 'Shuffle', action: () => (app.player.playTracks(tracks, Math.floor(Math.random() * tracks.length), { shuffle: 'songs' }), app.nav.nowPlaying()) },
      { label: 'Play Next', action: async () => (await app.player.playNext(tracks)) && app.os.alert('Playing Next', 1000) },
      { label: 'Add to Up Next', action: async () => (await app.player.addToUpNext(tracks)) && app.os.alert('Added to Up Next', 1000) },
      { label: 'Add to Playlist…', action: () => app.os.push(playlistPicker(app, tracks)) },
    ],
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
        onHold: () => groupActions(app, g.name, g.tracks),
        view: () => {
          const byArtist = new Map();
          for (const t of g.tracks) {
            if (!byArtist.has(t.artist)) byArtist.set(t.artist, { name: t.artist, tracks: [] });
            byArtist.get(t.artist).tracks.push(t);
          }
          const artists = [...byArtist.values()].map((a) => ({ ...a, albums: app.library.albums.filter((al) => al.tracks.some((t) => a.tracks.includes(t))) }));
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
      return [...books.entries()].map(([name, tracks]) => {
        const bm = app.store.user.bookmarks;
        const resume = tracks.findIndex((t) => bm[t.id]);
        return tracks.length === 1
          ? { label: name, value: bm[tracks[0].id] ? 'Resume' : '', arrow: false, action: () => (app.player.playTracks(tracks, 0), app.nav.nowPlaying()) }
          : { label: name, value: resume >= 0 ? 'Resume' : '', view: () => songsView(app, name, tracks) };
      });
    },
  });
}
