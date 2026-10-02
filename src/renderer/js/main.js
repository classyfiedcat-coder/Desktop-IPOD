/** Boots the iPod: device, OS, player, libraries and menus. */

import { store } from './state.js';
import { Device } from './device.js';
import { OS } from './os.js';
import { Player } from './player/player.js';
import { LocalLibrary } from './library/local.js';
import { SpotifyAPI } from './library/spotify.js';
import { SpotifyEngine } from './player/spotify-engine.js';
import { MainMenu, createNav } from './views/menus.js';
import { settingsMenu } from './views/settings.js';
import { createSpotifyMenus } from './views/spotify-menus.js';
import { createMedia } from './views/media.js';
import { createExtras } from './views/extras/index.js';
import { localSearch } from './views/search.js';

const WINDOW_KEYS = ['alwaysOnTop', 'showInTaskbar', 'openAtLogin', 'opacity'];

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
  app.nav = createNav(app);
  app.spotifyMenus = createSpotifyMenus(app);
  app.media = createMedia(app);
  app.extras = createExtras(app);
  app.settingsMenu = () => settingsMenu(app);
  app.search = () => localSearch(app);
  app.rebuild = () => {
    const screen = device.build(store.settings);
    os.mount(screen);
  };
  window.__ipod = app; // handy for debugging from DevTools

  app.rebuild();
  os.push(new MainMenu(app), { animate: false });
  os.activity();

  // Settings that change the device itself.
  for (const key of ['color', 'size', 'shadow']) store.on(`change:${key}`, () => app.rebuild());
  store.on('change:wheelSpeed', (v) => (device.wheelSpeed = v));
  store.on('change:backlight', () => os.activity());

  // Desktop window preferences live in the main process.
  const pushWindowPrefs = () => window.ipod.win.set(Object.fromEntries(WINDOW_KEYS.map((k) => [k, store.settings[k]])));
  pushWindowPrefs();
  for (const key of WINDOW_KEYS) store.on(`change:${key}`, pushWindowPrefs);
  window.ipod.win.onPrefs((prefs) => {
    for (const key of WINDOW_KEYS) if (key in prefs && prefs[key] !== store.settings[key]) store.set(key, prefs[key]);
  });

  // Tray / context-menu commands.
  window.ipod.onCommand((cmd) => {
    if (os.asleep) os.wake();
    os.activity();
    if (app.locked && cmd !== 'playpause' && cmd !== 'next' && cmd !== 'prev') return;
    switch (cmd) {
      case 'playpause':
        player.toggle();
        break;
      case 'next':
        player.next();
        break;
      case 'prev':
        player.prev();
        break;
      case 'nowplaying':
        if (player.track) app.nav.nowPlaying();
        break;
      case 'settings':
        os.goto([app.settingsMenu()]);
        break;
      case 'appearance':
        os.goto([app.settingsMenu()]);
        break;
      case 'hold':
        device.setHold(!device.hold, true);
        break;
    }
  });

  player.on('error', (msg) => os.alert(msg, 2400));
  spotify.on('notice', (msg) => os.alert(msg, 1800));

  await library.init();
  player.restoreSession(library);
  spotifyApi.init();
  spotify.init();

  // Refresh lists that depend on the library once a scan finishes.
  library.on('change', () => {
    const cur = os.current;
    if (cur && cur.refresh && cur.o && typeof cur.o.items === 'function') cur.refresh();
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.textContent = `Something went wrong starting the iPod: ${err.message}`;
  document.body.style.cssText = 'background:#fff;font:14px sans-serif;padding:20px';
});
