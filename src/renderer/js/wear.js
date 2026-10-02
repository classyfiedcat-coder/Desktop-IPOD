/**
 * Procedural surface wear for the polished steel back (and a trace of it on
 * the glossy front): micro-scratches, pocket swirls and smudges, the way a
 * real iPod picks them up after a few months in a pocket.
 *
 * Two textures come out, drawn from the same scratches so they line up:
 *  - mask:   white = clean mirror. Smudges and scratches are faded out, so
 *            reflections sliding underneath look broken up by them.
 *  - lines:  the scratches themselves as faint bright lines, which catch the
 *            light as the iPod turns.
 *
 * Deterministic (seeded), so the same iPod always has the same marks.
 */

const LEVELS = {
  none: null,
  light: { micro: 1500, scratches: 110, swirls: 5, smudges: 6, strength: 0.65 },
  worn: { micro: 4200, scratches: 380, swirls: 14, smudges: 12, strength: 1 },
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const cache = new Map();

/**
 * @param {object} o
 * @param {number} o.w width in px
 * @param {number} o.h height in px
 * @param {'none'|'light'|'worn'} o.level
 * @param {number} [o.seed]
 * @param {boolean} [o.dust] also scatter specks of dust (for the front)
 * @returns {{ mask: string, lines: string } | null} data URLs
 */
export function makeWear(o) {
  const c = wearCanvases(o);
  if (!c) return null;
  if (!c.urls) c.urls = { mask: c.mask.toDataURL('image/png'), lines: c.lines.toDataURL('image/png') };
  return c.urls;
}

/**
 * The same wear as canvases, plus a roughness map for the 3D body: clean
 * steel is mirror-smooth (dark), smudges are hazy and scratches rough (light).
 * @returns {{ mask: HTMLCanvasElement, lines: HTMLCanvasElement, rough: HTMLCanvasElement } | null}
 */
export function wearCanvases({ w, h, level = 'light', seed = 5, dust = false, scale: forceScale }) {
  const cfg = LEVELS[level];
  if (!cfg || typeof document === 'undefined') return null;
  const scale = forceScale || Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round(w * scale);
  const H = Math.round(h * scale);
  const key = `${W}x${H}:${level}:${seed}:${dust}`;
  if (cache.has(key)) return cache.get(key);

  const rand = rng(seed * 7919 + W);
  // Where hands and pockets rub: loose clusters, plus more toward the edges.
  const clusters = Array.from({ length: 8 }, () => ({ x: rand() * W, y: rand() * H, r: (0.12 + rand() * 0.3) * Math.max(W, H) }));
  const place = () => {
    const r = rand();
    if (r < 0.55) {
      const c = clusters[(rand() * clusters.length) | 0];
      const a = rand() * Math.PI * 2;
      const d = Math.pow(rand(), 0.8) * c.r;
      return [c.x + Math.cos(a) * d, c.y + Math.sin(a) * d];
    }
    if (r < 0.75) {
      // Near an edge.
      const side = (rand() * 4) | 0;
      const t = rand();
      const e = Math.pow(rand(), 2) * 0.12;
      return [[e * W, t * W, (1 - e) * W, t * W][side], [t * H, e * H, t * H, (1 - e) * H][side]];
    }
    return [rand() * W, rand() * H];
  };
  // Scratches have a grain: most run in a couple of directions (the way it
  // slides in and out of a pocket), the rest anywhere.
  const grain = [rand() * Math.PI, rand() * Math.PI];
  const angle = () => (rand() < 0.65 ? grain[(rand() * 2) | 0] + (rand() - 0.5) * 0.5 : rand() * Math.PI);
  const strokes = [];
  // Micro-scratches: tiny, straight, faint. Thousands of them make the scuffed sheen.
  for (let i = 0; i < cfg.micro; i++) {
    const [x, y] = place();
    strokes.push({ type: 'line', x, y, len: (1.2 + Math.pow(rand(), 1.6) * 6) * scale, ang: angle(), bend: (rand() - 0.5) * 0.08, width: (0.28 + rand() * 0.3) * scale, alpha: 0.12 + rand() * 0.4 });
  }
  // A smaller number of longer, deeper ones.
  for (let i = 0; i < cfg.scratches; i++) {
    const [x, y] = place();
    strokes.push({ type: 'line', x, y, len: (7 + Math.pow(rand(), 2) * 34) * scale, ang: angle(), bend: (rand() - 0.5) * 0.16, width: (0.35 + rand() * 0.45) * scale, alpha: 0.2 + rand() * 0.5 });
  }
  // Swirls: long, faint arcs from being rubbed against things.
  for (let i = 0; i < cfg.swirls; i++) {
    const cx = rand() * W;
    const cy = rand() * H;
    const r = (0.2 + rand() * 0.6) * Math.max(W, H);
    const a0 = rand() * Math.PI * 2;
    strokes.push({ type: 'arc', cx, cy, r, a0, a1: a0 + 0.15 + rand() * 0.5, width: (0.3 + rand() * 0.4) * scale, alpha: 0.18 + rand() * 0.25 });
  }
  const smudges = Array.from({ length: cfg.smudges }, () => ({
    x: rand() * W,
    y: rand() * H,
    rx: (0.06 + rand() * 0.14) * W,
    ry: (0.05 + rand() * 0.12) * H,
    a: rand() * Math.PI,
    alpha: 0.08 + rand() * 0.14,
  }));

  const draw = (ctx, color, k) => {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (const s of strokes) {
      ctx.globalAlpha = Math.min(1, s.alpha * k);
      ctx.lineWidth = s.width;
      ctx.beginPath();
      if (s.type === 'line') {
        const dx = Math.cos(s.ang) * s.len;
        const dy = Math.sin(s.ang) * s.len;
        ctx.moveTo(s.x - dx / 2, s.y - dy / 2);
        ctx.quadraticCurveTo(s.x - dy * s.bend, s.y + dx * s.bend, s.x + dx / 2, s.y + dy / 2);
      } else {
        ctx.arc(s.cx, s.cy, s.r, s.a0, s.a1);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  // Mask: opaque white, with smudges and scratches faded out.
  const m = document.createElement('canvas');
  m.width = W;
  m.height = H;
  const mc = m.getContext('2d');
  mc.fillStyle = '#fff';
  mc.fillRect(0, 0, W, H);
  mc.globalCompositeOperation = 'destination-out';
  for (const s of smudges) {
    mc.save();
    mc.translate(s.x, s.y);
    mc.rotate(s.a);
    mc.scale(1, s.ry / s.rx);
    const g = mc.createRadialGradient(0, 0, 0, 0, 0, s.rx);
    g.addColorStop(0, `rgba(0,0,0,${(s.alpha * cfg.strength * 3).toFixed(3)})`);
    g.addColorStop(0.6, `rgba(0,0,0,${(s.alpha * cfg.strength * 1.6).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    mc.fillStyle = g;
    mc.beginPath();
    mc.arc(0, 0, s.rx, 0, Math.PI * 2);
    mc.fill();
    mc.restore();
  }
  draw(mc, '#000', 0.55 * cfg.strength);

  // Lines: the scratches as faint light strokes on transparent.
  const l = document.createElement('canvas');
  l.width = W;
  l.height = H;
  const lc = l.getContext('2d');
  draw(lc, '#fff', cfg.strength);
  if (dust) {
    // Specks of dust and lint that sit on the plastic.
    lc.fillStyle = '#fff';
    const n = Math.round((W * H) / (900 * scale * scale)) * (level === 'worn' ? 2 : 1);
    for (let i = 0; i < n; i++) {
      lc.globalAlpha = 0.25 + rand() * 0.6;
      const r = (0.3 + Math.pow(rand(), 3) * 0.9) * scale;
      lc.beginPath();
      lc.arc(rand() * W, rand() * H, r, 0, Math.PI * 2);
      lc.fill();
    }
    lc.globalAlpha = 1;
  }

  // Roughness: dark = polished, light = rough.
  const g = document.createElement('canvas');
  g.width = W;
  g.height = H;
  const gc = g.getContext('2d');
  gc.fillStyle = '#1e1e1e';
  gc.fillRect(0, 0, W, H);
  for (const s of smudges) {
    gc.save();
    gc.translate(s.x, s.y);
    gc.rotate(s.a);
    gc.scale(1, s.ry / s.rx);
    const sg = gc.createRadialGradient(0, 0, 0, 0, 0, s.rx);
    sg.addColorStop(0, `rgba(90,90,90,${(s.alpha * cfg.strength * 2.4).toFixed(3)})`);
    sg.addColorStop(1, 'rgba(90,90,90,0)');
    gc.fillStyle = sg;
    gc.beginPath();
    gc.arc(0, 0, s.rx, 0, Math.PI * 2);
    gc.fill();
    gc.restore();
  }
  draw(gc, '#6e6e6e', cfg.strength * 0.8);

  const out = { mask: m, lines: l, rough: g };
  cache.set(key, out);
  if (cache.size > 6) cache.delete(cache.keys().next().value);
  return out;
}

export const WEAR_LEVELS = Object.keys(LEVELS);
