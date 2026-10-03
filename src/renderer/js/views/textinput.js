/** A text field filled with the click wheel, keyboard or paste. */

import { View } from './view.js';
import { KeyStrip } from './keystrip.js';
import { h } from '../util.js';

export class TextInputView extends View {
  /**
   * @param {object} app
   * @param {object} o
   * @param {string} o.title
   * @param {string} [o.prompt]
   * @param {string} [o.value]
   * @param {'name'|'url'|'digits'} [o.keys]
   * @param {number} [o.max]
   * @param {(value: string) => (void|string|Promise<void|string>)} o.onDone  return a string to show an error
   */
  constructor(app, o) {
    super({ title: o.title });
    this.app = app;
    this.o = o;
    this.value = o.value || '';
    this.strip = new KeyStrip(o.keys || 'name', { upper: o.keys !== 'url' });
    this.busy = false;
  }

  get className() {
    return 'text-input-view';
  }

  render() {
    this.text = h('span', { class: 'ti-text' });
    this.caret = h('span', { class: 'sq-caret' });
    this.msg = h('div', { class: 'ti-msg', text: this.o.prompt || '' });
    this.field = h('div', { class: 'ti-field' }, this.text, this.caret);
    this.el.replaceChildren(this.msg, this.field, h('div', { class: 'ti-hint', text: 'Turn to pick · Select to type · Type or paste' }), this.strip.render());
    this.app.device._typing = true;
    this.paint();
    requestAnimationFrame(() => this.strip.paint());
  }

  onEnter() {
    this.app.device._typing = true;
  }

  onLeave() {
    this.app.device._typing = false;
  }

  onUnmount() {
    this.app.device._typing = false;
  }

  paint() {
    this.text.textContent = this.value;
    this.field.classList.toggle('empty', !this.value);
    this.field.scrollLeft = this.field.scrollWidth;
  }

  insert(s) {
    const max = this.o.max || 200;
    this.value = (this.value + s).slice(0, max);
    this.paint();
  }

  onScroll(dir) {
    this.strip.move(dir);
    return true;
  }

  onSelect() {
    const k = this.strip.key;
    if (k === 'DEL') this.value = this.value.slice(0, -1);
    else if (k === 'SHIFT') this.strip.toggleCase();
    else if (k === 'DONE') return this.done();
    else this.insert(k);
    this.paint();
  }

  onSelectHold() {
    this.value = '';
    this.paint();
  }

  onChar(key) {
    if (key === 'Backspace') this.value = this.value.slice(0, -1);
    else if (key === 'Enter') return this.done();
    else if (key.length === 1) this.insert(key);
    this.paint();
  }

  onPaste(text) {
    this.insert(String(text).replace(/[\r\n]+/g, ' ').trim());
  }

  onNext() {
    this.done();
    return true;
  }

  async done() {
    if (this.busy) return;
    const v = this.value.trim();
    if (!v && !this.o.allowEmpty) {
      this.msg.textContent = 'Type something first.';
      return;
    }
    this.busy = true;
    this.msg.textContent = this.o.working || 'Please wait…';
    try {
      const err = await this.o.onDone(v);
      if (typeof err === 'string') {
        this.msg.textContent = err;
        this.el.classList.remove('shake');
        void this.el.offsetWidth;
        this.el.classList.add('shake');
      } else if (this.os.current === this) this.os.pop();
    } catch (e) {
      this.msg.textContent = e.message || 'Something went wrong.';
    } finally {
      this.busy = false;
    }
  }
}

/** Convenience: push a text input and resolve with the value (or null if cancelled). */
export function askText(app, o) {
  return new Promise((resolve) => {
    let answered = false;
    const view = new TextInputView(app, {
      ...o,
      onDone: async (v) => {
        const err = o.validate ? await o.validate(v) : null;
        if (err) return err;
        answered = true;
        // Resolve after this field has closed, so the caller can open the next screen.
        setTimeout(() => resolve(v), 0);
        return undefined;
      },
    });
    const destroy = view.destroy.bind(view);
    view.destroy = () => {
      destroy();
      if (!answered) resolve(null);
    };
    app.os.push(view);
  });
}
