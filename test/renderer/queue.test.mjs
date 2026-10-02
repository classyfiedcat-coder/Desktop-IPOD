import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayQueue, buildOrder } from '../../src/renderer/js/player/queue.js';

const T = (n, album = 'A', trackNo = n) => ({ id: `t${n}`, title: `Song ${n}`, album, albumArtist: 'X', trackNo, source: 'local' });
const list = [T(1), T(2), T(3), T(4, 'B', 1), T(5, 'B', 2)];
const reverse = (a) => a.slice().reverse();

test('in-order queue starts at the chosen song', () => {
  const q = new PlayQueue(reverse);
  assert.equal(q.load(list, 2).id, 't3');
  assert.deepEqual(q.info, { index: 3, total: 5 });
  assert.equal(q.peekNext().id, 't4');
  assert.equal(q.advance().track.id, 't4');
  assert.equal(q.back().id, 't3');
});

test('shuffle songs puts the chosen song first', () => {
  const { order, pos } = buildOrder(list, 3, 'songs', reverse);
  assert.equal(pos, 0);
  assert.equal(order[0], 3);
  assert.equal(order.length, 5);
  assert.equal(new Set(order).size, 5);
});

test('shuffle albums keeps album order and starts at the chosen track', () => {
  const { order } = buildOrder(list, 1, 'albums', reverse);
  assert.deepEqual(order.map((i) => list[i].id), ['t2', 't3', 't4', 't5', 't1']);
});

test('end of list: stop without repeat, loop with repeat all', () => {
  const q = new PlayQueue(reverse);
  q.load(list, 4);
  assert.equal(q.peekNext('off'), null);
  assert.equal(q.peekNext('all').id, 't1');
  const r = q.advance({ repeat: 'off', auto: true });
  assert.equal(r.stop, true);
  assert.equal(r.track.id, 't1');
  q.load(list, 4);
  const r2 = q.advance({ repeat: 'all', auto: true });
  assert.equal(r2.stop, false);
  assert.equal(r2.wrapped, true);
});

test('repeat one repeats only automatic advances', () => {
  const q = new PlayQueue(reverse);
  q.load(list, 0);
  assert.equal(q.peekNext('one').id, 't1');
  assert.equal(q.advance({ repeat: 'one', auto: true }).same, true);
  assert.equal(q.advance({ repeat: 'one', auto: false }).track.id, 't2');
});

test('Up Next plays before the list continues', () => {
  const q = new PlayQueue(reverse);
  q.load(list, 0);
  const extra1 = T(10, 'C');
  const extra2 = T(11, 'C');
  q.addToUpNext([extra1]);
  q.playNext([extra2]);
  assert.equal(q.peekNext().id, 't11');
  assert.equal(q.advance().track.id, 't11');
  assert.deepEqual(q.info, { index: 1, total: 5 });
  assert.equal(q.advance().track.id, 't10');
  assert.equal(q.advance().track.id, 't2');
  // Going back from an Up Next song returns to the list position.
  q.playNext([extra1]);
  q.advance();
  assert.equal(q.current.id, 't10');
  assert.equal(q.back().id, 't2');
});

test('changing shuffle keeps the current song', () => {
  const q = new PlayQueue(reverse);
  q.load(list, 2);
  q.setMode('songs');
  assert.equal(q.current.id, 't3');
  assert.equal(q.pos, 0);
  q.setMode('off');
  assert.equal(q.current.id, 't3');
  assert.equal(q.pos, 2);
});

test('serialize and restore', () => {
  const q = new PlayQueue(reverse);
  q.load(list, 1, 'songs');
  q.addToUpNext([list[4]]);
  const data = q.serialize();
  const byId = new Map(list.map((t) => [t.id, t]));
  const r = new PlayQueue(reverse);
  assert.equal(r.restore(data, (id) => byId.get(id)), true);
  assert.equal(r.current.id, 't2');
  assert.equal(r.upNext[0].id, 't5');
  assert.equal(r.restore({ ids: ['missing'] }, (id) => byId.get(id)), false);
});

test('upcoming lists Up Next then the rest', () => {
  const q = new PlayQueue(reverse);
  q.load(list, 2);
  q.addToUpNext([T(9)]);
  const u = q.upcoming();
  assert.deepEqual(u.upNext.map((t) => t.id), ['t9']);
  assert.deepEqual(u.rest.map((t) => t.id), ['t4', 't5']);
});
