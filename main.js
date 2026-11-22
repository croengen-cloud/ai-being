// main.js — boot, render loop, save state, and the day sequence.
import * as THREE from 'three';
import { createWorld, LOCATIONS, NODES, findPath } from './world.js';
import { Being } from './being.js';
import { decideNextAction } from './brain.js';
import * as ui from './ui.js';

const SAVE_KEY = 'aiBeing.save.v1';
const PREFS_KEY = 'aiBeing.prefs.v1';

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
    const partial = s.diary.filter((e) => e.day === s.day);
    for (const e of partial) {
      if (e.location !== 'home' && s.visited[e.location]) s.visited[e.location]--;
      if (e.location !== 'home') s.knowledge = Math.max(0, s.knowledge - 1);
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

let state = loadState();
const prefs = loadPrefs();
const params = new URLSearchParams(location.search);
let vertical = params.has('vertical') ? params.get('vertical') !== '0' : !!prefs.vertical;

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------
// Wait briefly for the web font so canvas signs use it (fallback font otherwise).
await Promise.race([
  document.fonts?.load('700 66px Fredoka').catch(() => {}),
  new Promise((r) => setTimeout(r, 1500)),
]);

const stage = document.getElementById('stage');
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const world = createWorld();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
camera.position.set(30, 30, 30); // true isometric angle
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();

const being = new Being(world.scene);
let currentNode = LOCATIONS.home.node;
being.setPosition(NODES[currentNode].x, NODES[currentNode].z);
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
// Layout (normal / 9:16)
// ---------------------------------------------------------------------------
let W = 1, H = 1;
const v3 = new THREE.Vector3();

function toScreen(vec) {
  vec.project(camera);
  return [(vec.x + 1) / 2 * W, (1 - vec.y) / 2 * H];
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
  renderer.setSize(W, H, false);

  // Fit the island: needed half-extents in world units (view space)
  const aspect = W / H;
  const needW = vertical ? 11 : 15.5;
  const needH = 10.5;
  const halfH = Math.max(needH, needW / aspect);
  const halfW = halfH * aspect;
  // In vertical mode shift the island slightly down so the top has room for the day counter.
  const shift = vertical ? halfH * 0.06 : -0.6;
  Object.assign(camera, { left: -halfW, right: halfW, top: halfH + shift, bottom: -halfH + shift });
  camera.updateProjectionMatrix();

  for (const [id, loc] of Object.entries(LOCATIONS)) {
    const [x, y] = toScreen(v3.set(...loc.label));
    ui.positionLabel(id, x, y);
  }
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
// Time of day (0 = morning, 0.5 = noon, 1 = dusk)
// ---------------------------------------------------------------------------
let timeOfDay = state.daysCompleted > 0 ? 1 : 0.08;
let timeTarget = timeOfDay;
let lastSky = '';
function applyTime() {
  const sky = world.setTimeOfDay(timeOfDay);
  const bg = `linear-gradient(180deg, ${sky.top} 0%, ${sky.bottom} 100%)`;
  if (bg !== lastSky) { stage.style.background = bg; lastSky = bg; }
}
applyTime();
if (state.daysCompleted > 0) {
  being.setSleeping(true);
  ui.setStatus('Night · sleeping at home');
}

const timeLabel = () => (timeOfDay < 0.3 ? 'Morning' : timeOfDay < 0.6 ? 'Midday' : timeOfDay < 0.85 ? 'Afternoon' : 'Evening');

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (Math.abs(timeTarget - timeOfDay) > 0.0005) {
    timeOfDay += (timeTarget - timeOfDay) * Math.min(1, dt * 0.6);
    applyTime();
  }
  world.update(dt, t);
  being.update(dt, t);
  const [bx, by] = toScreen(being.getHeadPosition(v3));
  ui.positionBubble(bx, by);
  renderer.render(world.scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// The day sequence
// ---------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;

async function walkTo(locationId) {
  const target = LOCATIONS[locationId].node;
  const points = findPath(currentNode, target).slice(1);
  await being.walk(points);
  currentNode = target;
}

async function say(thought, meta) {
  await ui.showThought(thought, meta);
  await wait(1800 + thought.length * 30);
  ui.hideThought();
  await wait(400);
}

function brainState(phase, today, stopsPlanned) {
  return {
    day: state.day,
    phase,
    today: [...today],
    stopsPlanned,
    location: Object.keys(LOCATIONS).find((k) => LOCATIONS[k].node === currentNode) ?? 'home',
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

  // Sunrise behind the banner
  being.setSleeping(false);
  ui.setStatus('Morning · at home');
  await ui.showBanner(`DAY ${day}`, day === 1 ? 'The being wakes up for the first time' : 'A new day begins', 1600);
  timeOfDay = 0; timeTarget = 0.08; applyTime();

  const today = [];
  let phase = 'wake';
  let stopsPlanned = 3;

  for (let guard = 0; guard < 10; guard++) {
    const action = await decideNextAction(brainState(phase, today, stopsPlanned));

    if (action.type === 'wake') {
      phase = 'explore';
      stopsPlanned = action.stopsPlanned ?? 3;
      being.lookAtCamera();
      being.celebrate();
      await say(action.thought, '🏠 Home · morning');
      continue;
    }

    if (action.type === 'visit') {
      const loc = LOCATIONS[action.location];
      timeTarget = 0.12 + ((today.length + 1) / (stopsPlanned + 1)) * 0.68;
      ui.setActiveLabel(action.location);
      ui.setStatus(`${timeLabel()} · walking to the ${loc.name}`);
      await walkTo(action.location);
      being.lookAtCamera();
      being.celebrate();
      ui.setStatus(`${timeLabel()} · at the ${loc.name}`);
      const meta = action.reading && loc.verb ? `${loc.emoji} ${loc.verb}: ${action.reading.title}` : `${loc.emoji} ${loc.name}`;
      await say(action.thought, meta);

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
    ui.setActiveLabel('home');
    timeTarget = 0.9;
    ui.setStatus('Evening · going home');
    await walkTo('home');
    being.lookAtCamera();
    timeTarget = 1;
    ui.setStatus('Evening · at home');
    await say(action.thought, '🏠 Home · evening');
    state.diary.push({ day, location: 'home', thought: action.thought, reading: null, at: new Date().toISOString() });
    break;
  }

  ui.setActiveLabel(null);
  state.day += 1;
  state.daysCompleted += 1;
  saveState();
  being.setSleeping(true);
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

// Handy for debugging in the console
window.aiBeing = { get state() { return state; }, runDay };
