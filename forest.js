// forest.js — the world: a bright forest clearing with gentle hills, a dirt path, a stream
// with stones, a small pond with reeds and lily pads, a dense forest edge (two LOD rings,
// split into sectors), fallen trees and stumps, choppable trees, berry bushes, food mushrooms,
// stones, sticks, a fire pit, huts, a storage pile and faction banners.
// Models come from assets.js (CC0 packs if present, otherwise hand-made low-poly models).
import * as THREE from './vendor/three.module.js';
import { glowTexture } from './icons.js';
import { instancedSet } from './assets.js';
import { applyWind, createWaterMaterial, wind } from './effects.js';

export const CLEARING_R = 24;
export const FIRE_POS = { x: 1.5, z: 3 };
export const STORAGE_POS = { x: -5, z: 6.5 };
export const POND = { x: -16.5, z: -3.5, r: 3.4 };

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
// Stream, path, pond and terrain height
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

// Dirt path: storage -> fire -> ford over the stream
const PATH = [[STORAGE_POS.x, STORAGE_POS.z], [-1.5, 4.8], [FIRE_POS.x, FIRE_POS.z], [3.2, -3], [4.6, -8], [6.5, -12.6]];
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}
export function pathDist(x, z) {
  let d = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) d = Math.min(d, segDist(x, z, ...PATH[i], ...PATH[i + 1]));
  return d;
}
const pondDist = (x, z) => Math.hypot(x - POND.x, z - POND.z);

function rawHeight(x, z) {
  const d = Math.hypot(x, z);
  const hills = (Math.sin(x * 0.08) + Math.cos(z * 0.07) + Math.sin((x + z) * 0.05)) * 0.3
    + Math.sin(x * 0.21 + 1) * Math.cos(z * 0.19) * 0.12;
  const edge = smooth(CLEARING_R * 0.85, CLEARING_R * 1.7, d);
  let h = hills * (0.5 + edge * 2.5) + edge * 2.2;
  h -= 0.85 * (1 - smooth(0.9, 2.8, streamDist(x, z)));
  h -= 0.1 * (1 - smooth(0.5, 1.4, pathDist(x, z)));
  h -= 1.0 * (1 - smooth(POND.r * 0.6, POND.r + 1.4, pondDist(x, z)));
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
export const inPond = (x, z, pad = 0) => pondDist(x, z) < POND.r + pad;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...extra });
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

function instanced(geo, mat, count, { cast = true, receive = true } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.castShadow = cast; m.receiveShadow = receive;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return m;
}
function matrixOf(x, y, z, s = 1, ry = 0, rx = 0, rz = 0, sy = s) {
  dummy.position.set(x, y, z);
  dummy.rotation.set(rx, ry, rz);
  dummy.scale.set(s, sy, s);
  dummy.updateMatrix();
  return dummy.matrix;
}
function setInst(mesh, i, ...args) { mesh.setMatrixAt(i, matrixOf(...args)); }
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function hideInst(mesh, i) { mesh.setMatrixAt(i, ZERO); }

function blocked(x, z) {
  return isNearStream(x, z, 2.6) || inPond(x, z, 1.8) || pathDist(x, z) < 1.4
    || Math.hypot(x - FIRE_POS.x, z - FIRE_POS.z) < 4.5 || Math.hypot(x - STORAGE_POS.x, z - STORAGE_POS.z) < 3.5;
}
function freeSpot(minR, maxR, taken, minGap = 2.5) {
  for (let k = 0; k < 300; k++) {
    const a = R(0, Math.PI * 2), r = Math.sqrt(R(minR * minR, maxR * maxR));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (blocked(x, z)) continue;
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
}).filter((p) => !isNearStream(p.x, p.z, 3) && !inPond(p.x, p.z, 2.5) && pathDist(p.x, p.z) > 2 && Math.hypot(p.x - STORAGE_POS.x, p.z - STORAGE_POS.z) > 3.5);

// Faction camp spots near the clearing's rim
export const CAMP_SPOTS = [0.9, 2.6, 4.3, 5.6].map((a) => ({ x: Math.cos(a) * 18.5, z: Math.sin(a) * 18.5 }))
  .map((p) => (blocked(p.x, p.z) ? { x: p.x * 0.85, z: p.z * 0.85 } : p));

const SWAY_REF = { tree: 7, pine: 8, bush: 1.4, flower: 0.45, grass: 0.45, reed: 1.3 };

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------
export async function createForest(lib, { shadowSize = 1024 } = {}) {
  const scene = new THREE.Scene();
  const taken = [];
  const glow = glowTexture();
  const waters = [];
  const windMatCache = new Map();
  const onMaterial = (kind) => (mat, part) => {
    if (!part.sway) return mat;
    const key = `${mat.uuid}:${kind}`;
    if (!windMatCache.has(key)) windMatCache.set(key, applyWind(mat, part.sway * Math.pow(SWAY_REF[kind] ?? 1, 0.6), SWAY_REF[kind] ?? 1));
    return windMatCache.get(key);
  };

  /** Place instances of a library kind. items: [{x, z, y?, s, ry, rx?, rz?, v}] */
  function place(kind, items, { cast = false, colorFn } = {}) {
    const variants = lib.get(kind);
    if (!variants.length) return [];
    const byV = new Map();
    for (const it of items) { const v = (it.v ?? Math.floor(rand() * 1e6)) % variants.length; if (!byV.has(v)) byV.set(v, []); byV.get(v).push(it); }
    const sets = [];
    for (const [v, list] of byV) {
      const set = instancedSet(variants[v], list.length, { cast, receive: true, colors: !!colorFn, onMaterial: onMaterial(kind) });
      list.forEach((it, i) => {
        set.setMatrixAt(i, matrixOf(it.x, it.y ?? heightAt(it.x, it.z), it.z, it.s ?? 1, it.ry ?? 0, it.rx ?? 0, it.rz ?? 0, it.sy ?? it.s ?? 1));
        if (colorFn) set.setColorAt(i, colorFn(it, tmpColor));
      });
      set.update();
      scene.add(set.group);
      sets.push(set);
    }
    return sets;
  }

  // ---- Terrain ----
  const SIZE = 170, SEG = 120;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x5fbf45), cLight = new THREE.Color(0x9be06a), cDark = new THREE.Color(0x2f7f3a);
  const cMoss = new THREE.Color(0x2a6535), cBank = new THREE.Color(0xc2ad72), cDirt = new THREE.Color(0xa77f52), cMud = new THREE.Color(0x6f6a4a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    const d = Math.hypot(x, z);
    const n = Math.sin(x * 0.35) * Math.cos(z * 0.31) * 0.5 + Math.sin((x - z) * 0.13) * 0.5;
    tmpColor.copy(cGrass).lerp(cLight, Math.max(0, n) * 0.55).lerp(cDark, Math.max(0, -n) * 0.4);
    tmpColor.lerp(cMoss, smooth(CLEARING_R * 0.9, CLEARING_R * 1.5, d) * 0.8);
    tmpColor.lerp(cBank, (1 - smooth(1.4, 3.2, streamDist(x, z))) * 0.75);
    tmpColor.lerp(cMud, (1 - smooth(POND.r * 0.8, POND.r + 1.6, pondDist(x, z))) * 0.75);
    tmpColor.lerp(cDirt, (1 - smooth(0.45, 1.25, pathDist(x, z))) * 0.85);
    cols[i * 3] = tmpColor.r; cols[i * 3 + 1] = tmpColor.g; cols[i * 3 + 2] = tmpColor.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---- Water: stream + pond ----
  const streamMat = createWaterMaterial({ flow: true });
  waters.push(streamMat);
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
  wg.setIndex(widx);
  const water = new THREE.Mesh(wg, streamMat);
  water.renderOrder = 2;
  scene.add(water);
  const pondMat = createWaterMaterial({ flow: false });
  waters.push(pondMat);
  const pondY = heightAt(POND.x + POND.r + 1.2, POND.z) - 0.32;
  const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 0.5, 32), pondMat);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(POND.x, pondY, POND.z);
  pond.renderOrder = 2;
  scene.add(pond);

  // stones along the banks, stepping stones at the ford
  const bank = [];
  for (let i = 0; i < 110; i++) {
    const p = streamPts[Math.floor(R(0, streamPts.length))];
    const a = R(0, Math.PI * 2), r = R(1.7, 2.7);
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    bank.push({ x, z, y: heightAt(x, z) + 0.05, s: R(0.5, 1.2), ry: R(0, 6) });
  }
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; bank.push({ x: POND.x + Math.cos(a) * (POND.r + 0.7), z: POND.z + Math.sin(a) * (POND.r + 0.7), s: R(0.5, 1), ry: a }); }
  for (let i = 0; i < 5; i++) { const t = i / 4; bank.push({ x: 6.5 + (t - 0.5) * 0.8, z: -12.6 - 1.6 + t * 3.2, y: heightAt(6.5, -14) + 0.42, s: 1.3, sy: 0.5, ry: i }); }
  place('stone', bank);

  // ---- Forest edge: near ring (detailed, sectors, shadows) and far ring (simple LOD) ----
  const nearItems = [[], [], [], []], farItems = [];
  const sideClearing = (x, z) => Math.sin(Math.atan2(z, x) * 3 + 1) > 0.82 && Math.hypot(x, z) < 34; // a few gaps / small clearings
  for (let i = 0; i < 520; i++) {
    const a = R(0, Math.PI * 2), r = R(CLEARING_R + 2.5, 80);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (isNearStream(x, z, 3) || sideClearing(x, z)) continue;
    const it = { x, z, s: R(0.85, 1.25) * (r > 50 ? 1.2 : 1), ry: R(0, 6), pine: rand() < 0.35, v: Math.floor(R(0, 99)) };
    if (r < 48) nearItems[Math.floor(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2))].push(it);
    else farItems.push(it);
  }
  for (const sector of nearItems) {
    place('tree', sector.filter((t) => !t.pine), { cast: true });
    place('pine', sector.filter((t) => t.pine), { cast: true });
  }
  // far LOD: one cheap blob/cone per tree
  {
    const farBlob = new THREE.IcosahedronGeometry(2.4, 0); farBlob.translate(0, 5, 0);
    const farCone = new THREE.ConeGeometry(2.1, 6.5, 6); farCone.translate(0, 5, 0);
    const farTrunk = new THREE.CylinderGeometry(0.2, 0.32, 3, 5); farTrunk.translate(0, 1.5, 0);
    const leafMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85 });
    const fb = instanced(farBlob, leafMat, farItems.length, { cast: false });
    const fc = instanced(farCone, leafMat, farItems.length, { cast: false });
    const ft = instanced(farTrunk, std(0x6b4630), farItems.length, { cast: false });
    let nb = 0, nc = 0;
    const greens = [0x2f8a3e, 0x2c7f45, 0x3d8f2e, 0x1f5e3a, 0x2f7a3f];
    farItems.forEach((t, i) => {
      ft.setMatrixAt(i, matrixOf(t.x, heightAt(t.x, t.z), t.z, t.s));
      tmpColor.setHex(greens[i % greens.length]);
      if (t.pine) { fc.setMatrixAt(nc, matrixOf(t.x, heightAt(t.x, t.z), t.z, t.s)); fc.setColorAt(nc++, tmpColor); }
      else { fb.setMatrixAt(nb, matrixOf(t.x, heightAt(t.x, t.z), t.z, t.s, t.ry, 0, 0, t.s * 0.85)); fb.setColorAt(nb++, tmpColor); }
    });
    fb.count = nb; fc.count = nc;
    for (const m of [fb, fc, ft]) { m.computeBoundingSphere(); scene.add(m); }
  }

  // ---- Ground cover: grass clumps, flowers, reeds, lilies, rocks, stumps, fallen trees, wild mushrooms ----
  const grass = [];
  for (let i = 0; i < 1500; i++) {
    const a = R(0, Math.PI * 2), r = Math.sqrt(R(0, 1)) * (CLEARING_R + 9);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (isNearStream(x, z, 1.8) || inPond(x, z, 0.6) || pathDist(x, z) < 0.9 || Math.hypot(x - FIRE_POS.x, z - FIRE_POS.z) < 2.2) continue;
    grass.push({ x, z, s: R(0.8, 1.6), ry: R(0, 6) });
  }
  place('grass', grass, { colorFn: (it, c) => c.setHSL(0.27 + R(-0.03, 0.03), 0.6, 0.55 + R(-0.08, 0.08)) });
  const flowerSpots = [];
  const flowers = [];
  for (let i = 0; i < 18; i++) { // flowers grow in patches
    const c = freeSpot(5, CLEARING_R + 2, [], 1);
    flowerSpots.push(c);
    const v = Math.floor(R(0, 6));
    for (let k = 0; k < 16; k++) {
      const x = c.x + R(-1.8, 1.8), z = c.z + R(-1.8, 1.8);
      if (blocked(x, z)) continue;
      flowers.push({ x, z, s: R(0.8, 1.3), ry: R(0, 6), v: rand() < 0.75 ? v : Math.floor(R(0, 6)) });
    }
  }
  place('flower', flowers);
  const reeds = [];
  for (let i = 0; i < 34; i++) { const a = R(0, Math.PI * 2); reeds.push({ x: POND.x + Math.cos(a) * (POND.r + R(-0.1, 0.6)), z: POND.z + Math.sin(a) * (POND.r + R(-0.1, 0.6)), s: R(0.8, 1.2), ry: R(0, 6) }); }
  for (let i = 0; i < 40; i++) { const p = streamPts[60 + Math.floor(R(0, 150))]; const a = R(0, Math.PI * 2); reeds.push({ x: p.x + Math.cos(a) * 1.9, z: p.z + Math.sin(a) * 1.9, s: R(0.7, 1.1), ry: R(0, 6) }); }
  place('reed', reeds);
  const lilies = [];
  for (let i = 0; i < 9; i++) { const a = R(0, Math.PI * 2), r = R(0.6, POND.r - 0.6); lilies.push({ x: POND.x + Math.cos(a) * r, z: POND.z + Math.sin(a) * r, y: pondY + 0.02, s: R(0.8, 1.3), ry: R(0, 6), v: i }); }
  place('lily', lilies);
  const rocks = [];
  for (let i = 0; i < 16; i++) { const p = freeSpot(CLEARING_R - 5, CLEARING_R + 5, taken, 3); rocks.push({ x: p.x, z: p.z, y: heightAt(p.x, p.z) - 0.1, s: R(0.8, 1.8), ry: R(0, 6) }); }
  place('rock', rocks, { cast: true });
  const stumps = [];
  for (let i = 0; i < 6; i++) { const p = freeSpot(CLEARING_R - 6, CLEARING_R + 3, taken, 3); stumps.push({ x: p.x, z: p.z, s: R(0.9, 1.3), ry: R(0, 6) }); }
  place('stump', stumps, { cast: true });
  const fallen = [];
  for (let i = 0; i < 4; i++) { const p = freeSpot(CLEARING_R - 3, CLEARING_R + 6, taken, 5); fallen.push({ x: p.x, z: p.z, y: heightAt(p.x, p.z) - 0.05, s: 1.4, ry: R(0, 6), sy: 1.3 }); }
  place('log', fallen.map((f) => ({ ...f, s: 2.3, sy: 1.6 })), { cast: true });
  const wild = [];
  for (let i = 0; i < 36; i++) { const a = R(0, Math.PI * 2), r = R(CLEARING_R + 1, CLEARING_R + 8); const x = Math.cos(a) * r, z = Math.sin(a) * r; if (!isNearStream(x, z, 2)) wild.push({ x, z, s: R(0.8, 1.5), ry: R(0, 6) }); }
  place('mushroom', wild);

  // ---- Choppable trees ----
  const TREE_N = 14;
  const trees = [];
  const treeVariants = lib.get('tree');
  for (let i = 0; i < TREE_N; i++) {
    const p = freeSpot(14, CLEARING_R - 1, taken, 4);
    trees.push({ id: i, x: p.x, z: p.z, y: heightAt(p.x, p.z), s: R(0.8, 1.0), ry: R(0, 6), v: i % treeVariants.length, hp: 6, fall: 0, fallDir: R(0, Math.PI * 2), state: 'standing', reservedBy: null });
  }
  const treeSets = treeVariants.map((variant, v) => {
    const list = trees.filter((t) => t.v === v);
    list.forEach((t, k) => { t.inst = k; });
    if (!list.length) return null;
    const set = instancedSet(variant, list.length, { cast: true, onMaterial: onMaterial('tree') });
    scene.add(set.group);
    return set;
  });
  const treeMat = new THREE.Matrix4(), q = new THREE.Quaternion(), axis = new THREE.Vector3(), qs = new THREE.Quaternion(), qy = new THREE.Quaternion();
  function drawTree(t) {
    const set = treeSets[t.v];
    if (!set) return;
    if (t.state === 'gone') { set.setMatrixAt(t.inst, ZERO); set.markDirty(); return; }
    const ang = t.fall * (Math.PI / 2) * 0.96;
    axis.set(Math.cos(t.fallDir + Math.PI / 2), 0, Math.sin(t.fallDir + Math.PI / 2));
    q.setFromAxisAngle(axis, ang);
    const shake = t.shakeT > 0 ? Math.sin(t.shakeT * 60) * 0.03 * t.shakeT * 4 : 0;
    qs.setFromAxisAngle(new THREE.Vector3(0, 0, 1), shake);
    qy.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.ry);
    treeMat.compose(new THREE.Vector3(t.x, t.y, t.z), q.multiply(qs).multiply(qy), new THREE.Vector3(t.s, t.s, t.s));
    set.setMatrixAt(t.inst, treeMat);
    set.markDirty();
  }
  trees.forEach(drawTree);
  treeSets.forEach((s) => s?.update());

  // ---- Items: sticks, stones, logs, food mushrooms ----
  const items = []; // { kind, x, z, alive, idx, reservedBy }
  const twig = (() => {
    const a = new THREE.CylinderGeometry(0.045, 0.06, 1.15, 5); a.rotateZ(Math.PI / 2);
    const b = new THREE.CylinderGeometry(0.025, 0.035, 0.45, 4); b.rotateZ(Math.PI / 2 - 0.7); b.translate(0.15, 0.08, 0);
    const g = new THREE.BufferGeometry();
    const ga = a.toNonIndexed(), gb = b.toNonIndexed();
    const P = new Float32Array(ga.attributes.position.count * 3 + gb.attributes.position.count * 3);
    P.set(ga.attributes.position.array); P.set(gb.attributes.position.array, ga.attributes.position.array.length);
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.computeVertexNormals();
    return g;
  })();
  const caps = { stick: 40, stone: 40, log: 60, mushroom: 34 };
  const itemSets = {
    stick: { meshes: [instanced(twig, std(0x8b5e3c), caps.stick)], set: null },
    stone: { set: instancedSet(lib.get('stone')[0], caps.stone, { cast: true }) },
    log: { set: instancedSet(lib.get('log')[0], caps.log, { cast: true }) },
    mushroom: { set: instancedSet(lib.get('mushroom')[Math.min(1, lib.get('mushroom').length - 1)], caps.mushroom, { cast: false }) },
  };
  const itemApi = (kind) => {
    const it = itemSets[kind];
    if (it.set) return it.set;
    const m = it.meshes[0];
    return { group: m, setMatrixAt: (i, mat) => m.setMatrixAt(i, mat), markDirty: () => { m.instanceMatrix.needsUpdate = true; }, update: () => { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); } };
  };
  const counters = { stick: 0, stone: 0, log: 0, mushroom: 0 };
  for (const k of Object.keys(caps)) { const a = itemApi(k); for (let i = 0; i < caps[k]; i++) a.setMatrixAt(i, ZERO); scene.add(a.group); a.markDirty(); }
  function drawItem(it) {
    const a = itemApi(it.kind);
    if (!it.alive) { a.setMatrixAt(it.idx, ZERO); a.markDirty(); return; }
    const y = heightAt(it.x, it.z);
    if (it.kind === 'stick') a.setMatrixAt(it.idx, matrixOf(it.x, y + 0.06, it.z, 1, it.rot));
    else if (it.kind === 'stone') a.setMatrixAt(it.idx, matrixOf(it.x, y + 0.05, it.z, it.size * 1.1, it.rot));
    else if (it.kind === 'log') a.setMatrixAt(it.idx, matrixOf(it.x, y - 0.05, it.z, 0.85, it.rot));
    else a.setMatrixAt(it.idx, matrixOf(it.x, y, it.z, it.size * 1.2, it.rot));
    a.markDirty();
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
  for (let i = 0; i < 22; i++) { const p = freeSpot(3, CLEARING_R, taken, 1.2); addItem('stick', p.x, p.z); }
  for (let i = 0; i < 16; i++) { const p = freeSpot(4, CLEARING_R, taken, 1.2); addItem('stone', p.x, p.z); }
  for (let i = 0; i < 10; i++) {
    const p = streamPts[60 + Math.floor(R(0, 140))];
    const a = R(0, Math.PI * 2);
    addItem('stone', p.x + Math.cos(a) * 2.7, p.z + Math.sin(a) * 2.7);
  }
  for (let i = 0; i < 14; i++) { const p = freeSpot(6, CLEARING_R + 1, taken, 1.2); addItem('mushroom', p.x, p.z); }
  for (const k of Object.keys(caps)) itemApi(k).update();

  // ---- Berry bushes ----
  const BUSH_N = 11, BERRIES = 6;
  const bushes = [];
  const bushItems = [];
  for (let i = 0; i < BUSH_N; i++) {
    const p = freeSpot(7, CLEARING_R - 1, taken, 3);
    const b = { id: i, x: p.x, z: p.z, y: heightAt(p.x, p.z), berries: BERRIES, regrow: 0, color: [0xe8264f, 0x6b3cff, 0xff4f9a][i % 3], spots: [] };
    for (let k = 0; k < BERRIES; k++) { const a = (k / BERRIES) * Math.PI * 2 + R(0, 0.5); b.spots.push({ x: Math.cos(a) * 0.8, y: R(0.45, 1.05), z: Math.sin(a) * 0.8 }); }
    bushItems.push({ x: b.x, z: b.z, s: 1.05, ry: R(0, 6), v: i });
    bushes.push(b);
  }
  place('bush', bushItems, { cast: true });
  const berryMesh = instanced(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0x220011 }), BUSH_N * BERRIES, { cast: false });
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
  scene.add(berryMesh);

  const logGeo = new THREE.CylinderGeometry(0.28, 0.3, 1.8, 8); logGeo.rotateZ(Math.PI / 2);
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
    h.roof.rotation.z = h.damaged ? 0.5 : 0; h.roof.position.x = h.damaged ? 0.45 : 0;
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


  // ---- Faction banners ----
  const banners = [];
  function addBanner(x, z, color) {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z), z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), std(0x7b5236));
    pole.position.y = 1.6; pole.castShadow = true;
    const flagGeo = new THREE.PlaneGeometry(1.3, 0.8, 6, 1); flagGeo.translate(0.65, 0, 0);
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, side: THREE.DoubleSide, roughness: 0.6 }));
    flag.position.y = 2.75; flag.castShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.9, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
    g.add(pole, flag, ring);
    scene.add(g);
    const b = { g, flag, base: flagGeo.attributes.position.array.slice() };
    banners.push(b);
    return b;
  }
  function removeBanner(b) { if (!b) return; scene.remove(b.g); banners.splice(banners.indexOf(b), 1); }

  // ---- Sky, fog, lights ----
  const skyUniforms = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float vY; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.6, vY)), 1.0);\n#include <colorspace_fragment>\n}',
  }));
  scene.add(sky);
  scene.fog = new THREE.Fog(0xcfeee0, 50, 140);

  const hemi = new THREE.HemisphereLight(0xd8f2ff, 0x4f7a32, 1.2);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 5, far: 140 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05; sun.shadow.radius = 5;
  scene.add(hemi, sun, sun.target);
  const sunDir = new THREE.Vector3(0.6, 0.7, 0.4).normalize();
  let shadowFocus = { x: 0, z: 0, size: 26 };
  function setShadowFocus(x, z, size) {
    shadowFocus = { x, z, size: Math.max(10, Math.min(40, size)) };
  }
  function setShadowSize(px) {
    sun.shadow.mapSize.set(px, px);
    sun.shadow.map?.dispose(); sun.shadow.map = null;
  }

  // ---- Day/night (phase 0..1): dawn, day, golden hour, dusk, night, pre-dawn ----
  const K = (h) => new THREE.Color(h);
  const SKY = [
    [0.0, K(0xf5b8a8), K(0xffe2c4)], [0.06, K(0x9fd0ff), K(0xffe8d0)], [0.14, K(0x62c0ff), K(0xd6f2ff)], [0.55, K(0x5fbcff), K(0xd2f0ff)],
    [0.63, K(0x7aa8e8), K(0xffd8a8)], [0.69, K(0x8a6ab8), K(0xff9e70)], [0.74, K(0x3a3478), K(0x9a5a7a)], [0.8, K(0x161c48), K(0x2e3264)],
    [0.93, K(0x121840), K(0x283060)], [1.0, K(0xf5b8a8), K(0xffe2c4)],
  ];
  const FOG = [[0, K(0xf0d4c0)], [0.14, K(0xcdeee0)], [0.55, K(0xcdeee0)], [0.66, K(0xf2d0a8)], [0.72, K(0xb07a8a)], [0.8, K(0x262c50)], [0.93, K(0x222a50)], [1, K(0xf0d4c0)]];
  const SUNCOL = [[0, K(0xffb08a)], [0.12, K(0xfff0d8)], [0.55, K(0xfff4e0)], [0.66, K(0xffc078)], [0.72, K(0xff8a5a)], [0.78, K(0x9fb0ff)], [0.95, K(0x9fb0ff)], [1, K(0xffb08a)]];
  const sample = (keys, t, idx, out) => {
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i][0] && t <= keys[i + 1][0]) {
        const u = smooth(0, 1, (t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]));
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
    daylight = t < 0.08 ? 0.35 + (t / 0.08) * 0.65 : t < 0.64 ? 1 : t < 0.78 ? 1 - smooth(0.64, 0.78, t) : t < 0.93 ? 0 : ((t - 0.93) / 0.07) * 0.35;
    const a = Math.min(Math.max(t / 0.74, 0), 1) * Math.PI;
    sunDir.set(Math.cos(a) * 0.8, 0.25 + Math.sin(a) * 0.75, 0.45).normalize();
    if (daylight < 0.25) sunDir.set(-0.4, 0.8, 0.45).normalize(); // moon
    sample(SUNCOL, t, 1, sun.color);
    sun.intensity = 0.55 + daylight * 2.4;
    hemi.intensity = 0.65 + daylight * 0.65;
    hemi.color.setHSL(0.58, 0.6, 0.42 + daylight * 0.42);
    hemi.groundColor.setHSL(0.27, 0.35, 0.12 + daylight * 0.18);
    beamMat.opacity = 0.18 * daylight * (t > 0.6 ? 1.4 : 1);
    spMat.opacity = 0.6 + (1 - daylight) * 0.4;
    for (const w of waters) { w.uniforms.uLight.value = 0.35 + daylight * 0.65; w.uniforms.uSky.value.copy(skyUniforms.bottom.value); }
    return daylight;
  }

  // ---- Per-frame update ----
  function update(dt, time, camera) {
    sky.position.copy(camera.position);
    wind.time.value = time;
    for (const w of waters) w.uniforms.uTime.value = time;
    // sun + shadow camera follow the area the camera looks at
    const fy = heightAt(shadowFocus.x, shadowFocus.z);
    sun.target.position.set(shadowFocus.x, fy, shadowFocus.z);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 70);
    const sc = sun.shadow.camera;
    if (Math.abs(sc.right - shadowFocus.size) > 0.5) { sc.left = sc.bottom = -shadowFocus.size; sc.right = sc.top = shadowFocus.size; sc.updateProjectionMatrix(); }
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
    // banners wave
    for (const b of banners) {
      const p = b.flag.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = b.base[i * 3]; p.setZ(i, Math.sin(time * 5 + x * 3) * 0.12 * x); }
      p.needsUpdate = true;
    }
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

  /** Brown dust cloud (scuffles). */
  function dust(x, z, n = 26) { puff(x, z, 0xb89a70, n, 0.4); }

  // ---- Public API ----
  return {
    scene, sun, update, setPhase, puff, dust, heightAt, setShadowFocus, setShadowSize,
    trees, bushes, items, fire, storage, huts, flowerSpots,
    get daylight() { return daylight; },
    drawTree, drawBush, drawItem, drawStorage, drawHut, addHut, addItem, addBanner, removeBanner,
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
      for (const h of savedHuts) { const hut = addHut(h.slot, h.built ? 1 : h.progress ?? 0); if (hut) { hut.damaged = !!h.damaged; hut.faction = h.faction ?? null; if (h.damaged) drawHut(hut); } }
      fire.discovered = !!savedFire.discovered; fire.lit = !!savedFire.lit; fire.fuel = savedFire.fuel ?? 0;
    },
    respawnMorning() {
      for (let i = 0; i < 6; i++) { const p = freeSpot(4, CLEARING_R, [], 1); addItem('stick', p.x, p.z); }
      for (let i = 0; i < 3; i++) { const p = freeSpot(4, CLEARING_R, [], 1); addItem('stone', p.x, p.z); }
      for (let i = 0; i < 8; i++) { const p = freeSpot(6, CLEARING_R + 1, [], 1); addItem('mushroom', p.x, p.z); }
    },
    randomEdgePoint() { const a = R(0, Math.PI * 2); return { x: Math.cos(a) * (CLEARING_R + 4), z: Math.sin(a) * (CLEARING_R + 4) }; },
    randomClearingPoint(r = CLEARING_R - 2) {
      for (let k = 0; k < 20; k++) { const a = R(0, Math.PI * 2), d = Math.sqrt(R(0, 1)) * r; const x = Math.cos(a) * d, z = Math.sin(a) * d; if (!inPond(x, z, 1)) return { x, z }; }
      return { x: 0, z: 0 };
    },
  };
}
