import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, getModel, getColor, capacityFor, depthFor, edgeBand } from '../../src/renderer/js/models.js';

/** How far the edge curves out beyond the flat face. */
const curve = (m) => Math.max(m.profile.lip, m.profile.bandR);

// The published outside dimensions (width, height), in mm.
const OVERALL = {
  video: [61.8, 103.5],
  classic: [61.8, 103.5],
  nano3: [52.3, 69.8],
  mini: [50.8, 91.4],
  original: [61.7, 102.1],
};

test('every model adds up to its published size', () => {
  for (const m of MODELS) {
    const [W, H] = OVERALL[m.id];
    const e = curve(m);
    assert.ok(Math.abs(m.size[0] + 2 * e - W) < 0.15, `${m.id} width ${m.size[0] + 2 * e} vs ${W}`);
    assert.ok(Math.abs(m.size[1] + 2 * e - H) < 0.15, `${m.id} height ${m.size[1] + 2 * e} vs ${H}`);
  }
});

test('screens, wheels and ports sit on the face', () => {
  for (const m of MODELS) {
    const [W, H] = m.size;
    const s = m.screen;
    assert.ok(s.x > 0 && s.y > 0 && s.x + s.w < W && s.y + s.h < H, `${m.id} screen window inside the face`);
    // The LCD's aspect matches its resolution's, so pixels are square.
    const lcdW = s.w - s.inset[0] * 2;
    const lcdH = (s.res[1] / s.res[0]) * lcdW;
    assert.ok(lcdH <= s.h - 0.5, `${m.id} LCD fits its window`);
    const w = m.wheel;
    assert.ok(w.cy - w.d / 2 > s.y + s.h, `${m.id} wheel below the screen`);
    assert.ok(w.cy + w.d / 2 < H && w.d < W, `${m.id} wheel on the face`);
    assert.ok(w.center < (w.inner || w.d) * 0.6, `${m.id} centre button inside the wheel`);
    for (const p of m.ports) assert.ok(p.x > 2 && p.x < W - 2, `${m.id} ${p.kind} along its edge`);
    assert.equal(m.ports.filter((p) => p.kind === 'hold').length, 1, `${m.id} has one hold switch`);
    assert.ok(m.screen.ui.rows >= 5 && m.screen.ui.title > 0);
    assert.ok(m.colors.length > 0);
    for (const c of m.colors) for (const k of ['front', 'wheel', 'label', 'center']) assert.match(c[k], /^#[0-9a-f]{6}$/i, `${m.id} ${c.id} ${k}`);
  }
});

test('the edge band leaves room for the ports, at every thickness', () => {
  for (const m of MODELS) {
    for (const T of new Set([m.depth, ...Object.values(m.depths || {})])) {
      const b = edgeBand(m, T);
      assert.ok(b.to < b.from, `${m.id} ${T}mm band runs front to back`);
      assert.ok(b.from - b.to >= 2.9, `${m.id} ${T}mm band is ${(b.from - b.to).toFixed(1)}mm, too narrow for the hold switch`);
      assert.ok(Math.abs(-T - (b.to - b.fillet)) < 1e-9, `${m.id} ${T}mm the back curve ends at the back`);
    }
  }
});

test('capacities and thickness', () => {
  const video = getModel('video');
  assert.equal(capacityFor(video, 28), '30GB');
  assert.equal(capacityFor(video, 500), '80GB', 'the biggest made');
  assert.equal(capacityFor(video, 0), '30GB');
  assert.equal(depthFor(video, '30GB'), 11);
  assert.equal(depthFor(video, '80GB'), 14);
  const classic = getModel('classic');
  assert.equal(capacityFor(classic, 100), '120GB');
  assert.equal(depthFor(classic, '160GB'), 13.5);
  assert.equal(depthFor(classic, '80GB'), 10.5);
  assert.equal(depthFor(getModel('mini'), '6GB'), 12.7);
  assert.equal(capacityFor(getModel('original'), 7), '10GB');
});

test('models and colours fall back sensibly', () => {
  assert.equal(getModel('nope').id, 'video');
  const nano = getModel('nano3');
  assert.equal(getColor(nano, 'white').id, 'silver', "a colour this model doesn't come in gives its first");
  assert.equal(getColor(nano, 'pink').front, nano.colors.find((c) => c.id === 'pink').front);
  const custom = getColor(nano, 'custom', { front: '#123456', wheel: '#ffffff', label: '#000000', center: '#123456' });
  assert.equal(custom.front, '#123456');
});
