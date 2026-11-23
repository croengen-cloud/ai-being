// forest.js — the world: a bright forest clearing with a stream, choppable trees, berry
// bushes, food mushrooms, stones, sticks, a fire pit, huts and a storage pile.
// Everything that exists many times is an InstancedMesh (cheap on phones).
import * as THREE from './vendor/three.module.js';
import { glowTexture } from './icons.js';

export const CLEARING_R = 24;
export const FIRE_POS = { x: 1.5, z: 3 };
export const STORAGE_POS = { x: -5, z: 6.5 };

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const R = (a, b) => a + rand() * (b - a);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------
// Stream path and terrain height
// ---------------------------------------------------------------------------
const STREAM = new THREE.CatmullRomCurve3([
  [-70, -34], [-40, -24], [-20, -15], [-6, -16.5], [8, -12], [20, -17], [40, -26], [70, -30],
].map(([x, z]) => new THREE.Vector3(x, 0, z)));
const streamPts = STREAM.getSpacedPoints(260);

function streamDist(x, z) {
  let best = Infinity;
  for (let i = 0; i < streamPts.length; i++) {
    const dx = streamPts[i].x - x, dz = streamPts[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function rawHeight(x, z) {
  const d = Math.hypot(x, z);
  const hills = (Math.sin(x * 0.08) + Math.cos(z * 0.07) + Math.sin((x + z) * 0.05)) * 0.3
    + Math.sin(x * 0.21 + 1) * Math.cos(z * 0.19) * 0.12;
  const edge = smooth(CLEARING_R * 0.85, CLEARING_R * 1.7, d);
  let h = hills * (0.5 + edge * 2.5) + edge * 2.2;
  h -= 0.85 * (1 - smooth(0.9, 2.8, streamDist(x, z)));
  return h;
}

// Precomputed height grid (1 m) for fast lookups at runtime
const GRID_HALF = 80, GRID_N = GRID_HALF * 2 + 1;
const heights = new Float32Array(GRID_N * GRID_N);
for (let j = 0; j < GRID_N; j++) for (let i = 0; i < GRID_N; i++) heights[j * GRID_N + i] = rawHeight(i - GRID_HALF, j - GRID_HALF);

export function heightAt(x, z) {
  const fx = Math.min(GRID_N - 1.001, Math.max(0, x + GRID_HALF));
  const fz = Math.min(GRID_N - 1.001, Math.max(0, z + GRID_HALF));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = heights[j * GRID_N + i], b = heights[j * GRID_N + i + 1];
  const c = heights[(j + 1) * GRID_N + i], d = heights[(j + 1) * GRID_N + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
export const isNearStream = (x, z, r = 2.4) => streamDist(x, z) < r;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

function instanced(geo, mat, count, { cast = true, receive = true } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.castShadow = cast; m.receiveShadow = receive;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return m;
}
function setInst(mesh, i, x, y, z, s = 1, ry = 0, rx = 0, rz = 0, sy = s) {
  dummy.position.set(x, y, z);
  dummy.rotation.set(rx, ry, rz);
  dummy.scale.set(s, sy, s);
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
}
function hideInst(mesh, i) { dummy.position.set(0, -50, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); }

function freeSpot(minR, maxR, taken, minGap = 2.5) {
  for (let k = 0; k < 200; k++) {
    const a = R(0, Math.PI * 2), r = Math.sqrt(R(minR * minR, maxR * maxR));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (isNearStream(x, z, 2.6)) continue;
    if (Math.hypot(x - FIRE_POS.x, z - FIRE_POS.z) < 4.5) continue;
    if (Math.hypot(x - STORAGE_POS.x, z - STORAGE_POS.z) < 3.5) continue;
    if (taken.some((p) => Math.hypot(p.x - x, p.z - z) < minGap)) continue;
    const p = { x, z };
    taken.push(p);
    return p;
  }
  return { x: R(-maxR, maxR), z: R(-maxR, maxR) };
}

// Hut slots in a ring around the fire
export const HUT_SLOTS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + 0.4;
  const r = i < 7 ? 8 : 12.5;
  return { x: FIRE_POS.x + Math.cos(a + (i >= 7 ? 0.22 : 0)) * r, z: FIRE_POS.z + Math.sin(a + (i >= 7 ? 0.22 : 0)) * r };
}).filter((p) => !isNearStream(p.x, p.z, 3) && Math.hypot(p.x - STORAGE_POS.x, p.z - STORAGE_POS.z) > 3.5);

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------
export function createForest({ shadowSize = 1024 } = {}) {
  const scene = new THREE.Scene();
  const taken = [];
  const glow = glowTexture();

  // ---- Terrain ----
  const SIZE = 160, SEG = 110;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x63c247), cLight = new THREE.Color(0x9be06a), cDark = new THREE.Color(0x2f7f3a);
  const cMoss = new THREE.Color(0x2c6a37), cBank = new THREE.Color(0xc9b77a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    const d = Math.hypot(x, z);
    const n = Math.sin(x * 0.35) * Math.cos(z * 0.31) * 0.5 + Math.sin((x - z) * 0.13) * 0.5;
    tmpColor.copy(cGrass).lerp(cLight, Math.max(0, n) * 0.6).lerp(cDark, Math.max(0, -n) * 0.4);
    tmpColor.lerp(cMoss, smooth(CLEARING_R * 0.9, CLEARING_R * 1.5, d) * 0.8);
    tmpColor.lerp(cBank, (1 - smooth(1.4, 3.2, streamDist(x, z))) * 0.7);
    cols[i * 3] = tmpColor.r; cols[i * 3 + 1] = tmpColor.g; cols[i * 3 + 2] = tmpColor.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---- Stream ----
  const rip = document.createElement('canvas'); rip.width = 64; rip.height = 128;
  const rg = rip.getContext('2d');
  rg.fillStyle = '#3fb8e0'; rg.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 40; i++) {
    rg.fillStyle = `rgba(255,255,255,${R(0.08, 0.3)})`;
    rg.fillRect(R(0, 64), R(0, 128), R(6, 22), R(1, 3));
  }
  const ripTex = new THREE.CanvasTexture(rip);
  ripTex.colorSpace = THREE.SRGBColorSpace;
  ripTex.wrapS = ripTex.wrapT = THREE.RepeatWrapping;
  ripTex.repeat.set(1, 40);
  const wverts = [], wuvs = [], widx = [];
  const W = 1.7;
  streamPts.forEach((p, i) => {
    const t = STREAM.getTangentAt(i / (streamPts.length - 1));
    const nx = -t.z, nz = t.x;
    const y = heightAt(p.x, p.z) + 0.38;
    wverts.push(p.x + nx * W, y, p.z + nz * W, p.x - nx * W, y, p.z - nz * W);
    wuvs.push(0, i / streamPts.length, 1, i / streamPts.length);
    if (i > 0) { const a = (i - 1) * 2; widx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wverts, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuvs, 2));
  wg.setIndex(widx); wg.computeVertexNormals();
  const water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({
    map: ripTex, color: 0xbff4ff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88,
    emissive: 0x1d6f8a, emissiveIntensity: 0.25,
  }));
  water.receiveShadow = true;
  scene.add(water);
  // Pebbles along the banks
  const pebbles = instanced(new THREE.DodecahedronGeometry(0.35, 0), std(0xa9b0b4, { flatShading: true }), 120, { cast: false });
  for (let i = 0; i < 120; i++) {
    const p = streamPts[Math.floor(R(0, streamPts.length))];
    const a = R(0, Math.PI * 2), r = R(1.6, 2.6);
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    setInst(pebbles, i, x, heightAt(x, z) + 0.05, z, R(0.4, 1.1), R(0, 6), R(0, 3), 0, R(0.3, 0.7));
  }
  scene.add(pebbles);

  // ---- Background forest ring (instanced, not choppable) ----
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 3, 7);
  trunkGeo.translate(0, 1.5, 0);
  const blobGeo = new THREE.IcosahedronGeometry(1, 2);
  const coneGeo = new THREE.ConeGeometry(1, 2.4, 9);
  const FOREST_N = 300;
  const fTrunks = instanced(trunkGeo, std(0x7a5236), FOREST_N);
  const fBlobs = instanced(blobGeo, std(0xffffff, { roughness: 0.75 }), FOREST_N * 3);
  const fCones = instanced(coneGeo, std(0xffffff, { roughness: 0.75 }), FOREST_N * 3);
  let nb = 0, nc = 0;
  const greens = [0x3fae4a, 0x2e9a48, 0x58c05a, 0x2c8a52, 0x47b86e, 0x6cc85a];
  for (let i = 0; i < FOREST_N; i++) {
    const a = R(0, Math.PI * 2), r = R(CLEARING_R + 3, 72);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (isNearStream(x, z, 3)) { hideInst(fTrunks, i); continue; }
    const s = R(1.2, 2.2) * (r > 45 ? 1.25 : 1);
    const y = heightAt(x, z);
    setInst(fTrunks, i, x, y, z, s * 0.9, R(0, 6), 0, 0, s);
    const pine = rand() < 0.35;
    for (let k = 0; k < 3; k++) {
      tmpColor.setHex(greens[Math.floor(R(0, greens.length))]);
      if (pine) {
        setInst(fCones, nc, x, y + s * (2.6 + k * 1.3), z, s * (1.7 - k * 0.4), 0, 0, 0, s * 1.1);
        fCones.setColorAt(nc++, tmpColor);
      } else {
        setInst(fBlobs, nb, x + R(-0.7, 0.7) * s, y + s * (3.4 + k * 0.8), z + R(-0.7, 0.7) * s, s * (1.7 - k * 0.25), R(0, 6));
        fBlobs.setColorAt(nb++, tmpColor);
      }
    }
  }
  fBlobs.count = nb; fCones.count = nc;
  scene.add(fTrunks, fBlobs, fCones);

  // ---- Grass tufts and flowers ----
  const bladeGeo = new THREE.BufferGeometry();
  const bv = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const dx = Math.cos(a) * 0.12, dz = Math.sin(a) * 0.12;
    bv.push(-dx * 1.6, 0, -dz * 1.6, dx * 1.6, 0, dz * 1.6, dx * 0.3, 0.26, dz * 0.3);
  }
  bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(bv, 3));
  bladeGeo.computeVertexNormals();
  const GRASS_N = 2200;
  const grass = instanced(bladeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.9 }), GRASS_N, { cast: false });
  for (let i = 0; i < GRASS_N; i++) {
    const a = R(0, Math.PI * 2), r = Math.sqrt(R(0, 1)) * (CLEARING_R + 8);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (isNearStream(x, z, 1.8) || Math.hypot(x - FIRE_POS.x, z - FIRE_POS.z) < 2.2) { hideInst(grass, i); continue; }
    setInst(grass, i, x, heightAt(x, z), z, R(0.8, 1.6), R(0, 6));
    grass.setColorAt(i, tmpColor.setHSL(R(0.26, 0.31), R(0.5, 0.65), R(0.36, 0.46)));
  }
  scene.add(grass);
  const FLOWER_N = 320;
  const flowers = instanced(new THREE.IcosahedronGeometry(0.11, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222, roughness: 0.6 }), FLOWER_N, { cast: false });
  const flowerCols = [0xff7ab8, 0xffffff, 0x8fb8ff, 0xc58fff, 0xff9f5a, 0x9ff0ff];
  for (let i = 0; i < FLOWER_N; i++) {
    const a = R(0, Math.PI * 2), r = Math.sqrt(R(0, 1)) * (CLEARING_R + 4);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (isNearStream(x, z, 1.8)) { hideInst(flowers, i); continue; }
    setInst(flowers, i, x, heightAt(x, z) + R(0.18, 0.35), z, R(0.8, 1.3));
    flowers.setColorAt(i, tmpColor.setHex(flowerCols[Math.floor(R(0, flowerCols.length))]));
  }
  scene.add(flowers);

  // ---- Choppable trees ----
  const TREE_N = 14;
  const trees = [];
  const cTrunk = instanced(trunkGeo, std(0x8a5a3a), TREE_N);
  const cCrown = instanced(blobGeo, std(0xffffff, { roughness: 0.75 }), TREE_N * 3);
  for (let i = 0; i < TREE_N; i++) {
    const p = freeSpot(14, CLEARING_R - 1, taken, 4);
    const s = R(1.15, 1.45);
    const t = { id: i, x: p.x, z: p.z, y: heightAt(p.x, p.z), s, hp: 6, fall: 0, fallDir: R(0, Math.PI * 2), state: 'standing', reservedBy: null, crowns: [] };
    for (let k = 0; k < 3; k++) t.crowns.push({ ox: R(-0.6, 0.6) * s, oy: s * (3.3 + k * 0.85), oz: R(-0.6, 0.6) * s, cs: s * (1.25 - k * 0.25), color: greens[Math.floor(R(0, greens.length))] });
    trees.push(t);
  }
  const treeMat = new THREE.Matrix4(), partMat = new THREE.Matrix4(), q = new THREE.Quaternion(), axis = new THREE.Vector3();
  function drawTree(t) {
    if (t.state === 'gone') {
      hideInst(cTrunk, t.id);
      for (let k = 0; k < 3; k++) hideInst(cCrown, t.id * 3 + k);
      return;
    }
    // falling = rotate around the base, along fallDir
    const ang = t.fall * (Math.PI / 2) * 0.96;
    axis.set(Math.cos(t.fallDir + Math.PI / 2), 0, Math.sin(t.fallDir + Math.PI / 2));
    q.setFromAxisAngle(axis, ang);
    const shake = t.shakeT > 0 ? Math.sin(t.shakeT * 60) * 0.03 * t.shakeT * 4 : 0;
    treeMat.compose(new THREE.Vector3(t.x, t.y, t.z), q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), shake)), new THREE.Vector3(1, 1, 1));
    partMat.makeScale(t.s * 0.9, t.s, t.s * 0.9);
    cTrunk.setMatrixAt(t.id, partMat.premultiply(treeMat));
    t.crowns.forEach((c, k) => {
      partMat.compose(new THREE.Vector3(c.ox, c.oy, c.oz), new THREE.Quaternion(), new THREE.Vector3(c.cs, c.cs, c.cs));
      cCrown.setMatrixAt(t.id * 3 + k, partMat.premultiply(treeMat));
      cCrown.setColorAt(t.id * 3 + k, tmpColor.setHex(c.color));
    });
  }
  trees.forEach(drawTree);
  scene.add(cTrunk, cCrown);

  // ---- Items: sticks, stones, logs, food mushrooms ----
  const items = []; // { kind, x, z, alive, idx, reservedBy }
  const stickGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.1, 5); stickGeo.rotateZ(Math.PI / 2);
  const sticks = instanced(stickGeo, std(0x8b5e3c), 40, { cast: true });
  const stones = instanced(new THREE.DodecahedronGeometry(0.42, 0), std(0x9aa3a8, { flatShading: true }), 40);
  const logGeo = new THREE.CylinderGeometry(0.28, 0.3, 1.8, 8); logGeo.rotateZ(Math.PI / 2);
  const logs = instanced(logGeo, std(0x8a5a3a), 60);
  const mushStem = instanced(new THREE.CylinderGeometry(0.07, 0.09, 0.28, 6), std(0xfff4e6), 30, { cast: false });
  const mushCap = instanced(new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(0xd98a4a, { roughness: 0.6 }), 30);
  const meshes = { stick: sticks, stone: stones, log: logs, mushroom: mushCap };
  const caps = { stick: 40, stone: 40, log: 60, mushroom: 30 };
  const counters = { stick: 0, stone: 0, log: 0, mushroom: 0 };
  function drawItem(it) {
    const m = meshes[it.kind];
    if (!it.alive) { hideInst(m, it.idx); if (it.kind === 'mushroom') hideInst(mushStem, it.idx); return; }
    const y = heightAt(it.x, it.z);
    if (it.kind === 'stick') setInst(m, it.idx, it.x, y + 0.06, it.z, 1, it.rot);
    else if (it.kind === 'stone') setInst(m, it.idx, it.x, y + 0.15, it.z, it.size, it.rot, it.rot, 0, it.size * 0.7);
    else if (it.kind === 'log') setInst(m, it.idx, it.x, y + 0.28, it.z, 1, it.rot);
    else {
      setInst(mushStem, it.idx, it.x, y + 0.14, it.z, it.size);
      setInst(m, it.idx, it.x, y + 0.26 * it.size, it.z, it.size, 0, 0, 0, it.size * 0.8);
    }
    m.instanceMatrix.needsUpdate = true;
    if (it.kind === 'mushroom') mushStem.instanceMatrix.needsUpdate = true;
  }
  function addItem(kind, x, z, extra = {}) {
    if (counters[kind] >= caps[kind]) {
      const dead = items.find((i) => i.kind === kind && !i.alive);
      if (!dead) return null;
      Object.assign(dead, { x, z, alive: true, reservedBy: null, rot: R(0, 6), size: R(0.7, 1.2), ...extra });
      drawItem(dead);
      return dead;
    }
    const it = { kind, x, z, alive: true, idx: counters[kind]++, reservedBy: null, rot: R(0, 6), size: R(0.7, 1.2), ...extra };
    items.push(it);
    drawItem(it);
    return it;
  }
  for (const m of Object.values(meshes)) for (let i = 0; i < m.count; i++) hideInst(m, i);
  for (let i = 0; i < 30; i++) hideInst(mushStem, i);
  for (let i = 0; i < 22; i++) { const p = freeSpot(3, CLEARING_R, taken, 1.2); addItem('stick', p.x, p.z); }
  for (let i = 0; i < 16; i++) { const p = freeSpot(4, CLEARING_R, taken, 1.2); addItem('stone', p.x, p.z); }
  for (let i = 0; i < 10; i++) {
    const p = streamPts[60 + Math.floor(R(0, 140))];
    const a = R(0, Math.PI * 2);
    addItem('stone', p.x + Math.cos(a) * 2.6, p.z + Math.sin(a) * 2.6);
  }
  for (let i = 0; i < 14; i++) { const p = freeSpot(6, CLEARING_R + 1, taken, 1.2); addItem('mushroom', p.x, p.z); }
  scene.add(sticks, stones, logs, mushStem, mushCap);

  // ---- Berry bushes ----
  const BUSH_N = 11, BERRIES = 6;
  const bushes = [];
  const bushMesh = instanced(new THREE.IcosahedronGeometry(1, 2), std(0x2f9a45, { roughness: 0.85 }), BUSH_N);
  const berryMesh = instanced(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0x220011 }), BUSH_N * BERRIES, { cast: false });
  const berryCols = [0xe8264f, 0x6b3cff, 0xff4f9a];
  for (let i = 0; i < BUSH_N; i++) {
    const p = freeSpot(7, CLEARING_R - 1, taken, 3);
    const b = { id: i, x: p.x, z: p.z, y: heightAt(p.x, p.z), berries: BERRIES, regrow: 0, color: berryCols[i % 3], spots: [] };
    for (let k = 0; k < BERRIES; k++) { const a = (k / BERRIES) * Math.PI * 2 + R(0, 0.5); b.spots.push({ x: Math.cos(a) * 0.85, y: R(0.5, 1.2), z: Math.sin(a) * 0.85 }); }
    setInst(bushMesh, i, b.x, b.y + 0.55, b.z, 1.05, R(0, 6), 0, 0, 0.8);
    bushes.push(b);
  }
  function drawBush(b) {
    b.spots.forEach((s, k) => {
      const idx = b.id * BERRIES + k;
      if (k < b.berries) { setInst(berryMesh, idx, b.x + s.x, b.y + s.y, b.z + s.z, 1); berryMesh.setColorAt(idx, tmpColor.setHex(b.color)); }
      else hideInst(berryMesh, idx);
    });
    berryMesh.instanceMatrix.needsUpdate = true;
    if (berryMesh.instanceColor) berryMesh.instanceColor.needsUpdate = true;
  }
  bushes.forEach(drawBush);
  scene.add(bushMesh, berryMesh);

  // ---- Fire pit (undiscovered at start) ----
  const fire = { ...FIRE_POS, discovered: false, lit: false, fuel: 0, level: 0 };
  const fireGroup = new THREE.Group();
  fireGroup.position.set(FIRE_POS.x, heightAt(FIRE_POS.x, FIRE_POS.z), FIRE_POS.z);
  scene.add(fireGroup);
  const ringStone = new THREE.DodecahedronGeometry(0.34, 0);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const m = new THREE.Mesh(ringStone, std(0x8d9599, { flatShading: true }));
    m.position.set(Math.cos(a) * 1.05, 0.15, Math.sin(a) * 1.05);
    m.rotation.set(R(0, 3), R(0, 3), 0);
    m.castShadow = true; m.receiveShadow = true;
    fireGroup.add(m);
  }
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.3, 6), std(0x6b4428));
    l.rotation.set(0.9, (i / 4) * Math.PI * 2, 0);
    l.position.y = 0.3;
    l.castShadow = true;
    fireGroup.add(l);
  }
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameMat2 = new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.32 - i * 0.05, 1.2 - i * 0.15, 7), i % 2 ? flameMat2 : flameMat);
    f.position.set(Math.cos(i * 1.7) * 0.15, 0.7, Math.sin(i * 1.7) * 0.15);
    f.visible = false;
    fireGroup.add(f);
    flames.push(f);
  }
  const fireGlow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: glow, color: 0xff9a3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  fireGlow.rotation.x = -Math.PI / 2; fireGlow.position.y = 0.06;
  fireGroup.add(fireGlow);
  const fireLight = new THREE.PointLight(0xff9a40, 0, 16, 1.6);
  fireLight.position.y = 1.4;
  fireGroup.add(fireLight);
  // "?" marker shimmer until discovered
  const hint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffe0a0, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }));
  hint.position.y = 0.5; hint.scale.set(2.5, 2.5, 1);
  fireGroup.add(hint);

  // ---- Storage pile ----
  const storage = { ...STORAGE_POS, built: false, progress: 0 };
  const storageGroup = new THREE.Group();
  storageGroup.position.set(STORAGE_POS.x, heightAt(STORAGE_POS.x, STORAGE_POS.z), STORAGE_POS.z);
  scene.add(storageGroup);
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.0, 0.18, 10), std(0x9b6a42));
  platform.position.y = 0.09; platform.receiveShadow = true; platform.castShadow = true;
  storageGroup.add(platform);
  const marker = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.9, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  marker.rotation.x = -Math.PI / 2; marker.position.y = 0.05;
  storageGroup.add(marker);
  const pileLogs = instanced(logGeo, std(0x8a5a3a), 10);
  const pileBerries = instanced(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe8264f, roughness: 0.4 }), 24, { cast: false });
  const pileStones = instanced(new THREE.DodecahedronGeometry(0.3, 0), std(0x9aa3a8, { flatShading: true }), 10);
  storageGroup.add(pileLogs, pileBerries, pileStones);
  function drawStorage(res) {
    platform.scale.set(1, storage.built ? 1 : 0.0001, 1);
    platform.visible = storage.built || storage.progress > 0;
    platform.scale.set(Math.max(0.2, storage.built ? 1 : storage.progress), 1, Math.max(0.2, storage.built ? 1 : storage.progress));
    marker.visible = !storage.built;
    const nl = Math.min(10, Math.ceil((res.wood ?? 0) / 2));
    for (let i = 0; i < 10; i++) {
      if (i < nl) setInst(pileLogs, i, -0.6 + (i % 3) * 0.05, 0.45 + Math.floor(i / 3) * 0.5, -0.9 + (i % 3) * 0.6, 0.7, Math.PI / 2 + (i % 2) * 0.2);
      else hideInst(pileLogs, i);
    }
    const nf = Math.min(24, res.food ?? 0);
    for (let i = 0; i < 24; i++) {
      if (i < nf) { const a = i * 2.4, r = 0.25 + (i % 8) * 0.06; setInst(pileBerries, i, 0.7 + Math.cos(a) * r, 0.3 + Math.floor(i / 8) * 0.22, 0.3 + Math.sin(a) * r, 1); }
      else hideInst(pileBerries, i);
    }
    const ns = Math.min(10, res.stone ?? 0);
    for (let i = 0; i < 10; i++) {
      if (i < ns) setInst(pileStones, i, -0.1 + (i % 4) * 0.35, 0.3 + Math.floor(i / 4) * 0.25, 1.0, 1, i);
      else hideInst(pileStones, i);
    }
    for (const m of [pileLogs, pileBerries, pileStones]) m.instanceMatrix.needsUpdate = true;
  }

  // ---- Huts ----
  const huts = []; // { slot, x, z, progress, built, group }
  function addHut(slotIdx, progress = 0) {
    const s = HUT_SLOTS[slotIdx];
    if (!s) return null;
    const g = new THREE.Group();
    g.position.set(s.x, heightAt(s.x, s.z), s.z);
    g.rotation.y = Math.atan2(FIRE_POS.x - s.x, FIRE_POS.z - s.z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0xc08a55, { roughness: 0.9 }));
    dome.castShadow = true; dome.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.75, 1.6, 12), std(0x3f9a4a, { roughness: 0.85 }));
    roof.position.y = 1.55; roof.castShadow = true;
    const door = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x2a1a10 }));
    door.position.set(0, 0.02, 1.49);
    const frame = [];
    for (let i = 0; i < 6; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), std(0x8b5e3c));
      const a = (i / 6) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.9, 1.1, Math.sin(a) * 0.9);
      st.rotation.set(Math.sin(a) * -0.4, 0, Math.cos(a) * 0.4);
      frame.push(st); g.add(st);
    }
    g.add(dome, roof, door);
    scene.add(g);
    const hut = { slot: slotIdx, x: s.x, z: s.z, progress, built: progress >= 1, group: g, dome, roof, door, frame, sleepers: 0 };
    huts.push(hut);
    drawHut(hut);
    return hut;
  }
  function drawHut(h) {
    const p = h.built ? 1 : h.progress;
    h.dome.scale.set(1, Math.max(0.01, smooth(0.2, 0.8, p)), 1);
    h.roof.visible = p > 0.75;
    h.roof.scale.setScalar(Math.max(0.01, smooth(0.75, 1, p)));
    h.door.visible = p > 0.6;
    h.frame.forEach((f) => { f.visible = p < 0.95; });
  }

  // ---- Spores and light (particles) ----
  const SP_N = 700;
  const spGeo = new THREE.BufferGeometry();
  const spPos = new Float32Array(SP_N * 3), spCol = new Float32Array(SP_N * 3);
  const sp = []; // ambient (first 420) + burst pool
  for (let i = 0; i < SP_N; i++) {
    const ambient = i < 420;
    const a = R(0, Math.PI * 2), r = Math.sqrt(R(0, 1)) * 34;
    const p = { x: Math.cos(a) * r, y: R(0.3, 9), z: Math.sin(a) * r, vx: R(-0.2, 0.2), vy: R(0.02, 0.12), vz: R(-0.2, 0.2), life: ambient ? Infinity : 0, ambient, ph: R(0, 6) };
    sp.push(p);
    const c = tmpColor.setHSL(ambient ? R(0.1, 0.16) : 0.8, ambient ? 0.9 : 0.8, ambient ? 0.8 : 0.7);
    spCol.set([c.r, c.g, c.b], i * 3);
  }
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  spGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
  const spMat = new THREE.PointsMaterial({ size: 0.28, map: glow, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const spores = new THREE.Points(spGeo, spMat);
  spores.frustumCulled = false;
  scene.add(spores);
  let burstCursor = 420;
  function puff(x, z, color, n = 40, y0 = 1.2) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = burstCursor; burstCursor = burstCursor + 1 >= SP_N ? 420 : burstCursor + 1;
      const p = sp[i];
      const a = R(0, Math.PI * 2), s = R(0.6, 2.4);
      Object.assign(p, { x, y: heightAt(x, z) + y0, z, vx: Math.cos(a) * s, vy: R(0.8, 2.6), vz: Math.sin(a) * s, life: R(1.6, 3.2) });
      const cc = c.clone().lerp(new THREE.Color(0xffffff), R(0, 0.5));
      spCol.set([cc.r, cc.g, cc.b], i * 3);
    }
    spGeo.attributes.color.needsUpdate = true;
  }

  // Fake light shafts through the canopy
  const beamTex = (() => {
    const c = document.createElement('canvas'); c.width = 16; c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 16, 128);
    const h = g.getImageData(0, 0, 16, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 16; x++) { const e = Math.sin((x / 15) * Math.PI); h.data[(y * 16 + x) * 4 + 3] *= e; }
    g.putImageData(h, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, color: 0xfff1c8, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beams = [];
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(R(2, 4), 26), beamMat);
    const a = R(0, Math.PI * 2), r = R(6, 22);
    b.position.set(Math.cos(a) * r, 9, Math.sin(a) * r);
    b.rotation.set(0, R(0, Math.PI), 0.5);
    beams.push(b); scene.add(b);
  }

  // ---- Sky, fog, lights ----
  const skyUniforms = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float vY; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.6, vY)), 1.0);\n#include <colorspace_fragment>\n}',
  }));
  scene.add(sky);
  scene.fog = new THREE.Fog(0xcfeee0, 45, 120);

  const hemi = new THREE.HemisphereLight(0xd8f2ff, 0x4f7a32, 1.25);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 5, far: 120 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04; sun.shadow.radius = 4;
  scene.add(hemi, sun, sun.target);

  // ---- Day/night (phase 0..1: 0 dawn, 0.1-0.6 day, 0.7 dusk, 0.75-0.95 night) ----
  const K = (h) => new THREE.Color(h);
  const SKY = [
    [0.0, K(0xffc8a8), K(0xffe6c8)], [0.12, K(0x6cc4ff), K(0xd2f2ff)], [0.6, K(0x6cc4ff), K(0xd2f2ff)],
    [0.7, K(0xff9a7a), K(0xffd2a0)], [0.78, K(0x1a1f4a), K(0x3a3a6a)], [0.94, K(0x141a40), K(0x2c3060)], [1.0, K(0xffc8a8), K(0xffe6c8)],
  ];
  const FOG = [[0, K(0xf2dcc8)], [0.12, K(0xcfeee0)], [0.6, K(0xcfeee0)], [0.7, K(0xf0c8a8)], [0.78, K(0x262a4a)], [0.94, K(0x20264a)], [1, K(0xf2dcc8)]];
  const sample = (keys, t, idx, out) => {
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i][0] && t <= keys[i + 1][0]) {
        const u = (t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
        return out.copy(keys[i][idx]).lerp(keys[i + 1][idx], u);
      }
    }
    return out.copy(keys[0][idx]);
  };
  let daylight = 1;
  function setPhase(t) {
    sample(SKY, t, 1, skyUniforms.top.value);
    sample(SKY, t, 2, skyUniforms.bottom.value);
    sample(FOG, t, 1, scene.fog.color);
    // daylight 0..1
    daylight = t < 0.08 ? 0.35 + t / 0.08 * 0.65 : t < 0.66 ? 1 : t < 0.78 ? 1 - (t - 0.66) / 0.12 : t < 0.93 ? 0 : (t - 0.93) / 0.07 * 0.35;
    const a = (Math.min(Math.max((t - 0.0) / 0.75, 0), 1)) * Math.PI;
    sun.position.set(Math.cos(a) * 40, 12 + Math.sin(a) * 40, 22);
    sun.intensity = 0.55 + daylight * 2.3;
    if (daylight > 0.3) sun.color.setHSL(0.1, 0.6, 0.6 + daylight * 0.3); else sun.color.setHSL(0.62, 0.5, 0.75); // moonlight
    hemi.intensity = 0.7 + daylight * 0.6;
    hemi.color.setHSL(0.58, 0.6, 0.45 + daylight * 0.4);
    beamMat.opacity = 0.2 * daylight;
    spMat.opacity = 0.6 + (1 - daylight) * 0.4;
    return daylight;
  }

  // ---- Per-frame update ----
  function update(dt, time, camera) {
    sky.position.copy(camera.position);
    ripTex.offset.y -= dt * 0.35;
    // fire
    fire.level += ((fire.lit ? 1 : 0) - fire.level) * Math.min(1, dt * 2);
    const fl = fire.level;
    flames.forEach((f, i) => {
      f.visible = fl > 0.02;
      const s = fl * (0.85 + Math.sin(time * (9 + i * 2.3) + i) * 0.15);
      f.scale.set(s, s * (1 + Math.sin(time * 13 + i) * 0.12), s);
    });
    fireGlow.material.opacity = fl * (0.5 + Math.sin(time * 11) * 0.05) * (0.6 + (1 - daylight) * 0.6);
    fireLight.intensity = fl * (18 + Math.sin(time * 17) * 3) * (0.4 + (1 - daylight) * 0.9);
    hint.material.opacity = fire.discovered ? 0 : 0.18 + Math.sin(time * 2) * 0.08;
    // falling trees
    for (const t of trees) {
      if (t.shakeT > 0) { t.shakeT = Math.max(0, t.shakeT - dt); drawTree(t); }
      if (t.state === 'falling') {
        t.fall = Math.min(1, t.fall + dt * (0.4 + t.fall * 2.2));
        drawTree(t);
        if (t.fall >= 1) {
          t.state = 'gone';
          drawTree(t);
          for (let k = 0; k < 3; k++) {
            const d = 1.5 + k * 1.7;
            addItem('log', t.x + Math.cos(t.fallDir) * d, t.z + Math.sin(t.fallDir) * d, { rot: -t.fallDir });
          }
          t.onFallen?.(t);
        }
      }
    }
    cTrunk.instanceMatrix.needsUpdate = true;
    cCrown.instanceMatrix.needsUpdate = true;
    // bushes regrow
    for (const b of bushes) {
      if (b.berries < BERRIES) {
        b.regrow += dt;
        if (b.regrow > 17) { b.regrow = 0; b.berries++; drawBush(b); }
      }
    }
    // spores
    for (let i = 0; i < SP_N; i++) {
      const p = sp[i];
      if (p.ambient) {
        p.x += (p.vx + Math.sin(time * 0.3 + p.ph) * 0.15) * dt;
        p.y += p.vy * dt * (0.5 + daylight * 0.5);
        p.z += (p.vz + Math.cos(time * 0.27 + p.ph) * 0.15) * dt;
        if (p.y > 10 || Math.hypot(p.x, p.z) > 36) { const a = R(0, Math.PI * 2), r = Math.sqrt(R(0, 1)) * 32; p.x = Math.cos(a) * r; p.z = Math.sin(a) * r; p.y = R(0.2, 1.5); }
      } else if (p.life > 0) {
        p.life -= dt;
        p.vx *= 1 - dt * 1.5; p.vz *= 1 - dt * 1.5; p.vy -= dt * 0.6;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.life <= 0) p.y = -100;
      } else p.y = -100;
      spPos[i * 3] = p.x; spPos[i * 3 + 1] = p.y; spPos[i * 3 + 2] = p.z;
    }
    spGeo.attributes.position.needsUpdate = true;
  }

  // ---- Public API ----
  return {
    scene, sun, update, setPhase, puff, heightAt,
    trees, bushes, items, fire, storage, huts,
    get daylight() { return daylight; },
    drawTree, drawBush, drawItem, drawStorage, drawHut, addHut, addItem,
    chopTree(t, power = 1) {
      if (t.state !== 'standing') return false;
      t.hp -= power;
      t.shakeT = 0.25;
      if (t.hp <= 0) { t.state = 'falling'; t.fall = 0.02; return true; }
      return false;
    },
    pickBerry(b) { if (b.berries <= 0) return false; b.berries--; drawBush(b); return true; },
    takeItem(it) { if (!it.alive) return false; it.alive = false; drawItem(it); return true; },
    setFire(lit) { fire.lit = lit; },
    restore({ fallenTrees = [], storageBuilt = false, huts: savedHuts = [], fire: savedFire = {} } = {}) {
      for (const id of fallenTrees) { const t = trees[id]; if (t) { t.state = 'gone'; drawTree(t); } }
      storage.built = storageBuilt; storage.progress = storageBuilt ? 1 : 0;
      for (const h of savedHuts) addHut(h.slot, h.built ? 1 : h.progress ?? 0);
      fire.discovered = !!savedFire.discovered; fire.lit = !!savedFire.lit; fire.fuel = savedFire.fuel ?? 0;
    },
    respawnMorning() {
      // a few new sticks, stones and mushrooms each morning
      for (let i = 0; i < 6; i++) { const p = freeSpot(4, CLEARING_R, [], 1); addItem('stick', p.x, p.z); }
      for (let i = 0; i < 3; i++) { const p = freeSpot(4, CLEARING_R, [], 1); addItem('stone', p.x, p.z); }
      for (let i = 0; i < 8; i++) { const p = freeSpot(6, CLEARING_R + 1, [], 1); addItem('mushroom', p.x, p.z); }
    },
    randomEdgePoint() { const a = R(0, Math.PI * 2); return { x: Math.cos(a) * (CLEARING_R + 4), z: Math.sin(a) * (CLEARING_R + 4) }; },
    randomClearingPoint(r = CLEARING_R - 2) { const a = R(0, Math.PI * 2), d = Math.sqrt(R(0, 1)) * r; return { x: Math.cos(a) * d, z: Math.sin(a) * d }; },
  };
}
