'use strict';

/** Reading and writing .m3u / .m3u8 playlists. */

const path = require('path');

/** Absolute paths of an M3U's entries (relative paths, file:// URLs, Windows paths). */
function parseM3U(text, baseDir) {
  const out = [];
  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim().replace(/^﻿/, '');
    if (!line || line.startsWith('#')) continue;
    if (/^file:\/\//i.test(line)) {
      try {
        line = decodeURIComponent(new URL(line).pathname).replace(/^\/([a-zA-Z]:)/, '$1');
      } catch {
        continue;
      }
    } else if (/^[a-z]+:\/\//i.test(line)) {
      continue; // remote entries are not part of the local library
    }
    const isAbs = path.isAbsolute(line) || /^[a-zA-Z]:[\\/]/.test(line) || line.startsWith('\\\\');
    out.push(isAbs ? line : path.join(baseDir, line));
  }
  return out;
}

/** Extended M3U with durations and titles. */
function writeM3U(tracks) {
  const lines = ['#EXTM3U'];
  for (const t of tracks) {
    lines.push(`#EXTINF:${Math.round(t.duration || -1)},${t.artist ? `${t.artist} - ` : ''}${t.title}`);
    lines.push(t.path);
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { parseM3U, writeM3U };
