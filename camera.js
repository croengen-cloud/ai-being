// camera.js — angled top-down "god view": drag to pan, pinch / wheel to zoom, two-finger
// twist to rotate. After a few seconds without input the auto camera takes over and follows
// the most interesting action (for hands-free recording).
import * as THREE from './vendor/three.module.js';

const MIN_D = 6, MAX_D = 70;
const PITCH = 1.08; // radians above the horizon (~62°)

export function createGodCamera(canvas, { onUserInput } = {}) {
  const camera = new THREE.PerspectiveCamera(40, 9 / 16, 0.3, 900);
  const state = {
    target: new THREE.Vector3(0, 0, 2), dist: 34, yaw: 0.6,
    want: { target: new THREE.Vector3(0, 0, 2), dist: 34, yaw: 0.6 },
    auto: true, lastInput: -1e9, pitch: PITCH,
  };
  camera.userData.target = state.target;

  const pointers = new Map();
  let pinch = null;
  const now = () => performance.now();
  const touched = () => { state.lastInput = now(); onUserInput?.(); };

  function panBy(dxPx, dyPx) {
    const h = canvas.clientHeight || 1;
    const k = (state.dist * 1.15) / h;
    const cos = Math.cos(state.yaw), sin = Math.sin(state.yaw);
    // screen right = (cos, -sin) ... in world: camera looks along -forward
    const rx = cos, rz = -sin, fx = -sin, fz = -cos;
    state.want.target.x += (-dxPx * rx + dyPx * fx * 1.25) * k;
    state.want.target.z += (-dxPx * rz + dyPx * fz * 1.25) * k;
    const r = Math.hypot(state.want.target.x, state.want.target.z);
    if (r > 32) state.want.target.multiplyScalar(32 / r);
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), dist: state.want.dist, yaw: state.want.yaw };
    }
    touched();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 1) panBy(dx, dy);
    else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      state.want.dist = THREE.MathUtils.clamp(pinch.dist * (pinch.d / Math.max(20, d)), MIN_D, MAX_D);
      state.want.yaw = pinch.yaw - (Math.atan2(b.y - a.y, b.x - a.x) - pinch.ang);
    }
    touched();
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.want.dist = THREE.MathUtils.clamp(state.want.dist * Math.exp(e.deltaY * 0.0012), MIN_D, MAX_D);
    touched();
  }, { passive: false });

  return {
    camera,
    state,
    get auto() { return state.auto; },
    setAuto(on) { state.auto = on; if (on) state.lastInput = -1e9; },
    /** Jump / glide to a point (used for close-ups and screenshots). */
    focus(x, z, dist, yaw) {
      state.want.target.set(x, 0, z);
      if (dist) state.want.dist = dist;
      if (yaw !== undefined) state.want.yaw = yaw;
      state.lastInput = now();
    },
    /**
     * @param focus {x, z} most interesting point; spread: colony radius; heightAt: terrain fn
     */
    update(dt, { focus, spread = 6, heightAt, portrait = true }) {
      const idle = now() - state.lastInput > 6000;
      if (state.auto && idle && focus) {
        state.want.target.set(focus.x, 0, focus.z);
        const fit = (focus.score ?? 1) >= 5 ? 21 : THREE.MathUtils.clamp(spread * (portrait ? 3.2 : 2.2) + 18, 24, 50);
        state.want.dist += (fit - state.want.dist) * Math.min(1, dt * 0.6);
        state.want.yaw += dt * 0.035; // slow cinematic drift
      }
      const k = 1 - Math.exp(-dt * (idle ? 1.4 : 9));
      state.target.lerp(state.want.target, k);
      state.dist += (state.want.dist - state.dist) * k;
      state.yaw += (state.want.yaw - state.yaw) * k;
      const ground = heightAt ? heightAt(state.target.x, state.target.z) : 0;
      const pitch = state.pitch + (1 - (state.dist - MIN_D) / (MAX_D - MIN_D)) * -0.18; // slightly lower angle when close
      const horiz = Math.cos(pitch) * state.dist;
      camera.position.set(
        state.target.x + Math.sin(state.yaw) * horiz,
        ground + Math.sin(pitch) * state.dist,
        state.target.z + Math.cos(state.yaw) * horiz,
      );
      camera.lookAt(state.target.x, ground + 0.6, state.target.z);
    },
  };
}
