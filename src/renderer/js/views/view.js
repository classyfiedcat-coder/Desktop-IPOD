/** Base screen. Views can be remounted (back, model change), so state lives on the instance and render() rebuilds the DOM. */

export class View {
  constructor(opts = {}) {
    this.title = opts.title || '';
    this.el = null;
    this.os = null;
    this._timers = new Set();
    this._intervals = new Set();
    this._raf = null;
  }

  /** CSS classes for the view container. */
  get className() {
    return '';
  }

  /** Hide the title bar (full-screen views such as photos or games). */
  get fullscreen() {
    return false;
  }

  mount(el, os) {
    this.el = el;
    this.os = os;
    this.mounted = true;
    if (this.className) el.classList.add(...this.className.split(' ').filter(Boolean));
    this.render();
  }

  unmount() {
    this.mounted = false;
    for (const t of this._timers) clearTimeout(t);
    for (const t of this._intervals) clearInterval(t);
    this._timers.clear();
    this._intervals.clear();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this._offs) this._offs.forEach((off) => off());
    this._offs = [];
    this.onUnmount();
  }

  /** Called when the view is permanently removed from the stack. */
  destroy() {}

  onUnmount() {}
  render() {}
  /** Became the top-most view (after a push or a pop back to it). */
  onEnter() {}
  /** Another view covered this one, or it was popped. */
  onLeave() {}

  /** Return false if nothing moved (no click sound). */
  onScroll() {
    return false;
  }
  onSelect() {}
  onSelectHold() {}
  /** Return true to consume the Menu button instead of going back. */
  onMenu() {
    return false;
  }

  setTitle(t) {
    this.title = t;
    if (this.os && this.os.current === this) this.os.refreshTitle();
  }

  later(fn, ms) {
    const t = setTimeout(() => {
      this._timers.delete(t);
      fn();
    }, ms);
    this._timers.add(t);
    return t;
  }

  every(fn, ms) {
    const t = setInterval(fn, ms);
    this._intervals.add(t);
    return t;
  }

  clear(t) {
    clearTimeout(t);
    clearInterval(t);
    this._timers.delete(t);
    this._intervals.delete(t);
  }

  loop(fn) {
    let last = performance.now();
    const step = (now) => {
      if (!this.mounted) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      fn(dt, now);
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  /** Subscribe to an emitter for as long as the view is mounted. */
  listen(emitter, evt, fn) {
    if (!this._offs) this._offs = [];
    this._offs.push(emitter.on(evt, fn));
  }
}
