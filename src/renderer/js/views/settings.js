/** Settings, following the iPod 5th generation menu, plus desktop options. */

import { ListView } from './list.js';
import { cycleItem, choiceItem, StaticList, SliderView, TextView, ScanView, confirmView } from './common.js';
import { EQ_PRESETS } from '../player/eq.js';
import { SIZES, getModel } from '../models.js';
import { fmtBytes } from '../util.js';
import { showSheet } from './sheet.js';

const ON_OFF = [
  [true, 'On'],
  [false, 'Off'],
];

export function settingsMenu(app) {
  const { store, player } = app;
  return new ListView({
    title: 'Settings',
    items: () => [
      { label: 'About', view: () => aboutView(app) },
      cycleItem(
        store,
        'Shuffle',
        'shuffle',
        [
          ['off', 'Off'],
          ['songs', 'Songs'],
          ['albums', 'Albums'],
        ],
        (v) => player.setShuffle(v)
      ),
      cycleItem(
        store,
        'Repeat',
        'repeat',
        [
          ['off', 'Off'],
          ['one', 'One'],
          ['all', 'All'],
        ],
        (v) => player.setRepeat(v)
      ),
      { label: 'Main Menu', view: () => mainMenuSettings(app) },
      { label: 'Music Menu', view: () => musicMenuSettings(app) },
      choiceItem(app, 'Backlight Timer', 'backlight', [
        [0, 'Always On'],
        [2, '2 Seconds'],
        [5, '5 Seconds'],
        [10, '10 Seconds'],
        [15, '15 Seconds'],
        [20, '20 Seconds'],
        [30, '30 Seconds'],
      ], { showValue: false }),
      {
        label: 'Brightness',
        view: () =>
          new SliderView({
            title: 'Brightness',
            get: () => store.settings.brightness,
            set: (v) => {
              store.set('brightness', v);
              app.os.activity();
              app.os._applyBacklight();
            },
            min: 0.15,
          }),
      },
      choiceItem(app, 'EQ', 'eq', Object.keys(EQ_PRESETS).map((k) => [k, k]), { showValue: false }),
      cycleItem(store, 'Sound Check', 'soundCheck', ON_OFF),
      {
        label: 'Volume Limit',
        view: () =>
          new SliderView({
            title: 'Volume Limit',
            icon: 'volume',
            hint: 'Maximum volume for this iPod',
            get: () => store.settings.volumeLimit,
            set: (v) => store.set('volumeLimit', Math.max(0.05, v)),
          }),
      },
      choiceItem(app, 'Audiobooks', 'audiobookSpeed', [
        [0.8, 'Slower'],
        [1, 'Normal'],
        [1.25, 'Faster'],
      ]),
      cycleItem(store, 'Compilations', 'compilations', ON_OFF, (v) => {
        store.set('compilations', v);
        store.setIn('musicMenu', 'compilations', v);
      }),
      cycleItem(store, 'Clicker', 'clicker', [
        ['on', 'On'],
        ['loud', 'Loud'],
        ['off', 'Off'],
      ]),
      { label: 'Date & Time', view: () => dateTimeSettings(app) },
      { label: 'Music Library', view: () => librarySettings(app) },
      { label: 'Spotify', view: () => spotifySettings(app) },
      { label: 'Desktop', view: () => desktopSettings(app) },
      {
        label: 'Legal',
        view: () =>
          new TextView({
            title: 'Legal',
            heading: 'iPod for Desktop',
            body: LEGAL,
          }),
      },
      {
        label: 'Reset Settings',
        view: () =>
          confirmView(app, 'Reset', 'Reset', () => {
            store.reset();
            app.rebuild();
            app.os.alert('Settings reset');
          }),
      },
    ],
  });
}

const LEGAL = `An unofficial, fan-made tribute to the iPod. Not affiliated with, endorsed by or sponsored by Apple Inc. iPod and Click Wheel are trademarks of Apple Inc.

Spotify is a trademark of Spotify AB. Spotify content and artwork are provided by Spotify and remain the property of their owners.

Interface font: Source Sans 3, © Adobe, licensed under the SIL Open Font License 1.1.

Released under the MIT License.`;

function serial(app) {
  const u = app.store.user;
  if (!u.serial) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    u.serial = Array.from({ length: 11 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    app.store.touchUser();
  }
  return u.serial;
}

function aboutView(app) {
  const view = new StaticList({ title: 'About', items: [{ label: 'iPod', center: true }] });
  const model = getModel(app.store.settings.model);
  const build = (info, extra) => {
    const lib = app.library;
    const rows = [
      { label: 'iPod', center: true },
      { label: 'Songs', value: String(lib.music.length) },
      { label: 'Podcasts', value: String(lib.podcasts.length) },
      { label: 'Videos', value: extra.videos === null ? '—' : String(extra.videos) },
      { label: 'Photos', value: extra.photos === null ? '—' : String(extra.photos) },
    ];
    if (info && info.disk) {
      rows.push({ label: 'Capacity', value: fmtBytes(info.disk.total) });
      rows.push({ label: 'Available', value: fmtBytes(info.disk.free) });
    }
    rows.push({ label: 'Version', value: (info && info.version) || app.store.env.version });
    rows.push({ label: 'S/N', value: serial(app) });
    rows.push({ label: 'Model', value: `${model.era.split(' (')[0]}` });
    rows.push({ label: 'Format', value: app.store.env.platform === 'darwin' ? 'Macintosh' : 'Windows' });
    if (app.spotifyApi.user) rows.push({ label: 'Spotify', value: app.spotifyApi.user.display_name || app.spotifyApi.user.id });
    return rows;
  };
  const extra = { videos: app.media.cachedCount('videos'), photos: app.media.cachedCount('photos') };
  view.items = build(null, extra);
  window.ipod.system
    .info(app.store.musicFolders()[0])
    .then((info) => view.setItems(build(info, extra)))
    .catch(() => {});
  return view;
}

function mainMenuSettings(app) {
  const { store } = app;
  const entries = [
    ['music', 'Music'],
    ['spotify', 'Spotify'],
    ['photos', 'Photos'],
    ['videos', 'Videos'],
    ['podcasts', 'Podcasts'],
    ['extras', 'Extras'],
    ['games', 'Games'],
    ['clock', 'Clock'],
    ['shuffle', 'Shuffle Songs'],
  ];
  return new ListView({
    title: 'Main Menu',
    items: () =>
      entries.map(([key, name]) => ({
        label: name,
        value: () => (store.settings.mainMenu[key] ? 'On' : 'Off'),
        action: () => store.setIn('mainMenu', key, !store.settings.mainMenu[key]),
      })),
  });
}

function musicMenuSettings(app) {
  const { store } = app;
  const entries = [
    ['playlists', 'Playlists'],
    ['artists', 'Artists'],
    ['albums', 'Albums'],
    ['compilations', 'Compilations'],
    ['songs', 'Songs'],
    ['podcasts', 'Podcasts'],
    ['genres', 'Genres'],
    ['composers', 'Composers'],
    ['audiobooks', 'Audiobooks'],
    ['search', 'Search'],
  ];
  return new ListView({
    title: 'Music Menu',
    items: () =>
      entries.map(([key, name]) => ({
        label: name,
        value: () => (store.settings.musicMenu[key] ? 'On' : 'Off'),
        action: () => store.setIn('musicMenu', key, !store.settings.musicMenu[key]),
      })),
  });
}

function dateTimeSettings(app) {
  const { store } = app;
  return new ListView({
    title: 'Date & Time',
    items: () => [
      cycleItem(store, 'Time', 'timeFormat', [
        ['12', '12-hour'],
        ['24', '24-hour'],
      ]),
      cycleItem(store, 'Time in Title', 'timeInTitle', ON_OFF),
      { label: 'Time Zone', value: Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop().replace(/_/g, ' '), arrow: false },
      { label: 'Date', value: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }), arrow: false },
    ],
  });
}

function librarySettings(app) {
  const { store, library } = app;
  const chooseFolder = async (title) => window.ipod.system.chooseFolder(title);
  const view = new ListView({
    title: 'Music Library',
    refreshOnEnter: true,
    items: () => {
      const folders = store.musicFolders();
      const items = folders.map((f) => ({
        label: f.split(/[\\/]/).filter(Boolean).pop() || f,
        sub: f,
        arrow: false,
        action: () =>
          showSheet(app.os, {
            title: f,
            items: [
              {
                label: 'Remove Folder',
                action: () => {
                  store.set('folders', folders.filter((x) => x !== f));
                  view.refresh();
                  library.scan();
                },
              },
            ],
          }),
      }));
      items.push({
        label: 'Add Music Folder…',
        arrow: false,
        action: async () => {
          const f = await chooseFolder('Add a music folder');
          if (!f) return;
          const list = store.musicFolders();
          if (!list.includes(f)) store.set('folders', [...list, f]);
          view.refresh();
          app.os.push(new ScanView(app));
        },
      });
      items.push({ label: 'Update Library', view: () => new ScanView(app) });
      items.push({
        label: 'Photos Folder…',
        value: () => short(store.settings.photosFolder || store.env.defaults.pictures),
        arrow: false,
        action: async () => {
          const f = await chooseFolder('Choose your photos folder');
          if (f) store.set('photosFolder', f);
          app.media.invalidate();
          view.refresh();
        },
      });
      items.push({
        label: 'Videos Folder…',
        value: () => short(store.settings.videosFolder || store.env.defaults.videos),
        arrow: false,
        action: async () => {
          const f = await chooseFolder('Choose your videos folder');
          if (f) store.set('videosFolder', f);
          app.media.invalidate();
          view.refresh();
        },
      });
      items.push({
        label: 'Notes Folder…',
        value: () => short(store.settings.notesFolder || ''),
        arrow: false,
        action: async () => {
          const f = await chooseFolder('Choose a folder of .txt notes');
          if (f) store.set('notesFolder', f);
          view.refresh();
        },
      });
      return items;
    },
  });
  return view;
}

function short(p) {
  if (!p) return 'None';
  return p.split(/[\\/]/).filter(Boolean).pop();
}

export function spotifySettings(app) {
  const { store, spotifyApi, spotify } = app;
  const view = new ListView({
    title: 'Spotify',
    refreshOnEnter: true,
    items: () => {
      const st = spotifyApi.status || {};
      const items = [];
      if (st.connected) {
        items.push({ label: 'Account', value: spotifyApi.user ? spotifyApi.user.display_name || spotifyApi.user.id : 'Connected', arrow: false });
        items.push(
          choiceItem(
            app,
            'Play Music On',
            'spotifyOutput',
            [
              ['auto', 'Automatic'],
              ['ipod', 'This iPod'],
              ['connect', 'Spotify App / Device'],
            ],
            {
              onChange: (v) => {
                store.set('spotifyOutput', v);
                if (v !== 'connect') spotify.start();
              },
            }
          )
        );
        items.push({ label: 'Devices', view: () => app.spotifyMenus.devices() });
        items.push({
          label: 'Sign Out',
          view: () =>
            confirmView(app, 'Sign Out', 'Sign Out of Spotify', async () => {
              await window.ipod.spotify.logout();
              app.os.alert('Signed out of Spotify');
            }),
        });
      } else {
        items.push({
          label: st.configured ? 'Connect to Spotify' : 'Set Up Spotify…',
          arrow: false,
          action: () => {
            window.ipod.spotify.openSetup();
            app.os.alert('Finish setup in the Spotify window', 1800);
          },
        });
        if (st.configured) items.push({ label: 'Change Client ID…', arrow: false, action: () => window.ipod.spotify.openSetup() });
      }
      items.push(cycleItem(store, 'Show in Main Menu', 'spotifyEnabled', ON_OFF));
      return items;
    },
  });
  const off = spotifyApi.on('status', () => view.mounted && view.refresh());
  const offUser = spotifyApi.on('user', () => view.mounted && view.refresh());
  const destroy = view.destroy.bind(view);
  view.destroy = () => {
    off();
    offUser();
    destroy();
  };
  return view;
}

function desktopSettings(app) {
  const { store } = app;
  const model = getModel(store.settings.model);
  return new ListView({
    title: 'Desktop',
    items: () => [
      choiceItem(
        app,
        'Color',
        'color',
        model.colors.map((c) => [c.id, c.name])
      ),
      choiceItem(
        app,
        'Size',
        'size',
        SIZES.map((s) => [s.id, s.name])
      ),
      cycleItem(store, 'Always on Top', 'alwaysOnTop', ON_OFF),
      cycleItem(store, 'Show in Taskbar', 'showInTaskbar', ON_OFF),
      cycleItem(store, 'Start with Windows', 'openAtLogin', ON_OFF),
      cycleItem(store, 'Shadow', 'shadow', ON_OFF),
      cycleItem(store, 'Wheel Speed', 'wheelSpeed', [
        ['low', 'Slow'],
        ['medium', 'Normal'],
        ['high', 'Fast'],
      ]),
      choiceItem(app, 'Opacity', 'opacity', [
        [1, '100%'],
        [0.9, '90%'],
        [0.8, '80%'],
        [0.65, '65%'],
        [0.5, '50%'],
      ]),
      { label: 'Hide iPod', arrow: false, action: () => window.ipod.win.hide() },
      { label: 'Quit', arrow: false, action: () => window.ipod.win.quit() },
    ],
  });
}

