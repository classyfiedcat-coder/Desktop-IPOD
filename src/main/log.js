'use strict';

/**
 * Small rotating file logger. Writes to <userData>/logs/main.log and mirrors to
 * the console in development. Also captures uncaught errors from the main
 * process and console errors from renderers.
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_BYTES = 1024 * 1024;
const KEEP = 3;

class Logger {
  constructor() {
    this.file = null;
    this.buffer = [];
    this.echo = true;
  }

  init(dir, { echo = true } = {}) {
    this.echo = echo;
    try {
      fs.mkdirSync(dir, { recursive: true });
      this.file = path.join(dir, 'main.log');
      this._rotate();
      for (const line of this.buffer) fs.appendFileSync(this.file, line);
      this.buffer = [];
    } catch {
      this.file = null;
    }
    return this;
  }

  get dir() {
    return this.file ? path.dirname(this.file) : null;
  }

  _rotate() {
    try {
      if (fs.statSync(this.file).size < MAX_BYTES) return;
    } catch {
      return;
    }
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${this.file}.${i + 1}`);
    }
    fs.renameSync(this.file, `${this.file}.1`);
  }

  write(level, scope, args) {
    const msg = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : util.inspect(a, { depth: 4 }))).join(' ');
    const line = `${new Date().toISOString()} [${level}] ${scope ? `[${scope}] ` : ''}${msg}\n`;
    if (this.echo) (level === 'error' ? console.error : console.log)(line.trimEnd());
    if (!this.file) {
      this.buffer.push(line);
      if (this.buffer.length > 500) this.buffer.shift();
      return;
    }
    try {
      fs.appendFileSync(this.file, line);
      if (Math.random() < 0.02) this._rotate();
    } catch {
      /* disk full or read-only: drop the line */
    }
  }

  scope(name) {
    return {
      info: (...a) => this.write('info', name, a),
      warn: (...a) => this.write('warn', name, a),
      error: (...a) => this.write('error', name, a),
    };
  }

  info(...a) {
    this.write('info', '', a);
  }
  warn(...a) {
    this.write('warn', '', a);
  }
  error(...a) {
    this.write('error', '', a);
  }
}

const log = new Logger();

process.on('uncaughtException', (err) => log.error('uncaught exception', err));
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err));

module.exports = { log };
