/** Klondike solitaire rules (no rendering). */

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const isRed = (c) => c.s === 1 || c.s === 2;

/** Cursor positions: stock, waste, 4 foundations, 7 tableau columns. */
export const SPOTS = [
  { type: 'stock', i: 0 },
  { type: 'waste', i: 0 },
  ...[0, 1, 2, 3].map((i) => ({ type: 'foundation', i })),
  ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ type: 'tableau', i })),
];

export class Klondike {
  constructor({ draw = 1, rand = Math.random } = {}) {
    this.drawCount = draw;
    this.rand = rand;
    this.deal();
  }

  deal() {
    const deck = [];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ s, r, up: false });
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    this.tableau = [[], [], [], [], [], [], []];
    for (let col = 0; col < 7; col++) {
      for (let k = 0; k <= col; k++) this.tableau[col].push(deck.pop());
      this.tableau[col][col].up = true;
    }
    this.stock = deck;
    this.waste = [];
    this.foundations = [[], [], [], []];
    this.score = 0;
    this.moves = 0;
    this.passes = 0;
  }

  pile(spot) {
    if (spot.type === 'stock') return this.stock;
    if (spot.type === 'waste') return this.waste;
    if (spot.type === 'foundation') return this.foundations[spot.i];
    return this.tableau[spot.i];
  }

  top(spot) {
    const p = this.pile(spot);
    return p[p.length - 1] || null;
  }

  canStack(card, col) {
    const t = col[col.length - 1];
    if (!t) return card.r === 13;
    return t.up && isRed(t) !== isRed(card) && card.r === t.r - 1;
  }

  canFound(card, f) {
    const t = f[f.length - 1];
    if (!t) return card.r === 1;
    return t.s === card.s && card.r === t.r + 1;
  }

  /** Turn over cards from the stock (or recycle the waste). */
  draw() {
    if (!this.stock.length) {
      if (!this.waste.length) return false;
      this.stock = this.waste.reverse().map((c) => ({ ...c, up: false }));
      this.waste = [];
      this.passes++;
      this.score = Math.max(0, this.score - (this.drawCount === 1 ? 100 : 20));
      return true;
    }
    for (let i = 0; i < this.drawCount && this.stock.length; i++) {
      const c = this.stock.pop();
      c.up = true;
      this.waste.push(c);
    }
    this.moves++;
    return true;
  }

  /** Cards you can lift from a spot: the top card, or a tableau column's face-up run. */
  liftable(spot) {
    const p = this.pile(spot);
    if (!p.length || spot.type === 'stock') return [];
    if (spot.type !== 'tableau') return [p[p.length - 1]];
    const first = p.findIndex((c) => c.up);
    return first < 0 ? [] : p.slice(first);
  }

  /** Try to move cards lifted from `from` onto `to`. Returns true on success. */
  move(from, to) {
    if (from.type === to.type && from.i === to.i) return false;
    const run = this.liftable(from);
    if (!run.length) return false;
    const src = this.pile(from);
    if (to.type === 'foundation') {
      const card = run[run.length - 1];
      if (!this.canFound(card, this.foundations[to.i])) return false;
      src.pop();
      this.foundations[to.i].push(card);
      this.score += from.type === 'foundation' ? 0 : 10;
    } else if (to.type === 'tableau') {
      const col = this.tableau[to.i];
      // Use the longest part of the run that fits.
      const k = run.findIndex((c) => this.canStack(c, col));
      if (k < 0) return false;
      const moving = src.splice(src.length - (run.length - k), run.length - k);
      col.push(...moving);
      if (from.type === 'waste') this.score += 5;
      if (from.type === 'foundation') this.score = Math.max(0, this.score - 15);
    } else return false;
    this._flip(from);
    this.moves++;
    return true;
  }

  _flip(spot) {
    if (spot.type !== 'tableau') return;
    const col = this.tableau[spot.i];
    const t = col[col.length - 1];
    if (t && !t.up) {
      t.up = true;
      this.score += 5;
    }
  }

  /** Move one card to a foundation if any can go (▶❚❚ / double press). */
  autoStep() {
    const sources = [{ type: 'waste', i: 0 }, ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ type: 'tableau', i }))];
    for (const from of sources) {
      const card = this.top(from);
      if (!card || !card.up) continue;
      for (let f = 0; f < 4; f++) {
        if (this.canFound(card, this.foundations[f])) {
          this.move(from, { type: 'foundation', i: f });
          return { from, to: { type: 'foundation', i: f }, card };
        }
      }
    }
    return null;
  }

  /** Best place for the lifted cards (used by "send to foundation" on a double press). */
  bestTarget(from) {
    const run = this.liftable(from);
    if (!run.length) return null;
    const card = run[run.length - 1];
    for (let f = 0; f < 4; f++) if (this.canFound(card, this.foundations[f])) return { type: 'foundation', i: f };
    return null;
  }

  get won() {
    return this.foundations.every((f) => f.length === 13);
  }
}
