import test from 'node:test';
import assert from 'node:assert/strict';
import { Klondike, SPOTS } from '../../src/renderer/js/views/extras/klondike.js';
import { parseVCards, parseICS, occurrences, birthdayEvents, parseIcalDate, unfold } from '../../src/renderer/js/library/pim.js';
import { parseLrc, lineAt } from '../../src/renderer/js/library/lyrics.js';
import { hexToHsl, hslToHex, fmtTime, sortKey, byKey, indexLetter } from '../../src/renderer/js/util.js';
import { migrate, deepMerge } from '../../src/renderer/js/state.js';

// Deterministic shuffle for card games.
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

test('klondike deals a valid game', () => {
  const g = new Klondike({ rand: seeded() });
  g.tableau.forEach((col, i) => {
    assert.equal(col.length, i + 1);
    assert.equal(col[i].up, true);
    assert.ok(col.slice(0, i).every((c) => !c.up));
  });
  assert.equal(g.stock.length, 52 - 28);
  const all = [...g.stock, ...g.tableau.flat()];
  assert.equal(new Set(all.map((c) => `${c.s}-${c.r}`)).size, 52);
});

test('klondike stacking rules', () => {
  const g = new Klondike({ rand: seeded() });
  g.tableau = [[{ s: 0, r: 8, up: true }], [{ s: 1, r: 7, up: true }], [{ s: 0, r: 7, up: true }], [], [], [], []];
  const t = (i) => SPOTS.find((s) => s.type === 'tableau' && s.i === i);
  assert.equal(g.move(t(2), t(0)), false, 'black on black is not allowed');
  assert.equal(g.move(t(1), t(0)), true, 'red 7 on black 8');
  assert.equal(g.tableau[0].length, 2);
  // Only a king goes to an empty column.
  assert.equal(g.move(t(2), t(3)), false);
  g.tableau[2] = [{ s: 2, r: 13, up: true }];
  assert.equal(g.move(t(2), t(3)), true);
});

test('klondike foundations, auto-play and drawing', () => {
  const g = new Klondike({ rand: seeded() });
  g.tableau = [[{ s: 3, r: 1, up: true }], [{ s: 3, r: 2, up: true }], [], [], [], [], []];
  g.waste = [];
  g.stock = [{ s: 1, r: 5, up: false }];
  assert.ok(g.autoStep());
  assert.ok(g.autoStep());
  assert.equal(g.foundations.find((f) => f.length).length, 2);
  assert.equal(g.autoStep(), null);
  assert.equal(g.draw(), true);
  assert.equal(g.waste.length, 1);
  assert.equal(g.waste[0].up, true);
  assert.equal(g.draw(), true, 'recycles the waste');
  assert.equal(g.stock.length, 1);
  assert.equal(g.passes, 1);
});

test('moving the bottom card of a column turns the next one over', () => {
  const g = new Klondike({ rand: seeded() });
  g.tableau = [[{ s: 0, r: 3, up: false }, { s: 1, r: 9, up: true }], [{ s: 0, r: 10, up: true }], [], [], [], [], []];
  const t = (i) => SPOTS.find((s) => s.type === 'tableau' && s.i === i);
  assert.equal(g.move(t(0), t(1)), true);
  assert.equal(g.tableau[0][0].up, true);
});

test('vCard parsing', () => {
  const vcf = `BEGIN:VCARD\r\nVERSION:3.0\r\nN:Appleseed;Johnny;;;\r\nFN:Johnny Appleseed\r\nORG:Orchard Inc.;\r\nTEL;TYPE=CELL:+1 555 0100\r\nEMAIL;TYPE=INTERNET,HOME:johnny@example.com\r\nADR;TYPE=HOME:;;1 Infinite\r\n  Loop;Cupertino;CA;95014;USA\r\nBDAY:1980-04-01\r\nNOTE:Likes\\, apples\r\nEND:VCARD\r\nBEGIN:VCARD\r\nN:;;;;\r\nTEL:123\r\nEND:VCARD\r\n`;
  const [c, d] = parseVCards(vcf);
  assert.equal(c.name, 'Johnny Appleseed');
  assert.equal(c.last, 'Appleseed');
  assert.equal(c.org, 'Orchard Inc.');
  assert.deepEqual(c.phones, [{ type: 'mobile', value: '+1 555 0100' }]);
  assert.equal(c.emails[0].type, 'home');
  assert.equal(c.addresses[0].value, '1 Infinite Loop\nCupertino CA 95014\nUSA');
  assert.deepEqual(c.birthday, { year: 1980, month: 4, day: 1 });
  assert.equal(c.note, 'Likes, apples');
  assert.equal(d.name, '123');
});

test('iCalendar parsing and repeats', () => {
  const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Standup\nDTSTART:20260105T090000\nDTEND:20260105T091500\nRRULE:FREQ=WEEKLY;COUNT=3\nEXDATE:20260112T090000\nLOCATION:Room 1\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Holiday\nDTSTART;VALUE=DATE:20260101\nEND:VEVENT\nEND:VCALENDAR\n`;
  const evs = parseICS(ics);
  assert.equal(evs.length, 2);
  assert.equal(evs[0].location, 'Room 1');
  const occ = occurrences(evs, new Date(2026, 0, 1).getTime(), new Date(2026, 1, 1).getTime());
  assert.deepEqual(
    occ.map((o) => [o.summary, new Date(o.start).getDate()]),
    [
      ['Holiday', 1],
      ['Standup', 5],
      ['Standup', 19],
    ]
  );
  assert.equal(occ[1].end - occ[1].start, 15 * 60000);
  assert.equal(parseIcalDate('20260101T120000Z').ms, Date.UTC(2026, 0, 1, 12));
  assert.deepEqual(unfold('A:1\r\n 2\r\nB:3'), ['A:12', 'B:3']);
});

test('birthdays repeat every year', () => {
  const ev = birthdayEvents([{ name: 'Jo', birthday: { year: 2000, month: 6, day: 15 } }]);
  const y = new Date().getFullYear();
  const occ = occurrences(ev, new Date(y, 0, 1).getTime(), new Date(y + 1, 11, 31).getTime());
  assert.equal(occ.length, 2);
  assert.equal(new Date(occ[0].start).getMonth(), 5);
});

test('synced lyrics', () => {
  const lines = parseLrc('[ti:x]\n[00:01.00]One\n[00:03.50][00:10.00]Two\n[00:05]Three');
  assert.deepEqual(
    lines.map((l) => [l.t, l.text]),
    [
      [1, 'One'],
      [3.5, 'Two'],
      [5, 'Three'],
      [10, 'Two'],
    ]
  );
  assert.equal(lineAt(lines, 0.5), -1);
  assert.equal(lineAt(lines, 4), 1);
  assert.equal(lineAt(lines, 99), 3);
  assert.equal(parseLrc('just words'), null);
});

test('colour conversions round-trip', () => {
  for (const hex of ['#2f6fb3', '#ee6fa8', '#000000', '#ffffff', '#c8102e']) {
    const back = hslToHex(hexToHsl(hex));
    const diff = [1, 3, 5].map((i) => Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16)));
    assert.ok(Math.max(...diff) <= 3, `${hex} → ${back}`);
  }
});

test('formatting and iPod-style sorting', () => {
  assert.equal(fmtTime(65), '1:05');
  assert.equal(fmtTime(3725), '1:02:05');
  assert.equal(fmtTime(5, { negative: true }), '-0:05');
  assert.equal(sortKey('The Beatles'), 'beatles');
  assert.deepEqual(['The Zombies', '2Pac', 'Abba', 'the beatles'].sort(byKey), ['Abba', 'the beatles', 'The Zombies', '2Pac']);
  assert.equal(indexLetter('The Who'), 'W');
  assert.equal(indexLetter('99 Problems'), '#');
});

test('settings migration from 1.x', () => {
  const s = migrate({ color: 'silver', model: 'classic', crossfade: false });
  assert.equal(s.color, 'white');
  assert.equal(s.model, 'video');
  assert.equal('crossfade' in s, false);
  assert.equal(s.schema, 2);
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, d: [1] }, { a: { b: 5 }, d: [2, 3] }), { a: { b: 5, c: 2 }, d: [2, 3] });
});
