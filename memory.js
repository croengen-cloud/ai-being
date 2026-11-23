// memory.js — the being's save state (localStorage), growth stages, export / import.

const SAVE_KEY = 'aiBeing.save.v1'; // storage key kept from v1; the data itself is versioned
const MAX_LEARNINGS = 500;
const MAX_ENTRIES = 2000;

/** Growth stages unlock by number of learnings. */
export const STAGES = [
  { at: 0, name: 'Sprout' },
  { at: 4, name: 'Little Cap' },
  { at: 8, name: 'Glow Spots' },
  { at: 14, name: 'Tiny Mushrooms' },
  { at: 20, name: 'True Colours' },
  { at: 28, name: 'Bloom' },
];

export function stageFor(learningCount) {
  let idx = 0;
  STAGES.forEach((s, i) => { if (learningCount >= s.at) idx = i; });
  return idx;
}

export function defaultState() {
  return {
    version: 2,
    day: 1,
    daysCompleted: 0,
    stage: 0,
    visited: {}, // location id -> count
    diary: [], // one entry per stop: { day, location, thought, mood, reading?, takeaway?, at }
    learnings: [], // { day, location, source, title, takeaway, at }
    bookmarks: {}, // "folder/file" -> next chunk index
    diaryEntries: [], // end-of-day summaries: { day, text, places, at }
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v, d = 0) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d);

/** Bring any stored / imported object into the current shape (also drops unknown fields). */
export function normalize(raw) {
  const s = defaultState();
  if (!isObj(raw)) return s;
  s.day = Math.max(1, int(raw.day, 1));
  s.daysCompleted = int(raw.daysCompleted);
  if (isObj(raw.visited)) for (const [k, v] of Object.entries(raw.visited)) s.visited[str(k, 20)] = int(v);
  if (isObj(raw.bookmarks)) for (const [k, v] of Object.entries(raw.bookmarks)) s.bookmarks[str(k, 120)] = int(v);
  if (Array.isArray(raw.diary)) {
    s.diary = raw.diary.filter(isObj).slice(-MAX_ENTRIES).map((e) => ({
      day: Math.max(1, int(e.day, 1)),
      location: str(e.location, 20),
      thought: str(e.thought),
      mood: str(e.mood, 20),
      reading: isObj(e.reading) ? { title: str(e.reading.title, 120), source: str(e.reading.source, 160), excerpt: str(e.reading.excerpt) } : null,
      takeaway: str(e.takeaway),
      at: str(e.at, 40),
    }));
  }
  if (Array.isArray(raw.learnings)) {
    s.learnings = raw.learnings.filter(isObj).slice(-MAX_LEARNINGS).map((l) => ({
      day: Math.max(1, int(l.day, 1)),
      location: str(l.location, 20),
      source: str(l.source, 160),
      title: str(l.title, 120),
      takeaway: str(l.takeaway),
      at: str(l.at, 40),
    })).filter((l) => l.takeaway);
  } else if (Number.isFinite(raw.knowledge)) {
    // v1 had a plain counter; turn past stops into simple learnings so growth carries over
    s.learnings = s.diary.filter((e) => e.location && e.location !== 'home').map((e) => ({
      day: e.day, location: e.location, source: '', title: e.reading?.title ?? '', takeaway: e.reading?.excerpt || e.thought, at: e.at,
    }));
  }
  if (Array.isArray(raw.diaryEntries)) {
    s.diaryEntries = raw.diaryEntries.filter(isObj).slice(-MAX_ENTRIES).map((d) => ({
      day: Math.max(1, int(d.day, 1)), text: str(d.text, 800), places: Array.isArray(d.places) ? d.places.map((p) => str(p, 20)).slice(0, 8) : [], at: str(d.at, 40),
    }));
  }
  s.stage = stageFor(s.learnings.length);
  return s;
}

export function loadState() {
  let s;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    s = raw ? normalize(JSON.parse(raw)) : defaultState();
  } catch {
    s = defaultState();
  }
  // A day interrupted by a reload is discarded so it can be replayed cleanly.
  for (const e of s.diary.filter((d) => d.day === s.day && d.location !== 'home')) {
    if (s.visited[e.location]) s.visited[e.location]--;
  }
  s.diary = s.diary.filter((e) => e.day !== s.day);
  s.learnings = s.learnings.filter((l) => l.day !== s.day);
  s.diaryEntries = s.diaryEntries.filter((d) => d.day !== s.day);
  s.stage = stageFor(s.learnings.length);
  return s;
}

export function saveState(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

/** Export file contents. Contains only the memory, never settings or the API key. */
export function exportState(state) {
  return JSON.stringify({ app: 'ai-being', format: 2, exportedAt: new Date().toISOString(), state }, null, 2);
}

/** Parse an export file. Throws with a readable message if it is not one of ours. */
export function importState(text) {
  if (typeof text !== 'string' || text.length > 5_000_000) throw new Error('File is too large or empty.');
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('This is not a valid JSON file.'); }
  if (!isObj(obj) || obj.app !== 'ai-being' || !isObj(obj.state)) throw new Error('This is not an AI Being memory file.');
  return normalize(obj.state);
}

/** Learning counts per location, used for the cap colour. */
export function interests(state) {
  const out = {};
  for (const l of state.learnings) out[l.location] = (out[l.location] ?? 0) + 1;
  return out;
}
