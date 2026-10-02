'use strict';

/**
 * The iPod window: frameless, transparent, sized to the device. Handles
 * dragging (with magnetic snapping to screen edges), click-through over the
 * transparent margin, resizing around the centre, and window preferences.
 */

const { BrowserWindow, screen, shell, app } = require('electron');

const SNAP = 18;

class IpodWindow {
  constructor({ state, preload, icon, dev, devTools }) {
    this.state = state;
    this.preload = preload;
    this.icon = icon;
    this.dev = dev;
    this.devTools = devTools;
    this.win = null;
    this.pad = 0;
    this.dragTimer = null;
    this.canClickThrough = process.platform === 'win32' || process.platform === 'darwin';
  }

  get prefs() {
    return this.state.get('window', {});
  }

  create({ hidden = false } = {}) {
    const prefs = this.prefs;
    const bounds = this._savedBounds() || { width: 350, height: 550 };
    const win = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: true,
      fullscreenable: false,
      thickFrame: false,
      skipTaskbar: prefs.showInTaskbar === false,
      alwaysOnTop: prefs.alwaysOnTop !== false,
      title: 'iPod',
      icon: this.icon,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: this.devTools,
      },
    });
    this.win = win;
    if (prefs.opacity) win.setOpacity(prefs.opacity);
    if (prefs.alwaysOnTop !== false) win.setAlwaysOnTop(true, 'floating');

    win.once('ready-to-show', () => {
      if (!hidden) win.show();
      if (this.dev) win.webContents.openDevTools({ mode: 'detach' });
    });
    win.on('moved', () => this.persistBounds());
    win.on('blur', () => this.stopDrag());
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('app://')) e.preventDefault();
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    if (!this.dev) {
      win.webContents.on('before-input-event', (e, input) => {
        const k = input.key.toLowerCase();
        if ((input.control || input.meta) && (k === 'r' || k === 'w' || (input.shift && k === 'i'))) e.preventDefault();
        if (input.key === 'F5' || input.key === 'F12') e.preventDefault();
      });
    }
    // Recover from renderer crashes instead of leaving an invisible window.
    win.webContents.on('render-process-gone', (_e, details) => {
      if (details.reason !== 'clean-exit') setTimeout(() => !win.isDestroyed() && win.reload(), 600);
    });
    win.loadURL('app://ipod/index.html');
    return win;
  }

  _savedBounds() {
    const b = this.state.get('bounds');
    if (!b || !b.width) return null;
    const wa = screen.getDisplayMatching(b).workArea;
    const x = Math.min(Math.max(b.x, wa.x - b.width + 80), wa.x + wa.width - 80);
    const y = Math.min(Math.max(b.y, wa.y - 40), wa.y + wa.height - 80);
    return { ...b, x, y };
  }

  persistBounds() {
    if (this.win && !this.win.isDestroyed()) this.state.set('bounds', this.win.getBounds());
  }

  show() {
    const w = this.win;
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }

  toggle() {
    const w = this.win;
    if (!w) return;
    if (w.isVisible() && !w.isMinimized()) w.hide();
    else this.show();
  }

  ignoreMouse(ignore) {
    if (!this.win || !this.canClickThrough || this.dragTimer) return;
    this.win.setIgnoreMouseEvents(!!ignore, { forward: true });
  }

  startDrag() {
    const w = this.win;
    if (!w) return;
    this.stopDrag();
    const cursor = screen.getCursorScreenPoint();
    const b = w.getBounds();
    const off = { x: cursor.x - b.x, y: cursor.y - b.y };
    const snap = this.prefs.snapToEdges !== false;
    this.dragTimer = setInterval(() => {
      if (!w || w.isDestroyed()) return this.stopDrag();
      const p = screen.getCursorScreenPoint();
      let x = p.x - off.x;
      let y = p.y - off.y;
      if (snap) {
        const wa = screen.getDisplayNearestPoint(p).workArea;
        const pad = this.pad;
        const left = x + pad;
        const right = x + b.width - pad;
        const top = y + pad;
        const bottom = y + b.height - pad;
        if (Math.abs(left - wa.x) < SNAP) x = wa.x - pad;
        else if (Math.abs(right - (wa.x + wa.width)) < SNAP) x = wa.x + wa.width - b.width + pad;
        if (Math.abs(top - wa.y) < SNAP) y = wa.y - pad;
        else if (Math.abs(bottom - (wa.y + wa.height)) < SNAP) y = wa.y + wa.height - b.height + pad;
      }
      w.setBounds({ x, y, width: b.width, height: b.height });
    }, 1000 / 120);
  }

  stopDrag() {
    if (!this.dragTimer) return;
    clearInterval(this.dragTimer);
    this.dragTimer = null;
    this.persistBounds();
  }

  resize({ width, height, pad = 0 }) {
    const w = this.win;
    if (!w) return;
    this.pad = Math.max(0, pad | 0);
    width = Math.round(Math.max(120, Math.min(width, 2400)));
    height = Math.round(Math.max(160, Math.min(height, 2400)));
    const b = w.getBounds();
    if (b.width === width && b.height === height) return;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const wa = screen.getDisplayMatching(b).workArea;
    let x = Math.round(cx - width / 2);
    let y = Math.round(cy - height / 2);
    x = Math.min(Math.max(x, wa.x - width / 2), wa.x + wa.width - width / 2);
    y = Math.min(Math.max(y, wa.y - this.pad), wa.y + wa.height - 60);
    w.setBounds({ x, y, width, height }, false);
    this.persistBounds();
  }

  applyPrefs(patch) {
    const prefs = { ...this.prefs, ...patch };
    this.state.set('window', prefs);
    const w = this.win;
    if (!w) return prefs;
    if ('alwaysOnTop' in patch) w.setAlwaysOnTop(!!prefs.alwaysOnTop, 'floating');
    if ('showInTaskbar' in patch) w.setSkipTaskbar(prefs.showInTaskbar === false);
    if ('opacity' in patch) w.setOpacity(Math.min(1, Math.max(0.3, prefs.opacity || 1)));
    if ('openAtLogin' in patch && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: !!prefs.openAtLogin, args: prefs.startHidden ? ['--hidden'] : [] });
    }
    return prefs;
  }
}

/** The small "Connect Spotify" window. */
function createSetupWindow({ preload, icon, dev }) {
  const w = new BrowserWindow({
    width: 520,
    height: 790,
    resizable: false,
    maximizable: false,
    minimizable: false,
    title: 'Connect Spotify',
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    icon,
    webPreferences: { preload, contextIsolation: true, sandbox: true, devTools: dev },
  });
  w.setMenu(null);
  w.loadURL('app://ipod/setup.html');
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return w;
}

module.exports = { IpodWindow, createSetupWindow };
