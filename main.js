// main.js — boot, render loop, day cycle, hive mind calls, creator actions, UI wiring.
import * as THREE from './vendor/three.module.js';
import { createForest } from './forest.js';
import { loadModelLibrary } from './assets.js';
import { createLife, createPost, createQuality } from './effects.js';
import { DRAMA_TYPES } from './social.js';
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

const lib = await loadModelLibrary();
const world = await createForest(lib, { shadowSize: isTouch ? 1024 : 2048 });
const scene = world.scene;
const mycelRenderer = createMycelRenderer(scene);
const god = createGodCamera(canvas, { onUserInput: () => { if (god.auto) ui.setAutoCam(true); }, onTap: (x, y) => pickMycel(x, y) });
const camera = god.camera;
const life = createLife(scene, { firePos: world.fire, heightAt: world.heightAt, clearingR: 24, flowerSpots: world.flowerSpots });
const post = createPost(renderer, scene, camera);
const BASE_PR = Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2);
let pixelRatio = BASE_PR;
// Adaptive quality: bloom off first, then smaller shadows, then fewer pixels.
const quality = createQuality([
  { bloom: true, shadow: isTouch ? 1024 : 2048, pr: BASE_PR },
  { bloom: false, shadow: isTouch ? 1024 : 2048, pr: BASE_PR },
  { bloom: false, shadow: 1024, pr: Math.min(BASE_PR, 1.25) },
  { bloom: false, shadow: 512, pr: 1 },
  { bloom: false, shadow: 512, pr: 0.8 },
], (q) => {
  post.setBloom(q.bloom);
  world.setShadowSize(q.shadow);
  if (q.pr !== pixelRatio) { pixelRatio = q.pr; layout?.(); }
});

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
    onCaption: (item) => ui.caption(item),
    onMilestone: (ms) => {
      ui.showMilestone(ms);
      audio.milestone();
      ui.setIQ(colony.progress.iq, true);
      ui.setEmotions(colony.progress.emotionCount);
      mycelRenderer.setExpressiveness(colony.progress.expressiveness);
    },
    onCrisis: (kind) => { if (kind === 'storm') { setRain(true); colony.later(colony.dayLength * 0.12, () => setRain(false)); } },
  });
  colony.day = state.day;
  colony.dayLength = DAY_SECONDS;
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
  else if (name === 'shove' || name === 'poke' || name === 'bonk') audio.sfx(name, g);
  else audio.sfx(name, g);
}
function unlockAudio() { audio.unlock(); }
for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlockAudio, { capture: true, passive: true });
const refreshSound = () => ui.setSoundState({ volume: audio.volume, muted: audio.muted, running: audio.running, available: !!(window.AudioContext || window.webkitAudioContext) });
audio.onChange(refreshSound);

// ---------------------------------------------------------------------------
// Events -> feed, diary log, thoughts
// ---------------------------------------------------------------------------
function handleEvent(e) {
  // the director decides what is shown; here we only keep the day's story for diary and caption
  if (e.drama || DRAMA_TYPES.has(e.type)) state.dramaToday = [...(state.dramaToday ?? []), e.text].slice(-12);
  if (['plotFound', 'coup', 'betrayal'].includes(e.type)) audio.sfx(e.type, nearness(e));
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
  getFactions: () => colony.social.factions.map((f) => ({ id: f.id, name: f.name, color: f.color })),
  onInspectClose: () => { inspected = null; god.state.follow = null; document.getElementById('app').classList.remove('inspecting'); },
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
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(W, H, false);
  post.setSize(W, H, pixelRatio);
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
  colony.social.morning(Array.isArray(plan.revealPlots) ? plan.revealPlots.filter((id) => id !== 'none') : null);
  if (plan.event === 'berry boom') colony.creator('berries');
  if (plan.event === 'storm') setRain(true);
  if (plan.event === 'great discovery') colony.progress.addIQ(1);
  if (plan.thought) colony.director.say(plan.thought, 'thought', 1);
  if (plan.watcherMessage && colony.progress.has('watcher')) {
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
  ui.setIQ(colony.progress.iq); ui.setEmotions(colony.progress.emotionCount);
  morningPlan();
}

let dayEnding = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** End of day: freeze the sim, end card (DAY N COMPLETE · IQ · MYCEL + cliffhanger), then the next morning. */
async function endDay() {
  if (dayEnding) return;
  dayEnding = true;
  const finished = state.day;
  const summary = { ...hiveSummary(), day: finished, drama: state.dramaToday ?? [] };
  state.dramaToday = [];
  const fast = !!window.mycel?.fastEnd;
  const diaryP = brain.writeDiary(summary).catch(() => null);
  const early = await Promise.race([diaryP, sleep(fast ? 0 : 4500).then(() => null)]);
  const cliff = early?.cliffhanger || brain.fallbackCliffhanger(summary);
  ui.caption(null);
  const card = ui.showEndCard(finished, `IQ ${Math.round(colony.progress.iq)} · ${colony.mycel.length} MYCEL`, cliff, fast ? 50 : 6000);
  audio.sfx('exile', 0.5);
  await card;

  colony.startDay(finished + 1, null);
  state.day = finished + 1;
  state.colony = colony.serialize();
  saveState(state);
  ui.setDay(state.day);
  ui.showBanner(`DAY ${state.day}`, `${colony.mycel.length} Mycel wake up`, fast ? 10 : 1500);
  dayEnding = false;
  morningPlan();

  const res = early ?? await diaryP;
  refreshBrainPill();
  const text = res?.text || brain.fallbackDiary(summary);
  state.diaryEntries.push({ day: finished, text, cliffhanger: cliff, events: summary.events, population: summary.population, iq: Math.round(summary.progress?.iq ?? 0), at: new Date().toISOString() });
  saveState(state);
  const ms = summary.progress?.milestonesToday ?? [];
  lastCaption = `🍄 THE MYCEL · Day ${finished} · IQ ${Math.round(colony.progress.iq)} · ${summary.population} Mycel\n${ms.length ? `${ms.join(' · ')}\n` : ''}${text}\n${cliff}\n#themycel #mycel #aibrain #indiedev`;
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
function pickMycel(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const v = new THREE.Vector3();
  let best = null, bd = 40 * 40;
  for (const m of colony.mycel) {
    v.set(m.x, m.y + 0.9, m.z).project(camera);
    if (v.z > 1) continue;
    const sx = r.left + (v.x * 0.5 + 0.5) * r.width, sy = r.top + (-v.y * 0.5 + 0.5) * r.height;
    const d = (sx - cx) ** 2 + (sy - cy) ** 2;
    if (d < bd) { bd = d; best = m; }
  }
  if (!best) { if (inspected) { inspected = null; ui.hideInspect(); document.getElementById('app').classList.remove('inspecting'); } return; }
  inspected = best;
  god.follow(best, Math.min(god.state.want.dist, 9));
  refreshInspect();
}
let inspected = null;
const TASK_TEXT = { gather: 'gathering', chop: 'chopping wood', eat: 'eating', rest: 'resting', sleep: 'sleeping', build: 'building', craft: 'crafting', lightFire: 'lighting the fire', feedFire: 'feeding the fire', explore: 'exploring', follow: 'following', flee: 'fleeing', defend: 'defending', spore: 'spreading spores', love: 'in love', scuffle: 'in a scuffle!', exiled: 'wandering the forest edge', huddle: 'whispering in the dark…', steal: 'sneaking around…', sabotage: 'up to something…', repair: 'repairing a hut' };
function refreshInspect() {
  const m = inspected;
  if (!m || !colony.mycel.includes(m)) { inspected = null; ui.hideInspect(); return; }
  document.getElementById('app').classList.add('inspecting');
  const S = colony.social, f = S.factionOf(m);
  ui.showInspect({
    name: m.name, color: m.color, trait: m.trait, exiled: m.exiled,
    faction: f?.name, leader: f?.leader === m.name,
    friends: S.friendsOf(m).slice(0, 4).map((o) => o.name),
    rivals: S.rivalsOf(m).slice(0, 4).map((o) => o.name),
    doing: `Now: ${TASK_TEXT[m.task?.type] ?? 'thinking'}${m.injured > 0.15 ? ' · injured' : ''}`,
  });
}
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
      colony.director.say(`${m?.name ?? 'A Mycel'} read “${r.title}”: ${r.thought}`, 'learn', 1, m);
      audio.chirp('curious');
    }
    log(CREATOR_TEXT.knowledge);
  } else if (act === 'reveal') {
    const ok = colony.social.revealAny();
    if (!ok) ui.toast('No secret plots right now.');
    else log('The Watcher revealed a secret plot.');
  } else if (act === 'rumor') {
    const pair = colony.social.rumor();
    if (!pair) ui.toast('Too few Mycel for gossip.');
    else log(`The Watcher started a rumor between ${pair[0].name} and ${pair[1].name}.`);
  } else if (act === 'gift') {
    const f = colony.social.gift(text);
    if (!f) ui.toast('No factions yet.');
    else log(`The Watcher gave a gift to the ${f.name}.`);
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
  if (dayEnding) return;
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
  const cp = camera.position, fol = god.state.follow;
  for (const m of colony.mycel) {
    if (m.hidden) continue;
    // never let a Mycel fill the lens in close-ups
    if (m !== fol && (m.x - cp.x) ** 2 + (m.z - cp.z) ** 2 < 2.6 && cp.y < 4) continue;
    visible.push(m);
  }
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
  const gs = god.state;
  world.setShadowFocus(gs.target.x, gs.target.z, gs.dist * 0.75 + 6);
  life.update(realDt, simTime, { daylight, fireLevel: world.fire.level, wind: raining ? 1.8 : 1 });
  // fog follows zoom: crisp overview from far away, depth haze when close
  scene.fog.near = 30 + gs.dist * 0.9; scene.fog.far = 110 + gs.dist * 1.8;
  post.render();
  quality.tick(realDt);

  uiTimer -= realDt;
  if (uiTimer <= 0) {
    uiTimer = 0.25;
    ui.setColonyCount(colony.mycel.length);
    ui.setIQ(colony.progress.iq);
    ui.setEmotions(colony.progress.emotionCount);
    mycelRenderer.setExpressiveness(colony.progress.expressiveness);
    const R = colony.resources;
    ui.setResources({ food: R.food, wood: R.wood, stone: R.stone, tools: colony.countTool('axe') + colony.countTool('spear') });
    ui.setStatus(`${timeLabel(colony.phase)} · ${colony.plan.goal}`);
    if (inspected) refreshInspect();
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
  get colony() { return colony; }, get state() { return state; }, world, god, audio, renderer, quality, post, life, lib,
  inspect: (m) => { inspected = m; god.follow(m, 6); refreshInspect(); },
  screenPos(m) { const r = canvas.getBoundingClientRect(); const v = new THREE.Vector3(m.x, m.y + 0.9, m.z).project(camera); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; },
  setSpeed, startGame, creator: (act, text) => creatorAction(act, text),
  /** fast-forward N simulated seconds without rendering (tests) */
  skip(seconds) { const n = Math.ceil(seconds / 0.05); for (let i = 0; i < n; i++) { simulate(0.05); world.update(0.05, simTime, camera); } },
  dayLength: DAY_SECONDS,
};
