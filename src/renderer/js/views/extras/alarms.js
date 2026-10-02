/** Alarm clocks, the sleep timer and the wheel-driven time picker. */

import { View } from '../view.js';
import { ListView } from '../list.js';
import { h, fmtClock } from '../../util.js';
import { cycleItem } from '../common.js';
import { alarmTone } from '../../sound.js';

const REPEAT = [
  ['once', 'Once'],
  ['daily', 'Every Day'],
  ['weekdays', 'Weekdays'],
  ['weekends', 'Weekends'],
];
const SOUNDS = [
  ['chime', 'Chime'],
  ['music', 'Shuffle Songs'],
];

const timeLabel = (a, use24) => {
  const d = new Date();
  d.setHours(a.hour, a.minute, 0, 0);
  return fmtClock(d, use24);
};

export function alarmsMenu(app) {
  const { store } = app;
  const use24 = () => store.settings.timeFormat === '24';
  return new ListView({
    title: 'Alarms',
    refreshOnEnter: true,
    items: () => [
      {
        label: 'Create Alarm',
        view: () => {
          const now = new Date();
          const alarm = { id: Date.now().toString(36), on: true, hour: (now.getHours() + 1) % 24, minute: 0, repeat: 'once', sound: 'chime', label: 'Alarm' };
          store.set('alarms', [...store.settings.alarms, alarm]);
          return alarmEditor(app, alarm.id);
        },
      },
      ...store.settings.alarms.map((a) => ({
        label: `${a.label || 'Alarm'}  ${timeLabel(a, use24())}`,
        value: () => (a.on ? 'On' : 'Off'),
        view: () => alarmEditor(app, a.id),
      })),
      {
        label: 'Sleep Timer',
        value: () => (app.sleepTimer.remaining() ? `${Math.ceil(app.sleepTimer.remaining() / 60000)} min` : 'Off'),
        view: () =>
          new ListView({
            title: 'Sleep Timer',
            items: [0, 15, 30, 60, 90, 120].map((m) => ({
              label: m ? `${m} Minutes` : 'Off',
              action: () => {
                app.sleepTimer.set(m);
                app.os.alert(m ? `iPod will sleep in ${m} minutes` : 'Sleep timer off');
                app.os.pop();
              },
            })),
          }),
      },
    ],
  });
}

function alarmEditor(app, id) {
  const { store } = app;
  const get = () => store.settings.alarms.find((a) => a.id === id);
  const update = (patch) => store.set('alarms', store.settings.alarms.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const proxy = {
    get settings() {
      return get() || {};
    },
    set: (k, v) => update({ [k]: v }),
  };
  return new ListView({
    title: 'Alarm',
    refreshOnEnter: true,
    items: () => {
      const a = get();
      if (!a) return [];
      return [
        cycleItem(proxy, 'Alarm', 'on', [
          [true, 'On'],
          [false, 'Off'],
        ]),
        {
          label: 'Time',
          value: () => timeLabel(get(), store.settings.timeFormat === '24'),
          view: () =>
            new TimePicker(app, {
              hour: a.hour,
              minute: a.minute,
              onDone: (hour, minute) => update({ hour, minute, on: true }),
            }),
        },
        cycleItem(proxy, 'Repeat', 'repeat', REPEAT),
        cycleItem(proxy, 'Alert', 'sound', SOUNDS),
        {
          label: 'Delete Alarm',
          arrow: false,
          action: () => {
            store.set('alarms', store.settings.alarms.filter((x) => x.id !== id));
            app.os.pop();
          },
        },
      ];
    },
  });
}

/** Hours, minutes (and AM/PM) chosen with the wheel; Select moves to the next field. */
export class TimePicker extends View {
  constructor(app, { hour, minute, onDone, title = 'Time' }) {
    super({ title });
    this.app = app;
    this.hour = hour;
    this.minute = minute;
    this.onDone = onDone;
    this.field = 0;
  }
  get className() {
    return 'time-picker';
  }
  get use24() {
    return this.app.store.settings.timeFormat === '24';
  }
  render() {
    this.hEl = h('span', { class: 'tp-field' });
    this.mEl = h('span', { class: 'tp-field' });
    this.aEl = h('span', { class: 'tp-field tp-ampm' });
    this.el.replaceChildren(
      h('div', { class: 'tp-row' }, this.hEl, h('span', { class: 'tp-colon', text: ':' }), this.mEl, this.use24 ? null : this.aEl),
      h('div', { class: 'tp-hint', text: 'Turn to change · Select for next' })
    );
    this.paint();
  }
  paint() {
    const h12 = this.hour % 12 || 12;
    this.hEl.textContent = this.use24 ? String(this.hour).padStart(2, '0') : String(h12);
    this.mEl.textContent = String(this.minute).padStart(2, '0');
    this.aEl.textContent = this.hour >= 12 ? 'PM' : 'AM';
    [this.hEl, this.mEl, this.aEl].forEach((el, i) => el.classList.toggle('on', i === this.field));
  }
  onScroll(dir) {
    if (this.field === 0) this.hour = (this.hour + dir + 24) % 24;
    else if (this.field === 1) this.minute = (this.minute + dir + 60) % 60;
    else this.hour = (this.hour + 12) % 24;
    this.paint();
    return true;
  }
  onSelect() {
    const last = this.use24 ? 1 : 2;
    if (this.field < last) {
      this.field++;
      this.paint();
      return;
    }
    this.onDone(this.hour, this.minute);
    this.os.pop();
  }
}

/** Full-screen ringing alarm. */
export class AlarmRing extends View {
  constructor(app, alarm) {
    super({ title: 'Alarm' });
    this.app = app;
    this.alarm = alarm;
  }
  get className() {
    return 'alarm-ring';
  }
  get keepAwake() {
    return true;
  }
  render() {
    this.list = new ListView({
      title: 'Alarm',
      rows: 2,
      items: [
        { label: 'Dismiss', arrow: false, action: () => this.dismiss() },
        { label: 'Snooze (9 min)', arrow: false, action: () => this.snooze() },
      ],
    });
    const listEl = h('div', { class: 'ar-list' });
    this.el.replaceChildren(
      h('div', { class: 'ar-bell', text: '⏰' }),
      h('div', { class: 'ar-time', text: fmtClock(new Date(), this.app.store.settings.timeFormat === '24') }),
      h('div', { class: 'ar-label', text: this.alarm.label || 'Alarm' }),
      listEl
    );
    this.list.mount(listEl, this.os);
    if (!this.started) {
      this.started = true;
      if (this.alarm.sound === 'music' && this.app.library.music.length) {
        const music = this.app.library.music;
        this.app.player.playTracks(music, Math.floor(Math.random() * music.length), { shuffle: 'songs' });
      } else {
        this.stopTone = alarmTone();
      }
      this.timeout = setTimeout(() => this.dismiss(), 10 * 60 * 1000);
    }
  }
  onUnmount() {
    if (this.list && this.list.mounted) this.list.unmount();
  }
  _stop() {
    clearTimeout(this.timeout);
    if (this.stopTone) this.stopTone();
    this.stopTone = null;
  }
  dismiss() {
    this._stop();
    if (this.os.current === this) this.os.pop();
  }
  snooze() {
    this._stop();
    this.app.alarmClock.snooze(this.alarm, 9);
    if (this.os.current === this) this.os.pop();
    this.app.os.alert('Snoozing for 9 minutes');
  }
  onScroll(dir, speed) {
    return this.list.onScroll(dir, speed);
  }
  onSelect() {
    this.list.onSelect();
  }
  onMenu() {
    this.dismiss();
    return true;
  }
  onPlay() {
    this.snooze();
    return true;
  }
  destroy() {
    this._stop();
  }
}

/** Checks alarms every few seconds and rings them. */
export class AlarmClock {
  constructor(app) {
    this.app = app;
    this.snoozed = [];
    setInterval(() => this.check(), 5000);
  }
  check() {
    const now = new Date();
    const key = `${now.toDateString()} ${now.getHours()}:${now.getMinutes()}`;
    const day = now.getDay();
    const { store } = this.app;
    for (const a of store.settings.alarms) {
      if (!a.on || a.hour !== now.getHours() || a.minute !== now.getMinutes() || a.lastFired === key) continue;
      if (a.repeat === 'weekdays' && (day === 0 || day === 6)) continue;
      if (a.repeat === 'weekends' && day > 0 && day < 6) continue;
      store.set(
        'alarms',
        store.settings.alarms.map((x) => (x.id === a.id ? { ...x, lastFired: key, on: a.repeat === 'once' ? false : x.on } : x))
      );
      this.ring(a);
    }
    const due = this.snoozed.filter((s) => s.at <= Date.now());
    this.snoozed = this.snoozed.filter((s) => s.at > Date.now());
    due.forEach((s) => this.ring(s.alarm));
  }
  ring(alarm) {
    const os = this.app.os;
    os.wake();
    os.activity();
    if (os.modal) os.closeModal();
    os.push(new AlarmRing(this.app, alarm));
    window.ipod.win.show();
  }
  snooze(alarm, minutes) {
    this.snoozed.push({ alarm, at: Date.now() + minutes * 60000 });
  }
}

/** Pauses music and puts the iPod to sleep after N minutes. */
export class SleepTimer {
  constructor(app) {
    this.app = app;
    this.until = 0;
    this.timer = null;
  }
  set(minutes) {
    clearTimeout(this.timer);
    this.until = minutes ? Date.now() + minutes * 60000 : 0;
    if (minutes) {
      this.timer = setTimeout(() => {
        this.until = 0;
        this.app.player.pause();
        this.app.os.sleep();
      }, minutes * 60000);
    }
  }
  remaining() {
    return this.until ? Math.max(0, this.until - Date.now()) : 0;
  }
}
