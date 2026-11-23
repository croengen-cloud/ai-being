// mycel.js — draws all Mycel with InstancedMesh (a handful of draw calls for up to 60 of
// them): round body, big pixel-screen face per emotion, glowing cap with spots, little
// legs, ground glow, optional spear; plus emote bubbles and task icons as sprites.
import * as THREE from './vendor/three.module.js';
import { EMOTIONS, faceTexture, bubbleTexture, iconTexture, glowTexture } from './icons.js';

export const MAX_MYCEL = 60;
const MAX_SPOTS = 9;
const UP = new THREE.Vector3(0, 1, 0);

// Cap palette: violets, teals, magentas, blues (never yellow).
export const CAP_COLORS = [0x9b6dff, 0x3fe0d0, 0xff5fc8, 0x5a8cff, 0xc46dff, 0x2fc8ff, 0xff7ae0, 0x7a6dff];

const BODY_R = 0.42, BODY_Y = 0.5;
const WORLD_SCALE = 1.7; // Mycel are drawn larger than life so they read from the god view

export function createMycelRenderer(scene) {
  const N = MAX_MYCEL;
  const glow = glowTexture();
  const mk = (geo, mat, count, cast = true) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.castShadow = cast; m.receiveShadow = false; m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    scene.add(m);
    return m;
  };

  // ---- Geometries (adult scale) ----
  const bodyGeo = new THREE.SphereGeometry(BODY_R, 22, 16);
  bodyGeo.scale(1, 0.92, 1); bodyGeo.translate(0, BODY_Y, 0);
  // Face: a patch of a slightly larger sphere, planar UVs so the pixels stay square
  const span = 0.8, sr = BODY_R + 0.006;
  const faceGeo = new THREE.SphereGeometry(sr, 24, 12, 0, Math.PI * 2, 0, span);
  faceGeo.rotateX(Math.PI / 2 - 0.5); // tilted upwards so it reads from the god view
  const fr = sr * Math.sin(span);
  { const p = faceGeo.attributes.position, uv = faceGeo.attributes.uv;
    const tilt = new THREE.Matrix4().makeRotationX(0.5);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(tilt); uv.setXY(i, v.x / (2 * fr) + 0.5, v.y / (2 * fr) + 0.5); } }
  faceGeo.scale(1, 0.92, 1); faceGeo.translate(0, BODY_Y, 0);
  const capGeo = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  capGeo.scale(0.58, 0.38, 0.58);
  const rimGeo = new THREE.TorusGeometry(0.565, 0.05, 6, 28); rimGeo.rotateX(Math.PI / 2);
  const gillGeo = new THREE.CircleGeometry(0.56, 24); gillGeo.rotateX(Math.PI / 2);
  const stemGeo = new THREE.CylinderGeometry(0.12, 0.15, 0.16, 10);
  const spotGeo = new THREE.SphereGeometry(1, 8, 6);
  const legGeo = new THREE.CapsuleGeometry(0.075, 0.1, 3, 8);
  const footGeo = new THREE.SphereGeometry(0.1, 10, 6); footGeo.scale(1, 0.55, 1.3);
  const shaftGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.25, 5);
  const tipGeo = new THREE.ConeGeometry(0.06, 0.18, 6);
  const glowGeo = new THREE.PlaneGeometry(2.4, 2.4); glowGeo.rotateX(-Math.PI / 2);

  // ---- Materials ----
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xf2eefa, roughness: 0.38, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x34304a, roughness: 0.6 });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0xf6efe6, roughness: 0.6 });
  // Cap: instance colour drives both albedo and glow
  const capUniforms = { glow: { value: 0.6 } };
  const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.45 });
  capMat.onBeforeCompile = (sh) => {
    sh.uniforms.capGlow = capUniforms.glow;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float capGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb * capGlow;\n#endif');
  };
  const gillMat = new THREE.MeshStandardMaterial({ color: 0x3a2a5a, emissive: 0x5a3a9a, emissiveIntensity: 0.4, side: THREE.DoubleSide });
  const spotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const glowMat = new THREE.MeshBasicMaterial({ map: glow, color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xc8d0d4, roughness: 0.3, metalness: 0.4 });

  // ---- Instanced meshes ----
  const body = mk(bodyGeo, shellMat, N);
  const faces = {};
  // Face screens start dull and monochrome; they gain brightness and colour with every learned emotion.
  const faceUniforms = { sat: { value: 0 } };
  const faceMat = (e) => {
    const mat = new THREE.MeshBasicMaterial({ map: faceTexture(e), toneMapped: false });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSat = faceUniforms.sat;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSat;')
        .replace('#include <map_fragment>', '#include <map_fragment>\nfloat lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));\ndiffuseColor.rgb = mix(vec3(lum) * vec3(0.72, 0.95, 0.85), diffuseColor.rgb, uSat) * (0.55 + 0.45 * uSat);');
    };
    return mat;
  };
  for (const e of [...EMOTIONS, 'blink']) faces[e] = mk(faceGeo, faceMat(e), N, false);
  let expressive = 0;
  const stem = mk(stemGeo, stemMat, N, false);
  const cap = mk(capGeo, capMat, N);
  const rim = mk(rimGeo, capMat, N, false);
  const gills = mk(gillGeo, gillMat, N, false);
  const spots = mk(spotGeo, spotMat, N * MAX_SPOTS, false);
  const legs = mk(legGeo, darkMat, N * 2);
  const feet = mk(footGeo, darkMat, N * 2, false);
  const shafts = mk(shaftGeo, woodMat, N);
  const tips = mk(tipGeo, tipMat, N, false);
  const glows = mk(glowGeo, glowMat, N, false);
  glows.renderOrder = 1;

  // Spot positions on the cap dome (unit cap space)
  const SPOTS = Array.from({ length: MAX_SPOTS }, (_, i) => {
    const th = 0.25 + (i / MAX_SPOTS) * 0.95, ph = i * 2.39996 + 0.5;
    const p = new THREE.Vector3(0.58 * Math.sin(th) * Math.sin(ph), 0.38 * Math.cos(th), 0.58 * Math.sin(th) * Math.cos(ph));
    const n = new THREE.Vector3(p.x / 0.336, p.y / 0.144, p.z / 0.336).normalize();
    return { p: p.addScaledVector(n, 0.005), q: new THREE.Quaternion().setFromUnitVectors(UP, n), s: 0.06 + (i % 3) * 0.015 };
  });

  // ---- Sprites: emote bubbles + task icons ----
  const bubbleMats = {}, iconMats = {};
  const getBubbleMat = (e) => (bubbleMats[e] ??= new THREE.SpriteMaterial({ map: bubbleTexture(e), transparent: true, depthWrite: false, depthTest: false }));
  const getIconMat = (n) => (iconMats[n] ??= new THREE.SpriteMaterial({ map: iconTexture(n), transparent: true, depthWrite: false, depthTest: false }));
  const spritePool = [];
  const sprite = (i) => {
    if (!spritePool[i]) { const s = new THREE.Sprite(getIconMat('explore')); s.renderOrder = 10; s.visible = false; scene.add(s); spritePool[i] = s; }
    return spritePool[i];
  };

  // ---- Scratch ----
  const M = new THREE.Matrix4(), P = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const tmpC = new THREE.Color(), FC = new THREE.Color();
  const local = (x, y, z, sx = 1, sy = sx, sz = sx, q = null) => P.compose(V.set(x, y, z), q ?? Q.identity(), S.set(sx, sy, sz));

  let glowLevel = 0.6;
  return {
    /** 0..1 learned emotions → screen colour, brightness and blinking. */
    setExpressiveness(k) { expressive = k; faceUniforms.sat.value = 0.15 + 0.85 * k; },
    setNightGlow(v) { glowLevel = v; capUniforms.glow.value = v; glowMat.opacity = Math.min(0.38, Math.max(0.1, (v - 0.5) * 0.35)); },

    /** list: array of Mycel sim objects (see colony.js) */
    update(list, time, camera) {
      const counts = {};
      for (const e of Object.keys(faces)) counts[e] = 0;
      let nSpots = 0, nSpear = 0;
      const camDist = camera.position.length() > 0 ? camera.position.distanceTo(camera.userData.target ?? V.set(0, 0, 0)) : 20;
      const spriteScale = THREE.MathUtils.clamp(camDist * 0.055, 0.9, 3.2);
      let sp = 0;

      list.forEach((m, i) => {
        const g = m.grown; // 0.35 newborn .. 1 adult
        const sc = (0.45 + 0.55 * g) * (m.pop ?? 1) * WORLD_SCALE;
        const bob = m.bob ?? 0;
        // root transform
        Q.setFromAxisAngle(UP, m.yaw);
        const rootQ = Q.clone();
        if (m.tilt) rootQ.multiply(new THREE.Quaternion().setFromAxisAngle(V.set(0, 0, 1), m.tilt));
        M.compose(V.set(m.x, m.y, m.z), rootQ, S.set(sc, sc, sc));

        // legs (stay on the ground) + feet
        for (let k = 0; k < 2; k++) {
          const side = k ? 0.16 : -0.16;
          const st = Math.sin(m.walk + k * Math.PI);
          const lift = Math.max(0, st) * 0.09 * (m.moving ?? 0);
          const fwd = st * 0.08 * (m.moving ?? 0);
          legs.setMatrixAt(i * 2 + k, local(side, 0.14 + lift, fwd).premultiply(M));
          feet.setMatrixAt(i * 2 + k, local(side, 0.05 + lift, fwd + 0.03).premultiply(M));
        }
        // upper body bobs / squashes
        const squash = m.squash ?? 0;
        const B = new THREE.Matrix4().compose(V.set(0, bob, 0), Q.identity(), S.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5)).premultiply(M);
        body.setMatrixAt(i, B);
        tmpC.setHex(0xf2eefa).lerp(new THREE.Color(m.color), 0.08);
        body.setColorAt(i, tmpC);
        const face = m.blink && expressive >= 0.33 ? 'blink' : (faces[m.emotion] ? m.emotion : 'neutral');
        faces[face].setMatrixAt(counts[face]++, B);

        const capS = m.capScale ?? 1;
        const capY = BODY_Y + BODY_R * 0.92 + 0.05;
        stem.setMatrixAt(i, local(0, capY - 0.02, 0).premultiply(B));
        const CB = local(0, capY + 0.02, 0, capS, capS * (1 + Math.sin(time * 2 + i) * 0.02), capS).premultiply(B).clone();
        cap.setMatrixAt(i, CB); rim.setMatrixAt(i, CB); gills.setMatrixAt(i, CB);
        tmpC.setHex(m.color);
        if (m.faction && m.factionColor != null) tmpC.lerp(FC.setHex(m.factionColor), 0.45);
        if (m.exiled) tmpC.multiplyScalar(0.55);
        cap.setColorAt(i, tmpC); rim.setColorAt(i, tmpC);
        const ns = Math.min(MAX_SPOTS, m.spots ?? 0);
        for (let k = 0; k < ns; k++) {
          const s = SPOTS[k];
          spots.setMatrixAt(nSpots++, local(s.p.x, s.p.y, s.p.z, s.s, s.s * 0.4, s.s, s.q).premultiply(CB));
        }
        // ground glow
        glows.setMatrixAt(i, local(0, 0.04, 0, 0.8 + capS * 0.6).premultiply(M));
        glows.setColorAt(i, tmpC.setHex(m.color));
        // spear
        if (m.tool === 'spear') {
          const SQ = new THREE.Quaternion().setFromAxisAngle(V.set(1, 0, 0), m.attacking ? -1.1 : -0.25);
          const SP = local(0.42, 0.55, 0.05, 1, 1, 1, SQ).premultiply(M).clone();
          shafts.setMatrixAt(nSpear, SP);
          tips.setMatrixAt(nSpear++, local(0, 0.7, 0).premultiply(SP));
        }

        // bubble (emotion) and icon (task) above the head
        const headY = m.y + (capY + 0.5 * capS + 0.45) * sc;
        if (m.bubbleT > 0) {
          const s = sprite(sp++);
          s.material = getBubbleMat(m.bubble);
          const pop = Math.min(1, (m.bubbleT > 2.6 ? (3 - m.bubbleT) / 0.4 : m.bubbleT / 0.3));
          s.scale.set(spriteScale * 0.9 * pop, spriteScale * 1.05 * pop, 1);
          s.position.set(m.x - spriteScale * 0.35, headY + spriteScale * 0.55, m.z);
          s.visible = true;
        }
        if (m.crown) {
          const s = sprite(sp++);
          s.material = getIconMat('crown');
          s.scale.set(spriteScale * 0.5, spriteScale * 0.5, 1);
          s.position.set(m.x, m.y + (capY + 0.75 * capS) * sc + spriteScale * 0.1, m.z);
          s.visible = true;
        }
        const soc = m.socialIcon ?? (m.injured > 0.15 ? 'bandage' : null);
        if (soc) {
          const s = sprite(sp++);
          s.material = getIconMat(soc);
          s.scale.set(spriteScale * 0.5, spriteScale * 0.5, 1);
          s.position.set(m.x - spriteScale * 0.45, headY + spriteScale * (m.bubbleT > 0 ? 1.25 : 0.3), m.z);
          s.visible = true;
        }
        if (m.icon) {
          const s = sprite(sp++);
          s.material = getIconMat(m.icon);
          s.scale.set(spriteScale * 0.55, spriteScale * 0.55, 1);
          s.position.set(m.x + (m.bubbleT > 0 ? spriteScale * 0.4 : 0), headY + spriteScale * 0.3, m.z);
          s.visible = true;
        }
      });

      const n = list.length;
      for (const msh of [body, stem, cap, rim, gills, glows]) { msh.count = n; msh.instanceMatrix.needsUpdate = true; }
      for (const msh of [body, cap, rim, glows]) if (msh.instanceColor) msh.instanceColor.needsUpdate = true;
      legs.count = feet.count = n * 2;
      legs.instanceMatrix.needsUpdate = feet.instanceMatrix.needsUpdate = true;
      spots.count = nSpots; spots.instanceMatrix.needsUpdate = true;
      shafts.count = tips.count = nSpear;
      shafts.instanceMatrix.needsUpdate = tips.instanceMatrix.needsUpdate = true;
      for (const [e, msh] of Object.entries(faces)) { msh.count = counts[e]; msh.instanceMatrix.needsUpdate = true; }
      for (let k = sp; k < spritePool.length; k++) spritePool[k].visible = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Sprouts (spore -> tiny sprout -> new Mycel) and wild thorn beetles: few objects, simple meshes
// ---------------------------------------------------------------------------
export function createSprout(scene, color) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0xf6efe6 }));
  stem.position.y = 0.2;
  const c = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.5 }));
  c.position.y = 0.4; c.scale.y = 0.7;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.position.y = 0.4; halo.scale.set(1.4, 1.4, 1);
  g.add(stem, c, halo);
  g.castShadow = true;
  scene.add(g);
  return g;
}

export function createBeetle(scene) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), new THREE.MeshStandardMaterial({ color: 0x2a2236, roughness: 0.35, metalness: 0.3 }));
  shell.scale.set(1, 0.6, 1.35); shell.position.y = 0.42; shell.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: 0x1c1626, roughness: 0.5 }));
  head.position.set(0, 0.38, 0.75);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), eyeMat);
    e.position.set(s * 0.13, 0.48, 0.98);
    g.add(e);
  }
  const thornMat = new THREE.MeshStandardMaterial({ color: 0x6a3a7a, roughness: 0.5 });
  for (let i = 0; i < 7; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 5), thornMat);
    const a = (i / 7) * Math.PI - Math.PI / 2;
    t.position.set(Math.sin(a) * 0.32, 0.72, -0.3 + (i % 3) * 0.3);
    t.rotation.z = -Math.sin(a) * 0.6;
    g.add(t);
  }
  const legMat = new THREE.MeshStandardMaterial({ color: 0x15101c });
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4), legMat);
    const side = i < 3 ? -1 : 1;
    l.position.set(side * 0.5, 0.2, -0.4 + (i % 3) * 0.4);
    l.rotation.z = side * 1.0;
    legs.push(l); g.add(l);
  }
  g.add(shell, head);
  g.userData.legs = legs;
  scene.add(g);
  return g;
}
