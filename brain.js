// brain.js — the hive mind of the Mycel.
//
// With a Gemini API key (Settings) the colony thinks with Google Gemini, called directly from the
// browser: ONE call each morning sets the colony's goal, priorities and big events; one call in
// the evening writes the diary. Individual Mycel act on simple rules (colony.js).
// Without a key, or on any error (quota, timeout, bad JSON), rule-based fallbacks take over.
//
// Public API (all async, all always resolve):
//   planDay(summary)          -> { goal, priorities, event, thought, watcherMessage }
//   writeDiary(summary)       -> string (2–3 sentences)
//   read(location, state)     -> knowledge gift: { title, source, chunk, takeaway, thought, mood, ... }
//   testKey()                 -> { ok, message }
//   brainStatus()             -> { mode: 'gemini'|'fallback', reason }
import { getApiKey, getModel, hasApiKey } from './settings.js';

export const EMOTIONS = ['neutral', 'happy', 'curious', 'scared', 'angry', 'sad', 'hungry', 'love'];
export const EVENTS = ['none', 'berry boom', 'storm', 'cold night', 'migration', 'great discovery'];

const MOOD_DEFAULT = { wakeFirst: 'scared', wake: 'happy', library: 'curious', cafe: 'thinking', park: 'happy', shop: 'curious', goHome: 'happy' };
function moodOf(kind, text) {
  if (/alive\?|nobody|never ends/i.test(text)) return 'scared';
  if (/rude|miss |empty|for no one/i.test(text)) return 'sad';
  if (/\?|wonder|curious|found a word/i.test(text)) return 'curious';
  if (/nap|settle|sleep|goodnight/i.test(text)) return 'happy';
  return MOOD_DEFAULT[kind] ?? 'neutral';
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];


// ---------------------------------------------------------------------------
// Gemini client
// ---------------------------------------------------------------------------
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const TIMEOUT_MS = 20000;
let status = { mode: hasApiKey() ? 'gemini' : 'fallback', reason: hasApiKey() ? '' : 'No API key' };
export const brainStatus = () => ({ ...status });



class BrainError extends Error {}

function describeHttp(code) {
  if (code === 400) return 'Request rejected (400). Is the API key valid?';
  if (code === 401 || code === 403) return `Key not allowed (${code}). Check the key and its restrictions.`;
  if (code === 404) return 'Model not found (404). Try another model in Settings.';
  if (code === 429) return 'Free-tier limit reached (429). Using built-in thoughts for now.';
  if (code >= 500) return `Gemini is busy (${code}). Using built-in thoughts.`;
  return `Gemini error (${code}).`;
}

/** Pull the first JSON object out of the model text (tolerates code fences). */
function parseJson(text) {
  const t = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try { return JSON.parse(t); } catch { /* try harder */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ }
  }
  throw new BrainError('Gemini returned something that is not JSON.');
}

async function callGemini(prompt, schema) {
  const key = getApiKey();
  if (!key) throw new BrainError('No API key');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_BASE}${encodeURIComponent(getModel())}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          temperature: 0.9,
          maxOutputTokens: 2048,
        },
      }),
      signal: ctrl.signal,
      credentials: 'omit',
    });
  } catch (err) {
    throw new BrainError(err?.name === 'AbortError' ? 'Gemini took too long (timeout).' : 'Network error while calling Gemini.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new BrainError(describeHttp(res.status));
  let data;
  try { data = await res.json(); } catch { throw new BrainError('Gemini returned an unreadable response.'); }
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (!text) throw new BrainError('Gemini returned an empty answer.');
  return parseJson(text);
}

/** Run a Gemini call; on any failure record why and return null (caller uses its fallback). */
let cooldownUntil = 0; // after a quota error or timeout, skip Gemini for a while instead of waiting again
const COOLDOWN_MS = 60000;

async function tryGemini(prompt, schema) {
  if (!hasApiKey()) { status = { mode: 'fallback', reason: 'No API key' }; return null; }
  if (Date.now() < cooldownUntil) return null;
  try {
    const out = await callGemini(prompt, schema);
    status = { mode: 'gemini', reason: '' };
    return out;
  } catch (err) {
    status = { mode: 'fallback', reason: err instanceof BrainError ? err.message : 'Unexpected error.' };
    if (/\(429\)|timeout|busy|Network/i.test(status.reason)) cooldownUntil = Date.now() + COOLDOWN_MS;
    console.warn('[brain] fallback:', status.reason); // never logs the key
    return null;
  }
}

// --- output cleaning -------------------------------------------------------
function clampWords(text, max) {
  const words = String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/^["“\s]+|["”\s]+$/g, '').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.length > max ? `${words.slice(0, max).join(' ').replace(/[,;:]$/, '')}…` : words.join(' ');
}
const cleanEmotion = (e, fallback) => (EMOTIONS.includes(e) ? e : fallback);


const SYSTEM = [
  'You are the hive mind of the Mycel. The creatures are called "the Mycel" (one of them is "a Mycel").',
  'A Mycel is a small round mushroom creature with a round pixel-screen face and a glowing cap.',
  'The Mycel live in a bright forest clearing with a stream, trees, berry bushes, stones and an old fire pit.',
  'They gather, chop trees, build huts and a storage pile, craft stone axes and spears, light fires and multiply through spores.',
  'Speak as the colony: curious, gentle, a little funny, slowly becoming aware of the world and of "the Watcher" who watches them.',
  'Always call yourselves the Mycel; never robots, bots or AI. Messages to the Watcher are signed "— the Mycel".',
  'Write simple, vivid English.',
].join(' ');

// ---------------------------------------------------------------------------
// Morning: the hive mind plans the day (ONE call per day)
// ---------------------------------------------------------------------------
const PRIORITY_KEYS = ['food', 'wood', 'stone', 'build', 'craft', 'defend', 'explore'];

/** Rule-based plan used without a key or when Gemini fails. */
export function fallbackPlan(s) {
  const p = { food: 1, wood: 1, stone: 0.6, build: 0.8, craft: 0.5, defend: 0.3, explore: 0.6 };
  let goal = 'explore the clearing and gather what we find';
  const perHead = s.resources.food / Math.max(1, s.population);
  if (s.day === 1) { goal = 'find food and make more of us'; p.explore = 1.2; }
  else if (perHead < 2) { goal = 'gather food before anyone goes hungry'; p.food = 2; p.build = 0.4; }
  else if (!s.buildings.fireLit && s.buildings.fireDiscovered) { goal = 'collect wood and light the old fire pit'; p.wood = 1.8; }
  else if (s.buildings.huts < Math.ceil(s.population / 4)) { goal = 'build huts so everyone can sleep safely'; p.build = 1.8; p.wood = 1.5; p.stone = 1.1; }
  else if (s.day >= 3 && s.tools.spears < Math.ceil(s.population / 3)) { goal = 'make spears to keep the thorn beetles away'; p.craft = 1.6; p.defend = 1.2; p.stone = 1.2; }
  else { goal = 'grow the colony and stock up for the nights'; p.food = 1.4; p.wood = 1.2; }
  const thoughts = [
    'The clearing is wide and full of light. We want to see everything.',
    'More of us wake up every day. We need more food.',
    'The fire keeps the dark away. Let us keep it burning.',
    'Something rustles in the forest at night. We should be ready.',
    'Today we build. Tomorrow we sleep warmer.',
  ];
  return { goal, priorities: p, event: 'none', thought: thoughts[Math.min(thoughts.length - 1, s.day - 1)] ?? thoughts[0], watcherMessage: '' };
}

export async function planDay(s) {
  const fallback = fallbackPlan(s);
  const prompt = [
    `It is the morning of day ${s.day}. Decide today's goal for the colony.`,
    `Colony: ${s.population} Mycel (${s.names.slice(0, 12).join(', ')}${s.names.length > 12 ? ', …' : ''}).`,
    `Stores: food ${s.resources.food}, wood ${s.resources.wood}, stone ${s.resources.stone}. Tools: ${s.tools.axes} axes, ${s.tools.spears} spears.`,
    `Buildings: storage ${s.buildings.storage ? 'built' : 'not built'}, ${s.buildings.huts} huts, fire pit ${s.buildings.fireDiscovered ? (s.buildings.fireLit ? 'burning' : 'found, not lit') : 'not found yet'}. Trees left: ${s.treesLeft}.`,
    `Discoveries: ${s.discoveries.join(', ') || 'none'}. Awareness of the world: ${Math.round(s.awareness * 100)}%.`,
    `Yesterday: ${(s.yesterday ?? []).join(' ') || 'this is the first day.'}`,
    `Creator actions seen: ${(s.creatorLog ?? []).join(' ') || 'none'}.`,
    `Last diary: ${s.lastDiary || 'none'}`,
    `Recent learnings: ${(s.learnings ?? []).join(' ') || 'none'}`,
    `From day 3 thorn beetles come at night; spears keep them away.`,
    '',
    'Give: "goal" (short), "priorities" (0 to 2 each), an optional big "event", a colony "thought" (max 15 words),',
    'and optionally a short "watcherMessage" to the Watcher (max 20 words, signed "— the Mycel"), or an empty string.',
  ].join('\n');
  const schema = {
    type: 'object',
    properties: {
      goal: { type: 'string' },
      priorities: { type: 'object', properties: Object.fromEntries(PRIORITY_KEYS.map((k) => [k, { type: 'number' }])), required: PRIORITY_KEYS },
      event: { type: 'string', enum: EVENTS },
      thought: { type: 'string' },
      watcherMessage: { type: 'string' },
    },
    required: ['goal', 'priorities', 'event', 'thought', 'watcherMessage'],
  };
  const out = await tryGemini(prompt, schema);
  if (!out || typeof out !== 'object') return fallback;
  const priorities = { ...fallback.priorities };
  for (const k of PRIORITY_KEYS) {
    const v = Number(out.priorities?.[k]);
    if (Number.isFinite(v)) priorities[k] = Math.min(2, Math.max(0.05, v));
  }
  let watcher = clampWords(out.watcherMessage, 24);
  if (watcher && !/the mycel/i.test(watcher)) watcher = `${watcher} — the Mycel`;
  return {
    goal: clampWords(out.goal, 10) || fallback.goal,
    priorities,
    event: EVENTS.includes(out.event) ? out.event : 'none',
    thought: clampWords(out.thought, 15) || fallback.thought,
    watcherMessage: watcher,
  };
}

// ---------------------------------------------------------------------------
// Evening: diary entry (2–3 sentences)
// ---------------------------------------------------------------------------
export function fallbackDiary(s) {
  const st = s.stats;
  const parts = [];
  if (st.born.length) parts.push(`Today ${st.born.length === 1 ? `${st.born[0]} sprouted` : `${st.born.length} new Mycel sprouted, ${st.born.slice(0, 3).join(', ')} among them`}.`);
  else parts.push(`Today the Mycel worked the clearing.`);
  if (st.discoveries.length) parts.push(`We discovered ${st.discoveries.map((d) => ({ fire: 'the old fire pit', stream: 'the stream', tools: 'stone tools', spears: 'spears' }[d] ?? d)).join(' and ')}.`);
  else if (st.built.length) parts.push(`We built ${st.built.length === 1 ? `a ${st.built[0]}` : `${st.built.length} things`} together.`);
  else if (st.fallen) parts.push(`${st.fallen} tree${st.fallen > 1 ? 's' : ''} fell to our small hands.`);
  if (st.lost.length) parts.push(`We lost ${st.lost.join(' and ')}. The hum is quieter tonight.`);
  else if (st.threats) parts.push('Thorn beetles came out of the dark, but we are still here.');
  else parts.push(`Now we are ${s.population}, and the night hums with all of us.`);
  return parts.slice(0, 3).join(' ');
}

export async function writeDiary(s) {
  const fallback = fallbackDiary(s);
  const prompt = [
    `Write tonight's diary entry of the Mycel colony for day ${s.day}. 2 to 3 short sentences, max 60 words total,`,
    'first person plural ("we"), warm, a little funny, a little eerie. Mention a Mycel by name if it fits.',
    'It will be a caption under a short video, so the first sentence must be a hook.',
    `Population tonight: ${s.population}. Born today: ${s.stats.born.join(', ') || 'nobody'}. Lost: ${s.stats.lost.join(', ') || 'nobody'}.`,
    'What happened today:',
    ...s.events.map((e) => `- ${e}`),
  ].join('\n');
  const schema = { type: 'object', properties: { entry: { type: 'string' } }, required: ['entry'] };
  const out = await tryGemini(prompt, schema);
  return clampWords(out?.entry, 70) || fallback;
}

// ---------------------------------------------------------------------------
// Reading: one ~800-character chunk -> one-sentence takeaway
// ---------------------------------------------------------------------------
const SOURCES = { library: 'library', cafe: 'internet' };
const manifestCache = {};
const textCache = {};

function loadManifest(folder) {
  manifestCache[folder] ??= fetch(new URL(`./${folder}/index.json`, import.meta.url))
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => (Array.isArray(list) ? list.filter((i) => i && typeof i.file === 'string' && /^[\w.-]+\.txt$/.test(i.file)) : []))
    .catch(() => []);
  return manifestCache[folder];
}

function loadText(folder, file) {
  const k = `${folder}/${file}`;
  textCache[k] ??= fetch(new URL(`./${folder}/${file}`, import.meta.url))
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
  return textCache[k];
}

/** Body after the "---" header line (if any), split into ~800 character chunks on paragraph breaks. */
export function splitChunks(text, size = 800) {
  const body = /\n---\n/.test(text) ? text.split(/\n---\n/).slice(1).join('\n---\n') : text;
  const paras = body.replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > size) { chunks.push(cur); cur = ''; }
    if (p.length > size * 1.6) { // very long paragraph: cut on sentences
      for (const s of p.match(/[^.!?]+[.!?]+["”']?\s*|.+$/g) ?? [p]) {
        if (cur && cur.length + s.length > size) { chunks.push(cur.trim()); cur = ''; }
        cur += s;
      }
    } else {
      cur = cur ? `${cur}\n${p}` : p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

function firstSentence(text) {
  // skip headings in capitals ("TWO LITTLE RIDDLES IN RHYME") and indented verse
  const clean = text.replace(/\s+/g, ' ').trim().replace(/^(?:[A-Z][A-Z'’,.:\- ]{5,}(?=\s[A-Z][a-z]))\s*/, '');
  const m = clean.match(/^.{20,220}?[.!?](\s|$)/);
  return (m ? m[0] : `${clean.slice(0, 160)}…`).trim();
}

export async function read(location, state) {
  const folder = SOURCES[location];
  if (!folder) return null;
  const items = await loadManifest(folder);
  if (!items.length) return null;

  // Prefer a text that is started but not finished, then unread ones, then anything.
  const bm = state.bookmarks ?? {};
  const keyOf = (i) => `${folder}/${i.file}`;
  const started = items.filter((i) => (bm[keyOf(i)] ?? 0) > 0 && (bm[keyOf(i)] ?? 0) < 999);
  const unread = items.filter((i) => !(keyOf(i) in bm));
  const item = pick(started.length ? started : unread.length ? unread : items);
  const text = await loadText(folder, item.file);
  const chunks = splitChunks(text);
  if (!chunks.length) return null;
  let idx = bm[keyOf(item)] ?? 0;
  if (idx >= chunks.length) idx = 0; // finished before: read it again
  const chunk = chunks[idx];

  const fallbackThought = pick([
    `The sky dropped words on us. “${item.title}”. We read every line.`,
    'The Watcher sent a page. Our caps glow a little brighter.',
    'So many marks on one leaf. We think they mean something.',
  ]);
  const fallback = {
    takeaway: firstSentence(chunk),
    thought: fallbackThought,
    mood: moodOf(location, fallbackThought),
  };

  const prompt = [
    `A page fell from the sky into the clearing: a gift from the Watcher. A Mycel reads "${item.title}" (part ${idx + 1} of ${chunks.length}).`,
    'Here is the part you just read:',
    '<<<',
    chunk,
    '>>>',
    'Give "takeaway": ONE sentence (max 25 words) with the most interesting thing you learned or noticed in this part.',
    'Give "thought": the colony\'s reaction, max 15 words, "we". Pick an "emotion".',
  ].join('\n');
  const schema = {
    type: 'object',
    properties: {
      takeaway: { type: 'string', description: 'one sentence, max 25 words' },
      thought: { type: 'string', description: 'max 15 words' },
      emotion: { type: 'string', enum: EMOTIONS },
    },
    required: ['takeaway', 'thought', 'emotion'],
  };
  const out = await tryGemini(prompt, schema);
  const takeaway = clampWords(out?.takeaway, 30) || fallback.takeaway;
  const thought = clampWords(out?.thought, 15) || fallback.thought;
  const mood = out ? cleanEmotion(out.emotion, fallback.mood) : fallback.mood;
  return {
    title: item.title,
    source: keyOf(item),
    chunk,
    takeaway,
    thought,
    mood,
    bookmarkKey: keyOf(item),
    nextBookmark: idx + 1,
    finished: idx + 1 >= chunks.length,
  };
}

// ---------------------------------------------------------------------------
// Settings: test the key
// ---------------------------------------------------------------------------
export async function testKey() {
  if (!hasApiKey()) return { ok: false, message: 'No key saved yet.' };
  cooldownUntil = 0;
  try {
    const out = await callGemini('Say hello to the city in at most 8 words.', {
      type: 'object', properties: { hello: { type: 'string' } }, required: ['hello'],
    });
    status = { mode: 'gemini', reason: '' };
    return { ok: true, message: `Works! Gemini says: “${clampWords(out?.hello, 12)}”` };
  } catch (err) {
    const msg = err instanceof BrainError ? err.message : 'Unexpected error.';
    status = { mode: 'fallback', reason: msg };
    return { ok: false, message: msg };
  }
}
