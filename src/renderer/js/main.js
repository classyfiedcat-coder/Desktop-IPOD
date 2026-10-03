/** Boots the iPod: device, OS, player, libraries, services and menus. */

import { store } from './state.js';
import { Device } from './device.js';
import { OS } from './os.js';
import { Player } from './player/player.js';
import { LocalLibrary } from './library/local.js';
import { SpotifyAPI } from './library/spotify.js';
import { SpotifyEngine } from './player/spotify-engine.js';
import { RadioService } from './library/radio.js';
import { PodcastService } from './library/podcasts.js';
import { LyricsService } from './library/lyrics.js';
import { UserPlaylists } from './library/playlists.js';
import { MainMenu, createNav, shuffleSongs } from './views/menus.js';
import { settingsMenu } from './views/settings.js';
import { createSpotifyMenus } from './views/spotify-menus.js';
import { createRadioMenus } from './views/radio-menus.js';
import { createPodcastMenus } from './views/podcast-menus.js';
import { createMedia } from './views/media.js';
import { createExtras } from './views/extras/index.js';
import { localSearch } from './views/search.js';
import { SyncView } from './views/sync.js';
import { ColorEditor } from './views/color-editor.js';
import { getModel, getColor } from './models.js';

const WINDOW_KEYS = ['alwaysOnTop', 'showInTaskbar', 'openAtLogin', 'opacity', 'snapToEdges', 'startHidden'];
const DESKTOP_KEYS = ['notifications', 'globalShortcuts', 'color', 'size', 'motion'];

// Forward renderer errors to the main-process log.
window.addEventListener('error', (e) => window.ipod && window.ipod.log('error', e.message, e.filename ? `${e.filename}:${e.lineno}` : ''));
window.addEventListener('unhandledrejection', (e) => window.ipod && window.ipod.log('error', 'unhandled rejection', e.reason && (e.reason.stack || e.reason.message || String(e.reason))));

async function boot() {
  await store.load();

  const device = new Device(document.getElementById('stage'));
  device.wheelSpeed = store.settings.wheelSpeed;

  const player = new Player(store);
  const library = new LocalLibrary(store);
  const spotifyApi = new SpotifyAPI();
  const spotify = new SpotifyEngine(spotifyApi, store);
  player.attachSpotify(spotify);
  const os = new OS({ device, store, player });

  const app = { store, device, os, player, library, spotifyApi, spotify, locked: false };
  app.radio = new RadioService(store);
  app.podcasts = new PodcastService(store);
  app.lyrics = new LyricsService(store);
  app.playlists = new UserPlaylists(store, library);
  app.nav = createNav(app);
  app.spotifyMenus = createSpotifyMenus(app);
  app.radioMenus = createRadioMenus(app);
  app.podcastMenus = createPodcastMenus(app);
  app.media = createMedia(app);
  app.extras = createExtras(app);
  app.settingsMenu = () => settingsMenu(app);
  app.search = (q) => localSearch(app, q);
  app.rebuild = () => {
    device.capacity = app.capacity;
    const screen = device.build(store.settings);
    os.mount(screen);
  };
  app.shutdown = async () => {
    store.flush(); // before the animation, in case it's cut short
    await os.shutdown();
    store.flush();
    window.ipod.win.quit();
  };
  window.__ipod = app; // handy for debugging from DevTools

  app.rebuild();
  os.push(new MainMenu(app), { animate: false });
  os.activity();
  const booting = store.settings.startupAnimation ? os.boot() : Promise.resolve();

  // Settings that change the device itself.
  for (const key of ['color', 'size', 'shadow', 'engraving', 'reflections', 'wear', 'backFinish', 'detail']) store.on(`change:${key}`, () => app.rebuild());

  // The iPod turns toward the pointer, wherever it is on screen.
  const configureMotion = () => {
    const s = store.settings;
    device.rig.configure({ mode: s.motion, amount: s.motionAmount, float: s.idleFloat });
    window.ipod.win.trackCursor(s.motion !== 'off');
  };
  configureMotion();
  for (const key of ['motion', 'motionAmount', 'idleFloat']) store.on(`change:${key}`, configureMotion);
  window.ipod.win.onCursor((c) => device.rig.cursor(c));
  os.on('sleep', () => device.rig.setAwake(false));
  os.on('wake', () => device.rig.setAwake(true));
  document.addEventListener('visibilitychange', () => device.rig.setAwake(!document.hidden && !os.asleep));
  store.on('change:customColors', (c) => {
    if (store.settings.color === 'custom') device.applyColors(getColor(getModel(store.settings.model), 'custom', c));
  });
  store.on('change:wheelGlow', (v) => device.setGlow(v));
  device.on('rebuild', () => app.rebuild());
  store.on('change:wheelSpeed', (v) => (device.wheelSpeed = v));
  store.on('change:backlight', () => os.activity());
  store.on('reset', () => app.rebuild());

  // Desktop window preferences live in the main process.
  const pushWindowPrefs = () => window.ipod.win.set(Object.fromEntries(WINDOW_KEYS.map((k) => [k, store.settings[k]])));
  const pushDesktopPrefs = () => window.ipod.desktop.prefs(Object.fromEntries(DESKTOP_KEYS.map((k) => [k, store.settings[k]])));
  pushWindowPrefs();
  pushDesktopPrefs();
  for (const key of WINDOW_KEYS) store.on(`change:${key}`, pushWindowPrefs);
  for (const key of DESKTOP_KEYS) store.on(`change:${key}`, pushDesktopPrefs);

  // Tell the tray / taskbar / notifications what's playing.
  const pushNowPlaying = () => {
    const t = player.track;
    window.ipod.desktop.nowPlaying(t ? { title: t.title, artist: t.artist, album: t.album, playing: player.playing, artKey: t.artKey || null } : { title: '', playing: false });
  };
  for (const evt of ['track', 'state', 'meta']) player.on(evt, pushNowPlaying);

  // Tray, context menu, jump list and global shortcut commands.
  window.ipod.onCommand(({ name, payload }) => {
    if (name.startsWith('set:')) {
      const [, key, value] = name.split(':');
      store.set(key, value);
      return;
    }
    if (name === 'prefs-changed') return syncWindowPrefs();
    if (name === 'shutdown') return app.shutdown();
    if (name === 'flush') return store.flush();
    if (name === 'volup' || name === 'voldown') {
      player.setVolume(player.volume + (name === 'volup' ? 0.06 : -0.06));
      os.alert(`Volume ${Math.round(player.volume * 100)}%`, 600);
      return;
    }
    if (os.asleep) os.wake();
    os.activity();
    if (app.locked && !['playpause', 'next', 'prev'].includes(name)) return;
    switch (name) {
      case 'playpause':
        player.toggle();
        break;
      case 'next':
        player.next();
        break;
      case 'prev':
        player.prev();
        break;
      case 'shuffle':
        shuffleSongs(app);
        break;
      case 'nowplaying':
        if (player.track) app.nav.nowPlaying();
        break;
      case 'settings':
      case 'appearance':
        os.goto([app.settingsMenu()]);
        break;
      case 'colors':
        os.goto([app.settingsMenu(), new ColorEditor(app)]);
        break;
      case 'flip':
        device.flip();
        break;
      case 'hold':
        device.setHold(!device.hold, true);
        break;
      case 'open-files':
        playFiles(payload || []);
        break;
    }
  });

  const syncWindowPrefs = async () => {
    const prefs = await window.ipod.win.set({});
    for (const key of WINDOW_KEYS) if (key in prefs && prefs[key] !== store.settings[key]) store.set(key, prefs[key]);
  };

  const playFiles = (tracks) => {
    const list = library.transient(tracks);
    if (!list.length) return;
    player.playTracks(list, 0, { shuffle: 'off' });
    app.nav.nowPlaying();
    os.alert(list.length === 1 ? `Playing “${list[0].title}”` : `Playing ${list.length} songs`, 1400);
  };

  // Drag & drop: files play now, folders are added to the library.
  device.on('drop', async ({ paths }) => {
    os.wake();
    os.activity();
    const res = await window.ipod.files.dropped(paths);
    if (res.tracks.length) playFiles(res.tracks);
    if (res.folders.length) os.push(new SyncView(app, { folders: res.folders }));
    if (!res.tracks.length && !res.folders.length) os.alert('Those files can’t be played.', 1600);
  });
  device.on('flip', (flipped) => flipped && os.activity());

  player.on('error', (msg) => os.alert(msg, 2400));
  spotify.on('notice', (msg) => os.alert(msg, 1800));

  window.ipod.ready();
  window.ipod.system
    .info(store.musicFolders()[0])
    .then((info) => {
      if (info && info.disk) app.capacity = `${Math.round(info.disk.total / 1e9)}GB`;
      device.capacity = app.capacity;
    })
    .catch(() => {});
  await library.init();
  player.restoreSession(library);
  spotifyApi.init();
  spotify.init();
  app.podcasts.init();
  await booting;
  app.booted = true;
  if (store.firstRun) os.alert('Welcome! Drag the iPod to move it. Right-click for options.', 3600);

  // Refresh lists that depend on the library once a scan finishes.
  library.on('change', () => {
    const cur = os.current;
    if (cur && cur.refresh && cur.o && typeof cur.o.items === 'function' && !cur.o.load) cur.refresh();
  });
}

boot().catch((err) => {
  console.error(err);
  if (window.ipod) window.ipod.log('error', 'boot failed', err.stack || err.message);
  document.body.textContent = `Something went wrong starting the iPod: ${err.message}`;
  document.body.style.cssText = 'background:#fff;font:14px sans-serif;padding:20px';
});
