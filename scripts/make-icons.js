'use strict';

/**
 * Renders the app icon (an iPod 5th gen front) to PNG and ICO.
 * Run with: npx electron scripts/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#f4f4f5"/><stop offset="1" stop-color="#dcdde0"/>
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8f9fa"/><stop offset="0.5" stop-color="#9ea2a8"/><stop offset="1" stop-color="#e2e4e7"/>
    </linearGradient>
    <linearGradient id="sel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7dbcf5"/><stop offset="0.5" stop-color="#3a83e3"/><stop offset="1" stop-color="#2a74dc"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d3d8dd"/>
    </linearGradient>
    <radialGradient id="wheel" cx="0.5" cy="0.32" r="0.7">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#ececec"/><stop offset="1" stop-color="#d9d9d9"/>
    </radialGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.65"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0.08"/><stop offset="0.46" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-opacity="0.35"/></filter>
  </defs>
  <g filter="url(#shadow)">
    <rect x="52" y="10" width="152" height="236" rx="20" fill="url(#rim)"/>
    <rect x="54" y="12" width="148" height="232" rx="19" fill="url(#body)"/>
  </g>
  <rect x="64" y="26" width="128" height="98" rx="6" fill="#1b1c1d"/>
  <rect x="69" y="31" width="118" height="88" rx="2" fill="#ffffff"/>
  <rect x="69" y="31" width="118" height="12" fill="url(#bar)"/>
  <rect x="69" y="45" width="118" height="12" fill="url(#sel)"/>
  <rect x="74" y="62" width="62" height="5" rx="2.5" fill="#2b2f33" opacity="0.8"/>
  <rect x="74" y="74" width="50" height="5" rx="2.5" fill="#2b2f33" opacity="0.8"/>
  <rect x="74" y="86" width="68" height="5" rx="2.5" fill="#2b2f33" opacity="0.8"/>
  <rect x="74" y="98" width="44" height="5" rx="2.5" fill="#2b2f33" opacity="0.8"/>
  <circle cx="128" cy="186" r="47" fill="url(#wheel)" stroke="#cfcfcf" stroke-width="1.5"/>
  <circle cx="128" cy="186" r="18" fill="#fbfbfb" stroke="#d0d0d0" stroke-width="1.5"/>
  <rect x="54" y="12" width="148" height="232" rx="19" fill="url(#gloss)"/>
</svg>`;

const traySvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect x="7" y="1.5" width="18" height="29" rx="3.5" fill="#f5f5f5" stroke="#6b7076" stroke-width="1.2"/>
  <rect x="9.5" y="4" width="13" height="10" rx="1" fill="#2a74dc"/>
  <circle cx="16" cy="22" r="5.6" fill="#d9d9d9" stroke="#6b7076" stroke-width="0.9"/>
  <circle cx="16" cy="22" r="2" fill="#ffffff" stroke="#6b7076" stroke-width="0.7"/>
</svg>`;

/**
 * The Mac menu bar icon: a "template" (black and transparent; macOS colours
 * it to suit the menu bar). An iPod with its screen and wheel cut out.
 */
const trayTemplateSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <defs><mask id="m">
    <rect width="32" height="32" fill="#fff"/>
    <rect x="10.4" y="5" width="11.2" height="8.6" rx="1" fill="#000"/>
    <circle cx="16" cy="21.6" r="5.5" fill="#000"/>
  </mask></defs>
  <rect x="7.6" y="2" width="16.8" height="28" rx="3.6" fill="#000" mask="url(#m)"/>
  <circle cx="16" cy="21.6" r="1.9" fill="#000"/>
</svg>`;

/** Taskbar thumbnail buttons: white glyphs on the dark preview, 16px at 1x. */
const glyph = (body) => (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16"><g fill="#ffffff">${body}</g></svg>`;
const THUMBS = {
  'thumb-prev': glyph('<rect x="2" y="3" width="2" height="10" rx="0.6"/><path d="M8.5 8 L14 3.4 V12.6 Z"/><path d="M3.5 8 L9 3.4 V12.6 Z"/>'),
  'thumb-next': glyph('<rect x="12" y="3" width="2" height="10" rx="0.6"/><path d="M7.5 8 L2 3.4 V12.6 Z"/><path d="M12.5 8 L7 3.4 V12.6 Z"/>'),
  'thumb-play': glyph('<path d="M4 2.5 L13.5 8 L4 13.5 Z"/>'),
  'thumb-pause': glyph('<rect x="3.5" y="2.5" width="3.2" height="11" rx="0.8"/><rect x="9.3" y="2.5" width="3.2" height="11" rx="0.8"/>'),
};

async function render(win, markup, size) {
  await win.setContentSize(size, size);
  await win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden">${markup}</body></html>`)
  );
  await new Promise((r) => setTimeout(r, 150));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  return img.resize({ width: size, height: size, quality: 'best' }).toPNG();
}

function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1024,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setFrameRate(30);
  const out = (p) => path.join(ROOT, p);
  fs.mkdirSync(out('build'), { recursive: true });
  fs.mkdirSync(out('src/assets'), { recursive: true });

  // 1024px for the Mac app icon (electron-builder makes the .icns from it).
  fs.writeFileSync(out('build/icon.png'), await render(win, svg(1024), 1024));
  fs.writeFileSync(out('src/assets/icon.png'), await render(win, svg(256), 256));

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const entries = [];
  for (const size of sizes) {
    const markup = size <= 32 ? traySvg(size) : svg(size);
    entries.push({ size, data: await render(win, markup, size) });
  }
  const icoBuf = ico(entries);
  fs.writeFileSync(out('build/icon.ico'), icoBuf);
  fs.writeFileSync(out('src/assets/icon.ico'), icoBuf);
  // Tray: 16px at 100% scaling, with sharper versions for 150% and 200%.
  fs.writeFileSync(out('src/assets/tray.png'), await render(win, traySvg(16), 16));
  fs.writeFileSync(out('src/assets/tray@1.5x.png'), await render(win, traySvg(24), 24));
  fs.writeFileSync(out('src/assets/tray@2x.png'), await render(win, traySvg(32), 32));
  // Mac menu bar: 18pt, at 1x and 2x.
  fs.writeFileSync(out('src/assets/trayTemplate.png'), await render(win, trayTemplateSvg(18), 18));
  fs.writeFileSync(out('src/assets/trayTemplate@2x.png'), await render(win, trayTemplateSvg(36), 36));
  for (const [name, make] of Object.entries(THUMBS)) {
    fs.writeFileSync(out(`src/assets/${name}.png`), await render(win, make(16), 16));
    fs.writeFileSync(out(`src/assets/${name}@2x.png`), await render(win, make(32), 32));
  }
  console.log('icons written');
  app.quit();
});
