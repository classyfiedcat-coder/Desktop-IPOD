/**
 * Solitaire (Klondike), played with the click wheel: turn to move the hand,
 * Select to pick up or put down, ▶❚❚ to send cards to the foundations,
 * Menu to cancel. Win and the cards bounce off the screen.
 */

import { CanvasGame } from './canvas-game.js';
import { Klondike, SPOTS, SUITS, RANKS, isRed } from './klondike.js';
import { blip } from '../../sound.js';

const W = 320;
const H = 240;
const CW = 38;
const CH = 52;
const GAP = (W - CW * 7) / 8;
const TOP = 6;
const ROW2 = TOP + CH + 10;
const colX = (i) => GAP + i * (CW + GAP);

export class SolitaireGame extends CanvasGame {
  constructor(app) {
    super(app, 'Solitaire');
    this.game = new Klondike({ draw: 1 });
    this.cursor = 1;
    this.held = null;
    this.state = 'play';
    this.cascade = null;
    this.shake = 0;
  }

  get keepAwake() {
    return true;
  }

  shouldUpdate() {
    return true;
  }

  spotXY(idx) {
    const sp = SPOTS[idx];
    if (sp.type === 'stock') return { x: colX(0), y: TOP };
    if (sp.type === 'waste') return { x: colX(1), y: TOP };
    if (sp.type === 'foundation') return { x: colX(3 + sp.i), y: TOP };
    const col = this.game.tableau[sp.i];
    const ys = this.columnYs(col);
    return { x: colX(sp.i), y: ys.length ? ys[ys.length - 1] : ROW2 };
  }

  columnYs(col) {
    const ys = [];
    let y = ROW2;
    const faceUp = col.filter((c) => c.up).length;
    const room = H - ROW2 - CH - 4;
    const downGap = 5;
    const upGap = Math.max(7, Math.min(14, (room - (col.length - faceUp) * downGap) / Math.max(1, faceUp - 1)));
    for (const c of col) {
      ys.push(y);
      y += c.up ? upGap : downGap;
    }
    return ys;
  }

  onScroll(dir) {
    if (this.state !== 'play') return false;
    this.cursor = (this.cursor + dir + SPOTS.length) % SPOTS.length;
    return true;
  }

  onSelect() {
    if (this.state === 'won') return this.restart();
    const g = this.game;
    const spot = SPOTS[this.cursor];
    if (this.held) {
      if (this.held.from === this.cursor) {
        // Same spot twice: send to a foundation if it fits.
        const to = g.bestTarget(spot);
        this.held = null;
        if (to && g.move(spot, to)) return this.after(true);
        return;
      }
      const ok = g.move(SPOTS[this.held.from], spot);
      this.held = null;
      this.after(ok);
      return;
    }
    if (spot.type === 'stock') {
      if (g.draw()) blip(520, 0.03, 'triangle', 0.05);
      return;
    }
    const run = g.liftable(spot);
    if (run.length) {
      this.held = { from: this.cursor, count: run.length };
      blip(760, 0.03, 'triangle', 0.05);
    }
  }

  after(ok) {
    if (ok) blip(990, 0.04, 'triangle', 0.06);
    else {
      this.shake = 1;
      blip(180, 0.12, 'sawtooth', 0.05);
    }
    if (this.game.won) this.win();
  }

  onPlay() {
    if (this.state !== 'play') return true;
    this.held = null;
    let moved = 0;
    const step = () => {
      const m = this.game.autoStep();
      if (m) {
        moved++;
        blip(880 + moved * 20, 0.03, 'triangle', 0.05);
        if (this.game.won) return this.win();
        this.later(step, 90);
      }
    };
    step();
    return true;
  }

  onMenu() {
    if (this.held) {
      this.held = null;
      return true;
    }
    return false;
  }

  onSelectHold() {
    this.restart();
  }

  restart() {
    this.game = new Klondike({ draw: 1 });
    this.cursor = 1;
    this.held = null;
    this.state = 'play';
    this.cascade = null;
    this._bgDrawn = false;
  }

  win() {
    this.state = 'won';
    this.saveHigh(this.game.score);
    // Windows-style bouncing cards, starting from each foundation.
    const cards = [];
    for (let r = 13; r >= 1; r--) for (let f = 0; f < 4; f++) cards.push({ card: this.game.foundations[f][r - 1], x: colX(3 + f), y: TOP });
    this.cascade = { cards, i: 0, cur: null };
  }

  update(dt) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 4);
    const cs = this.cascade;
    if (!cs) return;
    if (!cs.cur && cs.i < cs.cards.length) {
      const c = cs.cards[cs.i++];
      cs.cur = { ...c, vx: (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 90), vy: -Math.random() * 60 };
    }
    const k = cs.cur;
    if (!k) return;
    k.vy += 520 * dt;
    k.x += k.vx * dt;
    k.y += k.vy * dt;
    if (k.y > H - CH) {
      k.y = H - CH;
      k.vy *= -0.72;
    }
    if (k.x < -CW || k.x > W) cs.cur = null;
  }

  draw(ctx) {
    if (this.state === 'won' && this.cascade) {
      // Don't clear: the trails are the point.
      if (!this._bgDrawn) {
        this._paintTable(ctx);
        this._bgDrawn = true;
      }
      if (this.cascade.cur) this.card(ctx, this.cascade.cur.card, this.cascade.cur.x, this.cascade.cur.y);
      if (this.cascade.i >= this.cascade.cards.length && !this.cascade.cur) {
        this.text(ctx, 'You Win!', W / 2, H / 2 - 10, { size: 26 });
        this.text(ctx, `Score ${this.game.score} · Select to deal again`, W / 2, H / 2 + 18, { size: 12, weight: 600 });
      }
      return;
    }
    this._paintTable(ctx);
  }

  _paintTable(ctx) {
    const g = this.game;
    const bg = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, 260);
    bg.addColorStop(0, '#1d8a4a');
    bg.addColorStop(1, '#0c4f29');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // stock & waste
    if (g.stock.length) this.back(ctx, colX(0), TOP);
    else this.slot(ctx, colX(0), TOP, '↻');
    const w = g.waste[g.waste.length - 1];
    if (w && !this._isHeld('waste', 0, 0)) this.card(ctx, w, colX(1), TOP);
    else if (g.waste.length > 1) this.card(ctx, g.waste[g.waste.length - 2], colX(1), TOP);
    else this.slot(ctx, colX(1), TOP);
    // foundations
    g.foundations.forEach((f, i) => {
      const t = f[f.length - (this._isHeld('foundation', i, 0) ? 2 : 1)];
      if (t) this.card(ctx, t, colX(3 + i), TOP);
      else this.slot(ctx, colX(3 + i), TOP, SUITS[i]);
    });
    // tableau
    g.tableau.forEach((col, i) => {
      const ys = this.columnYs(col);
      if (!col.length) this.slot(ctx, colX(i), ROW2, 'K');
      const heldFrom = this.held && SPOTS[this.held.from].type === 'tableau' && SPOTS[this.held.from].i === i ? col.length - this.held.count : col.length;
      col.forEach((c, k) => {
        if (k >= heldFrom) return;
        if (c.up) this.card(ctx, c, colX(i), ys[k]);
        else this.back(ctx, colX(i), ys[k]);
      });
    });
    // hand cursor (+ lifted cards)
    const p = this.spotXY(this.cursor);
    const jitter = this.shake ? Math.sin(this.shake * 30) * 3 * this.shake : 0;
    if (this.held) {
      const from = SPOTS[this.held.from];
      const run = g.liftable(from).slice(-this.held.count);
      run.forEach((c, k) => this.card(ctx, c, p.x + 6 + jitter, p.y + 10 + k * 12, true));
    }
    this.hand(ctx, p.x + CW / 2 + jitter, p.y + CH - 8);
    this.text(ctx, `${g.score}`, W - 6, H - 8, { size: 10, align: 'right', color: 'rgba(255,255,255,0.7)' });
  }

  _isHeld(type, i) {
    if (!this.held) return false;
    const sp = SPOTS[this.held.from];
    return sp.type === type && sp.i === i;
  }

  round(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  card(ctx, c, x, y, lifted = false) {
    if (lifted) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      this.round(ctx, x + 2, y + 3, CW, CH, 4);
      ctx.fill();
    }
    ctx.fillStyle = '#fdfdfb';
    this.round(ctx, x, y, CW, CH, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    const color = isRed(c) ? '#d4202c' : '#111';
    this.text(ctx, RANKS[c.r], x + 3, y + 8, { size: 10, align: 'left', color });
    this.text(ctx, SUITS[c.s], x + 3, y + 18, { size: 9, align: 'left', color });
    this.text(ctx, SUITS[c.s], x + CW / 2, y + CH / 2 + 6, { size: 20, color });
  }

  back(ctx, x, y) {
    const g = ctx.createLinearGradient(x, y, x + CW, y + CH);
    g.addColorStop(0, '#3a6fd8');
    g.addColorStop(1, '#1d3f93');
    ctx.fillStyle = g;
    this.round(ctx, x, y, CW, CH, 4);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    this.round(ctx, x + 2.5, y + 2.5, CW - 5, CH - 5, 3);
    ctx.stroke();
  }

  slot(ctx, x, y, label = '') {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    this.round(ctx, x + 0.5, y + 0.5, CW - 1, CH - 1, 4);
    ctx.stroke();
    if (label) this.text(ctx, label, x + CW / 2, y + CH / 2, { size: 16, color: 'rgba(255,255,255,0.35)' });
  }

  hand(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-6, 12);
    ctx.lineTo(-1.5, 10.5);
    ctx.lineTo(1, 17);
    ctx.lineTo(4, 16);
    ctx.lineTo(1.6, 9.6);
    ctx.lineTo(7, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
