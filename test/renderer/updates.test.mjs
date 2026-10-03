import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AutoUpdate, announceUpdate, QUIET_FOR } from '../../src/renderer/js/updates.js';

const require = createRequire(import.meta.url);
const { newer, explain } = require('../../src/main/updater.js');

/** An AutoUpdate wired to fakes, with a clock the test controls. */
function rig({ playing = false, autoUpdate = true, busy = false } = {}) {
  const t = { now: 1_000_000 };
  const calls = { alerts: [], flushes: 0, installs: 0 };
  const store = { settings: { autoUpdate }, flush: () => calls.flushes++ };
  const player = { playing };
  const os = { lastActivity: 0, alert: (msg) => calls.alerts.push(msg) };
  const updates = { status: async () => ({ state: 'idle' }), onStatus: () => {}, install: () => calls.installs++ };
  const state = { busy };
  const au = new AutoUpdate({ store, player, os, updates, busy: () => state.busy, now: () => t.now });
  return { au, t, calls, store, player, os, state };
}

test('a downloaded update installs itself once the iPod is quiet', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { au, t, calls, os } = rig();
    os.lastActivity = t.now;
    au.status({ state: 'ready', version: '2.0.2' });
    assert.equal(calls.installs, 0, 'not while you were just using it');
    t.now += QUIET_FOR - 1000;
    assert.equal(au.tick(), false, 'still too soon');
    t.now += 2000;
    assert.equal(au.tick(), true, 'quiet for long enough');
    assert.deepEqual(calls.alerts, ['Updating to 2.0.2…']);
    assert.equal(calls.flushes, 1, 'saves first');
    mock.timers.tick(1500);
    assert.equal(calls.installs, 1, 'then installs');
    assert.equal(au.tick(), false, 'only once');
  } finally {
    mock.timers.reset();
  }
});

test('it waits for the music to stop', () => {
  const { au, t, player } = rig({ playing: true });
  au.status({ state: 'ready', version: '2.0.2' });
  t.now += QUIET_FOR * 10;
  assert.equal(au.tick(), false, 'never mid-song');
  player.playing = false;
  assert.equal(au.tick(), true);
});

test('it waits while something else is running, or the iPod is locked', () => {
  const { au, t, state } = rig({ busy: true });
  au.status({ state: 'ready', version: '2.0.2' });
  t.now += QUIET_FOR * 10;
  assert.equal(au.tick(), false);
  state.busy = false;
  assert.equal(au.tick(), true);
});

test('turned off, it leaves the update for when you quit', () => {
  const { au, t, store } = rig({ autoUpdate: false });
  au.status({ state: 'ready', version: '2.0.2' });
  t.now += QUIET_FOR * 10;
  assert.equal(au.tick(), false);
  store.settings.autoUpdate = true;
  assert.equal(au.tick(), true);
});

test('nothing happens until an update is ready, and just after starting up', () => {
  const { au, t } = rig();
  t.now += QUIET_FOR * 10;
  for (const state of ['idle', 'checking', 'current', 'downloading', 'error', 'unsupported']) {
    au.status({ state });
    assert.equal(au.tick(), false, state);
  }
  // A fresh start counts as activity: don't restart the moment it opens.
  const fresh = rig();
  fresh.au.status({ state: 'ready', version: '2.0.2' });
  assert.equal(fresh.au.tick(), false);
});

test('"Updated to" shows once, after an update', () => {
  const alerts = [];
  const make = (lastVersion, version) => {
    const store = { env: { version }, settings: { lastVersion }, set: (k, v) => (store.settings[k] = v) };
    return { store, os: { alert: (m) => alerts.push(m) } };
  };
  const first = make(null, '2.0.2');
  assert.equal(announceUpdate(first), false, 'first run: nothing to announce');
  assert.equal(first.store.settings.lastVersion, '2.0.2');
  const updated = make('2.0.1', '2.0.2');
  assert.equal(announceUpdate(updated), true);
  assert.deepEqual(alerts, ['Updated to 2.0.2']);
  assert.equal(announceUpdate(updated), false, 'only once');
});

test('version comparison', () => {
  assert.ok(newer('2.0.10', '2.0.9'));
  assert.ok(newer('v2.1.0', '2.0.9'));
  assert.ok(newer('3', '2.9.9'));
  assert.ok(!newer('2.0.1', '2.0.1'));
  assert.ok(!newer('2.0.1', 'v2.0.2'));
  assert.ok(!newer('2.0.1-beta', '2.0.1'));
  assert.ok(!newer('', '2.0.1'));
});

test('update errors read as one short sentence', () => {
  // What electron-updater throws for a private repository's releases: the whole response.
  const raw = new Error('Cannot find latest.yml in the latest release artifacts (https://github.com/x/y/releases/download/v1/latest.yml): HttpError: 404 \n"method: GET url: ..."\nHeaders: { "content-security-policy": "default-src none" }');
  assert.match(explain(raw), /private/);
  assert.match(explain(Object.assign(new Error('HTTP 404 for api.github.com'), { status: 404 })), /private/);
  assert.match(explain(Object.assign(new Error('Timed out contacting api.github.com'), { status: 408 })), /internet/);
  assert.match(explain(new Error('net::ERR_INTERNET_DISCONNECTED')), /internet/);
  assert.match(explain(Object.assign(new Error('rate limited'), { statusCode: 403 })), /busy/);
  assert.equal(explain(new Error('Something odd\nwith details')), 'Something odd');
});
