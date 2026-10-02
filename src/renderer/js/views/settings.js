/** Settings: the 5th gen menu, plus everything a desktop iPod can do. */

import { ListView } from './list.js';
import { View } from './view.js';
import { cycleItem, choiceItem, StaticList, SliderView, TextView, ScanView, confirmView } from './common.js';
import { EQ_PRESETS, EQ_BANDS } from '../player/eq.js';
import { SIZES, getModel } from '../models.js';
import { fmtBytes, h, clamp } from '../util.js';
import { showSheet } from './sheet.js';
import { askText } from './textinput.js';
import { ColorEditor } from './color-editor.js';
import { CITY_COUNTRIES } from './extras/countries.js';

const ON_OFF = [
  [true, 'On'],
  [false, 'Off'],
];

export function settingsMenu(app) {
  const { store, player } = app;
  return new ListView({
    title: 'Settings',
    refreshOnEnter: true,
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
      { label: 'Main Menu', view: () => toggles(app, 'Main Menu', 'mainMenu', MAIN_MENU) },
      { label: 'Music Menu', view: () => toggles(app, 'Music Menu', 'musicMenu', MUSIC_MENU) },
      { label: 'Playback', view: () => playbackSettings(app) },
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
      { label: 'EQ', value: () => store.settings.eq, view: () => eqMenu(app) },
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
      cycleItem(store, 'Clicker', 'clicker', [
        ['on', 'On'],
        ['loud', 'Loud'],
        ['off', 'Off'],
      ]),
      { label: 'Lyrics', view: () => lyricsSettings(app) },
      { label: 'Date & Time', view: () => dateTimeSettings(app) },
      { label: 'Music Library', view: () => librarySettings(app) },
      { label: 'Spotify', view: () => spotifySettings(app) },
      { label: 'Radio', view: () => radioSettings(app) },
      { label: 'Appearance', view: () => appearanceSettings(app) },
      { label: 'Desktop', view: () => desktopSettings(app) },
      { label: 'Software Update', view: () => new UpdateView(app) },
      { label: 'Backup & Restore', view: () => backupSettings(app) },
      { label: 'Legal', view: () => new TextView({ title: 'Legal', heading: 'iPod for Desktop', body: LEGAL }) },
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

const MAIN_MENU = [
  ['music', 'Music'],
  ['coverflow', 'Cover Flow'],
  ['spotify', 'Spotify'],
  ['radio', 'Radio'],
  ['podcasts', 'Podcasts'],
  ['photos', 'Photos'],
  ['videos', 'Videos'],
  ['extras', 'Extras'],
  ['games', 'Games'],
  ['clock', 'Clock'],
  ['shuffle', 'Shuffle Songs'],
];

const MUSIC_MENU = [
  ['coverflow', 'Cover Flow'],
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

function toggles(app, title, group, entries) {
  const { store } = app;
  return new ListView({
    title,
    items: () =>
      entries.map(([key, name]) => ({
        label: name,
        value: () => (store.settings[group][key] ? 'On' : 'Off'),
        action: () => store.setIn(group, key, !store.settings[group][key]),
      })),
  });
}

const LEGAL = `An unofficial, fan-made tribute to the iPod. Not affiliated with, endorsed by or sponsored by Apple Inc. iPod and Click Wheel are trademarks of Apple Inc.

Spotify is a trademark of Spotify AB. Spotify content and artwork are provided by Spotify and remain the property of their owners.

Lyrics are provided by LRCLIB (lrclib.net). Internet radio stations come from the Radio Browser community directory (radio-browser.info). Podcast search and charts use the iTunes Search API. Missing album artwork is looked up with the iTunes Search API and the MusicBrainz Cover Art Archive.

Interface font: Source Sans 3, © Adobe, licensed under the SIL Open Font License 1.1.

Released under the MIT License.`;

// ------------------------------------------------------------------ about --

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
  const model = getModel(app.store.settings.model);
  const lib = app.library;
  const build = (info) => {
    const rows = [
      { label: app.store.settings.engraving ? app.store.settings.engraving.split('\n')[0] : 'iPod', center: true },
      { label: 'Songs', value: String(lib.music.length) },
      { label: 'Albums', value: String(lib.albums.length) },
      { label: 'Playlists', value: String(app.playlists.all.length + lib.playlists.length) },
      { label: 'Podcasts', value: String(app.podcasts.subs.length + lib.shows.length) },
      { label: 'Radio Favorites', value: String(app.store.user.radioFavorites.length) },
      { label: 'Videos', value: app.media.cachedCount('videos') === null ? '—' : String(app.media.cachedCount('videos')) },
      { label: 'Photos', value: app.media.cachedCount('photos') === null ? '—' : String(app.media.cachedCount('photos')) },
      { label: 'Total Plays', value: String(Object.values(app.store.user.plays).reduce((a, b) => a + b, 0)) },
    ];
    if (info && info.disk) {
      rows.push({ label: 'Capacity', value: fmtBytes(info.disk.total) });
      rows.push({ label: 'Available', value: fmtBytes(info.disk.free) });
    }
    rows.push({ label: 'Version', value: (info && info.version) || app.store.env.version });
    rows.push({ label: 'S/N', value: serial(app) });
    rows.push({ label: 'Model', value: model.era.split(' (')[0] });
    rows.push({ label: 'Format', value: app.store.env.platform === 'darwin' ? 'Macintosh' : 'Windows' });
    if (info && info.electron) rows.push({ label: 'Engine', value: `Electron ${info.electron}` });
    if (app.spotifyApi.user) rows.push({ label: 'Spotify', value: app.spotifyApi.user.display_name || app.spotifyApi.user.id });
    return rows;
  };
  const view = new StaticList({ title: 'About', items: build(null) });
  window.ipod.system
    .info(app.store.musicFolders()[0])
    .then((info) => view.setItems(build(info)))
    .catch(() => {});
  return view;
}

// --------------------------------------------------------------- playback --

function playbackSettings(app) {
  const { store } = app;
  return new ListView({
    title: 'Playback',
    items: () => [
      choiceItem(app, 'Crossfade', 'crossfade', [
        [0, 'Off (Gapless)'],
        [2, '2 Seconds'],
        [4, '4 Seconds'],
        [6, '6 Seconds'],
        [8, '8 Seconds'],
        [12, '12 Seconds'],
      ]),
      choiceItem(app, 'Audiobook Speed', 'audiobookSpeed', [
        [0.75, 'Slower'],
        [1, 'Normal'],
        [1.25, 'Faster'],
        [1.5, '1.5×'],
        [2, '2×'],
      ]),
      choiceItem(app, 'Podcast Speed', 'podcastSpeed', [
        [0.75, '0.75×'],
        [1, 'Normal'],
        [1.25, '1.25×'],
        [1.5, '1.5×'],
        [1.75, '1.75×'],
        [2, '2×'],
      ]),
      cycleItem(store, 'Hold Select', 'holdSelect', [
        ['options', 'Options'],
        ['otg', 'On-The-Go'],
      ]),
      cycleItem(store, 'Visualizer', 'visualizer', ON_OFF),
      cycleItem(store, 'Compilations', 'compilations', ON_OFF, (v) => {
        store.set('compilations', v);
        store.setIn('musicMenu', 'compilations', v);
      }),
      cycleItem(store, 'Wheel Speed', 'wheelSpeed', [
        ['low', 'Slow'],
        ['medium', 'Normal'],
        ['high', 'Fast'],
      ]),
    ],
  });
}

function eqMenu(app) {
  const { store } = app;
  const names = Object.keys(EQ_PRESETS);
  return new ListView({
    title: 'EQ',
    refreshOnEnter: true,
    selected: Math.max(0, [...names, 'Custom'].indexOf(store.settings.eq)),
    items: () => [
      ...names.map((n) => ({ label: n, checked: () => store.settings.eq === n, action: () => (store.set('eq', n), setTimeout(() => app.os.pop(), 140)) })),
      { label: 'Custom', checked: () => store.settings.eq === 'Custom', action: () => (store.set('eq', 'Custom'), setTimeout(() => app.os.pop(), 140)) },
      { label: 'Edit Custom EQ…', view: () => new EqEditor(app) },
    ],
  });
}

/** Ten-band EQ: Select moves between bands, the wheel sets the level, ▶❚❚ resets. */
class EqEditor extends View {
  constructor(app) {
    super({ title: 'Custom EQ' });
    this.app = app;
    this.band = 0;
  }
  get className() {
    return 'eq-editor';
  }
  render() {
    this.bars = EQ_BANDS.map((f) => {
      const fill = h('div', { class: 'eq-fill' });
      const col = h('div', { class: 'eq-col' }, h('div', { class: 'eq-track' }, h('div', { class: 'eq-zero' }), fill), h('div', { class: 'eq-f', text: f >= 1000 ? `${f / 1000}k` : String(f) }));
      return { col, fill };
    });
    this.readout = h('div', { class: 'eq-readout' });
    this.el.replaceChildren(h('div', { class: 'eq-cols' }, ...this.bars.map((b) => b.col)), this.readout, h('div', { class: 'eq-hint', text: 'Select: next band · ▶❚❚: reset' }));
    if (this.app.store.settings.eq !== 'Custom') this.app.store.set('eq', 'Custom');
    this.paint();
  }
  get gains() {
    return this.app.store.settings.customEq;
  }
  paint() {
    this.bars.forEach((b, i) => {
      const g = this.gains[i] || 0;
      const pct = (Math.abs(g) / 12) * 50;
      b.fill.style.height = `${pct}%`;
      b.fill.style.top = g >= 0 ? `${50 - pct}%` : '50%';
      b.col.classList.toggle('on', i === this.band);
    });
    const g = this.gains[this.band] || 0;
    const f = EQ_BANDS[this.band];
    this.readout.textContent = `${f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`}   ${g > 0 ? '+' : ''}${g.toFixed(1)} dB`;
  }
  onScroll(dir) {
    const gains = this.gains.slice();
    const v = clamp(Math.round(((gains[this.band] || 0) + dir * 0.5) * 2) / 2, -12, 12);
    if (v === gains[this.band]) return false;
    gains[this.band] = v;
    this.app.store.set('customEq', gains);
    this.paint();
    return true;
  }
  onSelect() {
    this.band = (this.band + 1) % EQ_BANDS.length;
    this.paint();
  }
  onNext() {
    this.onSelect();
    return true;
  }
  onPrev() {
    this.band = (this.band + EQ_BANDS.length - 1) % EQ_BANDS.length;
    this.paint();
    return true;
  }
  onPlay() {
    this.app.store.set('customEq', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    this.paint();
    return true;
  }
}

function lyricsSettings(app) {
  const { store } = app;
  return new ListView({
    title: 'Lyrics',
    items: () => [
      cycleItem(store, 'Show Lyrics', 'lyrics', ON_OFF),
      cycleItem(store, 'Find Lyrics Online', 'lyricsOnline', ON_OFF),
      { label: 'Lyrics come from LRCLIB', disabled: true, arrow: false },
    ],
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

// ---------------------------------------------------------------- library --

function short(p) {
  if (!p) return 'None';
  return p.split(/[\\/]/).filter(Boolean).pop();
}

function librarySettings(app) {
  const { store, library } = app;
  const chooseFolder = (title) => window.ipod.system.chooseFolder(title);
  const folderItem = (label, key, fallback, after) => ({
    label,
    value: () => short(store.settings[key] || fallback || ''),
    arrow: false,
    action: async () => {
      const f = await chooseFolder(`Choose your ${label.replace(/ Folder.*/, '').toLowerCase()} folder`);
      if (f) store.set(key, f);
      if (after) after();
      view.refresh();
    },
  });
  const view = new ListView({
    title: 'Music Library',
    refreshOnEnter: true,
    items: () => {
      const folders = store.musicFolders();
      const items = [{ label: 'Music Folders', header: true }];
      for (const f of folders) {
        items.push({
          label: short(f),
          value: '',
          arrow: false,
          action: () =>
            showSheet(app.os, {
              title: f,
              items: [
                {
                  label: 'Remove Folder',
                  action: () => {
                    store.set(
                      'folders',
                      folders.filter((x) => x !== f)
                    );
                    view.refresh();
                    library.scan();
                  },
                },
              ],
            }),
        });
      }
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
      items.push({ label: 'Library', header: true });
      items.push({ label: 'Update Library', view: () => new ScanView(app) });
      items.push(cycleItem(store, 'Update Automatically', 'autoUpdateLibrary', ON_OFF));
      items.push({ label: 'Get Album Artwork', view: () => new ArtworkView(app) });
      items.push(cycleItem(store, 'Artwork Automatically', 'autoArtwork', ON_OFF));
      items.push({ label: 'Other Folders', header: true });
      items.push(folderItem('Photos Folder…', 'photosFolder', store.env.defaults.pictures, () => app.media.invalidate()));
      items.push(folderItem('Videos Folder…', 'videosFolder', store.env.defaults.videos, () => app.media.invalidate()));
      items.push(folderItem('Notes Folder…', 'notesFolder'));
      items.push(folderItem('Contacts Folder…', 'contactsFolder'));
      items.push(folderItem('Calendars Folder…', 'calendarsFolder'));
      return items;
    },
  });
  return view;
}

/** "Get Album Artwork" with progress. */
class ArtworkView extends View {
  constructor(app) {
    super({ title: 'Album Artwork' });
    this.app = app;
  }
  get className() {
    return 'scan-view';
  }
  render() {
    this.label = h('div', { text: 'Getting album artwork…' });
    this.fill = h('div', { class: 'np-fill' });
    this.detail = h('small', { text: 'Looking for albums without artwork' });
    this.el.replaceChildren(this.label, h('div', { class: 'np-bar' }, this.fill), this.detail);
    this._off = window.ipod.library.onArtProgress((p) => {
      if (!this.mounted) return;
      if (p.total) this.fill.style.width = `${(p.done / p.total) * 100}%`;
      this.detail.textContent = p.finished ? `Found artwork for ${p.found} of ${p.total} albums` : p.album ? `${p.album} (${p.done + 1} of ${p.total})` : '';
      if (p.finished) {
        this.label.textContent = p.total ? 'Done' : 'All albums have artwork';
        this.fill.style.width = '100%';
      }
    });
    if (!this.started) {
      this.started = true;
      window.ipod.library
        .fillArtwork()
        .then(() => this.app.library.reload())
        .catch((err) => (this.detail.textContent = err.message));
    }
  }
  onUnmount() {
    if (this._off) this._off();
  }
}

// ---------------------------------------------------------------- spotify --

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
        items.push({ label: 'This iPod as a Speaker', value: spotify.sdk.ready ? 'Ready' : spotify.sdk.supported ? 'Starting' : 'Unavailable', arrow: false });
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

function radioSettings(app) {
  const { store } = app;
  return new ListView({
    title: 'Radio',
    items: () => [
      {
        label: 'Local Stations From',
        value: () => app.radio.localCountry(),
        view: () =>
          new ListView({
            title: 'Country',
            index: true,
            items: [
              { label: 'Automatic', checked: () => !store.settings.radioCountry, action: () => (store.set('radioCountry', null), app.os.pop()) },
              ...CITY_COUNTRIES.map(([code, name]) => ({ label: name, sortName: name, value: code, checked: () => store.settings.radioCountry === code, action: () => (store.set('radioCountry', code), app.os.pop()) })),
            ],
          }),
      },
      {
        label: 'Clear Recently Played',
        arrow: false,
        action: () => {
          store.user.radioRecent = [];
          store.touchUser('radio');
          app.os.alert('Cleared', 900);
        },
      },
      { label: 'Stations from radio-browser.info', disabled: true, arrow: false },
    ],
  });
}

// ------------------------------------------------------------- appearance --

function appearanceSettings(app) {
  const { store } = app;
  const model = getModel(store.settings.model);
  return new ListView({
    title: 'Appearance',
    refreshOnEnter: true,
    items: () => [
      choiceItem(app, 'Color', 'color', [...model.colors.map((c) => [c.id, c.name]), ['custom', 'Custom']]),
      { label: 'Custom Colors…', view: () => new ColorEditor(app) },
      choiceItem(
        app,
        'Size',
        'size',
        SIZES.map((s) => [s.id, s.name])
      ),
      {
        label: 'Engraving…',
        value: () => (store.settings.engraving ? '✓' : 'None'),
        arrow: false,
        action: async () => {
          const v = await askText(app, { title: 'Engraving', prompt: 'Engraved on the back of your iPod. Use | for a new line.', value: store.settings.engraving.replace(/\n/g, '|'), max: 70, allowEmpty: true });
          if (v === null) return;
          store.set('engraving', v.split('|').map((l) => l.trim()).filter(Boolean).slice(0, 2).join('\n'));
          app.device.flip(true);
        },
      },
      { label: 'Flip iPod', arrow: false, action: () => app.device.flip() },
      choiceItem(app, 'Motion', 'motion', [
        ['cursor', 'Follow Pointer'],
        ['hover', 'Only on Hover'],
        ['off', 'Off'],
      ]),
      cycleItem(store, 'Motion Amount', 'motionAmount', [
        ['subtle', 'Subtle'],
        ['normal', 'Normal'],
        ['dramatic', 'Dramatic'],
      ]),
      cycleItem(store, 'Reflections', 'reflections', ON_OFF),
      cycleItem(store, 'Back', 'backFinish', [
        ['auto', 'Auto'],
        ['steel', 'Polished Steel'],
        ['black', 'Black'],
      ]),
      cycleItem(store, 'Wear', 'wear', [
        ['none', 'Brand New'],
        ['light', 'A Few Months'],
        ['worn', 'Well Loved'],
      ]),
      cycleItem(store, 'Float When Idle', 'idleFloat', ON_OFF),
      cycleItem(store, 'Shadow', 'shadow', ON_OFF),
      cycleItem(store, 'Wheel Glow', 'wheelGlow', ON_OFF),
      cycleItem(store, 'Startup Animation', 'startupAnimation', ON_OFF),
    ],
  });
}

// ---------------------------------------------------------------- desktop --

function desktopSettings(app) {
  const { store } = app;
  return new ListView({
    title: 'Desktop',
    items: () => [
      cycleItem(store, 'Always on Top', 'alwaysOnTop', ON_OFF),
      cycleItem(store, 'Show in Taskbar', 'showInTaskbar', ON_OFF),
      cycleItem(store, 'Start with Windows', 'openAtLogin', ON_OFF),
      cycleItem(store, 'Start Hidden in Tray', 'startHidden', ON_OFF),
      cycleItem(store, 'Snap to Screen Edges', 'snapToEdges', ON_OFF),
      cycleItem(store, 'Song Notifications', 'notifications', ON_OFF),
      { label: 'Global Shortcuts', view: () => shortcutsView(app) },
      choiceItem(app, 'Opacity', 'opacity', [
        [1, '100%'],
        [0.9, '90%'],
        [0.8, '80%'],
        [0.65, '65%'],
        [0.5, '50%'],
      ]),
      { label: 'Open Logs Folder', arrow: false, action: () => window.ipod.system.openLogs() },
      { label: 'Hide iPod', arrow: false, action: () => window.ipod.win.hide() },
      { label: 'Quit', arrow: false, action: () => app.shutdown() },
    ],
  });
}

function shortcutsView(app) {
  const { store } = app;
  const rows = [
    ['Ctrl+Alt+Space', 'Play / Pause'],
    ['Ctrl+Alt+→', 'Next'],
    ['Ctrl+Alt+←', 'Previous'],
    ['Ctrl+Alt+↑', 'Volume Up'],
    ['Ctrl+Alt+↓', 'Volume Down'],
    ['Ctrl+Alt+I', 'Show / Hide'],
  ];
  return new ListView({
    title: 'Global Shortcuts',
    items: () => [cycleItem(store, 'Enabled', 'globalShortcuts', ON_OFF), ...rows.map(([k, v]) => ({ label: v, value: k, arrow: false }))],
  });
}

// ----------------------------------------------------------------- backup --

function backupSettings(app) {
  return new ListView({
    title: 'Backup & Restore',
    items: [
      {
        label: 'Back Up Settings…',
        arrow: false,
        action: async () => {
          const ok = await window.ipod.state.exportFile(app.store.exportData());
          if (ok) app.os.alert('Backup saved', 1200);
        },
      },
      {
        label: 'Restore from Backup…',
        arrow: false,
        action: async () => {
          const text = await window.ipod.state.importFile();
          if (!text) return;
          try {
            app.store.importData(text);
            app.rebuild();
            app.os.alert('Restored', 1200);
          } catch (err) {
            app.os.alert(err.message || 'That backup couldn’t be read.');
          }
        },
      },
      { label: 'Includes settings, playlists,', disabled: true, arrow: false },
      { label: 'ratings, podcasts and radio.', disabled: true, arrow: false },
    ],
  });
}

// ---------------------------------------------------------------- updates --

class UpdateView extends View {
  constructor(app) {
    super({ title: 'Software Update' });
    this.app = app;
    this.status = { state: 'idle' };
  }
  get className() {
    return 'scan-view';
  }
  render() {
    this.label = h('div');
    this.fill = h('div', { class: 'np-fill' });
    this.bar = h('div', { class: 'np-bar' }, this.fill);
    this.detail = h('small');
    this.el.replaceChildren(this.label, this.bar, this.detail);
    this._off = window.ipod.updates.onStatus((s) => this.paint(s));
    window.ipod.updates.status().then((s) => {
      this.paint(s);
      if (s.state === 'idle' || s.state === 'current' || s.state === 'error') window.ipod.updates.check();
    });
  }
  onUnmount() {
    if (this._off) this._off();
  }
  paint(s) {
    this.status = s;
    const v = this.app.store.env.version;
    const map = {
      unsupported: ['Updates', `Version ${v}. Automatic updates work in the installed version of the app.`],
      idle: ['Checking for updates…', ''],
      checking: ['Checking for updates…', ''],
      current: ['Your iPod is up to date', `Version ${v}`],
      downloading: [`Downloading ${s.version || 'update'}…`, `${s.percent || 0}%`],
      ready: [`Version ${s.version} is ready`, 'Press Select to restart and install'],
      error: ['Couldn’t check for updates', s.message || ''],
    };
    const [a, b] = map[s.state] || map.idle;
    this.label.textContent = a;
    this.detail.textContent = b;
    this.bar.style.visibility = s.state === 'downloading' ? 'visible' : 'hidden';
    this.fill.style.width = `${s.percent || 0}%`;
  }
  onSelect() {
    if (this.status.state === 'ready') window.ipod.updates.install();
    else window.ipod.updates.check();
  }
}
