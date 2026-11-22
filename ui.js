// ui.js — HTML overlay: day counter, status, thought bubble, labels, banner, diary.

const $ = (id) => document.getElementById(id);
const el = {};
const labels = {};
let typeToken = 0;

export function init({ onStart, onToggleVertical, onDiary, onReset }) {
  Object.assign(el, {
    app: $('app'),
    stage: $('stage'),
    dayCounter: $('day-counter'),
    dayNum: $('day-num'),
    status: $('status'),
    bubble: $('bubble'),
    labels: $('labels'),
    banner: $('banner'),
    start: $('btn-start'),
    vertical: $('btn-vertical'),
    diary: $('diary'),
    diaryList: $('diary-list'),
  });
  el.bubbleMeta = el.bubble.querySelector('.bubble-meta');
  el.bubbleText = el.bubble.querySelector('.bubble-text');
  el.bannerTitle = el.banner.querySelector('.banner-title');
  el.bannerSub = el.banner.querySelector('.banner-sub');

  el.start.addEventListener('click', onStart);
  el.vertical.addEventListener('click', onToggleVertical);
  $('btn-diary').addEventListener('click', onDiary);
  $('btn-diary-close').addEventListener('click', () => toggleDiary(false));
  $('btn-reset').addEventListener('click', onReset);
}

// ---------- HUD ----------
export function setDay(n, animate = true) {
  el.dayNum.textContent = String(n);
  if (animate) {
    el.dayCounter.classList.remove('pop');
    void el.dayCounter.offsetWidth; // restart animation
    el.dayCounter.classList.add('pop');
  }
}

export function setStatus(text) {
  el.status.textContent = text;
}

export function setStartEnabled(enabled, label) {
  el.start.disabled = !enabled;
  if (label) el.start.textContent = label;
}

export function setVertical(on) {
  el.app.classList.toggle('vertical', on);
  el.vertical.textContent = on ? '16:9' : '9:16';
}

export function toggleClean() {
  el.app.classList.toggle('clean');
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
  const top = Math.max(margin, y - bh - gap);
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

export function positionLabel(id, x, y) {
  const d = labels[id];
  if (!d) return;
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

// ---------- Diary ----------
export function toggleDiary(force) {
  const open = force ?? el.diary.classList.contains('hidden');
  el.diary.classList.toggle('hidden', !open);
  return open;
}

export function renderDiary(diary, locations) {
  el.diaryList.replaceChildren();
  if (!diary.length) {
    const p = document.createElement('div');
    p.className = 'diary-empty';
    p.textContent = 'Nothing yet. Press “Start Day” and the being will begin to explore.';
    el.diaryList.appendChild(p);
    return;
  }
  const byDay = new Map();
  for (const e of diary) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  for (const day of [...byDay.keys()].sort((a, b) => b - a)) {
    const sec = document.createElement('section');
    sec.className = 'diary-day';
    const h = document.createElement('h3');
    h.textContent = `Day ${day}`;
    sec.appendChild(h);
    for (const e of byDay.get(day)) {
      const loc = locations[e.location];
      const card = document.createElement('div');
      card.className = 'diary-entry';
      const where = document.createElement('div');
      where.className = 'where';
      where.textContent = loc ? `${loc.emoji} ${loc.name}` : e.location;
      const text = document.createElement('div');
      text.textContent = e.thought;
      card.append(where, text);
      if (e.reading) {
        const r = document.createElement('div');
        r.className = 'read';
        r.textContent = `Read “${e.reading.title}”${e.reading.excerpt ? `: ${e.reading.excerpt}` : ''}`;
        card.appendChild(r);
      }
      sec.appendChild(card);
    }
    el.diaryList.appendChild(sec);
  }
}
