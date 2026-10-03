#!/usr/bin/env node
'use strict';
/**
 * Writes an iTunes library XML for the end-to-end tests, pointing at the
 * songs of the test library: star ratings, play counts and dates, a playlist
 * folder, a smart playlist, an empty playlist, the built-in lists, a song
 * that isn't on this computer and one that's only in the cloud.
 *
 *   node scripts/make-test-itunes.js <music dir> <out.xml>
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const [musicDir, out] = process.argv.slice(2);
if (!musicDir || !out) {
  console.error('usage: make-test-itunes.js <music dir> <out.xml>');
  process.exit(1);
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.mp3$/i.test(e.name)) files.push(p);
  }
})(path.resolve(musicDir));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const title = (f) => path.basename(f, '.mp3').replace(/^\d+ /, '');
// What iTunes "knows" about some of the songs.
const STATS = {
  Coastline: { rating: 80, plays: 77, played: '2024-06-01T10:00:00Z' },
  'Highway Lights': { rating: 100, plays: 31, played: '2024-05-20T21:30:00Z' },
  Orbit: { rating: 60, computed: true, plays: 12 },
  Afterglow: { rating: 100, plays: 5 },
};

let id = 1000;
const tracks = files.map((file) => ({ id: id++, file, name: title(file), ...(STATS[title(file)] || {}) }));
const byName = (n) => tracks.find((t) => t.name === n).id;
const missing = { id: id++, name: 'On an old drive', file: path.join(path.dirname(path.resolve(musicDir)), 'gone', 'missing.mp3') };

const trackXml = (t) => `\t\t<key>${t.id}</key>
\t\t<dict>
\t\t\t<key>Track ID</key><integer>${t.id}</integer>
\t\t\t<key>Name</key><string>${esc(t.name)}</string>
${t.rating ? `\t\t\t<key>Rating</key><integer>${t.rating}</integer>\n` : ''}${t.computed ? '\t\t\t<key>Rating Computed</key><true/>\n' : ''}${t.plays ? `\t\t\t<key>Play Count</key><integer>${t.plays}</integer>\n` : ''}${t.played ? `\t\t\t<key>Play Date UTC</key><date>${t.played}</date>\n` : ''}\t\t\t<key>Date Added</key><date>2006-0${1 + (t.id % 9)}-15T12:00:00Z</date>
\t\t\t<key>Track Type</key><string>File</string>
\t\t\t<key>Location</key><string>${esc(pathToFileURL(t.file).href)}</string>
\t\t</dict>`;

const items = (ids) => `<array>${ids.map((i) => `<dict><key>Track ID</key><integer>${i}</integer></dict>`).join('')}</array>`;

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Major Version</key><integer>1</integer>
\t<key>Application Version</key><string>12.13.2.3</string>
\t<key>Music Folder</key><string>${esc(pathToFileURL(path.resolve(musicDir)).href)}/</string>
\t<key>Tracks</key>
\t<dict>
${[...tracks, missing].map(trackXml).join('\n')}
\t\t<key>9999</key>
\t\t<dict><key>Track ID</key><integer>9999</integer><key>Name</key><string>In the cloud</string><key>Track Type</key><string>Remote</string></dict>
\t</dict>
\t<key>Playlists</key>
\t<array>
\t\t<dict><key>Name</key><string>Library</string><key>Master</key><true/><key>Playlist Items</key>${items(tracks.map((t) => t.id))}</dict>
\t\t<dict><key>Name</key><string>Music</string><key>Distinguished Kind</key><integer>4</integer><key>Playlist Items</key>${items(tracks.map((t) => t.id))}</dict>
\t\t<dict><key>Name</key><string>Road Trips</string><key>Playlist Persistent ID</key><string>F00D000000000001</string><key>Folder</key><true/></dict>
\t\t<dict><key>Name</key><string>Night Drive</string><key>Playlist Persistent ID</key><string>F00D000000000002</string><key>Parent Persistent ID</key><string>F00D000000000001</string><key>Playlist Items</key>${items([byName('Tunnel Vision'), byName('Afterglow'), missing.id, byName('Night Bus Home')])}</dict>
\t\t<dict><key>Name</key><string>Five Stars</string><key>Playlist Persistent ID</key><string>F00D000000000003</string><key>Smart Info</key><data>AQEAAwAAAAIAAAAZ</data><key>Playlist Items</key>${items([byName('Highway Lights'), byName('Afterglow')])}</dict>
\t\t<dict><key>Name</key><string>Empty One</string><key>Playlist Persistent ID</key><string>F00D000000000004</string><key>Playlist Items</key><array/></dict>
\t</array>
</dict>
</plist>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, xml);
console.log(`iTunes library with ${tracks.length} songs written to ${out}`);
