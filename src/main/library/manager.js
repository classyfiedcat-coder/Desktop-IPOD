'use strict';

/**
 * Owns the local music index: runs scans in a utility process, keeps an
 * incremental JSON index, watches folders for changes, resizes artwork on
 * demand, accepts online artwork, and tracks "transient" files opened with
 * the iPod (Open With / drag & drop) that are not part of the library.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { utilityProcess, nativeImage } = require('electron');
const { log } = require('../log');
const { writeM3U } = require('./playlist-files');
const itunes = require('./itunes');

const INDEX_VERSION = 4;
const ART_SIZE = 500;
const AUDIO_RE = /\.(mp3|m4a|m4b|aac|flac|wav|ogg|oga|opus|weba)$/i;
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
/** A scanner that says nothing for this long is stuck (a dead network drive, say). */
const SCANNER_SILENCE_MS = 90 * 1000;
const inside = (file, folder) => {
  const rel = path.relative(folder, file);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

class Library extends EventEmitter {
  constructor(userDataDir) {
    super();
    this.indexFile = path.join(userDataDir, 'library.json');
    this.artDir = path.join(userDataDir, 'artwork');
    this.data = { version: INDEX_VERSION, folders: [], tracks: [], playlists: [], scannedAt: 0 };
    this.byId = new Map();
    this.transient = new Map();
    this.scanning = null;
    this.watchers = [];
    this.autoUpdate = true;
    this._artJobs = new Map();
    this._saving = Promise.resolve();
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      if (raw.version === INDEX_VERSION) this.data = raw;
    } catch {
      /* first run */
    }
    this._reindex();
  }

  _reindex() {
    this.byId = new Map(this.data.tracks.map((t) => [t.id, t]));
  }

  /** Atomic, and one at a time (artwork can arrive in the middle of a scan). */
  _save() {
    const run = async () => {
      const tmp = `${this.indexFile}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(this.data));
      await fsp.rename(tmp, this.indexFile);
    };
    this._saving = this._saving.then(run, run);
    return this._saving;
  }

  pathFor(id) {
    const t = this.byId.get(id) || this.transient.get(id);
    return t ? t.path : null;
  }

  track(id) {
    return this.byId.get(id) || this.transient.get(id) || null;
  }

  static strip(t) {
    const { path: p, mtime: _m, ...rest } = t;
    return { ...rest, file: path.basename(p), folder: path.dirname(p) };
  }

  snapshot() {
    return {
      scannedAt: this.data.scannedAt,
      folders: this.data.folders,
      tracks: this.data.tracks.map(Library.strip),
      playlists: this.data.playlists.map(({ file: _f, ...p }) => p),
    };
  }

  // ------------------------------------------------------------- scanning --

  _runWorker(message, onProgress) {
    return new Promise((resolve, reject) => {
      const child = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { serviceName: 'iPod Library Scanner', stdio: 'pipe' });
      if (child.stdout) child.stdout.on('data', (d) => log.info('[scanner]', String(d).trim()));
      if (child.stderr) child.stderr.on('data', (d) => log.warn('[scanner]', String(d).trim()));
      let finished = false;
      let watchdog = null;
      const alive = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          if (finished) return;
          finished = true;
          log.warn('[library] scanner stopped responding; giving up');
          child.kill();
          reject(new Error('The library scan stopped responding.'));
        }, SCANNER_SILENCE_MS);
      };
      alive();
      child.on('message', (msg) => {
        if (finished) return;
        alive();
        if (msg.type === 'progress') onProgress(msg);
        else if (msg.type === 'done' || msg.type === 'error') {
          finished = true;
          clearTimeout(watchdog);
          child.kill();
          if (msg.type === 'done') resolve(msg);
          else reject(new Error(msg.message));
        }
      });
      child.on('exit', (code) => {
        clearTimeout(watchdog);
        if (!finished) {
          finished = true;
          reject(new Error(`Scanner exited (${code})`));
        }
      });
      child.postMessage({ ...message, artDir: this.artDir });
    });
  }

  async scan(folders, onProgress = () => {}) {
    if (this.scanning) return this.scanning;
    const started = Date.now();
    this.scanning = (async () => {
      const valid = folders.filter((f) => {
        try {
          return fs.statSync(f).isDirectory();
        } catch {
          return false;
        }
      });
      const res = await this._runWorker({ type: 'scan', folders: valid, previous: this.data.tracks }, onProgress);
      // A folder that isn't there right now (an unplugged drive, a sleeping
      // NAS) keeps its songs until it comes back, instead of emptying them out.
      const missing = folders.filter((f) => !valid.includes(f));
      const kept = missing.length ? this.data.tracks.filter((t) => missing.some((f) => inside(t.path, f))) : [];
      const keptLists = missing.length ? this.data.playlists.filter((p) => p.file && missing.some((f) => inside(p.file, f))) : [];
      if (kept.length) log.info(`[library] ${missing.length} folder(s) unavailable; keeping their ${kept.length} songs`);
      this.data = { version: INDEX_VERSION, folders: folders.slice(), tracks: [...res.tracks, ...kept], playlists: [...res.playlists, ...keptLists], scannedAt: Date.now() };
      this._reindex();
      await this._save();
      log.info(`[library] scanned ${res.tracks.length} tracks in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      this.watch(folders);
      return this.snapshot();
    })().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  /** Parse files that aren't in the library (Open With, drag & drop). */
  async openFiles(paths) {
    const known = [];
    const unknown = [];
    for (const p of paths) {
      const id = hash(p).slice(0, 20);
      if (this.byId.has(id)) known.push(this.byId.get(id));
      else if (AUDIO_RE.test(p)) unknown.push(p);
    }
    let parsed = [];
    if (unknown.length) {
      const res = await this._runWorker({ type: 'files', paths: unknown }, () => {});
      parsed = res.tracks;
      for (const t of parsed) this.transient.set(t.id, t);
    }
    const order = new Map(paths.map((p, i) => [hash(p).slice(0, 20), i]));
    return [...known, ...parsed].sort((a, b) => order.get(a.id) - order.get(b.id)).map(Library.strip);
  }

  // -------------------------------------------------------------- watching --

  watch(folders) {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (!this.autoUpdate) return;
    for (const folder of folders) {
      try {
        const w = fs.watch(folder, { recursive: true, persistent: false }, (_type, name) => {
          if (!name || !(AUDIO_RE.test(name) || /\.m3u8?$/i.test(name))) return;
          clearTimeout(this._watchTimer);
          this._watchTimer = setTimeout(() => this.emit('folders-changed'), 4000);
        });
        w.on('error', () => {});
        this.watchers.push(w);
      } catch (err) {
        log.warn('[library] cannot watch', folder, err.message);
      }
    }
  }

  // --------------------------------------------------------------- artwork --

  /** Path to a resized JPEG for an artwork key, generating it on first use. */
  async artFile(key) {
    if (!/^[a-f0-9]{40}$/.test(key)) return null;
    const jpg = path.join(this.artDir, `${key}.jpg`);
    if (fs.existsSync(jpg)) return jpg;
    if (this._artJobs.has(key)) return this._artJobs.get(key);
    const job = (async () => {
      const src = path.join(this.artDir, `${key}.src`);
      let buf;
      try {
        buf = await fsp.readFile(src);
      } catch {
        return null;
      }
      let img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return null;
      const { width, height } = img.getSize();
      if (width > ART_SIZE || height > ART_SIZE) img = img.resize(width >= height ? { width: ART_SIZE, quality: 'best' } : { height: ART_SIZE, quality: 'best' });
      await fsp.writeFile(jpg, img.toJPEG(88));
      return jpg;
    })().finally(() => this._artJobs.delete(key));
    this._artJobs.set(key, job);
    return job;
  }

  /** Albums (artKey + names) that have no artwork yet. */
  missingArt() {
    const seen = new Map();
    for (const t of this.data.tracks) {
      if (t.art || seen.has(t.artKey) || t.album === 'Unknown Album') continue;
      seen.set(t.artKey, { key: t.artKey, album: t.album, artist: t.albumArtist });
    }
    return [...seen.values()];
  }

  /** Store downloaded artwork for an album and point its tracks at it. */
  async setArt(key, buffer) {
    await fsp.mkdir(this.artDir, { recursive: true });
    await fsp.writeFile(path.join(this.artDir, `${key}.src`), buffer);
    await fsp.rm(path.join(this.artDir, `${key}.jpg`), { force: true });
    let n = 0;
    for (const t of this.data.tracks) {
      if (t.artKey === key) {
        t.art = key;
        n++;
      }
    }
    if (n) await this._save();
    return n;
  }

  // ---------------------------------------------------------------- iTunes --

  /**
   * Read the iTunes / Music library (the file given, or the one found in the
   * Music folder) and match it against this library. The XML is only read
   * again when it has changed. Returns what the renderer needs, or
   * { found: false } with where it looked.
   */
  async itunes({ file = null, musicDir, force = false } = {}) {
    const target = file || itunes.findLibrary(musicDir);
    this._watchITunes(target);
    if (!target) return { found: false, candidates: itunes.libraryCandidates(musicDir) };
    let st;
    try {
      st = await fsp.stat(target);
    } catch {
      return { found: false, file: target, error: 'The library file isn’t there any more.' };
    }
    const cached = this._itunesRead && this._itunesRead.file === target ? this._itunesRead : null;
    let error = null;
    if (force || !cached || cached.mtime !== st.mtimeMs) {
      try {
        const res = await this._runWorker({ type: 'itunes', file: target }, () => {});
        this._itunesRead = { file: target, mtime: st.mtimeMs, read: { musicFolder: res.musicFolder, tracks: res.tracks, playlists: res.playlists } };
        log.info(`[itunes] read ${res.tracks.length} songs and ${res.playlists.length} playlists from ${target}`);
      } catch (err) {
        log.warn('[itunes] could not read', target, err.message);
        error = err.message.split('\n')[0];
        // Keep using the last good read (iTunes may have been half-way through saving).
        if (!cached) return { found: false, file: target, error };
      }
    }
    const { read, mtime } = this._itunesRead;
    return { found: true, file: target, modified: mtime, syncedAt: Date.now(), musicFolder: read.musicFolder, error, ...itunes.matchLibrary(read, this.data.tracks) };
  }

  /** iTunes rewrites the whole file when its library changes; a slow poll is plenty. */
  _watchITunes(file) {
    if (this._itunesWatched === file) return;
    this.stopITunes();
    this._itunesWatched = file;
    if (!file) return;
    fs.watchFile(file, { interval: 60 * 1000, persistent: false }, (cur, prev) => {
      if (cur.mtimeMs === prev.mtimeMs) return;
      clearTimeout(this._itunesTimer);
      this._itunesTimer = setTimeout(() => this.emit('itunes-changed'), 5000);
    });
  }

  stopITunes() {
    if (this._itunesWatched) fs.unwatchFile(this._itunesWatched);
    clearTimeout(this._itunesTimer);
    this._itunesWatched = null;
    this._itunesRead = null;
  }

  // ------------------------------------------------------------- playlists --

  async exportPlaylist(file, trackIds) {
    const tracks = trackIds.map((id) => this.track(id)).filter(Boolean);
    await fsp.writeFile(file, writeM3U(tracks), 'utf8');
    return tracks.length;
  }

  /** Details for "Song Info". */
  async info(id) {
    const t = this.track(id);
    if (!t) return null;
    let st = null;
    try {
      st = await fsp.stat(t.path);
    } catch {
      st = null;
    }
    return { path: t.path, size: st ? st.size : t.size, modified: st ? st.mtimeMs : t.mtime };
  }
}

module.exports = { Library };
