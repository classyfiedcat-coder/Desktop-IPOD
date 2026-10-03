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

/*
 * Where the numbers come from. Overall sizes, capacities, colours and model
 * numbers: Apple's technical specifications and "Identify your iPod model"
 * page (support.apple.com/103823). Screen windows, wheels, centre buttons and
 * corner radii: measured from Apple's own front-on product images on that
 * page (their outlines match the published sizes to within 0.5%), scaled to
 * the published dimensions. Colours: sampled from the same images. Port
 * positions: from iFixit's photos of each model's edges. Values marked "est."
 * are estimates where no reference showed them.
 *
 * Measurements are taken from the outside edge; `size` is the flat face, so
 * it's the overall size less the edge's curve on each side (`e` below).
 */

export const MODELS = [
  {
    id: 'video',
    name: 'iPod',
    era: '5th generation (video)',
    year: 2005,
    // 61.8 x 103.5mm overall; the edge curves out 0.5mm beyond the face.
    size: [60.8, 102.5],
    depth: 11, // the 30GB model
    // The 60GB and 80GB models have a thicker back for the bigger drive.
    depths: { '30GB': 11, '60GB': 14, '80GB': 14 },
    capacities: [
      ['30GB', 30],
      ['60GB', 60],
      ['80GB', 80],
    ],
    radius: 5.6,
    front: 'plastic',
    back: 'steel',
    // Clear acrylic over white or black polycarbonate, then the steel back.
    profile: { lip: 0.4, clearTo: -0.9, frontTo: -2.0, bandR: 0.5, bandFrom: -2.6, fillet: { 11: 3.0, 14: 4.4 } },
    hold: 'top-left',
    holdW: 12,
    // Bare chrome on top: the hold switch at the left, the headphone jack at the right.
    ports: [
      { kind: 'hold', edge: 'top', x: 12.8 },
      { kind: 'jack', edge: 'top', x: 53.9 },
      { kind: 'dock', edge: 'bottom', x: 30.4 },
    ],
    marks: { model: 'A1136', emc: '2065' },
    screen: {
      style: 'video',
      // The black window under the clear front, just bigger than the 2.5"
      // LCD (50.8 x 38.1mm of picture).
      x: 4.1,
      y: 4.25,
      w: 52.5,
      h: 39.9,
      inset: [0.85, 0.9],
      radius: 0.8,
      depth: 2.4, // how far the LCD sits behind the clear front (a touch exaggerated)
      res: [320, 240],
      ui: { title: 22, rows: 9, fs: 16 },
    },
    wheel: { type: 'click', cy: 72.4, d: 38.1, center: 13.5 },
    colors: [
      // A grey satin wheel with white labels, and a white centre button.
      { id: 'white', name: 'White', front: '#fbfbfb', wheel: '#ccd0d3', label: '#ffffff', center: '#f7f8f8', bezel: '#1b1c1d' },
      { id: 'black', name: 'Black', front: '#121314', wheel: '#1d2225', label: '#f2f3f4', center: '#0a0d0f', bezel: '#050505', dark: true },
      // Black with a red Click Wheel (Apple).
      { id: 'u2', name: 'U2 Special Edition', front: '#111111', wheel: '#c3132f', label: '#161616', center: '#0b0b0b', bezel: '#050505', dark: true, engraved: 'U2' },
    ],
  },
  {
    id: 'classic',
    name: 'iPod classic',
    era: '6th and 7th generation (classic)',
    year: 2007,
    size: [60.9, 102.6], // 61.8 x 103.5mm overall
    depth: 10.5,
    // The 160GB (2007) is 13.5mm thick; the 80GB and 120GB are 10.5mm.
    depths: { '80GB': 10.5, '120GB': 10.5, '160GB': 13.5 },
    capacities: [
      ['80GB', 80],
      ['120GB', 120],
      ['160GB', 160],
    ],
    radius: 5.55,
    // Anodised aluminium front, polished stainless steel back.
    front: 'aluminium',
    back: 'steel',
    profile: { lip: 0.35, clearTo: null, frontTo: -1.7, bandR: 0.45, bandFrom: -2.2, fillet: { 10.5: 3.0, 13.5: 4.2 } },
    hold: 'top-left',
    holdW: 12,
    ports: [
      { kind: 'hold', edge: 'top', x: 12.85 },
      { kind: 'jack', edge: 'top', x: 53.95 },
      { kind: 'dock', edge: 'bottom', x: 30.45 },
    ],
    marks: { model: 'A1238', emc: '2173' },
    screen: {
      style: 'classic',
      // A pane of glossy black glass around the same 2.5" LCD.
      x: 3.95,
      y: 3.95,
      w: 52.7,
      h: 39.9,
      inset: [0.95, 0.9],
      radius: 0.8,
      depth: 2.0,
      res: [320, 240],
      ui: { title: 22, rows: 9, fs: 16 },
    },
    wheel: { type: 'click', cy: 72.15, d: 38.0, center: 13.8 },
    colors: [
      // Silver: a white Click Wheel around a silver centre button.
      { id: 'silver', name: 'Silver', front: '#cdcecf', wheel: '#f6f8f9', label: '#7d8894', center: '#c9cacb', bezel: '#0d0e0f' },
      // 2007: black front, black wheel.
      { id: 'black', name: 'Black (2007)', front: '#1f1f21', wheel: '#1a1a1c', label: '#f2f3f4', center: '#161618', bezel: '#050505', dark: true },
      // 2008 and 2009: a grey front with the black wheel.
      { id: 'gray', name: 'Black (2008–2009)', front: '#4b4a4c', wheel: '#212022', label: '#f2f3f4', center: '#414042', bezel: '#050505', dark: true },
    ],
  },
  {
    id: 'nano3',
    name: 'iPod nano',
    era: '3rd generation (nano)',
    year: 2007,
    size: [51.6, 69.1], // 52.3 x 69.8 x 6.5mm overall
    depth: 6.5,
    capacities: [
      ['4GB', 4],
      ['8GB', 8],
    ],
    radius: 5.15,
    front: 'aluminium',
    back: 'steel',
    profile: { lip: 0.3, clearTo: null, frontTo: -1.0, bandR: 0.35, bandFrom: -1.45, fillet: { 6.5: 1.6 } },
    hold: 'bottom-right',
    holdW: 6,
    // All on the bottom: the headphone jack, the dock connector (centred), the hold switch.
    ports: [
      { kind: 'jack', edge: 'bottom', x: 6.0 },
      { kind: 'dock', edge: 'bottom', x: 25.8 },
      { kind: 'hold', edge: 'bottom', x: 44.0 },
    ],
    marks: { model: 'A1236', emc: '2172' },
    backCapacityBox: true,
    screen: {
      style: 'classic',
      // A 2" LCD (40.6 x 30.5mm) in a black window across the top.
      x: 3.45,
      y: 3.55,
      w: 44.2,
      h: 32.3,
      inset: [1.8, 0.9],
      radius: 0.8,
      depth: 1.4,
      res: [320, 240],
      ui: { title: 22, rows: 9, fs: 16 },
    },
    wheel: { type: 'click', cy: 51.55, d: 26.5, center: 13.0 },
    // The centre button is the colour of the case; the wheel is white (black on the black one).
    colors: [
      { id: 'silver', name: 'Silver', front: '#d6dbdd', wheel: '#fafbfb', label: '#7d8894', center: '#c0c4c7', bezel: '#0d0e0f' },
      { id: 'black', name: 'Black', front: '#2f3137', wheel: '#1b1e22', label: '#f2f3f4', center: '#24272c', bezel: '#050505', dark: true },
      { id: 'blue', name: 'Blue', front: '#8acbce', wheel: '#fdfefe', label: '#7d8894', center: '#61b8b8', bezel: '#0d0e0f' },
      { id: 'pink', name: 'Pink', front: '#d2438c', wheel: '#f8fafa', label: '#7d8894', center: '#bc367c', bezel: '#0d0e0f' },
      { id: 'red', name: '(PRODUCT)RED', front: '#a21039', wheel: '#fdfefe', label: '#7d8894', center: '#940f32', bezel: '#0d0e0f' },
    ],
  },
  {
    id: 'mini',
    name: 'iPod mini',
    era: '1st generation (mini)',
    year: 2004,
    // 50.8 x 91.4 x 12.7mm overall: an anodised aluminium tube, rounded at
    // the sides, with plastic caps at each end.
    size: [47.6, 88.2],
    depth: 12.7,
    capacities: [
      ['4GB', 4],
      ['6GB', 6],
    ],
    radius: 0.5,
    front: 'mini',
    back: 'aluminium',
    profile: { lip: 1.6, clearTo: null, frontTo: -6.35, bandR: 1.6, bandFrom: -6.35, fillet: { 12.7: 1.6 }, caps: true },
    hold: 'top-left',
    holdW: 8,
    // The hold switch on the top left (Apple); the headphone jack on the right (est. positions).
    ports: [
      { kind: 'hold', edge: 'top', x: 8.5 },
      { kind: 'jack', edge: 'top', x: 38.5 },
      { kind: 'dock', edge: 'bottom', x: 23.8 },
    ],
    marks: { model: 'A1051', emc: '1980' },
    screen: {
      style: 'mono',
      // A 1.67" greyscale LCD (33.2 x 26.4mm) behind a clear window.
      x: 5.9,
      y: 4.7,
      w: 35.8,
      h: 29.1,
      inset: [1.3, 1.35],
      radius: 1.0,
      depth: 1.4,
      // 138 x 110 pixels, laid out at 2.2x.
      res: [304, 242],
      ui: { title: 40, rows: 5, fs: 25 },
      // Lit, it's a cool blue-grey; the type and the highlight are a deep navy.
      lcd: { off: '#a3adb9', on: '#b3bfd3', ink: '#1d1f3c', sel: '#373765' },
    },
    wheel: { type: 'click', cy: 61.3, d: 37.2, center: 12.5 },
    // A light grey wheel and centre button with grey labels.
    colors: [
      { id: 'silver', name: 'Silver', front: '#b6b8bb', wheel: '#e4e4e4', label: '#868b91', center: '#eaeaea', bezel: '#7b8288' },
      { id: 'gold', name: 'Gold', front: '#b9a061', wheel: '#e4e4e4', label: '#868b91', center: '#ebebeb', bezel: '#7b8288' },
      { id: 'blue', name: 'Blue', front: '#649fc6', wheel: '#e4e4e4', label: '#868b91', center: '#ebebeb', bezel: '#7b8288' },
      { id: 'pink', name: 'Pink', front: '#d47b9f', wheel: '#e4e4e4', label: '#868b91', center: '#ebebeb', bezel: '#7b8288' },
      { id: 'green', name: 'Green', front: '#95ca50', wheel: '#e4e4e4', label: '#868b91', center: '#ececec', bezel: '#7b8288' },
    ],
  },
  {
    id: 'original',
    name: 'iPod',
    era: '1st generation (original)',
    year: 2001,
    size: [60.8, 101.2], // 61.7 x 102.1 x 19.8mm overall
    depth: 19.8,
    capacities: [
      ['5GB', 5],
      ['10GB', 10],
    ],
    radius: 4.15,
    front: 'plastic',
    back: 'steel',
    // A thick white front shell, then a deep steel back with a big curve.
    profile: { lip: 0.45, clearTo: -1.0, frontTo: -3.6, bandR: 0.4, bandFrom: -4.2, fillet: { 19.8: 6.2 } },
    hold: 'top-right',
    holdW: 9,
    // On top, left to right: the FireWire port, the headphone jack and the
    // hold switch (a white slider), labelled on the white lip below.
    ports: [
      { kind: 'firewire', edge: 'top', x: 13.9 },
      { kind: 'jack', edge: 'top', x: 30.4 },
      { kind: 'hold', edge: 'top', x: 47.0 },
    ],
    marks: { model: 'M8541', emc: '1849' },
    edgeLabels: true,
    holdSlider: 'plastic',
    screen: {
      style: 'mono',
      // A 2" greyscale LCD (39.7 x 31.8mm), 160 x 128 pixels, no black frame.
      x: 9.45,
      y: 4.35,
      w: 42.1,
      h: 34.2,
      inset: [1.2, 1.2],
      radius: 1.6,
      depth: 1.8,
      // Laid out at 2x.
      res: [320, 256],
      ui: { title: 36, rows: 6, fs: 26 },
      // Warm grey unlit; the backlight is white with a hint of blue.
      lcd: { off: '#c3c3ba', on: '#d6dde3', ink: '#232322', sel: '#3b3a39' },
    },
    // A wheel that turns, inside a ring of four buttons ("menu" in lower case).
    wheel: { type: 'scroll', cy: 69.25, d: 51.8, inner: 40.6, center: 14.2, menu: 'menu' },
    colors: [{ id: 'white', name: 'White', front: '#f7f7f7', wheel: '#f1f2f3', label: '#9a9fa5', center: '#f4f4f5', bezel: '#b9bbb4' }],
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
