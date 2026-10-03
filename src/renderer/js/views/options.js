/** Hold the centre button: an options sheet, or (Hold Select › On-The-Go) add to On-The-Go like the 5th gen. */

import { ListView } from './list.js';
import { StaticList } from './common.js';
import { showSheet } from './sheet.js';
import { askText } from './textinput.js';
import { fmtTime, fmtBytes } from '../util.js';

const STARS = ['', '★', '★★', '★★★', '★★★★', '★★★★★'];

export function songOptions(app, track, ctx = {}) {
  if (!track) return;
  const { store, player, os } = app;
  const toast = (msg) => os.alert(msg, 1200);

  if (track.source === 'local' && !track.kind?.startsWith('pod') && store.settings.holdSelect === 'otg') {
    player.addToOnTheGo(track);
    if (ctx.view && ctx.view.flashSelected) ctx.view.flashSelected();
    return toast('Added to On-The-Go');
  }

  const items = [];
  if (track.live) {
    const fav = app.radio.isFavorite(track.station);
    items.push({ label: fav ? 'Remove from Favorites' : 'Add to Favorites', action: () => (app.radio.toggleFavorite(track.station), toast(fav ? 'Removed from Favorites' : 'Added to Favorites')) });
    items.push({ label: 'Station Info', action: () => os.push(stationInfo(app, track.station)) });
    if (track.nowPlaying) items.push({ label: 'Search for This Song', action: () => os.push(app.search(track.nowPlaying)) });
    return showSheet(os, { title: track.station.name, items });
  }

  if (track.kind === 'podcast' && track.source !== 'spotify' && track.episode) {
    const ep = track.episode;
    const played = !!store.user.played[track.id];
    items.push({ label: 'Play Next', action: async () => (await player.playNext([track])) && toast('Playing Next') });
    if (track.downloaded) items.push({ label: 'Remove Download', action: async () => (await app.podcasts.removeDownload(ep), toast('Download removed')) });
    else items.push({ label: 'Download Episode', action: () => app.podcasts.download(ep).then(() => toast('Downloaded')).catch((e) => toast(e.message)) });
    items.push({
      label: played ? 'Mark as Unplayed' : 'Mark as Played',
      action: () => {
        if (played) delete store.user.played[track.id];
        else store.user.played[track.id] = Date.now();
        delete store.user.bookmarks[track.id];
        store.touchUser('played');
        if (ctx.view) ctx.view.paint();
      },
    });
    items.push({ label: 'Episode Info', action: () => os.push(episodeInfo(app, ep, track)) });
    return showSheet(os, { title: track.title, items });
  }

  if (track.source === 'spotify') {
    items.push({ label: 'Play Next', action: async () => (await player.playNext([track])) && toast('Added to Spotify queue') });
    if (track.uri && track.uri.startsWith('spotify:track:')) {
      items.push({
        label: 'Add to Liked Songs',
        action: async () => {
          try {
            await app.spotifyApi.setLiked(track.uri, true);
            toast('Added to Liked Songs');
          } catch {
            toast('Couldn’t update Liked Songs.');
          }
        },
      });
      items.push({ label: 'Add to Spotify Playlist…', action: () => os.push(spotifyPlaylistPicker(app, track)) });
    }
    if (track.albumId) items.push({ label: 'Browse Album', action: () => app.nav.spotifyAlbum({ id: track.albumId, uri: track.albumUri, title: track.album, artist: track.albumArtist, art: track.art }) });
    if (track.artistIds && track.artistIds[0]) items.push({ label: 'Browse Artist', action: () => app.nav.spotifyArtist({ id: track.artistIds[0], name: track.artist.split(', ')[0] }) });
    items.push({ label: 'Song Info', action: () => os.push(songInfo(app, track)) });
    return showSheet(os, { title: track.title, items });
  }

  // Local songs.
  items.push({ label: 'Play Next', action: async () => (await player.playNext([track])) && toast('Playing Next') });
  items.push({ label: 'Add to Up Next', action: async () => (await player.addToUpNext([track])) && toast('Added to Up Next') });
  items.push({ label: 'Add to On-The-Go', action: () => (player.addToOnTheGo(track), toast('Added to On-The-Go')) });
  items.push({ label: 'Add to Playlist…', action: () => os.push(playlistPicker(app, [track])) });
  if (ctx.playlist) {
    items.push({
      label: 'Remove from Playlist',
      action: () => {
        app.playlists.removeAt(ctx.playlist.id, ctx.playlist.index);
        if (ctx.view) ctx.view.refresh();
        toast('Removed');
      },
    });
  }
  const album = app.library.albums.find((a) => a.tracks.includes(track));
  if (album) items.push({ label: 'Browse Album', action: () => app.nav.album(album) });
  items.push({ label: 'Browse Artist', action: () => app.nav.artist(track.artist) });
  items.push({ label: `Rate ${STARS[store.rating(track.id)] || '…'}`, action: () => rateSheet(app, track) });
  items.push({ label: 'Song Info', action: () => os.push(songInfo(app, track)) });
  showSheet(os, { title: track.title, items });
}

function rateSheet(app, track) {
  const set = (r) => {
    app.store.user.ratings[track.id] = r;
    app.store.touchUser('ratings');
    app.player.emit('rating');
    app.os.alert(r ? STARS[r] : 'Rating cleared', 900);
  };
  setTimeout(
    () =>
      showSheet(app.os, {
        title: 'Rating',
        items: [5, 4, 3, 2, 1].map((r) => ({ label: STARS[r], action: () => set(r) })).concat([{ label: 'Clear Rating', action: () => set(0) }]),
      }),
    200
  );
}

/** Choose (or create) a playlist to add songs to. */
export function playlistPicker(app, tracks) {
  const add = (pl) => {
    app.playlists.add(
      pl.id,
      tracks.map((t) => t.id)
    );
    app.os.pop();
    app.os.alert(`Added to “${pl.name}”`, 1200);
  };
  return new ListView({
    title: 'Add to Playlist',
    refreshOnEnter: true,
    items: () => [
      {
        label: 'New Playlist…',
        arrow: false,
        action: async () => {
          const name = await askText(app, { title: 'New Playlist', prompt: 'Name your playlist', value: app.playlists.uniqueName() });
          if (!name) return;
          add(app.playlists.create(name));
        },
      },
      ...app.playlists.all.map((pl) => ({ label: pl.name, value: String(pl.trackIds.length), arrow: false, action: () => add(pl) })),
    ],
  });
}

function spotifyPlaylistPicker(app, track) {
  return new ListView({
    title: 'Add to Playlist',
    empty: 'You don’t own any Spotify playlists yet.',
    load: async () => {
      const lists = await app.spotifyApi.editablePlaylists();
      return lists.map((pl) => ({
        label: pl.name,
        arrow: false,
        action: async () => {
          try {
            await app.spotifyApi.addToPlaylist(pl.id, [track.uri]);
            app.os.pop();
            app.os.alert(`Added to “${pl.name}”`, 1200);
          } catch (err) {
            app.os.alert(err.status === 403 ? 'Spotify didn’t allow that.' : 'Couldn’t add to playlist.');
          }
        },
      }));
    },
  });
}

export function songInfo(app, t) {
  const u = app.store.user;
  const rows = [
    { label: t.title, center: true },
    ['Artist', t.artist],
    ['Album', t.album],
    ['Album Artist', t.albumArtist !== t.artist ? t.albumArtist : null],
    ['Genre', t.genre],
    ['Composer', t.composer],
    ['Year', t.year],
    ['Track', t.trackNo ? `${t.trackNo}${t.trackOf ? ` of ${t.trackOf}` : ''}` : null],
    ['Disc', t.discNo],
    ['Time', t.duration ? fmtTime(t.duration) : null],
    ['Kind', t.source === 'spotify' ? 'Spotify' : t.codec ? `${t.codec}${t.lossless ? ' (lossless)' : ''}` : null],
    ['Bit Rate', t.bitrate ? `${t.bitrate} kbps` : null],
    ['Sample Rate', t.sampleRate ? `${(t.sampleRate / 1000).toFixed(1)} kHz` : null],
    ['BPM', t.bpm],
    ['Size', t.size ? fmtBytes(t.size) : null],
    ['Plays', t.source === 'local' ? String(app.store.plays(t.id)) : null],
    ['Skips', u.skips[t.id] ? String(u.skips[t.id]) : null],
    ['Last Played', app.store.lastPlayed(t.id) ? new Date(app.store.lastPlayed(t.id)).toLocaleDateString() : null],
    ['Rating', app.store.rating(t.id) ? STARS[app.store.rating(t.id)] : null],
    ['Date Added', t.addedAt ? new Date(t.addedAt).toLocaleDateString() : null],
    ['Sound Check', typeof t.gain === 'number' ? `${t.gain > 0 ? '+' : ''}${t.gain.toFixed(1)} dB` : null],
    ['Where', t.folder || null],
    ['File', t.file || null],
  ]
    .filter((r) => !Array.isArray(r) || (r[1] !== null && r[1] !== undefined && r[1] !== ''))
    .map((r) => (Array.isArray(r) ? { label: r[0], value: String(r[1]) } : r));
  return new StaticList({ title: 'Song Info', items: rows });
}

function episodeInfo(app, ep, track) {
  const rows = [
    { label: ep.title, center: true },
    { label: 'Show', value: track.album },
    { label: 'Released', value: ep.date ? new Date(ep.date).toLocaleDateString() : '—' },
    { label: 'Time', value: ep.duration ? fmtTime(ep.duration) : '—' },
    { label: 'Downloaded', value: track.downloaded ? 'Yes' : 'No' },
    ...wrap(ep.description || 'No description.', 34).map((line) => ({ label: line, arrow: false })),
  ];
  return new StaticList({ title: 'Episode Info', items: rows });
}

function stationInfo(app, s) {
  const rows = [
    { label: s.name, center: true },
    { label: 'Country', value: s.country || '—' },
    { label: 'Language', value: s.language || '—' },
    { label: 'Format', value: [s.codec, s.bitrate ? `${s.bitrate} kbps` : ''].filter(Boolean).join(' ') || '—' },
    { label: 'Genre', value: (s.tags || '').split(',').slice(0, 3).join(', ') || '—' },
    { label: 'Votes', value: String(s.votes || 0) },
    { label: 'Website', value: s.homepage ? s.homepage.replace(/^https?:\/\//, '') : '—' },
  ];
  return new StaticList({ title: 'Station Info', items: rows });
}

/** Word-wrap text into lines that fit a list row. */
export function wrap(text, width) {
  const out = [];
  for (const para of String(text).split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + ' ' + word).trim().length > width) {
        if (line) out.push(line);
        line = word;
      } else line = (line + ' ' + word).trim();
    }
    if (line) out.push(line);
    if (out.length > 120) break;
  }
  return out;
}
