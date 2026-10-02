/** Base class for the canvas games (320x240, crisp at any zoom). */

import { View } from '../view.js';
import { h } from '../../util.js';

export const W = 320;
export const H = 240;

export class CanvasGame extends View {
  constructor(app, title) {
    super({ title });
    this.app = app;
    this.paused = false;
    this.state = 'ready'; // ready | play | over
  }
  get fullscreen() {
    return true;
  }
  get keepAwake() {
    return this.state === 'play' && !this.paused;
  }
  get className() {
    return 'game-view';
  }
  get high() {
    return this.app.store.user.highScores[this.title] || 0;
  }
  saveHigh(score) {
    if (score > this.high) {
      this.app.store.user.highScores[this.title] = score;
      this.app.store.touchUser();
      return true;
    }
    return false;
  }
  render() {
    const scale = (window.devicePixelRatio || 1) * (this.app.device.zoom || 1);
    this.canvas = h('canvas', { width: Math.round(W * scale), height: Math.round(H * scale), class: 'game-canvas' });
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.el.replaceChildren(this.canvas);
    this.loop((dt) => {
      if (this.shouldUpdate()) this.update(dt);
      this.draw(this.ctx);
    });
  }
  shouldUpdate() {
    return this.state === 'play' && !this.paused;
  }
  onLeave() {
    this.paused = true;
  }
  onPlay() {
    if (this.state === 'play') this.paused = !this.paused;
    return true;
  }
  onNext() {
    return true;
  }
  onPrev() {
    return true;
  }
  text(ctx, str, x, y, { size = 14, weight = 700, color = '#fff', align = 'center' } = {}) {
    ctx.font = `${weight} ${size}px 'iPod Sans', Arial, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }
  overlay(ctx, title, lines) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    this.text(ctx, title, W / 2, H / 2 - 26, { size: 22 });
    lines.forEach((l, i) => this.text(ctx, l, W / 2, H / 2 + 6 + i * 18, { size: 13, weight: 600, color: '#d6dbe0' }));
  }
}

