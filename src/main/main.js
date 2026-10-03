'use strict';

/** Main-process entry point: wires the services together. */

const path = require('path');
const fs = require('fs');
const { app, protocol, nativeImage, session, Menu, BrowserWindow } = require('electron');

const { log } = require('./log');
const { JsonStore } = require('./store');
const { Library } = require('./library/manager');
const { Folders } = require('./folders');
const { Protocol } = require('./protocol');
const { Podcasts } = require('./podcasts');
const { Lyrics } = require('./lyrics');
const { SpotifyAuth } = require('./spotify-auth');
const { Updater } = require('./updater');
const { IpodWindow, createSetupWindow } = require('./window');
const { Desktop, parseArgs } = require('./desktop');
const { registerIpc } = require('./ipc');

const DEV = process.argv.includes('--dev');
const ROOT = path.join(__dirname, '..', '..');
const RENDERER_DIR = path.join(ROOT, 'src', 'renderer');
const ASSETS = path.join(ROOT, 'src', 'assets');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
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

const icon = () => {
  const p = path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : undefined;
};

const ctx = {
  ready: false,
  pending: [],
  setupWin: null,
  quitting: false,
};

function send(channel, payload) {
  const w = ctx.ipodWindow && ctx.ipodWindow.win;
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  if (ctx.setupWin && !ctx.setupWin.isDestroyed()) ctx.setupWin.webContents.send(channel, payload);
}
ctx.send = send;

/** Send a command to the renderer, queueing it until the UI has loaded. */
function command(name, payload) {
  if (name === 'quit') return ctx.quit(false);
  if (!ctx.ready) {
    ctx.pending.push([name, payload]);
    return;
  }
  if (!['volup', 'voldown', 'playpause', 'next', 'prev', 'prefs-changed'].includes(name) && !name.startsWith('set:')) ctx.ipodWindow.show();
  send('app:command', { name, payload });
}
ctx.command = command;

ctx.rendererReady = () => {
  ctx.ready = true;
  const queued = ctx.pending.splice(0);
  for (const [name, payload] of queued) command(name, payload);
};

ctx.openSetup = () => {
  if (ctx.setupWin && !ctx.setupWin.isDestroyed()) {
    ctx.setupWin.show();
    ctx.setupWin.focus();
    return;
  }
  ctx.setupWin = createSetupWindow({ preload: PRELOAD, icon: icon(), dev: DEV });
  ctx.setupWin.on('closed', () => {
    ctx.setupWin = null;
  });
};
ctx.closeSetup = () => ctx.setupWin && ctx.setupWin.close();

/** Quit, letting the iPod play its power-off animation first. */
ctx.quit = (animated) => {
  if (ctx.quitting) return;
  if (!animated && ctx.ready && ctx.ipodWindow.win && ctx.ipodWindow.win.isVisible()) {
    send('app:command', { name: 'shutdown' });
    setTimeout(() => ctx.quit(true), 1500);
    return;
  }
  ctx.quitting = true;
  // Give the UI a moment to save anything it hasn't yet (it debounces saves).
  if (ctx.ready) {
    send('app:command', { name: 'flush' });
    setTimeout(() => app.quit(), 150);
  } else app.quit();
};

function handleArgs(argv, cwd) {
  const args = parseArgs(argv, cwd);
  for (const c of args.commands) command(c);
  if (args.files.length) {
    ctx.library
      .openFiles(args.files)
      .then((tracks) => command('open-files', tracks))
      .catch((err) => log.warn('open files failed', err));
  }
  return args;
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  log.init(path.join(userData, 'logs'), { echo: DEV || TEST_HOOK || !app.isPackaged });
  log.info(`iPod ${app.getVersion()} starting (electron ${process.versions.electron}, ${process.platform})`);

  const state = new JsonStore(path.join(userData, 'state.json'), {});
  ctx.state = state;
  ctx.library = new Library(userData);
  ctx.folders = new Folders();
  ctx.podcasts = new Podcasts(userData, (p) => send('podcast:progress', p));
  ctx.lyrics = new Lyrics(userData);
  ctx.spotify = new SpotifyAuth(userData, (status) => send('spotify:changed', status));
  ctx.updater = new Updater(send, {
    beforeInstall: () => {
      ctx.quitting = true;
      send('app:command', { name: 'flush' });
    },
  });
  ctx.ipodWindow = new IpodWindow({ state, preload: PRELOAD, icon: icon(), dev: DEV, devTools: DEV || TEST_HOOK });
  ctx.desktop = new Desktop({
    ipodWindow: ctx.ipodWindow,
    assets: ASSETS,
    command,
    openSetup: ctx.openSetup,
    updater: ctx.updater,
    logDir: log.dir,
    library: ctx.library,
  });
  ctx.library.on('folders-changed', () => send('lib:folders-changed'));

  const proto = new Protocol({
    rendererDir: RENDERER_DIR,
    library: ctx.library,
    folders: ctx.folders,
    podcasts: ctx.podcasts,
    onIcy: (sid, meta) => send('radio:meta', { sid, ...meta }),
  });
  protocol.handle('app', (req) => proto.handle(req));

  // Only what the iPod needs: EME (Widevine) for the Spotify Web Playback SDK
  // when the runtime ships a CDM, fullscreen video, notifications and copying.
  // Notably not 'media' (microphone/camera).
  const ALLOWED = new Set(['mediaKeySystem', 'fullscreen', 'notifications', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));

  Menu.setApplicationMenu(null);
  registerIpc(ctx);
  const args = parseArgs(process.argv);
  const win = ctx.ipodWindow.create({ hidden: args.hidden || state.get('window', {}).startHidden === true });
  win.on('closed', () => {
    ctx.ipodWindow.trackCursor(false);
    ctx.ipodWindow.win = null;
    ctx.quit(true);
  });
  win.on('close', (e) => {
    if (!ctx.quitting) {
      e.preventDefault();
      ctx.quit(false);
    }
  });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') log.scope('console').error(e.message);
  });
  ctx.desktop.init();
  handleArgs(process.argv);

  ctx.updater.start();

  if (TEST_HOOK) {
    win.webContents.once('did-finish-load', () => {
      require(path.resolve(process.env.IPOD_E2E))({ app, win, ctx, BrowserWindow });
    });
  }
});

app.on('second-instance', (_e, argv, cwd) => {
  const args = handleArgs(argv, cwd);
  if (!args.commands.length && !args.files.length && ctx.ipodWindow) ctx.ipodWindow.show();
});

app.on('before-quit', () => {
  ctx.quitting = true;
  if (ctx.ipodWindow) ctx.ipodWindow.stopDrag();
  if (ctx.desktop) ctx.desktop.dispose();
  if (ctx.state) ctx.state.flush();
});

app.on('will-quit', () => {
  if (ctx.state) ctx.state.flush();
});

app.on('window-all-closed', () => app.quit());
