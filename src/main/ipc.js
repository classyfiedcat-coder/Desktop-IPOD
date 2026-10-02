'use strict';

/** Every IPC channel between the iPod UI and the main process. */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { app, ipcMain, dialog, shell, clipboard } = require('electron');
const { apiJson } = require('./net');
const { parseOpml, toOpml } = require('./podcasts');
const { fillMissing } = require('./artwork');
const { log } = require('./log');

const rlog = log.scope('renderer');

function registerIpc(ctx) {
  const { state, ipodWindow: iw, library, folders, podcasts, lyrics, spotify, updater, desktop, send } = ctx;
  const win = () => iw.win;

  // --- state ---------------------------------------------------------------
  ipcMain.handle('state:load', () => ({
    app: state.get('app', null),
    window: state.get('window', {}),
    platform: process.platform,
    version: app.getVersion(),
    packaged: app.isPackaged,
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
  ipcMain.on('app:ready', () => ctx.rendererReady());
  ipcMain.handle('clipboard:read', () => clipboard.readText().slice(0, 4000));
  ipcMain.handle('state:export', async (_e, json) => {
    const res = await dialog.showSaveDialog(win(), {
      title: 'Back Up iPod Settings',
      defaultPath: path.join(app.getPath('documents'), `iPod Backup ${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'iPod Backup', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return false;
    await fsp.writeFile(res.filePath, String(json), 'utf8');
    return true;
  });
  ipcMain.handle('state:import', async () => {
    const res = await dialog.showOpenDialog(win(), { title: 'Restore iPod Backup', properties: ['openFile'], filters: [{ name: 'iPod Backup', extensions: ['json'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    const st = await fsp.stat(res.filePaths[0]);
    if (st.size > 50 * 1024 * 1024) return null;
    return fsp.readFile(res.filePaths[0], 'utf8');
  });
  ipcMain.on('log', (_e, level, ...args) => (rlog[level] || rlog.info)(...args));

  // --- window ---------------------------------------------------------------
  ipcMain.on('win:ignore-mouse', (_e, ignore) => iw.ignoreMouse(ignore));
  ipcMain.on('win:drag-start', () => iw.startDrag());
  ipcMain.on('win:drag-end', () => iw.stopDrag());
  ipcMain.handle('win:resize', (_e, size) => iw.resize(size || {}));
  ipcMain.handle('win:set', (_e, patch) => iw.applyPrefs(patch || {}));
  ipcMain.on('win:minimize', () => win() && win().minimize());
  ipcMain.on('win:hide', () => win() && win().hide());
  ipcMain.on('win:show', () => iw.show());
  ipcMain.on('win:context-menu', () => desktop.popup());
  ipcMain.on('app:quit', () => ctx.quit(true));

  // --- desktop ---------------------------------------------------------------
  ipcMain.on('desktop:np', (_e, np) => desktop.setNowPlaying(np || {}));
  ipcMain.on('desktop:prefs', (_e, prefs) => desktop.applyPrefs(prefs || {}));

  // --- library ---------------------------------------------------------------
  ipcMain.handle('lib:get', () => library.snapshot());
  ipcMain.handle('lib:scan', (_e, list) => {
    const folders = (Array.isArray(list) ? list : []).filter((f) => typeof f === 'string');
    return library.scan(folders, (p) => send('lib:progress', p));
  });
  ipcMain.handle('lib:open-files', (_e, paths) => library.openFiles((paths || []).filter((p) => typeof p === 'string')));
  ipcMain.handle('lib:info', (_e, id) => library.info(id));
  ipcMain.handle('lib:auto-update', (_e, on) => {
    library.autoUpdate = !!on;
    library.watch(library.data.folders);
    return true;
  });
  ipcMain.handle('lib:export-playlist', async (_e, { name, trackIds }) => {
    const res = await dialog.showSaveDialog(win(), {
      title: 'Export Playlist',
      defaultPath: path.join(app.getPath('music'), `${String(name || 'Playlist').replace(/[\\/:*?"<>|]/g, '_')}.m3u8`),
      filters: [{ name: 'Playlist', extensions: ['m3u8', 'm3u'] }],
    });
    if (res.canceled || !res.filePath) return null;
    return library.exportPlaylist(res.filePath, trackIds || []);
  });
  let artJob = null;
  ipcMain.handle('lib:fill-artwork', () => {
    if (!artJob) {
      artJob = fillMissing(library, (p) => send('art:progress', p)).finally(() => {
        artJob = null;
        send('lib:art-updated');
      });
    }
    return artJob;
  });
  ipcMain.handle('files:dropped', async (_e, paths) => {
    const dirs = [];
    const files = [];
    for (const p of (paths || []).filter((x) => typeof x === 'string')) {
      try {
        const st = await fsp.stat(p);
        if (st.isDirectory()) dirs.push(p);
        else if (st.isFile()) files.push(p);
      } catch {
        /* vanished */
      }
    }
    return { folders: dirs, tracks: files.length ? await library.openFiles(files) : [] };
  });

  // --- dialogs ----------------------------------------------------------------
  ipcMain.handle('dialog:folder', async (_e, title) => {
    const res = await dialog.showOpenDialog(win(), { title: title || 'Choose a folder', properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  // --- folders ----------------------------------------------------------------
  ipcMain.handle('media:photos', (_e, folder) => folders.listPhotos(folder));
  ipcMain.handle('media:videos', (_e, folder) => folders.listVideos(folder));
  ipcMain.handle('media:texts', (_e, folder, kind) => {
    const exts = { notes: ['.txt', '.md'], contacts: ['.vcf'], calendars: ['.ics'] }[kind];
    return exts ? folders.readTexts(folder, exts, { depth: kind === 'notes' ? 2 : 3 }) : [];
  });
  ipcMain.handle('sys:info', async (_e, folder) => {
    let disk = null;
    try {
      const st = await fsp.statfs(folder || app.getPath('music'));
      disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize };
    } catch {
      /* statfs unsupported */
    }
    return { version: app.getVersion(), platform: process.platform, electron: process.versions.electron, chrome: process.versions.chrome, disk, logs: log.dir };
  });

  // --- internet ----------------------------------------------------------------
  ipcMain.handle('net:json', (_e, url) => apiJson(String(url)));
  ipcMain.handle('lyrics:get', (_e, q) => lyrics.get(q || {}));
  ipcMain.handle('podcast:feed', (_e, url) => podcasts.fetchFeed(String(url)));
  ipcMain.handle('podcast:download', (_e, ep) => podcasts.download(ep));
  ipcMain.handle('podcast:remove', (_e, id) => podcasts.remove(String(id)));
  ipcMain.handle('podcast:downloads', () => podcasts.list());
  ipcMain.handle('podcast:opml-import', async () => {
    const res = await dialog.showOpenDialog(win(), { title: 'Import Podcasts (OPML)', properties: ['openFile'], filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    return parseOpml(await fsp.readFile(res.filePaths[0], 'utf8'));
  });
  ipcMain.handle('podcast:opml-export', async (_e, subs) => {
    const res = await dialog.showSaveDialog(win(), { title: 'Export Podcasts', defaultPath: path.join(app.getPath('documents'), 'iPod Podcasts.opml'), filters: [{ name: 'OPML', extensions: ['opml'] }] });
    if (res.canceled || !res.filePath) return false;
    await fsp.writeFile(res.filePath, toOpml(subs || []), 'utf8');
    return true;
  });

  // --- spotify ----------------------------------------------------------------
  ipcMain.handle('spotify:status', () => spotify.status());
  ipcMain.handle('spotify:set-client-id', (_e, id) => spotify.setClientId(id));
  ipcMain.handle('spotify:login', async () => {
    try {
      await spotify.login();
      iw.show();
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
  ipcMain.on('spotify:setup', () => ctx.openSetup());
  ipcMain.on('spotify:open-app', () => shell.openExternal('spotify:'));
  ipcMain.on('setup:close', () => ctx.closeSetup());
  ipcMain.on('shell:open', (_e, url) => {
    if (/^https:\/\/((developer|www|open|accounts)\.spotify\.com|github\.com|lrclib\.net|www\.radio-browser\.info)\//.test(String(url))) shell.openExternal(url);
  });
  ipcMain.on('shell:open-logs', () => log.dir && shell.openPath(log.dir));

  // --- updates ----------------------------------------------------------------
  ipcMain.handle('update:status', () => updater.status);
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.on('update:install', () => updater.install());
}

module.exports = { registerIpc };
