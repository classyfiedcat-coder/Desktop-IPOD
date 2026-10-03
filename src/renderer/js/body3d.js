/**
 * The iPod's body as a real 3D model, rendered with WebGL behind the
 * interactive front face (screen and click wheel stay HTML).
 *
 * The shell is built by sweeping a cross-section around the rounded-rectangle
 * outline: the rounded lip of the front plastic, the plastic band, a seam
 * groove, the polished steel, and the long curve over onto the back. Corners
 * and curves are finely subdivided with smooth normals, so the edges are
 * truly smooth. The ports are modelled: a headphone jack you can see into,
 * with a chrome ring; the hold switch slot and its chrome slider (which moves
 * with the switch); the dock connector cavity with its row of pins.
 *
 * The camera reproduces the CSS perspective exactly, and the motion rig drives
 * both the HTML face and this model with the same transform each frame, so
 * the two line up to the pixel.
 *
 * Units: CSS pixels, y up, the front face at z = 0 and the back at z = -T.
 */

import * as THREE from '../vendor/three/three.module.min.js';

const DEG = Math.PI / 180;

/** Cross-section, in millimetres: r is outward from the front outline, z is depth (negative = back). */
const LIP = 0.4; // radius of the rounded front plastic edge
const CLEAR_TO = -0.9; // the clear acrylic layer over the colour, seen edge-on
const PLASTIC_TO = -2.0; // where the plastic band ends
const BAND_R = 0.5; // the flat steel band sticks out this far
const BAND_FROM = -2.6;
/** The steel's curve over onto the back: deeper on the thicker 60/80GB back. */
const backFillet = (T) => (T >= 13 ? 4.4 : 3.0);

const SMOOTH_CORNER = 28; // segments per rounded corner
const SMOOTH_ARC = 18; // segments per curved part of the cross-section

export class Body3D {
  static supported() {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch {
      return false;
    }
  }

  constructor() {
    this.ok = false;
    this.renderer = null;
    this.canvas = null;
    this.state = { rx: 0, yaw: 0, rz: 0, scale: 1, half: 0, room: { x: 0, y: 0 } };
    this.hold = false;
    this._raycaster = null;
    this._pending = false;
  }

  /**
   * Build (or rebuild) the model.
   * @param {object} o
   * @param {HTMLElement} o.host element the canvas goes into (the .ipod)
   * @param {number} o.W device width, mm
   * @param {number} o.H device height, mm
   * @param {number} o.R corner radius, mm
   * @param {number} o.T thickness, mm
   * @param {number} o.u px per mm
   * @param {number} o.pad window padding around the device, px
   * @param {number} o.perspective CSS perspective, px
   * @param {object} o.color the colour scheme (front, dark…)
   * @param {'steel'|'black'} o.finish
   * @param {object} o.ports { jackX, holdX, holdW, holdDepth, dockW, dockH } in mm
   * @param {object} o.back { capacity, lines: [engraving], serial }
   * @param {{rough?: HTMLCanvasElement}} [o.wear]
   */
  mount(o) {
    this.dispose();
    this.o = o;
    this._targets = null;
    this._drawn = null;
    const { host, W, H, u, pad, perspective } = o;
    const cw = W * u + pad * 2;
    const ch = H * u + pad * 2;

    const canvas = document.createElement('canvas');
    canvas.className = 'body3d';
    Object.assign(canvas.style, { left: `${-pad}px`, top: `${-pad}px`, width: `${cw}px`, height: `${ch}px` });
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'default' });
    } catch {
      return false;
    }
    renderer.setPixelRatio(this._dpr());
    renderer.setSize(cw, ch, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ok = false;
      if (this.onLost) this.onLost();
    });

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const studio = studioEnvironment();
    scene.environment = pmrem.fromScene(studio, 0.02).texture;
    studio.traverse((n) => n.geometry && n.geometry.dispose());
    pmrem.dispose();
    // Fill, so the plastic is as bright as the HTML face it meets, and a key
    // light from the top left for crisp highlights.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8580, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-0.6, 0.9, 1.2);
    scene.add(key);

    // Match the CSS perspective: the viewer is `perspective` px in front of
    // the face, looking at the centre of the iPod (the canvas centre).
    const camera = new THREE.PerspectiveCamera((2 * Math.atan(ch / 2 / perspective)) / DEG, cw / ch, Math.max(1, perspective * 0.05), perspective * 4);
    camera.position.set(0, 0, perspective);
    camera.lookAt(0, 0, 0);

    const pivot = new THREE.Group();
    pivot.matrixAutoUpdate = false;
    scene.add(pivot);

    this.canvas = canvas;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.pivot = pivot;
    this.materials = this._materials(o);
    this._build(o);
    host.prepend(canvas);
    this.ok = true;
    this.render();
    return true;
  }

  dispose() {
    if (!this.renderer) return;
    this.scene.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
    });
    for (const m of Object.values(this.materials || {})) {
      for (const k of ['map', 'roughnessMap', 'clearcoatRoughnessMap']) if (m[k]) m[k].dispose();
      m.dispose();
    }
    if (this.scene.environment) this.scene.environment.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.renderer = null;
    this.ok = false;
  }

  // ------------------------------------------------------------- materials --

  _materials({ color, finish, wear }) {
    let rough = null;
    if (wear && wear.rough) {
      rough = new THREE.CanvasTexture(wear.rough);
      rough.colorSpace = THREE.NoColorSpace;
      rough.anisotropy = 4;
    }
    const front = new THREE.Color(color.front);
    const m = {
      // Glossy polycarbonate: a clear coat over the colour.
      plastic: new THREE.MeshPhysicalMaterial({ color: front, roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }),
      // Clear acrylic over the colour: glassier, a little cooler and darker edge-on.
      clear: new THREE.MeshPhysicalMaterial({
        color: front.clone().lerp(new THREE.Color(color.dark ? 0x2a2e33 : 0xc9d3dc), color.dark ? 0.35 : 0.45),
        roughness: 0.06,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        ior: 1.49,
        specularIntensity: 1,
      }),
      // Under the HTML face, so never really seen: flat colour costs nothing to draw.
      cap: new THREE.MeshBasicMaterial({ color: front }),
      seam: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.85, metalness: 0 }),
      chrome: new THREE.MeshPhysicalMaterial({ color: 0xf4f5f7, metalness: 1, roughness: 0.07, side: THREE.DoubleSide }),
      hole: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.95, metalness: 0, side: THREE.BackSide }),
      holeFloor: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.95, metalness: 0 }),
      tongue: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7, metalness: 0 }),
      pins: new THREE.MeshStandardMaterial({ color: 0xd9c37a, roughness: 0.25, metalness: 1 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xff8a00, roughness: 0.5, emissive: 0x401a00 }),
    };
    if (finish === 'black') {
      // Black steel: a deep base under a perfect clear coat; wear dulls the coat.
      m.steel = new THREE.MeshPhysicalMaterial({
        color: 0x0c0c0d,
        metalness: 0.5,
        roughness: 0.45,
        clearcoat: 1,
        clearcoatRoughness: rough ? 1 : 0.04,
        clearcoatRoughnessMap: rough,
      });
    } else {
      // Mirror-polished stainless steel; wear makes it rough in places.
      m.steel = new THREE.MeshPhysicalMaterial({ color: 0xf1f2f4, metalness: 1, roughness: rough ? 1 : 0.1, roughnessMap: rough });
    }
    return m;
  }

  setFrontColor(hex) {
    if (!this.ok) return;
    this.materials.plastic.color.set(hex);
    this.materials.clear.color.set(hex).lerp(new THREE.Color(0xc9d3dc), 0.45);
    this.materials.cap.color.set(hex);
    this.render();
  }

  // ------------------------------------------------------------- geometry --

  _build(o) {
    const { W, H, R, T, u, finish, ports, back } = o;
    const BACK_FILLET = backFillet(T);
    const BAND_TO = -(T - BACK_FILLET);
    const mm = (v) => v * u;
    const a = mm(W / 2);
    const b = mm(H / 2);
    const Rc = mm(R);
    const M = this.materials;
    const bands = { top: b + mm(BAND_R), bottom: -(b + mm(BAND_R)) };
    // Planar UVs over the whole device for the wear map.
    const A = a + mm(1);
    const B = b + mm(1);
    const uv = (x, y) => [(x + A) / (2 * A), (y + B) / (2 * B)];

    // Outline of the front face, as runs of (point, outward normal).
    const runs = [];
    const straight = (x0, y0, x1, y1, nx, ny, tag) => runs.push({ tag, pts: [{ x: x0, y: y0, nx, ny }, { x: x1, y: y1, nx, ny }] });
    const corner = (cx, cy, a0, a1) => {
      const pts = [];
      for (let i = 0; i <= SMOOTH_CORNER; i++) {
        const t = (a0 + ((a1 - a0) * i) / SMOOTH_CORNER) * DEG;
        pts.push({ x: cx + Rc * Math.cos(t), y: cy + Rc * Math.sin(t), nx: Math.cos(t), ny: Math.sin(t) });
      }
      runs.push({ tag: 'corner', pts });
    };
    straight(-a + Rc, b, a - Rc, b, 0, 1, 'top');
    corner(a - Rc, b - Rc, 90, 0);
    straight(a, b - Rc, a, -b + Rc, 1, 0, 'side');
    corner(a - Rc, -b + Rc, 0, -90);
    straight(a - Rc, -b, -a + Rc, -b, 0, -1, 'bottom');
    corner(-a + Rc, -b + Rc, -90, -180);
    straight(-a, -b + Rc, -a, b - Rc, -1, 0, 'side');
    corner(-a + Rc, b - Rc, 180, 90);

    // Cross-section pieces: [{ r, z, nr, nz }] in mm, front to back.
    const arc = (cr, cz, rad, a0, a1, n) =>
      Array.from({ length: n + 1 }, (_, i) => {
        const t = (a0 + ((a1 - a0) * i) / n) * DEG;
        return { r: cr + rad * Math.cos(t), z: cz + rad * Math.sin(t), nr: Math.cos(t), nz: Math.sin(t) };
      });
    const line = (r0, z0, r1, z1) => {
      const dr = r1 - r0;
      const dz = z1 - z0;
      const L = Math.hypot(dr, dz);
      const nr = -dz / L;
      const nz = dr / L;
      return [
        { r: r0, z: z0, nr, nz },
        { r: r1, z: z1, nr, nz },
      ];
    };
    const backInset = BAND_R - BACK_FILLET;
    const pieces = [
      // The front is colour under a layer of clear acrylic: edge-on, the clear
      // layer reads as a glassy band before the coloured plastic starts.
      { mat: 'clear', pts: [...arc(0, -LIP, LIP, 90, 0, 10), ...line(LIP, -LIP, LIP, CLEAR_TO).slice(1)] },
      { mat: 'plastic', pts: line(LIP, CLEAR_TO, LIP, PLASTIC_TO) },
      // The seam: a fine groove where the plastic meets the steel.
      { mat: 'seam', pts: line(LIP, PLASTIC_TO, 0.22, PLASTIC_TO - 0.14) },
      { mat: 'seam', pts: line(0.22, PLASTIC_TO - 0.14, 0.22, PLASTIC_TO - 0.28) },
      { mat: 'seam', pts: line(0.22, PLASTIC_TO - 0.28, 0.44, PLASTIC_TO - 0.4) },
      { mat: 'steel', pts: line(0.44, PLASTIC_TO - 0.4, BAND_R, BAND_FROM) },
      { mat: 'steel', pts: line(BAND_R, BAND_FROM, BAND_R, BAND_TO), band: true },
      { mat: 'steel', pts: arc(backInset, BAND_TO, BACK_FILLET, 0, -90, SMOOTH_ARC) },
    ];

    // Sweep each piece around the outline.
    const buffers = new Map();
    const buf = (mat) => {
      if (!buffers.has(mat)) buffers.set(mat, { pos: [], nor: [], uv: [], idx: [] });
      return buffers.get(mat);
    };
    for (const piece of pieces) {
      const g = buf(piece.mat);
      for (const run of runs) {
        // The flat bands on the top and bottom are built separately, with holes for the ports.
        if (piece.band && (run.tag === 'top' || run.tag === 'bottom')) continue;
        const base = g.pos.length / 3;
        const cols = run.pts.length;
        for (const p of piece.pts) {
          for (const q of run.pts) {
            const x = q.x + mm(p.r) * q.nx;
            const y = q.y + mm(p.r) * q.ny;
            g.pos.push(x, y, mm(p.z));
            const n = new THREE.Vector3(p.nr * q.nx, p.nr * q.ny, p.nz).normalize();
            g.nor.push(n.x, n.y, n.z);
            g.uv.push(...uv(x, y));
          }
        }
        for (let i = 0; i < piece.pts.length - 1; i++) {
          for (let j = 0; j < cols - 1; j++) {
            const v0 = base + i * cols + j;
            const v1 = v0 + 1;
            const v2 = v0 + cols;
            const v3 = v2 + 1;
            // Wound so the faces point outward.
            g.idx.push(v0, v1, v2, v1, v3, v2);
          }
        }
      }
    }
    for (const [mat, g] of buffers) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setIndex(g.idx);
      this._add(new THREE.Mesh(geo, M[mat]), true);
    }

    // The back: a flat rounded rectangle where the curve ends.
    const inset = mm(backInset);
    const backShape = roundedRect(a + inset, b + inset, Rc + inset);
    const backGeo = new THREE.ShapeGeometry(backShape, SMOOTH_CORNER);
    planarUv(backGeo, uv);
    backGeo.rotateY(Math.PI); // face backwards
    flipUvX(backGeo);
    backGeo.translate(0, 0, mm(-T));
    this._add(new THREE.Mesh(backGeo, M.steel), true);
    // And a cap under the HTML face, so nothing ever shows through the front.
    // It reaches a little way under the curved lip: seen at an angle, a ray
    // can slip between the face and the start of the curve, and would
    // otherwise find a hairline gap at the edge.
    const capOut = mm(0.15);
    const capGeo = new THREE.ShapeGeometry(roundedRect(a + capOut, b + capOut, Rc + capOut), SMOOTH_CORNER);
    capGeo.translate(0, 0, mm(-0.05));
    this._add(new THREE.Mesh(capGeo, M.cap));

    // The etched lettering on the back.
    this._backDecal({ a: a + inset, b: b + inset, z: mm(-T) - mm(0.01), finish, back, u });

    // Top and bottom bands, with the ports cut into them.
    const xr = a - Rc;
    const z0 = mm(BAND_FROM);
    const z1 = mm(BAND_TO);
    const zc = (z0 + z1) / 2;
    const holdZ = mm(ports.holdZ);
    const holdX = mm(ports.holdX - W / 2);
    const jackX = mm(ports.jackX - W / 2);
    this._band({
      y: bands.top,
      up: true,
      xr,
      z0,
      z1,
      holes: [circlePath(jackX, zc, mm(2.6)), roundedRectPath(holdX, holdZ, mm(ports.holdW + 0.6) / 2, mm(1.25), mm(1.2))],
    });
    this._band({ y: bands.bottom, up: false, xr, z0, z1, holes: [roundedRectPath(0, zc, mm(ports.dockW + 0.6) / 2, mm(ports.dockH + 0.6) / 2, mm(0.9))] });

    this._jack({ x: jackX, y: bands.top, z: zc, u });
    this._holdSwitch({ x: holdX, y: bands.top, z: holdZ, w: mm(ports.holdW), u });
    this._dock({ y: bands.bottom, z: zc, w: mm(ports.dockW), h: mm(ports.dockH), u });
    this._topLabels({ y: bands.top, z: zc, holdX, holdW: mm(ports.holdW), jackX, u });
  }

  _add(mesh, hit = false) {
    if (hit) mesh.userData.hit = true;
    this.pivot.add(mesh);
    return mesh;
  }

  /** A flat band on the top or bottom edge, with holes. */
  _band({ y, up, xr, z0, z1, holes }) {
    // Shape coordinates: (x, z).
    const s = new THREE.Shape();
    s.moveTo(-xr, z1);
    s.lineTo(xr, z1);
    s.lineTo(xr, z0);
    s.lineTo(-xr, z0);
    s.closePath();
    s.holes.push(...holes);
    const geo = new THREE.ShapeGeometry(s, 32);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i), y, pos.getY(i));
    // Laid on its side the shape faces down, which is right for the bottom
    // band; turn the top one's triangles over so it faces up (and can be
    // culled from behind like the rest of the shell).
    if (up) {
      const idx = geo.index.array;
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      geo.index.needsUpdate = true;
    }
    const nor = geo.attributes.normal;
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, up ? 1 : -1, 0);
    const A = this.o.W * this.o.u * 0.5 + this.o.u;
    const Dp = this.o.T * this.o.u;
    planarUv(geo, (x, _y, z) => [(x + A) / (2 * A), 0.5 + z / (3 * Dp)]);
    this._add(new THREE.Mesh(geo, this.materials.steel), true);
  }

  /** The headphone jack: a polished chrome ring around a hole you can see into. */
  _jack({ x, y, z, u }) {
    const M = this.materials;
    const ring = new THREE.LatheGeometry(
      [
        new THREE.Vector2(2.6 * u, 0.0),
        new THREE.Vector2(2.45 * u, 0.12 * u),
        new THREE.Vector2(2.1 * u, 0.12 * u),
        new THREE.Vector2(1.85 * u, -0.15 * u),
        new THREE.Vector2(1.75 * u, -0.6 * u),
      ],
      64
    );
    const g = new THREE.Group();
    g.add(new THREE.Mesh(ring, M.chrome));
    const tube = new THREE.CylinderGeometry(1.75 * u, 1.75 * u, 6 * u, 48, 1, true);
    tube.translate(0, -3.6 * u, 0);
    g.add(new THREE.Mesh(tube, M.hole));
    const floor = new THREE.CircleGeometry(1.75 * u, 48);
    floor.rotateX(-Math.PI / 2);
    floor.translate(0, -6.5 * u, 0);
    g.add(new THREE.Mesh(floor, M.holeFloor));
    g.position.set(x, y, z);
    this.pivot.add(g);
  }

  /** The hold switch: a slot with an orange flag, and a chrome slider that moves. */
  _holdSwitch({ x, y, z, w, u }) {
    const M = this.materials;
    const g = new THREE.Group();
    const slotW = w + 0.6 * u;
    const slotH = 2.5 * u;
    const depth = 1.4 * u;
    // Slot walls and floor (seen from inside).
    const slot = new THREE.ExtrudeGeometry(roundedRect(slotW / 2, slotH / 2, 1.2 * u), { depth, bevelEnabled: false, curveSegments: 24 });
    slot.rotateX(Math.PI / 2); // extrude downward (−y)
    g.add(new THREE.Mesh(slot, M.hole));
    // The orange flag at the left end, revealed when the switch is on.
    const flag = new THREE.PlaneGeometry(slotW * 0.42, slotH * 0.7);
    flag.rotateX(-Math.PI / 2);
    flag.translate(-slotW * 0.25, -depth + 0.05 * u, 0);
    g.add(new THREE.Mesh(flag, M.orange));
    // The slider: a polished chrome pill, standing a little proud of the edge.
    const pillW = w * 0.52;
    const pill = new THREE.ExtrudeGeometry(roundedRect(pillW / 2 - 0.3 * u, slotH / 2 - 0.55 * u, 0.7 * u), {
      depth: 1.0 * u,
      bevelEnabled: true,
      bevelThickness: 0.35 * u,
      bevelSize: 0.3 * u,
      bevelSegments: 6,
      curveSegments: 24,
    });
    pill.rotateX(-Math.PI / 2); // extrude upward (+y)
    pill.translate(0, -0.55 * u, 0);
    const slider = new THREE.Mesh(pill, M.chrome);
    slider.userData.hit = true;
    g.add(slider);
    g.position.set(x, y, z);
    this.pivot.add(g);
    this.slider = slider;
    this.slideRange = (slotW - pillW) / 2 - 0.2 * u;
    this._placeSlider();
  }

  _placeSlider() {
    if (!this.slider) return;
    // Off: slid to the left (over the orange). On: to the right, showing it.
    this.slider.position.x = this.hold ? this.slideRange : -this.slideRange;
  }

  setHold(on) {
    this.hold = !!on;
    this._placeSlider();
    this.render();
  }

  /** The dock connector: a chrome-framed cavity with a tongue of pins inside. */
  _dock({ y, z, w, h, u }) {
    const M = this.materials;
    const g = new THREE.Group();
    const W2 = w / 2 + 0.3 * u;
    const H2 = h / 2 + 0.3 * u;
    const depth = 5 * u;
    const cavity = new THREE.ExtrudeGeometry(roundedRect(W2, H2, 0.9 * u), { depth, bevelEnabled: false, curveSegments: 16 });
    cavity.rotateX(-Math.PI / 2); // into the body (+y from the bottom band, which faces down)
    g.add(new THREE.Mesh(cavity, M.hole));
    // Chrome frame around the opening.
    const frameShape = roundedRect(W2 + 0.35 * u, H2 + 0.35 * u, 1.2 * u);
    frameShape.holes.push(roundedRectPath(0, 0, W2, H2, 0.9 * u));
    const frame = new THREE.ExtrudeGeometry(frameShape, { depth: 0.12 * u, bevelEnabled: false, curveSegments: 16 });
    frame.rotateX(Math.PI / 2);
    g.add(new THREE.Mesh(frame, M.chrome));
    // The tongue, recessed a little, with the contacts along one face.
    const tongue = new THREE.BoxGeometry(w * 0.84, 3.4 * u, h * 0.36);
    tongue.translate(0, 2.6 * u, h * 0.05);
    g.add(new THREE.Mesh(tongue, M.tongue));
    const pins = 30;
    const pin = new THREE.BoxGeometry((w * 0.8) / pins / 1.9, 2.6 * u, 0.12 * u);
    const inst = new THREE.InstancedMesh(pin, M.pins, pins);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < pins; i++) {
      const px = -w * 0.4 + ((i + 0.5) * w * 0.8) / pins;
      mtx.makeTranslation(px, 2.4 * u, h * 0.05 - h * 0.18 - 0.06 * u);
      inst.setMatrixAt(i, mtx);
    }
    g.add(inst);
    g.position.set(0, y, z);
    this.pivot.add(g);
  }

  /** "HOLD" and the headphone icon, printed on the top edge. */
  _topLabels({ y, z, holdX, holdW, jackX, u }) {
    const dark = this.o.finish === 'black';
    const ink = dark ? 'rgba(225,228,232,0.95)' : 'rgba(60,64,70,0.9)';
    const w = 14 * u;
    const h = 3 * u;
    const make = (draw, x) => {
      const scale = 4;
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      const g = c.getContext('2d');
      g.scale(scale, scale);
      g.fillStyle = ink;
      draw(g);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const mat = decalMaterial(tex);
      const plane = new THREE.PlaneGeometry(w, h);
      plane.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(plane, mat);
      mesh.position.set(x, y + 0.02 * u, z);
      this.pivot.add(mesh);
    };
    make((g) => {
      g.font = `700 ${1.6 * u}px "iPod Sans", "Helvetica Neue", Arial, sans-serif`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText('HOLD', 0, h / 2);
    }, holdX + holdW / 2 + 1.6 * u + w / 2);
    make((g) => {
      // Headphones.
      const s = 2.2 * u;
      const cx = w - s / 2 - 0.2 * u;
      const cy = h / 2;
      g.lineWidth = 0.32 * u;
      g.strokeStyle = ink;
      g.beginPath();
      g.arc(cx, cy + s * 0.12, s * 0.42, Math.PI, 0);
      g.stroke();
      g.fillRect(cx - s * 0.5, cy + s * 0.05, s * 0.2, s * 0.38);
      g.fillRect(cx + s * 0.3, cy + s * 0.05, s * 0.2, s * 0.38);
    }, jackX - 3.6 * u - w / 2);
  }

  /** The back's etched lettering: matte, light, so it stays put while the steel reflects. */
  _backDecal({ a, b, z, finish, back, u }) {
    const w = a * 2;
    const h = b * 2;
    const scale = Math.min(3, (window.devicePixelRatio || 1) * 1.5);
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const g = c.getContext('2d');
    g.scale(scale, scale);
    const ink = finish === 'black' ? 'rgba(214,217,221,0.96)' : 'rgba(236,238,241,0.96)';
    g.fillStyle = ink;
    g.strokeStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const font = (wt, size) => `${wt} ${size * u}px "iPod Sans", "Helvetica Neue", Arial, sans-serif`;
    // The device's own top is at y = H/2 + inset; position things by fraction of the full height.
    const full = this.o.H * u;
    const top = (frac) => frac * full - (full - h) / 2;
    // Laid out like the real back: the wordmark a little above the middle,
    // any engraving under it, and the capacity and fine print near the bottom.
    g.font = font(500, 10.5);
    g.fillText('iPod', w / 2, top(0.47));
    const lines = (back.lines || []).slice(0, 2);
    g.font = font(400, 3);
    lines.forEach((l, i) => g.fillText(l, w / 2, top(0.565) + i * 4.4 * u));
    g.font = font(500, 3.4);
    g.fillText(back.capacity || '30GB', w / 2, top(0.82));
    // Fine print and marks.
    g.font = font(400, 1.25);
    const fy = top(0.86);
    g.fillText('Designed in California. Assembled on your desktop.', w / 2, fy);
    g.fillText(`Model No.: A1136  EMC No.: 2065  Serial No.: ${back.serial || ''}`, w / 2, fy + 1.85 * u);
    g.fillText('Rated 5-30V ⎓ 1A Max.', w / 2, fy + 3.7 * u);
    const my = fy + 7 * u;
    g.textBaseline = 'middle';
    g.font = font(700, 2.4);
    g.fillText('FC', w / 2 - 7 * u, my);
    g.fillText('CE', w / 2 - 2.4 * u, my);
    g.lineWidth = 0.2 * u;
    roundRectPath(g, w / 2 + 1.1 * u, my - 1.2 * u, 3.6 * u, 2.4 * u, 0.35 * u);
    g.stroke();
    g.font = font(700, 1.3);
    g.fillText('VCI', w / 2 + 2.9 * u, my);
    g.beginPath();
    g.arc(w / 2 + 7 * u, my, 1.1 * u, 0, Math.PI * 2);
    g.stroke();
    g.font = font(700, 1.4);
    g.fillText('✓', w / 2 + 7 * u, my + 0.05 * u);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const plane = new THREE.PlaneGeometry(w, h);
    plane.rotateY(Math.PI); // readable from behind
    const mesh = new THREE.Mesh(plane, decalMaterial(tex));
    mesh.position.set(0, 0, z);
    this.pivot.add(mesh);
  }

  // ------------------------------------------------------------- per frame --

  /** Same transform the rig gives the HTML face (converted from CSS's y-down). */
  update({ rx, yaw, rz, scale, half, room }) {
    this.state = { rx, yaw, rz, scale, half, room };
    if (!this.ok) return;
    const rxr = room ? room.x : 0;
    const ryr = room ? room.y : 0;
    // Nothing you could see has changed: don't draw.
    const key = `${rx},${yaw},${rz},${scale},${half},${rxr},${ryr},${this._dpr()}`;
    if (key === this._drawn) return;
    this._drawn = key;
    const m = this.pivot.matrix.makeTranslation(0, 0, -half);
    const t = this._tmp || (this._tmp = new THREE.Matrix4());
    m.multiply(t.makeRotationX(-rx * DEG));
    m.multiply(t.makeRotationY(yaw * DEG));
    m.multiply(t.makeRotationZ(-rz * DEG));
    m.multiply(t.makeTranslation(0, 0, half));
    m.multiply(t.makeScale(scale, scale, 1));
    this.pivot.matrixWorldNeedsUpdate = true;
    // Keep the room's lights where they are as the iPod moves around the desktop.
    this.scene.environmentRotation.set(ryr * 0.25, rxr * 0.45, 0);
    this.render();
  }

  /** The pixel ratio to draw at: the screen's, unless this GPU has shown it can't keep up. */
  _dpr() {
    return Math.min(2, window.devicePixelRatio || 1, this.dprCap || Infinity);
  }

  /**
   * Motion is running slowly: draw fewer pixels (2x → 1.5x → 1x). Returns
   * false when there's nothing left to give.
   */
  lighten() {
    if (!this.ok) return false;
    const now = this.renderer.getPixelRatio();
    const floor = Math.min(1, window.devicePixelRatio || 1);
    if (now <= floor + 0.01) return false;
    this.dprCap = Math.max(floor, now > 1.5 ? 1.5 : 1);
    this.render();
    return true;
  }

  render() {
    if (!this.ok) return;
    // Moved to a screen with different scaling: re-render sharp.
    const dpr = this._dpr();
    if (this.renderer.getPixelRatio() !== dpr) this.renderer.setPixelRatio(dpr);
    this.renderer.render(this.scene, this.camera);
  }

  /** The nearest part of the body under the pointer (client coordinates), or null. */
  _pick(clientX, clientY) {
    if (!this.ok) return null;
    const r = this.canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    if (!this._raycaster) this._raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._raycaster.setFromCamera(ndc, this.camera);
    this.pivot.updateMatrixWorld(true);
    if (!this._targets) {
      this._targets = [];
      this.pivot.traverse((n) => n.userData.hit && this._targets.push(n));
    }
    const hits = this._raycaster.intersectObjects(this._targets, false);
    return hits.length ? hits[0].object : null;
  }

  /** Is the pointer over the body? */
  hitTest(clientX, clientY) {
    return !!this._pick(clientX, clientY);
  }

  /** Is the pointer on the hold switch's slider? */
  hitSlider(clientX, clientY) {
    const hit = this._pick(clientX, clientY);
    return !!hit && hit === this.slider;
  }
}

// ------------------------------------------------------------------ helpers --

/**
 * What the steel and the glossy plastic reflect: a dim studio with a big soft
 * box to the upper left, long strip lights (they draw the bright streaks along
 * the edges), a window-ish panel behind on the right and a warm bounce from
 * the desk. Lit shapes with dark gaps between them, like a product shot.
 */
function studioEnvironment() {
  const scene = new THREE.Scene();
  // A real room is fairly bright: grey walls, a lighter ceiling, a warm desk,
  // and a darker band low down behind you. Mirror steel shows all of it.
  const room = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshBasicMaterial({ color: 0x55585f, side: THREE.BackSide }));
  scene.add(room);
  const light = (w, h, intensity, pos, look, tint = 0xffffff) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(intensity), side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(...pos);
    m.lookAt(...look);
    scene.add(m);
  };
  light(11.8, 11.8, 1.25, [0, 5.95, 0], [0, 0, 0], 0xf4f5f8); // ceiling
  light(11.8, 11.8, 0.42, [0, -5.95, 0], [0, 0, 0], 0xc9a77c); // desk
  // The walls in front of and behind the iPod carry horizontal bands: bright
  // above eye level, a soft horizon, darker below. A flat face reflects about
  // ±5° of them at rest and sweeps through ±20° as it tilts, so these give the
  // mirror back its bright-to-dark gradient and make it move.
  for (const z of [5.95, -5.95]) {
    light(11.8, 5.6, 1.15, [0, 3.2, z], [0, 3.2, 0], 0xf3f5f8);
    light(11.8, 1.0, 0.6, [0, -0.1, z], [0, -0.1, 0], 0xd5d9df);
    light(11.8, 5.4, 0.12, [0, -3.3, z], [0, -3.3, 0], 0x8f959f);
  }
  light(5, 3.6, 6, [-3.2, 3.4, 3.6], [0, 0, 0]); // key soft box, upper left in front
  light(9, 0.35, 10, [0, 5.4, 0.6], [0, 0, 0.6]); // strip across the ceiling
  light(0.35, 7, 7, [-5.4, 0.4, 1.2], [0, 0.4, 1.2]); // tall strip on the left
  light(0.3, 6, 4, [5.4, 0.8, -1.5], [0, 0.8, -1.5]); // thin strip right, behind
  light(3.2, 4.2, 2.6, [3.6, 1.2, -4.4], [0, 0, 0], 0xdfe8ff); // cool panel behind right
  light(1.6, 2.2, 8, [2.8, 2.4, 5.8], [2.8, 2.4, 0]); // small bright window behind you
  light(1.2, 1.8, 6, [-2.4, 1.6, -5.8], [-2.4, 1.6, 0]); // and one behind the iPod
  return scene;
}

/** Printed or etched marks: matte, non-metallic, drawn just above the surface. */
function decalMaterial(map) {
  return new THREE.MeshStandardMaterial({ map, transparent: true, metalness: 0, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
}

/** A rounded rectangle Shape centred on the origin (half extents). */
function roundedRect(hw, hh, r) {
  const s = new THREE.Shape();
  rrect(s, 0, 0, hw, hh, r);
  return s;
}

function roundedRectPath(cx, cy, hw, hh, r) {
  const p = new THREE.Path();
  rrect(p, cx, cy, hw, hh, r);
  return p;
}

function rrect(p, cx, cy, hw, hh, r) {
  r = Math.min(r, hw, hh);
  p.moveTo(cx - hw + r, cy - hh);
  p.lineTo(cx + hw - r, cy - hh);
  p.absarc(cx + hw - r, cy - hh + r, r, -Math.PI / 2, 0, false);
  p.lineTo(cx + hw, cy + hh - r);
  p.absarc(cx + hw - r, cy + hh - r, r, 0, Math.PI / 2, false);
  p.lineTo(cx - hw + r, cy + hh);
  p.absarc(cx - hw + r, cy + hh - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(cx - hw, cy - hh + r);
  p.absarc(cx - hw + r, cy - hh + r, r, Math.PI, Math.PI * 1.5, false);
}

function circlePath(cx, cy, r) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}

function planarUv(geo, fn) {
  const pos = geo.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const [s, t] = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    uvs[i * 2] = s;
    uvs[i * 2 + 1] = t;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

function flipUvX(geo) {
  const uvs = geo.attributes.uv;
  for (let i = 0; i < uvs.count; i++) uvs.setX(i, 1 - uvs.getX(i));
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
