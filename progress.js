// progress.js — what the colony knows: a tech tree, learned emotions, social "firsts" and the
// INTELLIGENCE score (IQ 0–100). Things are earned in the simulation, wait in `pending` and only
// become real when the director shows their milestone banner (so the story stays paced).

// Emotions: 3 known from the start, 9 to learn (12 total). Keys are the face names in icons.js.
export const BASIC_EMOTIONS = ['neutral', 'hungry', 'sleep'];
export const LEARNABLE_EMOTIONS = {
  happy: { word: 'JOY', emoji: '😊', day: 1 },
  curious: { word: 'CURIOSITY', emoji: '🤔', day: 1 },
  scared: { word: 'FEAR', emoji: '😨', day: 1 },
  trust: { word: 'TRUST', emoji: '🤝', day: 2 },
  love: { word: 'LOVE', emoji: '❤️', day: 3 },
  pride: { word: 'PRIDE', emoji: '😤', day: 3 },
  angry: { word: 'ANGER', emoji: '😠', day: 3 },
  jealous: { word: 'JEALOUSY', emoji: '😒', day: 4 },
  sad: { word: 'GRIEF', emoji: '😢', day: 2 },
};
export const EMOTION_TOTAL = BASIC_EMOTIONS.length + Object.keys(LEARNABLE_EMOTIONS).length;

// Tech tree in order. `day` = earliest day, `req` = previous tech.
export const TECHS = [
  { id: 'food', title: 'LEARNED:', word: 'FOOD', emoji: '🍓', day: 1, iq: 4 },
  { id: 'water', title: 'DISCOVERED:', word: 'THE STREAM', emoji: '💧', day: 2, iq: 4 },
  { id: 'fire', title: 'LEARNED:', word: 'FIRE', emoji: '🔥', day: 2, iq: 6 },
  { id: 'tools', title: 'LEARNED:', word: 'TOOLS', emoji: '🪓', day: 3, iq: 5 },
  { id: 'shelter', title: 'LEARNED:', word: 'SHELTER', emoji: '🛖', day: 4, iq: 5 },
  { id: 'farming', title: 'LEARNED:', word: 'FARMING', emoji: '🌱', day: 5, iq: 5 },
  { id: 'weapons', title: 'LEARNED:', word: 'WEAPONS', emoji: '🗡️', day: 6, iq: 5 },
  { id: 'symbols', title: 'LEARNED:', word: 'SYMBOLS', emoji: '✍️', day: 7, iq: 6 },
  { id: 'watcher', title: 'AWARE OF', word: 'THE WATCHER', emoji: '👁️', day: 9, iq: 8 },
];
TECHS.forEach((t, i) => { t.req = i ? TECHS[i - 1].id : null; t.order = i; });
export const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t]));

export const FIRSTS = {
  birth: { title: 'FIRST', word: 'BIRTH', emoji: '🍄', iq: 1.5 },
  leader: { title: 'FIRST', word: 'LEADER', emoji: '👑', iq: 1.5 },
  theft: { title: 'FIRST', word: 'THEFT', emoji: '🫳', iq: 1.5 },
  betrayal: { title: 'FIRST', word: 'BETRAYAL', emoji: '🗡️', iq: 1.5 },
  exile: { title: 'FIRST', word: 'EXILE', emoji: '🌲', iq: 1.5 },
  victory: { title: 'FIRST', word: 'VICTORY', emoji: '⚔️', iq: 1.5 },
};

const START_IQ = 2;

export class Progress {
  constructor(saved = {}) {
    this.techs = new Set((saved.techs ?? []).filter((t) => TECH_BY_ID[t]));
    this.emotions = new Set([...BASIC_EMOTIONS, ...(saved.emotions ?? []).filter((e) => LEARNABLE_EMOTIONS[e])]);
    this.firsts = new Set((saved.firsts ?? []).filter((f) => FIRSTS[f]));
    this.iq = Math.min(100, Math.max(0, saved.iq ?? START_IQ));
    this.log = saved.log ?? []; // { day, text }
    this.pending = [];
  }

  has(tech) { return this.techs.has(tech); }
  feels(emotion) { return this.emotions.has(emotion); }
  get emotionCount() { return this.emotions.size; }
  /** 0..1: how expressive their faces are (3/12 → 0, 12/12 → 1). */
  get expressiveness() { return (this.emotions.size - BASIC_EMOTIONS.length) / (EMOTION_TOTAL - BASIC_EMOTIONS.length); }
  isPending(kind, id) { return this.pending.some((p) => p.kind === kind && p.id === id); }

  /** May the colony try this tech today? (learned already, or next in the tree and its day has come) */
  allowed(tech, day) {
    if (this.techs.has(tech)) return true;
    const t = TECH_BY_ID[tech];
    return !!t && (!t.req || this.techs.has(t.req) || this.isPending('tech', t.req)) && day >= t.day;
  }
  /** Techs that could be learned next (for the hive mind and the director). */
  available(day) { return TECHS.filter((t) => !this.techs.has(t.id) && !this.isPending('tech', t.id) && this.allowed(t.id, day)).map((t) => t.id); }
  nextTech() { return TECHS.find((t) => !this.techs.has(t.id)) ?? null; }

  /**
   * Something was earned in the sim. Returns true if it became a pending milestone.
   * kind: 'tech' | 'emotion' | 'first'; text: one sentence of who/how.
   */
  earn(kind, id, text = '', pos = null, day = 1) {
    if (this.isPending(kind, id)) return false;
    let def;
    if (kind === 'tech') { if (this.techs.has(id) || !this.allowed(id, day)) return false; def = TECH_BY_ID[id]; }
    else if (kind === 'emotion') { if (this.emotions.has(id) || !LEARNABLE_EMOTIONS[id] || day < LEARNABLE_EMOTIONS[id].day) return false; const e = LEARNABLE_EMOTIONS[id]; def = { title: 'LEARNED:', word: e.word, emoji: e.emoji, iq: 3 }; }
    else if (kind === 'first') { if (this.firsts.has(id) || !FIRSTS[id]) return false; def = FIRSTS[id]; }
    else return false;
    // order: techs by tree position, then emotions, then firsts
    const prio = kind === 'tech' ? 30 - TECH_BY_ID[id].order : kind === 'first' && id === 'birth' ? 20 : kind === 'emotion' ? 12 : 8;
    this.pending.push({ kind, id, title: def.title, word: def.word, emoji: def.emoji, iq: def.iq, text, x: pos?.x, z: pos?.z, follow: pos?.name ? pos : null, prio, at: Date.now() });
    this.pending.sort((a, b) => b.prio - a.prio);
    return true;
  }

  /** Make the top pending milestone real. Returns it (for the banner). */
  commitNext(day) {
    const ms = this.pending.shift();
    if (!ms) return null;
    if (ms.kind === 'tech') this.techs.add(ms.id);
    else if (ms.kind === 'emotion') this.emotions.add(ms.id);
    else this.firsts.add(ms.id);
    const before = this.iq;
    this.iq = Math.min(100, this.iq + ms.iq);
    ms.iqBefore = before; ms.iqAfter = this.iq;
    this.log.push({ day, text: `${ms.title} ${ms.word}` });
    if (this.log.length > 120) this.log.shift();
    return ms;
  }

  /** Small everyday learning (reading, a new day). */
  addIQ(n) { this.iq = Math.min(100, Math.round((this.iq + n) * 10) / 10); }

  summary(day) {
    return {
      iq: Math.round(this.iq),
      techs: TECHS.filter((t) => this.techs.has(t.id)).map((t) => t.word.toLowerCase()),
      emotions: [...this.emotions].map((e) => LEARNABLE_EMOTIONS[e]?.word.toLowerCase() ?? e),
      emotionCount: this.emotions.size,
      next: this.nextTech()?.id ?? null,
      available: this.available(day),
      milestonesToday: this.log.filter((l) => l.day === day).map((l) => l.text),
    };
  }

  /** Pending milestones count as learned when saving, so nothing is lost at a reload. */
  serialize() {
    const techs = [...this.techs], emotions = [...this.emotions].filter((e) => LEARNABLE_EMOTIONS[e]), firsts = [...this.firsts];
    let iq = this.iq;
    for (const ms of this.pending) {
      if (ms.kind === 'tech') techs.push(ms.id); else if (ms.kind === 'emotion') emotions.push(ms.id); else firsts.push(ms.id);
      iq += ms.iq;
    }
    return { techs, emotions, firsts, iq: Math.min(100, Math.round(iq * 10) / 10), log: this.log.slice(-120) };
  }
}
