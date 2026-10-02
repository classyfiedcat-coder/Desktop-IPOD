/** Games from the iPod: Brick, Parachute and Music Quiz. */

import { View } from '../view.js';
import { ListView } from '../list.js';
import { h, clamp, shuffled } from '../../util.js';
import { blip } from '../../sound.js';
import { SolitaireGame } from './solitaire.js';
import { CanvasGame, W, H } from './canvas-game.js';


export function gamesMenu(app) {
  return new ListView({
    title: 'Games',
    items: [
      { label: 'Brick', view: () => new BrickGame(app) },
      { label: 'Music Quiz', view: () => new MusicQuiz(app) },
      { label: 'Parachute', view: () => new ParachuteGame(app) },
      { label: 'Solitaire', view: () => new SolitaireGame(app) },
    ],
  });
}

// ------------------------------------------------------------------ Brick --

const BRICK_COLORS = ['#ff4d4d', '#ff9a2e', '#ffd93b', '#5fd35f', '#3fa7ff', '#a77bff'];

class BrickGame extends CanvasGame {
  constructor(app) {
    super(app, 'Brick');
    this.reset(true);
  }
  reset(full) {
    if (full) {
      this.score = 0;
      this.lives = 3;
      this.level = 1;
    }
    this.paddle = { x: W / 2, target: W / 2, w: 52 };
    this.ball = { x: W / 2, y: H - 34, vx: 0, vy: 0, r: 4, stuck: true };
    if (full || !this.bricks || !this.bricks.some((b) => b.alive)) this.buildBricks();
  }
  buildBricks() {
    this.bricks = [];
    const cols = 10;
    const bw = 28;
    const bh = 10;
    const gap = 2;
    const left = (W - cols * (bw + gap) + gap) / 2;
    const rows = Math.min(6, 3 + this.level);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        this.bricks.push({ x: left + c * (bw + gap), y: 30 + r * (bh + gap), w: bw, h: bh, color: BRICK_COLORS[r % BRICK_COLORS.length], pts: (rows - r) * 10, alive: true });
  }
  launch() {
    const speed = 170 + this.level * 18;
    const a = (-Math.PI / 2) + (Math.random() - 0.5) * 0.8;
    this.ball.vx = Math.cos(a) * speed;
    this.ball.vy = Math.sin(a) * speed;
    this.ball.stuck = false;
  }
  onScroll(dir) {
    if (this.paused) return false;
    const p = this.paddle;
    const before = p.target;
    p.target = clamp(p.target + dir * 14, p.w / 2, W - p.w / 2);
    return p.target !== before;
  }
  onSelect() {
    if (this.state === 'ready' || this.state === 'over') {
      if (this.state === 'over') this.reset(true);
      this.state = 'play';
      this.paused = false;
      this.launch();
      return;
    }
    if (this.paused) this.paused = false;
    else if (this.ball.stuck) this.launch();
  }
  update(dt) {
    const p = this.paddle;
    p.x += (p.target - p.x) * Math.min(1, dt * 18);
    const b = this.ball;
    if (b.stuck) {
      b.x = p.x;
      b.y = H - 34;
      return;
    }
    const steps = Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 3);
    for (let i = 0; i < steps; i++) this.step(dt / steps);
  }
  step(dt) {
    const b = this.ball;
    const p = this.paddle;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < b.r) {
      b.x = b.r;
      b.vx = Math.abs(b.vx);
      blip(520, 0.03);
    }
    if (b.x > W - b.r) {
      b.x = W - b.r;
      b.vx = -Math.abs(b.vx);
      blip(520, 0.03);
    }
    if (b.y < 18 + b.r) {
      b.y = 18 + b.r;
      b.vy = Math.abs(b.vy);
      blip(520, 0.03);
    }
    // paddle
    const py = H - 26;
    if (b.vy > 0 && b.y + b.r >= py && b.y + b.r <= py + 8 && Math.abs(b.x - p.x) <= p.w / 2 + b.r) {
      const hit = (b.x - p.x) / (p.w / 2);
      const speed = Math.hypot(b.vx, b.vy) * 1.01;
      const a = -Math.PI / 2 + hit * 1.05;
      b.vx = Math.cos(a) * speed;
      b.vy = Math.sin(a) * speed;
      b.y = py - b.r;
      blip(660, 0.04);
    }
    // bricks
    for (const br of this.bricks) {
      if (!br.alive) continue;
      if (b.x + b.r < br.x || b.x - b.r > br.x + br.w || b.y + b.r < br.y || b.y - b.r > br.y + br.h) continue;
      br.alive = false;
      this.score += br.pts;
      const overlapX = Math.min(b.x + b.r - br.x, br.x + br.w - (b.x - b.r));
      const overlapY = Math.min(b.y + b.r - br.y, br.y + br.h - (b.y - b.r));
      if (overlapX < overlapY) b.vx = -b.vx;
      else b.vy = -b.vy;
      blip(880 + Math.random() * 120, 0.05);
      break;
    }
    if (!this.bricks.some((x) => x.alive)) {
      this.level++;
      this.buildBricks();
      this.reset(false);
      blip(1320, 0.15, 'triangle', 0.1);
    }
    if (b.y > H + 10) {
      this.lives--;
      blip(180, 0.25, 'sawtooth', 0.08);
      if (this.lives <= 0) {
        this.state = 'over';
        this.newHigh = this.saveHigh(this.score);
      } else this.reset(false);
    }
  }
  draw(ctx) {
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1626');
    g.addColorStop(1, '#03050a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    this.text(ctx, `Score ${this.score}`, 8, 10, { size: 12, align: 'left' });
    this.text(ctx, `Level ${this.level}`, W / 2, 10, { size: 12 });
    this.text(ctx, '●'.repeat(Math.max(0, this.lives)), W - 8, 10, { size: 10, align: 'right', color: '#ff6b6b' });
    for (const br of this.bricks) {
      if (!br.alive) continue;
      ctx.fillStyle = br.color;
      ctx.fillRect(br.x, br.y, br.w, br.h);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(br.x, br.y, br.w, 2);
    }
    const p = this.paddle;
    const pg = ctx.createLinearGradient(0, H - 26, 0, H - 19);
    pg.addColorStop(0, '#f2f5f8');
    pg.addColorStop(1, '#8b97a3');
    ctx.fillStyle = pg;
    ctx.fillRect(p.x - p.w / 2, H - 26, p.w, 7);
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, this.ball.r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    if (this.state === 'ready') this.overlay(ctx, 'Brick', ['Turn the wheel to move', 'Select to start', `High score ${this.high}`]);
    else if (this.state === 'over') this.overlay(ctx, 'Game Over', [`Score ${this.score}${this.newHigh ? ' — new high score!' : ''}`, `High score ${this.high}`, 'Select to play again']);
    else if (this.paused) this.overlay(ctx, 'Paused', ['Press ▶❚❚ or Select to resume']);
  }
}

// -------------------------------------------------------------- Parachute --

class ParachuteGame extends CanvasGame {
  constructor(app) {
    super(app, 'Parachute');
    this.reset();
  }
  reset() {
    this.score = 0;
    this.angle = 0;
    this.bullets = [];
    this.copters = [];
    this.troopers = [];
    this.debris = [];
    this.landed = 0;
    this.time = 0;
    this.spawn = 1.2;
  }
  onScroll(dir) {
    if (this.paused) return false;
    const before = this.angle;
    this.angle = clamp(this.angle + dir * 7, -84, 84);
    return this.angle !== before;
  }
  onSelect() {
    if (this.state !== 'play') {
      if (this.state === 'over') this.reset();
      this.state = 'play';
      this.paused = false;
      return;
    }
    if (this.paused) {
      this.paused = false;
      return;
    }
    if (this.bullets.length >= 4) return;
    const a = ((this.angle - 90) * Math.PI) / 180;
    const sx = W / 2 + Math.cos(a) * 18;
    const sy = H - 22 + Math.sin(a) * 18;
    this.bullets.push({ x: sx, y: sy, vx: Math.cos(a) * 280, vy: Math.sin(a) * 280 });
    this.score = Math.max(0, this.score - 1);
    blip(1200, 0.03, 'square', 0.05);
  }
  update(dt) {
    this.time += dt;
    this.spawn -= dt;
    if (this.spawn <= 0) {
      const ltr = Math.random() < 0.5;
      this.copters.push({ x: ltr ? -30 : W + 30, y: 26 + Math.random() * 40, vx: (ltr ? 1 : -1) * (55 + Math.random() * 30 + this.time * 0.6), drop: 0.6 + Math.random() * 1.6 });
      this.spawn = Math.max(0.55, 2.1 - this.time * 0.015);
    }
    for (const c of this.copters) {
      c.x += c.vx * dt;
      c.drop -= dt;
      if (c.drop <= 0 && c.x > 20 && c.x < W - 20 && Math.abs(c.x - W / 2) > 22) {
        this.troopers.push({ x: c.x, y: c.y + 8, vy: 34, chute: true, alive: true });
        c.drop = 1.4 + Math.random() * 2.5;
      }
    }
    this.copters = this.copters.filter((c) => c.x > -40 && c.x < W + 40 && !c.dead);
    for (const t of this.troopers) {
      t.y += (t.chute ? t.vy : 160) * dt;
      if (t.y >= H - 12) {
        if (t.chute) {
          this.landed++;
          blip(220, 0.2, 'triangle', 0.08);
        } else this.score += 3;
        t.alive = false;
        if (this.landed >= 5) {
          this.state = 'over';
          this.newHigh = this.saveHigh(this.score);
        }
      }
    }
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      for (const c of this.copters) {
        if (!c.dead && Math.abs(b.x - c.x) < 14 && Math.abs(b.y - c.y) < 7) {
          c.dead = true;
          b.hit = true;
          this.score += 10;
          this.burst(c.x, c.y, '#ffb347');
          blip(140, 0.2, 'sawtooth', 0.09);
        }
      }
      for (const t of this.troopers) {
        if (!t.alive) continue;
        if (t.chute && Math.abs(b.x - t.x) < 8 && b.y > t.y - 16 && b.y < t.y - 6) {
          t.chute = false;
          b.hit = true;
          this.score += 2;
          blip(700, 0.06);
        } else if (Math.abs(b.x - t.x) < 4 && Math.abs(b.y - t.y) < 5) {
          t.alive = false;
          b.hit = true;
          this.score += 5;
          this.burst(t.x, t.y, '#ff6b6b');
          blip(400, 0.08);
        }
      }
    }
    this.bullets = this.bullets.filter((b) => !b.hit && b.x > 0 && b.x < W && b.y > 0);
    this.troopers = this.troopers.filter((t) => t.alive);
    for (const d of this.debris) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.vy += 200 * dt;
      d.life -= dt;
    }
    this.debris = this.debris.filter((d) => d.life > 0);
  }
  burst(x, y, color) {
    for (let i = 0; i < 10; i++) this.debris.push({ x, y, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 90, life: 0.7, color });
  }
  draw(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#5fa8ea');
    g.addColorStop(1, '#cfe7fb');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#5b8c3a';
    ctx.fillRect(0, H - 12, W, 12);
    this.text(ctx, `Score ${this.score}`, 8, 10, { size: 12, align: 'left', color: '#0b2540' });
    this.text(ctx, `Landed ${this.landed}/5`, W - 8, 10, { size: 12, align: 'right', color: '#0b2540' });
    for (const c of this.copters) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(c.vx > 0 ? 1 : -1, 1);
      ctx.fillStyle = '#2b3a4a';
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-20, -1.5, 10, 3);
      ctx.fillRect(-14, -9, 28, 1.5);
      ctx.fillRect(-1, -9, 2, 4);
      ctx.fillStyle = '#9fd3ff';
      ctx.fillRect(4, -3, 5, 3);
      ctx.restore();
    }
    for (const t of this.troopers) {
      if (t.chute) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(t.x, t.y - 11, 7, Math.PI, 0);
        ctx.fill();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(t.x - 7, t.y - 11);
        ctx.lineTo(t.x, t.y - 2);
        ctx.lineTo(t.x + 7, t.y - 11);
        ctx.stroke();
      }
      ctx.fillStyle = '#1d2a36';
      ctx.fillRect(t.x - 1.5, t.y - 3, 3, 6);
      ctx.beginPath();
      ctx.arc(t.x, t.y - 4.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const d of this.debris) {
      ctx.fillStyle = d.color;
      ctx.fillRect(d.x, d.y, 2, 2);
    }
    ctx.fillStyle = '#ffe14d';
    for (const b of this.bullets) ctx.fillRect(b.x - 1, b.y - 1, 2.5, 2.5);
    // turret
    ctx.save();
    ctx.translate(W / 2, H - 22);
    ctx.rotate((this.angle * Math.PI) / 180);
    ctx.fillStyle = '#3c4650';
    ctx.fillRect(-2, -18, 4, 16);
    ctx.restore();
    ctx.fillStyle = '#4b5763';
    ctx.beginPath();
    ctx.arc(W / 2, H - 14, 10, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(W / 2 - 14, H - 14, 28, 4);
    if (this.state === 'ready') this.overlay(ctx, 'Parachute', ['Turn the wheel to aim', 'Select to fire', `High score ${this.high}`]);
    else if (this.state === 'over') this.overlay(ctx, 'Game Over', [`Score ${this.score}${this.newHigh ? ' — new high score!' : ''}`, `High score ${this.high}`, 'Select to play again']);
    else if (this.paused) this.overlay(ctx, 'Paused', ['Press ▶❚❚ or Select to resume']);
  }
}

// ------------------------------------------------------------- Music Quiz --

class MusicQuiz extends View {
  constructor(app) {
    super({ title: 'Music Quiz' });
    this.app = app;
    this.round = 0;
    this.score = 0;
    this.rounds = 10;
    this.state = 'ready';
  }
  get className() {
    return 'quiz-view';
  }
  get keepAwake() {
    return this.state === 'question';
  }
  render() {
    this.head = h('div', { class: 'qz-head' });
    this.timer = h('div', { class: 'qz-timer' }, h('div', { class: 'qz-timer-fill' }));
    this.listEl = h('div', { class: 'qz-list' });
    this.msg = h('div', { class: 'qz-msg' });
    this.el.replaceChildren(this.head, this.timer, this.listEl, this.msg);
    this.list = new ListView({ title: 'Quiz', rows: 5, items: [] });
    this.list.mount(this.listEl, this.os);
    this.audio = this.audio || new Audio();
    this.audio.volume = this.app.player.effectiveVolume;
    this.paint();
    this.loop(() => this.tick());
  }
  onUnmount() {
    if (this.list && this.list.mounted) this.list.unmount();
    if (this.audio) this.audio.pause();
  }
  get pool() {
    return this.app.library.music.filter((t) => t.duration > 20 || !t.duration);
  }
  paint() {
    if (this.state === 'ready') {
      const enough = this.pool.length >= 5;
      this.head.textContent = 'Music Quiz';
      this.msg.textContent = enough ? `Name the song as fast as you can. ${this.rounds} rounds.\nSelect to start · High score ${this.app.store.user.highScores['Music Quiz'] || 0}` : 'Add at least 5 songs to your library to play Music Quiz.';
      this.el.dataset.state = 'ready';
    } else if (this.state === 'done') {
      this.head.textContent = 'Final Score';
      this.msg.textContent = `${this.score} points${this.newHigh ? '\nNew high score!' : ''}\nSelect to play again`;
      this.el.dataset.state = 'done';
    } else {
      this.el.dataset.state = this.state;
      this.head.textContent = `Round ${this.round} of ${this.rounds} · ${this.score} pts`;
    }
  }
  start() {
    if (this.pool.length < 5) return;
    this.app.player.pause();
    this.round = 0;
    this.score = 0;
    this.newHigh = false;
    this.next();
  }
  next() {
    if (this.round >= this.rounds) {
      this.state = 'done';
      this.audio.pause();
      const hs = this.app.store.user.highScores;
      if (this.score > (hs['Music Quiz'] || 0)) {
        hs['Music Quiz'] = this.score;
        this.app.store.touchUser();
        this.newHigh = true;
      }
      this.paint();
      return;
    }
    this.round++;
    const pool = shuffled(this.pool);
    const answer = pool[0];
    const choices = shuffled([answer, ...pool.slice(1).filter((t) => t.title !== answer.title).slice(0, 4)]);
    this.answer = answer;
    this.state = 'question';
    this.started = performance.now();
    this.list.setItems(
      choices.map((t) => ({
        label: t.title,
        arrow: false,
        action: () => this.choose(t),
      })),
      false
    );
    this.audio.src = answer.src;
    this.audio.addEventListener(
      'loadedmetadata',
      () => {
        const d = this.audio.duration || 60;
        this.audio.currentTime = d * (0.2 + Math.random() * 0.4);
      },
      { once: true }
    );
    this.audio.play().catch(() => {});
    this.paint();
  }
  choose(t) {
    if (this.state !== 'question') return;
    const right = t === this.answer;
    const elapsed = (performance.now() - this.started) / 1000;
    const pts = right ? Math.max(1, Math.round(10 - elapsed)) : 0;
    this.score += pts;
    this.state = 'reveal';
    this.list.setItems(
      this.list.items.map((it) => ({ ...it, label: `${it.label === this.answer.title ? '✓ ' : it.label === t.title ? '✗ ' : ''}${it.label}`, action: undefined })),
      true
    );
    this.head.textContent = right ? `Correct! +${pts}` : `It was “${this.answer.title}”`;
    blip(right ? 1320 : 200, right ? 0.12 : 0.25, right ? 'triangle' : 'sawtooth', 0.08);
    this.later(() => this.next(), 1600);
  }
  tick() {
    const fill = this.timer.firstChild;
    if (this.state === 'question') {
      const left = clamp(1 - (performance.now() - this.started) / 10000, 0, 1);
      fill.style.width = `${left * 100}%`;
      if (left === 0) this.choose(null);
    } else if (this.state !== 'reveal') fill.style.width = '0%';
  }
  onScroll(dir, speed) {
    if (this.state !== 'question') return false;
    return this.list.onScroll(dir, speed);
  }
  onSelect() {
    if (this.state === 'ready' || this.state === 'done') this.start();
    else if (this.state === 'question') this.list.onSelect();
  }
  onPlay() {
    return true;
  }
  onNext() {
    return true;
  }
  onPrev() {
    return true;
  }
}
