// ui.js — HTML overlay: day counter, status, thought bubble, labels, banner, diary,
// settings panel, end-of-day card, toast and the "Hide UI" recording mode.
// All dynamic text is set with textContent (never innerHTML).

const $ = (id) => document.getElementById(id);
const el = {};
const labels = {};
let typeToken = 0;

export function init(h) {
  Object.assign(el, {
    app: $('app'), stage: $('stage'),
    dayCounter: $('day-counter'), dayNum: $('day-num'), status: $('status'),
    brainPill: $('brain-pill'), brainLabel: $('brain-label'),
    bubble: $('bubble'), labels: $('labels'), banner: $('banner'),
    start: $('btn-start'), vertical: $('btn-vertical'),
    diary: $('diary'), diaryList: $('diary-list'),
    settings: $('settings'), keyInput: $('key-input'), keyStatus: $('key-status'),
    modelSelect: $('model-select'), memorySummary: $('memory-summary'), importFile: $('import-file'),
    daycard: $('daycard'), daycardTitle: $('daycard-title'), daycardText: $('daycard-text'),
    toast: $('toast'),
  });
  el.bubbleMeta = el.bubble.querySelector('.bubble-meta');
  el.bubbleText = el.bubble.querySelector('.bubble-text');
  el.bannerTitle = el.banner.querySelector('.banner-title');
  el.bannerSub = el.banner.querySelector('.banner-sub');

  el.start.addEventListener('click', h.onStart);
  el.vertical.addEventListener('click', h.onToggleVertical);
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

  // Sound
  const vol = $('volume-range');
  vol.addEventListener('input', () => h.onVolume(Number(vol.value) / 100));
  $('btn-mute').addEventListener('click', h.onMuteToggle);
  for (const b of document.querySelectorAll('[data-sound]')) b.addEventListener('click', () => h.onSoundTest(b.dataset.sound));
  const colony = $('colony-range');
  colony.addEventListener('input', () => { $('colony-value').textContent = colony.value; h.onSoundTest('colony', Number(colony.value)); });
  const aware = $('awareness-range');
  aware.addEventListener('input', () => { $('awareness-value').textContent = `${aware.value}%`; h.onSoundTest('awareness', Number(aware.value) / 100); });

  $('btn-copy').addEventListener('click', h.onCopyCaption);
  $('btn-daycard-close').addEventListener('click', () => hideDayCard());
  el.daycard.addEventListener('click', (e) => { if (e.target === el.daycard || isClean()) hideDayCard(); });
}

// ---------- HUD ----------
export function setDay(n, animate = true) {
  el.dayNum.textContent = String(n);
  if (animate) {
    el.dayCounter.classList.remove('pop');
    void el.dayCounter.offsetWidth;
    el.dayCounter.classList.add('pop');
  }
}
export function setStatus(text) { el.status.textContent = text; }
export function setStartEnabled(enabled, label) {
  el.start.disabled = !enabled;
  if (label) el.start.textContent = label;
}
export function setBrainStatus({ mode, reason }) {
  el.brainPill.classList.toggle('gemini', mode === 'gemini');
  el.brainPill.classList.toggle('fallback', mode !== 'gemini');
  el.brainLabel.textContent = mode === 'gemini' ? 'Gemini brain' : reason && reason !== 'No API key' ? 'Built-in brain (Gemini offline)' : 'Built-in brain';
  el.brainPill.title = reason || '';
}
export function setVertical(on) {
  el.app.classList.toggle('vertical', on);
  el.vertical.textContent = on ? '16:9' : '9:16';
}

// ---------- Recording mode ----------
export const isClean = () => el.app.classList.contains('clean');
export function setClean(on) {
  el.app.classList.toggle('clean', on);
  if (on) { toggleDiary(false); toggleSettings(false); toast('UI hidden · tap the top-right corner to show it'); }
}
export const toggleClean = () => setClean(!isClean());

let toastTimer = 0;
export function toast(text, ms = 2200) {
  el.toast.textContent = text;
  el.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('visible'), ms);
}

// ---------- Thought bubble ----------
/** Types the text out. Resolves when fully typed. */
export function showThought(text, meta = '') {
  const token = ++typeToken;
  el.bubbleMeta.textContent = meta;
  el.bubbleMeta.hidden = !meta;
  const typed = document.createElement('span');
  const ghost = document.createElement('span'); // reserves final size so the bubble doesn't jump
  ghost.className = 'ghost';
  ghost.textContent = text;
  el.bubbleText.replaceChildren(typed, ghost);
  el.bubble.classList.add('visible');

  const chars = [...text];
  let i = 0;
  return new Promise((resolve) => {
    const tick = () => {
      if (token !== typeToken) return resolve();
      i++;
      typed.textContent = chars.slice(0, i).join('');
      ghost.textContent = chars.slice(i).join('');
      if (i >= chars.length) return resolve();
      const c = chars[i - 1];
      setTimeout(tick, '.!?…'.includes(c) ? 220 : c === ',' ? 120 : 30);
    };
    setTimeout(tick, 250);
  });
}
export function hideThought() {
  typeToken++;
  el.bubble.classList.remove('visible');
}

/** Anchor the bubble's tail at stage pixel (x, y). */
export function positionBubble(x, y) {
  const W = el.stage.clientWidth;
  const bw = el.bubble.offsetWidth;
  const bh = el.bubble.offsetHeight;
  const gap = Math.min(W, el.stage.clientHeight) * 0.06;
  const margin = 10;
  const left = Math.max(margin, Math.min(W - bw - margin, x - bw / 2));
  const hud = $('hud-top');
  const minTop = hud ? hud.offsetTop + hud.offsetHeight + margin : margin;
  const top = Math.max(minTop, y - bh - gap);
  el.bubble.style.left = `${left}px`;
  el.bubble.style.top = `${top}px`;
  el.bubble.style.setProperty('--tail-x', `${Math.max(20, Math.min(bw - 20, x - left))}px`);
}

// ---------- Location labels ----------
export function createLabels(locations) {
  el.labels.replaceChildren();
  for (const [id, loc] of Object.entries(locations)) {
    const d = document.createElement('div');
    d.className = 'label';
    d.textContent = `${loc.emoji} ${loc.name}`;
    el.labels.appendChild(d);
    labels[id] = d;
  }
}
export function positionLabel(id, x, y, visible = true) {
  const d = labels[id];
  if (!d) return;
  d.classList.toggle('offscreen', !visible);
  const half = d.offsetWidth / 2 + 6;
  const cx = Math.max(half, Math.min(el.stage.clientWidth - half, x));
  d.style.transform = `translate(${cx}px, ${y}px) translate(-50%, -100%)`;
}
export function setActiveLabel(id) {
  for (const [k, d] of Object.entries(labels)) d.classList.toggle('active', k === id);
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
let dayCardResolve = null;
/** Shows the diary of the day; resolves when closed. */
export function showDayCard(day, text) {
  el.daycardTitle.textContent = `DAY ${day}`;
  el.daycardText.textContent = text;
  el.daycard.classList.remove('hidden');
  return new Promise((r) => { dayCardResolve = r; });
}
export function hideDayCard() {
  el.daycard.classList.add('hidden');
  if (dayCardResolve) { const r = dayCardResolve; dayCardResolve = null; r(); }
}

// ---------- Sound settings ----------
export function setSoundState({ volume, muted, running, available }) {
  $('volume-range').value = String(Math.round(volume * 100));
  $('volume-value').textContent = muted ? '(muted)' : `${Math.round(volume * 100)}%`;
  const b = $('btn-mute');
  b.textContent = muted ? 'Unmute' : 'Mute';
  b.classList.toggle('on', muted);
  $('sound-status').textContent = !available
    ? 'This browser has no Web Audio.'
    : running ? 'Sound is on. iPhone screen recordings include it.' : 'Sound starts with your first tap.';
}

// ---------- Panels ----------
export function toggleDiary(force) {
  const open = force ?? el.diary.classList.contains('hidden');
  el.diary.classList.toggle('hidden', !open);
  if (open) toggleSettings(false);
  return open;
}
export function toggleSettings(force) {
  const open = force ?? el.settings.classList.contains('hidden');
  el.settings.classList.toggle('hidden', !open);
  if (open) el.diary.classList.add('hidden');
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

export function renderDiary(state, locations) {
  el.diaryList.replaceChildren();
  const days = new Set([...state.diary.map((e) => e.day), ...state.diaryEntries.map((d) => d.day)]);
  if (!days.size) {
    const p = document.createElement('div');
    p.className = 'diary-empty';
    p.textContent = 'Nothing yet. Press “Start Day” and the being will begin to explore.';
    el.diaryList.appendChild(p);
    return;
  }
  for (const day of [...days].sort((a, b) => b - a)) {
    const sec = document.createElement('section');
    sec.className = 'diary-day';
    const h = document.createElement('h3');
    h.textContent = `Day ${day}`;
    sec.appendChild(h);
    const summary = state.diaryEntries.find((d) => d.day === day);
    if (summary) {
      const s = document.createElement('div');
      s.className = 'diary-summary';
      s.textContent = summary.text;
      sec.appendChild(s);
    }
    for (const e of state.diary.filter((x) => x.day === day)) {
      const loc = locations[e.location];
      const card = document.createElement('div');
      card.className = 'diary-entry';
      const where = document.createElement('div');
      where.className = 'where';
      where.textContent = loc ? `${loc.emoji} ${loc.name}` : e.location;
      const text = document.createElement('div');
      text.textContent = e.thought;
      card.append(where, text);
      if (e.reading || e.takeaway) {
        const r = document.createElement('div');
        r.className = 'read';
        r.textContent = e.reading ? `Read “${e.reading.title}”${e.takeaway ? ` · learned: ${e.takeaway}` : ''}` : `Noticed: ${e.takeaway}`;
        card.appendChild(r);
      }
      sec.appendChild(card);
    }
    el.diaryList.appendChild(sec);
  }
}
