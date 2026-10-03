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
    depth: 11, // the 30GB model
    // The 60GB and 80GB models have a thicker back for the bigger drive.
    depths: { '30GB': 11, '60GB': 14, '80GB': 14 },
    radius: 7.4,
    hold: 'top-left',
    jack: 11, // headphone jack centre, from the right edge
    screen: {
      // The black window printed under the clear front, around a 2.5" LCD
      // (50.8 x 38.1mm of picture, centred left to right).
      x: 4.2,
      y: 7.0,
      w: 53.4,
      h: 41.5,
      inset: [1.3, 1.7],
      radius: 0.9,
      depth: 2.4, // how far the LCD sits behind the clear front (a touch exaggerated)
      res: [320, 240],
      ui: { title: 22, rows: 9, fs: 16 },
    },
    wheel: { cy: 77.6, d: 38.6, center: 15.4 },
    colors: [
      {
        id: 'white',
        name: 'White',
        front: '#fbfbfb',
        wheel: '#efefef',
        label: '#a9abad',
        center: '#fbfbfb',
        bezel: '#1b1c1d',
      },
      {
        id: 'black',
        name: 'Black',
        front: '#121212',
        wheel: '#2e2e2f',
        label: '#e4e4e4',
        center: '#070707',
        bezel: '#050505',
        dark: true,
      },
      {
        id: 'u2',
        name: 'U2 Special Edition',
        front: '#111111',
        wheel: '#c3132f',
        label: '#161616',
        center: '#0b0b0b',
        bezel: '#050505',
        dark: true,
        engraved: 'U2',
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

export function getColor(model, colorId, custom) {
  if (colorId === 'custom' && custom) {
    return { id: 'custom', name: 'Custom', ...custom, bezel: custom.dark ? '#050505' : '#1b1c1d' };
  }
  return model.colors.find((c) => c.id === colorId) || model.colors[0];
}
