/**
 * Design your own iPod: pick a part, then dial in hue, saturation and
 * lightness with the click wheel. Changes show on the iPod as you turn.
 *   Select: next slider · ⏮ ⏭: previous/next part · ▶❚❚: presets
 */

import { View } from './view.js';
import { h, clamp, hexToHsl, hslToHex, luminance } from '../util.js';
import { showSheet } from './sheet.js';

const PARTS = [
  ['front', 'Case'],
  ['wheel', 'Wheel'],
  ['label', 'Labels'],
  ['center', 'Button'],
];
const SLIDERS = [
  ['h', 'Hue', 360],
  ['s', 'Saturation', 100],
  ['l', 'Lightness', 100],
];

export const COLOR_PRESETS = [
  ['Blue', { front: '#2f6fb3', wheel: '#eef1f4', label: '#8f9aa6', center: '#f6f7f8' }],
  ['Pink', { front: '#ee6fa8', wheel: '#f7f2f4', label: '#d16b96', center: '#faf6f8' }],
  ['Green', { front: '#57b55a', wheel: '#f1f5ef', label: '#7da77e', center: '#f7faf6' }],
  ['Purple', { front: '#7b58c3', wheel: '#f2f0f7', label: '#9b88c6', center: '#f8f7fb' }],
  ['Red', { front: '#c8102e', wheel: '#f5f5f5', label: '#a9a9a9', center: '#fafafa' }],
  ['Orange', { front: '#f28a2e', wheel: '#f8f4ef', label: '#d08a4d', center: '#fbf8f5' }],
  ['Gold', { front: '#d7b562', wheel: '#f4f0e6', label: '#b99748', center: '#f9f7f1' }],
  ['Mint', { front: '#9fd8c0', wheel: '#f2f8f5', label: '#6fae94', center: '#f8fbfa' }],
  ['Silver', { front: '#cfd1d4', wheel: '#f2f2f2', label: '#a0a3a7', center: '#d7d9dc' }],
  ['Space Gray', { front: '#46484c', wheel: '#2a2b2e', label: '#a7aab0', center: '#3b3d41' }],
  ['Midnight', { front: '#1b2a4a', wheel: '#2c3a59', label: '#c7d2e6', center: '#14203a' }],
  ['Inverted', { front: '#111111', wheel: '#f2f2f2', label: '#8a8a8a', center: '#111111' }],
];

export class ColorEditor extends View {
  constructor(app) {
    super({ title: 'Custom Colors' });
    this.app = app;
    this.part = 0;
    this.slider = 0;
  }

  get className() {
    return 'color-editor';
  }

  get colors() {
    return this.app.store.settings.customColors;
  }

  render() {
    if (this.app.store.settings.color !== 'custom') this.app.store.set('color', 'custom');
    this.tabs = PARTS.map(([, name]) => h('div', { class: 'ce-tab', text: name }));
    this.rows = SLIDERS.map(([, name]) => {
      const knob = h('div', { class: 'ce-knob' });
      const track = h('div', { class: 'ce-track' }, knob);
      const val = h('span', { class: 'ce-val' });
      const row = h('div', { class: 'ce-row' }, h('span', { class: 'ce-name', text: name }), track, val);
      return { row, track, knob, val };
    });
    this.swatch = h('div', { class: 'ce-swatch' });
    this.hex = h('div', { class: 'ce-hex' });
    this.el.replaceChildren(
      h('div', { class: 'ce-tabs' }, ...this.tabs),
      h('div', { class: 'ce-body' }, h('div', { class: 'ce-sliders' }, ...this.rows.map((r) => r.row)), h('div', { class: 'ce-preview' }, this.swatch, this.hex)),
      h('div', { class: 'ce-hint', text: 'Select: next · ⏮⏭: part · ▶❚❚: presets' })
    );
    this.paint();
  }

  hsl() {
    return hexToHsl(this.colors[PARTS[this.part][0]] || '#888888');
  }

  paint() {
    const hsl = this.hsl();
    this.tabs.forEach((t, i) => t.classList.toggle('on', i === this.part));
    this.rows.forEach((r, i) => {
      const [key, , max] = SLIDERS[i];
      r.row.classList.toggle('on', i === this.slider);
      r.knob.style.left = `${(hsl[key] / max) * 100}%`;
      r.val.textContent = String(hsl[key]);
      const g =
        key === 'h'
          ? 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)'
          : key === 's'
            ? `linear-gradient(90deg, ${hslToHex({ ...hsl, s: 0 })}, ${hslToHex({ ...hsl, s: 100 })})`
            : `linear-gradient(90deg, #000, ${hslToHex({ ...hsl, l: 50 })}, #fff)`;
      r.track.style.background = g;
    });
    const hex = this.colors[PARTS[this.part][0]];
    this.swatch.style.background = hex;
    this.hex.textContent = hex.toUpperCase();
  }

  _set(patch) {
    const colors = { ...this.colors, ...patch };
    colors.dark = luminance(colors.front) < 0.32;
    this.app.store.set('customColors', colors);
  }

  onScroll(dir, speed) {
    const [key, , max] = SLIDERS[this.slider];
    const hsl = this.hsl();
    const step = key === 'h' ? (speed > 20 ? 8 : 3) : speed > 20 ? 4 : 1;
    const next = key === 'h' ? (hsl.h + dir * step + 360) % 360 : clamp(hsl[key] + dir * step, 0, max);
    if (next === hsl[key]) return false;
    this._set({ [PARTS[this.part][0]]: hslToHex({ ...hsl, [key]: next }) });
    this.paint();
    return true;
  }

  onSelect() {
    this.slider = (this.slider + 1) % SLIDERS.length;
    this.paint();
  }

  onNext() {
    this.part = (this.part + 1) % PARTS.length;
    this.slider = 0;
    this.paint();
    return true;
  }

  onPrev() {
    this.part = (this.part + PARTS.length - 1) % PARTS.length;
    this.slider = 0;
    this.paint();
    return true;
  }

  onPlay() {
    showSheet(this.os, {
      title: 'Presets',
      items: COLOR_PRESETS.map(([name, c]) => ({
        label: name,
        action: () => {
          this._set(c);
          this.paint();
        },
      })),
    });
    return true;
  }
}
