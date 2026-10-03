/** Extras › Contacts and Calendars (from .vcf and .ics files). */

import { ListView } from '../list.js';
import { StaticList } from '../common.js';
import { CalendarView } from './tools.js';
import { parseVCards, sortContacts, parseICS, occurrences, birthdayEvents } from '../../library/pim.js';
import { wrap } from '../options.js';
import { fmtClock } from '../../util.js';

export function createPim(app) {
  let contacts = null;
  let events = null;

  const loadContacts = async () => {
    if (contacts) return contacts;
    const folder = app.store.settings.contactsFolder;
    if (!folder) return (contacts = []);
    const files = await window.ipod.media.texts(folder, 'contacts');
    contacts = sortContacts(files.flatMap((f) => parseVCards(f.text)));
    return contacts;
  };
  const loadEvents = async () => {
    if (events) return events;
    const folder = app.store.settings.calendarsFolder;
    const files = folder ? await window.ipod.media.texts(folder, 'calendars') : [];
    events = files.flatMap((f) => parseICS(f.text)).concat(birthdayEvents(await loadContacts()));
    return events;
  };
  app.store.on('change:contactsFolder', () => {
    contacts = null;
    events = null;
  });
  app.store.on('change:calendarsFolder', () => (events = null));

  const contactView = (c) => {
    const rows = [{ label: c.name, center: true }];
    if (c.org || c.title) rows.push({ label: [c.title, c.org].filter(Boolean).join(', '), disabled: true });
    for (const p of c.phones) rows.push({ label: p.type, value: p.value });
    for (const e of c.emails) rows.push({ label: e.type, value: e.value });
    for (const a of c.addresses) a.value.split('\n').forEach((line, i) => rows.push({ label: i ? '' : a.type, value: line }));
    if (c.birthday) rows.push({ label: 'birthday', value: new Date(c.birthday.year || 2000, c.birthday.month - 1, c.birthday.day).toLocaleDateString(undefined, { month: 'long', day: 'numeric', ...(c.birthday.year ? { year: 'numeric' } : {}) }) });
    for (const u of c.urls) rows.push({ label: 'web', value: u.replace(/^https?:\/\//, '') });
    if (c.note) for (const line of wrap(c.note, 34)) rows.push({ label: line, disabled: true });
    return new StaticList({ title: 'Contacts', items: rows });
  };

  const eventView = (ev) => {
    const use24 = app.store.settings.timeFormat === '24';
    const when = ev.allDay
      ? new Date(ev.start).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
      : `${new Date(ev.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${fmtClock(new Date(ev.start), use24)}`;
    const rows = [{ label: ev.summary || 'Event', center: true }, { label: 'When', value: when }];
    if (!ev.allDay && ev.end) rows.push({ label: 'Ends', value: fmtClock(new Date(ev.end), use24) });
    if (ev.location) rows.push({ label: 'Where', value: ev.location });
    if (ev.description) for (const line of wrap(ev.description, 34)) rows.push({ label: line, disabled: true });
    return new StaticList({ title: 'Event', items: rows });
  };

  const eventItems = (list) => {
    const use24 = app.store.settings.timeFormat === '24';
    const out = [];
    let day = '';
    for (const ev of list) {
      const d = new Date(ev.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (d !== day) {
        out.push({ label: d, header: true });
        day = d;
      }
      out.push({ label: ev.summary || 'Event', value: ev.allDay ? '' : fmtClock(new Date(ev.start), use24), view: () => eventView(ev) });
    }
    return out;
  };

  return {
    contacts() {
      return new ListView({
        title: 'Contacts',
        index: true,
        empty: 'No contacts. Add a .vcf folder in Settings › Music Library.',
        load: async () => (await loadContacts()).map((c) => ({ label: c.name, sortName: c.last || c.name, view: () => contactView(c) })),
      });
    },
    calendars() {
      return new ListView({
        title: 'Calendars',
        items: [
          {
            label: 'Calendar',
            view: () => {
              const view = new CalendarView({
                events: (from, to) => (events ? occurrences(events, from, to) : []),
                onDay: (date, evs) => app.os.push(new ListView({ title: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), items: eventItems(evs) })),
              });
              loadEvents().then(() => {
                view._monthKey = null;
                if (view.mounted) view.paint();
              });
              return view;
            },
          },
          {
            label: 'Upcoming Events',
            view: () =>
              new ListView({
                title: 'Upcoming',
                empty: 'No upcoming events. Add an .ics folder in Settings › Music Library.',
                load: async () => {
                  const now = new Date();
                  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                  return eventItems(occurrences(await loadEvents(), from, from + 60 * 86400000).slice(0, 150));
                },
              }),
          },
          {
            label: 'Birthdays',
            view: () =>
              new ListView({
                title: 'Birthdays',
                empty: 'No birthdays in your contacts.',
                load: async () => {
                  const now = Date.now();
                  return eventItems(occurrences(birthdayEvents(await loadContacts()), now - 86400000, now + 366 * 86400000));
                },
              }),
          },
        ],
      });
    },
  };
}
