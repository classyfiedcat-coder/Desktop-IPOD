'use strict';

/**
 * Software Update via electron-updater and GitHub Releases. Only active for
 * the installed (NSIS) build; portable and development builds report
 * "unsupported".
 */

const { app } = require('electron');
const { log } = require('./log');

class Updater {
  constructor(send) {
    this.send = send;
    this.status = { state: 'idle' };
    this.supported = app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR && process.platform === 'win32';
    this.au = null;
    if (!this.supported) {
      this.status = { state: 'unsupported' };
      return;
    }
    try {
      const { autoUpdater } = require('electron-updater');
      this.au = autoUpdater;
    } catch (err) {
      log.warn('[updater] unavailable', err.message);
      this.supported = false;
      this.status = { state: 'unsupported' };
      return;
    }
    const au = this.au;
    au.autoDownload = true;
    au.autoInstallOnAppQuit = true;
    au.logger = { info: (m) => log.info('[updater]', m), warn: (m) => log.warn('[updater]', m), error: (m) => log.error('[updater]', m), debug: () => {} };
    au.on('checking-for-update', () => this._set({ state: 'checking' }));
    au.on('update-available', (i) => this._set({ state: 'downloading', version: i.version, percent: 0 }));
    au.on('update-not-available', () => this._set({ state: 'current', version: app.getVersion(), checkedAt: Date.now() }));
    au.on('download-progress', (p) => this._set({ ...this.status, state: 'downloading', percent: Math.round(p.percent) }));
    au.on('update-downloaded', (i) => this._set({ state: 'ready', version: i.version }));
    au.on('error', (err) => this._set({ state: 'error', message: err ? err.message : 'Update failed' }));
  }

  _set(status) {
    this.status = status;
    this.send('update:status', status);
  }

  async check() {
    if (!this.supported) return this.status;
    try {
      await this.au.checkForUpdates();
    } catch (err) {
      this._set({ state: 'error', message: err.message });
    }
    return this.status;
  }

  install() {
    if (this.status.state === 'ready' && this.au) this.au.quitAndInstall(false, true);
  }
}

module.exports = { Updater };
