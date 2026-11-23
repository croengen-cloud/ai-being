// being.js — a Mycel: a small round creature with a pixel-screen face,
// stubby legs and a bioluminescent mushroom cap that grows with what it learns.
import * as THREE from './vendor/three.module.js';

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Pixel faces on a 32×32 grid. p(x, y, w, h) lights pixels.
const FACES = {
  neutral: (p) => { p(9, 11, 3, 6); p(20, 11, 3, 6); p(13, 22, 6, 1); },
  blink: (p) => { p(9, 15, 3, 1); p(20, 15, 3, 1); p(13, 22, 6, 1); },
  curious: (p) => {
    p(7, 10, 6, 1); p(7, 16, 6, 1); p(7, 11, 1, 5); p(12, 11, 1, 5); p(9, 12, 2, 2); // big ring eye
    p(20, 12, 3, 4); // small eye
    p(14, 21, 3, 1); p(14, 24, 3, 1); p(13, 22, 1, 2); p(17, 22, 1, 2); // little "o"
    p(24, 4, 3, 1); p(26, 5, 1, 2); p(25, 7, 1, 1); p(25, 9, 1, 1); // "?"
  },
  happy: (p) => {
    for (const cx of [10, 21]) { p(cx - 3, 15, 2, 1); p(cx - 2, 13, 2, 2); p(cx, 12, 1, 1); p(cx + 1, 13, 2, 2); p(cx + 2, 15, 2, 1); }
    p(9, 19, 1, 1); p(10, 20, 1, 1); p(11, 21, 1, 1); p(12, 22, 8, 1); p(20, 21, 1, 1); p(21, 20, 1, 1); p(22, 19, 1, 1);
  },
  sad: (p) => {
    p(7, 11, 2, 1); p(9, 12, 2, 1); p(11, 13, 1, 1); // sloped brows
    p(23, 11, 2, 1); p(21, 12, 2, 1); p(20, 13, 1, 1);
    p(9, 15, 3, 3); p(20, 15, 3, 3);
    p(10, 24, 1, 1); p(11, 23, 1, 1); p(12, 22, 8, 1); p(20, 23, 1, 1); p(21, 24, 1, 1);
    p(9, 19, 1, 2); // tear
  },
  scared: (p) => {
    for (const x of [6, 19]) { p(x, 9, 7, 1); p(x, 16, 7, 1); p(x, 10, 1, 6); p(x + 6, 10, 1, 6); p(x + 3, 12, 1, 2); }
    for (let i = 0; i < 6; i++) p(10 + i * 2, 22 + (i % 2), 2, 1); // wobbly mouth
  },
  sleep: (p) => { p(8, 16, 5, 1); p(19, 16, 5, 1); p(23, 5, 4, 1); p(25, 6, 1, 1); p(24, 7, 1, 1); p(23, 8, 4, 1); },
  thinking: (p, frame) => {
    const n = frame % 4;
    for (let i = 0; i < n; i++) p(8 + i * 7, 15, 3, 3);
  },
};
export const EMOTIONS = ['neutral', 'curious', 'happy', 'sad', 'scared', 'thinking', 'sleep'];

// Cap colour moves towards what the Mycel is most interested in.
const BASE_CAP = new THREE.Color(0x9b6dff); // purple-lavender
const INTEREST_COLORS = {
  library: new THREE.Color(0x8a7dff), // deep violet-blue
  cafe: new THREE.Color(0x52d8ff), // cyan
  park: new THREE.Color(0x7dffae), // mint green
  shop: new THREE.Color(0xff8fd0), // pink
};

const MAX_SPOTS = 16;
const MAX_SPROUTS = 6;
const UP = new THREE.Vector3(0, 1, 0);

export class Being {
  constructor(scene, { groundHeight = () => 0 } = {}) {
    this.groundHeight = groundHeight;
    this.root = new THREE.Group(); // world position
    this.mover = new THREE.Group(); // yaw
    this.body = new THREE.Group(); // bob / squash (everything above the legs)
    this.root.add(this.mover);
    this.mover.add(this.body);
    scene.add(this.root);

    this.speed = 2.4;
    this.path = [];
    this._resolve = null;
    this.targetYaw = Math.PI / 4;
    this.walkBlend = 0;
    this.phase = 0;
    this.celebrateT = 0;
    this.blinkTimer = 2;
    this.blinkT = 0;
    this.sleeping = false;
    this.emotion = 'neutral';
    this.faceKey = '';
    this.capScale = 0.5;
    this.capTarget = 0.5;
    this.spotCount = 2;
    this.sproutCount = 0;

    const glow = glowTexture();
    const BODY_Y = 0.46, BODY_R = 0.34;
    this.bodyY = BODY_Y;

    // ---- Shell ----
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xe4e0ee, roughness: 0.42, metalness: 0.15, emissive: 0x2a2440, emissiveIntensity: 0.4 });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(BODY_R, 32, 24), shellMat);
    shell.scale.y = 0.94;
    shell.position.y = BODY_Y;
    this.body.add(shell);
    // darker belly band for a readable silhouette edge
    // (an arc that leaves a gap at the front so it never crosses the screen)
    const arcLen = Math.PI * 2 - 2.2;
    const band = new THREE.Mesh(new THREE.TorusGeometry(BODY_R * 0.985, 0.022, 8, 40, arcLen), new THREE.MeshStandardMaterial({ color: 0x3a3450, roughness: 0.6 }));
    band.rotation.x = Math.PI / 2;
    const bandYaw = new THREE.Group();
    bandYaw.rotation.y = (arcLen + Math.PI * 2) / 2 - Math.PI / 2;
    bandYaw.position.y = BODY_Y - 0.08;
    bandYaw.add(band);
    this.body.add(bandYaw);

    // ---- Screen face (spherical patch with planar UVs, so pixels stay square) ----
    this.faceCanvas = document.createElement('canvas');
    this.faceCanvas.width = this.faceCanvas.height = 32;
    this.faceCtx = this.faceCanvas.getContext('2d');
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace;
    this.faceTex.magFilter = this.faceTex.minFilter = THREE.NearestFilter;
    this.faceTex.generateMipmaps = false;
    const sr = BODY_R + 0.004;
    const span = 0.74;
    const screenGeo = new THREE.SphereGeometry(sr, 28, 14, 0, Math.PI * 2, 0, span);
    screenGeo.rotateX(Math.PI / 2);
    const faceR = sr * Math.sin(span);
    const pos = screenGeo.attributes.position, uv = screenGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * faceR) + 0.5, pos.getY(i) / (2 * faceR) + 0.5);
    const screen = new THREE.Mesh(screenGeo, new THREE.MeshBasicMaterial({ map: this.faceTex }));
    screen.scale.y = 0.94;
    screen.position.y = BODY_Y;
    this.body.add(screen);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(faceR, 0.026, 8, 36), new THREE.MeshStandardMaterial({ color: 0x2a2638, roughness: 0.5 }));
    bezel.position.set(0, BODY_Y, sr * Math.cos(span));
    bezel.scale.y = 0.94;
    this.body.add(bezel);
    this.drawFace('neutral', 0);

    // ---- Stem + cap ----
    const top = BODY_Y + BODY_R * 0.94;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.14, 12), new THREE.MeshStandardMaterial({ color: 0xf0e8f4, roughness: 0.6, emissive: 0x3a2a55, emissiveIntensity: 0.4 }));
    stem.position.y = top;
    this.body.add(stem);

    this.capMat = new THREE.MeshStandardMaterial({ color: BASE_CAP, emissive: BASE_CAP, emissiveIntensity: 0.8, roughness: 0.5 });
    this.gillMat = new THREE.MeshStandardMaterial({ color: 0x4a3470, emissive: 0x7a5ab0, emissiveIntensity: 0.35, side: THREE.DoubleSide });
    this.spotMat = new THREE.MeshBasicMaterial({ color: 0xf2e6ff });

    this.cap = new THREE.Group();
    this.cap.position.y = top + 0.05;
    this.body.add(this.cap);
    const CR = 0.5, CH = 0.34;
    this.capR = CR; this.capH = CH;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), this.capMat);
    dome.scale.set(CR, CH, CR);
    const gills = new THREE.Mesh(new THREE.CircleGeometry(CR * 0.98, 32), this.gillMat);
    gills.rotation.x = Math.PI / 2;
    gills.position.y = 0.005;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(CR * 0.97, 0.04, 8, 36), this.capMat);
    rim.rotation.x = Math.PI / 2;
    this.cap.add(dome, gills, rim);

    // Glowing spots, spread with the golden angle over the dome
    this.spots = [];
    const spotGeo = new THREE.SphereGeometry(1, 10, 6);
    for (let i = 0; i < MAX_SPOTS; i++) {
      const theta = 0.18 + (i / MAX_SPOTS) * 1.05;
      const phi = i * 2.39996 + 0.6;
      const p = new THREE.Vector3(CR * Math.sin(theta) * Math.sin(phi), CH * Math.cos(theta), CR * Math.sin(theta) * Math.cos(phi));
      const n = new THREE.Vector3(p.x / (CR * CR), p.y / (CH * CH), p.z / (CR * CR)).normalize();
      const s = 0.045 + ((i * 37) % 5) * 0.009;
      const spot = new THREE.Mesh(spotGeo, this.spotMat);
      spot.position.copy(p).addScaledVector(n, 0.004);
      spot.quaternion.setFromUnitVectors(UP, n);
      spot.userData.size = s;
      spot.scale.set(0.0001, 0.0001, 0.0001);
      this.cap.add(spot);
      this.spots.push(spot);
    }

    // Little mushrooms sprouting from the shell (back and sides, never over the face)
    this.sproutMat = new THREE.MeshStandardMaterial({ color: BASE_CAP, emissive: BASE_CAP, emissiveIntensity: 0.8, roughness: 0.5 });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0xf0e8f4, roughness: 0.6 });
    const sproutSpots = [[0.95, 2.5], [1.05, 3.7], [0.75, 3.1], [1.15, 1.75], [1.2, 4.45], [0.85, 2.0]];
    this.sprouts = sproutSpots.map(([theta, phi], i) => {
      const g = new THREE.Group();
      const n = new THREE.Vector3(Math.sin(theta) * Math.sin(phi), Math.cos(theta) * 0.94, Math.sin(theta) * Math.cos(phi)).normalize();
      g.position.set(n.x * BODY_R, BODY_Y + n.y * BODY_R, n.z * BODY_R);
      g.quaternion.setFromUnitVectors(UP, n);
      const h = 0.07 + (i % 3) * 0.02;
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, h, 6), stemMat);
      st.position.y = h / 2;
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.05 + (i % 2) * 0.012, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.sproutMat);
      c.scale.y = 0.7;
      c.position.y = h;
      g.add(st, c);
      g.scale.setScalar(0.0001);
      this.body.add(g);
      return g;
    });

    // ---- Legs ----
    this.legs = [-0.14, 0.14].map((x) => {
      const leg = new THREE.Group();
      leg.position.set(x, 0, 0);
      const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.08, 4, 8), new THREE.MeshStandardMaterial({ color: 0x3a3450, roughness: 0.6 }));
      limb.position.y = 0.13;
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), new THREE.MeshStandardMaterial({ color: 0x2a2638, roughness: 0.6 }));
      foot.scale.set(1, 0.55, 1.3);
      foot.position.set(0, 0.045, 0.02);
      leg.add(limb, foot);
      this.mover.add(leg);
      return leg;
    });

    // ---- Glow: cap halo, ground pool, real light ----
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: BASE_CAP, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.halo.position.y = top + 0.15;
    this.body.add(this.halo);

    this.groundGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: glow, color: BASE_CAP, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.groundGlow.rotation.x = -Math.PI / 2;
    this.groundGlow.position.y = 0.04;
    this.mover.add(this.groundGlow);

    this.light = new THREE.PointLight(BASE_CAP, 4, 7, 1);
    this.light.position.y = top + 0.2;
    this.mover.add(this.light);

    this.applyCapColor(BASE_CAP);
  }

  // -------------------------------------------------------------------------
  drawFace(name, frame) {
    const g = this.faceCtx;
    g.fillStyle = '#061214';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = 'rgba(125,255,216,0.05)';
    for (let y = 0; y < 32; y += 2) g.fillRect(0, y, 32, 1);
    const draw = (fn, color) => { g.fillStyle = color; (FACES[name] ?? FACES.neutral)(fn, frame); };
    // soft glow underlay, then crisp pixels
    draw((x, y, w = 1, h = 1) => g.fillRect(x - 1, y - 1, w + 2, h + 2), 'rgba(90,255,210,0.22)');
    draw((x, y, w = 1, h = 1) => g.fillRect(x, y, w, h), '#8dffe0');
    this.faceTex.needsUpdate = true;
  }

  applyCapColor(c) {
    // Darker base + full-colour emissive keeps the glow saturated instead of clipping to white.
    this.capMat.color.copy(c).multiplyScalar(0.45);
    this.capMat.emissive.copy(c);
    this.sproutMat.color.copy(c).multiplyScalar(0.45);
    this.sproutMat.emissive.copy(c);
    this.gillMat.emissive.copy(c).multiplyScalar(0.6);
    this.spotColor = this.spotTint ?? c.clone().lerp(new THREE.Color(0xffffff), 0.75);
    this.spotMat.color.copy(this.spotColor);
    this.halo.material.color.copy(c);
    this.groundGlow.material.color.copy(c);
    this.light.color.copy(c);
  }

  setPosition(x, z) {
    this.root.position.set(x, 0, z);
  }

  /** World position just above the cap (for the thought bubble). */
  getHeadPosition(out) {
    return out.copy(this.root.position).setY(this.root.position.y + this.body.position.y + this.cap.position.y + this.capH * this.capScale + 0.2);
  }

  /** Walk along a list of points. Resolves on arrival. */
  walk(points) {
    if (this._resolve) this._resolve();
    return new Promise((resolve) => {
      this.path = points.map((p) => p.clone());
      this._resolve = resolve;
      if (!this.path.length) { this._resolve = null; resolve(); }
    });
  }

  /** Turn to face a world position (e.g. the camera). */
  faceToward(x, z) {
    this.targetYaw = Math.atan2(x - this.root.position.x, z - this.root.position.z);
  }

  celebrate() { this.celebrateT = 0.7; }
  setSleeping(on) { this.sleeping = on; }
  /** neutral | curious | happy | sad | scared | thinking */
  setEmotion(name) { this.emotion = FACES[name] ? name : 'neutral'; }

  /** Growth driven by save state: cap size, spots, sprouts and cap colour. */
  /**
   * Growth driven by the save state.
   * stage: 0 Sprout · 1 Little Cap · 2 Glow Spots · 3 Tiny Mushrooms · 4 True Colours · 5 Bloom
   * learnings: total count (fine-grained growth inside a stage); interests: {location: learnings}
   */
  setEvolution({ stage = 0, learnings = 0, interests = {} }) {
    const STAGE = [
      { cap: 0.5, spots: 0, sprouts: 0 },
      { cap: 0.68, spots: 2, sprouts: 0 },
      { cap: 0.8, spots: 7, sprouts: 0 },
      { cap: 0.9, spots: 10, sprouts: 3 },
      { cap: 1.0, spots: 13, sprouts: 4 },
      { cap: 1.15, spots: MAX_SPOTS, sprouts: MAX_SPROUTS },
    ];
    const cfg = STAGE[Math.max(0, Math.min(stage, STAGE.length - 1))];
    this.capTarget = cfg.cap + Math.min(learnings, 40) * 0.002;
    this.spotCount = cfg.spots;
    this.sproutCount = cfg.sprouts;

    // From "True Colours" on, the cap follows the strongest interest; spots take the second.
    const c = BASE_CAP.clone();
    this.spotTint = null;
    if (stage >= 4) {
      const ranked = Object.keys(INTEREST_COLORS)
        .map((k) => [k, interests[k] ?? 0])
        .filter(([, n]) => n > 0)
        .sort((x, y) => y[1] - x[1]);
      if (ranked[0]) c.lerp(INTEREST_COLORS[ranked[0][0]], stage >= 5 ? 0.8 : 0.6);
      if (ranked[1]) this.spotTint = INTEREST_COLORS[ranked[1][0]].clone().lerp(new THREE.Color(0xffffff), 0.55);
    }
    this.applyCapColor(c);
  }

  update(dt, t) {
    // ---- Movement ----
    let moving = false;
    if (this.path.length) {
      const target = this.path[0];
      const p = this.root.position;
      const dx = target.x - p.x, dz = target.z - p.z;
      const dist = Math.hypot(dx, dz);
      const step = this.speed * dt;
      if (dist <= step) {
        p.x = target.x; p.z = target.z;
        this.path.shift();
        if (!this.path.length && this._resolve) { const r = this._resolve; this._resolve = null; r(); }
      } else {
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
        this.targetYaw = Math.atan2(dx, dz);
        moving = true;
      }
    }
    const gh = this.groundHeight(this.root.position.x, this.root.position.z);
    this.root.position.y += (gh - this.root.position.y) * Math.min(1, dt * 12);

    let diff = this.targetYaw - this.mover.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.mover.rotation.y += diff * Math.min(1, dt * 8);

    // ---- Legs, bob, squash ----
    this.walkBlend += ((moving ? 1 : 0) - this.walkBlend) * Math.min(1, dt * 6);
    if (moving) this.phase += dt * 11;
    this.legs.forEach((leg, i) => {
      const s = Math.sin(this.phase + i * Math.PI);
      leg.position.y = Math.max(0, s) * 0.09 * this.walkBlend;
      leg.position.z = s * 0.07 * this.walkBlend;
      leg.scale.y = this.sleeping ? 0.6 : 1;
    });
    const stepBob = Math.abs(Math.sin(this.phase)) * 0.05 * this.walkBlend;
    const idleBob = Math.sin(t * 2.2) * 0.025 * (1 - this.walkBlend);
    let jump = 0;
    if (this.celebrateT > 0) {
      this.celebrateT = Math.max(0, this.celebrateT - dt);
      jump = Math.sin((1 - this.celebrateT / 0.7) * Math.PI) * 0.3;
    }
    this.body.position.y = (this.sleeping ? -0.07 : 0) + stepBob + idleBob + jump;
    const breathe = Math.sin(t * 2.2 + 1) * 0.02;
    this.body.scale.set(1 - breathe * 0.5, 1 + breathe, 1 - breathe * 0.5);
    this.body.rotation.z = Math.sin(this.phase) * 0.05 * this.walkBlend; // waddle

    // ---- Growth animation ----
    this.capScale += (this.capTarget - this.capScale) * Math.min(1, dt * 1.5);
    this.cap.scale.setScalar(this.capScale);
    this.cap.rotation.z = Math.sin(t * 1.7) * 0.03 + this.body.rotation.z * 0.5;
    this.halo.scale.setScalar(1.2 + this.capScale * 1.6);
    this.spots.forEach((s, i) => {
      const want = i < this.spotCount ? s.userData.size : 0.0001;
      const cur = s.scale.x + (want - s.scale.x) * Math.min(1, dt * 3);
      s.scale.set(cur, cur * 0.4, cur);
    });
    this.sprouts.forEach((g, i) => {
      const want = i < this.sproutCount ? 1 : 0.0001;
      g.scale.setScalar(g.scale.x + (want - g.scale.x) * Math.min(1, dt * 2.5));
    });

    // ---- Face ----
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) { this.blinkT = 0.13; this.blinkTimer = 2 + Math.random() * 3; }
    this.blinkT = Math.max(0, this.blinkT - dt);
    let face = this.sleeping ? 'sleep' : this.emotion;
    if (this.blinkT > 0 && (face === 'neutral' || face === 'sad')) face = 'blink';
    const frame = face === 'thinking' ? Math.floor(t * 3) : 0;
    const key = `${face}:${frame}`;
    if (key !== this.faceKey) { this.faceKey = key; this.drawFace(face, frame); }

    // ---- Glow pulse ----
    const pulse = Math.sin(t * 2.4) * 0.5 + 0.5;
    const dim = this.sleeping ? 0.6 : 1;
    this.capMat.emissiveIntensity = (0.6 + pulse * 0.2) * dim;
    this.spotMat.color.copy(this.spotColor).multiplyScalar(0.85 + pulse * 0.25);
    this.halo.material.opacity = (0.5 + pulse * 0.2) * dim;
    this.groundGlow.material.opacity = (0.45 - jump * 0.6) * dim;
    this.light.intensity = (3 + pulse * 1.5) * dim * (0.6 + this.capScale * 0.5);
  }
}
