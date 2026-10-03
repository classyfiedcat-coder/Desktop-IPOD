/** Installs a downloaded update at a quiet moment (nothing playing, untouched for minutes), then reopens. Off: on quit. */

/** How long the iPod has to be left alone before it restarts to update. */
export const QUIET_FOR = 3 * 60 * 1000;
/** How often to look for a quiet moment while an update is waiting. */
const LOOK_EVERY = 30 * 1000;
/** The "Updating…" message is on screen this long before the app closes. */
const NOTICE = 1500;

export class AutoUpdate {
  /**
   * @param {object} o
   * @param {{ settings: object, flush: () => void }} o.store
   * @param {{ playing: boolean }} o.player
   * @param {{ lastActivity?: number, alert: (msg: string, ms: number) => void }} o.os
   * @param {{ status: () => Promise<object>, onStatus: (cb: (s: object) => void) => void, install: () => void }} o.updates
   * @param {() => boolean} [o.busy] something else that a restart would interrupt
   * @param {() => number} [o.now]
   */
  constructor({ store, player, os, updates, busy = () => false, now = () => Date.now() }) {
    Object.assign(this, { store, player, os, updates, busy, now });
    this.ready = null;
    this.installing = false;
    this.started = now();
  }

  start() {
    this.updates.onStatus((s) => this.status(s));
    this.updates
      .status()
      .then((s) => this.status(s))
      .catch(() => {});
    this._timer = setInterval(() => this.tick(), LOOK_EVERY);
  }

  status(s) {
    this.ready = s && s.state === 'ready' ? s : null;
    this.tick();
  }

  /** Is now a good time? Nothing playing, and nobody has touched it for a while. */
  quiet() {
    if (this.player.playing || this.busy()) return false;
    const last = Math.max(this.os.lastActivity || 0, this.started);
    return this.now() - last >= QUIET_FOR;
  }

  /** Install if there's an update waiting and it's a good time. Returns true if it started. */
  tick() {
    if (!this.ready || this.installing || this.store.settings.autoUpdate === false || !this.quiet()) return false;
    this.installing = true;
    this.os.alert(`Updating to ${this.ready.version}…`, NOTICE + 1000);
    this.store.flush();
    setTimeout(() => this.updates.install(), NOTICE);
    return true;
  }
}

/** After an update: say so once, on the first start of the new version. */
export function announceUpdate({ store, os }) {
  const v = store.env.version;
  const last = store.settings.lastVersion;
  if (last === v) return false;
  store.set('lastVersion', v);
  if (!last) return false; // first run, or the first version that remembers
  os.alert(`Updated to ${v}`, 2400);
  return true;
}
