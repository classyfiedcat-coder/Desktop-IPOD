/**
 * The motion rig makes the iPod behave like a real object sitting on your
 * desktop. Everything is driven by damped springs:
 *
 *  - it turns gently toward the mouse pointer, wherever it is on screen;
 *  - picking it up (dragging) lifts it off the desk and it sways with the
 *    movement, then settles with a small bounce when you put it down;
 *  - pressing the wheel pushes that edge in, and spinning it gives a tiny
 *    twist, like the torque from your thumb;
 *  - left alone it floats very slightly, as if it's breathing;
 *  - flipping it over is a real 3D turn with momentum.
 *
 * Reflections are separate layers (marked with data-par in the DOM) that the
 * rig slides across the glass, gloss and chrome as the device turns. They are
 * moved with transforms only, so nothing is repainted while it moves.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const RAD = Math.PI / 180;

export class Spring {
  constructor(k, c, x = 0) {
    this.k = k;
    this.c = c;
    this.x = x;
    this.v = 0;
    this.target = x;
  }
  step(dt) {
    // Semi-implicit Euler is stable for these stiffnesses at 30-240 fps.
    const a = this.k * (this.target - this.x) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
  get settled() {
    return Math.abs(this.target - this.x) < 0.004 && Math.abs(this.v) < 0.004;
  }
  /** Moving fast enough to need every frame (scale: 1 for degrees, smaller for 0…1 values). */
  busy(scale = 1) {
    return Math.abs(this.target - this.x) > 0.25 * scale || Math.abs(this.v) > scale;
  }
  snap(x) {
    this.x = x;
    this.target = x;
    this.v = 0;
  }
}

/** Maximum tilt toward the pointer, in degrees. */
export const MOTION_AMOUNTS = { subtle: 4, normal: 7, dramatic: 11 };

export const IDLE_AFTER = 6000;
/** How long it floats once you leave it alone, and how long it takes to come to rest. */
export const FLOAT_FOR = 5 * 60 * 1000;
export const FLOAT_FADE = 8000;
/** Never draw faster than this, even on a 144 Hz screen (ms between frames). */
const MIN_FRAME = 11;
/** The float is slow and tiny, so it only needs about 20 frames a second (ms). */
const FLOAT_FRAME = 40;
/** Smaller pointer moves than this (degrees of tilt) aren't worth a frame. */
const AIM_EPSILON = 0.012;

export class MotionRig {
  constructor() {
    this.mode = 'cursor'; // cursor | hover | off
    this.amount = MOTION_AMOUNTS.normal;
    this.float = true;
    this.awake = true;
    this.rx = new Spring(64, 12.5);
    this.ry = new Spring(64, 12.5);
    this.rz = new Spring(110, 13);
    this.lift = new Spring(150, 14);
    this.push = new Spring(380, 20);
    this.flipS = new Spring(44, 11.2);
    this.aim = { rx: 0, ry: 0 };
    this.room = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.lastWin = null;
    this.lastInput = performance.now();
    this.dragging = false;
    this.els = null;
    this.layers = [];
    this._raf = 0;
    this._timer = 0;
    this._last = 0;
    this._drawn = 0;
    this._flat = false;
  }

  /** Hook up a freshly built device. Spring state carries over rebuilds. */
  attach({ el, flipper, ground, lcd, thickness, depth, pad, flipped, reflections = true }) {
    this.els = { el, flipper, ground, lcd, near: ground && ground.querySelector('.ground-near') };
    this.T = thickness;
    this.lcdDepth = depth;
    this.pad = pad;
    this.flipS.snap(flipped ? 180 : 0);
    // Layers the rig drives (all optional, combined freely):
    //   data-par="kx ky" or "a b c d" [unit]: slide with the light
    //     (tx = a·lx + b·ly, ty = c·lx + d·ly)
    //   data-glint: brighten as the surface turns toward the light
    //   data-flare="threshold gain max": flare up only when it faces the light squarely
    this.layers = [...(reflections ? el.querySelectorAll('[data-par], [data-glint], [data-flare]') : [])].map((n) => {
      let m = null;
      let unit = '%';
      if (n.dataset.par) {
        const parts = n.dataset.par.split(' ');
        if (isNaN(+parts[parts.length - 1])) unit = parts.pop();
        const k = parts.map(Number);
        m = k.length === 4 ? k : [k[0], 0, 0, k[1]];
      }
      const flare = n.dataset.flare ? n.dataset.flare.split(' ').map(Number) : null;
      return { el: n, m, unit, back: !!n.closest('.face-back'), glint: n.hasAttribute('data-glint'), flare };
    });
    this._flat = false;
    this.apply();
    this.wake();
  }

  configure({ mode, amount, float }) {
    if (mode) this.mode = mode;
    if (amount) this.amount = MOTION_AMOUNTS[amount] || MOTION_AMOUNTS.normal;
    if (float !== undefined) this.float = !!float;
    if (this.mode === 'off') this.aim = { rx: 0, ry: 0 };
    this.touch();
  }

  /** The iPod is asleep / hidden: stop floating so it costs nothing. */
  setAwake(on) {
    this.awake = !!on;
    if (on) this.touch();
  }

  // --------------------------------------------------------------- inputs --

  /** Pointer position relative to the window (from the main process, so it works anywhere on screen). */
  cursor({ x, y, w, h, wx, wy, sx = 0, sy = 0 }) {
    const carried = wx !== undefined && this._windowMoved(wx, wy);
    const room = { x: clamp(sx, -1, 1), y: clamp(sy, -1, 1) };
    const pad = this.pad || 0;
    const inside = x >= pad && x <= w - pad && y >= pad && y <= h - pad;
    let aim = { rx: 0, ry: 0 };
    if (this.mode !== 'off' && (this.mode !== 'hover' || inside)) {
      // Soft saturation: near the iPod it follows closely, far away it levels off.
      const R = Math.max(w, h) * 0.8;
      const dx = x - w / 2;
      const dy = y - h / 2;
      const nx = dx / (Math.abs(dx) + R);
      const ny = dy / (Math.abs(dy) + R);
      aim = { ry: nx * this.amount * 1.45, rx: -ny * this.amount * 1.15 };
    }
    if (inside) this.lastInput = performance.now();
    // Far from the iPod the tilt hardly changes as the pointer moves, so
    // don't draw a frame for a change nobody could see. Small moves add up:
    // the aim only updates once it's moved far enough from the last one.
    const changed =
      Math.abs(aim.rx - this.aim.rx) + Math.abs(aim.ry - this.aim.ry) > AIM_EPSILON ||
      Math.abs(room.x - this.room.x) + Math.abs(room.y - this.room.y) > 0.002 ||
      (aim.rx === 0 && aim.ry === 0 && (this.aim.rx !== 0 || this.aim.ry !== 0));
    if (changed) {
      this.aim = aim;
      this.room = room;
    }
    if (changed || carried) this.wake();
  }

  /** Returns true if the window moved. */
  _windowMoved(wx, wy) {
    const now = performance.now();
    const last = this.lastWin;
    const moved = !!last && (last.x !== wx || last.y !== wy);
    if (moved) {
      const dt = Math.max(0.008, (now - last.t) / 1000);
      // Low-pass the velocity: window moves arrive in uneven steps.
      this.vel.x += ((wx - last.x) / dt - this.vel.x) * 0.3;
      this.vel.y += ((wy - last.y) / dt - this.vel.y) * 0.3;
      this.lastInput = now;
    }
    this.lastWin = { x: wx, y: wy, t: now };
    return moved;
  }

  setDragging(on) {
    if (on === this.dragging) return;
    this.dragging = on;
    if (this.mode === 'off') return; // stays flat and sharp
    this.lift.target = on ? 1 : 0;
    if (!on) this.lift.v -= 1.6; // set it down with a little bounce
    this.touch();
  }

  /** A button press pushes that edge of the iPod in a little. */
  nudge(zone) {
    if (this.mode === 'off') return;
    const k = 18 + this.amount * 5;
    if (zone === 'menu') this.rx.v -= k;
    else if (zone === 'play') this.rx.v += k;
    else if (zone === 'next') this.ry.v -= k;
    else if (zone === 'prev') this.ry.v += k;
    else if (zone === 'select') this.push.v += 7;
    this.touch();
  }

  /** Spinning the wheel twists the body very slightly (torque from the thumb). */
  twist(dir) {
    if (this.mode === 'off') return;
    this.rz.v += dir * 3.2;
    this.touch();
  }

  flip(on) {
    this.flipS.target = on ? 180 : 0;
    // A real flick starts fast; give it a kick so it doesn't feel like a tween.
    this.flipS.v += (on ? 1 : -1) * 120;
    this.touch();
  }

  touch() {
    this.lastInput = performance.now();
    this.wake();
  }

  // ---------------------------------------------------------------- loop --

  wake() {
    if (!this.els) return;
    if (!this._raf) this._busy = false; // the first frame after a rest isn't a measure of speed
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = 0;
    }
    if (this._raf) return;
    this._last = performance.now();
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  _frame(now) {
    this._raf = 0;
    // High refresh rate screens would draw the 3D body 144+ times a second;
    // 60-90 is as smooth as this motion gets.
    if (now - this._drawn < MIN_FRAME) {
      this._raf = requestAnimationFrame((t) => this._frame(t));
      return;
    }
    this._drawn = now;
    // Real time whatever the frame rate: a slow frame is integrated in small
    // steps rather than slowing the motion down.
    const dt = clamp((now - this._last) / 1000, 0.001, 0.25);
    if (this._busy) this._pace(dt);
    this._last = now;

    // Sway from being carried around; it fades quickly once you stop.
    const decay = Math.pow(0.015, dt);
    this.vel.x *= decay;
    this.vel.y *= decay;
    const a = this.amount;
    const swayY = clamp(-this.vel.x / 1500, -1, 1) * a * 1.4;
    const swayX = clamp(this.vel.y / 1500, -1, 1) * a * 1.2;

    // Left alone it floats for a few minutes, then comes to rest so it costs
    // nothing while you're away. Any touch (or pointer over it) starts it again.
    const floatFor = now - this.lastInput - IDLE_AFTER;
    const canFloat = this.float && this.awake && this.mode !== 'off' && !this.dragging;
    const floating = canFloat && floatFor > 0 && floatFor < FLOAT_FOR + FLOAT_FADE;
    let fx = 0;
    let fy = 0;
    let fl = 0;
    if (floating) {
      const s = now / 1000;
      const ramp = Math.min(1, floatFor / 4000, (FLOAT_FOR + FLOAT_FADE - floatFor) / FLOAT_FADE);
      fx = (Math.sin(s * 0.47) * 0.55 + Math.sin(s * 0.21 + 2) * 0.3) * ramp;
      fy = (Math.sin(s * 0.33 + 1.3) * 0.8 + Math.sin(s * 0.17) * 0.35) * ramp;
      fl = (0.5 + 0.5 * Math.sin(s * 0.6)) * 0.12 * ramp;
    }

    this.rx.target = this.aim.rx + swayX + fx;
    this.ry.target = this.aim.ry + swayY + fy;
    this.lift.target = this.dragging && this.mode !== 'off' ? 1 : fl;
    const springs = [this.rx, this.ry, this.rz, this.lift, this.push, this.flipS];
    const steps = Math.ceil(dt / 0.012);
    for (let i = 0; i < steps; i++) for (const s of springs) s.step(dt / steps);
    this.apply();

    const carried = Math.abs(this.vel.x) + Math.abs(this.vel.y) > 3;
    const settled = !carried && springs.every((s) => s.settled);
    // Real movement (pointer, carrying, a press, the flip) gets every frame.
    // The float alone is slow enough that ~20 fps looks the same.
    const busy =
      carried ||
      this.rx.busy() ||
      this.ry.busy() ||
      this.rz.busy() ||
      this.flipS.busy() ||
      this.lift.busy(0.05) ||
      this.push.busy(0.05);
    this._busy = busy;
    if (busy || (!settled && !floating)) this._raf = requestAnimationFrame((t) => this._frame(t));
    else if (floating) {
      this._timer = setTimeout(() => {
        this._timer = 0;
        this._raf = requestAnimationFrame((t) => this._frame(t));
      }, FLOAT_FRAME);
    } else if (canFloat && floatFor <= 0) {
      // Check back when it's time to start floating.
      this._timer = setTimeout(() => {
        this._timer = 0;
        this.wake();
      }, Math.max(50, 20 - floatFor));
    }
  }

  /** Frame times during real movement; tells the device if it can't keep up (under ~28 fps). */
  _pace(dt) {
    this._paceT = (this._paceT || 0) + dt;
    this._paceN = (this._paceN || 0) + 1;
    if (this._paceN < 45) return;
    const slow = this._paceT / this._paceN > 1 / 28;
    this._paceT = 0;
    this._paceN = 0;
    if (slow && this.onSlow) this.onSlow();
  }

  apply() {
    const { el, flipper, ground, lcd, near } = this.els;
    const rx = this.rx.x;
    const ry = this.ry.x;
    const rz = this.rz.x;
    const flip = this.flipS.x;
    const lift = clamp(this.lift.x, -0.4, 1.4);
    const push = this.push.x;
    const turning = Math.abs(Math.sin(flip * RAD));
    const yaw = ry + flip;

    // At rest, drop the 3D transform entirely so the screen stays pixel-sharp.
    const flat = Math.abs(rx) + Math.abs(ry) + Math.abs(rz) + Math.abs(lift) + Math.abs(push) < 0.01 && Math.abs(flip % 360) < 0.01;
    const half = +(this.T / 2).toFixed(2);
    // The exact (rounded) numbers the CSS gets, so the 3D body lines up to the pixel.
    const t = flat ? { rx: 0, yaw: 0, rz: 0, scale: 1 } : { rx: +rx.toFixed(3), yaw: +yaw.toFixed(3), rz: +rz.toFixed(3), scale: +(1 + 0.032 * lift - 0.014 * push - 0.09 * turning).toFixed(4) };
    if (flat) {
      if (!this._flat) flipper.style.transform = 'none';
    } else {
      flipper.style.transform =
        `translateZ(${-half}px) rotateX(${t.rx}deg) rotateY(${t.yaw}deg) ` + `rotateZ(${t.rz}deg) translateZ(${half}px) scale(${t.scale})`;
    }
    if (this.onApply && !(flat && this._flat)) this.onApply({ ...t, half, room: this.room });
    this._flat = flat;

    const showBack = Math.cos(flip * RAD) < 0;
    if (showBack !== el.classList.contains('flipped')) el.classList.toggle('flipped', showBack);

    // Light direction per face, normalised so ±1 is a full tilt. The "room"
    // term keeps reflections anchored to the desktop while you move it.
    const norm = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
    const a = this.amount || 7;
    const fyaw = norm(yaw);
    const byaw = norm(yaw - 180);
    const light = (y) => ({
      x: clamp(y / a + this.room.x * 0.45, -3, 3),
      y: clamp(rx / a + this.room.y * 0.35, -3, 3),
    });
    const lf = light(fyaw);
    const lb = light(byaw);
    // Brighter when the surface turns toward the light (top left) or is lifted toward it.
    const glint = (l) => clamp(0.66 - l.x * 0.15 + l.y * 0.12 + lift * 0.08, 0.2, 0.85);
    const gf = glint(lf);
    const gb = glint(lb);
    // How squarely a face points at the light (top left, above the screen).
    const facing = (l) => l.y * 0.85 - l.x * 0.5;
    for (const L of this.layers) {
      const l = L.back ? lb : lf;
      if (L.m) {
        const [m0, m1, m2, m3] = L.m;
        L.el.style.transform = `translate3d(${(l.x * m0 + l.y * m1).toFixed(2)}${L.unit}, ${(l.x * m2 + l.y * m3).toFixed(2)}${L.unit}, 0)`;
      }
      if (L.flare) {
        const [t, g, max] = L.flare;
        L.el.style.opacity = clamp((facing(l) - t) * g, 0, max).toFixed(3);
      } else if (L.glint) L.el.style.opacity = (L.back ? gb : gf).toFixed(3);
    }

    // The LCD sits a little behind the clear front, so it shifts against the
    // bezel as you turn the iPod (parallax).
    if (lcd) {
      const d = this.lcdDepth;
      lcd.style.transform = flat ? 'none' : `translate3d(${(-d * Math.sin(ry * RAD)).toFixed(2)}px, ${(d * Math.sin(rx * RAD)).toFixed(2)}px, 0)`;
    }

    if (ground) {
      // The shadow falls on the desktop below and right of the iPod, slides
      // with the tilt and spreads out as it's lifted.
      const gx = -ry * 1.3 + lift * 5 + 3;
      const gy = 8 + rx * 1.0 + lift * 15;
      const sx = (1 + lift * 0.06) * (1 - turning * 0.62);
      const sy = 1 + lift * 0.05;
      ground.style.transform = `translate3d(${gx.toFixed(1)}px, ${gy.toFixed(1)}px, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
      ground.style.opacity = clamp(1 - lift * 0.35 - turning * 0.2, 0.3, 1).toFixed(3);
      // The tight contact shadow stays right under the body and only exists
      // while it's resting on the desk.
      if (near) {
        near.style.transform = `translate3d(${(-gx * 0.8).toFixed(1)}px, ${(-(gy - 2) * 0.85).toFixed(1)}px, 0)`;
        near.style.opacity = clamp(1 - lift * 1.6 - turning, 0, 1).toFixed(3);
      }
    }
  }
}
