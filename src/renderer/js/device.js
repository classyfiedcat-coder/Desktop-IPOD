/**
 * Renders the physical iPod (case, screen window, click wheel, hold switch)
 * for the chosen model + colour, and turns mouse/keyboard input into the
 * same button and wheel events a real iPod produces.
 */

import { getModel, getColor, SIZES, PX_PER_MM } from './models.js';
import { h, svg, ICONS, shade, Emitter } from './util.js';
import { MotionRig } from './rig.js';
import { makeWear } from './wear.js';

/** CSS custom properties for a colour scheme. */
export function colorVars(color) {
  const d = !!color.dark;
  return {
    '--front': color.front,
    '--front-hi': shade(color.front, d ? 0.1 : 0.35),
    '--front-lo': shade(color.front, d ? -0.35 : -0.12),
    '--front-edge': shade(color.front, d ? -0.5 : -0.28),
    '--wheel': color.wheel,
    '--wheel-hi': shade(color.wheel, d ? 0.08 : 0.5),
    '--wheel-lo': shade(color.wheel, d ? -0.3 : -0.08),
    '--label': color.label,
    '--center': color.center,
    '--center-hi': shade(color.center, d ? 0.12 : 0.4),
    '--center-lo': shade(color.center, d ? -0.35 : -0.14),
    '--bezel': color.bezel || (d ? '#050505' : '#1b1c1d'),
  };
}

const WHEEL_STEP_DEG = { low: 26, medium: 19, high: 13 };
const isMac = navigator.platform.toLowerCase().includes('mac');

/** Parts of the device that catch the mouse (the rest of the window is click-through). */
const SOLID = '.case, .hold-switch, .back, .side';

/** The steel shell from where it meets the front (0) to the back (1). */
const STEEL = [
  [0, '#6a6e73'],
  [0.06, '#e6e8eb'],
  [0.3, '#f3f4f6'],
  [0.68, '#b3b7bc'],
  [1, '#7b7f85'],
];
/** Black steel: deep and glossy, with a bright lip where it catches the light. */
const BLACK_STEEL = [
  [0, '#2c2d30'],
  [0.06, '#9a9da2'],
  [0.13, '#3a3c40'],
  [0.36, '#18191b'],
  [0.72, '#0d0e0f'],
  [1, '#222326'],
];

/**
 * The edge, from the front face (0) to the back (1): the front plastic shows
 * as a thin band of the front colour, then a fine dark seam, then the steel.
 */
export function edgeProfile(finish, front) {
  const steel = finish === 'black' ? BLACK_STEEL : STEEL;
  const P = 0.17;
  return [
    [0, shade(front, -0.12)],
    [0.08, front],
    [P - 0.03, shade(front, -0.22)],
    [P - 0.012, '#0e0f10'],
    ...steel.map(([t, c]) => [P + t * (1 - P), c]),
  ];
}

export const profileGradient = (dir, stops) => `linear-gradient(${dir}, ${stops.map(([t, c]) => `${c} ${(t * 100).toFixed(1)}%`).join(', ')})`;

/** Which back an iPod gets when the setting is "Auto": black steel to go with a black front. */
export const backFinishFor = (color, setting) => (setting === 'steel' || setting === 'black' ? setting : color.dark && color.id !== 'u2' ? 'black' : 'steel');

/** A plausible serial number, stable for a given colour. */
function serialFor(id) {
  let x = 2166136261;
  for (const ch of `ipod-${id}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let out = '8K6';
  for (let i = 0; i < 8; i++) {
    x = Math.imul(x ^ (x >>> 15), 2246822507);
    out += A[(x >>> 0) % A.length];
  }
  return out;
}

const HEADPHONES = '<svg viewBox="0 0 16 16"><path d="M8 2.2a6 6 0 0 0-6 6v4.3a1.3 1.3 0 0 0 1.3 1.3H5V9.4H3.4V8.2a4.6 4.6 0 0 1 9.2 0v1.2H11v4.4h1.7a1.3 1.3 0 0 0 1.3-1.3V8.2a6 6 0 0 0-6-6z" fill="currentColor"/></svg>';

/** Facets per rounded corner. */
const CORNER_FACETS = 5;
/** The steel edge sits this far (mm) outside the front, like the rim. */
const RIM = 0.35;
/** Light direction in the plane of the device (from the top left). */
const LIGHT = [-0.6, -0.8];

/**
 * Flat panels around the outline. Each one stands perpendicular to the front,
 * spans the full thickness and faces outward at angle θ (screen coordinates,
 * y down: 0 = right, 90 = down). Local x runs back → front, local y along
 * the edge.
 */
function buildShell({ W, H, R, T, u, refl, jack, dock, hold, profile }) {
  const r = (R + RIM) * u;
  const x0 = -RIM * u;
  const y0 = -RIM * u;
  const x1 = (W + RIM) * u;
  const y1 = (H + RIM) * u;
  const cx = [R * u, W * u - R * u];
  const cy = [R * u, H * u - R * u];
  const panels = [];
  // Panels reach a hair past the front and back faces so their antialiased
  // edges overlap instead of leaving a hairline gap.
  const LAP = 0.8;
  const D = T + LAP * 2;

  const panel = (theta, px, py, width, cls, ...kids) => {
    const t = (theta * Math.PI) / 180;
    const n = [Math.cos(t), Math.sin(t)];
    const lit = n[0] * LIGHT[0] + n[1] * LIGHT[1]; // -1 (shadow) … 1 (lit)
    const tint = lit > 0 ? `rgba(255, 255, 255, ${(0.16 * lit).toFixed(3)})` : `rgba(0, 0, 0, ${(0.4 * -lit).toFixed(3)})`;
    // The reflection band slides along the depth as this face turns toward or away from you.
    const k = 22;
    const wall = cls.startsWith('wall');
    const el = h(
      'div',
      {
        class: `side ${cls}`,
        style: {
          width: `${D.toFixed(2)}px`,
          height: `${(width + 0.6).toFixed(2)}px`, // a hair of overlap hides seams between facets
          transform: `translate(${px.toFixed(2)}px, ${py.toFixed(2)}px) rotateZ(${(theta - 180).toFixed(2)}deg) rotateY(-90deg) translate(${(-T - LAP).toFixed(2)}px, ${(-(width + 0.6) / 2).toFixed(2)}px)`,
          background: `linear-gradient(${tint}, ${tint}), ${profileGradient('to left', profile)}`,
        },
      },
      // Only the long walls get a moving highlight; on the narrow facets it wouldn't show.
      wall ? refl('side-hl', `${(-k * n[0]).toFixed(1)} ${(-k * n[1]).toFixed(1)} 0 0`) : null,
      ...kids
    );
    panels.push(el);
    return el;
  };

  // Walls along the straight edges.
  panel(180, x0, (y0 + y1) / 2, cy[1] - cy[0], 'wall wall-l');
  panel(0, x1, (y0 + y1) / 2, cy[1] - cy[0], 'wall wall-r');
  const topLen = cx[1] - cx[0];
  const bottomLen = topLen;
  // On the top wall, local x is depth (back → front) and local y runs right →
  // left along the edge. at() places something centred on a point given in
  // device millimetres across and a fraction of the depth from the front.
  const topY = (mmX) => topLen / 2 + 0.3 + (x0 + x1) / 2 - mmX * u;
  const depthX = (depth) => LAP + T * (1 - depth);
  const at = (mmX, depth, wMm, hMm) => ({
    left: `${(depthX(depth) - (hMm / 2) * u).toFixed(2)}px`,
    top: `${(topY(mmX) - (wMm / 2) * u).toFixed(2)}px`,
    width: `${(hMm * u).toFixed(2)}px`,
    height: `${(wMm * u).toFixed(2)}px`,
  });
  // Labels read left to right along the top with the front facing you.
  const label = (mmX, depth, html, cls) =>
    h('div', { class: `edge-label ${cls}`, html, style: { left: `${depthX(depth).toFixed(2)}px`, top: `${topY(mmX).toFixed(2)}px` } });
  panel(
    270,
    (x0 + x1) / 2,
    y0,
    topLen,
    'wall wall-t',
    // The slot the hold switch slides in, its label, the headphone jack and its icon.
    h('div', { class: 'hold-slot', style: at(hold.x, hold.depth, hold.w + 0.6, 2.4) }),
    label(hold.x + hold.w / 2 + 4.4, hold.depth, 'HOLD', 'lbl-hold'),
    label(jack.x - 5.8, 0.5, HEADPHONES, 'lbl-phones'),
    h('div', { class: 'jack', style: at(jack.x, 0.5, jack.d, jack.d) })
  );
  panel(
    90,
    (x0 + x1) / 2,
    y1,
    bottomLen,
    'wall wall-b',
    // Dock connector, centred: a chrome-rimmed slot with a row of pins.
    h('div', { class: 'dock', style: { left: `${(LAP + T / 2 - (dock.h / 2) * u).toFixed(2)}px`, top: `${(bottomLen / 2 - (dock.w / 2) * u + 0.3).toFixed(2)}px`, width: `${(dock.h * u).toFixed(2)}px`, height: `${(dock.w * u).toFixed(2)}px` } }, h('div', { class: 'dock-pins' }))
  );

  // Faceted corners: chords of the corner arc, so they meet the walls exactly.
  const corners = [
    [cx[0], cy[0], 180], // top left
    [cx[1], cy[0], 270], // top right
    [cx[1], cy[1], 0], // bottom right
    [cx[0], cy[1], 90], // bottom left
  ];
  const step = 90 / CORNER_FACETS;
  const chord = 2 * r * Math.sin(((step / 2) * Math.PI) / 180);
  const reach = r * Math.cos(((step / 2) * Math.PI) / 180);
  for (const [ccx, ccy, start] of corners) {
    for (let j = 0; j < CORNER_FACETS; j++) {
      const theta = start + (j + 0.5) * step;
      const t = (theta * Math.PI) / 180;
      panel(theta, ccx + Math.cos(t) * reach, ccy + Math.sin(t) * reach, chord, 'facet');
    }
  }
  return panels;
}

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
    this.rig = new MotionRig();
    this._bindGlobal();
  }

  /** Build (or rebuild) the device. Returns the logical screen element. */
  build({ model: modelId, color: colorId, size: sizeId, shadow = true, customColors, engraving = '', wheelGlow = false, reflections = true, wear = 'light', backFinish = 'auto' }) {
    const model = getModel(modelId);
    const color = getColor(model, colorId, customColors);
    const size = SIZES.find((s) => s.id === sizeId) || SIZES[1];
    const u = PX_PER_MM * size.scale;
    const mm = (v) => `${(v * u).toFixed(2)}px`;
    this.model = model;
    this.color = color;
    this.u = u;
    const finish = backFinishFor(color, backFinish);

    const [W, H] = model.size;
    const T = model.depth * u;
    // Room around the device for tilting, lifting and the shadow on the desk.
    const pad = Math.round(46 * size.scale);
    const widthPx = Math.round(W * u + pad * 2);
    const heightPx = Math.round(H * u + pad * 2);

    const vars = { ...colorVars(color), '--u': `${u}px`, '--radius': mm(model.radius), '--thick': `${T.toFixed(2)}px` };

    // A reflection layer: slides by (kx, ky) per unit of tilt; "glint" layers
    // also brighten as the surface turns toward the light.
    const refl = (cls, par, glint = true) => h('div', { class: `refl ${cls}`, 'data-par': par, 'data-glint': glint || null });

    const caseEl = h(
      'div',
      { class: 'case' },
      h('div', { class: 'gloss' }, refl('gloss-band', '-16 13')),
      // Fine scratches and dust on the plastic, catching the light.
      h('div', { class: 'case-wear' }, h('div', { class: 'case-wear-lines', 'data-glint': '' }))
    );

    // Screen window. The LCD sits a little behind the clear front.
    const s = model.screen;
    const [resW, resH] = s.res;
    const innerW = (s.w - s.inset[0] * 2) * u;
    const zoom = innerW / resW;
    const innerH = resH * zoom;
    const insetY = (s.h * u - innerH) / 2;
    const screen = h('div', { class: 'screen', style: { width: `${resW}px`, height: `${resH}px`, zoom: String(zoom) } });
    const screenWrap = h(
      'div',
      {
        class: 'screen-wrap',
        style: { left: mm(s.inset[0]), top: `${insetY.toFixed(2)}px`, width: `${innerW.toFixed(2)}px`, height: `${innerH.toFixed(2)}px` },
      },
      screen
    );
    const bezel = h(
      'div',
      {
        class: 'bezel',
        style: { left: mm(s.x), top: mm(s.y), width: mm(s.w), height: mm(s.h), borderRadius: mm(s.radius) },
      },
      screenWrap,
      // The clear glass over the LCD: a faint streak, and a big soft reflection
      // of the room's light that slides across when you tip it toward the light.
      h('div', { class: 'glass' }, refl('glare', '-30 24'), refl('softbox', '-115 95'), h('div', { class: 'glass-edge' }))
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
      h('div', { class: 'wheel-sheen' }, refl('sheen', '-9 8')),
      h('div', { class: 'lbl lbl-menu', text: 'MENU' }),
      svg(ICONS.prev, 'lbl lbl-prev'),
      svg(ICONS.next, 'lbl lbl-next'),
      svg(ICONS.playpause, 'lbl lbl-play'),
      h('div', { class: 'press' }),
      h('div', { class: 'glow' })
    );
    const center = h('div', { class: 'center', style: { width: mm(wd.center), height: mm(wd.center) } }, h('div', { class: 'center-spec' }, refl('spec', '-14 12')));
    wheel.append(center);
    caseEl.append(wheel);

    // Hold switch: a little fin standing up out of the top edge.
    const holdEl = h('div', { class: `hold-switch hold-${model.hold}`, title: 'Hold switch' }, h('div', { class: 'hold-track' }, h('div', { class: 'hold-knob' })));
    holdEl.classList.toggle('on', this.hold);
    holdEl.style.transform = `translateZ(${(-T * 0.3).toFixed(2)}px)`;

    // The polished stainless back, shown when you flip the iPod over.
    const lines = String(engraving || color.engraved || '').split('\n').filter(Boolean).slice(0, 2);
    // Mirror steel: the room slides across it (broken up by scratches and
    // smudges), the scratches catch the light, and tipped toward the light
    // the whole back flares. The lettering is etched: matte, so it stays put
    // while the reflections move around it.
    const back = h(
      'div',
      { class: 'back' },
      h('div', { class: 'back-env' }, refl('env', '-10 9')),
      h('div', { class: 'back-lines', 'data-glint': '' }),
      h('div', { class: 'back-flare', 'data-flare': '0.75 1.1 0.8' }),
      h('div', { class: 'back-mark' }, 'iPod'),
      lines.length ? h('div', { class: 'back-engraving' }, ...lines.map((l) => h('div', { text: l }))) : null,
      h('div', { class: 'back-cap' }, `${this.capacity || '30GB'}`),
      h(
        'div',
        { class: 'back-small' },
        h('div', { text: `Serial No.: ${serialFor(color.id)}` }),
        h('div', { text: 'Designed in California. Assembled on your desktop. Model No.: A1136  EMC No.: 2065' }),
        h('div', { text: 'Rated 5-30V \u2393 1A Max.' }),
        h('div', { class: 'back-marks' }, h('span', { class: 'mk-fc', text: 'FC' }), h('span', { class: 'mk-ce', text: 'CE' }), h('span', { class: 'mk-box', text: 'VCI' }), h('span', { class: 'mk-tick', text: '\u2713' }))
      ),
      h('div', { class: 'back-edge' })
    );

    // The body: the stainless edge is a closed shell of flat panels around
    // the rounded-rectangle outline (four walls plus faceted corners), so it
    // has real thickness from every angle.
    const shell = buildShell({
      W,
      H,
      R: model.radius,
      T,
      u,
      refl,
      jack: { x: W - model.jack, d: 5.2 },
      dock: { w: 21, h: 2.4 },
      hold: { x: 10.5, w: 8, depth: 0.3 },
      profile: edgeProfile(finish, color.front),
    });

    const backFace = h('div', { class: 'face face-back' }, h('div', { class: 'rim' }), back);
    backFace.style.transform = `translateZ(${(-T).toFixed(2)}px) rotateY(180deg)`;
    const flipper = h(
      'div',
      { class: 'flipper' },
      h('div', { class: 'face face-front' }, h('div', { class: 'rim' }, refl('rim-env', '-6 26', false)), caseEl),
      ...shell,
      holdEl,
      backFace
    );
    const ground = h('div', { class: 'ground' }, h('div', { class: 'ground-soft' }), h('div', { class: 'ground-near' }));

    const el = h(
      'div',
      {
        class: [
          'ipod',
          `model-${model.id}`,
          color.dark ? 'dark' : 'light',
          `color-${color.id}`,
          `finish-${finish}`,
          shadow ? 'shadowed' : '',
          this.backlit ? 'backlit' : '',
          this.flipped ? 'flipped' : '',
          wheelGlow ? 'glow-on' : '',
          reflections ? '' : 'no-reflect',
        ].join(' '),
        style: { width: mm(W), height: mm(H), left: `${pad}px`, top: `${pad}px` },
      },
      ground,
      flipper
    );
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    // Label sizing relative to the wheel so all models look right.
    el.style.setProperty('--wheel-d', mm(wd.d));
    el.style.setProperty('--center-d', mm(wd.center));

    this.stage.replaceChildren(el);
    this.el = el;
    this.flipper = flipper;
    this.caseEl = caseEl;
    this.wheel = wheel;
    this.centerEl = center;
    this.holdEl = holdEl;
    this.screen = screen;
    this.screenWrap = screenWrap;
    this.zoom = zoom;

    this._bindWheel(wheel, center);
    this._bindCase(flipper);
    flipper.addEventListener('dblclick', (e) => {
      if (e.target.closest('.wheel, .hold-switch')) return;
      this.flip(e.target.closest('.face-back') ? false : undefined);
    });
    holdEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.setHold(!this.hold, true);
    });

    this.rig.attach({
      el,
      flipper,
      ground: shadow ? ground : null,
      lcd: screenWrap,
      thickness: T,
      depth: model.screen.depth * u,
      pad,
      flipped: !!this.flipped,
      reflections,
    });

    this._applyWear(el, wear, W * u, H * u);

    this.windowSize = { width: widthPx, height: heightPx, pad };
    if (window.ipod) window.ipod.win.resize(this.windowSize);
    return screen;
  }

  /** Scratches and smudges on the back (and a trace of them on the front gloss). */
  _applyWear(el, level, w, h) {
    el.classList.toggle('worn', level !== 'none');
    if (level === 'none') return;
    // Paint after the first frame so building the device stays instant.
    requestAnimationFrame(() => {
      const back = makeWear({ w, h, level, seed: 5 });
      const front = makeWear({ w, h, level: level === 'worn' ? 'worn' : 'light', seed: 23, dust: true });
      if (!back || el !== this.el) return;
      el.style.setProperty('--wear-mask', `url(${back.mask})`);
      el.style.setProperty('--wear-lines', `url(${back.lines})`);
      el.style.setProperty('--wear-front', `url(${front.mask})`);
      el.style.setProperty('--wear-front-lines', `url(${front.lines})`);
    });
  }

  /** Live colour changes (custom colour editor) without rebuilding. */
  applyColors(color) {
    if (!this.el) return;
    for (const [k, v] of Object.entries(colorVars(color))) this.el.style.setProperty(k, v);
    this.el.classList.toggle('dark', !!color.dark);
    this.el.classList.toggle('light', !color.dark);
  }

  /** Turn the iPod over to see the back (and the engraving). */
  flip(show) {
    this.flipped = show === undefined ? !this.flipped : !!show;
    this.rig.flip(this.flipped);
    this.emit('flip', this.flipped);
  }

  setGlow(on) {
    if (this.el) this.el.classList.toggle('glow-on', !!on);
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
    if (down) this.rig.nudge(button);
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
      wheel.style.setProperty('--ga', `${((Math.atan2(dx, -dy) * 180) / Math.PI).toFixed(1)}deg`);
      wheel.classList.toggle('touching', !isCenter);
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
      wheel.style.setProperty('--ga', `${((Math.atan2(dx, -dy) * 180) / Math.PI).toFixed(1)}deg`);
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
      wheel.classList.remove('touching');
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
    this.rig.twist(dir);
    this.emit('scroll', { dir, speed });
  }

  /** Grab the iPod anywhere on its body (not the wheel) to carry it around. */
  _bindCase(body) {
    body.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.wheel, .hold-switch')) return;
      e.preventDefault();
      body.setPointerCapture(e.pointerId);
      this._dragging = true;
      this.rig.setDragging(true);
      if (window.ipod) window.ipod.win.dragStart();
      const end = () => {
        this._dragging = false;
        this.rig.setDragging(false);
        if (window.ipod) window.ipod.win.dragEnd();
        body.removeEventListener('pointerup', end);
        body.removeEventListener('pointercancel', end);
      };
      body.addEventListener('pointerup', end);
      body.addEventListener('pointercancel', end);
    });
  }

  _bindGlobal() {
    // Drop music files or folders onto the iPod.
    let dragDepth = 0;
    const isFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      if (this.el) this.el.classList.add('drop-target');
      this.emit('dragging', true);
    });
    window.addEventListener('dragover', (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) {
        if (this.el) this.el.classList.remove('drop-target');
        this.emit('dragging', false);
      }
    });
    window.addEventListener('drop', (e) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      if (this.el) this.el.classList.remove('drop-target');
      this.emit('dragging', false);
      const paths = [...e.dataTransfer.files].map((f) => (window.ipod ? window.ipod.files.pathFor(f) : null)).filter(Boolean);
      if (paths.length) this.emit('drop', { paths });
    });
    window.addEventListener('paste', (e) => {
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (text) this.emit('paste', { text });
    });

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (e.target.closest('.ipod') && window.ipod) window.ipod.win.contextMenu();
    });

    // Let clicks fall through the transparent area around the iPod.
    window.addEventListener('mousemove', (e) => {
      if (this._dragging || !window.ipod) return;
      const over = !!(e.target && e.target.closest && e.target.closest(SOLID));
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
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && window.ipod) {
          e.preventDefault();
          window.ipod.clipboard.read().then((text) => text && this.emit('paste', { text }));
        }
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
