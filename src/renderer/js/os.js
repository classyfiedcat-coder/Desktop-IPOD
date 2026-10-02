/**
 * The iPod "operating system": navigation stack with slide transitions,
 * title bar, backlight + sleep + hold behaviour, and the routing of wheel and
 * button events to the active screen.
 */

import { h, svg, ICONS, fmtClock, Emitter } from './util.js';
import { getModel } from './models.js';
import { click } from './sound.js';

const LONG_PRESS = { select: 650, menu: 750, next: 420, prev: 420, play: 1800 };
const SLIDE_MS = 230;

export class OS extends Emitter {
  constructor({ device, store, player }) {
    super();
    this.device = device;
    this.store = store;
    this.player = player;
    this.stack = [];
    this.modal = null;
    this.asleep = false;
    this.backlit = true;
    this._buttons = {};
    this._backlightTimer = null;
    this._battery = { level: 1, charging: true };

    device.on('down', ({ button }) => this._down(button));
    device.on('up', ({ button }) => this._up(button));
    device.on('cancel', ({ button }) => this._cancel(button));
    device.on('scroll', (e) => this._scroll(e));
    device.on('char', ({ key }) => this._char(key));
    device.on('hold', ({ on, user }) => this._hold(on, user));

    player.on('state', () => this.refreshStatus());
    player.on('track', () => this.refreshStatus());
    this._initBattery();
    setInterval(() => this.refreshTitle(), 15000);
  }

  // ---------------------------------------------------------------- setup --

  get ui() {
    return this._ui;
  }

  get current() {
    return this.stack[this.stack.length - 1] || null;
  }

  get root() {
    return this.stack[0] || null;
  }

  /** Mount the OS into the device's (new) screen element. */
  mount(screen) {
    const model = getModel(this.store.settings.model);
    const [w, hgt] = model.screen.res;
    const ui = model.screen.ui;
    this._ui = { ...ui, width: w, height: hgt, viewH: hgt - ui.title, rowH: (hgt - ui.title) / ui.rows };

    screen.className = 'screen';
    screen.style.setProperty('--sw', `${w}px`);
    screen.style.setProperty('--sh', `${hgt}px`);
    screen.style.setProperty('--title-h', `${ui.title}px`);
    screen.style.setProperty('--row-h', `${this._ui.rowH}px`);
    screen.style.setProperty('--fs', `${ui.fs}px`);
    screen.style.setProperty('--view-h', `${this._ui.viewH}px`);

    this.screen = screen;
    this.titleEl = h('div', { class: 'tb-title' });
    this.playIcon = h('div', { class: 'tb-play' });
    this.lockIcon = svg(ICONS.lock, 'tb-lock');
    this.batteryEl = h('div', { class: 'tb-battery' }, h('div', { class: 'batt-fill' }));
    this.titlebar = h(
      'div',
      { class: 'titlebar' },
      h('div', { class: 'tb-left' }, this.playIcon),
      this.titleEl,
      h('div', { class: 'tb-right' }, this.lockIcon, this.batteryEl)
    );
    this.viewport = h('div', { class: 'viewport' });
    this.overlay = h('div', { class: 'overlays' });
    this.dimmer = h('div', { class: 'dimmer' });
    screen.replaceChildren(h('div', { class: 'os' }, this.titlebar, this.viewport, this.overlay), this.dimmer);

    // Re-mount the current view into the fresh screen.
    const cur = this.current;
    if (cur) {
      if (cur.mounted) cur.unmount();
      this._mountView(cur);
    }
    this.refreshTitle();
    this.refreshStatus();
    this._applyBacklight();
    screen.classList.toggle('asleep', this.asleep);
  }

  // ------------------------------------------------------------ navigation --

  _mountView(view, cls = '') {
    const el = h('div', { class: `view ${cls}`.trim() });
    this.viewport.append(el);
    view.mount(el, this);
    this.screen.classList.toggle('fullscreen', !!view.fullscreen);
    return el;
  }

  push(view, { animate = true } = {}) {
    const prev = this.current;
    this.stack.push(view);
    if (!this.viewport) return;
    if (prev) prev.onLeave();
    const newEl = this._mountView(view, animate && prev ? 'enter-right' : '');
    this.refreshTitle();
    if (prev && animate) this._slide(prev, newEl, 'left');
    else if (prev) this._detach(prev);
    view.onEnter();
    this.emit('navigate', view);
  }

  pop({ animate = true } = {}) {
    if (this.stack.length <= 1) return false;
    const top = this.stack.pop();
    top.onLeave();
    const under = this.current;
    const newEl = this._mountView(under, animate ? 'enter-left' : '');
    this.refreshTitle();
    const topEl = top.el;
    if (animate) this._slide(top, newEl, 'right', true);
    else {
      top.unmount();
      topEl.remove();
      top.destroy();
    }
    under.onEnter();
    this.emit('navigate', under);
    return true;
  }

  popToRoot({ animate = true } = {}) {
    if (this.stack.length <= 1) return;
    const removed = this.stack.splice(1);
    const top = removed[removed.length - 1];
    removed.forEach((v) => v.onLeave());
    const root = this.current;
    const newEl = this._mountView(root, animate ? 'enter-left' : '');
    this.refreshTitle();
    if (animate) this._slide(top, newEl, 'right', true);
    else {
      top.unmount();
      top.el.remove();
    }
    removed.forEach((v) => v !== top && v.mounted && v.unmount());
    removed.forEach((v) => v.destroy());
    root.onEnter();
    this.emit('navigate', root);
  }

  /** Replace the whole stack (e.g. jump to Now Playing from anywhere). */
  goto(views, { animate = true } = {}) {
    const shown = this.current;
    const removed = this.stack.splice(1);
    for (const v of views) this.stack.push(v);
    const target = this.current;
    if (target === shown) return;
    if (this.modal) this.closeModal();
    shown.onLeave();
    const el = this._mountView(target, animate ? 'enter-right' : '');
    this.refreshTitle();
    const shownRemoved = removed.includes(shown);
    if (animate) this._slide(shown, el, 'left', shownRemoved);
    else {
      shown.unmount();
      shown.el.remove();
      if (shownRemoved) shown.destroy();
    }
    for (const v of removed) {
      if (v === shown) continue;
      if (v.mounted) {
        v.unmount();
        v.el.remove();
      }
      v.destroy();
    }
    target.onEnter();
    this.emit('navigate', target);
  }

  replaceTop(view) {
    const top = this.stack.pop();
    if (top) {
      top.onLeave();
      if (top.mounted) {
        top.unmount();
        top.el.remove();
      }
      top.destroy();
    }
    this.stack.push(view);
    this._mountView(view);
    this.refreshTitle();
    view.onEnter();
  }

  _slide(outView, inEl, dir, destroyOut = false) {
    const outEl = outView.el;
    outEl.classList.add(dir === 'left' ? 'exit-left' : 'exit-right');
    // Force layout so the transition runs.
    void inEl.offsetWidth;
    inEl.classList.remove('enter-right', 'enter-left');
    const done = () => {
      if (outView.mounted && outView !== this.current) outView.unmount();
      outEl.remove();
      if (destroyOut) outView.destroy();
    };
    setTimeout(done, SLIDE_MS + 20);
  }

  _detach(view) {
    view.unmount();
    view.el.remove();
  }

  // ------------------------------------------------------------- status ---

  refreshTitle() {
    if (!this.titleEl) return;
    const v = this.current;
    let title = v ? v.title : 'iPod';
    if (v && v.isNowPlaying && this.store.settings.timeInTitle) title = fmtClock(new Date(), this.store.settings.timeFormat === '24');
    this.titleEl.textContent = title || 'iPod';
    if (this.screen) this.screen.classList.toggle('fullscreen', !!(v && v.fullscreen));
  }

  refreshStatus() {
    if (!this.playIcon) return;
    const p = this.player;
    const state = p.track ? (p.playing ? 'playing' : 'paused') : 'none';
    if (this.playIcon.dataset.state !== state) {
      this.playIcon.dataset.state = state;
      this.playIcon.innerHTML = state === 'playing' ? ICONS.play : state === 'paused' ? ICONS.pause : '';
    }
    this.lockIcon.classList.toggle('show', this.device.hold);
    const b = this._battery;
    this.batteryEl.classList.toggle('charging', !!b.charging);
    this.batteryEl.classList.toggle('low', b.level < 0.2 && !b.charging);
    this.batteryEl.style.setProperty('--level', String(Math.max(0.06, b.level)));
  }

  async _initBattery() {
    try {
      if (!navigator.getBattery) return;
      const batt = await navigator.getBattery();
      const update = () => {
        // Desktops report level 1 + charging; show a full battery.
        this._battery = { level: batt.level, charging: batt.charging && batt.level < 0.995 };
        this.refreshStatus();
      };
      batt.addEventListener('levelchange', update);
      batt.addEventListener('chargingchange', update);
      update();
    } catch {
      /* not supported */
    }
  }

  // ------------------------------------------------------------ backlight --

  activity() {
    if (!this.backlit) {
      this.backlit = true;
      this._applyBacklight();
    }
    clearTimeout(this._backlightTimer);
    const secs = this.store.settings.backlight;
    if (secs > 0) {
      this._backlightTimer = setTimeout(() => {
        if (this.current && this.current.keepAwake) return this.activity();
        this.backlit = false;
        this._applyBacklight();
      }, secs * 1000);
    }
  }

  _applyBacklight() {
    if (!this.screen) return;
    const s = this.store.settings;
    const lit = this.backlit && !this.asleep;
    this.screen.classList.toggle('backlit', lit);
    this.device.setBacklit(lit);
    const bright = Math.max(0.15, Math.min(1, s.brightness));
    this.dimmer.style.opacity = this.asleep ? 1 : lit ? (1 - bright) * 0.6 : 0.72;
  }

  sleep() {
    this.asleep = true;
    this.player.pause();
    clearTimeout(this._backlightTimer);
    this.screen.classList.add('asleep');
    this._applyBacklight();
    this.emit('sleep');
  }

  wake() {
    if (!this.asleep) return;
    this.asleep = false;
    this.screen.classList.remove('asleep');
    this.activity();
    this.emit('wake');
  }

  // --------------------------------------------------------------- input --

  _hold(on, user) {
    this.refreshStatus();
    if (user && on && !this.asleep) this._flashLock();
  }

  _flashLock() {
    if (!this.overlay) return;
    let el = this.overlay.querySelector('.hold-overlay');
    if (!el) {
      el = h('div', { class: 'hold-overlay' }, svg(ICONS.lock, 'hold-lock'));
      this.overlay.append(el);
    }
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this._lockTimer);
    this._lockTimer = setTimeout(() => el.classList.remove('show'), 1300);
    this.activity();
  }

  _target() {
    return this.modal || this.current;
  }

  _down(button) {
    if (this.device.hold) {
      if (this.asleep) return;
      this._flashLock();
      return;
    }
    click('press');
    if (this.asleep) {
      this.wake();
      if (button === 'play') this.player.play();
      this._buttons[button] = { swallowed: true };
      return;
    }
    this.activity();
    const st = { t: performance.now(), long: false };
    st.timer = setTimeout(() => {
      st.long = true;
      this._long(button);
    }, LONG_PRESS[button] || 700);
    this._buttons[button] = st;
  }

  _up(button) {
    const st = this._buttons[button];
    delete this._buttons[button];
    if (!st || st.swallowed) return;
    clearTimeout(st.timer);
    if (st.long) this._longEnd(button);
    else this._press(button);
  }

  _cancel(button) {
    const st = this._buttons[button];
    if (!st) return;
    clearTimeout(st.timer);
    if (st.long) this._longEnd(button);
    delete this._buttons[button];
  }

  _press(button) {
    const v = this._target();
    if (!v) return;
    switch (button) {
      case 'select':
        v.onSelect();
        break;
      case 'menu':
        if (v.onMenu()) break;
        if (v === this.modal) this.closeModal();
        else this.pop();
        break;
      case 'play':
        if (v.onPlay && v.onPlay()) break;
        this.player.toggle();
        break;
      case 'next':
        if (v.onNext && v.onNext()) break;
        this.player.next();
        break;
      case 'prev':
        if (v.onPrev && v.onPrev()) break;
        this.player.prev();
        break;
    }
  }

  _long(button) {
    const v = this._target();
    switch (button) {
      case 'select':
        if (v) v.onSelectHold();
        break;
      case 'menu':
        if (v && v.onMenuHold && v.onMenuHold()) break;
        if (this.modal) this.closeModal();
        this.popToRoot();
        break;
      case 'play':
        this.sleep();
        break;
      case 'next':
      case 'prev':
        if (v && v.onSeekStart && v.onSeekStart(button === 'next' ? 1 : -1)) break;
        this.player.seekStart(button === 'next' ? 1 : -1);
        break;
    }
  }

  _longEnd(button) {
    if (button === 'next' || button === 'prev') {
      const v = this._target();
      if (v && v.onSeekEnd && v.onSeekEnd()) return;
      this.player.seekEnd();
    }
  }

  _scroll({ dir, speed }) {
    if (this.asleep) return;
    if (this.device.hold) {
      this._flashLock();
      return;
    }
    this.activity();
    const v = this._target();
    if (!v) return;
    if (v.onScroll(dir, speed) !== false) click('tick');
  }

  _char(key) {
    if (this.asleep || this.device.hold) return;
    this.activity();
    const v = this._target();
    if (v && v.onChar) v.onChar(key);
  }

  // -------------------------------------------------------------- modals --

  /** Pop-up sheet (Classic-style context menu). */
  sheet(view) {
    if (this.modal) this.closeModal();
    this.modal = view;
    const el = h('div', { class: 'sheet' });
    const wrap = h('div', { class: 'sheet-wrap' }, el);
    this.overlay.append(wrap);
    view.mount(el, this);
    view._wrap = wrap;
    requestAnimationFrame(() => wrap.classList.add('show'));
  }

  closeModal() {
    const m = this.modal;
    if (!m) return;
    this.modal = null;
    const wrap = m._wrap;
    wrap.classList.remove('show');
    setTimeout(() => {
      m.unmount();
      wrap.remove();
    }, 180);
  }

  alert(text, ms = 1600) {
    if (!this.overlay) return;
    const el = h('div', { class: 'toast' }, text);
    this.overlay.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, ms);
  }
}
