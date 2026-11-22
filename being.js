// being.js — the AI Being: a glowing blob with eyes that walks, hops, blinks and slowly evolves.
import * as THREE from 'three';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Being {
  constructor(scene, { groundHeight = () => 0 } = {}) {
    this.groundHeight = groundHeight;
    this.root = new THREE.Group(); // world position
    this.mover = new THREE.Group(); // yaw
    this.body = new THREE.Group(); // bob / squash
    this.root.add(this.mover);
    this.mover.add(this.body);
    scene.add(this.root);

    this.baseY = 0.62;
    this.speed = 2.6;
    this.path = [];
    this._resolve = null;
    this.targetYaw = Math.PI / 4;
    this.walkBlend = 0;
    this.phase = 0;
    this.celebrateT = 0;
    this.blinkTimer = 2;
    this.blinkT = 0;
    this.sleeping = false;
    this.evoScale = 1;

    const glow = glowTexture();

    // Body: a soft sphere, slightly flattened at the bottom
    const geo = new THREE.SphereGeometry(0.55, 36, 24);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 0) pos.setY(i, y * 0.82);
    }
    geo.computeVertexNormals();
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x9af2ff, emissive: 0x4ccfff, emissiveIntensity: 0.55, roughness: 0.35 });
    const blob = new THREE.Mesh(geo, this.bodyMat);
    blob.castShadow = true;
    this.body.add(blob);

    // Eyes
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x2b2440, roughness: 0.4 });
    const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.eyes = [];
    for (const x of [-0.19, 0.19]) {
      const e = new THREE.Group();
      e.position.set(x, 0.1, 0.46);
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), white);
      w.scale.z = 0.6;
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), pupil);
      p.position.z = 0.06;
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), shine);
      h.position.set(0.03, 0.04, 0.12);
      e.add(w, p, h);
      this.body.add(e);
      this.eyes.push(e);
    }

    // Smile + cheeks
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 6, 14, Math.PI), pupil);
    mouth.position.set(0, -0.08, 0.52);
    mouth.rotation.z = Math.PI;
    this.body.add(mouth);
    const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff9fc0, transparent: true, opacity: 0.6, depthWrite: false });
    for (const s of [-1, 1]) {
      const ch = new THREE.Mesh(new THREE.CircleGeometry(0.06, 14), cheekMat);
      ch.position.set(s * 0.33, -0.04, 0.43);
      ch.rotation.y = s * 0.65;
      this.body.add(ch);
    }

    // Antenna (appears on day 3)
    this.antenna = new THREE.Group();
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.34, 6), this.bodyMat);
    stalk.position.y = 0.6;
    this.tipMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), this.tipMat);
    tip.position.y = 0.8;
    this.antenna.add(stalk, tip);
    this.antenna.visible = false;
    this.body.add(this.antenna);

    // Halo, ground glow, light
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: 0x7fe8ff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.halo.scale.set(2.4, 2.4, 1);
    this.body.add(this.halo);

    this.groundGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: glow, color: 0x7fe8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.groundGlow.rotation.x = -Math.PI / 2;
    this.groundGlow.position.y = 0.07;
    this.mover.add(this.groundGlow);

    this.light = new THREE.PointLight(0x7fe8ff, 4, 8, 1);
    this.light.position.y = 0.7;
    this.mover.add(this.light);

    // Orbiting sparkles: one more for every few things learned
    this.sparkles = [];
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), sparkMat);
      s.visible = false;
      this.mover.add(s);
      this.sparkles.push(s);
    }
    this.sparkleCount = 0;
  }

  setPosition(x, z) {
    this.root.position.set(x, 0, z);
  }

  /** World position just above the head (for the thought bubble). */
  getHeadPosition(out) {
    return out.copy(this.root.position).setY(this.root.position.y + this.body.position.y + 0.95 * this.evoScale);
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

  /** Visual evolution driven by save state. */
  setEvolution({ day, knowledge }) {
    const stage = Math.min(day - 1, 20);
    const hue = 0.52 + stage * 0.012; // cyan → violet over ~20 days
    this.bodyMat.color.setHSL(hue, 0.85, 0.75);
    this.bodyMat.emissive.setHSL(hue, 0.95, 0.55);
    const glow = new THREE.Color().setHSL(hue, 1, 0.7);
    this.halo.material.color.copy(glow);
    this.groundGlow.material.color.copy(glow);
    this.light.color.copy(glow);
    this.evoScale = 1 + Math.min(knowledge, 40) * 0.006;
    this.antenna.visible = day >= 3;
    this.sparkleCount = Math.min(Math.floor(knowledge / 3), this.sparkles.length);
    this.sparkles.forEach((s, i) => { s.visible = i < this.sparkleCount; });
  }

  update(dt, t) {
    // Movement along the path
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
        if (!this.path.length && this._resolve) {
          const r = this._resolve; this._resolve = null; r();
        }
      } else {
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
        this.targetYaw = Math.atan2(dx, dz);
        moving = true;
      }
    }

    // Follow the ground (sidewalk curbs)
    const gh = this.groundHeight(this.root.position.x, this.root.position.z);
    this.root.position.y += (gh - this.root.position.y) * Math.min(1, dt * 12);

    // Smooth turning (shortest angle)
    let diff = this.targetYaw - this.mover.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.mover.rotation.y += diff * Math.min(1, dt * 8);

    // Hop while walking, float while idle
    this.walkBlend += ((moving ? 1 : 0) - this.walkBlend) * Math.min(1, dt * 6);
    if (moving) this.phase += dt * 9;
    const s = Math.sin(this.phase);
    const hop = Math.abs(s) * 0.24 * this.walkBlend;
    const idleSpeed = this.sleeping ? 1.1 : 2.2;
    const bob = Math.sin(t * idleSpeed) * (this.sleeping ? 0.02 : 0.06) * (1 - this.walkBlend);
    let jump = 0;
    if (this.celebrateT > 0) {
      this.celebrateT = Math.max(0, this.celebrateT - dt);
      jump = Math.sin((1 - this.celebrateT / 0.7) * Math.PI) * 0.5;
    }
    this.body.position.y = this.baseY * (this.sleeping ? 0.85 : 1) + hop + bob + jump;

    // Squash & stretch
    const squash = this.walkBlend * (1 - Math.abs(s)) * 0.16;
    const breathe = Math.sin(t * idleSpeed + 1) * 0.03;
    const sy = (1 - squash + breathe + jump * 0.15) * this.evoScale;
    const sxz = (1 + squash * 0.5 - breathe * 0.5) * this.evoScale;
    this.body.scale.set(sxz, sy, sxz);

    // Blinking (eyes closed while sleeping)
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) { this.blinkT = 0.14; this.blinkTimer = 2 + Math.random() * 3; }
    this.blinkT = Math.max(0, this.blinkT - dt);
    const eyeY = this.sleeping || this.blinkT > 0 ? 0.1 : 1;
    for (const e of this.eyes) e.scale.y += (eyeY - e.scale.y) * Math.min(1, dt * 25);

    // Glow pulse
    const pulse = Math.sin(t * 3) * 0.08;
    this.halo.material.opacity = (this.sleeping ? 0.3 : 0.48) + pulse;
    this.groundGlow.material.opacity = 0.5 - (this.body.position.y - this.baseY) * 0.4;
    this.light.intensity = (this.sleeping ? 2.5 : 4.5) + pulse * 6;
    this.tipMat.color.setHSL(0.14, 1, 0.75 + Math.sin(t * 5) * 0.1);

    // Sparkles orbit the being
    for (let i = 0; i < this.sparkleCount; i++) {
      const a = t * 1.4 + (i / this.sparkleCount) * Math.PI * 2;
      const sp = this.sparkles[i];
      sp.position.set(Math.cos(a) * 0.85 * this.evoScale, this.body.position.y + 0.2 + Math.sin(a * 2 + i) * 0.15, Math.sin(a) * 0.85 * this.evoScale);
      sp.rotation.y = t * 3;
    }
  }
}
