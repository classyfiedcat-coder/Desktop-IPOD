'use strict';

/**
 * Drives the running app and saves screenshots. Used for development:
 *
 *   IPOD_E2E=scripts/e2e.js IPOD_SHOTS=./shots IPOD_USER_DATA=./tmp-profile electron .
 *
 * Optional IPOD_E2E_STEPS selects a scenario (default "tour").
 */

const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

module.exports = async ({ app, win }) => {
  const out = path.resolve(process.env.IPOD_SHOTS || 'shots');
  fs.mkdirSync(out, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => win.webContents.executeJavaScript(code);
  const errors = [];
  win.webContents.on('console-message', (e) => {
    const { level, message } = e;
    if (level === 'error' || level === 3) errors.push(message);
    console.log(`[renderer:${level}] ${message}`);
  });

  const shot = async (name, w = win) => {
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
    console.log('shot', name);
  };
  const press = async (button, hold = 60) => {
    await js(`__ipod.device.emit('down', { button: '${button}' })`);
    await wait(hold);
    await js(`__ipod.device.emit('up', { button: '${button}' })`);
    await wait(320);
  };
  const scroll = async (dir, n = 1, speed = 4) => {
    for (let i = 0; i < n; i++) {
      await js(`__ipod.device.emit('scroll', { dir: ${dir}, speed: ${speed} })`);
      await wait(30);
    }
    await wait(150);
  };
  const select = (label) =>
    js(`(() => { const v = __ipod.os.current; const i = (v.items || []).findIndex(it => (typeof it.label === 'function' ? it.label() : it.label) === ${JSON.stringify(label)}); if (i < 0) return false; v.sel = i; v.paint(); return true; })()`);
  const open = async (label) => {
    const ok = await select(label);
    if (!ok) console.log('!! item not found', label);
    await wait(80);
    await press('select');
    await wait(250);
  };
  const menu = async (n = 1) => {
    for (let i = 0; i < n; i++) await press('menu');
  };

  const scenario = { spotify: spotifyScenario, media: mediaScenario, motion: motionScenario, reel: reelScenario }[process.env.IPOD_E2E_STEPS];
  if (scenario) {
    try {
      await scenario({ js, wait, shot, press, scroll, open, menu, select, win });
    } catch (err) {
      console.error('E2E failed', err);
      errors.push(String(err && err.stack));
    }
    fs.writeFileSync(path.join(out, 'errors.json'), JSON.stringify(errors, null, 2));
    console.log(`E2E done, ${errors.length} renderer errors`);
    app.quit();
    return;
  }

  try {
    await wait(2500);
    await js(`__ipod.library.scanning ? new Promise(r => __ipod.library.on('scan', on => !on && r())) : null`);
    await wait(500);
    await shot('01-main');

    // Real mouse input on the click wheel: spin, then click the centre and MENU.
    const g = await js(`(() => { const r = document.querySelector('.wheel').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 }; })()`);
    const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    const ring = g.r * 0.72;
    const at = (deg) => [g.cx + Math.sin((deg * Math.PI) / 180) * ring, g.cy - Math.cos((deg * Math.PI) / 180) * ring];
    mouse('mouseDown', ...at(0));
    for (let d = 0; d <= 100; d += 4) {
      mouse('mouseMove', ...at(d));
      await wait(12);
    }
    mouse('mouseUp', ...at(100));
    await wait(300);
    const afterSpin = await js(`({ sel: __ipod.os.current.sel, title: __ipod.os.current.title })`);
    console.log('WHEEL spin clockwise 100deg ->', JSON.stringify(afterSpin));
    for (let d = 100; d >= 0; d -= 4) {
      if (d === 100) mouse('mouseDown', ...at(d));
      mouse('mouseMove', ...at(d));
      await wait(12);
    }
    mouse('mouseUp', ...at(0));
    await wait(300);
    console.log('WHEEL spin back ->', JSON.stringify(await js(`({ sel: __ipod.os.current.sel })`)));
    mouse('mouseDown', g.cx, g.cy);
    await wait(60);
    mouse('mouseUp', g.cx, g.cy);
    await wait(500);
    console.log('WHEEL centre click ->', JSON.stringify(await js(`({ title: __ipod.os.current.title })`)));
    mouse('mouseDown', ...at(0).map((v, i) => (i === 1 ? g.cy - g.r * 0.8 : v)));
    await wait(60);
    mouse('mouseUp', ...at(0).map((v, i) => (i === 1 ? g.cy - g.r * 0.8 : v)));
    await wait(500);
    console.log('WHEEL menu click ->', JSON.stringify(await js(`({ title: __ipod.os.current.title, depth: __ipod.os.stack.length })`)));
    await js(`(() => { const v = __ipod.os.current; v.sel = 0; v.paint(); })()`);

    await open('Music');
    await shot('02-music');
    await open('Songs');
    await scroll(1, 2);
    await shot('03-songs');
    await press('select');
    await wait(1800);
    await shot('04-nowplaying');
    await scroll(1, 4);
    await shot('05-volume');
    await wait(2200);
    await press('select');
    await scroll(1, 3);
    await shot('06-scrub');
    await press('select');
    await scroll(1, 4);
    await shot('07-rating');
    await menu(2);
    await open('Albums');
    await shot('08-albums');
    await menu(2);

    await open('Extras');
    await shot('09-extras');
    await open('Clocks');
    await press('select');
    await wait(400);
    await shot('10-clock');
    await menu(2);
    await open('Games');
    await open('Brick');
    await press('select');
    await scroll(1, 5);
    await wait(900);
    await shot('11-brick');
    await menu(2);
    await open('Stopwatch');
    await press('select');
    await wait(1300);
    await press('next');
    await wait(500);
    await shot('12-stopwatch');
    await press('select');
    await menu(2);

    await open('Settings');
    await shot('13-settings');
    await open('About');
    await wait(500);
    await shot('14-about');
    await menu(2);

    await open('Music');
    await open('Search');
    for (const k of 'NEO') await js(`__ipod.device.emit('char', { key: '${k}' })`);
    await wait(400);
    await shot('15-search');
    await menu(2);

    await open('Spotify');
    await shot('16-spotify');
    await menu();

    await js(`__ipod.store.set('color', 'black')`);
    await wait(700);
    await shot('17-black-main');
    await open('Now Playing');
    await wait(800);
    await shot('18-black-nowplaying');
    await press('select', 900); // hold select = options
    await wait(400);
    await shot('19-options');
    await menu();
    await js(`__ipod.store.set('color', 'white')`);
    await wait(500);

    await js(`window.ipod.spotify.openSetup()`);
    await wait(1500);
    const setup = BrowserWindow.getAllWindows().find((w) => w !== win);
    if (setup) await shot('20-spotify-setup', setup);

    await js(`__ipod.device.setHold(true, true)`);
    await wait(250);
    await shot('21-hold');
  } catch (err) {
    console.error('E2E failed', err);
    errors.push(String(err && err.stack));
  }
  fs.writeFileSync(path.join(out, 'errors.json'), JSON.stringify(errors, null, 2));
  console.log(`E2E done, ${errors.length} renderer errors`);
  app.quit();
};

/** Spotify flows against a mocked Web API (February 2026 response shapes). */
async function spotifyScenario({ js, wait, shot, press, scroll, open, menu }) {
  await wait(2000);
  await js(fs.readFileSync(path.join(__dirname, 'spotify-mock.js'), 'utf8'));
  await wait(800);
  await open('Spotify');
  await shot('s01-spotify-root');
  await open('Playlists');
  await wait(400);
  await shot('s02-playlists');
  await open('Road Trip');
  await wait(400);
  await shot('s03-playlist');
  await scroll(1, 1);
  await press('select');
  await wait(1500);
  await shot('s04-nowplaying');
  console.log('SPOTIFY player', JSON.stringify(await js(`({ source: __ipod.player.source, title: __ipod.player.track && __ipod.player.track.title, info: __ipod.player.queueInfo, playing: __ipod.player.playing })`)));
  await press('select');
  await press('select');
  await wait(400);
  await shot('s05-like');
  await scroll(1, 1);
  await wait(400);
  await press('play');
  await wait(400);
  await menu(2);
  await open('Followed Mix');
  await wait(500);
  await shot('s06-restricted-playlist');
  await menu(2);
  await open('Liked Songs');
  await wait(400);
  await shot('s07-liked');
  await menu();
  await open('Search');
  for (const k of 'MOCK') await js(`__ipod.device.emit('char', { key: '${k}' })`);
  await wait(900);
  await shot('s08-search');
  await menu();
  await open('Devices');
  await wait(400);
  await shot('s09-devices');
  console.log('SPOTIFY calls', JSON.stringify(await js('window.__calls')));
}

/** Photos, videos, screen lock, alarms, sleep. */
async function mediaScenario({ js, wait, shot, press, scroll, open, menu }) {
  await wait(2500);
  await open('Photos');
  await wait(600);
  await shot('m01-photos');
  await open('Photo Library');
  await wait(800);
  await scroll(1, 2);
  await shot('m02-grid');
  await press('select');
  await wait(1200);
  await shot('m03-photo');
  await menu(3);
  await open('Videos');
  await wait(500);
  await shot('m04-videos');
  await press('select');
  await wait(2000);
  await shot('m05-video');
  console.log('VIDEO', JSON.stringify(await js(`(() => { const v = document.querySelector('video'); return v ? { t: v.currentTime, paused: v.paused, err: v.error && v.error.code, w: v.videoWidth } : null; })()`)));
  await menu(2);

  await open('Extras');
  await open('Screen Lock');
  await open('Set Combination');
  await scroll(1, 1);
  for (let i = 0; i < 4; i++) await press('select');
  await wait(300);
  await open('Lock');
  await wait(400);
  await shot('m06-locked');
  await menu(1);
  console.log('LOCK after menu', JSON.stringify(await js(`({ title: __ipod.os.current.title, locked: __ipod.locked })`)));
  await scroll(1, 1);
  for (let i = 0; i < 4; i++) await press('select');
  await wait(400);
  console.log('LOCK after code', JSON.stringify(await js(`({ title: __ipod.os.current.title, locked: __ipod.locked })`)));
  await js(`__ipod.os.popToRoot({ animate: false })`);
  await wait(300);

  // Alarm that rings right now.
  await js(`(() => { const n = new Date(); __ipod.store.set('alarms', [{ id: 'x', on: true, hour: n.getHours(), minute: n.getMinutes(), repeat: 'once', sound: 'chime', label: 'Wake Up' }]); __ipod.alarmClock.check(); })()`);
  await wait(700);
  await shot('m07-alarm');
  await press('select');
  await wait(400);
  console.log('ALARM after dismiss', JSON.stringify(await js(`({ title: __ipod.os.current.title, alarms: __ipod.store.settings.alarms.map(a => a.on) })`)));

  await open('Extras');
  await open('Calendar');
  await shot('m08-calendar');
  await menu(1);
  await open('Notes');
  await wait(300);
  await open('Welcome');
  await shot('m09-note');
  await menu(3);

  await press('play', 2000); // hold ▶❚❚ = sleep
  await wait(600);
  await shot('m10-asleep');
  await press('menu');
  await wait(600);
  console.log('SLEEP woke', JSON.stringify(await js(`({ asleep: __ipod.os.asleep })`)));

  await open('Settings');
  await open('EQ');
  await scroll(1, 3);
  await press('select');
  await wait(500);
  console.log('EQ', JSON.stringify(await js(`__ipod.store.settings.eq`)));
  await open('Main Menu');
  await open('Games');
  await menu(2);
  await shot('m11-mainmenu-games');
  await open('Settings');
  await open('Desktop');
  await shot('m12-desktop');
}

/** The living 3D device: pointer tilt, lifting, flipping, colours. */
async function motionScenario({ js, wait, shot, win }) {
  await wait(2500);
  // Pretend the pointer is at (x, y) relative to the window centre.
  const pointAt = (dx, dy) =>
    js(`(() => { const w = innerWidth, h = innerHeight; __ipod.device.rig.cursor({ x: w / 2 + ${dx}, y: h / 2 + ${dy}, w, h, wx: 100, wy: 100, sx: 0, sy: 0 }); __ipod.os.activity(); })()`);
  const settle = () => js(`new Promise(r => { const t = () => (__ipod.device.rig._raf ? setTimeout(t, 50) : r()); t(); })`);

  await js(`__ipod.store.set('idleFloat', false); __ipod.store.set('color', 'white'); __ipod.store.set('motion', 'cursor'); __ipod.store.set('motionAmount', 'normal')`);
  await wait(400);
  await pointAt(0, 0);
  await settle();
  await shot('m01-rest');
  for (const [name, dx, dy] of [
    ['m02-right', 900, 0],
    ['m03-left', -900, 0],
    ['m04-up-left', -700, -600],
    ['m05-down-right', 700, 700],
  ]) {
    await pointAt(dx, dy);
    await settle();
    await shot(name);
  }

  // Real mouse input on the wheel while it's tilted: hit-testing goes through the 3D transform.
  await pointAt(-900, 700);
  await settle();
  const g = await js(`(() => { const r = document.querySelector('.wheel').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 }; })()`);
  const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  const at = (deg) => [g.cx + Math.sin((deg * Math.PI) / 180) * g.r * 0.72, g.cy - Math.cos((deg * Math.PI) / 180) * g.r * 0.72];
  await js(`(() => { const v = __ipod.os.current; v.sel = 0; v.paint(); })()`);
  mouse('mouseDown', ...at(0));
  for (let d = 0; d <= 100; d += 4) {
    mouse('mouseMove', ...at(d));
    await wait(12);
  }
  mouse('mouseUp', ...at(100));
  await wait(300);
  const spun = await js(`__ipod.os.current.sel`);
  console.log('tilted wheel spin 100deg -> sel', spun);
  if (spun < 3) throw new Error(`wheel didn't scroll while tilted (sel ${spun})`);
  await js(`(() => { const v = __ipod.os.current; v.sel = 0; v.paint(); })()`);
  mouse('mouseDown', g.cx, g.cy);
  await wait(60);
  mouse('mouseUp', g.cx, g.cy);
  await wait(500);
  const title = await js(`__ipod.os.current.title`);
  console.log('tilted centre click ->', title);
  if (title !== 'Music') throw new Error(`centre click while tilted opened ${title}`);
  await js(`__ipod.os.pop && __ipod.os.pop()`);
  await wait(400);

  // The hold switch is a fin on the top edge, behind the front plane: still clickable?
  for (const [dx, dy] of [
    [0, 0],
    [-700, 600],
  ]) {
    await pointAt(dx, dy);
    await settle();
    const hb = await js(`(() => { const r = document.querySelector('.hold-switch').getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.2 }; })()`);
    const before = await js(`__ipod.device.hold`);
    mouse('mouseDown', hb.x, hb.y);
    await wait(40);
    mouse('mouseUp', hb.x, hb.y);
    await wait(250);
    const after = await js(`__ipod.device.hold`);
    console.log('hold click', dx, dy, before, '->', after);
    if (after === before) throw new Error('hold switch did not respond to a click');
    await js(`__ipod.device.setHold(false)`);
  }

  // Picked up.
  await pointAt(-500, -400);
  await js(`__ipod.device.rig.setDragging(true)`);
  await settle();
  await shot('m06-lifted');
  await js(`__ipod.device.rig.setDragging(false)`);
  await settle();

  // Flip: capture it on the way round, then the back.
  await js(`__ipod.device.flip(true)`);
  await wait(170);
  await shot('m07-flipping-a');
  await wait(110);
  await shot('m08-flipping-b');
  await settle();
  await pointAt(-600, -300);
  await settle();
  await shot('m09-back');
  await js(`__ipod.device.flip(false)`);
  await settle();

  // Black and dramatic.
  await js(`__ipod.store.set('color', 'black')`);
  await js(`__ipod.store.set('motionAmount', 'dramatic')`);
  await wait(400);
  await pointAt(-800, 500);
  await settle();
  await shot('m10-black-dramatic');
  await pointAt(800, -500);
  await settle();
  await shot('m11-black-dramatic-2');
  await js(`__ipod.device.flip(true)`);
  await wait(240);
  await shot('m12-black-flipping');
  await settle();

  // Motion off → flat and pixel sharp.
  await js(`__ipod.device.flip(false)`);
  await js(`__ipod.store.set('motion', 'off')`);
  await settle();
  const t = await js(`__ipod.device.flipper.style.transform`);
  console.log('flat transform:', t);
  if (t !== 'none') throw new Error(`expected a flat device with motion off, got ${t}`);
  await shot('m13-off');
  await js(`__ipod.store.set('motion', 'cursor'); __ipod.store.set('color', 'white'); __ipod.store.set('motionAmount', 'normal'); __ipod.store.set('idleFloat', true)`);
}

/**
 * Frames for an animated preview: the pointer circles the iPod, it gets
 * picked up and put down, then flipped over and back. Turn them into a GIF
 * with ffmpeg (see docs).
 */
async function reelScenario({ js, wait, win }) {
  const out = path.resolve(process.env.IPOD_SHOTS || 'shots');
  await wait(2500);
  await js(`__ipod.store.set('idleFloat', false); __ipod.store.set('motion', 'cursor'); __ipod.store.set('motionAmount', ${JSON.stringify(process.env.IPOD_REEL_AMOUNT || 'normal')}); __ipod.store.set('color', ${JSON.stringify(process.env.IPOD_REEL_COLOR || 'white')})`);
  await wait(500);
  let n = 0;
  const frame = async () => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `f${String(n++).padStart(4, '0')}.png`), img.toPNG());
  };
  const pointAt = (dx, dy) =>
    js(`(() => { const w = innerWidth, h = innerHeight; __ipod.device.rig.cursor({ x: w / 2 + ${dx}, y: h / 2 + ${dy}, w, h, sx: 0, sy: 0 }); __ipod.os.activity(); })()`);
  // Pointer circling.
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    await pointAt(Math.cos(a) * 700, Math.sin(a) * 600);
    await wait(30);
    await frame();
  }
  // Pick it up, carry it, put it down.
  await js(`__ipod.device.rig.setDragging(true)`);
  for (let i = 0; i < 16; i++) {
    await js(`__ipod.device.rig._windowMoved(${100 + i * 14}, ${100 + Math.sin(i / 3) * 20})`);
    await wait(30);
    await frame();
  }
  await js(`__ipod.device.rig.setDragging(false)`);
  for (let i = 0; i < 12; i++) {
    await wait(30);
    await frame();
  }
  // Flip over and back.
  await js(`__ipod.device.flip(true)`);
  for (let i = 0; i < 26; i++) {
    await wait(30);
    await frame();
  }
  await js(`__ipod.device.flip(false)`);
  for (let i = 0; i < 26; i++) {
    await wait(30);
    await frame();
  }
  await js(`__ipod.store.set('idleFloat', true); __ipod.store.set('motionAmount', 'normal')`);
  console.log('reel frames', n);
}
