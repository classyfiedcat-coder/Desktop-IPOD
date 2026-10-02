'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tiny JSON file store with atomic, debounced writes.
 */
class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.data = { ...defaults };
    this._timer = null;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      this.data = { ...defaults, ...JSON.parse(raw) };
    } catch {
      /* first run or unreadable file: keep defaults */
    }
  }

  get(key, fallback) {
    return key in this.data ? this.data[key] : fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  merge(patch) {
    Object.assign(this.data, patch);
    this.save();
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this._timer);
    this._timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] failed to write', this.file, err);
    }
  }
}

module.exports = { JsonStore };
