/** Stopwatch, Screen Lock, Calendar and Notes. */

import { View } from '../view.js';
import { ListView } from '../list.js';
import { TextView } from '../common.js';
import { h, svg, ICONS, fmtTime, clamp } from '../../util.js';

// ------------------------------------------------------------- stopwatch --

const fmtWatch = (ms) => {
  const cs = Math.floor((ms % 1000) / 10);
  return `${fmtTime(ms / 1000).padStart(5, '0')}.${String(cs).padStart(2, '0')}`;
};

/** Survives leaving the screen, like the real stopwatch. */
const watch = { running: false, start: 0, acc: 0, laps: [] };
const elapsed = () => watch.acc + (watch.running ? performance.now() - watch.start : 0);

export class StopwatchView extends View {
  constructor() {
    super({ title: 'Stopwatch' });
    this.scroll = 0;
  }
  get className() {
    return 'stopwatch-view';
  }
  get keepAwake() {
    return watch.running;
  }
  render() {
    this.big = h('div', { class: 'sw-time' });
    this.lap = h('div', { class: 'sw-lap' });
    this.laps = h('div', { class: 'sw-laps' });
    this.hint = h('div', { class: 'sw-hint' });
    this.el.replaceChildren(h('div', { class: 'sw-label', text: 'Current' }), this.big, this.lap, this.laps, this.hint);
    this.loop(() => this.paint());
    this.paintLaps();
  }
  paint() {
    const e = elapsed();
    this.big.textContent = fmtWatch(e);
    const last = watch.laps.length ? watch.laps[watch.laps.length - 1].at : 0;
    this.lap.textContent = watch.laps.length || watch.running ? `Lap ${watch.laps.length + 1}   ${fmtWatch(e - last)}` : '';
    this.hint.textContent = watch.running ? 'Select: Pause · ⏭ Lap' : e ? 'Select: Resume · Hold Select: Reset' : 'Select: Start';
  }
  paintLaps() {
    const rows = watch.laps
      .map((l, i) => ({ ...l, n: i + 1 }))
      .reverse()
      .slice(this.scroll, this.scroll + 4);
    this.laps.replaceChildren(...rows.map((l) => h('div', { class: 'sw-row' }, h('span', { text: `Lap ${l.n}` }), h('span', { text: fmtWatch(l.split) }))));
  }
  onSelect() {
    if (watch.running) {
      watch.acc += performance.now() - watch.start;
      watch.running = false;
    } else {
      watch.start = performance.now();
      watch.running = true;
    }
  }
  onPlay() {
    this.onSelect();
    return true;
  }
  onNext() {
    if (!watch.running) return true;
    const at = elapsed();
    const prev = watch.laps.length ? watch.laps[watch.laps.length - 1].at : 0;
    watch.laps.push({ at, split: at - prev });
    this.scroll = 0;
    this.paintLaps();
    return true;
  }
  onPrev() {
    return true;
  }
  onSelectHold() {
    if (watch.running) return;
    watch.acc = 0;
    watch.laps = [];
    this.paintLaps();
  }
  onScroll(dir) {
    const max = Math.max(0, watch.laps.length - 4);
    const next = clamp(this.scroll + dir, 0, max);
    if (next === this.scroll) return false;
    this.scroll = next;
    this.paintLaps();
    return true;
  }
}

// ----------------------------------------------------------- screen lock --

class ComboView extends View {
  constructor(app, { title, prompt, onDone }) {
    super({ title });
    this.app = app;
    this.prompt = prompt;
    this.onDone = onDone;
    this.digits = [0, 0, 0, 0];
    this.pos = 0;
  }
  get className() {
    return 'combo-view';
  }
  render() {
    this.boxes = this.digits.map(() => h('div', { class: 'cb-digit' }));
    this.msg = h('div', { class: 'cb-msg', text: this.prompt });
    this.el.replaceChildren(h('div', { class: 'cb-lock' }, svg(ICONS.lock, 'cb-icon')), h('div', { class: 'cb-row' }, ...this.boxes), this.msg);
    this.paint();
  }
  paint() {
    this.boxes.forEach((b, i) => {
      b.textContent = i <= this.pos ? String(this.digits[i]) : '';
      b.classList.toggle('on', i === this.pos);
      b.classList.toggle('done', i < this.pos);
    });
  }
  reset(msg) {
    this.digits = [0, 0, 0, 0];
    this.pos = 0;
    if (msg) {
      this.msg.textContent = msg;
      this.el.classList.remove('shake');
      void this.el.offsetWidth;
      this.el.classList.add('shake');
    }
    this.paint();
  }
  onScroll(dir) {
    this.digits[this.pos] = (this.digits[this.pos] + dir + 10) % 10;
    this.paint();
    return true;
  }
  onSelect() {
    if (this.pos < 3) {
      this.pos++;
      this.paint();
      return;
    }
    this.onDone(this.digits.join(''), this);
  }
}

class LockedView extends ComboView {
  constructor(app) {
    super(app, {
      title: 'Locked',
      prompt: 'Enter combination',
      onDone: (code, view) => {
        if (code === app.store.settings.lockCode) {
          app.locked = false;
          app.os.pop();
          app.os.alert('Unlocked', 900);
        } else view.reset('Wrong combination');
      },
    });
  }
  onMenu() {
    return true;
  }
  onMenuHold() {
    return true;
  }
}

export function screenLockMenu(app) {
  const { store } = app;
  const setCode = () =>
    new ComboView(app, {
      title: 'Set Combination',
      prompt: 'Choose 4 digits',
      onDone: (code) => {
        store.set('lockCode', code);
        app.os.pop();
        app.os.alert('Combination set', 1000);
      },
    });
  return new ListView({
    title: 'Screen Lock',
    refreshOnEnter: true,
    items: () =>
      store.settings.lockCode
        ? [
            {
              label: 'Lock',
              arrow: false,
              action: () => {
                app.locked = true;
                app.os.goto([new LockedView(app)]);
              },
            },
            { label: 'Change Combination', view: setCode },
            { label: 'Turn Off Screen Lock', arrow: false, action: () => store.set('lockCode', null) },
          ]
        : [{ label: 'Set Combination', view: setCode }],
  });
}

// --------------------------------------------------------------- calendar --

export class CalendarView extends View {
  /** @param {{ events?: () => Array, onDay?: (date: Date, events: Array) => void }} [o] */
  constructor(o = {}) {
    super({ title: 'Calendar' });
    this.o = o;
    const t = new Date();
    this.date = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }
  get className() {
    return 'calendar-view';
  }
  render() {
    this.head = h('div', { class: 'cal-head' });
    this.grid = h('div', { class: 'cal-grid' });
    this.foot = h('div', { class: 'cal-foot' });
    const names = h('div', { class: 'cal-names' }, ...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => h('span', { text: d })));
    this.el.replaceChildren(this.head, names, this.grid, this.foot);
    this.paint();
  }
  eventsOn(y, m, d) {
    const from = new Date(y, m, d).getTime();
    return (this._month || []).filter((e) => e.start < from + 86400000 && e.end > from);
  }
  paint() {
    const d = this.date;
    this.setTitle(d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (this._monthKey !== key) {
      this._monthKey = key;
      this._month = this.o.events ? this.o.events(first.getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()) : [];
    }
    const today = new Date();
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(h('span', { class: 'cal-day blank' }));
    for (let n = 1; n <= days; n++) {
      const isToday = today.getFullYear() === d.getFullYear() && today.getMonth() === d.getMonth() && today.getDate() === n;
      const has = this.eventsOn(d.getFullYear(), d.getMonth(), n).length;
      cells.push(h('span', { class: `cal-day ${n === d.getDate() ? 'sel' : ''} ${isToday ? 'today' : ''} ${has ? 'has-ev' : ''}`, text: String(n) }));
    }
    this.grid.replaceChildren(...cells);
    const evs = this.eventsOn(d.getFullYear(), d.getMonth(), d.getDate());
    this.foot.textContent = evs.length
      ? `${evs[0].summary || 'Event'}${evs.length > 1 ? ` +${evs.length - 1} more` : ''}`
      : d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    this.foot.classList.toggle('has-ev', !!evs.length);
  }
  onScroll(dir) {
    this.date = new Date(this.date.getFullYear(), this.date.getMonth(), this.date.getDate() + dir);
    this.paint();
    return true;
  }
  onNext() {
    this.date = new Date(this.date.getFullYear(), this.date.getMonth() + 1, 1);
    this.paint();
    return true;
  }
  onPrev() {
    this.date = new Date(this.date.getFullYear(), this.date.getMonth() - 1, 1);
    this.paint();
    return true;
  }
  onPlay() {
    const t = new Date();
    this.date = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    this.paint();
    return true;
  }
  onSelect() {
    const d = this.date;
    const evs = this.eventsOn(d.getFullYear(), d.getMonth(), d.getDate());
    if (evs.length && this.o.onDay) this.o.onDay(new Date(d), evs);
    else this.onPlay();
  }
}

// ----------------------------------------------------------------- notes --

const BUILT_IN_NOTES = [
  {
    title: 'Welcome',
    body: `Welcome to your iPod.

Spin the click wheel by dragging around it with the mouse, or use your mouse's scroll wheel anywhere on the iPod.

Click MENU to go back, the centre button to select, and ⏮ ⏭ ▶❚❚ to control music. Hold ▶❚❚ to turn the iPod off. Hold MENU to jump to the main menu.

Drag the iPod by its body to move it anywhere on your desktop. Right-click it for more options.`,
  },
  {
    title: 'Keyboard Shortcuts',
    body: `↑ ↓  Scroll (like the wheel)
Enter  Select
Esc or Backspace  Menu
Space  Play / Pause
← →  Previous / Next (hold to rewind or fast-forward)
H  Hold switch
Ctrl+Q  Quit`,
  },
  {
    title: 'Spotify',
    body: `Go to Settings › Spotify › Set Up Spotify to connect your account.

With Spotify Premium you can play your playlists, liked songs, albums and podcasts. The music plays through the Spotify app on this PC (or any Spotify Connect device) and the iPod controls it.

Hold the centre button on a Spotify song to add it to your Liked Songs.`,
  },
];

export function notesMenu(app) {
  return new ListView({
    title: 'Notes',
    load: async () => {
      let notes = [];
      const folder = app.store.settings.notesFolder;
      if (folder) {
        try {
          notes = (await window.ipod.media.texts(folder, 'notes')).map((n) => ({ title: n.name, body: n.text }));
        } catch {
          notes = [];
        }
      }
      return [...BUILT_IN_NOTES, ...notes].map((n) => ({
        label: n.title,
        view: () => new TextView({ title: n.title, body: n.body }),
      }));
    },
  });
}
