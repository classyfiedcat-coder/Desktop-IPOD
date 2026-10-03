/**
 * The iPods you can choose from. Everything about each one is data here: its
 * size, the shape of its edge, where the screen, wheel and ports are, its
 * colours and which screen style it runs. The device renderer (device.js and
 * body3d.js) and the screen (os.js) build whichever one is picked.
 *
 * Geometry is in millimetres, from the real devices, and is converted to
 * pixels by the device renderer. `size` is the flat front face; the edge's
 * profile can curve out beyond it (`profile`, measured outward from the front
 * outline r and into the depth z).
 *
 * Screens: `res` is the layout size of the screen in CSS pixels (the
 * monochrome ones are laid out at about twice their real resolution, so text
 * stays smooth), `ui` its title bar height, rows per screen and font size,
 * and `style` the look: 'video' (5th generation), 'classic' (6th/7th
 * generation and the 3rd generation nano: menus on the left, album art on
 * the right) or 'mono' (the black-and-grey LCDs of the original and mini).
 */

/** The 5th generation's ports: the hold switch and headphone jack on top, the dock connector below. */
const TOP_HOLD_JACK = (W, jack = 11) => [
  { kind: 'hold', edge: 'top', x: 10.5 },
  { kind: 'jack', edge: 'top', x: W - jack },
  { kind: 'dock', edge: 'bottom', x: W / 2 },
];

export const MODELS = [
  {
    id: 'video',
    name: 'iPod',
    era: '5th generation (video)',
    year: 2005,
    size: [61.8, 103.5],
    depth: 11, // the 30GB model
    // The 60GB and 80GB models have a thicker back for the bigger drive.
    depths: { '30GB': 11, '60GB': 14, '80GB': 14 },
    capacities: [
      ['30GB', 30],
      ['60GB', 60],
      ['80GB', 80],
    ],
    radius: 7.4,
    front: 'plastic',
    back: 'steel',
    // Clear acrylic over white or black polycarbonate, then the steel back.
    profile: { lip: 0.4, clearTo: -0.9, frontTo: -2.0, bandR: 0.5, bandFrom: -2.6, fillet: { 11: 3.0, 14: 4.4 } },
    hold: 'top-left',
    jack: 11, // headphone jack centre, from the right edge
    ports: TOP_HOLD_JACK(61.8),
    marks: { model: 'A1136', emc: '2065' },
    screen: {
      style: 'video',
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
    wheel: { type: 'click', cy: 77.6, d: 38.6, center: 15.4 },
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
  {
    id: 'classic',
    name: 'iPod classic',
    era: '6th and 7th generation (classic)',
    year: 2007,
    size: [61.8, 103.5],
    depth: 10.5,
    // The 160GB (2007) is 13.5mm thick; the 80GB and 120GB are 10.5mm.
    depths: { '80GB': 10.5, '120GB': 10.5, '160GB': 13.5 },
    capacities: [
      ['80GB', 80],
      ['120GB', 120],
      ['160GB', 160],
    ],
    radius: 7.4,
    // Anodised aluminium front, polished steel back.
    front: 'aluminium',
    back: 'steel',
    profile: { lip: 0.35, clearTo: null, frontTo: -1.7, bandR: 0.45, bandFrom: -2.2, fillet: { 10.5: 3.0, 13.5: 4.2 } },
    hold: 'top-left',
    jack: 11,
    ports: TOP_HOLD_JACK(61.8),
    marks: { model: 'A1238', emc: '2173' },
    screen: {
      style: 'classic',
      // A glossy black window around the same 2.5" LCD.
      x: 4.2,
      y: 7.0,
      w: 53.4,
      h: 41.5,
      inset: [1.3, 1.7],
      radius: 0.9,
      depth: 2.0,
      res: [320, 240],
      ui: { title: 22, rows: 9, fs: 16 },
    },
    wheel: { type: 'click', cy: 77.6, d: 38.6, center: 15.4 },
    colors: [
      {
        id: 'silver',
        name: 'Silver',
        front: '#d9dbdd',
        wheel: '#f3f3f4',
        label: '#a4a7ab',
        center: '#e6e7e9',
        bezel: '#0d0e0f',
      },
      {
        id: 'black',
        name: 'Black',
        front: '#2a2b2d',
        wheel: '#1a1a1b',
        label: '#c9cbcd',
        center: '#121213',
        bezel: '#050505',
        dark: true,
      },
    ],
  },
  {
    id: 'nano3',
    name: 'iPod nano',
    era: '3rd generation (nano)',
    year: 2007,
    size: [51.6, 69.1],
    depth: 6.5,
    capacities: [
      ['4GB', 4],
      ['8GB', 8],
    ],
    radius: 6.2,
    front: 'aluminium',
    back: 'steel',
    profile: { lip: 0.3, clearTo: null, frontTo: -1.0, bandR: 0.35, bandFrom: -1.35, fillet: { 6.5: 1.9 } },
    hold: 'bottom-left',
    // Everything on the bottom: hold switch, dock connector, headphone jack.
    ports: [
      { kind: 'hold', edge: 'bottom', x: 9.5 },
      { kind: 'dock', edge: 'bottom', x: 25.8 },
      { kind: 'jack', edge: 'bottom', x: 43.6 },
    ],
    marks: { model: 'A1236', emc: '2172' },
    screen: {
      style: 'classic',
      // A 2" LCD (40.6 x 30.5mm) under glass, in the top half.
      x: 4.0,
      y: 3.6,
      w: 43.6,
      h: 33.6,
      inset: [1.5, 1.55],
      radius: 0.8,
      depth: 1.4,
      res: [320, 240],
      ui: { title: 22, rows: 9, fs: 16 },
    },
    wheel: { type: 'click', cy: 53.3, d: 26.4, center: 10.4 },
    colors: [
      { id: 'silver', name: 'Silver', front: '#d6d8da', wheel: '#f4f4f5', label: '#a3a6aa', center: '#dfe1e3', bezel: '#0d0e0f' },
      { id: 'black', name: 'Black', front: '#29292b', wheel: '#151516', label: '#c6c8ca', center: '#111112', bezel: '#050505', dark: true },
      { id: 'blue', name: 'Blue', front: '#7fb6d8', wheel: '#f4f6f7', label: '#8fb2c8', center: '#86bbdc', bezel: '#0d0e0f' },
      { id: 'green', name: 'Green', front: '#a7d39a', wheel: '#f4f6f3', label: '#9cbd92', center: '#acd6a0', bezel: '#0d0e0f' },
      { id: 'pink', name: 'Pink', front: '#e6a3bf', wheel: '#f7f4f5', label: '#d39ab2', center: '#e9a9c3', bezel: '#0d0e0f' },
      { id: 'red', name: '(PRODUCT)RED', front: '#b8242c', wheel: '#f5f3f3', label: '#b9484e', center: '#bd2a32', bezel: '#0d0e0f' },
    ],
  },
  {
    id: 'mini',
    name: 'iPod mini',
    era: '1st and 2nd generation (mini)',
    year: 2004,
    // An anodised aluminium tube with plastic caps at each end.
    size: [47.6, 87.8],
    depth: 12.7,
    capacities: [
      ['4GB', 4],
      ['6GB', 6],
    ],
    radius: 2.6,
    front: 'mini',
    back: 'aluminium',
    profile: { lip: 1.6, clearTo: null, frontTo: -6.35, bandR: 1.6, bandFrom: -6.35, fillet: { 12.7: 1.6 }, caps: true },
    hold: 'top-left',
    ports: [
      { kind: 'hold', edge: 'top', x: 9.0 },
      { kind: 'jack', edge: 'top', x: 38.0 },
      { kind: 'dock', edge: 'bottom', x: 23.8 },
    ],
    marks: { model: 'A1051', emc: '2018' },
    screen: {
      style: 'mono',
      // A 1.67" greyscale LCD (33.2 x 26.4mm) behind a clear window.
      x: 6.9,
      y: 7.4,
      w: 33.8,
      h: 28.6,
      inset: [1.4, 1.4],
      radius: 1.2,
      depth: 1.4,
      res: [304, 242],
      ui: { title: 30, rows: 6, fs: 22 },
      lcd: { off: '#a9b3a2', on: '#c7dcf0' },
    },
    wheel: { type: 'click', cy: 63.0, d: 31.0, center: 11.6 },
    colors: [
      { id: 'silver', name: 'Silver', front: '#cfd2d5', wheel: '#eceeef', label: '#9ea3a8', center: '#e2e4e6', bezel: '#454a4c' },
      { id: 'blue', name: 'Blue', front: '#76a7d6', wheel: '#eef1f4', label: '#6f9fcd', center: '#e2e6ea', bezel: '#454a4c' },
      { id: 'pink', name: 'Pink', front: '#e3a2c4', wheel: '#f3eff1', label: '#d48fb3', center: '#e9e3e6', bezel: '#454a4c' },
      { id: 'green', name: 'Green', front: '#9fcf86', wheel: '#eef2ec', label: '#8fbf77', center: '#e3e8e1', bezel: '#454a4c' },
      { id: 'gold', name: 'Gold', front: '#d7c58f', wheel: '#f2f0ea', label: '#bfae78', center: '#e8e5dc', bezel: '#454a4c' },
    ],
  },
  {
    id: 'original',
    name: 'iPod',
    era: '1st generation (original)',
    year: 2001,
    size: [61.0, 101.2],
    depth: 19.8,
    capacities: [
      ['5GB', 5],
      ['10GB', 10],
    ],
    radius: 7.0,
    front: 'plastic',
    back: 'steel',
    // A thick white front shell, then a deep steel back with a big curve.
    profile: { lip: 0.45, clearTo: -1.0, frontTo: -3.6, bandR: 0.4, bandFrom: -4.2, fillet: { 19.8: 6.2 } },
    hold: 'top-right',
    // On top: the FireWire port, the headphone jack and the hold switch.
    ports: [
      { kind: 'firewire', edge: 'top', x: 12.0 },
      { kind: 'jack', edge: 'top', x: 30.5 },
      { kind: 'hold', edge: 'top', x: 49.0 },
    ],
    marks: { model: 'M8541', emc: '1849' },
    screen: {
      style: 'mono',
      // A 2" greyscale LCD (39.7 x 31.8mm), 160 x 128 pixels.
      x: 9.0,
      y: 9.6,
      w: 43.0,
      h: 35.0,
      inset: [1.65, 1.6],
      radius: 1.0,
      depth: 1.8,
      res: [320, 256],
      ui: { title: 34, rows: 6, fs: 24 },
      lcd: { off: '#a6ae9f', on: '#bcd6ef' },
    },
    // A wheel that turns, inside a ring of four buttons.
    wheel: { type: 'scroll', cy: 72.6, d: 40.2, inner: 30.2, center: 12.8 },
    colors: [{ id: 'white', name: 'White', front: '#fbfbfb', wheel: '#f6f6f6', label: '#9a9ea2', center: '#f6f6f6', bezel: '#5b6061' }],
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
    return { id: 'custom', name: 'Custom', ...custom, bezel: custom.dark ? '#050505' : model.colors[0].bezel || '#1b1c1d' };
  }
  return model.colors.find((c) => c.id === colorId) || model.colors[0];
}

/** What the back says: the smallest capacity of this model that would hold a drive this big (or the biggest made). */
export function capacityFor(model, gb) {
  const caps = model.capacities || [];
  if (!caps.length) return '';
  if (!(gb > 0)) return caps[0][0];
  const fit = caps.find(([, size]) => gb <= size);
  return (fit || caps[caps.length - 1])[0];
}

/** How thick this model is, in mm, for a capacity (the 5th generation's 60/80GB are thicker). */
export function depthFor(model, capacity) {
  return (model.depths && model.depths[capacity]) || model.depth;
}

/**
 * Where the flat band around the edge (the part the ports are cut into)
 * runs, in mm of depth from the front (negative), for a body T mm thick.
 */
export function edgeBand(model, T) {
  const p = model.profile;
  const fillet = (p.fillet && (p.fillet[T] || p.fillet[Object.keys(p.fillet)[0]])) || 3;
  const from = p.bandFrom;
  const to = -(T - fillet);
  return { from, to, mid: (from + to) / 2, fillet };
}
