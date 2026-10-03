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
  /** Wait until the iPod has finished starting up (boot animation, library). */
  const ready = async () => {
    for (let i = 0; i < 300; i++) {
      if (await js('!!(window.__ipod && window.__ipod.booted)').catch(() => false)) return;
      await wait(100);
    }
    throw new Error('the iPod never finished booting');
  };
  const errors = [];
  win.webContents.on('console-message', (e) => {
    const { level, message } = e;
    if (level === 'error' || level === 3) errors.push(message);
    console.log(`[renderer:${level}] ${message}`);
  });

  const shot = async (name, w = win) => {
    // Grabbing a window's pixels occasionally fails on software GPUs; retry,
    // and for secondary windows (the Spotify setup) just warn.
    for (let attempt = 1; ; attempt++) {
      try {
        const img = await w.webContents.capturePage();
        fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
        console.log('shot', name);
        return;
      } catch (err) {
        if (attempt < 3) {
          await wait(400);
          continue;
        }
        if (w !== win) return console.log(`(couldn't capture ${name}: ${err.message})`);
        throw err;
      }
    }
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

  const scenario = {
    spotify: spotifyScenario,
    media: mediaScenario,
    motion: motionScenario,
    reel: reelScenario,
    finish: finishScenario,
    screens: screensScenario,
    itunes: itunesScenario,
  }[process.env.IPOD_E2E_STEPS];
  if (scenario) {
    try {
      await ready();
      await scenario({ js, wait, shot, press, scroll, open, menu, select, win });
    } catch (err) {
      console.error('E2E failed', err);
      errors.push(String(err && err.stack));
    }
    fs.writeFileSync(path.join(out, 'errors.json'), JSON.stringify(errors, null, 2));
    console.log(`E2E done, ${errors.length} renderer errors`);
    for (const e of errors) console.log('  error:', e);
    app.exit(errors.length ? 1 : 0);
    return;
  }

  try {
    await ready();
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
  for (const e of errors) console.log('  error:', e);
  app.exit(errors.length ? 1 : 0);
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
  // Waking from sleep must light the screen back up.
  const lit = await js(`({ dim: getComputedStyle(__ipod.os.dimmer).opacity, backlit: __ipod.device.screen.classList.contains('backlit') })`);
  if (lit.dim !== '0' || !lit.backlit) throw new Error(`screen still dark after waking: ${JSON.stringify(lit)}`);
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

/** Surface finishes: the worn mirror back and the reflections in the screen glass. */
async function finishScenario({ js, wait, shot }) {
  await wait(2500);
  const pointAt = (dx, dy) =>
    js(`(() => { const w = innerWidth, h = innerHeight; __ipod.device.rig.cursor({ x: w / 2 + ${dx}, y: h / 2 + ${dy}, w, h, sx: 0, sy: 0 }); })()`);
  const settle = () => js(`new Promise(r => { const t = () => (__ipod.device.rig._raf ? setTimeout(t, 50) : r()); t(); })`);
  await js(`__ipod.store.set('idleFloat', false); __ipod.store.set('motion', 'cursor'); __ipod.store.set('motionAmount', 'normal'); __ipod.store.set('color', ${JSON.stringify(process.env.IPOD_REEL_COLOR || 'white')}); __ipod.store.set('wear', ${JSON.stringify(process.env.IPOD_WEAR || 'light')})`);
  await wait(800);
  await js(`__ipod.device.flip(true)`);
  await settle();
  for (const [name, dx, dy] of [
    ['f01-back-rest', 0, 0],
    ['f02-back-right', 900, 100],
    ['f03-back-left', -900, 100],
    ['f04-back-up-left', -800, -900],
    ['f05-back-down', 0, 900],
  ]) {
    await pointAt(dx, dy);
    await settle();
    await shot(name);
  }
  await js(`__ipod.device.flip(false)`);
  await settle();
  for (const [name, dx, dy] of [
    ['f06-screen-rest', 0, 0],
    ['f07-screen-up-left', -900, -900],
  ]) {
    await pointAt(dx, dy);
    await js(`__ipod.os.activity()`);
    await settle();
    await shot(name);
  }
  // Screen off: deep black glass showing the reflections.
  await js(`__ipod.os.sleep()`);
  await wait(600);
  for (const [name, dx, dy] of [
    ['f08-off-rest', 0, 0],
    ['f09-off-up-left', -900, -900],
    ['f10-off-left', -900, 0],
  ]) {
    await pointAt(dx, dy);
    await settle();
    await shot(name);
  }
  await js(`__ipod.os.wake()`);
  // The edges: tip it right over to see the top (hold switch, jack) and the bottom (dock).
  await js(`__ipod.store.set('motionAmount', 'dramatic')`);
  await wait(300);
  for (const [name, rx] of [
    ['f11-top', -38],
    ['f12-bottom', 38],
  ]) {
    await js(`(() => { const r = __ipod.device.rig; r.aim = { rx: ${rx}, ry: -8 }; r.wake(); })()`);
    await wait(200);
    await js(`new Promise(r => { const t = () => (__ipod.device.rig._raf ? setTimeout(t, 50) : r()); t(); })`);
    console.log(name, await js(`__ipod.device.flipper.style.transform`));
    await shot(name);
  }
  await js(`(() => { const r = __ipod.device.rig; r.rx.snap(0); r.ry.snap(0); })(); __ipod.store.set('motion', 'cursor'); __ipod.store.set('motionAmount', 'normal'); __ipod.store.set('idleFloat', true)`);
}

/** A tour of the screens the other scenarios don't reach, for a visual check. */
/**
 * iTunes: the test profile points at an iTunes library for the test songs
 * (scripts/make-test-itunes.js). Its playlists, ratings and play counts show
 * up on the iPod, the iPod's own ratings win, and turning it off removes it.
 */
async function itunesScenario({ js, wait, shot, open, menu }) {
  const check = (ok, what) => {
    if (!ok) throw new Error(`iTunes: ${what}`);
    console.log('ok -', what);
  };
  const home = async () => {
    await js(`__ipod.os.goto([])`).catch(() => {});
    for (let i = 0; i < 6 && (await js(`__ipod.os.stack.length`)) > 1; i++) await menu();
  };
  await js(`__ipod.store.set('idleFloat', false)`);
  await js(`__ipod.library.scanning ? new Promise(r => __ipod.library.on('scan', on => !on && r())) : null`);
  for (let i = 0; i < 100 && !(await js(`!!(__ipod.library.itunes && __ipod.library.itunes.matched)`)); i++) await wait(100);
  const st = await js(`(() => { const s = __ipod.library.itunes; return s && { matched: s.matched, total: s.total, playlists: s.playlists.map((p) => p.name) }; })()`);
  console.log('ITUNES', JSON.stringify(st));
  check(st && st.matched === 19 && st.total === 20, 'every song on this computer matched; the one on a missing drive is not');
  check(JSON.stringify(st.playlists) === JSON.stringify(['Road Trips', 'Night Drive', 'Five Stars']), 'playlists: the folder, the one in it and the smart one (no built-in or empty ones)');

  const stats = await js(`(() => {
    const L = __ipod.library, S = __ipod.store;
    const id = (title) => L.tracks.find((t) => t.title === title).id;
    const top = L.smartPlaylists().find((p) => p.id === 'smart:top25').tracks.map((t) => t.title);
    const rated = L.smartPlaylists().find((p) => p.id === 'smart:rated').tracks.map((t) => t.title);
    return { top, rated, coast: S.plays(id('Coastline')), hl: S.rating(id('Highway Lights')), orbit: S.rating(id('Orbit')),
      added: new Date(L.byId.get(id('Coastline')).addedAt).getFullYear() };
  })()`);
  console.log('STATS', JSON.stringify(stats));
  check(stats.top[0] === 'Coastline' && stats.coast === 77, 'play counts from iTunes fill Top 25 Most Played');
  check(stats.hl === 5 && stats.rated.includes('Highway Lights') && stats.rated.includes('Coastline'), 'star ratings from iTunes, in My Top Rated');
  check(stats.orbit === 0, 'a rating iTunes worked out from the album is ignored');
  check(stats.added === 2006, 'Date Added comes from iTunes');

  await home();
  await open('Music');
  await open('Playlists');
  await wait(900); // software rendering can be a frame or two behind
  await shot('i01-playlists');
  const labels = await js(`__ipod.os.current.items.map((i) => i.label)`);
  check(labels.includes('Road Trips') && labels.includes('Five Stars') && !labels.includes('Empty One') && !labels.includes('Music'), 'iTunes playlists in Music › Playlists');
  await open('Road Trips');
  await wait(300);
  check(JSON.stringify(await js(`__ipod.os.current.items.map((i) => i.label)`)) === JSON.stringify(['Night Drive']), 'a playlist folder opens to the playlists in it');
  await open('Night Drive');
  await wait(900);
  await shot('i02-night-drive');
  const order = await js(`__ipod.os.current.items.map((i) => typeof i.label === 'function' ? i.label() : i.label)`);
  console.log('ORDER', JSON.stringify(order));
  check(JSON.stringify(order) === JSON.stringify(['Tunnel Vision', 'Afterglow', 'Night Bus Home']), 'songs in the playlist’s own order');

  // A rating given on the iPod wins over iTunes'.
  const mine = await js(`(() => { const id = __ipod.library.tracks.find((t) => t.title === 'Highway Lights').id; __ipod.store.user.ratings[id] = 2; return __ipod.store.rating(id); })()`);
  check(mine === 2, 'your iPod rating wins over iTunes');

  await home();
  await open('Settings');
  await open('Music Library');
  await wait(300);
  await js(`(() => { const v = __ipod.os.current; const i = v.items.findIndex((x) => x.label === 'iTunes Library'); v.sel = i; v.paint(); })()`);
  await shot('i03-library-settings');
  await open('iTunes Library');
  await wait(400);
  await shot('i04-itunes-settings');

  // Off: the playlists and stats go; on again: back.
  await js(`__ipod.store.set('itunes', false)`);
  await wait(800);
  const off = await js(`({ lists: __ipod.library.itunesPlaylists().length, stats: __ipod.store.itunesStats, plays: __ipod.store.plays(__ipod.library.tracks.find((t) => t.title === 'Coastline').id) })`);
  check(off.lists === 0 && off.stats === null && off.plays === 0, 'turning iTunes off removes its playlists and stats');
  await js(`__ipod.store.set('itunes', true)`);
  for (let i = 0; i < 50 && !(await js(`!!__ipod.library.itunes`)); i++) await wait(100);
  check(await js(`__ipod.library.itunesPlaylists().length === 2`), 'and turning it back on brings them back');
}

async function screensScenario({ js, wait, shot, press, scroll, open, menu }) {
  const home = async () => {
    await js(`__ipod.os.goto([])`).catch(() => {});
    for (let i = 0; i < 6 && (await js(`__ipod.os.stack.length`)) > 1; i++) await menu();
  };
  const step = async (name, path, after) => {
    await home();
    for (const label of path) await open(label);
    await wait(500);
    if (after) await after();
    await shot(name);
  };
  await js(`__ipod.store.set('idleFloat', false)`);
  await step('v01-coverflow', ['Music', 'Cover Flow'], () => wait(600));
  await press('select');
  await wait(700);
  await shot('v02-coverflow-open');
  await press('menu');
  await step('v03-new-playlist', ['Music', 'Playlists', 'New Playlist…']);
  await step('v04-radio', ['Radio'], () => wait(1500));
  await step('v05-podcasts', ['Podcasts'], () => wait(800));
  await step('v06-games', ['Extras', 'Games']);
  await step('v07-solitaire', ['Extras', 'Games', 'Solitaire'], () => wait(800));
  await step('v08-contacts', ['Extras', 'Contacts']);
  await step('v09-notes', ['Extras', 'Notes']);
  await step('v10-appearance', ['Settings', 'Appearance']);
  await scroll(1, 12);
  await wait(300);
  await shot('v11-appearance-more');
  await step('v12-colors', ['Settings', 'Appearance', 'Custom Colors…']);
  await step('v13-eq', ['Settings', 'EQ']);
  await step('v14-playback', ['Settings', 'Playback']);
  await home();
  await js(`__ipod.store.set('idleFloat', true)`);
}
