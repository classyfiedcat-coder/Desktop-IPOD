/** Playlists you make on the iPod (stored with your settings). */

export class UserPlaylists {
  constructor(store, library) {
    this.store = store;
    this.library = library;
  }

  get all() {
    return this.store.user.playlists;
  }

  get(id) {
    return this.all.find((p) => p.id === id) || null;
  }

  tracks(pl) {
    return pl.trackIds.map((id) => this.library.get(id)).filter(Boolean);
  }

  _changed() {
    this.store.touchUser('playlists');
  }

  uniqueName(base = 'New Playlist') {
    const names = new Set(this.all.map((p) => p.name));
    if (!names.has(base)) return base;
    for (let i = 1; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  create(name, trackIds = []) {
    const pl = { id: `pl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name || this.uniqueName(), trackIds: trackIds.slice(), createdAt: Date.now() };
    this.all.push(pl);
    this._changed();
    return pl;
  }

  rename(id, name) {
    const pl = this.get(id);
    if (!pl || !name) return;
    pl.name = name;
    this._changed();
  }

  remove(id) {
    this.store.user.playlists = this.all.filter((p) => p.id !== id);
    this._changed();
  }

  add(id, trackIds) {
    const pl = this.get(id);
    if (!pl) return 0;
    pl.trackIds.push(...trackIds);
    this._changed();
    return trackIds.length;
  }

  removeAt(id, index) {
    const pl = this.get(id);
    if (!pl) return;
    pl.trackIds.splice(index, 1);
    this._changed();
  }

  move(id, from, to) {
    const pl = this.get(id);
    if (!pl || from === to || to < 0 || to >= pl.trackIds.length) return false;
    const [x] = pl.trackIds.splice(from, 1);
    pl.trackIds.splice(to, 0, x);
    this._changed();
    return true;
  }

  /** On-The-Go → "On-The-Go 1", like the 5th gen's "Save Playlist". */
  saveOnTheGo() {
    const otg = this.store.user.otg;
    if (!otg.length) return null;
    const names = new Set(this.all.map((p) => p.name));
    let i = 1;
    while (names.has(`On-The-Go ${i}`)) i++;
    const pl = this.create(`On-The-Go ${i}`, otg);
    this.store.user.otg = [];
    this._changed();
    return pl;
  }
}
