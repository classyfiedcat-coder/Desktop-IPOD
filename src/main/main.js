'use strict';

const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  Tray,
  Menu,
  nativeImage,
  screen,
  shell,
  dialog,
  session,
} = require('electron');

const { JsonStore } = require('./store');
const { Library } = require('./library');
const { MediaServer } = require('./media');
const { SpotifyAuth } = require('./spotify-auth');

const DEV = process.argv.includes('--dev');
const ROOT = path.join(__dirname, '..', '..');
const RENDERER_DIR = path.join(ROOT, 'src', 'renderer');
const ASSETS = path.join(ROOT, 'src', 'assets');
const CAN_CLICK_THROUGH = process.platform === 'win32' || process.platform === 'darwin';
// Development-only automation hook (scripts/e2e.js); never active in packaged builds.
const TEST_HOOK = !app.isPackaged && !!process.env.IPOD_E2E;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true },
  },
]);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('iPod');
if (process.env.IPOD_USER_DATA) app.setPath('userData', path.resolve(process.env.IPOD_USER_DATA));
if (process.platform === 'win32') app.setAppUserModelId('com.ipoddesktop.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

let win = null;
let tray = null;
let setupWin = null;
let state;
let library;
let mediaServer;
let spotify;
let dragTimer = null;
let quitting = false;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  if (setupWin && !setupWin.isDestroyed()) setupWin.webContents.send(channel, payload);
}

function command(name) {
  if (!win) return;
  if (name === 'show') return showWindow();
  showWindow();
  win.webContents.send('app:command', name);
}

function iconImage(name) {
  const p = path.join(ASSETS, name);
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
}

function savedBounds() {
  const b = state.get('bounds');
  if (!b) return null;
  const display = screen.getDisplayMatching(b);
  const wa = display.workArea;
  // Keep at least part of the iPod on screen if monitors changed.
  const x = Math.min(Math.max(b.x, wa.x - b.width + 80), wa.x + wa.width - 80);
  const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - 80);
  return { ...b, x, y };
}

function createWindow() {
  const prefs = state.get('window', {});
  const bounds = savedBounds() || { width: 320, height: 500 };
  win = new BrowserWindow({
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
    icon: iconImage(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      devTools: DEV || TEST_HOOK,
    },
  });
  if (prefs.opacity) win.setOpacity(prefs.opacity);

  win.once('ready-to-show', () => {
    win.show();
    if (DEV) win.webContents.openDevTools({ mode: 'detach' });
  });
  win.on('moved', () => persistBounds());
  win.on('close', () => {
    quitting = true;
  });
  win.on('closed', () => {
    win = null;
    app.quit();
  });
  win.on('blur', () => stopDrag());
  // A frameless window can still get the native system menu on Windows.
  win.on('system-context-menu', (e) => {
    e.preventDefault();
    showContextMenu();
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (!DEV) {
    win.webContents.on('before-input-event', (e, input) => {
      const k = input.key.toLowerCase();
      if ((input.control || input.meta) && (k === 'r' || k === 'w' || (input.shift && k === 'i'))) e.preventDefault();
      if (input.key === 'F5' || input.key === 'F12') e.preventDefault();
    });
  }

  win.loadURL('app://ipod/index.html');

  if (TEST_HOOK) {
    win.webContents.once('did-finish-load', () => {
      require(path.resolve(process.env.IPOD_E2E))({ app, win, ipcMain, state });
    });
  }
}

function persistBounds() {
  if (!win || win.isDestroyed()) return;
  state.set('bounds', win.getBounds());
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) win.hide();
  else showWindow();
}

function stopDrag() {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
    persistBounds();
  }
}

function buildMenuTemplate() {
  const prefs = state.get('window', {});
  return [
    { label: win && win.isVisible() ? 'Hide iPod' : 'Show iPod', click: toggleWindow },
    { type: 'separator' },
    { label: 'Play / Pause', click: () => command('playpause') },
    { label: 'Next Track', click: () => command('next') },
    { label: 'Previous Track', click: () => command('prev') },
    { type: 'separator' },
    { label: 'Now Playing', click: () => command('nowplaying') },
    { label: 'Settings', click: () => command('settings') },
    { label: 'Change Design…', click: () => command('appearance') },
    { label: 'Spotify…', click: () => openSetupWindow() },
    { type: 'separator' },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: prefs.alwaysOnTop !== false,
      click: (item) => {
        applyWindowPrefs({ alwaysOnTop: item.checked });
        send('win:prefs', state.get('window', {}));
      },
    },
    {
      label: 'Hold Switch',
      click: () => command('hold'),
    },
    { label: 'Minimize', click: () => win && win.minimize() },
    { type: 'separator' },
    { label: 'Quit iPod', click: () => app.quit() },
  ];
}

function showContextMenu() {
  if (!win) return;
  Menu.buildFromTemplate(buildMenuTemplate()).popup({ window: win });
}

function createTray() {
  let img = iconImage('tray.png');
  if (img.isEmpty()) img = iconImage('icon.png').resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('iPod');
  const refresh = () => tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
  refresh();
  tray.on('click', toggleWindow);
  tray.on('right-click', refresh);
  tray.on('mouse-enter', refresh);
}

function applyWindowPrefs(patch) {
  const prefs = { ...state.get('window', {}), ...patch };
  state.set('window', prefs);
  if (!win) return prefs;
  if ('alwaysOnTop' in patch) win.setAlwaysOnTop(!!prefs.alwaysOnTop, 'floating');
  if ('showInTaskbar' in patch) win.setSkipTaskbar(prefs.showInTaskbar === false);
  if ('opacity' in patch) win.setOpacity(Math.min(1, Math.max(0.3, prefs.opacity || 1)));
  if ('openAtLogin' in patch && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: !!prefs.openAtLogin });
  }
  return prefs;
}

function openSetupWindow() {
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.show();
    setupWin.focus();
    return;
  }
  setupWin = new BrowserWindow({
    width: 520,
    height: 790,
    resizable: false,
    maximizable: false,
    minimizable: false,
    title: 'Connect Spotify',
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    icon: iconImage(process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      devTools: DEV,
    },
  });
  setupWin.setMenu(null);
  setupWin.loadURL('app://ipod/setup.html');
  setupWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  setupWin.on('closed', () => {
    setupWin = null;
  });
}

function registerIpc() {
  ipcMain.handle('state:load', () => ({
    app: state.get('app', null),
    window: state.get('window', {}),
    platform: process.platform,
    version: app.getVersion(),
    defaults: {
      music: app.getPath('music'),
      pictures: app.getPath('pictures'),
      videos: app.getPath('videos'),
      documents: app.getPath('documents'),
    },
  }));
  ipcMain.handle('state:save', (_e, data) => {
    state.set('app', data);
    return true;
  });

  ipcMain.on('win:ignore-mouse', (_e, ignore) => {
    if (!win || !CAN_CLICK_THROUGH || dragTimer) return;
    win.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  ipcMain.on('win:drag-start', () => {
    if (!win) return;
    stopDrag();
    const cursor = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const off = { x: cursor.x - b.x, y: cursor.y - b.y };
    dragTimer = setInterval(() => {
      if (!win || win.isDestroyed()) return stopDrag();
      const p = screen.getCursorScreenPoint();
      win.setBounds({ x: p.x - off.x, y: p.y - off.y, width: b.width, height: b.height });
    }, 1000 / 120);
  });
  ipcMain.on('win:drag-end', stopDrag);
  ipcMain.handle('win:resize', (_e, { width, height }) => {
    if (!win) return;
    width = Math.round(Math.max(120, Math.min(width, 2000)));
    height = Math.round(Math.max(160, Math.min(height, 2400)));
    const b = win.getBounds();
    if (b.width === width && b.height === height) return;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const wa = screen.getDisplayMatching(b).workArea;
    let x = Math.round(cx - width / 2);
    let y = Math.round(cy - height / 2);
    x = Math.min(Math.max(x, wa.x - width / 2), wa.x + wa.width - width / 2);
    y = Math.min(Math.max(y, wa.y), wa.y + wa.height - 60);
    win.setBounds({ x, y, width, height }, false);
    persistBounds();
  });
  ipcMain.handle('win:set', (_e, patch) => applyWindowPrefs(patch || {}));
  ipcMain.on('win:minimize', () => win && win.minimize());
  ipcMain.on('win:hide', () => win && win.hide());
  ipcMain.on('win:show', () => showWindow());
  ipcMain.on('win:context-menu', () => showContextMenu());
  ipcMain.on('app:quit', () => app.quit());

  ipcMain.handle('lib:get', () => library.snapshot());
  ipcMain.handle('lib:scan', async (_e, folders) => {
    const list = (Array.isArray(folders) ? folders : []).filter((f) => typeof f === 'string' && fs.existsSync(f));
    return library.scan(list, (p) => send('lib:progress', p));
  });
  ipcMain.handle('dialog:folder', async (_e, title) => {
    const res = await dialog.showOpenDialog(win, {
      title: title || 'Choose a folder',
      properties: ['openDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('media:photos', (_e, folder) => mediaServer.listPhotos(folder));
  ipcMain.handle('media:videos', (_e, folder) => mediaServer.listVideos(folder));
  ipcMain.handle('media:notes', (_e, folder) => mediaServer.listNotes(folder));
  ipcMain.handle('sys:info', async (_e, folder) => {
    let disk = null;
    try {
      const st = await fs.promises.statfs(folder || app.getPath('music'));
      disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize };
    } catch {
      /* statfs unsupported */
    }
    return { version: app.getVersion(), platform: process.platform, electron: process.versions.electron, disk };
  });

  ipcMain.handle('spotify:status', () => spotify.status());
  ipcMain.handle('spotify:set-client-id', (_e, id) => spotify.setClientId(id));
  ipcMain.handle('spotify:login', async () => {
    try {
      await spotify.login();
      showWindow();
      return { ok: true, status: spotify.status() };
    } catch (err) {
      return { ok: false, error: err.message, status: spotify.status() };
    }
  });
  ipcMain.handle('spotify:logout', () => spotify.logout());
  ipcMain.handle('spotify:token', async (_e, opts) => {
    if (opts && opts.force) spotify.invalidate();
    try {
      return await spotify.accessToken();
    } catch {
      return null;
    }
  });
  ipcMain.handle('spotify:user', (_e, user) => spotify.setUser(user));
  ipcMain.on('spotify:setup', () => openSetupWindow());
  ipcMain.on('spotify:open-app', () => shell.openExternal('spotify:'));
  ipcMain.on('shell:open', (_e, url) => {
    if (/^https:\/\/(developer|www|open|accounts)\.spotify\.com\//.test(url)) shell.openExternal(url);
  });
  ipcMain.on('setup:close', () => setupWin && setupWin.close());
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  state = new JsonStore(path.join(userData, 'state.json'), {});
  library = new Library(userData);
  mediaServer = new MediaServer({ rendererDir: RENDERER_DIR, library });
  spotify = new SpotifyAuth(userData, (status) => send('spotify:changed', status));

  protocol.handle('app', (req) => mediaServer.handle(req));

  // Allow EME (Widevine) for the Spotify Web Playback SDK when the runtime ships a CDM.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'mediaKeySystem', 'fullscreen', 'notifications'].includes(permission));
  });

  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  createTray();
});

app.on('second-instance', () => showWindow());
app.on('before-quit', () => {
  quitting = true;
  stopDrag();
  if (state) state.flush();
});
app.on('window-all-closed', () => {
  if (quitting || process.platform !== 'darwin') app.quit();
});
