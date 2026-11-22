// main.js — boot, render loop, third-person camera, save state and the day sequence.
import * as THREE from 'three';
import { createWorld, LOCATIONS, NODES, findPath, groundHeight } from './world.js';
import { Being } from './being.js';
import { decideNextAction } from './brain.js';
import * as ui from './ui.js';

const SAVE_KEY = 'aiBeing.save.v1';
const PREFS_KEY = 'aiBeing.prefs.v1';

// Internal render height in pixels: low on purpose (PS2/Dreamcast-era look, and cheap).
const RENDER_HEIGHT = { landscape: 480, vertical: 640 };

// ---------------------------------------------------------------------------
// Save state
// ---------------------------------------------------------------------------
function defaultState() {
  return { version: 1, day: 1, daysCompleted: 0, knowledge: 0, visited: {}, diary: [] };
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultState();
    const s = { ...defaultState(), ...JSON.parse(raw) };
    // A day interrupted by a reload is discarded so it can be replayed cleanly.
    for (const e of s.diary.filter((d) => d.day === s.day && d.location !== 'home')) {
      if (s.visited[e.location]) s.visited[e.location]--;
      s.knowledge = Math.max(0, s.knowledge - 1);
    }
    s.diary = s.diary.filter((e) => e.day !== s.day);
    return s;
  } catch {
    return defaultState();
  }
}

function saveState() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

const state = loadState();
const prefs = loadPrefs();
const params = new URLSearchParams(location.search);
let vertical = params.has('vertical') ? params.get('vertical') !== '0' : !!prefs.vertical;

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------
await Promise.race([
  document.fonts?.ready.catch(() => {}),
  new Promise((r) => setTimeout(r, 1500)),
]);

const stage = document.getElementById('stage');
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });

const world = createWorld();
const scene = world.scene;
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000);

const being = new Being(scene, { groundHeight });
let currentNode = LOCATIONS.home.node;
let currentLoc = 'home';
being.setPosition(NODES[currentNode].x, NODES[currentNode].z);
being.root.position.y = groundHeight(NODES[currentNode].x, NODES[currentNode].z);
being.setEvolution(state);

ui.init({
  onStart: () => runDay(),
  onToggleVertical: () => setVerticalMode(!vertical),
  onDiary: () => { if (ui.toggleDiary()) ui.renderDiary(state.diary, LOCATIONS); },
  onReset: () => {
    if (busy) return;
    if (!confirm('Delete the save and start again from Day 1?')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    location.reload();
  },
});
ui.createLabels(LOCATIONS);
ui.setDay(state.day, false);
ui.setVertical(vertical);
ui.setStartEnabled(true, `Start Day ${state.day}`);

// ---------------------------------------------------------------------------
// Layout (normal / 9:16) + low internal resolution
// ---------------------------------------------------------------------------
let W = 1, H = 1;
const v3 = new THREE.Vector3();

function toScreen(vec) {
  vec.project(camera);
  return [(vec.x + 1) / 2 * W, (1 - vec.y) / 2 * H, vec.z];
}

function layout() {
  const vw = window.innerWidth, vh = window.innerHeight;
  W = vw; H = vh;
  if (vertical) {
    H = vh; W = Math.round(vh * 9 / 16);
    if (W > vw) { W = vw; H = Math.round(vw * 16 / 9); }
  }
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  renderer.setPixelRatio(Math.min(1, (vertical ? RENDER_HEIGHT.vertical : RENDER_HEIGHT.landscape) / H));
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.fov = vertical ? 66 : 50;
  camera.updateProjectionMatrix();
}

function setVerticalMode(on) {
  vertical = on;
  ui.setVertical(on);
  prefs.vertical = on;
  savePrefs(prefs);
  layout();
}

window.addEventListener('resize', layout);
layout();

// ---------------------------------------------------------------------------
// Third-person camera: 'establish' (wide, slow drift), 'follow' (behind), 'talk' (close-up)
// ---------------------------------------------------------------------------
const cam = {
  mode: 'establish',
  pos: new THREE.Vector3(),
  look: new THREE.Vector3(),
  wantPos: new THREE.Vector3(),
  wantLook: new THREE.Vector3(),
};

function talkCameraPos(out) {
  const f = LOCATIONS[currentLoc].facing;
  const b = being.root.position;
  const side = { x: f.z, z: -f.x };
  const dist = vertical ? 3.6 : 3;
  return out.set(b.x + f.x * dist + side.x * 1.1, b.y + 1.15, b.z + f.z * dist + side.z * 1.1);
}

function cameraTargets(t) {
  const b = being.root.position;
  const f = LOCATIONS[currentLoc].facing;
  if (cam.mode === 'follow') {
    const yaw = being.mover.rotation.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const back = vertical ? 5.5 : 6.5;
    cam.wantPos.set(b.x - fx * back, b.y + 2.4, (b.z - fz * back) * 0.8);
    cam.wantLook.set(b.x + fx * 4, b.y + 1.3, b.z + fz * 4);
  } else if (cam.mode === 'talk') {
    talkCameraPos(cam.wantPos);
    cam.wantLook.set(b.x - f.x * 0.8, b.y + (vertical ? 1.0 : 0.8), b.z - f.z * 0.8);
  } else {
    // Wide, low shot from the road, looking down the street past the being
    const side = { x: f.z, z: -f.x };
    const sway = Math.sin(t * 0.07) * 1.5;
    const dist = vertical ? 11 : 15;
    cam.wantPos.set(b.x + side.x * dist + f.x * (4.5 + sway), b.y + 2, b.z + side.z * dist + f.z * (4.5 + sway));
    cam.wantLook.set(b.x - side.x * 8 + f.x * 1.2, b.y + (vertical ? 4.5 : 3.2), b.z - side.z * 8 + f.z * 1.2);
  }
}

function updateCamera(dt, t, snap = false) {
  cameraTargets(t);
  const k = snap ? 1 : 1 - Math.exp(-dt * (cam.mode === 'follow' ? 1.8 : 1.1));
  cam.pos.lerp(cam.wantPos, k);
  cam.look.lerp(cam.wantLook, k);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
}

function setCamMode(mode) {
  cam.mode = mode;
  if (mode === 'talk') being.faceToward(talkCameraPos(v3).x, v3.z);
}

updateCamera(0, 0, true);

// ---------------------------------------------------------------------------
// Time of day (0 = dusk, 0.5 = evening, 1 = night)
// ---------------------------------------------------------------------------
let timeOfDay = state.daysCompleted > 0 ? 1 : 0.05;
let timeTarget = timeOfDay;
world.setTimeOfDay(timeOfDay);
if (state.daysCompleted > 0) {
  being.setSleeping(true);
  ui.setStatus('Night · sleeping at home');
} else {
  ui.setStatus('Dusk · at home');
}

const timeLabel = () => (timeOfDay < 0.3 ? 'Dusk' : timeOfDay < 0.6 ? 'Evening' : timeOfDay < 0.9 ? 'Night' : 'Late night');

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
let activeLabel = null;
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (Math.abs(timeTarget - timeOfDay) > 0.0005) {
    timeOfDay += (timeTarget - timeOfDay) * Math.min(1, dt * 0.5);
    world.setTimeOfDay(timeOfDay);
  }
  being.update(dt, t);
  updateCamera(dt, t);
  world.update(dt, t, camera);

  const [bx, by] = toScreen(being.getHeadPosition(v3));
  ui.positionBubble(bx, by);
  if (activeLabel) {
    const [lx, ly, lz] = toScreen(v3.set(...LOCATIONS[activeLabel].label));
    ui.positionLabel(activeLabel, lx, ly, lz < 1 && lx > -50 && lx < W + 50 && ly > -20 && ly < H);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// The day sequence
// ---------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;

function setActiveLabel(id) {
  activeLabel = id;
  ui.setActiveLabel(id);
}

async function walkTo(locationId) {
  const target = LOCATIONS[locationId].node;
  const points = findPath(currentNode, target).slice(1);
  setCamMode('follow');
  await being.walk(points);
  currentNode = target;
  currentLoc = locationId;
}

async function say(thought, meta, mood = 'neutral') {
  being.setEmotion('thinking');
  await wait(1100);
  being.setEmotion(mood);
  await ui.showThought(thought, meta);
  await wait(1800 + thought.length * 30);
  ui.hideThought();
  being.setEmotion('neutral');
  await wait(400);
}

function brainState(phase, today, stopsPlanned) {
  return {
    day: state.day,
    phase,
    today: [...today],
    stopsPlanned,
    location: currentLoc,
    visited: { ...state.visited },
    knowledge: state.knowledge,
    recentDiary: state.diary.slice(-30),
    locationNames: Object.fromEntries(Object.entries(LOCATIONS).map(([k, l]) => [k, l.name])),
  };
}

async function runDay() {
  if (busy) return;
  busy = true;
  ui.toggleDiary(false);
  ui.setStartEnabled(false, 'Exploring…');
  const day = state.day;

  being.setSleeping(false);
  ui.setStatus('Dusk · at home');
  await ui.showBanner(`DAY ${day}`, day === 1 ? 'The being wakes up for the first time' : 'The city lights come on', 1600);
  timeOfDay = 0; timeTarget = 0.05; world.setTimeOfDay(timeOfDay);

  const today = [];
  let phase = 'wake';
  let stopsPlanned = 3;

  for (let guard = 0; guard < 10; guard++) {
    const action = await decideNextAction(brainState(phase, today, stopsPlanned));

    if (action.type === 'wake') {
      phase = 'explore';
      stopsPlanned = action.stopsPlanned ?? 3;
      setCamMode('talk');
      being.celebrate();
      await say(action.thought, '🏠 Home · dusk', action.mood);
      continue;
    }

    if (action.type === 'visit') {
      const loc = LOCATIONS[action.location];
      timeTarget = 0.08 + ((today.length + 1) / (stopsPlanned + 1)) * 0.75;
      setActiveLabel(action.location);
      ui.setStatus(`${timeLabel()} · walking to the ${loc.name}`);
      await walkTo(action.location);
      setActiveLabel(null);
      setCamMode('talk');
      being.celebrate();
      ui.setStatus(`${timeLabel()} · at the ${loc.name}`);
      const meta = action.reading && loc.verb ? `${loc.emoji} ${loc.verb}: ${action.reading.title}` : `${loc.emoji} ${loc.name}`;
      await say(action.thought, meta, action.mood);

      today.push(action.location);
      state.visited[action.location] = (state.visited[action.location] ?? 0) + 1;
      state.knowledge += 1;
      state.diary.push({
        day, location: action.location, thought: action.thought,
        reading: action.reading ? { title: action.reading.title, source: action.reading.source, excerpt: action.reading.excerpt } : null,
        at: new Date().toISOString(),
      });
      being.setEvolution(state);
      saveState();
      continue;
    }

    // goHome
    setActiveLabel('home');
    timeTarget = 0.92;
    ui.setStatus(`${timeLabel()} · going home`);
    await walkTo('home');
    setActiveLabel(null);
    setCamMode('talk');
    timeTarget = 1;
    ui.setStatus('Night · at home');
    await say(action.thought, '🏠 Home · night', action.mood);
    state.diary.push({ day, location: 'home', thought: action.thought, reading: null, at: new Date().toISOString() });
    break;
  }

  setActiveLabel(null);
  state.day += 1;
  state.daysCompleted += 1;
  saveState();
  being.setSleeping(true);
  setCamMode('establish');
  const names = today.map((id) => LOCATIONS[id].name).join(' · ');
  await ui.showBanner(`DAY ${day} DONE`, names, 2400);
  ui.setDay(state.day);
  ui.setStatus('Night · sleeping at home');
  ui.setStartEnabled(true, `Start Day ${state.day}`);
  busy = false;
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); runDay(); }
  else if (k === 'h') ui.toggleClean();
  else if (k === 'v') setVerticalMode(!vertical);
  else if (k === 'd') { if (ui.toggleDiary()) ui.renderDiary(state.diary, LOCATIONS); }
});

// Handy for debugging / recording from the console
window.aiBeing = { get state() { return state; }, runDay, setCamMode, being, setTime: (t) => { timeTarget = timeOfDay = t; world.setTimeOfDay(t); } };
