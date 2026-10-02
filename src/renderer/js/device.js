/**
 * Renders the physical iPod (case, screen window, click wheel, hold switch)
 * for the chosen model + colour, and turns mouse/keyboard input into the
 * same button and wheel events a real iPod produces.
 */

import { getModel, getColor, SIZES, PX_PER_MM } from './models.js';
import { h, svg, ICONS, shade, Emitter } from './util.js';

const WHEEL_STEP_DEG = { low: 26, medium: 19, high: 13 };
const isMac = navigator.platform.toLowerCase().includes('mac');

export class Device extends Emitter {
  constructor(stage) {
    super();
    this.stage = stage;
    this.el = null;
    this.screen = null;
    this.hold = false;
    this.wheelSpeed = 'medium';
    this.backlit = true;
    this._dragging = false;
    this._overCase = null;
    this._wheelAccum = 0;
    this._tickTimes = [];
    this._bindGlobal();
  }

  /** Build (or rebuild) the device. Returns the logical screen element. */
  build({ model: modelId, color: colorId, size: sizeId, shadow = true }) {
    const model = getModel(modelId);
    const color = getColor(model, colorId);
    const size = SIZES.find((s) => s.id === sizeId) || SIZES[1];
    const u = PX_PER_MM * size.scale;
    const mm = (v) => `${(v * u).toFixed(2)}px`;
    this.model = model;
    this.color = color;
    this.u = u;

    const [W, H] = model.size;
    const pad = Math.round(26 * size.scale);
    const widthPx = Math.round(W * u + pad * 2);
    const heightPx = Math.round(H * u + pad * 2);

    const front = color.front;
    const vars = {
      '--u': `${u}px`,
      '--front': front,
      '--front-hi': shade(front, color.dark ? 0.1 : 0.35),
      '--front-lo': shade(front, color.dark ? -0.35 : -0.12),
      '--front-edge': shade(front, color.dark ? -0.5 : -0.28),
      '--wheel': color.wheel,
      '--wheel-hi': shade(color.wheel, color.dark ? 0.08 : 0.5),
      '--wheel-lo': shade(color.wheel, color.dark ? -0.3 : -0.08),
      '--label': color.label,
      '--center': color.center,
      '--center-hi': shade(color.center, color.dark ? 0.12 : 0.4),
      '--center-lo': shade(color.center, color.dark ? -0.35 : -0.14),
      '--bezel': color.bezel,
      '--radius': mm(model.radius),
    };

    const caseEl = h('div', { class: 'case' }, h('div', { class: 'gloss' }));

    // Screen window.
    const s = model.screen;
    const [resW, resH] = s.res;
    const innerW = (s.w - s.inset[0] * 2) * u;
    const zoom = innerW / resW;
    const innerH = resH * zoom;
    const insetY = (s.h * u - innerH) / 2;
    const screen = h('div', { class: 'screen', style: { width: `${resW}px`, height: `${resH}px`, zoom: String(zoom) } });
    const bezel = h(
      'div',
      {
        class: 'bezel',
        style: { left: mm(s.x), top: mm(s.y), width: mm(s.w), height: mm(s.h), borderRadius: mm(s.radius) },
      },
      h(
        'div',
        {
          class: 'screen-wrap',
          style: { left: mm(s.inset[0]), top: `${insetY.toFixed(2)}px`, width: `${innerW.toFixed(2)}px`, height: `${innerH.toFixed(2)}px` },
        },
        screen,
        h('div', { class: 'glass' })
      )
    );
    caseEl.append(bezel);

    // Wheel.
    const wd = model.wheel;
    const wheel = h(
      'div',
      {
        class: 'wheel',
        style: { left: mm(W / 2 - wd.d / 2), top: mm(wd.cy - wd.d / 2), width: mm(wd.d), height: mm(wd.d) },
      },
      h('div', { class: 'lbl lbl-menu', text: 'MENU' }),
      svg(ICONS.prev, 'lbl lbl-prev'),
      svg(ICONS.next, 'lbl lbl-next'),
      svg(ICONS.playpause, 'lbl lbl-play'),
      h('div', { class: 'press' })
    );
    const center = h('div', { class: 'center', style: { width: mm(wd.center), height: mm(wd.center) } });
    wheel.append(center);
    caseEl.append(wheel);

    // Hold switch, peeking out of the case edge.
    const holdEl = h('div', { class: `hold-switch hold-${model.hold}`, title: 'Hold switch' }, h('div', { class: 'hold-track' }, h('div', { class: 'hold-knob' })));
    holdEl.classList.toggle('on', this.hold);

    const el = h(
      'div',
      {
        class: [
          'ipod',
          `model-${model.id}`,
          color.dark ? 'dark' : 'light',
          `color-${color.id}`,
          shadow ? 'shadowed' : '',
          this.backlit ? 'backlit' : '',
        ].join(' '),
        style: { width: mm(W), height: mm(H), left: `${pad}px`, top: `${pad}px` },
      },
      h('div', { class: 'rim' }),
      caseEl,
      holdEl
    );
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    // Label sizing relative to the wheel so all models look right.
    el.style.setProperty('--wheel-d', mm(wd.d));
    el.style.setProperty('--center-d', mm(wd.center));

    this.stage.replaceChildren(el);
    this.el = el;
    this.caseEl = caseEl;
    this.wheel = wheel;
    this.centerEl = center;
    this.holdEl = holdEl;
    this.screen = screen;
    this.screenWrap = screen.parentElement;
    this.zoom = zoom;

    this._bindWheel(wheel, center);
    this._bindCase(caseEl);
    holdEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.setHold(!this.hold, true);
    });

    this.windowSize = { width: widthPx, height: heightPx, pad };
    if (window.ipod) window.ipod.win.resize(this.windowSize);
    return screen;
  }

  setHold(on, user = false) {
    this.hold = !!on;
    if (this.holdEl) this.holdEl.classList.toggle('on', this.hold);
    this.emit('hold', { on: this.hold, user });
  }

  setBacklit(on) {
    this.backlit = on;
    if (this.el) this.el.classList.toggle('backlit', on);
  }

  // ---------------------------------------------------------------- input --

  _press(button, down) {
    this.emit(down ? 'down' : 'up', { button });
  }

  _bindWheel(wheel, center) {
    let active = null;

    const geometry = () => {
      const r = wheel.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 };
    };
    const zoneFor = (dx, dy) => {
      const a = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0 = top, clockwise
      if (a > -45 && a <= 45) return 'menu';
      if (a > 45 && a <= 135) return 'next';
      if (a > -135 && a <= -45) return 'prev';
      return 'play';
    };

    wheel.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const g = geometry();
      const dx = e.clientX - g.cx;
      const dy = e.clientY - g.cy;
      const isCenter = e.target === center || Math.hypot(dx, dy) < center.offsetWidth / 2;
      wheel.setPointerCapture(e.pointerId);
      active = {
        id: e.pointerId,
        g,
        center: isCenter,
        zone: isCenter ? 'select' : zoneFor(dx, dy),
        angle: Math.atan2(dy, dx),
        accum: 0,
        travelled: 0,
        scrolling: false,
        cancelled: false,
      };
      if (isCenter) center.classList.add('pressed');
      else this._showPress(wheel, active.zone);
      this._press(active.zone, true);
    });

    wheel.addEventListener('pointermove', (e) => {
      if (!active || e.pointerId !== active.id) return;
      const { g } = active;
      const dx = e.clientX - g.cx;
      const dy = e.clientY - g.cy;
      const dist = Math.hypot(dx, dy);
      if (dist < g.r * 0.12) return; // too close to the centre to read an angle
      const angle = Math.atan2(dy, dx);
      let d = angle - active.angle;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      active.angle = angle;
      active.travelled += Math.abs(d);
      if (active.center && dist < (center.offsetWidth / 2) * 1.05 && !active.scrolling) return;
      active.accum += (d * 180) / Math.PI;
      const step = WHEEL_STEP_DEG[this.wheelSpeed] || 19;
      if (!active.scrolling && active.travelled > (8 * Math.PI) / 180) {
        active.scrolling = true;
        if (!active.cancelled) {
          active.cancelled = true;
          this.emit('cancel', { button: active.zone });
          this._clearPress(wheel, center);
        }
      }
      while (Math.abs(active.accum) >= step) {
        const dir = Math.sign(active.accum);
        active.accum -= dir * step;
        this._tick(dir);
      }
    });

    const end = (e) => {
      if (!active || e.pointerId !== active.id) return;
      if (!active.cancelled) this._press(active.zone, false);
      this._clearPress(wheel, center);
      active = null;
    };
    wheel.addEventListener('pointerup', end);
    wheel.addEventListener('pointercancel', (e) => {
      if (active && !active.cancelled) this.emit('cancel', { button: active.zone });
      if (active) active.cancelled = true;
      end(e);
    });
    wheel.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _showPress(wheel, zone) {
    const press = wheel.querySelector('.press');
    const pos = { menu: [50, 14], next: [86, 50], play: [50, 86], prev: [14, 50] }[zone];
    press.style.setProperty('--px', `${pos[0]}%`);
    press.style.setProperty('--py', `${pos[1]}%`);
    wheel.classList.add('pressing');
    wheel.dataset.zone = zone;
  }

  _clearPress(wheel, center) {
    wheel.classList.remove('pressing');
    center.classList.remove('pressed');
  }

  _tick(dir) {
    const now = performance.now();
    this._tickTimes.push(now);
    while (this._tickTimes.length && now - this._tickTimes[0] > 500) this._tickTimes.shift();
    const speed = this._tickTimes.length * 2; // ticks per second over the last half second
    this.emit('scroll', { dir, speed });
  }

  _bindCase(caseEl) {
    caseEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.wheel, .hold-switch')) return;
      e.preventDefault();
      caseEl.setPointerCapture(e.pointerId);
      this._dragging = true;
      if (window.ipod) window.ipod.win.dragStart();
      const end = () => {
        this._dragging = false;
        if (window.ipod) window.ipod.win.dragEnd();
        caseEl.removeEventListener('pointerup', end);
        caseEl.removeEventListener('pointercancel', end);
      };
      caseEl.addEventListener('pointerup', end);
      caseEl.addEventListener('pointercancel', end);
    });
  }

  _bindGlobal() {
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (e.target.closest('.ipod') && window.ipod) window.ipod.win.contextMenu();
    });

    // Let clicks fall through the transparent area around the iPod.
    window.addEventListener('mousemove', (e) => {
      if (this._dragging || !window.ipod) return;
      const over = !!(e.target && e.target.closest && e.target.closest('.case, .hold-switch, .rim'));
      if (over !== this._overCase) {
        this._overCase = over;
        window.ipod.win.ignoreMouse(!over);
      }
    });
    document.addEventListener('mouseleave', () => {
      if (this._dragging || !window.ipod) return;
      this._overCase = false;
      window.ipod.win.ignoreMouse(true);
    });

    // Mouse wheel / trackpad scroll over the iPod acts like the click wheel.
    window.addEventListener(
      'wheel',
      (e) => {
        if (!e.target.closest || !e.target.closest('.ipod')) return;
        e.preventDefault();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 40;
        if (e.deltaMode === 2) dy *= 400;
        this._wheelAccum += dy;
        const threshold = isMac ? 28 : 50;
        while (Math.abs(this._wheelAccum) >= threshold) {
          const dir = Math.sign(this._wheelAccum);
          this._wheelAccum -= dir * threshold;
          this._tick(dir);
        }
      },
      { passive: false }
    );

    const KEYMAP = {
      Enter: 'select',
      NumpadEnter: 'select',
      Escape: 'menu',
      Backspace: 'menu',
      ' ': 'play',
      MediaPlayPause: 'play',
      ArrowLeft: 'prev',
      ArrowRight: 'next',
      MediaTrackNext: 'next',
      MediaTrackPrevious: 'prev',
    };
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q' && window.ipod) window.ipod.win.quit();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this._tick(e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        for (let i = 0; i < 5; i++) this._tick(e.key === 'PageUp' ? -1 : 1);
        return;
      }
      if (this._typing && e.key === 'Backspace') {
        e.preventDefault();
        this.emit('char', { key: 'Backspace' });
        return;
      }
      const btn = KEYMAP[e.key];
      if (btn && !(this._typing && e.key === ' ')) {
        e.preventDefault();
        if (!e.repeat) {
          if (btn === 'select' && this.centerEl) this.centerEl.classList.add('pressed');
          this._press(btn, true);
        }
        return;
      }
      if (e.key.toLowerCase() === 'h' && !e.repeat && !this._typing) {
        this.setHold(!this.hold, true);
        return;
      }
      if (e.key.length === 1) this.emit('char', { key: e.key });
    });
    window.addEventListener('keyup', (e) => {
      const btn = KEYMAP[e.key];
      if (!btn || (this._typing && (e.key === ' ' || e.key === 'Backspace'))) return;
      if (btn === 'select' && this.centerEl) this.centerEl.classList.remove('pressed');
      this._press(btn, false);
    });
  }
}
