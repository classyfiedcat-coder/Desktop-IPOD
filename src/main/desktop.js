'use strict';

/**
 * Desktop integration: the tray (Windows) or menu bar (Mac) icon and menus,
 * global shortcuts, track-change notifications, and on Windows the taskbar
 * thumbnail buttons, jump-list tasks and command-line arguments (Open With,
 * jump-list commands).
 */

const fs = require('fs');
const path = require('path');
const { app, Tray, Menu, nativeImage, globalShortcut, Notification } = require('electron');
const { log } = require('./log');

const AUDIO_RE = /\.(mp3|m4a|m4b|aac|flac|wav|ogg|oga|opus|weba)$/i;

const IS_MAC = process.platform === 'darwin';
// Ctrl+Alt on Windows. On a Mac, ⌘⌥ + arrows switches tabs in most apps, so
// it's ⌃⌥⌘ there.
const MOD = IS_MAC ? 'Control+Alt+Command' : 'Control+Alt';
const SHORTCUTS = [
  [`${MOD}+Space`, 'playpause'],
  [`${MOD}+Right`, 'next'],
  [`${MOD}+Left`, 'prev'],
  [`${MOD}+Up`, 'volup'],
  [`${MOD}+Down`, 'voldown'],
  [`${MOD}+I`, 'toggle'],
];

/** Pull iPod commands and audio file paths out of a command line. */
function parseArgs(argv, cwd = process.cwd()) {
  const out = { commands: [], files: [], hidden: false };
  for (const a of argv.slice(1)) {
    if (a === '--hidden') out.hidden = true;
    const m = /^--ipod-command=(\w+)$/.exec(a);
    if (m) out.commands.push(m[1]);
    else if (!a.startsWith('-') && AUDIO_RE.test(a)) {
      const p = path.isAbsolute(a) ? a : path.resolve(cwd, a);
      if (fs.existsSync(p)) out.files.push(p);
    }
  }
  return out;
}

class Desktop {
  constructor({ ipodWindow, assets, command, openSetup, updater, logDir, library }) {
    this.w = ipodWindow;
    this.assets = assets;
    this.command = command;
    this.openSetup = openSetup;
    this.updater = updater;
    this.logDir = logDir;
    this.library = library;
    this.tray = null;
    this.np = { title: '', artist: '', playing: false, has: false };
    this.prefs = { notifications: false, globalShortcuts: true, color: 'white', size: 'medium', motion: 'cursor' };
    this._lastNotified = null;
    this._thumbKey = null;
  }

  icon(name) {
    const p = path.join(this.assets, name);
    return fs.existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
  }

  init() {
    this._tray();
    this._jumpList();
    this.applyPrefs(this.prefs);
    // Windows drops taskbar buttons when a window is hidden and shown again.
    const win = this.w.win;
    if (win) {
      win.on('show', () => {
        this._thumbKey = null;
        this._thumbar();
      });
    }
  }

  // ---------------------------------------------------------------- menus --

  menuTemplate() {
    const prefs = this.w.prefs;
    const np = this.np;
    const radio = (label, key, value) => ({
      label,
      type: 'radio',
      checked: this.prefs[key] === value,
      click: () => this.command(`set:${key}:${value}`),
    });
    const upd = this.updater.status;
    const updLabel =
      upd.state === 'ready'
        ? `Restart to Update (${upd.version})`
        : upd.state === 'downloading'
          ? `Downloading Update… ${upd.percent || 0}%`
          : upd.state === 'available'
            ? `Download iPod ${upd.version}…`
            : 'Check for Updates…';
    const updClick = () => {
      if (upd.state === 'ready') this.updater.install();
      else if (upd.state === 'available' && upd.url) require('electron').shell.openExternal(upd.url);
      else this.updater.check();
    };
    return [
      ...(np.has ? [{ label: `${np.playing ? '▶' : '❚❚'}  ${trim(np.title, 40)}${np.artist ? ` — ${trim(np.artist, 28)}` : ''}`, enabled: false }, { type: 'separator' }] : []),
      { label: this.w.win && this.w.win.isVisible() ? 'Hide iPod' : 'Show iPod', click: () => this.w.toggle() },
      { type: 'separator' },
      { label: np.playing ? 'Pause' : 'Play', click: () => this.command('playpause') },
      { label: 'Next Track', click: () => this.command('next') },
      { label: 'Previous Track', click: () => this.command('prev') },
      { type: 'separator' },
      { label: 'Now Playing', click: () => this.command('nowplaying') },
      { label: 'Settings', click: () => this.command('settings') },
      {
        label: 'Color',
        submenu: [radio('White', 'color', 'white'), radio('Black', 'color', 'black'), radio('U2 Special Edition', 'color', 'u2'), radio('Custom…', 'color', 'custom'), { type: 'separator' }, { label: 'Edit Custom Colors…', click: () => this.command('colors') }],
      },
      {
        label: 'Size',
        submenu: [radio('Small', 'size', 'small'), radio('Medium', 'size', 'medium'), radio('Large', 'size', 'large'), radio('Extra Large', 'size', 'xl')],
      },
      {
        label: 'Motion',
        submenu: [radio('Follow Pointer', 'motion', 'cursor'), radio('Only on Hover', 'motion', 'hover'), radio('Off', 'motion', 'off')],
      },
      { label: 'Flip iPod', click: () => this.command('flip') },
      { label: 'Spotify…', click: () => this.openSetup() },
      { type: 'separator' },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: prefs.alwaysOnTop !== false,
        click: (item) => {
          this.w.applyPrefs({ alwaysOnTop: item.checked });
          this.command('prefs-changed');
        },
      },
      {
        label: 'Snap to Screen Edges',
        type: 'checkbox',
        checked: prefs.snapToEdges !== false,
        click: (item) => {
          this.w.applyPrefs({ snapToEdges: item.checked });
          this.command('prefs-changed');
        },
      },
      { label: 'Hold Switch', click: () => this.command('hold') },
      { label: 'Minimize', click: () => this.w.win && this.w.win.minimize() },
      { type: 'separator' },
      { label: updLabel, enabled: this.updater.supported || this.updater.canNotify, click: updClick },
      { label: 'Open Logs Folder', click: () => this.logDir && require('electron').shell.openPath(this.logDir) },
      { type: 'separator' },
      { label: 'Quit iPod', click: () => this.command('quit') },
    ];
  }

  popup() {
    if (!this.w.win) return;
    Menu.buildFromTemplate(this.menuTemplate()).popup({ window: this.w.win });
  }

  _tray() {
    // Mac: a template image, which the menu bar colours for light and dark.
    let img = this.icon(IS_MAC ? 'trayTemplate.png' : 'tray.png');
    if (img.isEmpty()) img = this.icon('icon.png').resize({ width: 16, height: 16 });
    if (IS_MAC) img.setTemplateImage(true);
    this.tray = new Tray(img);
    this.tray.setToolTip('iPod');
    const refresh = () => this.tray.setContextMenu(Menu.buildFromTemplate(this.menuTemplate()));
    refresh();
    // On a Mac clicking a menu bar icon opens its menu; on Windows it shows or hides the iPod.
    if (!IS_MAC) this.tray.on('click', () => this.w.toggle());
    this.tray.on('right-click', refresh);
    this.tray.on('mouse-enter', refresh);
    this._refreshTray = refresh;
  }

  // ------------------------------------------------------- now playing state --

  setNowPlaying(np) {
    const changed = np.title !== this.np.title || np.artist !== this.np.artist;
    this.np = { ...np, has: !!np.title };
    if (this.tray) this.tray.setToolTip(np.title ? trim(`${np.title}${np.artist ? ` — ${np.artist}` : ''}`, 120) : 'iPod');
    this._thumbar();
    if (changed && np.title && np.playing) this._notify(np);
  }

  _thumbar() {
    const win = this.w.win;
    if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
    const np = this.np;
    // Only touch the buttons when play/pause actually changed (radio titles update often).
    const key = np.playing ? 'pause' : 'play';
    if (key === this._thumbKey) return;
    this._thumbKey = key;
    try {
      win.setThumbarButtons([
        { tooltip: 'Previous', icon: this.icon('thumb-prev.png'), click: () => this.command('prev') },
        { tooltip: np.playing ? 'Pause' : 'Play', icon: this.icon(np.playing ? 'thumb-pause.png' : 'thumb-play.png'), click: () => this.command('playpause') },
        { tooltip: 'Next', icon: this.icon('thumb-next.png'), click: () => this.command('next') },
      ]);
    } catch (err) {
      log.warn('[desktop] thumbar', err.message);
    }
  }

  async _notify(np) {
    if (!this.prefs.notifications || !Notification.isSupported()) return;
    const win = this.w.win;
    if (win && win.isVisible() && win.isFocused()) return;
    const key = `${np.title}\u0000${np.artist}`;
    if (key === this._lastNotified) return;
    this._lastNotified = key;
    let icon;
    try {
      if (np.artKey && this.library) {
        const file = await this.library.artFile(np.artKey);
        if (file) icon = nativeImage.createFromPath(file);
      }
    } catch {
      icon = undefined;
    }
    const n = new Notification({ title: np.title, body: [np.artist, np.album].filter(Boolean).join(' — '), icon, silent: true });
    n.on('click', () => this.w.show());
    n.show();
  }

  // ------------------------------------------------------------- shortcuts --

  applyPrefs(prefs) {
    this.prefs = { ...this.prefs, ...prefs };
    globalShortcut.unregisterAll();
    if (this.prefs.globalShortcuts) {
      for (const [accel, cmd] of SHORTCUTS) {
        try {
          if (!globalShortcut.register(accel, () => (cmd === 'toggle' ? this.w.toggle() : this.command(cmd)))) log.warn('[desktop] shortcut taken', accel);
        } catch (err) {
          log.warn('[desktop] shortcut failed', accel, err.message);
        }
      }
    }
    if (this._refreshTray) this._refreshTray();
  }

  _jumpList() {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    const task = (cmd, title, description) => ({ program: process.execPath, arguments: `--ipod-command=${cmd}`, iconPath: process.execPath, iconIndex: 0, title, description });
    try {
      app.setUserTasks([
        task('playpause', 'Play / Pause', 'Play or pause music'),
        task('next', 'Next Track', 'Skip to the next song'),
        task('prev', 'Previous Track', 'Go back a song'),
        task('shuffle', 'Shuffle Songs', 'Shuffle your whole library'),
      ]);
    } catch (err) {
      log.warn('[desktop] jump list', err.message);
    }
  }

  dispose() {
    globalShortcut.unregisterAll();
    if (this.tray) this.tray.destroy();
  }
}

function trim(s, n) {
  s = String(s || '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

module.exports = { Desktop, parseArgs, SHORTCUTS };
