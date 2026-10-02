import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionRig, Spring, MOTION_AMOUNTS } from '../../src/renderer/js/rig.js';

const view = { w: 400, h: 600 };

test('springs settle on their target without blowing up', () => {
  // Tilt and flip are nearly critically damped; the press spring is meant to bounce.
  for (const [k, c, maxOvershoot] of [
    [64, 12.5, 0.1],
    [44, 11.2, 0.1],
    [380, 20, 0.25],
  ]) {
    const s = new Spring(k, c);
    s.target = 180;
    let peak = 0;
    // Uneven frame times, like a real display.
    for (let i = 0; i < 400; i++) {
      s.step(i % 7 === 0 ? 0.033 : 0.008);
      peak = Math.max(peak, s.x);
    }
    assert.ok(s.settled, `k=${k} settles`);
    assert.ok(peak < 180 * (1 + maxOvershoot), `k=${k} overshoot (peak ${peak.toFixed(1)})`);
  }
});

test('the iPod turns toward the pointer', () => {
  const rig = new MotionRig();
  rig.cursor({ x: 1400, y: view.h / 2, ...view });
  assert.ok(rig.aim.ry > 0, 'pointer to the right turns it right');
  assert.ok(Math.abs(rig.aim.rx) < 1e-9);
  rig.cursor({ x: view.w / 2, y: -900, ...view });
  assert.ok(rig.aim.rx > 0, 'pointer above tips the face up');
  // Far away it levels off instead of growing without limit.
  rig.cursor({ x: 1e6, y: view.h / 2, ...view });
  assert.ok(rig.aim.ry <= MOTION_AMOUNTS.normal * 1.45 + 1e-9);
});

test('motion modes', () => {
  const rig = new MotionRig();
  rig.configure({ mode: 'hover' });
  rig.pad = 40;
  rig.cursor({ x: 1400, y: 10, ...view });
  assert.deepEqual(rig.aim, { rx: 0, ry: 0 }, 'hover mode ignores a pointer outside the iPod');
  rig.cursor({ x: 300, y: 100, ...view });
  assert.ok(rig.aim.ry > 0, 'but follows it over the iPod');
  rig.configure({ mode: 'off' });
  rig.cursor({ x: 300, y: 100, ...view });
  assert.deepEqual(rig.aim, { rx: 0, ry: 0 });
  rig.nudge('menu');
  assert.equal(rig.rx.v, 0, 'no nudges when motion is off');
  rig.setDragging(true);
  assert.equal(rig.lift.target, 0, 'and no lifting, so it stays sharp');
});

test('amounts scale the tilt', () => {
  const tilt = (amount) => {
    const rig = new MotionRig();
    rig.configure({ amount });
    rig.cursor({ x: 1400, y: view.h / 2, ...view });
    return rig.aim.ry;
  };
  assert.ok(tilt('subtle') < tilt('normal'));
  assert.ok(tilt('normal') < tilt('dramatic'));
});

test('presses push the pressed edge in', () => {
  const rig = new MotionRig();
  rig.nudge('menu');
  assert.ok(rig.rx.v < 0, 'MENU (top) tips the top back');
  rig.nudge('next');
  assert.ok(rig.ry.v < 0, 'next (right) pushes the right edge back');
  rig.nudge('select');
  assert.ok(rig.push.v > 0);
  rig.flip(true);
  assert.equal(rig.flipS.target, 180);
  assert.ok(rig.flipS.v > 0, 'a flip starts with a flick');
});
