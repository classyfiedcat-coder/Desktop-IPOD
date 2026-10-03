import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionRig, Spring, MOTION_AMOUNTS, IDLE_AFTER, FLOAT_FOR, FLOAT_FADE } from '../../src/renderer/js/rig.js';

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

// ------------------------------------------------------------- frame pacing --

/**
 * Runs the rig against a simulated display (vsync at `hz`) and clock, so the
 * number of frames it draws can be counted. Returns helpers to drive it.
 */
function simulate(hz = 60) {
  const saved = { performance: globalThis.performance, raf: globalThis.requestAnimationFrame, st: globalThis.setTimeout, ct: globalThis.clearTimeout };
  let now = 100000;
  let rafs = [];
  let timers = [];
  let seq = 0;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true, writable: true });
  globalThis.requestAnimationFrame = (cb) => (rafs.push(cb), ++seq);
  globalThis.setTimeout = (cb, ms) => {
    const id = ++seq;
    timers.push({ id, cb, at: now + ms });
    return id;
  };
  globalThis.clearTimeout = (id) => (timers = timers.filter((t) => t.id !== id));
  const fake = () => ({ style: {}, dataset: {}, classList: { contains: () => false, toggle() {} }, querySelectorAll: () => [], querySelector: () => null });
  const rig = new MotionRig();
  rig.attach({ el: fake(), flipper: fake(), ground: null, lcd: null, thickness: 40, depth: 2, pad: 40 });
  let frames = 0;
  const apply = rig.apply.bind(rig);
  rig.apply = () => {
    frames++;
    apply();
  };
  const vsync = 1000 / hz;
  return {
    rig,
    get now() {
      return now;
    },
    /** Let `ms` of time pass; returns the frames drawn meanwhile. */
    run(ms) {
      const end = now + ms;
      const start = frames;
      while (now < end) {
        const nextVsync = rafs.length ? Math.floor(now / vsync + 1) * vsync : Infinity;
        const nextTimer = timers.length ? Math.min(...timers.map((t) => t.at)) : Infinity;
        const next = Math.min(nextVsync, nextTimer, end);
        now = next;
        if (next === nextTimer) {
          const due = timers.filter((t) => t.at <= now);
          timers = timers.filter((t) => t.at > now);
          for (const t of due) t.cb();
        }
        if (next === nextVsync) {
          const cbs = rafs;
          rafs = [];
          for (const cb of cbs) cb(now);
        }
      }
      return frames - start;
    },
    idle: () => !rafs.length && !timers.length,
    restore() {
      Object.defineProperty(globalThis, 'performance', { value: saved.performance, configurable: true, writable: true });
      globalThis.requestAnimationFrame = saved.raf;
      globalThis.setTimeout = saved.st;
      globalThis.clearTimeout = saved.ct;
    },
  };
}

test('floating alone draws about 20 frames a second, not 60', () => {
  const sim = simulate(60);
  try {
    sim.rig.configure({ float: true });
    sim.rig.lastInput = sim.now - IDLE_AFTER - 20000;
    sim.rig.wake();
    sim.run(2000); // settle into the float
    const fps = sim.run(10000) / 10;
    assert.ok(fps > 12 && fps < 26, `float ran at ${fps} fps`);
  } finally {
    sim.restore();
  }
});

test('after a few minutes alone it comes to rest and stops drawing', () => {
  const sim = simulate(60);
  try {
    sim.rig.configure({ float: true });
    // Two seconds of float left, then the fade.
    sim.rig.lastInput = sim.now - IDLE_AFTER - FLOAT_FOR + 2000;
    sim.rig.wake();
    sim.run(2000 + FLOAT_FADE + 3000);
    assert.equal(sim.run(10000), 0, 'no frames once it has come to rest');
    assert.ok(sim.idle(), 'and nothing scheduled');
    // A touch brings it back.
    sim.rig.nudge('menu');
    assert.ok(sim.run(500) > 10);
  } finally {
    sim.restore();
  }
});

test('a 144 Hz screen draws the motion at most ~90 times a second', () => {
  const sim = simulate(144);
  try {
    sim.rig.configure({ float: false });
    sim.rig.flip(true);
    const fps = sim.run(1000);
    assert.ok(fps > 55 && fps <= 91, `flip drew ${fps} frames in a second`);
  } finally {
    sim.restore();
  }
});

test('pointer moves too small to see do not draw a frame', () => {
  const sim = simulate(60);
  try {
    sim.rig.configure({ float: false });
    const far = (x) => sim.rig.cursor({ x, y: view.h / 2, ...view });
    far(20000);
    sim.run(3000);
    assert.ok(sim.idle(), 'settled');
    // Far away, a few pixels of movement changes the tilt by a hair.
    for (let i = 1; i <= 5; i++) far(20000 + i);
    assert.ok(sim.idle(), 'no frame for an invisible change');
    // A real move does.
    far(view.w / 2 + 100);
    assert.ok(sim.run(500) > 10);
  } finally {
    sim.restore();
  }
});
