'use strict';

/**
 * Software Update from GitHub Releases.
 *
 * The installed (NSIS) build updates itself with electron-updater: it checks
 * when it starts, every few hours and when the PC wakes up, downloads new
 * versions in the background, and installs them silently and restarts (the
 * renderer picks a quiet moment, see renderer/js/updates.js), or when you
 * quit. The portable build and the Mac app (which isn't signed by Apple, so
 * macOS won't let it replace itself) only check, and say where to download
 * the new version. Development builds don't update.
 */

const { app, powerMonitor } = require('electron');
const { log } = require('./log');
const { request } = require('./net');

/** How often to look for a new version while the app is running. */
const CHECK_EVERY = 4 * 60 * 60 * 1000;
/** After waking up, give the network a moment to come back. */
const AFTER_RESUME = 30 * 1000;
const FIRST_CHECK = 8000;

/** "2.0.10" > "2.0.9": compares dotted version numbers (ignores a leading v and any -suffix). */
function newer(a, b) {
  const parse = (v) =>
    String(v || '')
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

/**
 * A short, readable reason an update check failed. electron-updater's errors
 * carry the whole HTTP response (headers and all), which is no use on an
 * iPod screen.
 */
function explain(err) {
  const msg = String((err && err.message) || err || '');
  const status = (err && (err.statusCode || err.status)) || (/\b(4\d\d|5\d\d)\b/.exec(msg) || [])[1];
  if (+status === 404) return 'No releases found. GitHub hides the releases of a private repository.';
  if (+status === 403 || +status === 429) return 'GitHub is busy. Try again in a while.';
  if (status >= 500) return 'GitHub isn’t responding. Try again later.';
  if (+status === 408 || /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|net::ERR_|offline|socket/i.test(msg)) return 'Couldn’t reach GitHub. Check your internet connection.';
  if (/sha512|checksum|signature/i.test(msg)) return 'The download was damaged. It will try again later.';
  return msg.split('\n')[0].slice(0, 120) || 'Update failed';
}

/** The GitHub repository releases are published to (package.json › build.publish). */
function releaseRepo() {
  try {
    const pkg = require('../../package.json');
    const pub = [].concat((pkg.build && pkg.build.publish) || []).find((p) => p && p.provider === 'github');
    if (pub && pub.owner && pub.repo) return `${pub.owner}/${pub.repo}`;
  } catch {
    /* fall through */
  }
  return null;
}

class Updater {
  /**
   * @param {(channel: string, data: any) => void} send
   * @param {object} [o]
   * @param {() => void} [o.beforeInstall] save everything and let the window close
   */
  constructor(send, { beforeInstall } = {}) {
    this.send = send;
    this.beforeInstall = beforeInstall || (() => {});
    this.status = { state: 'idle' };
    this.au = null;
    this.repo = releaseRepo();
    // Installed Windows copies update themselves; the portable exe and the Mac
    // app can only be told about a new version (you download it yourself).
    this.manual = !!process.env.PORTABLE_EXECUTABLE_DIR || process.platform === 'darwin';
    this.supported = app.isPackaged && !this.manual && process.platform === 'win32';
    this.canNotify = app.isPackaged && this.manual && !!this.repo;
    if (!this.supported) {
      this.status = { state: 'unsupported', manual: this.manual };
      return;
    }
    try {
      const { autoUpdater } = require('electron-updater');
      this.au = autoUpdater;
    } catch (err) {
      log.warn('[updater] unavailable', err.message);
      this.supported = false;
      this.status = { state: 'unsupported', manual: false };
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
    au.on('error', (err) => {
      log.warn('[updater]', err ? err.message : 'error');
      this._set({ state: 'error', message: explain(err) });
    });
  }

  /** Check now, and from then on regularly while the app runs. */
  start() {
    if (!this.supported && !this.canNotify) return;
    setTimeout(() => this.check(), FIRST_CHECK);
    this._interval = setInterval(() => this.check(), CHECK_EVERY);
    try {
      powerMonitor.on('resume', () => setTimeout(() => this.check(), AFTER_RESUME));
    } catch {
      /* no power events on this platform */
    }
  }

  _set(status) {
    this.status = status;
    this.send('update:status', status);
  }

  async check() {
    // Already on its way (or waiting to install): nothing to check.
    if (['checking', 'downloading', 'ready', 'installing'].includes(this.status.state)) return this.status;
    if (this.canNotify) return this._checkPortable();
    if (!this.supported) return this.status;
    try {
      await this.au.checkForUpdates();
    } catch (err) {
      this._set({ state: 'error', message: explain(err) });
    }
    return this.status;
  }

  /** Portable / Mac: look at the latest release and, if it's newer, say where to get it. */
  async _checkPortable() {
    const prev = this.status;
    this._set({ ...prev, state: 'checking' });
    try {
      const rel = await request(`https://api.github.com/repos/${this.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      const version = String(rel.tag_name || '').replace(/^v/i, '');
      if (version && newer(version, app.getVersion())) {
        const url = /^https:\/\/github\.com\//.test(rel.html_url || '') ? rel.html_url : `https://github.com/${this.repo}/releases/latest`;
        this._set({ state: 'available', version, url, manual: true });
      } else {
        this._set({ state: 'current', version: app.getVersion(), checkedAt: Date.now(), manual: true });
      }
    } catch (err) {
      log.warn('[updater] check', err.message);
      this._set({ state: 'error', message: explain(err), manual: true });
    }
    return this.status;
  }

  /** Install the downloaded update now: save, close, install silently and start again. */
  install() {
    if (this.status.state !== 'ready' || !this.au) return;
    this._set({ ...this.status, state: 'installing' });
    // Skip the power-off animation (it would hold the window open), and give
    // the UI a moment to save anything it hasn't yet.
    this.beforeInstall();
    setTimeout(() => {
      try {
        this.au.quitAndInstall(true, true);
      } catch (err) {
        log.error('[updater] install failed', err.message);
        this._set({ state: 'error', message: err.message });
      }
    }, 400);
  }
}

module.exports = { Updater, newer, explain };
