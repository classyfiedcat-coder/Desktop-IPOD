/**
 * Renders the physical iPod (case, screen window, click wheel, hold switch)
 * for the chosen model + colour, and turns mouse/keyboard input into the
 * same button and wheel events a real iPod produces.
 */

import { getModel, getColor, SIZES, PX_PER_MM, depthFor, edgeBand } from './models.js';
import { h, svg, ICONS, shade, Emitter } from './util.js';
import { MotionRig } from './rig.js';
import { makeWear, wearCanvases } from './wear.js';
import { Body3D } from './body3d.js';

/** Viewer distance in millimetres (CSS perspective and the 3D camera share it). */
const PERSPECTIVE_MM = 230;
/**
 * The front face is laid out this many times larger than it's shown, then
 * scaled back down. In a 3D scene Chromium paints each flat face into an
 * image of its own (a render surface) and then warps that image onto the
 * screen. With perspective it paints that image at exactly the screen's
 * resolution, so warping it smears small text into a blur. The image is
 * painted in the face's own units, so a face laid out at 2x (zoom) and shown
 * at half size (transform) gets twice the pixels, and stays crisp at an angle.
 * (Supersampling just the screen doesn't help: it's painted into the face's
 * image at 1x either way.)
 */
const FACE_SUPERSAMPLE = 2;

/** The hold switch's width along the edge, in mm. */
const HOLD_W = 8;

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

/** Anodised aluminium, edge-on: the colour, lit along the rounded edges. */
const anodised = (c) => [
  [0, shade(c, -0.25)],
  [0.12, shade(c, 0.25)],
  [0.3, c],
  [0.7, shade(c, -0.1)],
  [0.88, shade(c, 0.2)],
  [1, shade(c, -0.3)],
];

/**
 * The edge, from the front face (0) to the back (1): the front plastic (or
 * aluminium) shows as a band of the front colour, then a fine dark seam, then
 * the steel. The mini is aluminium all the way round.
 */
export function edgeProfile(finish, front, model) {
  if (model && model.back === 'aluminium') return anodised(front);
  const steel = finish === 'black' ? BLACK_STEEL : STEEL;
  // How much of the depth the front piece takes.
  const P = model ? Math.min(0.4, Math.max(0.12, -model.profile.frontTo / model.depth)) : 0.17;
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

/**
 * The soft shadow the iPod casts on the desk: one smooth falloff from the
 * middle out, drawn once into a canvas (so moving it costs nothing, and
 * there's no visible edge between a fill and a blur however far it turns).
 */
function groundShadow(w, h, radius, u) {
  const blur = 2.8 * u;
  const m = Math.ceil(blur * 3);
  const c = document.createElement('canvas');
  c.className = 'ground-soft';
  c.width = Math.ceil(w + m * 2);
  c.height = Math.ceil(h + m * 2);
  Object.assign(c.style, { left: `${-m}px`, top: `${-m}px`, width: `${c.width}px`, height: `${c.height}px` });
  const g = c.getContext('2d');
  if (!g) return c;
  // A little smaller than the body, set slightly toward the bottom (where it rests).
  const grow = 1 * u;
  const x0 = w * 0.06 - grow;
  const y0 = h * 0.07 - grow;
  const x1 = w * 0.94 + grow;
  const y1 = h * 0.985 + grow;
  g.filter = `blur(${blur.toFixed(1)}px)`;
  g.fillStyle = 'rgba(0, 0, 0, 0.26)';
  g.beginPath();
  g.roundRect(m + x0, m + y0, x1 - x0, y1 - y0, radius + grow);
  g.fill();
  return c;
}

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

/** The name etched on the back. */
export const backWordmark = (model) => (model.id === 'mini' ? 'iPod mini' : model.id === 'nano3' ? 'iPod nano' : 'iPod');

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
function buildShell({ W, H, R, T, u, refl, ports, depth, dock, profile }) {
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
  const edgeLen = cx[1] - cx[0];
  // On the top wall, local x is depth (back → front) and local y runs right →
  // left along the edge; on the bottom wall it runs left → right. at() places
  // something centred on a point given in device millimetres across and a
  // fraction of the depth from the front.
  const alongY = (edge, mmX) => edgeLen / 2 + 0.3 + (edge === 'top' ? 1 : -1) * ((x0 + x1) / 2 - mmX * u);
  const depthX = (d) => LAP + T * (1 - d);
  const at = (edge, mmX, d, wMm, hMm) => ({
    left: `${(depthX(d) - (hMm / 2) * u).toFixed(2)}px`,
    top: `${(alongY(edge, mmX) - (wMm / 2) * u).toFixed(2)}px`,
    width: `${(hMm * u).toFixed(2)}px`,
    height: `${(wMm * u).toFixed(2)}px`,
  });
  // Labels read left to right along the top with the front facing you.
  const label = (mmX, d, html, cls) =>
    h('div', { class: `edge-label ${cls}`, html, style: { left: `${depthX(d).toFixed(2)}px`, top: `${alongY('top', mmX).toFixed(2)}px` } });
  // What's cut into an edge: the hold switch's slot (and its label), the
  // headphone jack (and its icon), the dock connector, a FireWire port.
  const cutouts = (edge) =>
    ports
      .filter((p) => p.edge === edge)
      .flatMap((p) => {
        if (p.kind === 'hold')
          return [h('div', { class: 'hold-slot', style: at(edge, p.x, depth, HOLD_W + 0.6, 2.4) }), edge === 'top' ? label(p.x + HOLD_W / 2 + 4.4, depth, 'HOLD', 'lbl-hold') : null];
        if (p.kind === 'jack') return [edge === 'top' ? label(p.x - 5.8, depth, HEADPHONES, 'lbl-phones') : null, h('div', { class: 'jack', style: at(edge, p.x, depth, 5.2, 5.2) })];
        if (p.kind === 'dock') return [h('div', { class: 'dock', style: at(edge, p.x, depth, dock.w, dock.h) }, h('div', { class: 'dock-pins' }))];
        if (p.kind === 'firewire') return [h('div', { class: 'firewire', style: at(edge, p.x, depth, 11, 4.6) }, h('div', { class: 'firewire-tongue' }))];
        return [];
      });
  panel(270, (x0 + x1) / 2, y0, edgeLen, 'wall wall-t', ...cutouts('top'));
  panel(90, (x0 + x1) / 2, y1, edgeLen, 'wall wall-b', ...cutouts('bottom'));

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
  build({
    model: modelId,
    color: colorId,
    size: sizeId,
    shadow = true,
    customColors,
    engraving = '',
    wheelGlow = false,
    reflections = true,
    wear = 'light',
    backFinish = 'auto',
    detail = 'high',
    motion = 'cursor',
  }) {
    const model = getModel(modelId);
    const color = getColor(model, colorId, customColors);
    const size = SIZES.find((s) => s.id === sizeId) || SIZES[1];
    const u = PX_PER_MM * size.scale;
    const mm = (v) => `${(v * u).toFixed(2)}px`;
    this.model = model;
    this.color = color;
    this.u = u;
    const finish = backFinishFor(color, backFinish);
    // High detail: the body is a real 3D model (WebGL). Otherwise, or if WebGL
    // isn't available, it's built from CSS panels.
    const hi = detail !== 'light' && !this._noWebGL && Body3D.supported();
    this.rig.onApply = null;
    this.rig.onSlow = null;
    // Switching to Light: let the GPU have its memory back.
    if (!hi && this.body3d) this.body3d.dispose();

    const [W, H] = model.size;
    // How thick it is (a 5th generation 30GB is 11mm, the 60 and 80GB 14mm),
    // and the band around the edge the ports are cut into.
    const depthMm = depthFor(model, this.capacity);
    const T = depthMm * u;
    const band = edgeBand(model, depthMm);
    const ports = model.ports;
    const holdPort = ports.find((p) => p.kind === 'hold');
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
    // Supersampled whenever it can tilt (with motion off it's always flat and pixel-sharp anyway).
    this.flatOnly = motion === 'off';
    const ss = this.flatOnly ? 1 : FACE_SUPERSAMPLE;
    const screen = h('div', {
      class: 'screen',
      style: { width: `${resW}px`, height: `${resH}px`, zoom: String(zoom) },
    });
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

    // Wheel. The original iPod's turns, inside a ring of four buttons; the
    // rest are click wheels (touch-sensitive, the labels are the buttons).
    const wd = model.wheel;
    const scroller = wd.type === 'scroll' ? h('div', { class: 'scroller', style: { width: mm(wd.inner), height: mm(wd.inner) } }, h('div', { class: 'scroller-grain' }), h('div', { class: 'scroller-sheen' })) : null;
    const wheel = h(
      'div',
      {
        class: `wheel wheel-${wd.type}`,
        style: { left: mm(W / 2 - wd.d / 2), top: mm(wd.cy - wd.d / 2), width: mm(wd.d), height: mm(wd.d) },
      },
      h('div', { class: 'wheel-sheen' }, refl('sheen', '-9 8')),
      scroller,
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

    // Hold switch: a little fin standing up out of the edge (top, or bottom on the nano).
    const holdEl = h('div', { class: `hold-switch hold-${model.hold} edge-${holdPort.edge}`, title: 'Hold switch' }, h('div', { class: 'hold-track' }, h('div', { class: 'hold-knob' })));
    holdEl.classList.toggle('on', this.hold);
    Object.assign(holdEl.style, {
      left: mm(holdPort.x - HOLD_W / 2),
      top: holdPort.edge === 'top' ? mm(-2) : mm(H - 0.6),
      transform: `translateZ(${(band.mid * u).toFixed(2)}px)`,
    });

    // The polished stainless back, shown when you flip the iPod over.
    const lines = String(engraving || color.engraved || '').split('\n').filter(Boolean).slice(0, 2);
    // Mirror steel: the room slides across it (broken up by scratches and
    // smudges), the scratches catch the light, and tipped toward the light
    // the whole back flares. The lettering is etched: matte, so it stays put
    // while the reflections move around it.
    const back = hi
      ? null
      : h(
      'div',
      { class: 'back' },
      h('div', { class: 'back-env' }, refl('env', '-10 9')),
      h('div', { class: 'back-lines', 'data-glint': '' }),
      h('div', { class: 'back-flare', 'data-flare': '0.75 1.1 0.8' }),
      h('div', { class: 'back-mark' }, backWordmark(model)),
      lines.length ? h('div', { class: 'back-engraving' }, ...lines.map((l) => h('div', { text: l }))) : null,
      h('div', { class: 'back-cap' }, `${this.capacity || ''}`),
      h(
        'div',
        { class: 'back-small' },
        h('div', { text: `Serial No.: ${serialFor(color.id)}` }),
        h('div', { text: `Designed in California. Assembled on your desktop. Model No.: ${model.marks.model}  EMC No.: ${model.marks.emc}` }),
        h('div', { text: 'Rated 5-30V \u2393 1A Max.' }),
        h('div', { class: 'back-marks' }, h('span', { class: 'mk-fc', text: 'FC' }), h('span', { class: 'mk-ce', text: 'CE' }), h('span', { class: 'mk-box', text: 'VCI' }), h('span', { class: 'mk-tick', text: '\u2713' }))
      ),
      h('div', { class: 'back-edge' })
    );

    // The body: the stainless edge is a closed shell of flat panels around
    // the rounded-rectangle outline (four walls plus faceted corners), so it
    // has real thickness from every angle.
    const shell = hi
      ? []
      : buildShell({
      W,
      H,
      R: model.radius,
      T,
      u,
      refl,
      ports,
      depth: -band.mid / depthMm,
      dock: { w: model.id === 'nano3' ? 19 : 21, h: 2.4 },
      profile: edgeProfile(finish, color.front, model),
    });

    let backFace = null;
    if (!hi) {
      backFace = h('div', { class: 'face face-back' }, h('div', { class: 'rim' }), back);
      backFace.style.transform = `translateZ(${(-T).toFixed(2)}px) rotateY(180deg)`;
    }
    const flipper = h(
      'div',
      { class: 'flipper' },
      h(
        'div',
        {
          class: 'face face-front',
          // Laid out at ss times the size (zoom), shown at 1x (scale): see FACE_SUPERSAMPLE.
          style: ss > 1 ? { inset: 'auto', left: '0', top: '0', width: mm(W), height: mm(H), zoom: String(ss), transform: `scale(${1 / ss})`, transformOrigin: '0 0' } : null,
        },
        hi ? null : h('div', { class: 'rim' }, refl('rim-env', '-6 26', false)),
        caseEl
      ),
      ...shell,
      holdEl,
      backFace
    );
    const ground = h('div', { class: 'ground' }, groundShadow(W * u, H * u, model.radius * u, u), h('div', { class: 'ground-near' }));

    const el = h(
      'div',
      {
        class: [
          'ipod',
          `model-${model.id}`,
          `front-${model.front}`,
          `back-${model.back}`,
          `screen-${s.style}`,
          color.dark ? 'dark' : 'light',
          `color-${color.id}`,
          `finish-${finish}`,
          shadow ? 'shadowed' : '',
          this.backlit ? 'backlit' : '',
          this.flipped ? 'flipped' : '',
          wheelGlow ? 'glow-on' : '',
          reflections ? '' : 'no-reflect',
          hi ? 'hi' : '',
        ].join(' '),
        style: { width: mm(W), height: mm(H), left: `${pad}px`, top: `${pad}px`, perspective: `${(PERSPECTIVE_MM * u).toFixed(2)}px` },
      },
      ground,
      flipper
    );
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    // A monochrome LCD's colours: unlit, and with the backlight on.
    if (s.lcd) {
      el.style.setProperty('--lcd-off', s.lcd.off);
      el.style.setProperty('--lcd-on', s.lcd.on);
    }
    // Label sizing relative to the wheel so all models look right.
    el.style.setProperty('--wheel-d', mm(wd.d));
    if (wd.inner) el.style.setProperty('--inner-d', mm(wd.inner));
    el.style.setProperty('--center-d', mm(wd.center));

    this.stage.replaceChildren(el);
    this.el = el;
    this.hi = false;
    if (hi) this.hi = this._mountBody3D({ el, flipper, W, H, u, pad, model, depthMm, band, color, finish, wear, engraving: lines });
    if (hi && !this.hi) {
      // WebGL refused to start: fall back to the CSS body for good.
      this._noWebGL = true;
      return this.build(arguments[0]);
    }
    this.flipper = flipper;
    this.caseEl = caseEl;
    this.wheel = wheel;
    this.centerEl = center;
    this.scroller = scroller;
    this._spin = 0;
    this.holdEl = holdEl;
    this.screen = screen;
    this.screenWrap = screenWrap;
    this.zoom = zoom * ss; // canvases (games, visualizer) size their pixels from this
    this._centerRatio = wd.center / wd.d; // the centre button's radius, as a share of the wheel's
    this._innerRatio = (wd.inner || wd.d) / wd.d; // the original iPod's turning wheel, inside its ring of buttons

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
    if (this.hi) this._bindBody3D();

    this.windowSize = { width: widthPx, height: heightPx, pad };
    if (window.ipod) window.ipod.win.resize(this.windowSize);
    return screen;
  }

  /** Build the WebGL body and hook it to the motion rig. Returns false if WebGL won't start. */
  _mountBody3D({ el, flipper, W, H, u, pad, model, depthMm, band, color, finish, wear, engraving }) {
    if (!this.body3d) this.body3d = new Body3D();
    const body = this.body3d;
    body.hold = this.hold;
    const rough = wear !== 'none' ? wearCanvases({ w: W * u, h: H * u, level: wear, seed: 5, scale: 2 }) : null;
    const ok = body.mount({
      host: el,
      W,
      H,
      R: model.radius,
      T: depthMm,
      u,
      pad,
      perspective: PERSPECTIVE_MM * u,
      color,
      finish,
      wear: rough,
      model,
      band,
      ports: model.ports,
      holdW: HOLD_W,
      back: { capacity: this.capacity || '', lines: engraving, serial: serialFor(color.id), wordmark: backWordmark(model), marks: model.marks },
    });
    if (!ok) return false;
    // Between the shadow on the desk and the HTML face.
    el.insertBefore(body.canvas, flipper);
    this.rig.onApply = (t) => body.update(t);
    // A GPU that can't keep up draws the body at a lower resolution.
    this.rig.onSlow = () => {
      if (body.lighten()) window.ipod && window.ipod.log('info', `3D body: drawing at ${body.renderer.getPixelRatio()}x to keep motion smooth`);
    };
    body.onLost = () => {
      // The GPU went away (driver reset, sleep): rebuild, in CSS if it keeps failing.
      this._lost = (this._lost || 0) + 1;
      if (this._lost > 2) this._noWebGL = true;
      this.emit('rebuild');
    };
    return true;
  }

  /** Mouse on the 3D body: drag it, double-click to flip, click the hold slider. */
  _bindBody3D() {
    const canvas = this.body3d.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.body3d.hitTest(e.clientX, e.clientY)) return;
      if (this.body3d.hitSlider && this.body3d.hitSlider(e.clientX, e.clientY)) {
        this.setHold(!this.hold, true);
        return;
      }
      this._startDrag(e, canvas);
    });
    canvas.addEventListener('dblclick', (e) => {
      if (this.body3d.hitTest(e.clientX, e.clientY)) this.flip();
    });
  }

  /** Scratches and smudges on the back (and a trace of them on the front gloss). */
  _applyWear(el, level, w, h) {
    el.classList.toggle('worn', level !== 'none');
    if (level === 'none') return;
    // Paint after the first frame so building the device stays instant.
    requestAnimationFrame(() => {
      if (el !== this.el) return;
      // The 3D body wears its own back; the CSS one needs it as images.
      const back = this.hi ? null : makeWear({ w, h, level, seed: 5 });
      const front = makeWear({ w, h, level: level === 'worn' ? 'worn' : 'light', seed: 23, dust: true });
      if (!front) return;
      if (back) {
        el.style.setProperty('--wear-mask', `url(${back.mask})`);
        el.style.setProperty('--wear-lines', `url(${back.lines})`);
      }
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
    if (this.hi) this.body3d.setFrontColor(color.front);
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
    if (this.hi) this.body3d.setHold(this.hold);
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
      const dist = Math.hypot(dx, dy);
      const isCenter = e.target === center || dist < g.r * this._centerRatio;
      // The original iPod: the inner wheel only turns (it doesn't click), the
      // buttons are on the ring around it, and the ring doesn't scroll.
      const turning = !isCenter && this.scroller && dist < g.r * this._innerRatio;
      const ring = !isCenter && this.scroller && !turning;
      wheel.setPointerCapture(e.pointerId);
      active = {
        id: e.pointerId,
        g,
        center: isCenter,
        ring,
        zone: turning ? null : isCenter ? 'select' : zoneFor(dx, dy),
        angle: Math.atan2(dy, dx),
        accum: 0,
        travelled: 0,
        scrolling: !!turning,
        cancelled: !!turning,
      };
      wheel.classList.toggle('turning', !!turning);
      if (turning) return;
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
      if (dist < g.r * 0.12 || active.ring) return; // too close to the centre to read an angle, or a button
      const angle = Math.atan2(dy, dx);
      let d = angle - active.angle;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      active.angle = angle;
      active.travelled += Math.abs(d);
      // The original's wheel turns under your finger.
      if (this.scroller && !active.center) this._turn((d * 180) / Math.PI);
      wheel.style.setProperty('--ga', `${((Math.atan2(dx, -dy) * 180) / Math.PI).toFixed(1)}deg`);
      if (active.center && dist < g.r * this._centerRatio * 1.05 && !active.scrolling) return;
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
        this._tick(dir, true);
      }
    });

    const end = (e) => {
      if (!active || e.pointerId !== active.id) return;
      if (!active.cancelled && active.zone) this._press(active.zone, false);
      this._clearPress(wheel, center);
      wheel.classList.remove('touching', 'turning');
      active = null;
    };
    wheel.addEventListener('pointerup', end);
    wheel.addEventListener('pointercancel', (e) => {
      if (active && !active.cancelled && active.zone) this.emit('cancel', { button: active.zone });
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

  /** Turn the original iPod's scroll wheel by some degrees (it follows your finger, the mouse wheel and the arrow keys). */
  _turn(deg) {
    if (!this.scroller) return;
    this._spin = (this._spin + deg) % 360;
    this.scroller.style.transform = `translate(-50%, -50%) rotate(${this._spin.toFixed(1)}deg)`;
  }

  _tick(dir, fromWheel = false) {
    if (!fromWheel) this._turn(dir * (WHEEL_STEP_DEG[this.wheelSpeed] || 19));
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
      this._startDrag(e, body);
    });
  }

  _startDrag(e, target) {
    e.preventDefault();
    target.setPointerCapture(e.pointerId);
    this._dragging = true;
    this.rig.setDragging(true);
    if (window.ipod) window.ipod.win.dragStart();
    const end = () => {
      this._dragging = false;
      this.rig.setDragging(false);
      if (window.ipod) window.ipod.win.dragEnd();
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
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
      const over = !!(e.target && e.target.closest && e.target.closest(SOLID)) || (this.hi && this.body3d.hitTest(e.clientX, e.clientY));
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
