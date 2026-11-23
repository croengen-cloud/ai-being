// assets.js — the model library. Every kind of nature prop (tree, bush, flower, grass, rock,
// stone, log, stump, mushroom, reed, lily) has several variants. If real CC0 models are present
// (assets/models/manifest.json, e.g. from the Kenney Nature Kit) they are loaded with GLTFLoader;
// otherwise hand-made low-poly variants are generated in code.
//
// A variant is { parts: [{ geometry, material, sway }], height } — geometries are merged per
// material so each variant becomes one InstancedMesh per material (few draw calls).
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from './vendor/jsm/utils/BufferGeometryUtils.js';

// Target sizes (metres) so any source model fits the world scale.
const TARGET_HEIGHT = { tree: 7, pine: 8, bush: 1.4, flower: 0.45, grass: 0.45, reed: 1.3, rock: 1.1, stone: 0.45, log: 0.6, stump: 0.7, mushroom: 0.45, lily: 0.05 };

// ---------------------------------------------------------------------------
// Small helpers for procedural models
// ---------------------------------------------------------------------------
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const R = (a, b) => a + rnd() * (b - a);
const C = (hex) => new THREE.Color(hex);

function hashNoise(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
/** Organic wobble: push vertices along their direction from the centre. */
function displace(geo, amount, scale = 1.7) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = hashNoise(Math.round(v.x * scale * 10) / 10, Math.round(v.y * scale * 10) / 10, Math.round(v.z * scale * 10) / 10) - 0.5;
    v.multiplyScalar(1 + n * amount);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return geo;
}
/** Vertex colours from a function (position, normal) -> Color. Geometry becomes non-indexed for crisp low-poly faces. */
function paint(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    // one colour per face (flat look)
    P.set(0, 0, 0); N.set(0, 0, 0);
    for (let k = 0; k < 3; k++) { P.x += p.getX(i + k) / 3; P.y += p.getY(i + k) / 3; P.z += p.getZ(i + k) / 3; N.x += n.getX(i + k); N.y += n.getY(i + k); N.z += n.getZ(i + k); }
    N.normalize();
    const c = fn(P, N);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
const tf = (geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sx = s, sy = s, sz = s } = {}) => {
  geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  return geo;
};

// Shared materials (vertex coloured, flat shaded = clean low-poly look)
const MAT = {
  bark: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }),
  leaf: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 }),
  plant: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, side: THREE.DoubleSide }),
  rock: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  shroom: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6 }),
};

// ---------------------------------------------------------------------------
// Procedural variants
// ---------------------------------------------------------------------------
function barkColor(base) {
  const c = C(base);
  return (p) => c.clone().offsetHSL(0, 0, (hashNoise(p.x, p.y * 3, p.z) - 0.5) * 0.08 - Math.max(0, 0.6 - p.y) * 0.08);
}
function trunk(h, r0, r1, base = 0x7b5236, segs = 7) {
  const g = new THREE.CylinderGeometry(r1, r0, h, segs, 3);
  g.translate(0, h / 2, 0);
  // root flare
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0.3) { p.setX(i, p.getX(i) * 1.35); p.setZ(i, p.getZ(i) * 1.35); } }
  return paint(g, barkColor(base));
}
function foliage(blobs, cLow, cHigh, top) {
  const lo = C(cLow), hi = C(cHigh);
  const parts = blobs.map(([x, y, z, r]) => displace(tf(new THREE.IcosahedronGeometry(r, 1), { x, y, z }), 0.28));
  return paint(merge(parts), (p, n) => lo.clone().lerp(hi, Math.min(1, Math.max(0, (p.y - top * 0.55) / (top * 0.5)) * 0.8 + Math.max(0, n.y) * 0.35)).offsetHSL((hashNoise(p.x, p.y, p.z) - 0.5) * 0.03, 0, (hashNoise(p.z, p.x, p.y) - 0.5) * 0.05));
}

function makeOak(v) {
  const h = 3.2 + v * 0.4;
  const blobs = [];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + v; blobs.push([Math.cos(a) * 1.3, h + R(0, 0.9), Math.sin(a) * 1.3, R(1.2, 1.6)]); }
  blobs.push([0, h + 1.5, 0, 1.8], [R(-0.4, 0.4), h + 2.5, R(-0.4, 0.4), 1.3]);
  const palettes = [[0x2f8a3e, 0x8fd65a], [0x2c7f45, 0x7cc95a], [0x3d8f2e, 0xb2d84a]];
  const [lo, hi] = palettes[v % 3];
  return [{ geometry: trunk(h + 0.6, 0.38, 0.24), material: MAT.bark }, { geometry: foliage(blobs, lo, hi, h + 3.5), material: MAT.leaf, sway: 0.06 }];
}
function makePine(v) {
  const layers = [];
  const n = 4 + (v % 2);
  for (let i = 0; i < n; i++) {
    const r = 2.0 - i * 0.38, y = 1.6 + i * 1.25;
    layers.push(displace(tf(new THREE.ConeGeometry(r, 2.2, 8, 1), { y: y + 1.1, ry: i * 0.4 }), 0.12));
  }
  const lo = C(0x1f5e3a), hi = C(v % 2 ? 0x4f9a52 : 0x3f8f5a);
  const leaves = paint(merge(layers), (p, nn) => lo.clone().lerp(hi, Math.max(0, nn.y) * 0.6 + p.y / 14));
  return [{ geometry: trunk(2.2, 0.32, 0.22, 0x6b4630), material: MAT.bark }, { geometry: leaves, material: MAT.leaf, sway: 0.04 }];
}
function makeBirch(v) {
  const h = 4.2;
  const white = C(0xeeeae0), dark = C(0x3a3430);
  const t = paint(tf(new THREE.CylinderGeometry(0.16, 0.24, h, 7, 6), { y: h / 2 }), (p) => (hashNoise(Math.floor(p.y * 3), p.x > 0 ? 1 : 0, 2) > 0.78 ? dark : white));
  const blobs = [[0, h + 0.4, 0, 1.2], [0.7, h - 0.3, 0.2, 0.9], [-0.6, h - 0.1, -0.4, 0.95], [0.1, h + 1.3, 0.1, 0.85]];
  return [{ geometry: t, material: MAT.bark }, { geometry: foliage(blobs, v % 2 ? 0x6ab04a : 0x5aa85a, 0xc8e86a, h + 2), material: MAT.leaf, sway: 0.08 }];
}
function makeRoundTree(v) {
  const h = 2.6;
  const blobs = [[0, h + 1.3, 0, 2.0], [0.9, h + 0.6, 0.5, 1.2], [-0.8, h + 0.7, -0.6, 1.25]];
  return [{ geometry: trunk(h + 0.5, 0.32, 0.22, 0x8a5a3a), material: MAT.bark }, { geometry: foliage(blobs, v % 2 ? 0x2f9a6a : 0x4aa03a, v % 2 ? 0x9ae07a : 0xd6e05a, h + 3.3), material: MAT.leaf, sway: 0.06 }];
}
function makeBush(v) {
  const blobs = [[0, 0.55, 0, 0.75], [0.55, 0.4, 0.2, 0.55], [-0.5, 0.42, -0.15, 0.58], [0.1, 0.45, -0.55, 0.5], [-0.1, 0.9, 0.1, 0.5]];
  return [{ geometry: foliage(blobs, v % 2 ? 0x2a7a3a : 0x2f8a46, v % 2 ? 0x7cc85a : 0x8fd06a, 1.2), material: MAT.leaf, sway: 0.05 }];
}
function makeFlower(v) {
  const petal = [0xff6fae, 0xffffff, 0xb07aff, 0x6fa8ff, 0xffb347, 0xff5a6a][v % 6];
  const stem = paint(tf(new THREE.CylinderGeometry(0.018, 0.022, 0.4, 4), { y: 0.2 }), () => C(0x3f8a3a));
  const leaf = paint(tf(new THREE.SphereGeometry(0.07, 4, 2), { x: 0.05, y: 0.12, sx: 1.6, sy: 0.25, sz: 0.7, rz: 0.4 }), () => C(0x4f9a3a));
  const petals = [];
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; petals.push(tf(new THREE.SphereGeometry(0.055, 5, 3), { x: Math.cos(a) * 0.065, y: 0.41, z: Math.sin(a) * 0.065, sx: 1.4, sy: 0.35, sz: 0.9, ry: -a })); }
  const pet = paint(merge(petals), () => C(petal));
  const center = paint(tf(new THREE.SphereGeometry(0.035, 5, 3), { y: 0.425 }), () => C(0xffd84a));
  return [{ geometry: merge([stem, leaf, pet, center]), material: MAT.plant, sway: 0.12 }];
}
function makeGrass(v) {
  const blades = [];
  const n = 7 + (v % 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, h = R(0.28, 0.5), lean = R(0.1, 0.35);
    const g = new THREE.BufferGeometry();
    const w = 0.035;
    const bx = Math.cos(a) * R(0, 0.08), bz = Math.sin(a) * R(0, 0.08);
    const tx = bx + Math.cos(a) * lean * h, tz = bz + Math.sin(a) * lean * h;
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      bx - w, 0, bz, bx + w, 0, bz, (bx + tx) / 2 + w * 0.6, h * 0.55, (bz + tz) / 2,
      bx - w, 0, bz, (bx + tx) / 2 + w * 0.6, h * 0.55, (bz + tz) / 2, (bx + tx) / 2 - w * 0.6, h * 0.55, (bz + tz) / 2,
      (bx + tx) / 2 - w * 0.6, h * 0.55, (bz + tz) / 2, (bx + tx) / 2 + w * 0.6, h * 0.55, (bz + tz) / 2, tx, h, tz,
    ], 3));
    blades.push(g);
  }
  const lo = C(v % 2 ? 0x3f8a32 : 0x2f7a3a), hi = C(v % 2 ? 0xb2e06a : 0x9ad86a);
  return [{ geometry: paint(merge(blades), (p) => lo.clone().lerp(hi, Math.min(1, p.y / 0.45))), material: MAT.plant, sway: 0.15 }];
}
function makeReed() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const x = R(-0.15, 0.15), z = R(-0.15, 0.15), h = R(0.9, 1.4);
    parts.push(paint(tf(new THREE.CylinderGeometry(0.012, 0.02, h, 3), { x, y: h / 2, z, rz: R(-0.12, 0.12) }), () => C(0x5a8a3a)));
    if (i % 2 === 0) parts.push(paint(tf(new THREE.CapsuleGeometry(0.035, 0.16, 2, 5), { x, y: h - 0.05, z }), () => C(0x6a4428)));
  }
  return [{ geometry: merge(parts), material: MAT.plant, sway: 0.1 }];
}
function makeRock(v, small = false) {
  const g = displace(new THREE.IcosahedronGeometry(small ? 0.32 : 0.75, 0), 0.45, 3);
  tf(g, { sy: R(0.55, 0.8), ry: v });
  const base = C(v % 2 ? 0x9aa0a6 : 0x8e9590), moss = C(0x5f8f3a);
  return [{ geometry: paint(g, (p, n) => base.clone().offsetHSL(0, 0, (hashNoise(p.x, p.y, p.z) - 0.5) * 0.1).lerp(moss, !small && n.y > 0.6 && hashNoise(p.z, p.x, 1) > 0.4 ? 0.7 : 0)), material: MAT.rock }];
}
function makeLog() {
  const bark = paint(tf(new THREE.CylinderGeometry(0.3, 0.32, 2, 8, 1), { rz: Math.PI / 2, y: 0.3 }), (p, n) => (Math.abs(n.x) > 0.9 ? C(0xd9b07a) : n.y > 0.7 && hashNoise(p.x, 2, 3) > 0.5 ? C(0x5f8f3a) : C(0x7b5236)));
  return [{ geometry: bark, material: MAT.bark }];
}
function makeStump() {
  const g = tf(new THREE.CylinderGeometry(0.38, 0.5, 0.6, 9, 1), { y: 0.3 });
  return [{ geometry: paint(g, (p, n) => (n.y > 0.9 ? C(0xd9b07a) : C(0x7b5236).offsetHSL(0, 0, (hashNoise(p.x, p.y, p.z) - 0.5) * 0.08))), material: MAT.bark }];
}
function makeMushroom(v) {
  const capCol = [0xd9452f, 0xc9894a, 0xe8d8b8][v % 3];
  const stem = paint(tf(new THREE.CylinderGeometry(0.06, 0.08, 0.28, 7), { y: 0.14 }), () => C(0xf4ecdc));
  const cap = paint(tf(new THREE.SphereGeometry(0.2, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), { y: 0.25, sy: 0.75 }), (p, n) => (v % 3 === 0 && hashNoise(Math.round(p.x * 20), Math.round(p.z * 20), 1) > 0.8 ? C(0xffffff) : C(capCol)));
  return [{ geometry: merge([stem, cap]), material: MAT.shroom }];
}
function makeLily(v) {
  const pad = new THREE.CircleGeometry(0.42, 10, 0.3, Math.PI * 2 - 0.3);
  pad.rotateX(-Math.PI / 2);
  const parts = [paint(pad, () => C(0x3f9a4a))];
  if (v % 2) parts.push(paint(tf(new THREE.ConeGeometry(0.12, 0.14, 6), { x: 0.1, y: 0.07 }), () => C(0xffd0e8)));
  return [{ geometry: merge(parts), material: MAT.plant }];
}

const PROCEDURAL = {
  tree: [0, 1, 2].map((v) => makeOak(v)).concat([makeBirch(0), makeRoundTree(0), makeRoundTree(1)]),
  pine: [makePine(0), makePine(1)],
  bush: [makeBush(0), makeBush(1)],
  flower: [0, 1, 2, 3, 4, 5].map(makeFlower),
  grass: [makeGrass(0), makeGrass(1), makeGrass(2)],
  reed: [makeReed()],
  rock: [makeRock(0), makeRock(1), makeRock(2)],
  stone: [makeRock(3, true), makeRock(4, true)],
  log: [makeLog()],
  stump: [makeStump()],
  mushroom: [makeMushroom(0), makeMushroom(1), makeMushroom(2)],
  lily: [makeLily(0), makeLily(1)],
};

// ---------------------------------------------------------------------------
// Real models (CC0 packs) via manifest
// ---------------------------------------------------------------------------
/** Kenney Nature Kit file names -> our kinds (used when the manifest lists plain files). */
export function kindForFile(name) {
  const n = name.toLowerCase();
  if (/^tree_pine|^tree_cone|tree_.*pine/.test(n)) return 'pine';
  if (/^tree_(?!palm)/.test(n)) return 'tree';
  if (/^plant_bush/.test(n)) return 'bush';
  if (/^flower_/.test(n)) return 'flower';
  if (/^grass/.test(n)) return 'grass';
  if (/reed|cattail/.test(n)) return 'reed';
  if (/lily/.test(n)) return 'lily';
  if (/^rock_(large|tall)|^cliff_block/.test(n)) return 'rock';
  if (/^rock_small|^stone_/.test(n)) return 'stone';
  if (/^log/.test(n)) return 'log';
  if (/^stump/.test(n)) return 'stump';
  if (/^mushroom/.test(n)) return 'mushroom';
  return null;
}

async function loadGltfVariant(loader, url, kind) {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const byMat = new Map();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (mats.length > 1 && geo.groups.length) {
      geo.groups.forEach((gr) => {
        const sub = geo.clone(); sub.setIndex(geo.index ? geo.index.array.slice(gr.start, gr.start + gr.count) : null);
        const m = mats[gr.materialIndex];
        if (!byMat.has(m)) byMat.set(m, []);
        byMat.get(m).push(sub);
      });
    } else {
      if (!byMat.has(mats[0])) byMat.set(mats[0], []);
      byMat.get(mats[0]).push(geo);
    }
  });
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const s = (TARGET_HEIGHT[kind] ?? 1) / h;
  const sway = { tree: 0.06, pine: 0.04, bush: 0.05, flower: 0.12, grass: 0.15, reed: 0.1 }[kind] ?? 0;
  const parts = [];
  for (const [mat, geos] of byMat) {
    const keep = ['position', 'normal', 'uv'];
    const clean = geos.map((g) => { const c = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(c.attributes)) if (!keep.includes(k)) c.deleteAttribute(k); if (!c.attributes.uv) c.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2)); return c; });
    const geometry = mergeGeometries(clean, false);
    geometry.translate(0, -box.min.y, 0);
    geometry.scale(s, s, s);
    const material = mat.clone();
    material.flatShading = true;
    if ('roughness' in material) material.roughness = Math.max(0.6, material.roughness ?? 0.8);
    // leafy materials sway, trunks do not
    const name = (mat.name || '').toLowerCase();
    const isWood = /wood|bark|trunk|log/.test(name);
    parts.push({ geometry, material, sway: isWood ? 0 : sway });
  }
  return parts;
}

/**
 * Returns { get(kind) -> variants[], source: 'kenney'|'procedural', counts }.
 * Missing kinds fall back to procedural variants.
 */
export async function loadModelLibrary(onProgress) {
  const lib = { ...PROCEDURAL };
  let source = 'procedural';
  const counts = {};
  try {
    const res = await fetch(new URL('./assets/models/manifest.json', import.meta.url));
    if (res.ok) {
      const manifest = await res.json();
      const files = Array.isArray(manifest.files) ? manifest.files : [];
      const loader = new GLTFLoader();
      const loaded = {};
      let done = 0;
      await Promise.all(files.map(async (f) => {
        const file = typeof f === 'string' ? f : f.file;
        if (!/^[\w.-]+\.glb$/i.test(file)) return;
        const kind = (typeof f === 'object' && f.kind) || kindForFile(file);
        if (!kind) return;
        try {
          const parts = await loadGltfVariant(loader, new URL(`./assets/models/${file}`, import.meta.url).href, kind);
          (loaded[kind] ??= []).push(parts);
        } catch (err) {
          console.warn('[assets] could not load', file, err?.message);
        }
        onProgress?.(++done / files.length);
      }));
      for (const [kind, variants] of Object.entries(loaded)) { lib[kind] = variants; counts[kind] = variants.length; }
      if (Object.keys(loaded).length) source = 'models';
    }
  } catch { /* no manifest: procedural only */ }
  return { get: (kind) => lib[kind] ?? [], source, counts };
}

// ---------------------------------------------------------------------------
// Instanced sets
// ---------------------------------------------------------------------------
/**
 * One InstancedMesh per part of a variant, sharing instance transforms.
 * opts: { cast, receive, colors (bool), onMaterial(material, part) }
 */
export function instancedSet(variant, count, { cast = false, receive = true, colors = false, onMaterial } = {}) {
  const group = new THREE.Group();
  const meshes = variant.map((part) => {
    const mat = onMaterial ? onMaterial(part.material, part) : part.material;
    const m = new THREE.InstancedMesh(part.geometry, mat, count);
    m.castShadow = cast; m.receiveShadow = receive;
    m.userData.sway = part.sway ?? 0;
    if (colors) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
    group.add(m);
    return m;
  });
  return {
    group, meshes, count,
    setMatrixAt(i, mat) { for (const m of meshes) m.setMatrixAt(i, mat); },
    setColorAt(i, c) { for (const m of meshes) m.setColorAt(i, c); },
    setCount(n) { for (const m of meshes) m.count = n; },
    update() { for (const m of meshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); } },
    markDirty() { for (const m of meshes) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } },
  };
}
