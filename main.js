// main.js — boot, render loop, third-person camera, and the day sequence.
import * as THREE from './vendor/three.module.js';
import { createWorld, LOCATIONS, NODES, findPath, groundHeight } from './world.js';
import { Being } from './being.js';
import * as brain from './brain.js';
import * as ui from './ui.js';
import { audio } from './audio.js';
import { MODELS, getModel, setModel, hasApiKey, setApiKey, clearApiKey } from './settings.js';
import { STAGES, stageFor, loadState, saveState, clearState, exportState, importState, interests } from './memory.js';

const PREFS_KEY = 'aiBeing.prefs.v1';
// Internal render height in pixels: low on purpose (PS2/Dreamcast-era look, and cheap on phones).
const RENDER_HEIGHT = { landscape: 480, vertical: 640 };
const isTouch = matchMedia('(pointer: coarse)').matches;

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

let state = loadState();
const prefs = loadPrefs();
const params = new URLSearchParams(location.search);
// 9:16 is the default; ?vertical=0 or the toggle switches to 16:9.
let vertical = params.has('vertical') ? params.get('vertical') !== '0' : prefs.vertical ?? true;

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------
await Promise.race([document.fonts?.ready.catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);

const stage = document.getElementById('stage');
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });

const world = createWorld();
const scene = world.scene;
const camera = new THREE.PerspectiveCamera(50, 9 / 16, 0.1, 1000);

const being = new Being(scene, { groundHeight });
let currentNode = LOCATIONS.home.node;
let currentLoc = 'home';
being.setPosition(NODES[currentNode].x, NODES[currentNode].z);
being.root.position.y = groundHeight(NODES[currentNode].x, NODES[currentNode].z);

function applyGrowth() {
  being.setEvolution({ stage: state.stage, learnings: state.learnings.length, interests: interests(state) });
}
applyGrowth();

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
let busy = false;
let lastCaption = '';

function refreshSettingsPanel() {
  ui.fillModels(MODELS, getModel());
  ui.setKeyField(hasApiKey());
  if (!hasApiKey()) ui.setKeyStatus('No key: the being uses its built-in thoughts.');
  const next = STAGES[state.stage + 1];
  ui.setMemorySummary(
    `Day ${state.day} · ${state.learnings.length} learnings · stage “${STAGES[state.stage].name}”` +
    (next ? ` (next: “${next.name}” at ${next.at})` : ' (fully grown)'),
  );
}
function refreshBrainPill() { ui.setBrainStatus(brain.brainStatus()); }

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older iOS Safari fallback
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

ui.init({
  onStart: () => runDay(),
  onToggleVertical: () => setVerticalMode(!vertical),
  onDiary: () => { if (ui.toggleDiary()) ui.renderDiary(state, LOCATIONS); },
  onSaveKey: (key) => {
    if (setApiKey(key)) {
      ui.setKeyField(true);
      ui.setKeyStatus('Key saved on this device. Testing…');
      testKey();
    } else {
      ui.setKeyStatus('This browser refused to store the key (private mode?).', 'err');
    }
  },
  onTestKey: () => testKey(),
  onClearKey: () => {
    clearApiKey();
    ui.setKeyField(false);
    ui.setKeyStatus('Key removed from this device.', 'ok');
    refreshBrainPill();
  },
  onModel: (id) => { setModel(id); ui.setKeyStatus(`Model: ${id}`); },
  onExport: () => {
    const date = new Date().toISOString().slice(0, 10);
    download(`ai-being-memory-day${state.day}-${date}.json`, exportState(state));
    ui.toast('Memory exported');
  },
  onImport: (text) => {
    if (busy) { ui.toast('Wait until the day is over'); return; }
    try {
      const next = importState(text);
      if (!confirm(`Replace the current memory (day ${state.day}) with the imported one (day ${next.day}, ${next.learnings.length} learnings)?`)) return;
      state = next;
      saveState(state);
      afterStateChange();
      ui.toast('Memory imported');
    } catch (err) {
      ui.toast(err.message || 'Import failed', 3500);
    }
  },
  onReset: () => {
    if (busy) return;
    if (!confirm('Delete the memory and start again from Day 1? (Export first if you want to keep it.)')) return;
    clearState();
    location.reload();
  },
  onVolume: (v) => { unlockAudio(); audio.setVolume(v); },
  onMuteToggle: () => { unlockAudio(); audio.setMuted(!audio.muted); },
  onSoundTest: (kind, value) => {
    unlockAudio();
    if (kind.startsWith('chirp:')) audio.chirp(kind.slice(6));
    else if (kind === 'colony') audio.setColony(value);
    else if (kind === 'awareness') audio.setStory({ awareness: value });
    else if (kind === 'outage') audio.outage();
    else if (kind === 'rain') audio.rain(!audio.raining);
    else if (kind === 'build') audio.build();
    else if (kind === 'watcher') audio.watcher();
  },
  onCopyCaption: async () => {
    ui.toast((await copyText(lastCaption)) ? 'Caption copied' : 'Copy failed: select the text and copy it manually');
  },
});

async function testKey() {
  ui.setKeyStatus('Testing…');
  const r = await brain.testKey();
  ui.setKeyStatus(r.message, r.ok ? 'ok' : 'err');
  refreshBrainPill();
}

function afterStateChange() {
  applyGrowth();
  ui.setDay(state.day, false);
  ui.setStartEnabled(true, `Start Day ${state.day}`);
  refreshSettingsPanel();
  ui.renderDiary(state, LOCATIONS);
}

// ---------------------------------------------------------------------------
// Sound: starts on the first tap / key press (browsers, and iPhone in particular, require it)
// ---------------------------------------------------------------------------
function unlockAudio() { audio.unlock(); }
for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlockAudio, { capture: true, passive: true });
const refreshSound = () => ui.setSoundState({
  volume: audio.volume, muted: audio.muted, running: audio.running, available: !!(window.AudioContext || window.webkitAudioContext),
});
audio.onChange(refreshSound);
audio.setColony(1); // one creature so far; the colony comes with the story features
audio.setStory({ day: state.day, awareness: 0 });
refreshSound();
const CHIRP = { happy: 'excited', curious: 'curious', scared: 'scared', sad: 'sad', neutral: 'neutral' };

ui.createLabels(LOCATIONS);
ui.setDay(state.day, false);
ui.setVertical(vertical);
ui.setStartEnabled(true, `Start Day ${state.day}`);
refreshSettingsPanel();
refreshBrainPill();

// ---------------------------------------------------------------------------
// Layout (9:16 / 16:9) + low internal resolution
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
  // Desktop: pillarbox to 9:16. Phones held upright always use the full screen.
  const phoneUpright = isTouch && vw < vh;
  if (vertical && !phoneUpright && vw / vh > 9 / 16) W = Math.round(vh * 9 / 16);
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  const target = (W < H ? RENDER_HEIGHT.vertical : RENDER_HEIGHT.landscape) * (isTouch ? 0.9 : 1);
  renderer.setPixelRatio(Math.min(1, target / H));
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.fov = W < H ? 66 : 50;
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
window.visualViewport?.addEventListener('resize', layout);
layout();

// ---------------------------------------------------------------------------
// Third-person camera: 'establish' (wide, slow drift), 'follow' (behind), 'talk' (close-up)
// ---------------------------------------------------------------------------
const cam = {
  mode: 'establish',
  pos: new THREE.Vector3(), look: new THREE.Vector3(),
  wantPos: new THREE.Vector3(), wantLook: new THREE.Vector3(),
};
const portrait = () => W < H;

function talkCameraPos(out) {
  const f = LOCATIONS[currentLoc].facing;
  const b = being.root.position;
  const side = { x: f.z, z: -f.x };
  const dist = portrait() ? 3.6 : 3;
  return out.set(b.x + f.x * dist + side.x * 1.1, b.y + 1.15, b.z + f.z * dist + side.z * 1.1);
}

function cameraTargets(t) {
  const b = being.root.position;
  const f = LOCATIONS[currentLoc].facing;
  if (cam.mode === 'follow') {
    const yaw = being.mover.rotation.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const back = portrait() ? 5.5 : 6.5;
    cam.wantPos.set(b.x - fx * back, b.y + 2.4, (b.z - fz * back) * 0.8);
    cam.wantLook.set(b.x + fx * 4, b.y + 1.3, b.z + fz * 4);
  } else if (cam.mode === 'talk') {
    talkCameraPos(cam.wantPos);
    cam.wantLook.set(b.x - f.x * 0.8, b.y + (portrait() ? 1.0 : 0.8), b.z - f.z * 0.8);
  } else {
    const side = { x: f.z, z: -f.x };
    const sway = Math.sin(t * 0.07) * 1.5;
    const dist = portrait() ? 11 : 15;
    cam.wantPos.set(b.x + side.x * dist + f.x * (4.5 + sway), b.y + 2, b.z + side.z * dist + f.z * (4.5 + sway));
    cam.wantLook.set(b.x - side.x * 8 + f.x * 1.2, b.y + (portrait() ? 4.5 : 3.2), b.z - side.z * 8 + f.z * 1.2);
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

function setActiveLabel(id) {
  activeLabel = id;
  ui.setActiveLabel(id);
}

async function walkTo(locationId) {
  const target = LOCATIONS[locationId].node;
  const points = findPath(currentNode, target).slice(1);
  setCamMode('follow');
  being.setEmotion('neutral');
  await being.walk(points);
  currentNode = target;
  currentLoc = locationId;
}

/** Ask the brain while the face shows "..." (Gemini calls can take a moment). */
async function think(promise) {
  being.setEmotion('thinking');
  audio.chirp('thinking');
  const [result] = await Promise.all([promise, wait(900)]);
  refreshBrainPill();
  return result;
}

async function say(thought, meta, mood = 'neutral') {
  being.setEmotion(mood);
  audio.chirp(CHIRP[mood] ?? 'neutral');
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
    bookmarks: { ...state.bookmarks },
    recentDiary: state.diary.slice(-30),
    recentLearnings: state.learnings.slice(-12),
    recentEntries: state.diaryEntries.slice(-2),
  };
}

function addLearning(day, location, takeaway, reading) {
  if (!takeaway) return;
  const before = state.stage;
  state.learnings.push({
    day, location, takeaway,
    source: reading?.source ?? '', title: reading?.title ?? '', at: new Date().toISOString(),
  });
  state.stage = stageFor(state.learnings.length);
  applyGrowth();
  return state.stage > before ? STAGES[state.stage] : null;
}

async function runDay() {
  if (busy) return;
  busy = true;
  ui.toggleDiary(false);
  ui.toggleSettings(false);
  ui.hideDayCard();
  ui.setStartEnabled(false, 'Exploring…');
  const day = state.day;
  audio.setStory({ day, awareness: 0 });

  being.setSleeping(false);
  ui.setStatus('Dusk · at home');
  await ui.showBanner(`DAY ${day}`, day === 1 ? 'The mushroom bot wakes up for the first time' : 'The city lights come on', 1600);
  timeOfDay = 0; timeTarget = 0.05; world.setTimeOfDay(timeOfDay);

  const today = [];
  const stops = []; // for the diary entry
  const todaysLearnings = [];
  let phase = 'wake';
  const stopsPlanned = Math.random() < 0.5 ? 3 : 4;
  setCamMode('talk');

  for (let guard = 0; guard < 10; guard++) {
    const action = await think(brain.decideNextAction(brainState(phase, today, stopsPlanned)));

    if (action.type === 'wake') {
      phase = 'explore';
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
      ui.setStatus(`${timeLabel()} · at the ${loc.name}`);

      // Library / café: read a chunk and keep a one-sentence takeaway.
      let reading = null;
      if (loc.verb) {
        ui.setStatus(`${timeLabel()} · ${loc.verb.toLowerCase()} at the ${loc.name}`);
        reading = await think(brain.read(action.location, brainState(phase, today, stopsPlanned)));
      }
      const thought = reading?.thought || action.thought;
      const mood = reading?.mood || action.mood;
      const takeaway = reading?.takeaway || action.thought; // park / shop: what it noticed
      being.celebrate();
      const meta = reading ? `${loc.emoji} ${loc.verb}: ${reading.title}` : `${loc.emoji} ${loc.name}`;
      await say(thought, meta, mood);

      today.push(action.location);
      state.visited[action.location] = (state.visited[action.location] ?? 0) + 1;
      if (reading) state.bookmarks[reading.bookmarkKey] = reading.finished ? 999 : reading.nextBookmark;
      const entry = {
        day, location: action.location, thought, mood, takeaway,
        reading: reading ? { title: reading.title, source: reading.source, excerpt: reading.chunk.slice(0, 160) } : null,
        at: new Date().toISOString(),
      };
      state.diary.push(entry);
      stops.push(entry);
      todaysLearnings.push({ takeaway });
      const unlocked = addLearning(day, action.location, takeaway, reading);
      saveState(state);
      if (reading) ui.toast(`Learned: ${takeaway}`, 4200);
      if (unlocked) {
        being.setEmotion('happy');
        audio.chirp('excited');
        await ui.showBanner('NEW STAGE', unlocked.name, 2200);
      }
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
    state.diary.push({ day, location: 'home', thought: action.thought, mood: action.mood, takeaway: '', reading: null, at: new Date().toISOString() });
    break;
  }

  // End of day: diary entry + caption
  ui.setStatus('Night · writing the diary');
  const text = await think(brain.writeDiary({ day, stops, learnings: todaysLearnings }));
  state.diaryEntries.push({ day, text, places: today, at: new Date().toISOString() });
  lastCaption = `Day ${day} of my AI being 🍄 ${text} #aibeing #indiedev`;

  setActiveLabel(null);
  state.day += 1;
  state.daysCompleted += 1;
  saveState(state);
  being.setSleeping(true);
  setCamMode('establish');
  ui.setStatus('Night · sleeping at home');
  ui.setStartEnabled(true, `Start Day ${state.day}`);
  refreshSettingsPanel();
  busy = false;
  await ui.showDayCard(day, text);
  ui.setDay(state.day);
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts (desktop)
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); runDay(); }
  else if (k === 'h') ui.toggleClean();
  else if (k === 'v') setVerticalMode(!vertical);
  else if (k === 'd') { if (ui.toggleDiary()) ui.renderDiary(state, LOCATIONS); }
});

// Handy for debugging / recording from the console
window.aiBeing = {
  get state() { return state; }, runDay, setCamMode, being, audio,
  setTime: (t) => { timeTarget = timeOfDay = t; world.setTimeOfDay(t); },
};
