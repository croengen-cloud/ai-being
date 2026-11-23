// main.js — boot, render loop, day cycle, hive mind calls, creator actions, UI wiring.
import * as THREE from './vendor/three.module.js';
import { createForest } from './forest.js';
import { createMycelRenderer } from './mycel.js';
import { Colony, DAY_SECONDS } from './colony.js';
import { createGodCamera } from './camera.js';
import * as brain from './brain.js';
import * as ui from './ui.js';
import { audio } from './audio.js';
import { glowTexture } from './icons.js';
import { MODELS, getModel, setModel, hasApiKey, setApiKey, clearApiKey } from './settings.js';
import { loadState, saveState, clearState, exportState, importState } from './memory.js';

const PREFS_KEY = 'aiBeing.prefs.v1';
const isTouch = matchMedia('(pointer: coarse)').matches;
const SPEEDS = [1, 2, 4, 0];

function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ } }

let state = loadState();
const prefs = loadPrefs();
const params = new URLSearchParams(location.search);
let vertical = params.has('vertical') ? params.get('vertical') !== '0' : prefs.vertical ?? true;

// ---------------------------------------------------------------------------
// Renderer, world, colony, camera
// ---------------------------------------------------------------------------
await Promise.race([document.fonts?.ready.catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);

const stage = document.getElementById('stage');
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const world = createForest({ shadowSize: isTouch ? 1024 : 2048 });
const scene = world.scene;
const mycelRenderer = createMycelRenderer(scene);
const god = createGodCamera(canvas, { onUserInput: () => { if (god.auto) ui.setAutoCam(true); } });
const camera = god.camera;

// Rain (creator action)
const RAIN_N = 900;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) rainPos.set([(Math.random() - 0.5) * 60, Math.random() * 30, (Math.random() - 0.5) * 60], i * 3);
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xcfe8ff, size: 0.16, map: glowTexture(), transparent: true, opacity: 0.8, depthWrite: false }));
rain.visible = false; rain.frustumCulled = false;
scene.add(rain);
let raining = false;

let colony;
function makeColony() {
  colony = new Colony(world, scene, state.colony, {
    onEvent: handleEvent,
    onSound: playSound,
    onChirp: (emotion, m) => audio.chirp(emotion, nearness(m)),
  });
  colony.day = state.day;
}
makeColony();

// ---------------------------------------------------------------------------
// Sound helpers
// ---------------------------------------------------------------------------
function nearness(p) {
  if (!p || p.x === undefined) return 1;
  const t = god.state.target;
  const d = Math.hypot(p.x - t.x, p.z - t.z);
  return THREE.MathUtils.clamp(1.15 - d / (god.state.dist * 0.9), 0.12, 1);
}
function playSound(name, p) {
  const g = nearness(p);
  if (name === 'chop') audio.chop(g);
  else if (name === 'treeFall') audio.treeFall();
  else if (name === 'spore') audio.spore(g);
  else if (name === 'birth') audio.chirp('birth', g);
  else if (name === 'knock') audio.knock(g);
  else if (name === 'build') audio.build();
  else if (name === 'fight') audio.chirp('angry', g);
  else audio.sfx(name, g);
}
function unlockAudio() { audio.unlock(); }
for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlockAudio, { capture: true, passive: true });
const refreshSound = () => ui.setSoundState({ volume: audio.volume, muted: audio.muted, running: audio.running, available: !!(window.AudioContext || window.webkitAudioContext) });
audio.onChange(refreshSound);

// ---------------------------------------------------------------------------
// Events -> feed, diary log, thoughts
// ---------------------------------------------------------------------------
const BIG = new Set(['discovery', 'fire', 'build', 'treeFall', 'creator', 'love', 'defend', 'watcher']);
const BAD = new Set(['threat', 'steal', 'lost', 'fight', 'fireOut']);
let birthsBatch = 0, birthTimer = 0;
function handleEvent(e) {
  if (e.type === 'birth') {
    // births come in waves: summarize them in the feed
    birthsBatch++;
    clearTimeout(birthTimer);
    birthTimer = setTimeout(() => {
      ui.feed(birthsBatch === 1 ? e.text : `${birthsBatch} new Mycel sprouted!`, 'big');
      birthsBatch = 0;
    }, 1200);
    return;
  }
  if (['plan', 'craft'].includes(e.type) && Math.random() < 0.5) return; // keep the feed calm
  ui.feed(e.text, BIG.has(e.type) ? 'big' : BAD.has(e.type) ? 'bad' : '');
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
let speedIdx = 0;
let lastCaption = '';
let started = false;

function refreshSettingsPanel() {
  ui.fillModels(MODELS, getModel());
  ui.setKeyField(hasApiKey());
  if (!hasApiKey()) ui.setKeyStatus('No key: the Mycel follow their built-in instincts.');
  ui.setMemorySummary(`Day ${state.day} · ${colony.mycel.length} Mycel · ${state.diaryEntries.length} diary entries · ${state.learnings.length} learnings`);
}
const refreshBrainPill = () => ui.setBrainStatus(brain.brainStatus());

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }
}
function setSpeed(i) {
  speedIdx = i;
  ui.setSpeedLabel(SPEEDS[i] ? `${SPEEDS[i]}×` : 'Paused');
}

ui.init({
  onToggleVertical: () => setVerticalMode(!vertical),
  onSpeed: () => setSpeed((speedIdx + 1) % SPEEDS.length),
  onAutoCam: () => { god.setAuto(!god.auto); ui.setAutoCam(god.auto); },
  onCreator: (act, text) => creatorAction(act, text),
  onDiary: () => { if (ui.toggleDiary()) ui.renderDiary(state); },
  onSaveKey: (key) => {
    if (setApiKey(key)) { ui.setKeyField(true); ui.setKeyStatus('Key saved on this device. Testing…'); testKey(); }
    else ui.setKeyStatus('This browser refused to store the key (private mode?).', 'err');
  },
  onTestKey: () => testKey(),
  onClearKey: () => { clearApiKey(); ui.setKeyField(false); ui.setKeyStatus('Key removed from this device.', 'ok'); refreshBrainPill(); },
  onModel: (id) => { setModel(id); ui.setKeyStatus(`Model: ${id}`); },
  onExport: () => {
    download(`mycel-memory-day${state.day}-${new Date().toISOString().slice(0, 10)}.json`, exportState(state));
    ui.toast('Memory exported');
  },
  onImport: (text) => {
    try {
      const next = importState(text);
      if (!confirm(`Replace the current colony (day ${state.day}) with the imported one (day ${next.day})? The page will reload.`)) return;
      saveState(next);
      location.reload();
    } catch (err) { ui.toast(err.message || 'Import failed', 3500); }
  },
  onReset: () => {
    if (!confirm('Delete the colony and start again from Day 1 with one Mycel? (Export first if you want to keep it.)')) return;
    clearState();
    location.reload();
  },
  onVolume: (v) => { unlockAudio(); audio.setVolume(v); },
  onMuteToggle: () => { unlockAudio(); audio.setMuted(!audio.muted); },
  onCopyCaption: async () => { ui.toast((await copyText(lastCaption)) ? 'Caption copied' : 'Copy failed: select the text and copy it manually'); },
  onTitleDismissed: () => startGame(),
});
async function testKey() {
  ui.setKeyStatus('Testing…');
  const r = await brain.testKey();
  ui.setKeyStatus(r.message, r.ok ? 'ok' : 'err');
  refreshBrainPill();
}

ui.setDay(state.day, false);
ui.setVertical(vertical);
ui.setAutoCam(true);
setSpeed(0);
refreshSettingsPanel();
refreshBrainPill();
refreshSound();

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
let W = 1, H = 1;
function layout() {
  const vw = window.innerWidth, vh = window.innerHeight;
  W = vw; H = vh;
  const phoneUpright = isTouch && vw < vh;
  if (vertical && !phoneUpright && vw / vh > 9 / 16) W = Math.round(vh * 9 / 16);
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.fov = W < H ? 52 : 38;
  camera.updateProjectionMatrix();
}
function setVerticalMode(on) {
  vertical = on; ui.setVertical(on); prefs.vertical = on; savePrefs(prefs); layout();
}
window.addEventListener('resize', layout);
window.visualViewport?.addEventListener('resize', layout);
layout();

// ---------------------------------------------------------------------------
// Day cycle + hive mind
// ---------------------------------------------------------------------------
const timeLabel = (p) => (p < 0.08 ? 'Dawn' : p < 0.3 ? 'Morning' : p < 0.5 ? 'Midday' : p < 0.66 ? 'Afternoon' : p < 0.74 ? 'Dusk' : p < 0.97 ? 'Night' : 'Dawn');

function hiveSummary() {
  const s = colony.summary();
  const lastEntry = state.diaryEntries.filter((d) => !d.legacy).at(-1);
  return {
    ...s,
    yesterday: lastEntry?.events?.slice(0, 8) ?? [],
    lastDiary: lastEntry?.text ?? '',
    creatorLog: state.creatorLog.filter((c) => c.day >= s.day - 1).map((c) => c.text).slice(-6),
    learnings: state.learnings.slice(-4).map((l) => l.takeaway),
  };
}

async function morningPlan() {
  const plan = await brain.planDay(hiveSummary());
  refreshBrainPill();
  colony.plan = plan;
  if (plan.event === 'berry boom') colony.creator('berries');
  if (plan.event === 'storm') setRain(true);
  if (plan.event === 'great discovery') colony.awareness = Math.min(1, colony.awareness + 0.05);
  ui.showThought('The Mycel think', plan.thought);
  if (plan.watcherMessage) {
    setTimeout(() => {
      audio.watcher();
      ui.showThought('Message to the Watcher', plan.watcherMessage, { watcher: true, ms: 8000 });
      colony.event('watcher', `The Mycel wrote to the Watcher: “${plan.watcherMessage}”`);
    }, 7000);
  }
}

async function startGame() {
  if (started) return;
  started = true;
  await ui.showBanner(`DAY ${state.day}`, state.day === 1 && !state.colony ? 'A single Mycel wakes up in the clearing' : `${colony.mycel.length} Mycel wake up`, 1700);
  morningPlan();
}

let dayEnding = false;
async function endDay() {
  if (dayEnding) return;
  dayEnding = true;
  const finished = state.day;
  const summary = { ...hiveSummary(), day: finished };
  colony.startDay(finished + 1, null);
  state.day = finished + 1;
  state.colony = colony.serialize();
  saveState(state);
  ui.setDay(state.day);
  ui.showBanner(`DAY ${state.day}`, `${colony.mycel.length} Mycel wake up`, 1500);
  dayEnding = false;
  morningPlan();

  const text = await brain.writeDiary(summary);
  refreshBrainPill();
  state.diaryEntries.push({ day: finished, text, events: summary.events, population: summary.population, at: new Date().toISOString() });
  saveState(state);
  lastCaption = `🍄 THE MYCEL · Day ${finished} · ${summary.population} Mycel\n${text}\n#themycel #mycel #indiedev`;
  ui.showDayCard(finished, text, `Mycel diary · ${summary.population} Mycel`);
  refreshSettingsPanel();
}

// ---------------------------------------------------------------------------
// Creator actions
// ---------------------------------------------------------------------------
function setRain(on) {
  raining = on; rain.visible = on;
  audio.rain(on);
}
const CREATOR_TEXT = {
  berries: 'The Watcher made berries rain.', rain: 'The Watcher sent rain.', sun: 'The Watcher sent sunshine.',
  fire: 'The Watcher lit the fire.', beetles: 'The Watcher sent thorn beetles.', spores: 'The Watcher gifted spores.',
  knowledge: 'The Watcher dropped a page of knowledge.',
};
async function creatorAction(act, text) {
  unlockAudio();
  if (!started) ui.dismissTitle();
  const log = (t) => state.creatorLog.push({ day: state.day, action: act, text: t });
  if (act === 'rain') {
    setRain(!raining);
    log(raining ? CREATOR_TEXT.rain : 'The Watcher stopped the rain.');
    colony.event('creator', raining ? 'Rain began to fall. The berry bushes drink.' : 'The rain stopped.', null);
  } else if (act === 'sun') {
    setRain(false);
    colony.mycel.forEach((m) => colony.setEmotion(m, 'happy', 3));
    colony.event('creator', 'Warm sunshine broke through. The Mycel glowed with joy.', colony.centroid(), 5);
    log(CREATOR_TEXT.sun);
  } else if (act === 'message') {
    colony.creator('message', text);
    audio.watcher(2.2);
    ui.showThought('The Watcher', text, { watcher: true, ms: 7000 });
    log(`The Watcher said: "${text}"`);
  } else if (act === 'knowledge') {
    const folder = Math.random() < 0.6 ? 'library' : 'cafe';
    const m = colony.mycel[Math.floor(Math.random() * colony.mycel.length)];
    if (m) colony.setEmotion(m, 'curious', 4);
    ui.toast('A page falls from the sky…');
    const r = await brain.read(folder, { day: state.day, bookmarks: state.bookmarks, recentDiary: [] });
    refreshBrainPill();
    if (r) {
      state.bookmarks[r.bookmarkKey] = r.finished ? 999 : r.nextBookmark;
      state.learnings.push({ day: state.day, title: r.title, source: r.source, takeaway: r.takeaway, at: new Date().toISOString() });
      colony.creator('knowledge');
      colony.event('learn', `${m?.name ?? 'A Mycel'} read “${r.title}”: ${r.takeaway}`, m, 6);
      ui.showThought(`${m?.name ?? 'A Mycel'} read “${r.title}”`, r.thought);
      audio.chirp('curious');
    }
    log(CREATOR_TEXT.knowledge);
  } else {
    colony.creator(act);
    if (act === 'fire') audio.knock();
    log(CREATOR_TEXT[act] ?? act);
  }
  ui.toggleCreator(false);
}

// ---------------------------------------------------------------------------
// Simulation step + render loop
// ---------------------------------------------------------------------------
let simTime = 0;
function simulate(dt) {
  simTime += dt;
  colony.cameraPos = camera.position;
  colony.update(dt);
  if (raining) {
    for (const b of world.bushes) b.regrow += dt * 0.8; // rain makes berries grow faster
    if (world.fire.lit) world.fire.fuel -= dt / 160;
  }
  if (colony.phase >= 1) endDay();
}

const clock = new THREE.Clock();
let uiTimer = 0, moodTimer = 0;
const visible = [];
function frame() {
  const realDt = Math.min(clock.getDelta(), 0.1);
  const speed = started ? SPEEDS[speedIdx] : 0;
  let simDt = realDt * speed;
  while (simDt > 0) { const step = Math.min(simDt, 0.05); simulate(step); simDt -= step; }

  const daylight = world.setPhase(Math.min(colony.phase, 0.9999));
  world.update(realDt * Math.max(speed, started ? 1 : 0.5), simTime, camera);
  mycelRenderer.setNightGlow(0.55 + (1 - daylight) * 0.9);
  visible.length = 0;
  for (const m of colony.mycel) if (!m.hidden) visible.push(m);
  mycelRenderer.update(visible, simTime, camera);

  if (raining) {
    for (let i = 0; i < RAIN_N; i++) {
      let y = rainPos[i * 3 + 1] - realDt * 22;
      if (y < 0) y += 30;
      rainPos[i * 3 + 1] = y;
    }
    rain.position.set(god.state.target.x, 0, god.state.target.z);
    rainGeo.attributes.position.needsUpdate = true;
  }

  god.update(realDt, { focus: colony.focus(), spread: colony.spread(), heightAt: world.heightAt, portrait: W < H });
  renderer.render(scene, camera);

  uiTimer -= realDt;
  if (uiTimer <= 0) {
    uiTimer = 0.25;
    ui.setColonyCount(colony.mycel.length);
    const R = colony.resources;
    ui.setResources({ food: R.food, wood: R.wood, stone: R.stone, tools: colony.countTool('axe') + colony.countTool('spear') });
    ui.setStatus(`${timeLabel(colony.phase)} · ${colony.plan.goal}`);
  }
  moodTimer -= realDt;
  if (moodTimer <= 0 && audio.running) {
    moodTimer = 1;
    audio.setMood(colony.groupMood());
    audio.setColony(colony.mycel.length);
    audio.setDaylight(daylight);
    audio.setStory({ day: state.day, awareness: colony.awareness });
    audio.setFire(world.fire.level * nearness(world.fire));
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Keyboard (desktop)
// ---------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (ui.titleVisible()) { ui.dismissTitle(); return; }
  const k = e.key.toLowerCase();
  if (k === 'h') ui.toggleClean();
  else if (k === 'v') setVerticalMode(!vertical);
  else if (k === 's') setSpeed((speedIdx + 1) % SPEEDS.length);
  else if (k === 'c') { god.setAuto(!god.auto); ui.setAutoCam(god.auto); }
  else if (k === 'd') { if (ui.toggleDiary()) ui.renderDiary(state); }
});

// Debug / test hooks (console)
window.mycel = {
  get colony() { return colony; }, get state() { return state; }, world, god, audio, renderer,
  setSpeed, startGame, creator: (act, text) => creatorAction(act, text),
  /** fast-forward N simulated seconds without rendering (tests) */
  skip(seconds) { const n = Math.ceil(seconds / 0.05); for (let i = 0; i < n; i++) { simulate(0.05); world.update(0.05, simTime, camera); } },
  dayLength: DAY_SECONDS,
};
