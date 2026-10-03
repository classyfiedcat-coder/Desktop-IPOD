/** Contacts (.vcf) and calendars (.ics) parsers. */

/** Join folded lines (RFC 5545/6350: a line starting with space/tab continues the previous). */
export function unfold(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function unescape(v) {
  return String(v || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

/** "TEL;TYPE=CELL,VOICE:+1 555" → { name: 'TEL', params: { TYPE: 'CELL,VOICE' }, value: '+1 555' } */
function prop(line) {
  const i = line.indexOf(':');
  if (i < 0) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [rawName, ...rest] = head.split(';');
  const name = rawName.replace(/^item\d+\./i, '').toUpperCase();
  const params = {};
  for (const p of rest) {
    const [k, v] = p.split('=');
    if (v === undefined) params.TYPE = params.TYPE ? `${params.TYPE},${k}` : k;
    else params[k.toUpperCase()] = v.replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

const TYPE_NAMES = { CELL: 'mobile', MOBILE: 'mobile', HOME: 'home', WORK: 'work', MAIN: 'main', FAX: 'fax', IPHONE: 'iPhone', OTHER: 'other' };
const typeLabel = (t) => {
  const parts = String(t || '')
    .toUpperCase()
    .split(',')
    .map((x) => TYPE_NAMES[x.trim()])
    .filter(Boolean);
  return parts[0] || 'other';
};

export function parseVCards(text) {
  const out = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (/^BEGIN:VCARD/i.test(line)) {
      cur = { name: '', first: '', last: '', org: '', title: '', phones: [], emails: [], addresses: [], urls: [], birthday: null, note: '' };
      continue;
    }
    if (/^END:VCARD/i.test(line)) {
      if (cur) {
        if (!cur.name) cur.name = [cur.first, cur.last].filter(Boolean).join(' ') || cur.org || (cur.emails[0] && cur.emails[0].value) || (cur.phones[0] && cur.phones[0].value) || 'No Name';
        out.push(cur);
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = prop(line);
    if (!p) continue;
    const v = unescape(p.value);
    switch (p.name) {
      case 'FN':
        cur.name = v;
        break;
      case 'N': {
        const [last, first] = p.value.split(';').map(unescape);
        cur.last = last || '';
        cur.first = first || '';
        break;
      }
      case 'ORG':
        cur.org = unescape(p.value.split(';')[0]);
        break;
      case 'TITLE':
        cur.title = v;
        break;
      case 'TEL':
        cur.phones.push({ type: typeLabel(p.params.TYPE), value: v.replace(/^tel:/i, '') });
        break;
      case 'EMAIL':
        cur.emails.push({ type: typeLabel(p.params.TYPE), value: v });
        break;
      case 'ADR': {
        const parts = p.value.split(';').map(unescape);
        const [, , street, city, region, postal, country] = parts;
        const addr = [street, [city, region, postal].filter(Boolean).join(' '), country].filter(Boolean).join('\n');
        if (addr) cur.addresses.push({ type: typeLabel(p.params.TYPE), value: addr });
        break;
      }
      case 'URL':
        cur.urls.push(v);
        break;
      case 'BDAY': {
        const m = /^(\d{4}|--)-?(\d{2})-?(\d{2})/.exec(v);
        if (m) cur.birthday = { year: m[1] === '--' ? null : +m[1], month: +m[2], day: +m[3] };
        break;
      }
      case 'NOTE':
        cur.note = v;
        break;
    }
  }
  return out;
}

export function sortContacts(list) {
  const key = (c) => (c.last || c.name || '').toLowerCase() + ' ' + (c.first || '').toLowerCase();
  return list.slice().sort((a, b) => key(a).localeCompare(key(b)));
}

// ------------------------------------------------------------- calendars --

/** iCal date → { ms, allDay }. Floating and TZID times are treated as local. */
export function parseIcalDate(value, params = {}) {
  const v = String(value).trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (!hh || params.VALUE === 'DATE') return { ms: new Date(+y, +mo - 1, +d).getTime(), allDay: true };
  if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss || 0)), allDay: false };
  return { ms: new Date(+y, +mo - 1, +d, +hh, +mi, +(ss || 0)).getTime(), allDay: false };
}

function parseRRule(v) {
  const r = {};
  for (const part of String(v).split(';')) {
    const [k, val] = part.split('=');
    r[k.toUpperCase()] = val;
  }
  return r;
}

export function parseICS(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (/^BEGIN:VEVENT/i.test(line)) {
      cur = { summary: '', location: '', description: '', start: null, end: null, allDay: false, rrule: null, exdates: [] };
      continue;
    }
    if (/^END:VEVENT/i.test(line)) {
      if (cur && cur.start !== null) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = prop(line);
    if (!p) continue;
    switch (p.name) {
      case 'SUMMARY':
        cur.summary = unescape(p.value);
        break;
      case 'LOCATION':
        cur.location = unescape(p.value);
        break;
      case 'DESCRIPTION':
        cur.description = unescape(p.value).slice(0, 2000);
        break;
      case 'DTSTART': {
        const d = parseIcalDate(p.value, p.params);
        if (d) {
          cur.start = d.ms;
          cur.allDay = d.allDay;
        }
        break;
      }
      case 'DTEND': {
        const d = parseIcalDate(p.value, p.params);
        if (d) cur.end = d.ms;
        break;
      }
      case 'RRULE':
        cur.rrule = parseRRule(p.value);
        break;
      case 'EXDATE':
        for (const x of p.value.split(',')) {
          const d = parseIcalDate(x, p.params);
          if (d) cur.exdates.push(d.ms);
        }
        break;
    }
  }
  return events;
}

/** Expand events (including simple RRULEs) into occurrences between from and to (ms). */
export function occurrences(events, from, to, max = 2000) {
  const out = [];
  for (const ev of events) {
    const len = ev.end && ev.end > ev.start ? ev.end - ev.start : ev.allDay ? 86400000 : 3600000;
    const push = (start) => {
      if (start + len >= from && start <= to && !ev.exdates.includes(start)) out.push({ ...ev, start, end: start + len });
    };
    if (!ev.rrule) {
      push(ev.start);
      continue;
    }
    const r = ev.rrule;
    const freq = (r.FREQ || '').toUpperCase();
    const interval = Math.max(1, parseInt(r.INTERVAL || '1', 10));
    const count = r.COUNT ? parseInt(r.COUNT, 10) : Infinity;
    const until = r.UNTIL ? (parseIcalDate(r.UNTIL) || { ms: Infinity }).ms : Infinity;
    const d = new Date(ev.start);
    for (let n = 0; n < count && n < 5000; n++) {
      const ms = d.getTime();
      if (ms > until || ms > to) break;
      push(ms);
      if (freq === 'DAILY') d.setDate(d.getDate() + interval);
      else if (freq === 'WEEKLY') d.setDate(d.getDate() + 7 * interval);
      else if (freq === 'MONTHLY') d.setMonth(d.getMonth() + interval);
      else if (freq === 'YEARLY') d.setFullYear(d.getFullYear() + interval);
      else break;
    }
    if (out.length > max) break;
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Contacts' birthdays as yearly all-day events. */
export function birthdayEvents(contacts) {
  const now = new Date().getFullYear();
  return contacts
    .filter((c) => c.birthday)
    .map((c) => ({
      summary: `${c.name}’s Birthday${c.birthday.year ? ` (${now - c.birthday.year})` : ''}`,
      location: '',
      description: '',
      start: new Date(now - 1, c.birthday.month - 1, c.birthday.day).getTime(),
      end: null,
      allDay: true,
      rrule: { FREQ: 'YEARLY' },
      exdates: [],
      birthday: true,
    }));
}
