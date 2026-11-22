// world.js — the low-poly district: ground, paths, buildings, props, lighting.
import * as THREE from 'three';

const COLORS = {
  grass: 0xbfe6b0, grassDark: 0xa5d89a, dirt: 0xeccfab, dirtDark: 0xd9b28c,
  street: 0xf6e8d4, path: 0xfaf0de,
  water: 0x9edcf2, trunk: 0xb98b6a, leafA: 0x9fdba5, leafB: 0x7fc996, leafC: 0xc8eaa8,
  wood: 0xd9a978, stone: 0xf1ebff, metal: 0x8a84aa, door: 0x9c6b54, dark: 0x5b5080,
  homeWall: 0xffd6e0, homeRoof: 0xf393aa,
  libWall: 0xdcd0ff, libRoof: 0xa99be9,
  cafeWall: 0xc4f1e2, cafeRoof: 0x6ccab3,
  shopWall: 0xffe2bd, shopRoof: 0xf6ad82,
  flower: [0xff9fb7, 0xffe08a, 0xb9a4ff, 0xffffff],
};

// ---------------------------------------------------------------------------
// Navigation graph. The being walks only along these edges.
// Street nodes run along z = 0; each location has a "door" node.
// ---------------------------------------------------------------------------
export const NODES = {
  sW: { x: -6, z: 0 },
  sHome: { x: -4.2, z: 0 },
  sC: { x: 0, z: 0 },
  sE: { x: 6.8, z: 0 },
  home: { x: -4.2, z: 5 },
  library: { x: -6, z: -3 },
  park: { x: 0, z: -4.8 },
  cafe: { x: 6.8, z: -3 },
  shop: { x: 6.8, z: 5.5 },
};

const EDGES = [
  ['sW', 'sHome'], ['sHome', 'sC'], ['sC', 'sE'],
  ['sW', 'library'], ['sHome', 'home'], ['sC', 'park'], ['sE', 'cafe'], ['sE', 'shop'],
];

export const LOCATIONS = {
  home: { name: 'Home', emoji: '🏠', verb: null, node: 'home', label: [-6.5, 4.4, 5] },
  library: { name: 'Library', emoji: '📚', verb: 'Reading', node: 'library', label: [-6, 4.6, -6.2] },
  cafe: { name: 'Internet Café', emoji: '💻', verb: 'Browsing', node: 'cafe', label: [6.8, 4.1, -6.2] },
  park: { name: 'Park', emoji: '🌳', verb: null, node: 'park', label: [0, 3.1, -6.6] },
  shop: { name: 'Shop', emoji: '🛍️', verb: null, node: 'shop', label: [4.2, 3.6, 5.5] },
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
    for (const m of ADJ[n] ?? []) {
      if (!(m in prev)) { prev[m] = n; queue.push(m); }
    }
  }
  if (!(to in prev)) return [];
  const ids = [];
  for (let n = to; n !== null; n = prev[n]) ids.unshift(n);
  return ids.map((id) => new THREE.Vector3(NODES[id].x, 0, NODES[id].z));
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) {
    matCache.set(color, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 }));
  }
  return matCache.get(color);
}

function add(parent, geo, material, x = 0, y = 0, z = 0, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, typeof material === 'number' ? mat(material) : material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}
const box = (p, w, h, d, c, x, y, z, o) => add(p, new THREE.BoxGeometry(w, h, d), c, x, y, z, o);
const cyl = (p, rt, rb, h, seg, c, x, y, z, o) => add(p, new THREE.CylinderGeometry(rt, rb, h, seg), c, x, y, z, o);

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(7);

function sign(text, { w = 2, h = 0.5, bg = '#fffaf3', fg = '#5b5080' } = {}) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(4, 4, 504, 120, 40); g.fill();
  g.lineWidth = 8; g.strokeStyle = fg; g.stroke();
  g.fillStyle = fg;
  g.font = '700 66px Fredoka, "Trebuchet MS", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
}

// Materials that change with time of day
const windowMat = new THREE.MeshStandardMaterial({ color: 0xbfe4ff, emissive: 0xffd27a, emissiveIntensity: 0, flatShading: true, roughness: 0.3 });
const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe08a, emissiveIntensity: 0.3, flatShading: true });
const screenMat = new THREE.MeshStandardMaterial({ color: 0x9fe3ff, emissive: 0x58c8ff, emissiveIntensity: 0.9, flatShading: true });
const waterMat = new THREE.MeshStandardMaterial({ color: COLORS.water, emissive: 0x6fc8ee, emissiveIntensity: 0.15, flatShading: true, roughness: 0.2 });
const blinkMat = new THREE.MeshBasicMaterial({ color: 0xff6f91 });

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
function tree(p, x, z, s = 1, kind = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  g.rotation.y = rand() * Math.PI * 2;
  p.add(g);
  cyl(g, 0.1, 0.15, 0.7, 6, COLORS.trunk, 0, 0.35, 0);
  if (kind === 0) {
    add(g, new THREE.IcosahedronGeometry(0.65, 0), COLORS.leafA, 0, 1.15, 0);
    add(g, new THREE.IcosahedronGeometry(0.42, 0), COLORS.leafC, 0.28, 1.55, 0.1);
  } else {
    add(g, new THREE.ConeGeometry(0.62, 1.1, 6), COLORS.leafB, 0, 1.15, 0);
    add(g, new THREE.ConeGeometry(0.45, 0.85, 6), COLORS.leafA, 0, 1.7, 0);
  }
  return g;
}

function lamp(p, x, z) {
  cyl(p, 0.05, 0.08, 1.7, 6, COLORS.metal, x, 0.85, z);
  add(p, new THREE.IcosahedronGeometry(0.17, 0), lampMat, x, 1.8, z, { cast: false });
  add(p, new THREE.ConeGeometry(0.2, 0.15, 6), COLORS.metal, x, 2.0, z);
}

function bench(p, x, z, rotY = 0) {
  const g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = rotY; p.add(g);
  box(g, 1, 0.08, 0.36, COLORS.wood, 0, 0.4, 0);
  box(g, 1, 0.3, 0.06, COLORS.wood, 0, 0.62, -0.16);
  for (const sx of [-0.4, 0.4]) box(g, 0.08, 0.4, 0.32, COLORS.metal, sx, 0.2, 0);
}

function flowers(p, cx, cz, n, spread) {
  for (let i = 0; i < n; i++) {
    const x = cx + (rand() - 0.5) * spread;
    const z = cz + (rand() - 0.5) * spread;
    const c = COLORS.flower[Math.floor(rand() * COLORS.flower.length)];
    cyl(p, 0.015, 0.015, 0.2, 4, COLORS.leafB, x, 0.1, z, { cast: false });
    add(p, new THREE.IcosahedronGeometry(0.07, 0), c, x, 0.22, z, { cast: false });
  }
}

function path(p, a, b, width, color) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const m = box(p, len + width, 0.06, width, color, (a.x + b.x) / 2, 0.03, (a.z + b.z) / 2, { cast: false });
  m.rotation.y = -Math.atan2(dz, dx);
}

// ---------------------------------------------------------------------------
// Buildings (each local origin = footprint centre on the ground)
// ---------------------------------------------------------------------------
function buildHome(p) {
  const g = new THREE.Group(); g.position.set(-6.5, 0, 5); p.add(g);
  box(g, 3, 2.2, 3, COLORS.homeWall, 0, 1.1, 0);
  const roof = add(g, new THREE.ConeGeometry(2.45, 1.6, 4), COLORS.homeRoof, 0, 3.0, 0);
  roof.rotation.y = Math.PI / 4;
  box(g, 0.4, 1.0, 0.4, COLORS.homeRoof, -0.6, 3.3, -0.6);
  // door + windows facing the street (+x)
  box(g, 0.08, 1.25, 0.75, COLORS.door, 1.52, 0.62, 0);
  add(g, new THREE.SphereGeometry(0.05, 6, 4), COLORS.stone, 1.58, 0.65, 0.25);
  box(g, 0.5, 0.08, 1.0, COLORS.stone, 1.75, 0.04, 0);
  for (const z of [-0.95, 0.95]) box(g, 0.06, 0.6, 0.55, windowMat, 1.52, 1.4, z);
  for (const x of [-0.7, 0.7]) box(g, 0.6, 0.6, 0.06, windowMat, x, 1.35, 1.52);
  // little heart sign
  const s = sign('HOME', { w: 1.1, h: 0.28, fg: '#e86f8f' });
  s.position.set(1.54, 1.95, 0); s.rotation.y = Math.PI / 2; g.add(s);
  flowers(g, 0.2, 2.0, 10, 2.2);
  // mailbox
  cyl(g, 0.04, 0.04, 0.8, 5, COLORS.wood, 2.1, 0.4, -1.2);
  box(g, 0.35, 0.25, 0.22, COLORS.homeRoof, 2.1, 0.9, -1.2);
}

function buildLibrary(p) {
  const g = new THREE.Group(); g.position.set(-6, 0, -6.2); p.add(g);
  box(g, 5, 0.25, 3.9, COLORS.stone, 0, 0.125, 0.15);
  box(g, 4.4, 2.6, 3.2, COLORS.libWall, 0, 1.55, 0);
  for (const x of [-1.7, -0.6, 0.6, 1.7]) cyl(g, 0.17, 0.2, 2.6, 8, COLORS.stone, x, 1.55, 1.9);
  box(g, 4.9, 0.3, 4.0, COLORS.libRoof, 0, 3.0, 0.2);
  const tri = new THREE.Shape();
  tri.moveTo(-2.45, 0); tri.lineTo(2.45, 0); tri.lineTo(0, 0.95); tri.closePath();
  const ped = add(g, new THREE.ExtrudeGeometry(tri, { depth: 4.0, bevelEnabled: false }), COLORS.libRoof, 0, 3.15, -1.8);
  ped.geometry.computeVertexNormals();
  box(g, 0.95, 1.55, 0.06, COLORS.door, 0, 1.03, 1.62);
  for (const x of [-1.15, 1.15]) box(g, 0.55, 1.1, 0.06, windowMat, x, 1.6, 1.62);
  for (const z of [-0.8, 0.6]) box(g, 0.06, 1.1, 0.6, windowMat, 2.22, 1.6, z);
  const s = sign('LIBRARY', { w: 1.9, h: 0.46 });
  s.position.set(0, 3.45, 2.21); g.add(s);
  // stacked books by the door
  const bookColors = [0xff9fb7, 0x9edcf2, 0xffe08a, 0xb9a4ff];
  for (let i = 0; i < 4; i++) {
    const b = box(g, 0.5, 0.12, 0.35, bookColors[i], 2.6, 0.06 + i * 0.12, 1.3);
    b.rotation.y = (rand() - 0.5) * 0.6;
  }
}

function buildCafe(p) {
  const g = new THREE.Group(); g.position.set(6.8, 0, -6.2); p.add(g);
  box(g, 3.8, 2.4, 3.2, COLORS.cafeWall, 0, 1.2, 0);
  box(g, 4.1, 0.25, 3.5, COLORS.cafeRoof, 0, 2.52, 0);
  box(g, 1.6, 1.1, 0.06, screenMat, -0.75, 1.2, 1.62, { cast: false });
  box(g, 0.8, 1.4, 0.06, COLORS.door, 1.0, 0.7, 1.62);
  for (const z of [-0.7, 0.6]) box(g, 0.06, 0.9, 0.8, screenMat, 1.92, 1.25, z, { cast: false });
  // striped awning
  const aw = new THREE.Group(); aw.position.set(0, 2.05, 1.95); aw.rotation.x = 0.38; g.add(aw);
  for (let i = 0; i < 6; i++) box(aw, 0.64, 0.06, 0.9, i % 2 ? COLORS.stone : COLORS.cafeRoof, -1.6 + i * 0.64, 0, 0);
  // rooftop sign and dish
  const s = sign('NET CAFÉ', { w: 1.9, h: 0.46, fg: '#3f9e88' });
  s.position.set(-0.6, 2.95, 1.2); g.add(s);
  box(g, 1.95, 0.5, 0.06, COLORS.cafeRoof, -0.6, 2.93, 1.17);
  cyl(g, 0.04, 0.04, 0.8, 5, COLORS.metal, 1.3, 3.05, -0.6);
  const dish = add(g, new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), COLORS.stone, 1.3, 3.4, -0.6);
  dish.rotation.x = -2.2; dish.material = new THREE.MeshStandardMaterial({ color: COLORS.stone, flatShading: true, side: THREE.DoubleSide });
  add(g, new THREE.SphereGeometry(0.07, 6, 4), blinkMat, 1.3, 3.5, -0.6, { cast: false });
  // outdoor table
  cyl(g, 0.35, 0.35, 0.05, 8, COLORS.stone, 2.6, 0.72, 0.9);
  cyl(g, 0.05, 0.05, 0.7, 5, COLORS.metal, 2.6, 0.35, 0.9);
  for (const dz of [-0.6, 0.6]) cyl(g, 0.18, 0.18, 0.4, 6, COLORS.cafeRoof, 2.6, 0.2, 0.9 + dz);
}

function buildShop(p) {
  const g = new THREE.Group(); g.position.set(4.2, 0, 5.5); p.add(g);
  box(g, 3.6, 2.2, 3, COLORS.shopWall, 0, 1.1, 0);
  box(g, 3.9, 0.25, 3.3, COLORS.shopRoof, 0, 2.32, 0);
  box(g, 3.9, 0.35, 0.15, COLORS.shopRoof, 0, 2.6, 1.6);
  // shopfront facing +x
  box(g, 0.06, 1.4, 0.8, COLORS.door, 1.82, 0.7, -0.7);
  box(g, 0.06, 0.9, 1.1, windowMat, 1.82, 1.15, 0.6);
  for (const x of [-0.9, 0.5]) box(g, 0.7, 0.7, 0.06, windowMat, x, 1.3, 1.52);
  const aw = new THREE.Group(); aw.position.set(2.15, 1.95, 0); aw.rotation.z = -0.38; g.add(aw);
  for (let i = 0; i < 5; i++) box(aw, 0.85, 0.06, 0.62, i % 2 ? COLORS.stone : COLORS.shopRoof, 0, 0, -1.25 + i * 0.62);
  const s = sign('SHOP', { w: 1.3, h: 0.34, fg: '#d9784a' });
  s.position.set(1.83, 2.3, 0); s.rotation.y = Math.PI / 2; g.add(s);
  // fruit crates
  for (const [cz, c] of [[1.1, 0xff8a8a], [1.75, 0xffd36e]]) {
    box(g, 0.55, 0.35, 0.55, COLORS.wood, 2.35, 0.18, cz);
    for (let i = 0; i < 4; i++) {
      add(g, new THREE.IcosahedronGeometry(0.1, 0), c, 2.25 + (i % 2) * 0.2, 0.42, cz - 0.1 + Math.floor(i / 2) * 0.2, { cast: false });
    }
  }
}

function buildPark(p) {
  const g = new THREE.Group(); g.position.set(0, 0, -6.6); p.add(g);
  cyl(g, 2.9, 2.9, 0.08, 12, COLORS.grassDark, 0, 0.04, 0, { cast: false });
  add(g, new THREE.CylinderGeometry(0.95, 0.95, 0.05, 9), waterMat, -1.1, 0.1, -0.2, { cast: false });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    add(g, new THREE.DodecahedronGeometry(0.13, 0), COLORS.stone, -1.1 + Math.cos(a) * 1.0, 0.1, -0.2 + Math.sin(a) * 1.0);
  }
  tree(g, -1.8, -1.7, 1.15, 0);
  tree(g, 1.7, -1.5, 1.25, 1);
  tree(g, 0.3, -2.3, 0.95, 0);
  tree(g, 2.2, 0.5, 0.8, 1);
  bench(g, 1.0, 0.4, -0.5);
  flowers(g, 0.2, -0.6, 14, 2.5);
  lamp(g, -0.9, 1.9);
  const s = sign('PARK', { w: 1.0, h: 0.26, fg: '#4e9a5e' });
  s.position.set(0.9, 0.55, 2.35); g.add(s);
  cyl(g, 0.03, 0.03, 0.5, 4, COLORS.wood, 0.5, 0.25, 2.34);
  cyl(g, 0.03, 0.03, 0.5, 4, COLORS.wood, 1.3, 0.25, 2.34);
}

function buildFountain(p, x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); p.add(g);
  cyl(g, 1.6, 1.6, 0.06, 12, COLORS.path, 0, 0.03, 0, { cast: false });
  cyl(g, 1.05, 1.15, 0.38, 10, COLORS.stone, 0, 0.19, 0);
  add(g, new THREE.CylinderGeometry(0.92, 0.92, 0.05, 10), waterMat, 0, 0.37, 0, { cast: false });
  cyl(g, 0.12, 0.16, 0.75, 6, COLORS.stone, 0, 0.7, 0);
  cyl(g, 0.45, 0.25, 0.16, 8, COLORS.stone, 0, 1.08, 0);
  const top = add(g, new THREE.IcosahedronGeometry(0.16, 0), waterMat, 0, 1.28, 0, { cast: false });
  return top;
}

function cloud() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, transparent: true, opacity: 0.95 });
  const parts = [[0, 0, 0, 0.9], [0.8, -0.1, 0.1, 0.65], [-0.8, -0.15, 0, 0.6], [0.2, 0.35, -0.1, 0.6]];
  for (const [x, y, z, r] of parts) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), m);
    c.position.set(x, y, z); g.add(c);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Public: build the whole world
// ---------------------------------------------------------------------------
export function createWorld() {
  const scene = new THREE.Scene();

  // Floating island
  box(scene, 22, 0.4, 22, COLORS.grass, 0, -0.2, 0, { cast: false });
  box(scene, 22, 1.2, 22, COLORS.dirt, 0, -1.0, 0, { cast: false });
  box(scene, 20.6, 1.0, 20.6, COLORS.dirtDark, 0, -2.1, 0, { cast: false });

  // Paths
  const P = (id) => NODES[id];
  path(scene, { x: -11, z: 0 }, { x: 11, z: 0 }, 1.8, COLORS.street);
  for (const [a, b] of EDGES) {
    if (P(a).z === 0 && P(b).z === 0) continue;
    path(scene, P(a), P(b), 1.2, COLORS.path);
  }
  path(scene, { x: -4.2, z: 5 }, { x: -5, z: 5 }, 1.0, COLORS.path); // home door stub
  path(scene, { x: 6.8, z: 5.5 }, { x: 6.0, z: 5.5 }, 1.0, COLORS.path); // shop door stub
  path(scene, { x: 0, z: 0 }, { x: 0, z: 2 }, 1.2, COLORS.path); // to fountain

  buildHome(scene);
  buildLibrary(scene);
  buildCafe(scene);
  buildShop(scene);
  buildPark(scene);
  const fountainTop = buildFountain(scene, 0, 3.3);
  bench(scene, -1.9, 3.3, Math.PI / 2);
  bench(scene, 1.9, 3.3, -Math.PI / 2);

  for (const [x, z] of [[-2, 1.3], [2.4, -1.3], [-8.6, -1.3], [9.2, 1.3], [-2.4, -1.3], [4.6, 1.3]]) lamp(scene, x, z);

  const trees = [
    [-9.3, -9.2, 1.1, 1], [-9.5, -3.4, 0.9, 0], [-3.1, -9.6, 0.9, 1], [3.2, -9.5, 1.0, 0],
    [9.6, -9.3, 1.2, 1], [9.7, -3.3, 0.85, 0], [-9.4, 8.9, 1.1, 0], [-9.6, 2.6, 0.8, 1],
    [-1.8, 8.9, 0.9, 1], [0.9, 9.4, 1.1, 0], [9.2, 9.1, 1.0, 1], [9.6, 3.4, 0.9, 0],
    [-2.6, 6.4, 0.8, 0], [-3.0, -2.6, 0.7, 1], [2.8, -2.4, 0.75, 0], [6.5, 8.8, 0.8, 0],
    [-6.3, 9.4, 0.85, 1], [3.6, 9.2, 0.7, 1],
  ];
  for (const [x, z, s, k] of trees) tree(scene, x, z, s, k);
  flowers(scene, -8.5, 7.5, 8, 2);
  flowers(scene, 8.6, 7.0, 8, 2);
  flowers(scene, 2.2, 7.8, 6, 1.6);

  // Clouds drift along a line behind the island (screen-horizontal), so they
  // decorate the sky without hiding the being or shading the district.
  const clouds = [];
  for (let i = 0; i < 4; i++) {
    const c = cloud();
    c.userData.u = -18 + i * 9 + rand() * 3;
    c.userData.back = 7 + rand() * 6;
    c.position.y = 4 + rand() * 4;
    c.scale.setScalar(0.8 + rand() * 0.5);
    c.userData.speed = 0.35 + rand() * 0.3;
    scene.add(c);
    clouds.push(c);
  }

  // Lights
  const hemi = new THREE.HemisphereLight(0xdff2ff, 0xffe6d2, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 70 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // Time-of-day keyframes: morning (0) → noon (0.5) → dusk (1)
  const key = (a, b, c) => [new THREE.Color(a), new THREE.Color(b), new THREE.Color(c)];
  const SKY_TOP = key(0x9fc2ff, 0x86cdfc, 0x6a5cb0);
  const SKY_BOTTOM = key(0xffd9cc, 0xe8f7ff, 0xffb38c);
  const SUN = key(0xffe0c4, 0xffffff, 0xffa874);
  const HEMI = key(0xe6eaff, 0xdff2ff, 0xb8a8ec);
  const tmp = new THREE.Color();
  const pick = (keys, t, out) =>
    t < 0.5 ? out.lerpColors(keys[0], keys[1], t * 2) : out.lerpColors(keys[1], keys[2], (t - 0.5) * 2);

  function setTimeOfDay(t) {
    t = THREE.MathUtils.clamp(t, 0, 1);
    const a = THREE.MathUtils.lerp(0.15, 0.85, t) * Math.PI;
    sun.position.set(18 * Math.cos(a), 6 + 14 * Math.sin(a), 10);
    pick(SUN, t, sun.color);
    pick(HEMI, t, hemi.color);
    sun.intensity = t < 0.5 ? THREE.MathUtils.lerp(1.8, 2.4, t * 2) : THREE.MathUtils.lerp(2.4, 1.5, (t - 0.5) * 2);
    hemi.intensity = THREE.MathUtils.lerp(1.4, 1.05, Math.max(0, t - 0.5) * 2);
    const night = THREE.MathUtils.smoothstep(t, 0.7, 1.0);
    windowMat.emissiveIntensity = night * 0.85;
    lampMat.emissiveIntensity = 0.3 + night * 1.5;
    return {
      top: '#' + pick(SKY_TOP, t, tmp).getHexString(),
      bottom: '#' + pick(SKY_BOTTOM, t, tmp).getHexString(),
    };
  }

  function update(dt, t) {
    for (const c of clouds) {
      c.userData.u += c.userData.speed * dt;
      if (c.userData.u > 20) c.userData.u = -20;
      c.position.x = -c.userData.back + c.userData.u;
      c.position.z = -c.userData.back - c.userData.u;
    }
    fountainTop.position.y = 1.28 + Math.sin(t * 3) * 0.04;
    blinkMat.color.setHex(Math.sin(t * 4) > 0 ? 0xff6f91 : 0x7a5266);
  }

  return { scene, setTimeOfDay, update };
}
