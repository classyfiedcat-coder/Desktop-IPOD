'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { createIcyTransform, parseIcyMeta, splitTitle } = require('../../src/main/icy');
const { parseFeed, parseOpml, toOpml, parseDuration, stripHtml } = require('../../src/main/podcasts');
const { parseM3U, writeM3U } = require('../../src/main/library/playlist-files');
const { cleanTitle, firstArtist } = require('../../src/main/lyrics');
const { isPublicUrl, hostAllowed } = require('../../src/main/net');
const { srtToVtt } = require('../../src/main/folders');
const { similar } = require('../../src/main/artwork');
const { parseArgs } = require('../../src/main/desktop');

test('ICY metadata parsing', () => {
  assert.deepEqual(parseIcyMeta("StreamTitle='Daft Punk - One More Time';StreamUrl='';\0\0"), { StreamTitle: 'Daft Punk - One More Time', StreamUrl: '' });
  assert.equal(parseIcyMeta("StreamTitle='It's Raining';").StreamTitle, "It's Raining");
  assert.deepEqual(splitTitle('Daft Punk - One More Time'), { artist: 'Daft Punk', title: 'One More Time' });
  assert.deepEqual(splitTitle('Station Jingle'), { artist: '', title: 'Station Jingle' });
});

test('ICY transform strips metadata blocks and reports titles', async () => {
  const metaint = 8;
  const meta = (s) => {
    const body = Buffer.from(s);
    const len = Math.ceil(body.length / 16);
    const block = Buffer.alloc(1 + len * 16);
    block[0] = len;
    body.copy(block, 1);
    return block;
  };
  const audio1 = Buffer.from('AAAAAAAA');
  const audio2 = Buffer.from('BBBBBBBB');
  const audio3 = Buffer.from('CCCCCCCC');
  const stream = Buffer.concat([audio1, meta("StreamTitle='A - B';"), audio2, Buffer.from([0]), audio3, meta("StreamTitle='C - D';")]);
  const titles = [];
  const ts = createIcyTransform(metaint, (m) => titles.push(m.StreamTitle));
  const writer = ts.writable.getWriter();
  const chunks = [];
  const reading = (async () => {
    const r = ts.readable.getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  })();
  // Feed it in awkward pieces to exercise the state machine.
  for (let i = 0; i < stream.length; i += 5) await writer.write(new Uint8Array(stream.subarray(i, i + 5)));
  await writer.close();
  await reading;
  assert.equal(Buffer.concat(chunks).toString(), 'AAAAAAAABBBBBBBBCCCCCCCC');
  assert.deepEqual(titles, ['A - B', 'C - D']);
});

const FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Test Show &amp; Friends</title>
  <itunes:author>Jo</itunes:author>
  <itunes:image href="https://example.com/show.jpg"/>
  <description><![CDATA[<p>About <b>things</b></p>]]></description>
  <item>
    <title>Older</title><guid>ep1</guid><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
    <enclosure url="https://example.com/1.mp3" type="audio/mpeg" length="1000"/>
    <itunes:duration>1:02:03</itunes:duration>
  </item>
  <item>
    <title>Newer</title><guid isPermaLink="false">ep2</guid><pubDate>Tue, 02 Jan 2024 10:00:00 GMT</pubDate>
    <enclosure url="https://example.com/2.mp3" type="audio/mpeg"/>
    <itunes:duration>125</itunes:duration>
    <itunes:image href="https://example.com/ep2.jpg"/>
  </item>
  <item><title>No audio</title></item>
</channel></rss>`;

test('podcast feed parsing', () => {
  const show = parseFeed(FEED, 'https://example.com/feed');
  assert.equal(show.title, 'Test Show & Friends');
  assert.equal(show.author, 'Jo');
  assert.equal(show.art, 'https://example.com/show.jpg');
  assert.equal(show.description, 'About things');
  assert.equal(show.episodes.length, 2);
  assert.equal(show.episodes[0].title, 'Newer');
  assert.equal(show.episodes[0].duration, 125);
  assert.equal(show.episodes[0].art, 'https://example.com/ep2.jpg');
  assert.equal(show.episodes[1].duration, 3723);
  assert.equal(show.episodes[1].guid, 'ep1');
  assert.notEqual(show.episodes[0].id, show.episodes[1].id);
  assert.throws(() => parseFeed('<html></html>'), /podcast feed/);
});

test('durations and html', () => {
  assert.equal(parseDuration('45:10'), 2710);
  assert.equal(parseDuration('3600'), 3600);
  assert.equal(parseDuration(''), 0);
  assert.equal(stripHtml('a<br/>b &amp; c'), 'a\nb & c');
});

test('OPML round trip', () => {
  const subs = [
    { title: 'One & Two', feedUrl: 'https://a.example/rss' },
    { title: 'Three', feedUrl: 'https://b.example/rss?x=1&y=2' },
  ];
  assert.deepEqual(parseOpml(toOpml(subs)), subs);
});

test('M3U parsing and writing', () => {
  const base = path.join(path.sep, 'music', 'lists');
  const list = parseM3U('#EXTM3U\n#EXTINF:10,A - B\n../a.mp3\nhttp://radio/stream\nfile:///C:/Music/b.mp3\nC:\\Music\\c.mp3\n', base);
  assert.equal(list[0], path.join(base, '..', 'a.mp3'));
  assert.equal(list[1], 'C:/Music/b.mp3');
  assert.equal(list[2], 'C:\\Music\\c.mp3');
  assert.equal(list.length, 3);
  const out = writeM3U([{ title: 'T', artist: 'A', duration: 61.4, path: '/x/t.mp3' }]);
  assert.match(out, /^#EXTM3U\r\n#EXTINF:61,A - T\r\n\/x\/t\.mp3\r\n$/);
});

test('lyrics title cleanup', () => {
  assert.equal(cleanTitle('Here Comes the Sun - Remastered 2009'), 'Here Comes the Sun');
  assert.equal(cleanTitle('Song (feat. Someone)'), 'Song');
  assert.equal(cleanTitle('Track (2011 Remaster)'), 'Track');
  assert.equal(cleanTitle('Plain'), 'Plain');
  assert.equal(firstArtist('A, B & C'), 'A');
  assert.equal(firstArtist('A feat. B'), 'A');
});

test('network safety', () => {
  assert.equal(isPublicUrl('https://example.com/a.mp3'), true);
  assert.equal(isPublicUrl('http://127.0.0.1:8080/'), false);
  assert.equal(isPublicUrl('http://localhost/'), false);
  assert.equal(isPublicUrl('http://192.168.1.4/'), false);
  assert.equal(isPublicUrl('http://172.20.0.1/'), false);
  assert.equal(isPublicUrl('http://172.32.0.1/'), true);
  assert.equal(isPublicUrl('http://[::1]/'), false);
  assert.equal(isPublicUrl('file:///etc/passwd'), false);
  assert.equal(isPublicUrl('not a url'), false);
  assert.equal(hostAllowed('lrclib.net'), true);
  assert.equal(hostAllowed('de1.api.radio-browser.info'), true);
  assert.equal(hostAllowed('evil.example'), false);
});

test('SRT to WebVTT', () => {
  const vtt = srtToVtt('1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld\r\n');
  assert.equal(vtt, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello\n\n00:00:03.000 --> 00:00:04.000\nWorld\n');
});

test('artwork matching', () => {
  assert.equal(similar('Abbey Road (Remastered)', 'abbey road'), true);
  assert.equal(similar('Help!', 'Rubber Soul'), false);
});

test('command line parsing', () => {
  const file = __filename.replace(/\.js$/, '.js');
  const args = parseArgs(['ipod.exe', '--ipod-command=next', '--hidden', file, 'missing.mp3', '--flag']);
  assert.deepEqual(args.commands, ['next']);
  assert.equal(args.hidden, true);
  assert.deepEqual(args.files, []); // .js isn't audio; missing.mp3 doesn't exist
});
