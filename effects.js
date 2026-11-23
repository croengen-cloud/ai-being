// effects.js — life and polish: wind sway, water shader, fire smoke, fireflies, falling
// leaves, butterflies, bloom post-processing and adaptive quality (keeps iPhones at 30+ fps).
import * as THREE from './vendor/three.module.js';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';
import { glowTexture } from './icons.js';

export const wind = { time: { value: 0 }, strength: { value: 1 } };

/**
 * Wind sway for (instanced) foliage: displacement grows with height above the base,
 * phase varies per instance (from its world position).
 */
export function applyWind(material, amp, refHeight) {
  const m = material.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.windTime = wind.time;
    sh.uniforms.windStrength = wind.strength;
    sh.uniforms.windAmp = { value: amp };
    sh.uniforms.windRef = { value: refHeight };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windTime; uniform float windStrength; uniform float windAmp; uniform float windRef;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float hgt = clamp(position.y / windRef, 0.0, 1.5);
          float k = hgt * hgt * windAmp * windStrength;
          #ifdef USE_INSTANCING
            vec2 ip = instanceMatrix[3].xz;
          #else
            vec2 ip = vec2(0.0);
          #endif
          float ph = ip.x * 0.37 + ip.y * 0.23;
          transformed.x += (sin(windTime * 1.7 + ph) * 0.7 + sin(windTime * 3.1 + ph * 1.7) * 0.3) * k;
          transformed.z += (cos(windTime * 1.3 + ph * 0.8) * 0.5) * k;
        }`);
  };
  m.customProgramCacheKey = () => `wind-${amp}-${refHeight}`;
  return m;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------
export function createWaterMaterial({ flow = true } = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uShallow: { value: new THREE.Color(0x7fe0e8) },
    uDeep: { value: new THREE.Color(0x1f7fa8) },
    uSky: { value: new THREE.Color(0xcff2ff) },
    uLight: { value: 1 },
    uFlow: { value: flow ? 1 : 0 },
  }]);
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: `
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vView;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky; uniform float uLight; uniform float uFlow;
      varying vec2 vUv; varying vec3 vWorld; varying vec3 vView;
      #include <fog_pars_fragment>
      float wave(vec2 p) {
        return sin(p.x * 1.7 + uTime * 1.3) * 0.5 + sin(p.y * 2.3 - uTime * 1.7) * 0.3 + sin((p.x + p.y) * 3.1 + uTime * 2.1) * 0.2;
      }
      void main() {
        vec2 p = vWorld.xz + (uFlow > 0.5 ? vec2(0.0, -uTime * 0.6) : vec2(0.0));
        float e = 0.08;
        float h = wave(p);
        vec3 n = normalize(vec3(wave(p + vec2(e, 0.0)) - h, 0.6, wave(p + vec2(0.0, e)) - h));
        float fres = pow(1.0 - max(dot(n, vView), 0.0), 2.5);
        float edge = uFlow > 0.5 ? abs(vUv.x - 0.5) * 2.0 : length(vUv - 0.5) * 2.0;
        vec3 col = mix(uDeep, uShallow, smoothstep(0.1, 1.0, edge) * 0.8 + 0.1);
        col = mix(col, uSky, fres * 0.6);
        float spark = pow(max(0.0, sin(p.x * 7.0 + uTime * 2.0) * sin(p.y * 6.0 - uTime * 1.6)), 18.0);
        col += vec3(1.0) * spark * 0.6 * uLight;
        float foam = smoothstep(0.82, 0.98, edge + sin(p.x * 5.0 + uTime * 2.0) * 0.04);
        col = mix(col, vec3(0.95), foam * 0.55);
        col *= 0.35 + uLight * 0.75;
        gl_FragColor = vec4(col, 0.82 + foam * 0.15);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  return mat;
}

// ---------------------------------------------------------------------------
// Particles: smoke, fireflies, falling leaves, butterflies
// ---------------------------------------------------------------------------
export function createLife(scene, { firePos, heightAt, clearingR, flowerSpots }) {
  const glow = glowTexture();
  const R = (a, b) => a + Math.random() * (b - a);

  // Smoke from the fire
  const smoke = [];
  const smokeMat = () => new THREE.SpriteMaterial({ map: glow, color: 0xbab4ad, transparent: true, opacity: 0, depthWrite: false });
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(smokeMat());
    s.visible = false; scene.add(s);
    smoke.push({ s, t: R(0, 4), life: R(3, 4.5) });
  }

  // Fireflies
  const FF = 70;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(FF * 3), ffCol = new Float32Array(FF * 3);
  const ff = Array.from({ length: FF }, () => {
    const a = R(0, Math.PI * 2), r = R(clearingR * 0.5, clearingR + 6);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: R(0.5, 2.5), ph: R(0, 10), sp: R(0.3, 0.8), a: R(0, 6) };
  });
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('color', new THREE.BufferAttribute(ffCol, 3));
  const ffMat = new THREE.PointsMaterial({ size: 0.35, map: glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const fireflies = new THREE.Points(ffGeo, ffMat);
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  // Falling leaves
  const LEAVES = 36;
  const leafGeo = new THREE.PlaneGeometry(0.22, 0.14);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, LEAVES);
  leaves.frustumCulled = false;
  const leafCols = [0xe8a23a, 0xd9682f, 0x9ac84a, 0xf0c84a];
  const leafData = Array.from({ length: LEAVES }, (_, i) => {
    leaves.setColorAt(i, new THREE.Color(leafCols[i % leafCols.length]));
    return resetLeaf({});
  });
  function resetLeaf(l) {
    const a = R(0, Math.PI * 2), r = R(clearingR - 4, clearingR + 6);
    return Object.assign(l, { x: Math.cos(a) * r, z: Math.sin(a) * r, y: R(4, 9), sp: R(0.5, 0.9), ph: R(0, 6), rot: R(0, 6) });
  }
  scene.add(leaves);

  // Butterflies (two wings each)
  const BF = 9;
  const wingGeo = new THREE.CircleGeometry(0.16, 6, 0, Math.PI);
  wingGeo.rotateX(-Math.PI / 2);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.5, emissive: 0x222222 });
  const wings = new THREE.InstancedMesh(wingGeo, wingMat, BF * 2);
  wings.frustumCulled = false;
  const bfCols = [0xff7ab8, 0x7fc8ff, 0xffd84a, 0xffffff, 0xc58fff, 0xff9f5a];
  const bf = Array.from({ length: BF }, (_, i) => {
    const c = new THREE.Color(bfCols[i % bfCols.length]);
    wings.setColorAt(i * 2, c); wings.setColorAt(i * 2 + 1, c);
    const home = flowerSpots[Math.floor(R(0, flowerSpots.length))] ?? { x: 0, z: 0 };
    return { x: home.x, z: home.z, y: 1, tx: home.x, tz: home.z, ph: R(0, 6), t: 0 };
  });
  scene.add(wings);

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);

  return {
    update(dt, time, { daylight, fireLevel, wind: windVal = 1 }) {
      const night = 1 - daylight;
      // smoke
      const fy = heightAt(firePos.x, firePos.z);
      for (const p of smoke) {
        p.t += dt;
        if (p.t > p.life) { p.t = 0; p.life = R(3, 4.5); }
        const k = p.t / p.life;
        const on = fireLevel > 0.05;
        p.s.visible = on;
        if (!on) continue;
        p.s.position.set(firePos.x + Math.sin(time * 0.7 + p.life) * k * 0.8 + k * 1.2 * windVal, fy + 1.2 + k * 5.5, firePos.z + Math.cos(time * 0.5 + p.life) * k * 0.5);
        const s = 0.8 + k * 3.2;
        p.s.scale.set(s, s, 1);
        p.s.material.opacity = Math.sin(k * Math.PI) * 0.32 * fireLevel;
        p.s.material.color.setScalar(0.55 + daylight * 0.25);
      }
      // fireflies (night)
      ffMat.opacity = Math.max(0, night - 0.2);
      fireflies.visible = night > 0.2;
      if (fireflies.visible) {
        ff.forEach((f, i) => {
          f.a += (Math.sin(time * 0.6 + f.ph) * 0.8) * dt;
          f.x += Math.cos(f.a) * f.sp * dt; f.z += Math.sin(f.a) * f.sp * dt;
          if (Math.hypot(f.x, f.z) > clearingR + 8) f.a += Math.PI;
          const y = heightAt(f.x, f.z) + f.y + Math.sin(time * 1.3 + f.ph) * 0.3;
          ffPos.set([f.x, y, f.z], i * 3);
          const blink = Math.max(0, Math.sin(time * 2.2 + f.ph * 3)) ** 3;
          ffCol.set([0.8 * blink, 1.0 * blink, 0.35 * blink], i * 3);
        });
        ffGeo.attributes.position.needsUpdate = true;
        ffGeo.attributes.color.needsUpdate = true;
      }
      // leaves
      leafData.forEach((l, i) => {
        l.y -= l.sp * dt;
        l.x += Math.sin(time * 1.5 + l.ph) * 0.6 * dt + 0.25 * windVal * dt;
        l.z += Math.cos(time * 1.2 + l.ph) * 0.4 * dt;
        l.rot += dt * 2;
        const g = heightAt(l.x, l.z);
        if (l.y < g + 0.05) { l.y = g + 0.05; l.rest = (l.rest ?? 0) + dt; if (l.rest > 5) { resetLeaf(l); l.rest = 0; } }
        E.set(Math.sin(l.rot) * 1.2, l.rot, Math.cos(l.rot * 0.7) * 0.8);
        M.compose(V.set(l.x, l.y, l.z), Q.setFromEuler(E), S.set(1, 1, 1));
        leaves.setMatrixAt(i, M);
      });
      leaves.instanceMatrix.needsUpdate = true;
      leaves.visible = daylight > 0.15;
      // butterflies (day)
      wings.visible = daylight > 0.4;
      if (wings.visible) {
        bf.forEach((b, i) => {
          b.t -= dt;
          if (b.t <= 0 || Math.hypot(b.tx - b.x, b.tz - b.z) < 0.3) {
            const f = flowerSpots[Math.floor(R(0, flowerSpots.length))] ?? { x: 0, z: 0 };
            b.tx = f.x + R(-1, 1); b.tz = f.z + R(-1, 1); b.t = R(3, 7);
          }
          const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz) || 1;
          b.x += (dx / d) * 1.4 * dt + Math.sin(time * 3 + b.ph) * 0.5 * dt;
          b.z += (dz / d) * 1.4 * dt + Math.cos(time * 2.6 + b.ph) * 0.5 * dt;
          b.y = heightAt(b.x, b.z) + 0.9 + Math.sin(time * 2 + b.ph) * 0.35;
          const yaw = Math.atan2(dx, dz);
          const flap = Math.sin(time * 18 + b.ph) * 0.9;
          for (const side of [0, 1]) {
            E.set(0, yaw + (side ? Math.PI : 0), side ? -flap : flap, 'YXZ');
            M.compose(V.set(b.x, b.y, b.z), Q.setFromEuler(E), S.set(1, 1, 1));
            wings.setMatrixAt(i * 2 + side, M);
          }
        });
        wings.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Bloom + adaptive quality
// ---------------------------------------------------------------------------
export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.35);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  let bloomOn = true;
  return {
    composer, bloom,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      bloom.resolution.set(Math.max(64, (w * pr) / 2), Math.max(64, (h * pr) / 2));
    },
    setBloom(on) { bloomOn = on; bloom.enabled = on; },
    get bloomOn() { return bloomOn; },
    render() {
      if (bloomOn) composer.render();
      else renderer.render(scene, camera);
    },
  };
}

/** Measures frame time and steps quality down (or carefully back up). */
export function createQuality(levels, apply) {
  let level = 0, acc = 0, frames = 0, goodTime = 0, cooldown = 3;
  apply(levels[0], 0);
  return {
    get level() { return level; },
    tick(dt) {
      acc += dt; frames++;
      cooldown -= dt;
      if (acc < 2) return;
      const fps = frames / acc;
      acc = 0; frames = 0;
      if (cooldown > 0) return;
      if (fps < 29 && level < levels.length - 1) { level++; apply(levels[level], level); cooldown = 3; goodTime = 0; }
      else if (fps > 57) { goodTime += 2; if (goodTime > 20 && level > 0) { level--; apply(levels[level], level); cooldown = 6; goodTime = 0; } }
      else goodTime = 0;
    },
    force(l) { level = Math.max(0, Math.min(levels.length - 1, l)); apply(levels[level], level); },
  };
}
