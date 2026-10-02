/**
 * Device definition. For now there is a single device — the iPod 5th
 * generation (video) — but the renderer is data-driven so more models can be
 * added here later as device themes.
 *
 * Geometry is in millimetres, measured from the real device, and is converted
 * to pixels by the device renderer.
 */

export const MODELS = [
  {
    id: 'video',
    name: 'iPod',
    era: '5th generation (video)',
    size: [61.8, 103.5],
    radius: 7.4,
    hold: 'top-left',
    screen: {
      x: 4.6,
      y: 7.2,
      w: 52.6,
      h: 41.6,
      inset: [1.5, 1.3],
      radius: 1.8,
      res: [320, 240],
      ui: { title: 22, rows: 9, fs: 16 },
    },
    wheel: { cy: 77.6, d: 38.6, center: 14.8 },
    colors: [
      {
        id: 'white',
        name: 'White',
        front: '#fbfbfb',
        wheel: '#ececec',
        label: '#bdbdbd',
        center: '#fbfbfb',
        bezel: '#1b1c1d',
      },
      {
        id: 'black',
        name: 'Black',
        front: '#121212',
        wheel: '#3a3a3b',
        label: '#e4e4e4',
        center: '#070707',
        bezel: '#050505',
        dark: true,
      },
    ],
  },
];

export const SIZES = [
  { id: 'small', name: 'Small', scale: 0.8 },
  { id: 'medium', name: 'Medium', scale: 1 },
  { id: 'large', name: 'Large', scale: 1.22 },
  { id: 'xl', name: 'Extra Large', scale: 1.45 },
];

export const PX_PER_MM = 4.8;

export function getModel(id) {
  return MODELS.find((m) => m.id === id) || MODELS[0];
}

export function getColor(model, colorId) {
  return model.colors.find((c) => c.id === colorId) || model.colors[0];
}
