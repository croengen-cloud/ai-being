// ui.js — HTML overlay: counters, status, stores, colony thoughts, event feed, banner,
// creator sheet, diary + settings panels, end-of-day card, title screen, Hide UI.
// All dynamic text is set with textContent (never innerHTML).
import { iconDataUrl } from './icons.js';

const $ = (id) => document.getElementById(id);
const el = {};

export function init(h) {
  Object.assign(el, {
    app: $('app'), stage: $('stage'),
    dayCounter: $('day-counter'), dayNum: $('day-num'), colonyCounter: $('colony-counter'), colonyNum: $('colony-num'),
    status: $('status'), brainPill: $('brain-pill'), brainLabel: $('brain-label'), resBar: $('res-bar'),
    thought: $('thought'), feed: $('feed'), banner: $('banner'),
    vertical: $('btn-vertical'), speed: $('btn-speed'), autocam: $('btn-autocam'),
    creator: $('creator'), messageForm: $('message-form'), messageInput: $('message-input'),
    diary: $('diary'), diaryList: $('diary-list'),
    settings: $('settings'), keyInput: $('key-input'), keyStatus: $('key-status'),
    modelSelect: $('model-select'), memorySummary: $('memory-summary'), importFile: $('import-file'),
    daycard: $('daycard'), daycardTitle: $('daycard-title'), daycardSub: $('daycard-sub'), daycardText: $('daycard-text'),
    toast: $('toast'), title: $('title-screen'),
  });
  el.drama = $('drama'); el.inspect = $('inspect'); el.factionPick = $('faction-pick');
  $('btn-inspect-close').addEventListener('click', () => { hideInspect(); h.onInspectClose?.(); });
  el.thoughtWho = el.thought.querySelector('.thought-who');
  el.thoughtText = el.thought.querySelector('.thought-text');
  el.bannerTitle = el.banner.querySelector('.banner-title');
  el.bannerSub = el.banner.querySelector('.banner-sub');

  // pixel icons in buttons / store bar
  for (const img of document.querySelectorAll('img[data-icon]')) img.src = iconDataUrl(img.dataset.icon);
  el.res = {};
  for (const [key, icon] of [['food', 'berry'], ['wood', 'wood'], ['stone', 'stone'], ['tools', 'axe']]) {
    const d = document.createElement('div');
    d.className = 'res';
    const img = document.createElement('img'); img.src = iconDataUrl(icon); img.alt = key;
    const v = document.createElement('span'); v.textContent = '0';
    d.append(img, v);
    el.resBar.appendChild(d);
    el.res[key] = { box: d, v };
  }

  el.vertical.addEventListener('click', h.onToggleVertical);
  el.speed.addEventListener('click', h.onSpeed);
  el.autocam.addEventListener('click', h.onAutoCam);
  $('btn-creator').addEventListener('click', () => toggleCreator(true));
  $('btn-creator-close').addEventListener('click', () => toggleCreator(false));
  for (const b of document.querySelectorAll('[data-act]')) {
    b.addEventListener('click', () => {
      if (b.dataset.act === 'message') { el.messageForm.classList.remove('hidden'); el.messageInput.focus(); return; }
      if (b.dataset.act === 'gift') { showFactionPicker(h.getFactions?.() ?? [], (id) => h.onCreator('gift', id)); return; }
      h.onCreator(b.dataset.act);
    });
  }
  el.messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.messageInput.value.trim();
    if (!text) return;
    el.messageInput.value = '';
    el.messageForm.classList.add('hidden');
    toggleCreator(false);
    h.onCreator('message', text);
  });
  $('btn-message-cancel').addEventListener('click', () => el.messageForm.classList.add('hidden'));

  $('btn-diary').addEventListener('click', h.onDiary);
  $('btn-diary-close').addEventListener('click', () => toggleDiary(false));
  $('btn-settings').addEventListener('click', () => toggleSettings(true));
  $('btn-settings-close').addEventListener('click', () => toggleSettings(false));
  $('btn-hide').addEventListener('click', () => setClean(true));
  $('unhide').addEventListener('click', () => setClean(false));

  $('btn-key-save').addEventListener('click', () => {
    const v = el.keyInput.value.trim();
    if (!v) { setKeyStatus('Paste a key first.', 'err'); return; }
    h.onSaveKey(v);
    el.keyInput.value = '';
  });
  el.keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-key-save').click(); });
  $('btn-key-test').addEventListener('click', h.onTestKey);
  $('btn-key-clear').addEventListener('click', h.onClearKey);
  el.modelSelect.addEventListener('change', () => h.onModel(el.modelSelect.value));
  $('btn-export').addEventListener('click', h.onExport);
  $('btn-import').addEventListener('click', () => el.importFile.click());
  el.importFile.addEventListener('change', async () => {
    const f = el.importFile.files?.[0];
    el.importFile.value = '';
    if (f) h.onImport(await f.text());
  });
  $('btn-reset').addEventListener('click', h.onReset);
  const vol = $('volume-range');
  vol.addEventListener('input', () => h.onVolume(Number(vol.value) / 100));
  $('btn-mute').addEventListener('click', h.onMuteToggle);

  $('btn-copy').addEventListener('click', h.onCopyCaption);
  $('btn-daycard-close').addEventListener('click', () => hideDayCard());
  el.daycard.addEventListener('click', (e) => { if (e.target === el.daycard || isClean()) hideDayCard(); });
  el.title.addEventListener('click', () => { el.title.classList.add('gone'); h.onTitleDismissed?.(); });
}

// ---------- HUD ----------
export function setDay(n, animate = true) {
  el.dayNum.textContent = String(n);
  if (animate) { el.dayCounter.classList.remove('pop'); void el.dayCounter.offsetWidth; el.dayCounter.classList.add('pop'); }
}
let lastColony = -1;
export function setColonyCount(n) {
  if (n === lastColony) return;
  const grew = lastColony >= 0 && n > lastColony;
  lastColony = n;
  el.colonyNum.textContent = String(n);
  if (grew) { el.colonyCounter.classList.remove('bump'); void el.colonyCounter.offsetWidth; el.colonyCounter.classList.add('bump'); }
}
export function setStatus(text) { if (el.status.textContent !== text) el.status.textContent = text; }
const lastRes = {};
export function setResources(r) {
  for (const k of ['food', 'wood', 'stone', 'tools']) {
    const v = String(r[k] ?? 0);
    if (lastRes[k] === v) continue;
    const up = lastRes[k] !== undefined && Number(v) > Number(lastRes[k]);
    lastRes[k] = v;
    el.res[k].v.textContent = v;
    if (up) { el.res[k].box.classList.remove('flash'); void el.res[k].box.offsetWidth; el.res[k].box.classList.add('flash'); }
  }
}
export function setBrainStatus({ mode, reason }) {
  el.brainPill.classList.toggle('gemini', mode === 'gemini');
  el.brainPill.classList.toggle('fallback', mode !== 'gemini');
  el.brainLabel.textContent = mode === 'gemini' ? 'Gemini hive mind' : reason && reason !== 'No API key' ? 'Instincts (Gemini offline)' : 'Instincts (no Gemini key)';
  el.brainPill.title = reason || '';
}
export function setVertical(on) {
  el.app.classList.toggle('vertical', on);
  el.vertical.textContent = on ? '16:9' : '9:16';
}
export function setSpeedLabel(t) { el.speed.textContent = t; }
export function setAutoCam(on) { el.autocam.classList.toggle('on', on); el.autocam.textContent = on ? 'Auto-cam' : 'Free cam'; }
export const titleVisible = () => !el.title.classList.contains('gone');
export function dismissTitle() { el.title.click(); }

// ---------- Recording mode ----------
export const isClean = () => el.app.classList.contains('clean');
export function setClean(on) {
  el.app.classList.toggle('clean', on);
  if (on) { toggleDiary(false); toggleSettings(false); toggleCreator(false); toast('UI hidden · tap the top-right corner to show it'); }
}
export const toggleClean = () => setClean(!isClean());

let toastTimer = 0;
export function toast(text, ms = 2200) {
  el.toast.textContent = text;
  el.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('visible'), ms);
}

// ---------- Colony thought / Watcher ----------
let thoughtTimer = 0;
export function showThought(who, text, { watcher = false, ms = 6500 } = {}) {
  el.thoughtWho.textContent = who;
  el.thoughtText.textContent = text;
  el.thought.classList.toggle('watcher', watcher);
  el.thought.classList.add('visible');
  clearTimeout(thoughtTimer);
  thoughtTimer = setTimeout(() => el.thought.classList.remove('visible'), ms);
}

// ---------- Event feed ----------
export function feed(text, kind = '') {
  const d = document.createElement('div');
  d.className = `feed-item ${kind}`;
  d.textContent = text;
  el.feed.appendChild(d);
  while (el.feed.children.length > 4) el.feed.firstChild.remove();
  setTimeout(() => d.classList.add('old'), 6000);
  setTimeout(() => d.remove(), 7000);
}

// ---------- Banner ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function showBanner(title, sub = '', ms = 1800) {
  el.bannerTitle.textContent = title;
  el.bannerSub.textContent = sub;
  el.banner.classList.add('visible');
  await wait(ms);
  el.banner.classList.remove('visible');
  await wait(450);
}

// ---------- End-of-day card ----------
let dayCardResolve = null, dayCardTimer = 0;
export function showDayCard(day, text, sub, autoMs = 14000) {
  el.daycardTitle.textContent = `DAY ${day}`;
  el.daycardSub.textContent = sub;
  el.daycardText.textContent = text;
  el.daycard.classList.remove('hidden');
  clearTimeout(dayCardTimer);
  dayCardTimer = setTimeout(hideDayCard, autoMs);
  return new Promise((r) => { dayCardResolve = r; });
}
export function hideDayCard() {
  el.daycard.classList.add('hidden');
  clearTimeout(dayCardTimer);
  if (dayCardResolve) { const r = dayCardResolve; dayCardResolve = null; r(); }
}
export const dayCardOpen = () => !el.daycard.classList.contains('hidden');

// ---------- Panels ----------
export function toggleDiary(force) {
  const open = force ?? el.diary.classList.contains('hidden');
  el.diary.classList.toggle('hidden', !open);
  if (open) { el.settings.classList.add('hidden'); el.creator.classList.add('hidden'); }
  return open;
}
export function toggleSettings(force) {
  const open = force ?? el.settings.classList.contains('hidden');
  el.settings.classList.toggle('hidden', !open);
  if (open) { el.diary.classList.add('hidden'); el.creator.classList.add('hidden'); }
  return open;
}
export function toggleCreator(force) {
  const open = force ?? el.creator.classList.contains('hidden');
  el.creator.classList.toggle('hidden', !open);
  if (!open) { el.messageForm.classList.add('hidden'); el.factionPick?.classList.add('hidden'); }
  if (open) { el.diary.classList.add('hidden'); el.settings.classList.add('hidden'); }
  return open;
}

export function fillModels(models, current) {
  el.modelSelect.replaceChildren(...models.map((m) => {
    const o = document.createElement('option');
    o.value = m.id; o.textContent = m.label; o.selected = m.id === current;
    return o;
  }));
}
export function setKeyField(hasKey) {
  el.keyInput.value = '';
  el.keyInput.placeholder = hasKey ? 'Key saved on this device (hidden)' : 'Paste key…';
}
export function setKeyStatus(text, kind = '') {
  el.keyStatus.textContent = text;
  el.keyStatus.className = `note ${kind}`;
}
export function setMemorySummary(text) { el.memorySummary.textContent = text; }
export function setSoundState({ volume, muted, running, available }) {
  $('volume-range').value = String(Math.round(volume * 100));
  $('volume-value').textContent = muted ? '(muted)' : `${Math.round(volume * 100)}%`;
  const b = $('btn-mute');
  b.textContent = muted ? 'Unmute' : 'Mute';
  b.classList.toggle('on', muted);
  $('sound-status').textContent = !available ? 'This browser has no Web Audio.'
    : running ? 'Sound is on. iPhone screen recordings include it.' : 'Sound starts with your first tap.';
}

export function renderDiary(state) {
  el.diaryList.replaceChildren();
  const entries = [...state.diaryEntries].sort((a, b) => b.day - a.day);
  if (!entries.length) {
    const p = document.createElement('div');
    p.className = 'diary-empty';
    p.textContent = 'Nothing yet. The Mycel write their diary at the end of each day.';
    el.diaryList.appendChild(p);
    return;
  }
  for (const d of entries) {
    const sec = document.createElement('section');
    sec.className = 'diary-day';
    const h = document.createElement('h3');
    h.textContent = d.legacy ? `Day ${d.day} (before the forest)` : `Day ${d.day} · ${d.population} Mycel`;
    const s = document.createElement('div');
    s.className = 'diary-summary';
    s.textContent = d.text;
    sec.append(h, s);
    if (d.events?.length) {
      const ul = document.createElement('ul');
      ul.className = 'diary-events';
      for (const e of d.events.slice(0, 10)) { const li = document.createElement('li'); li.textContent = e; ul.appendChild(li); }
      sec.appendChild(ul);
    }
    el.diaryList.appendChild(sec);
  }
}

// ---------- Drama line (top priority news) ----------
let dramaTimer = 0;
export function showDrama(text, tag = 'DRAMA', ms = 5200) {
  el.drama.textContent = '';
  const t = document.createElement('span'); t.className = 'tag'; t.textContent = tag;
  el.drama.append(t, document.createTextNode(text));
  el.drama.classList.remove('visible'); void el.drama.offsetWidth; el.drama.classList.add('visible');
  clearTimeout(dramaTimer);
  dramaTimer = setTimeout(() => el.drama.classList.remove('visible'), ms);
}

// ---------- Inspect card ----------
const hex = (c) => `#${(c >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
export function showInspect(info) {
  const q = (s) => el.inspect.querySelector(s);
  q('.ins-dot').style.background = hex(info.color);
  q('.ins-name').textContent = info.name;
  q('.ins-trait').textContent = info.trait;
  q('.ins-faction').textContent = info.faction ? `${info.leader ? '👑 Leads' : 'Member of'} ${info.faction}` : (info.exiled ? 'Exiled to the forest edge' : 'No faction');
  q('.ins-friends').textContent = info.friends.length ? `♥ Friends: ${info.friends.join(', ')}` : '';
  q('.ins-rivals').textContent = info.rivals.length ? `⚡ Rivals: ${info.rivals.join(', ')}` : '';
  q('.ins-doing').textContent = info.doing;
  el.inspect.classList.remove('hidden');
}
export function hideInspect() { el.inspect.classList.add('hidden'); }
export const inspectOpen = () => !el.inspect.classList.contains('hidden');

// ---------- Faction picker (creator gift) ----------
function showFactionPicker(factions, onPick) {
  const row = el.factionPick.querySelector('.fp-row');
  row.textContent = '';
  if (!factions.length) {
    const d = document.createElement('div'); d.textContent = 'No factions yet (they form at about 15 Mycel).';
    row.append(d);
  }
  for (const f of factions) {
    const b = document.createElement('button');
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = hex(f.color);
    b.append(sw, document.createTextNode(f.name));
    b.addEventListener('click', () => { el.factionPick.classList.add('hidden'); onPick(f.id); });
    row.append(b);
  }
  el.factionPick.classList.remove('hidden');
}
