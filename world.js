// world.js — an empty early-2000s city at dusk: box buildings with window textures,
// street lamps, traffic lights, crosswalks, neon signs, wires, fences, small trees.
// Everything is generated in code (canvas textures + primitives), no asset files.
import * as THREE from './vendor/three.module.js';

// ---------------------------------------------------------------------------
// Navigation graph. Sidewalks run along z = ±6; crosswalks at x = ±6 and z = ±6.
// ---------------------------------------------------------------------------
export const NODES = {
  nW: { x: -6, z: -6 }, nE: { x: 6, z: -6 }, sW: { x: -6, z: 6 }, sE: { x: 6, z: 6 },
  home: { x: -17, z: -6 }, library: { x: 15, z: -6 }, park: { x: 31, z: -6 },
  cafe: { x: -15, z: 6 }, shop: { x: 17, z: 6 },
};

const EDGES = [
  ['home', 'nW'], ['nW', 'nE'], ['nE', 'library'], ['library', 'park'],
  ['nW', 'sW'], ['nE', 'sE'], ['sW', 'cafe'], ['sW', 'sE'], ['sE', 'shop'],
];

// facing = direction from the building towards the street (where the camera goes)
export const LOCATIONS = {
  home: { name: 'Home', emoji: '🏠', verb: null, node: 'home', facing: { x: 0, z: 1 }, label: [-17, 4.6, -8.5] },
  library: { name: 'Library', emoji: '📚', verb: 'Reading', node: 'library', facing: { x: 0, z: 1 }, label: [15, 5.2, -8.5] },
  cafe: { name: 'Internet Café', emoji: '💻', verb: 'Browsing', node: 'cafe', facing: { x: 0, z: -1 }, label: [-15, 5.2, 8.5] },
  park: { name: 'Park', emoji: '🌳', verb: null, node: 'park', facing: { x: 0, z: 1 }, label: [31, 4.2, -8.8] },
  shop: { name: 'Shop', emoji: '🛍️', verb: null, node: 'shop', facing: { x: 0, z: -1 }, label: [17, 5.2, 8.5] },
};

const ADJ = {};
for (const [a, b] of EDGES) {
  (ADJ[a] ??= []).push(b);
  (ADJ[b] ??= []).push(a);
}

/** Shortest path (BFS) between two node ids, as Vector3 points incl. start and end. */
export function findPath(from, to) {
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const n = queue.shift();
    if (n === to) break;
    for (const m of ADJ[n] ?? []) if (!(m in prev)) { prev[m] = n; queue.push(m); }
  }
  if (!(to in prev)) return [];
  const ids = [];
  for (let n = to; n !== null; n = prev[n]) ids.unshift(n);
  return ids.map((id) => new THREE.Vector3(NODES[id].x, 0, NODES[id].z));
}

const ROAD = 4; // half width of both roads
const CURB = 0.15;
/** Height of the walkable ground (sidewalks are raised). */
export function groundHeight(x, z) {
  return Math.abs(x) > ROAD && Math.abs(z) > ROAD ? CURB : 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(2001);
const R = (a, b) => a + rand() * (b - a);
const pickR = (arr) => arr[Math.floor(rand() * arr.length)];

const lamCache = new Map();
function lam(color) {
  if (!lamCache.has(color)) lamCache.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  return lamCache.get(color);
}
const basicCache = new Map();
function basic(color) {
  if (!basicCache.has(color)) basicCache.set(color, new THREE.MeshBasicMaterial({ color }));
  return basicCache.get(color);
}

let scene; // set in createWorld
function add(geo, mat, x = 0, y = 0, z = 0, parent = scene) {
  const m = new THREE.Mesh(geo, typeof mat === 'number' ? lam(mat) : mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const box = (w, h, d, mat, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
const cyl = (rt, rb, h, seg, mat, x, y, z, parent) => add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, parent);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, { repeat = false, nearest = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (nearest) t.magFilter = THREE.NearestFilter;
  t.anisotropy = 4;
  return t;
}

/** Rotation that turns a default +z-facing plane towards direction f. */
const yawOf = (f) => Math.atan2(f.x, f.z);

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------
const WARM = ['#ffd27f', '#ffbe62', '#ffe3a6', '#ff9e5e', '#ffcb8a', '#fff0c4'];
const COOL = ['#cfe8ff', '#a9d4ff', '#bff5e6'];

/** A 8×8 tile of windows: colour map + emissive map (only lit windows glow). */
function windowTextures(style, litP) {
  const S = 256, N = 8, c = S / N;
  const [bc, b] = canvas(S, S);
  const [ec, e] = canvas(S, S);
  b.fillStyle = '#cbc7cf'; b.fillRect(0, 0, S, S);
  for (let i = 0; i < 500; i++) {
    b.fillStyle = `rgba(0,0,0,${R(0.02, 0.08)})`;
    b.fillRect(R(0, S), R(0, S), R(1, 5), R(2, 16));
  }
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  for (let row = 0; row < N; row++) {
    b.fillStyle = 'rgba(0,0,0,0.2)';
    b.fillRect(0, row * c + c - 3, S, 3);
    for (let col = 0; col < N; col++) {
      const x = col * c, y = row * c;
      let wx, wy, ww, wh;
      if (style === 'band') { wx = x; ww = c; wy = y + c * 0.28; wh = c * 0.46; }
      else if (style === 'apt') { wx = x + c * 0.14; ww = c * 0.72; wy = y + c * 0.16; wh = c * 0.5; }
      else { wx = x + c * 0.24; ww = c * 0.52; wy = y + c * 0.16; wh = c * 0.6; }
      if (rand() < litP) {
        const colr = rand() < 0.85 ? pickR(WARM) : pickR(COOL);
        b.fillStyle = colr; b.fillRect(wx, wy, ww, wh);
        e.fillStyle = colr; e.fillRect(wx, wy, ww, wh);
        if (rand() < 0.45) { // half-closed blinds
          const bh = wh * R(0.2, 0.6);
          e.fillStyle = 'rgba(0,0,0,0.6)'; e.fillRect(wx, wy, ww, bh);
          b.fillStyle = 'rgba(0,0,0,0.45)'; b.fillRect(wx, wy, ww, bh);
        }
      } else {
        const g = b.createLinearGradient(0, wy, 0, wy + wh);
        g.addColorStop(0, '#3c4a68'); g.addColorStop(1, '#1b1f2e');
        b.fillStyle = g; b.fillRect(wx, wy, ww, wh);
      }
      b.fillStyle = 'rgba(255,255,255,0.22)'; b.fillRect(wx, wy + wh, ww, 2);
      if (style === 'apt') { b.fillStyle = 'rgba(50,48,60,0.6)'; b.fillRect(x + 2, y + c * 0.66, c - 4, c * 0.26); }
    }
  }
  return { map: tex(bc, { repeat: true }), emissiveMap: tex(ec, { repeat: true }) };
}

function radialTexture() {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return tex(c, { nearest: false });
}

function noiseTexture(base, dots, size = 128) {
  const [c, g] = canvas(size, size);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 8; i++) {
    g.fillStyle = pickR(dots);
    g.fillRect(R(0, size), R(0, size), 1, 1);
  }
  return [c, g];
}

function moonTexture() {
  const [c, g] = canvas(256, 256);
  const grd = g.createRadialGradient(110, 100, 10, 128, 128, 118);
  grd.addColorStop(0, '#fffaf0'); grd.addColorStop(0.7, '#efe4cf'); grd.addColorStop(1, '#d9c9b0');
  g.fillStyle = grd;
  g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.fill();
  g.save(); g.clip();
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(150,130,120,${R(0.08, 0.25)})`;
    g.beginPath(); g.arc(R(20, 236), R(20, 236), R(5, 28), 0, Math.PI * 2); g.fill();
  }
  g.restore();
  return tex(c, { nearest: false });
}

function neonTexture(text, color, vertical) {
  const font = '900 64px "Arial Black", Impact, "Helvetica Neue", sans-serif';
  const chars = [...text];
  const W = vertical ? 110 : Math.max(200, chars.length * 50 + 70);
  const H = vertical ? chars.length * 72 + 40 : 110;
  const [c, g] = canvas(W, H);
  g.fillStyle = 'rgba(14,10,24,0.88)';
  g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 16); g.fill();
  g.strokeStyle = color; g.lineWidth = 4; g.shadowColor = color; g.shadowBlur = 14; g.stroke();
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  const draw = (s, x, y) => {
    g.shadowBlur = 22; g.fillStyle = color; g.fillText(s, x, y);
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillText(s, x, y);
  };
  if (vertical) chars.forEach((ch, i) => draw(ch, W / 2, 56 + i * 72));
  else {
    g.save();
    const fit = Math.min(1, (W - 50) / g.measureText(text).width);
    g.translate(W / 2, H / 2 + 4); g.scale(fit, 1); draw(text, 0, 0);
    g.restore();
  }
  return { texture: tex(c, { nearest: false }), w: W / 100, h: H / 100 };
}

// ---------------------------------------------------------------------------
// Shared materials that animate
// ---------------------------------------------------------------------------
const windowMats = [];
const neonMats = [];
const blinkMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
let glowTex;

const WIN_SETS = [['grid', 0.35], ['grid', 0.55], ['band', 0.4], ['apt', 0.45], ['apt', 0.3], ['grid', 0.22], ['band', 0.7]];
let winTextures;
const WALL_TINTS = [0x8f8a99, 0x737a8c, 0x9e8877, 0xbdae95, 0x63706f, 0x806e88, 0x5c5866, 0xa8a2b4];
const buildingMatCache = new Map();
function buildingMat(set, tint) {
  const key = `${set}:${tint}`;
  if (!buildingMatCache.has(key)) {
    const t = winTextures[set];
    const m = new THREE.MeshLambertMaterial({ color: tint, map: t.map, emissive: 0xffffff, emissiveMap: t.emissiveMap });
    buildingMatCache.set(key, m);
    windowMats.push(m);
  }
  return buildingMatCache.get(key);
}

/** Scale box UVs so one window cell is 3 m wide and 3.2 m tall on every face. */
function scaleBoxUVs(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const ou = Math.floor(rand() * 8) / 8;
  const faceW = [d, d, w, w, w, w];
  const faceH = [h, h, d, d, h, h];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * (faceW[f] / 24) + ou, uv.getY(k) * (faceH[f] / 25.6));
    }
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
function building(x, z, w, d, h, opts = {}) {
  const set = opts.set ?? Math.floor(rand() * WIN_SETS.length);
  const tint = opts.tint ?? pickR(WALL_TINTS);
  const geo = new THREE.BoxGeometry(w, h, d);
  scaleBoxUVs(geo, w, h, d);
  const side = buildingMat(set, tint);
  const roof = lam(0x3a3644);
  add(geo, [side, side, roof, roof, side, side], x, h / 2, z);
  box(w + 0.3, 0.35, d + 0.3, 0x4a4552, x, h + 0.17, z); // cornice
  if (opts.plainRoof) return;
  const n = Math.floor(R(0, 3));
  for (let i = 0; i < n; i++) box(R(1, 2.2), R(0.8, 1.4), R(1, 2.2), 0x6a6672, x + R(-w / 3, w / 3), h + 0.8, z + R(-d / 3, d / 3));
  if (rand() < 0.3) { // water tank
    const tx = x + R(-w / 4, w / 4), tz = z + R(-d / 4, d / 4);
    cyl(1, 1, 1.6, 8, 0x7b7480, tx, h + 2.1, tz);
    for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) box(0.12, 1.3, 0.12, 0x4a4552, tx + dx, h + 0.65, tz + dz);
  }
  if (h > 22 && rand() < 0.6) { // antenna with red aircraft light
    const ax = x + R(-w / 4, w / 4), az = z + R(-d / 4, d / 4), ah = R(4, 8);
    cyl(0.06, 0.1, ah, 4, 0x55505e, ax, h + ah / 2, az);
    add(new THREE.SphereGeometry(0.22, 6, 4), blinkMat, ax, h + ah, az);
  }
}

function neon(text, color, { vertical = false, scale = 1 } = {}) {
  const { texture, w, h } = neonTexture(text, color, vertical);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  neonMats.push(mat);
  return new THREE.Mesh(new THREE.PlaneGeometry(w * scale, h * scale), mat);
}

/** Place a +z-facing object on a building front. */
function onFront(obj, pos, facing, out = 0.06) {
  obj.position.set(pos.x + facing.x * out, pos.y, pos.z + facing.z * out);
  obj.rotation.y = yawOf(facing);
  scene.add(obj);
  return obj;
}

function lightPool(x, z, color, size, opacity = 0.5) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, CURB + 0.03, z);
  m.renderOrder = 1;
  scene.add(m);
}

function halo(x, y, z, color, size, opacity = 0.8) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.position.set(x, y, z);
  s.scale.set(size, size, 1);
  scene.add(s);
}

function streetLamp(x, z, toRoad) {
  const g = groundHeight(x, z);
  cyl(0.08, 0.12, 6, 6, 0x48444f, x, g + 3, z);
  const hx = x + toRoad.x * 1.5, hz = z + toRoad.z * 1.5;
  box(Math.abs(toRoad.x) * 1.6 + 0.1, 0.1, Math.abs(toRoad.z) * 1.6 + 0.1, 0x48444f, (x + hx) / 2, g + 5.95, (z + hz) / 2);
  box(0.7, 0.16, 0.36, basic(0xffe4a8), hx, g + 5.82, hz);
  halo(hx, g + 5.7, hz, 0xffc070, 2.6, 0.75);
  lightPool(hx, hz, 0xffa850, 8, 0.42);
}

function smallTree(x, z, s = 1) {
  const g = groundHeight(x, z);
  box(1.1, 0.4, 1.1, 0x5b5662, x, g + 0.2, z);
  cyl(0.08, 0.12, 1.6 * s, 5, 0x4d3d36, x, g + 0.4 + 0.8 * s, z);
  const crown = pickR([0x2f4a3d, 0x3b4d36, 0x4a3b5a, 0x3a3150]);
  add(new THREE.IcosahedronGeometry(0.95 * s, 0), crown, x, g + 2.4 * s + 0.3, z).rotation.y = R(0, 6);
  add(new THREE.IcosahedronGeometry(0.6 * s, 0), crown, x + 0.35 * s, g + 3.1 * s + 0.3, z + 0.1).rotation.y = R(0, 6);
}

function fence(x1, z1, x2, z2, color = 0xc49aa4, h = 1.0) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const yaw = -Math.atan2(z2 - z1, x2 - x1);
  const gy = groundHeight((x1 + x2) / 2, (z1 + z2) / 2);
  for (const y of [h, h * 0.55]) {
    const r = box(len, 0.08, 0.08, color, (x1 + x2) / 2, gy + y, (z1 + z2) / 2);
    r.rotation.y = yaw;
  }
  const n = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    box(0.09, h, 0.09, color, x1 + (x2 - x1) * t, gy + h / 2, z1 + (z2 - z1) * t);
  }
}

function bench(x, z, yaw) {
  const g = new THREE.Group();
  g.position.set(x, groundHeight(x, z), z); g.rotation.y = yaw; scene.add(g);
  box(1.6, 0.08, 0.45, 0x7a5a48, 0, 0.45, 0, g);
  box(1.6, 0.35, 0.06, 0x7a5a48, 0, 0.72, -0.2, g);
  for (const sx of [-0.65, 0.65]) box(0.08, 0.45, 0.4, 0x48444f, sx, 0.22, 0, g);
}

let vendingTex;
function vendingMachine(x, z, facing, body = 0xd8d4de) {
  if (!vendingTex) {
    const [c, g] = canvas(64, 128);
    g.fillStyle = '#eaf4ff'; g.fillRect(0, 0, 64, 128);
    const cols = ['#ff5a5a', '#3a7bff', '#ffd23e', '#33c46b', '#ff8a3a', '#b46bff'];
    for (let r = 0; r < 4; r++) for (let i = 0; i < 5; i++) {
      g.fillStyle = pickR(cols); g.fillRect(6 + i * 11, 10 + r * 18, 7, 13);
    }
    g.fillStyle = '#2a2a3a'; g.fillRect(6, 90, 52, 26);
    vendingTex = tex(c);
  }
  const gy = groundHeight(x, z);
  const grp = new THREE.Group(); grp.position.set(x, gy, z); grp.rotation.y = yawOf(facing); scene.add(grp);
  box(1.0, 1.9, 0.75, body, 0, 0.95, 0, grp);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.6), new THREE.MeshBasicMaterial({ map: vendingTex }));
  front.position.set(0, 1.0, 0.38); grp.add(front);
  lightPool(x + facing.x * 1.2, z + facing.z * 1.2, 0x9ccfff, 3.5, 0.35);
}

// Traffic lights: two phases (main road / cross road)
const signal = { main: [], cross: [], ped: [] };
const LAMP_OFF = new THREE.Color(0x2a2228);
function trafficLight(x, z, armDir, faceDir, group) {
  const g = groundHeight(x, z);
  cyl(0.1, 0.12, 5.6, 6, 0x5a5562, x, g + 2.8, z);
  const ax = x + armDir.x * 3, az = z + armDir.z * 3;
  const arm = box(3.2, 0.12, 0.12, 0x5a5562, (x + ax) / 2, g + 5.4, (z + az) / 2);
  arm.rotation.y = -Math.atan2(armDir.z, armDir.x);
  const head = new THREE.Group();
  head.position.set(ax, g + 5.15, az);
  head.rotation.y = yawOf(faceDir);
  scene.add(head);
  box(1.3, 0.42, 0.32, 0xb88d86, 0, 0, 0, head); // the faded salmon housing from the refs
  const lamps = [0x40ff9a, 0xffc21a, 0xff3a2a].map((on, i) => {
    const m = new THREE.MeshBasicMaterial({ color: LAMP_OFF });
    m.userData.on = new THREE.Color(on);
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.13, 10), m);
    l.position.set(-0.4 + i * 0.4, 0, 0.17);
    head.add(l);
    return m;
  });
  signal[group].push(lamps);
  const ped = new THREE.Group();
  ped.position.set(x, g + 2.6, z); ped.rotation.y = yawOf({ x: -faceDir.z, z: faceDir.x });
  scene.add(ped);
  box(0.4, 0.7, 0.25, 0xb88d86, 0, 0, 0, ped);
  const pm = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.5), pm);
  p.position.z = 0.13; ped.add(p);
  signal.ped.push({ mat: pm, group });
}

function crosswalk(cx, cz, alongX) {
  for (let s = -3.4; s <= 3.41; s += 1.0) {
    if (alongX) box(3, 0.02, 0.5, 0xd8d4dc, cx, 0.012, cz + s);
    else box(0.5, 0.02, 3, 0xd8d4dc, cx + s, 0.012, cz);
  }
}

// Utility poles with sagging wires
function wireBetween(a, b, sag, mat) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag, a.z + (b.z - a.z) * t));
  }
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
}
function utilityPoles(xs, z) {
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1622 });
  for (const x of xs) {
    const g = groundHeight(x, z);
    cyl(0.14, 0.18, 9, 6, 0x5b4a40, x, g + 4.5, z);
    box(0.1, 0.12, 1.8, 0x5b4a40, x, g + 8.3, z);
    cyl(0.25, 0.25, 0.7, 6, 0x6d6874, x, g + 7.2, z + 0.35);
  }
  for (let i = 0; i < xs.length - 1; i++) {
    for (const [dz, y] of [[-0.75, 8.35], [0.75, 8.35], [0, 7.6]]) {
      wireBetween(new THREE.Vector3(xs[i], y, z + dz), new THREE.Vector3(xs[i + 1], y, z + dz), 0.5, wireMat);
    }
  }
}

// ---------------------------------------------------------------------------
// Street rows of buildings
// ---------------------------------------------------------------------------
const SIGN_WORDS = ['KARAOKE', 'RAMEN', 'HOTEL', 'BAR', 'ARCADE', 'SUSHI', 'VIDEO', 'PHOTO', 'CLINIC', 'NOODLE', 'DISCO', 'LAUNDRY'];
const NEON_COLORS = ['#ff4fd8', '#3ef0ff', '#ff5a5a', '#7dff6a', '#ffd23e', '#b56bff', '#ff8a3a'];

/**
 * A row of buildings along a street.
 * axis 'x': main road, front plane at z = side * 8.5; axis 'z': cross road, front at x = side * 8.5.
 */
function row(axis, from, to, side, reserved = [], storefrontChance = 0.35) {
  const facing = axis === 'x' ? { x: 0, z: -side } : { x: -side, z: 0 };
  const front = side * 8.5;
  const fp = (along, y) => (axis === 'x' ? { x: along, y, z: front } : { x: front, y, z: along });
  let pos = from;
  while (pos < to - 4) {
    const w = Math.min(pickR([6, 9, 9, 12, 12, 15]), to - pos);
    const hit = reserved.find(([a, b]) => pos < b && pos + w > a);
    if (hit) { pos = hit[1] + R(0.3, 1); continue; }
    const d = pickR([9, 12, 15, 18]);
    const h = Math.round(R(2.5, 9.5)) * 3.2;
    const c = pos + w / 2;
    const cx = axis === 'x' ? c : side * (8.5 + d / 2);
    const cz = axis === 'x' ? side * (8.5 + d / 2) : c;
    building(cx, cz, w, d, h);

    if (rand() < storefrontChance && w >= 6) {
      const col = pickR([0xffe2b0, 0xfff1d8, 0xcfe6ff, 0xffc6a0, 0xd8ffe8]);
      onFront(new THREE.Mesh(new THREE.PlaneGeometry(w - 1.4, 2.4), basic(col)), fp(c, CURB + 1.3), facing);
      const p = fp(c, 0);
      if (rand() < 0.5) {
        box(axis === 'x' ? w - 0.8 : 1.2, 0.15, axis === 'x' ? 1.2 : w - 0.8, pickR([0x7a3644, 0x2f5a4a, 0x35406e, 0x6a5a2a]),
          p.x + facing.x * 0.6, CURB + 2.9, p.z + facing.z * 0.6);
      }
      lightPool(p.x + facing.x * 1.5, p.z + facing.z * 1.5, col, 5, 0.3);
      if (rand() < 0.6) onFront(neon(pickR(SIGN_WORDS), pickR(NEON_COLORS), { scale: 0.75 }), fp(c, CURB + 3.6), facing, 0.1);
    }
    if (h > 12 && rand() < 0.3) {
      // blade sign sticking out of the facade
      const sign = neon(pickR(SIGN_WORDS), pickR(NEON_COLORS), { vertical: true, scale: 0.9 });
      onFront(sign, fp(pos + 0.8, CURB + 6 + rand() * 4), facing, 0.6);
      sign.rotation.y += Math.PI / 2;
    }
    pos += w + R(0, 0.8);
  }
}

// ---------------------------------------------------------------------------
// Landmark buildings
// ---------------------------------------------------------------------------
function buildHome() {
  building(-17, -15.5, 12, 14, 19.2, { set: 3, tint: 0x9e8877 });
  const f = { x: 0, z: 1 };
  onFront(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.4), basic(0xffd890)), { x: -17, y: CURB + 1.2, z: -8.5 }, f);
  box(4, 0.2, 1.8, 0x4a4552, -17, CURB + 2.8, -7.7);
  halo(-17, CURB + 2.6, -7.5, 0xffd890, 2.2, 0.5);
  onFront(neon('MOONLIGHT APTS', '#ffe6b0', { scale: 0.7 }), { x: -17, y: CURB + 3.5, z: -8.5 }, f, 0.12);
  lightPool(-17, -7, 0xffc880, 5, 0.45);
  for (let i = 0; i < 4; i++) box(0.35, 0.3, 0.25, 0x8a8494, -19.3 + (i % 2) * 0.38, CURB + 1.2 + Math.floor(i / 2) * 0.32, -8.35);
  for (const x of [-20.5, -13.5]) {
    cyl(0.35, 0.28, 0.6, 6, 0x6a5a50, x, CURB + 0.3, -8.0);
    add(new THREE.IcosahedronGeometry(0.5, 0), 0x2f4a3d, x, CURB + 0.95, -8.0);
  }
  vendingMachine(-12.4, -8.0, f, 0xc23a3a);
  vendingMachine(-11.3, -8.0, f);
}

function buildLibrary() {
  building(15, -16.5, 12, 16, 9.6, { set: 6, tint: 0xbdae95, plainRoof: true });
  const f = { x: 0, z: 1 };
  onFront(new THREE.Mesh(new THREE.PlaneGeometry(7, 2.8), basic(0xffe2a8)), { x: 15, y: CURB + 1.5, z: -8.5 }, f);
  for (const x of [10.6, 13.2, 16.8, 19.4]) cyl(0.28, 0.32, 3.6, 8, 0xd8d0c0, x, CURB + 1.8, -6.9);
  box(10.4, 0.45, 2.4, 0xcfc6b4, 15, CURB + 3.8, -7.6);
  onFront(neon('CITY LIBRARY', '#ffe9c2', { scale: 0.85 }), { x: 15, y: CURB + 4.45, z: -6.4 }, f, 0.02);
  box(8, 0.12, 1.2, 0x8a8494, 15, CURB + 0.06, -7.2);
  lightPool(15, -6.5, 0xffd8a0, 9, 0.4);
  box(0.8, 1.1, 0.6, 0x35406e, 11.5, CURB + 0.55, -5.0); // book return box
}

function buildPark() {
  box(14, 0.12, 15.5, 0x2e4636, 31, CURB + 0.06, -16.3);
  const fc = 0x9aa69a;
  fence(24, -8.6, 29.4, -8.6, fc);
  fence(32.6, -8.6, 38, -8.6, fc);
  fence(24, -8.6, 24, -24, fc);
  fence(38, -8.6, 38, -24, fc);
  for (const x of [29.4, 32.6]) box(0.3, 3.2, 0.3, 0x5a5562, x, CURB + 1.6, -8.6);
  box(3.6, 0.25, 0.3, 0x5a5562, 31, CURB + 3.2, -8.6);
  onFront(neon('CITY PARK', '#7dff9a', { scale: 0.55 }), { x: 31, y: CURB + 3.65, z: -8.6 }, { x: 0, z: 1 }, 0.1);
  for (const [x, z, s] of [[26, -12, 1.2], [36, -11.5, 1.0], [27.5, -20, 1.3], [35, -21, 1.1], [31, -23, 0.9], [25.8, -16.5, 0.8]]) smallTree(x, z, s);
  bench(29, -14, 0); bench(33, -14, 0);
  bench(31, -19.5, Math.PI);
  cyl(0.06, 0.08, 3.4, 6, 0x48444f, 31, CURB + 1.7, -16.5);
  box(0.4, 0.3, 0.4, basic(0xfff0c8), 31, CURB + 3.5, -16.5);
  halo(31, CURB + 3.5, -16.5, 0xffe0a0, 2, 0.7);
  lightPool(31, -16.5, 0xffd8a0, 7, 0.4);
  // swing set
  for (const x of [33.5, 36.5]) {
    for (const dz of [-0.6, 0.6]) {
      const leg = box(0.1, 2.6, 0.1, 0x7a3644, x, CURB + 1.25, -17.5 + dz);
      leg.rotation.x = dz > 0 ? -0.2 : 0.2;
    }
  }
  box(3.2, 0.12, 0.12, 0x7a3644, 35, CURB + 2.5, -17.5);
  for (const x of [34.4, 35.6]) {
    box(0.03, 1.8, 0.03, 0x2a2630, x - 0.25, CURB + 1.6, -17.5);
    box(0.03, 1.8, 0.03, 0x2a2630, x + 0.25, CURB + 1.6, -17.5);
    box(0.6, 0.06, 0.25, 0x4a4552, x, CURB + 0.7, -17.5);
  }
  vendingMachine(36.8, -9.4, { x: 0, z: 1 }, 0x3a6fd0);
}

function buildCafe() {
  building(-15, 15.5, 12, 14, 12.8, { set: 1, tint: 0x737a8c });
  const f = { x: 0, z: -1 };
  onFront(new THREE.Mesh(new THREE.PlaneGeometry(9, 2.5), basic(0x3f9cc8)), { x: -15, y: CURB + 1.3, z: 8.5 }, f);
  box(10, 0.15, 1.4, 0x2a2440, -15, CURB + 2.85, 7.8);
  onFront(neon('NET CAFÉ', '#ff4fd8', { scale: 0.9 }), { x: -15, y: CURB + 3.7, z: 8.5 }, f, 0.12);
  onFront(neon('24H · WI-FI', '#3ef0ff', { scale: 0.45 }), { x: -11.2, y: CURB + 3.6, z: 8.5 }, f, 0.12);
  lightPool(-15, 7, 0x60c8ff, 9, 0.45);
}

function buildShop() {
  box(12, 4.6, 12, 0xdcd8e2, 17, 2.3, 14.5);
  box(12.2, 0.3, 12.2, 0x9a96a2, 17, 4.75, 14.5);
  building(17, 28, 12, 12, 22.4);
  const f = { x: 0, z: -1 };
  box(12.1, 0.35, 0.1, basic(0x3fae6a), 17, 3.55, 8.45);
  box(12.1, 0.25, 0.1, basic(0x3a6fd0), 17, 3.2, 8.45);
  box(12.1, 0.2, 0.1, basic(0xff8a3a), 17, 2.95, 8.45);
  onFront(new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), basic(0xeef7ff)), { x: 17, y: CURB + 1.3, z: 8.5 }, f, 0.1);
  onFront(neon('24H SHOP', '#7dff6a', { scale: 0.8 }), { x: 17, y: 4.25, z: 8.5 }, f, 0.12);
  lightPool(17, 6.5, 0xd8ecff, 11, 0.5);
  for (const x of [12.2, 21.8]) cyl(0.25, 0.25, 0.8, 8, 0xb8b4c0, x, CURB + 0.4, 7.6);
  vendingMachine(22.5, 7.9, f, 0x3fae6a);
  // phone booth
  const pb = box(1, 2.3, 1, new THREE.MeshLambertMaterial({ color: 0x5fd19a, transparent: true, opacity: 0.55 }), 9.6, CURB + 1.15, 7.8);
  pb.renderOrder = 2;
  box(1.05, 0.2, 1.05, 0x3fae6a, 9.6, CURB + 2.4, 7.8);
}

// ---------------------------------------------------------------------------
// Public: build the whole world
// ---------------------------------------------------------------------------
export function createWorld() {
  scene = new THREE.Scene();
  glowTex = radialTexture();
  winTextures = WIN_SETS.map(([s, p]) => windowTextures(s, p));

  // Ground: asphalt + raised sidewalk blocks
  const [ac] = noiseTexture('#34303c', ['#2a2731', '#3c3845', '#2f2b36', '#413c49']);
  const asphalt = tex(ac, { repeat: true });
  asphalt.repeat.set(120, 120);
  add(new THREE.PlaneGeometry(500, 500), new THREE.MeshLambertMaterial({ map: asphalt }), 0, 0, 0).rotation.x = -Math.PI / 2;

  const [sc, sg] = noiseTexture('#6a6470', ['#5e5964', '#736d7a', '#645f6b'], 64);
  sg.fillStyle = 'rgba(30,26,36,0.55)'; sg.fillRect(0, 0, 64, 2); sg.fillRect(0, 0, 2, 64);
  const swTex = tex(sc, { repeat: true });
  swTex.repeat.set(98, 98);
  const swMat = new THREE.MeshLambertMaterial({ map: swTex });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(196, CURB, 196, swMat, sx * (ROAD + 98), CURB / 2, sz * (ROAD + 98));
  }
  for (const s of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      box(196, CURB + 0.01, 0.25, 0x8d8794, s2 * (ROAD + 98), CURB / 2, s * (ROAD + 0.12));
      box(0.25, CURB + 0.01, 196, 0x8d8794, s * (ROAD + 0.12), CURB / 2, s2 * (ROAD + 98));
    }
  }

  // Road markings
  const yellow = 0xc9a64a, white = 0xcfcad6;
  for (const s of [-1, 1]) {
    for (const zz of [-0.13, 0.13]) box(190, 0.02, 0.1, yellow, s * (8 + 95), 0.01, zz);
    box(190, 0.02, 0.12, white, s * (8 + 95), 0.01, 3.6);
    box(190, 0.02, 0.12, white, s * (8 + 95), 0.01, -3.6);
    for (let z = 10; z < 190; z += 6) box(0.12, 0.02, 3, white, 0, 0.01, s * z);
    box(0.4, 0.02, 3.6, white, s * 8, 0.012, -s * 1.9); // stop lines
    box(3.6, 0.02, 0.4, white, s * 1.9, 0.012, s * 8);
  }
  crosswalk(-6, 0, true); crosswalk(6, 0, true);
  crosswalk(0, -6, false); crosswalk(0, 6, false);

  trafficLight(-4.6, -4.6, { x: 0, z: 1 }, { x: -1, z: 0 }, 'main');
  trafficLight(4.6, 4.6, { x: 0, z: -1 }, { x: 1, z: 0 }, 'main');
  trafficLight(4.6, -4.6, { x: -1, z: 0 }, { x: 0, z: -1 }, 'cross');
  trafficLight(-4.6, 4.6, { x: 1, z: 0 }, { x: 0, z: 1 }, 'cross');

  buildHome();
  buildLibrary();
  buildPark();
  buildCafe();
  buildShop();

  row('x', -92, -8.5, -1, [[-23.5, -10.5]]);
  row('x', 8.5, 92, -1, [[8.5, 21.5], [23.5, 38.5]]);
  row('x', -92, -8.5, 1, [[-21.5, -8.5]]);
  row('x', 8.5, 92, 1, [[10.5, 23.5]]);
  for (const side of [-1, 1]) {
    row('z', -92, -27, side, [], 0.25);
    row('z', 27, 92, side, [], 0.25);
  }

  // Distant towers (fade into the fog)
  for (let i = 0; i < 46; i++) {
    const a = R(0, Math.PI * 2), r = R(60, 170);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 14 || Math.abs(z) < 14) continue;
    building(x, z, pickR([12, 15, 18, 24]), pickR([12, 15, 18]), Math.round(R(10, 26)) * 3.2);
  }

  // Street furniture
  // Keep the close-up camera's line of sight to the being free at every location.
  const nearSpot = (x, zSign) => Object.values(LOCATIONS).some((l) => Math.sign(NODES[l.node].z) === zSign && Math.abs(NODES[l.node].x - x) < 4.5);
  for (let x = -88; x <= 88; x += 16) {
    if (Math.abs(x) > 9 && !nearSpot(x, -1)) streetLamp(x, -4.6, { x: 0, z: 1 });
    if (Math.abs(x + 8) > 9 && !nearSpot(x + 8, 1)) streetLamp(x + 8, 4.6, { x: 0, z: -1 });
  }
  for (let z = 12; z <= 88; z += 16) {
    for (const s of [-1, 1]) {
      streetLamp(-4.6, s * z, { x: 1, z: 0 });
      streetLamp(4.6, s * (z + 8), { x: -1, z: 0 });
    }
  }
  const nodeXs = Object.values(NODES).map((n) => n.x);
  for (let x = -84; x <= 84; x += 16) {
    if (Math.abs(x) < 10 || (x > 23 && x < 39)) continue;
    if (nodeXs.some((nx) => Math.abs(nx - x) < 3)) continue;
    for (const z of [-7.4, 7.4]) smallTree(x, z, R(0.8, 1.1));
  }
  const poleXs = [];
  for (let x = -90; x <= 90; x += 20) if (Math.abs(x) > 9) poleXs.push(x);
  utilityPoles(poleXs.filter((x) => x < 0 && !nearSpot(x, 1)), 4.5);
  utilityPoles(poleXs.filter((x) => x > 0 && !nearSpot(x, 1)), 4.5);

  fence(-60, -4.35, -26, -4.35);
  fence(40, -4.35, 72, -4.35);
  fence(-70, 4.35, -24, 4.35);
  fence(26, 4.35, 60, 4.35);
  for (const s of [-1, 1]) fence(-4.35, s * 30, -4.35, s * 70);

  // ---------- Sky: gradient dome, big moon, a few stars ----------
  const sky = new THREE.Group();
  const skyUniforms = {
    top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
    glowColor: { value: new THREE.Color(0xff7a3a) }, glowStrength: { value: 0.6 },
    glowDir: { value: new THREE.Vector3(-1, 0, 0.1).normalize() },
  };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 16), new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 glowColor; uniform vec3 glowDir; uniform float glowStrength;
      varying vec3 vDir;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        c = mix(c, top, smoothstep(0.22, 0.75, h));
        float g = pow(max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), glowDir), 0.0), 3.0) * (1.0 - smoothstep(0.0, 0.4, h));
        c += glowColor * g * glowStrength;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  dome.renderOrder = -10;
  sky.add(dome);

  const moonDir = new THREE.Vector3(-1, 0.27, 0.03).normalize();
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), fog: false, depthWrite: false, transparent: true }));
  moon.position.copy(moonDir).multiplyScalar(380);
  moon.scale.set(46, 46, 1);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe8d0, fog: false, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  moonHalo.position.copy(moon.position);
  moonHalo.scale.set(170, 170, 1);
  sky.add(moonHalo, moon);

  const starPos = [];
  for (let i = 0; i < 260; i++) {
    const a = R(0, Math.PI * 2), e = R(0.25, 1.4);
    starPos.push(Math.cos(a) * Math.cos(e) * 420, Math.sin(e) * 420, Math.sin(a) * Math.cos(e) * 420);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.4, fog: false, depthWrite: false });
  sky.add(new THREE.Points(starGeo, starMat));
  scene.add(sky);

  // ---------- Lights (no shadow maps: cheap, and true to the era) ----------
  const hemi = new THREE.HemisphereLight(0x8a78c0, 0x2a2236, 1.2);
  const ambient = new THREE.AmbientLight(0x40304a, 0.5);
  const moonLight = new THREE.DirectionalLight(0x9fb0ff, 0.7);
  moonLight.position.copy(moonDir).multiplyScalar(50);
  const sunset = new THREE.DirectionalLight(0xff8a50, 1.2);
  sunset.position.copy(skyUniforms.glowDir.value).multiplyScalar(50).setY(8);
  scene.add(hemi, ambient, moonLight, sunset);

  scene.fog = new THREE.Fog(0x6a4a7a, 25, 150);

  // ---------- Time of day: 0 = dusk, 0.5 = evening, 1 = night ----------
  const key = (a, b, c) => [new THREE.Color(a), new THREE.Color(b), new THREE.Color(c)];
  const TOP = key(0x3a2d70, 0x241d52, 0x0d0a24);
  const MID = key(0x8a4f90, 0x5e3c7e, 0x2a1f4e);
  const HOR = key(0xff9a6a, 0xd9708a, 0x56335f);
  const FOG = key(0xa06684, 0x7a4f80, 0x2e2244);
  const pick = (keys, t, out) =>
    t < 0.5 ? out.lerpColors(keys[0], keys[1], t * 2) : out.lerpColors(keys[1], keys[2], (t - 0.5) * 2);

  function setTimeOfDay(t) {
    t = THREE.MathUtils.clamp(t, 0, 1);
    pick(TOP, t, skyUniforms.top.value);
    pick(MID, t, skyUniforms.mid.value);
    pick(HOR, t, skyUniforms.horizon.value);
    pick(FOG, t, scene.fog.color);
    skyUniforms.glowStrength.value = THREE.MathUtils.lerp(0.75, 0.04, t);
    scene.fog.far = THREE.MathUtils.lerp(160, 120, t);
    sunset.intensity = THREE.MathUtils.lerp(1.3, 0, t);
    hemi.intensity = THREE.MathUtils.lerp(1.3, 0.75, t);
    moonLight.intensity = THREE.MathUtils.lerp(0.4, 0.8, t);
    starMat.opacity = THREE.MathUtils.lerp(0.1, 0.85, t);
    for (const m of windowMats) m.emissiveIntensity = THREE.MathUtils.lerp(0.75, 1.2, t);
  }

  // Traffic light cycle: main green 8s, yellow 2s, then cross road green 8s, yellow 2s
  const setLamps = (lamps, idx) => lamps.forEach((m, i) => m.color.copy(i === idx ? m.userData.on : LAMP_OFF));
  let lastPhase = -1;
  let flicker = null;

  function update(dt, t, camera) {
    sky.position.copy(camera.position);

    const c = t % 20;
    const phase = c < 8 ? 0 : c < 10 ? 1 : c < 18 ? 2 : 3;
    if (phase !== lastPhase) {
      lastPhase = phase;
      const mainIdx = phase === 0 ? 0 : phase === 1 ? 1 : 2;
      const crossIdx = phase === 2 ? 0 : phase === 3 ? 1 : 2;
      signal.main.forEach((l) => setLamps(l, mainIdx));
      signal.cross.forEach((l) => setLamps(l, crossIdx));
      for (const p of signal.ped) {
        const walk = p.group === 'main' ? phase === 2 : phase === 0;
        p.mat.color.setHex(walk ? 0x40ff9a : 0xff3a2a);
      }
    }

    blinkMat.color.setHex(Math.sin(t * 2.5) > 0.6 ? 0xff3030 : 0x401010);

    // One tired neon sign flickers now and then
    if (!flicker && Math.random() < dt * 0.4 && neonMats.length) flicker = { m: pickR(neonMats), until: t + R(0.3, 1.2) };
    if (flicker) {
      flicker.m.opacity = Math.random() < 0.5 ? 0.25 : 1;
      if (t > flicker.until) { flicker.m.opacity = 1; flicker = null; }
    }
  }

  return { scene, setTimeOfDay, update };
}
