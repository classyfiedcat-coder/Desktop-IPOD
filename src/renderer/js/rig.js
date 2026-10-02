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
  snap(x) {
    this.x = x;
    this.target = x;
    this.v = 0;
  }
}

/** Maximum tilt toward the pointer, in degrees. */
export const MOTION_AMOUNTS = { subtle: 4, normal: 7, dramatic: 11 };

const IDLE_AFTER = 6000;

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
    this._flat = false;
  }

  /** Hook up a freshly built device. Spring state carries over rebuilds. */
  attach({ el, flipper, ground, lcd, thickness, depth, pad, flipped, reflections = true }) {
    this.els = { el, flipper, ground, lcd, near: ground && ground.querySelector('.ground-near') };
    this.T = thickness;
    this.lcdDepth = depth;
    this.pad = pad;
    this.flipS.snap(flipped ? 180 : 0);
    // data-par is "kx ky" (x follows x, y follows y) or a full "a b c d" mix
    // (tx = a·lx + b·ly, ty = c·lx + d·ly), optionally followed by a unit.
    this.layers = [...(reflections ? el.querySelectorAll('[data-par]') : [])].map((n) => {
      const parts = n.dataset.par.split(' ');
      const unit = isNaN(+parts[parts.length - 1]) ? parts.pop() : '%';
      const k = parts.map(Number);
      const m = k.length === 4 ? k : [k[0], 0, 0, k[1]];
      return { el: n, m, unit, back: !!n.closest('.face-back'), glint: n.hasAttribute('data-glint') };
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
    if (wx !== undefined) this._windowMoved(wx, wy);
    this.room = { x: clamp(sx, -1, 1), y: clamp(sy, -1, 1) };
    const pad = this.pad || 0;
    const inside = x >= pad && x <= w - pad && y >= pad && y <= h - pad;
    if (this.mode === 'off' || (this.mode === 'hover' && !inside)) {
      this.aim = { rx: 0, ry: 0 };
    } else {
      // Soft saturation: near the iPod it follows closely, far away it levels off.
      const R = Math.max(w, h) * 0.8;
      const dx = x - w / 2;
      const dy = y - h / 2;
      const nx = dx / (Math.abs(dx) + R);
      const ny = dy / (Math.abs(dy) + R);
      this.aim = { ry: nx * this.amount * 1.45, rx: -ny * this.amount * 1.15 };
    }
    if (inside) this.lastInput = performance.now();
    this.wake();
  }

  _windowMoved(wx, wy) {
    const now = performance.now();
    const last = this.lastWin;
    if (last && (last.x !== wx || last.y !== wy)) {
      const dt = Math.max(0.008, (now - last.t) / 1000);
      // Low-pass the velocity: window moves arrive in uneven steps.
      this.vel.x += ((wx - last.x) / dt - this.vel.x) * 0.3;
      this.vel.y += ((wy - last.y) / dt - this.vel.y) * 0.3;
      this.lastInput = now;
    }
    this.lastWin = { x: wx, y: wy, t: now };
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
    const dt = clamp((now - this._last) / 1000, 0.001, 0.05);
    this._last = now;

    // Sway from being carried around; it fades quickly once you stop.
    const decay = Math.pow(0.015, dt);
    this.vel.x *= decay;
    this.vel.y *= decay;
    const a = this.amount;
    const swayY = clamp(-this.vel.x / 1500, -1, 1) * a * 1.4;
    const swayX = clamp(this.vel.y / 1500, -1, 1) * a * 1.2;

    const idleFor = now - this.lastInput;
    const floating = this.float && this.awake && this.mode !== 'off' && !this.dragging && idleFor > IDLE_AFTER;
    let fx = 0;
    let fy = 0;
    let fl = 0;
    if (floating) {
      const s = now / 1000;
      const ramp = Math.min(1, (idleFor - IDLE_AFTER) / 4000);
      fx = (Math.sin(s * 0.47) * 0.55 + Math.sin(s * 0.21 + 2) * 0.3) * ramp;
      fy = (Math.sin(s * 0.33 + 1.3) * 0.8 + Math.sin(s * 0.17) * 0.35) * ramp;
      fl = (0.5 + 0.5 * Math.sin(s * 0.6)) * 0.12 * ramp;
    }

    this.rx.target = this.aim.rx + swayX + fx;
    this.ry.target = this.aim.ry + swayY + fy;
    this.lift.target = this.dragging && this.mode !== 'off' ? 1 : fl;
    const springs = [this.rx, this.ry, this.rz, this.lift, this.push, this.flipS];
    // Sub-step for stability when frames are long.
    const steps = dt > 0.02 ? 2 : 1;
    for (let i = 0; i < steps; i++) for (const s of springs) s.step(dt / steps);
    this.apply();

    const moving = springs.some((s) => !s.settled) || Math.abs(this.vel.x) + Math.abs(this.vel.y) > 3;
    if (moving) this._raf = requestAnimationFrame((t) => this._frame(t));
    else if (floating) {
      // The float is slow, so 30 fps is plenty and halves the cost.
      this._timer = setTimeout(() => {
        this._timer = 0;
        this._raf = requestAnimationFrame((t) => this._frame(t));
      }, 26);
    } else if (this.float && this.awake && this.mode !== 'off' && !this.dragging) {
      // Check back when it's time to start floating.
      this._timer = setTimeout(() => {
        this._timer = 0;
        this.wake();
      }, Math.max(50, IDLE_AFTER - idleFor + 20));
    }
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
    if (flat) {
      if (!this._flat) flipper.style.transform = 'none';
    } else {
      const s = 1 + 0.032 * lift - 0.014 * push - 0.09 * turning;
      const half = this.T / 2;
      flipper.style.transform =
        `translateZ(${(-half).toFixed(2)}px) rotateX(${rx.toFixed(3)}deg) rotateY(${yaw.toFixed(3)}deg) ` +
        `rotateZ(${rz.toFixed(3)}deg) translateZ(${half.toFixed(2)}px) scale(${s.toFixed(4)})`;
    }
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
    for (const L of this.layers) {
      const l = L.back ? lb : lf;
      const [m0, m1, m2, m3] = L.m;
      L.el.style.transform = `translate3d(${(l.x * m0 + l.y * m1).toFixed(2)}${L.unit}, ${(l.x * m2 + l.y * m3).toFixed(2)}${L.unit}, 0)`;
      if (L.glint) L.el.style.opacity = (L.back ? gb : gf).toFixed(3);
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
