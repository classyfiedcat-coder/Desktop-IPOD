'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePlist, fileFromLocation, readLibrary, matchLibrary, matchKey } = require('../../src/main/library/itunes');

// A small library the way iTunes writes it.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Major Version</key><integer>1</integer>
	<key>Application Version</key><string>12.13.2.3</string>
	<key>Music Folder</key><string>file:///Users/me/Music/iTunes/iTunes%20Media/</string>
	<key>Tracks</key>
	<dict>
		<key>101</key>
		<dict>
			<key>Track ID</key><integer>101</integer>
			<key>Name</key><string>Rock &amp; Roll</string>
			<key>Artist</key><string>Björk</string>
			<key>Rating</key><integer>80</integer>
			<key>Play Count</key><integer>42</integer>
			<key>Play Date UTC</key><date>2024-05-01T12:00:00Z</date>
			<key>Date Added</key><date>2019-01-02T03:04:05Z</date>
			<key>Skip Count</key><integer>3</integer>
			<key>Loved</key><true/>
			<key>Track Type</key><string>File</string>
			<key>Location</key><string>file:///Users/me/Music/iTunes/iTunes%20Media/Music/Bj%C3%B6rk/Debut/01%20Human%20Behaviour.mp3</string>
		</dict>
		<key>102</key>
		<dict>
			<key>Track ID</key><integer>102</integer>
			<key>Name</key><string>Album-rated</string>
			<key>Rating</key><integer>60</integer>
			<key>Rating Computed</key><true/>
			<key>Track Type</key><string>File</string>
			<key>Location</key><string>file:///Users/me/Music/Other/02.m4a</string>
		</dict>
		<key>103</key>
		<dict>
			<key>Track ID</key><integer>103</integer>
			<key>Name</key><string>Only in the cloud</string>
			<key>Track Type</key><string>Remote</string>
		</dict>
		<key>104</key>
		<dict>
			<key>Track ID</key><integer>104</integer>
			<key>Name</key><string>Not on this iPod</string>
			<key>Track Type</key><string>File</string>
			<key>Location</key><string>file:///Volumes/Old%20Drive/x.mp3</string>
		</dict>
	</dict>
	<key>Playlists</key>
	<array>
		<dict><key>Name</key><string>Library</string><key>Master</key><true/><key>Playlist Items</key><array><dict><key>Track ID</key><integer>101</integer></dict></array></dict>
		<dict><key>Name</key><string>Music</string><key>Distinguished Kind</key><integer>4</integer><key>Playlist Items</key><array><dict><key>Track ID</key><integer>101</integer></dict></array></dict>
		<dict><key>Name</key><string>Road Trip</string><key>Playlist Persistent ID</key><string>AAAA000000000001</string><key>Folder</key><true/></dict>
		<dict>
			<key>Name</key><string>Day 1 &lt;3</string>
			<key>Playlist Persistent ID</key><string>AAAA000000000002</string>
			<key>Parent Persistent ID</key><string>AAAA000000000001</string>
			<key>Playlist Items</key>
			<array>
				<dict><key>Track ID</key><integer>102</integer></dict>
				<dict><key>Track ID</key><integer>101</integer></dict>
				<dict><key>Track ID</key><integer>104</integer></dict>
			</array>
		</dict>
		<dict>
			<key>Name</key><string>Top Rated</string>
			<key>Playlist Persistent ID</key><string>AAAA000000000003</string>
			<key>Smart Info</key><data>
			AQEAAwAAAAIAAAAZAAAAAAAAAAcAAAABAAAAAAAAAAAAAAAAAAAAAAAA
			</data>
			<key>Playlist Items</key><array><dict><key>Track ID</key><integer>101</integer></dict></array>
		</dict>
		<dict><key>Name</key><string>Empty</string><key>Playlist Persistent ID</key><string>AAAA000000000004</string><key>Playlist Items</key><array/></dict>
		<dict><key>Name</key><string>Hidden</string><key>Visible</key><false/><key>Playlist Items</key><array><dict><key>Track ID</key><integer>101</integer></dict></array></dict>
	</array>
</dict>
</plist>`;

test('property lists parse into plain values', () => {
  const p = parsePlist(XML);
  assert.equal(p['Major Version'], 1);
  assert.equal(p.Tracks['101'].Name, 'Rock & Roll', 'entities decoded');
  assert.equal(p.Tracks['101'].Artist, 'Björk');
  assert.equal(p.Tracks['101'].Loved, true);
  assert.equal(p.Tracks['101']['Play Date UTC'], Date.parse('2024-05-01T12:00:00Z'));
  assert.equal(p.Playlists.length, 7);
  assert.deepEqual(p.Playlists[5]['Playlist Items'], [], 'empty arrays');
  assert.equal(p.Playlists[6].Visible, false);
  assert.equal(typeof p.Playlists[4]['Smart Info'], 'string', 'data kept as base64');
  assert.deepEqual(parsePlist('<plist><array><string>a &#233; &#x263A;</string><real>1.5</real><dict/></array></plist>'), ['a é ☺', 1.5, {}]);
});

test('track locations become paths on this computer', () => {
  assert.equal(fileFromLocation('file:///Users/me/Music/A%20B/%C3%A9.mp3', 'darwin'), '/Users/me/Music/A B/é.mp3');
  assert.equal(fileFromLocation('file://localhost/C:/Users/me/Music/iTunes/Song%20%231.mp3', 'win32'), 'C:\\Users\\me\\Music\\iTunes\\Song #1.mp3');
  assert.equal(fileFromLocation('file://localhost//NAS/music/a.mp3', 'win32'), '\\\\NAS\\music\\a.mp3');
  assert.equal(fileFromLocation('https://example.com/stream', 'win32'), null);
  assert.equal(fileFromLocation('file:///bad%E0%A4%A', 'darwin'), null);
  assert.equal(fileFromLocation(undefined), null);
});

test('reading a library: local files, stats and the playlists you made', () => {
  const lib = readLibrary(parsePlist(XML), 'darwin');
  assert.equal(lib.musicFolder, '/Users/me/Music/iTunes/iTunes Media/');
  assert.equal(lib.tracks.length, 3, 'the cloud-only song is skipped');
  const human = lib.tracks.find((t) => t.file.endsWith('Human Behaviour.mp3'));
  assert.deepEqual(
    { rating: human.rating, plays: human.plays, skips: human.skips, loved: human.loved },
    { rating: 4, plays: 42, skips: 3, loved: true }
  );
  assert.equal(lib.tracks.find((t) => t.file.endsWith('02.m4a')).rating, 0, 'computed ratings ignored');
  assert.deepEqual(
    lib.playlists.map((p) => p.name),
    ['Road Trip', 'Day 1 <3', 'Top Rated', 'Empty'],
    'not the library, built-in or hidden lists'
  );
  const day1 = lib.playlists[1];
  assert.equal(day1.parent, 'AAAA000000000001');
  assert.equal(day1.files.length, 3, 'in playlist order');
  assert.ok(lib.playlists[2].smart);
  assert.ok(lib.playlists[0].folder);
});

test('matching against the iPod library', () => {
  const lib = readLibrary(parsePlist(XML), 'darwin');
  const index = [
    // Case differs from iTunes: still the same file.
    { id: 'aaa', path: '/users/me/music/itunes/itunes media/music/björk/debut/01 human behaviour.mp3' },
    { id: 'bbb', path: '/Users/me/Music/Other/02.m4a' },
  ];
  const m = matchLibrary(lib, index);
  assert.equal(m.matched, 2);
  assert.equal(m.total, 3);
  assert.deepEqual(m.stats.aaa, { p: 42, l: Date.parse('2024-05-01T12:00:00Z'), r: 4, a: Date.parse('2019-01-02T03:04:05Z'), s: 3, f: 1 });
  assert.deepEqual(m.stats.bbb, {}, 'nothing to add, but matched');
  assert.deepEqual(
    m.playlists.map((p) => [p.name, p.trackIds]),
    [
      ['Road Trip', []],
      ['Day 1 <3', ['bbb', 'aaa']],
      ['Top Rated', ['aaa']],
    ],
    'empty playlists go; the folder stays because it has a playlist in it'
  );
  assert.equal(m.playlists[1].parent, 'itunes:AAAA000000000001');
  // A folder whose playlists are all empty goes too.
  const none = matchLibrary(lib, []);
  assert.deepEqual(none.playlists, []);
  assert.equal(matchKey('/A/B.mp3'), matchKey('/a/b.mp3'));
});
