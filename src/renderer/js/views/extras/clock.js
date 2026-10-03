/** World clocks with the 5th-gen analog clock face (white by day, black by night). */

import { View } from '../view.js';
import { ListView } from '../list.js';
import { h, fmtClock } from '../../util.js';

export const CITIES = [
  ['local', 'Local Time'],
  ['Pacific/Honolulu', 'Honolulu'],
  ['America/Anchorage', 'Anchorage'],
  ['America/Los_Angeles', 'Cupertino'],
  ['America/Denver', 'Denver'],
  ['America/Chicago', 'Chicago'],
  ['America/New_York', 'New York'],
  ['America/Toronto', 'Toronto'],
  ['America/Sao_Paulo', 'São Paulo'],
  ['Europe/London', 'London'],
  ['Europe/Dublin', 'Dublin'],
  ['Europe/Paris', 'Paris'],
  ['Europe/Berlin', 'Berlin'],
  ['Europe/Madrid', 'Madrid'],
  ['Europe/Rome', 'Rome'],
  ['Europe/Stockholm', 'Stockholm'],
  ['Europe/Athens', 'Athens'],
  ['Europe/Istanbul', 'Istanbul'],
  ['Europe/Moscow', 'Moscow'],
  ['Africa/Cairo', 'Cairo'],
  ['Africa/Johannesburg', 'Johannesburg'],
  ['Africa/Lagos', 'Lagos'],
  ['Asia/Dubai', 'Dubai'],
  ['Asia/Kolkata', 'Mumbai'],
  ['Asia/Bangkok', 'Bangkok'],
  ['Asia/Singapore', 'Singapore'],
  ['Asia/Hong_Kong', 'Hong Kong'],
  ['Asia/Shanghai', 'Shanghai'],
  ['Asia/Seoul', 'Seoul'],
  ['Asia/Tokyo', 'Tokyo'],
  ['Australia/Perth', 'Perth'],
  ['Australia/Sydney', 'Sydney'],
  ['Pacific/Auckland', 'Auckland'],
];

export const cityName = (tz) => (CITIES.find(([z]) => z === tz) || [tz, tz.split('/').pop().replace(/_/g, ' ')])[1];

/** Date in another time zone, expressed as a local Date with the same wall-clock time. */
export function zonedNow(tz) {
  const now = new Date();
  if (!tz || tz === 'local') return now;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (t) => +parts.find((p) => p.type === t).value;
    return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'), now.getMilliseconds());
  } catch {
    return now;
  }
}

export function clocksMenu(app) {
  const { store } = app;
  const use24 = () => store.settings.timeFormat === '24';
  const view = new ListView({
    title: 'Clocks',
    refreshOnEnter: true,
    items: () => [
      ...store.settings.worldClocks.map((tz, i) => ({
        label: cityName(tz),
        value: () => fmtClock(zonedNow(tz), use24()),
        view: () => new ClockFace(app, i),
      })),
      {
        label: 'Add Clock',
        view: () => cityPicker(app, (tz) => store.set('worldClocks', [...store.settings.worldClocks, tz])),
      },
    ],
  });
  const tick = setInterval(() => view.mounted && view.paint(), 10000);
  const destroy = view.destroy.bind(view);
  view.destroy = () => {
    clearInterval(tick);
    destroy();
  };
  return view;
}

function cityPicker(app, onPick) {
  return new ListView({
    title: 'Choose City',
    index: true,
    items: CITIES.map(([tz, name]) => ({
      label: name,
      sortName: name,
      value: () => fmtClock(zonedNow(tz), app.store.settings.timeFormat === '24'),
      action: () => {
        onPick(tz);
        app.os.pop();
      },
    })),
  });
}

export class ClockFace extends View {
  constructor(app, index) {
    super({ title: cityName(app.store.settings.worldClocks[index] || 'local') });
    this.app = app;
    this.index = index;
  }
  get className() {
    return 'clock-face-view';
  }
  get tz() {
    return this.app.store.settings.worldClocks[this.index] || 'local';
  }
  render() {
    const ticks = h('div', { class: 'clk-ticks' });
    for (let i = 0; i < 12; i++) ticks.append(h('i', { style: { transform: `rotate(${i * 30}deg)` } }));
    this.hh = h('div', { class: 'clk-hand clk-h' });
    this.mh = h('div', { class: 'clk-hand clk-m' });
    this.sh = h('div', { class: 'clk-hand clk-s' });
    this.face = h('div', { class: 'clk-face' }, ticks, this.hh, this.mh, this.sh, h('div', { class: 'clk-pin' }));
    this.city = h('div', { class: 'clk-city' });
    this.time = h('div', { class: 'clk-time' });
    this.date = h('div', { class: 'clk-date' });
    this.el.replaceChildren(this.face, h('div', { class: 'clk-info' }, this.city, this.time, this.date), h('div', { class: 'clk-hint', text: 'Select for options' }));
    this.loop(() => this.paint());
    this.paint();
  }
  paint() {
    const d = zonedNow(this.tz);
    const s = d.getSeconds() + d.getMilliseconds() / 1000;
    const m = d.getMinutes() + s / 60;
    const hr = (d.getHours() % 12) + m / 60;
    this.hh.style.transform = `rotate(${hr * 30}deg)`;
    this.mh.style.transform = `rotate(${m * 6}deg)`;
    this.sh.style.transform = `rotate(${Math.floor(s) * 6}deg)`;
    const night = d.getHours() < 6 || d.getHours() >= 18;
    this.el.classList.toggle('night', night);
    const label = cityName(this.tz);
    if (this.city.textContent !== label) this.city.textContent = label;
    this.time.textContent = fmtClock(d, this.app.store.settings.timeFormat === '24');
    this.date.textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  onScroll(dir) {
    const n = this.app.store.settings.worldClocks.length;
    const next = Math.max(0, Math.min(n - 1, this.index + dir));
    if (next === this.index) return false;
    this.index = next;
    this.setTitle(cityName(this.tz));
    this.paint();
    return true;
  }
  onSelect() {
    const app = this.app;
    const clocks = app.store.settings.worldClocks;
    this.os.push(
      new ListView({
        title: cityName(this.tz),
        items: [
          {
            label: 'Change City',
            view: () =>
              cityPicker(app, (tz) => {
                const list = clocks.slice();
                list[this.index] = tz;
                app.store.set('worldClocks', list);
                this.setTitle(cityName(tz));
                setTimeout(() => app.os.pop(), 0);
              }),
          },
          { label: 'Alarms', view: () => app.extras.alarms() },
          {
            label: 'Delete This Clock',
            disabled: clocks.length <= 1,
            action: () => {
              const list = clocks.filter((_, i) => i !== this.index);
              app.store.set('worldClocks', list);
              this.index = Math.max(0, this.index - 1);
              app.os.pop();
              app.os.pop();
            },
          },
        ],
      })
    );
  }
}
