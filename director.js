// director.js — keeps each day readable as one short video: one main event at a time (one caption,
// one camera target), 2–4 milestones per day spread out over the day (discovery → struggle →
// breakthrough → cliffhanger), a midday crisis when nothing happened, and gentle nudges so the
// tech tree keeps moving. All timing is simulated time, so fast-forward stays correct.

const MIN_GAP = 24; // seconds between milestones
const MAX_PER_DAY = 4;
const SLOTS = [0.05, 0.33, 0.6, 0.8]; // earliest phase for the 1st, 2nd, 3rd, 4th milestone of a day
const HIGH = new Set(['plot', 'plotFound', 'scuffle', 'exile', 'coup', 'betrayal', 'steal', 'sabotage', 'faction', 'leader', 'rumor', 'threat', 'lost', 'watcher', 'crisis', 'love', 'fire', 'defend']);
const SILENT = new Set(['plan', 'craft', 'fireOut', 'friendship', 'rivalry']);

export class Director {
  constructor(colony) {
    this.c = colony;
    this.t = 0;
    this.current = null;
    this.queue = [];
    this.lastMs = -1e9;
    this.newDay();
  }

  newDay() {
    this.msToday = 0;
    this.crisisDone = false;
    this.lastStoryPhase = 0;
    this.nudged = new Set();
  }

  tierOf(e) {
    if (SILENT.has(e.type)) return 0;
    if (HIGH.has(e.type) || (e.score ?? 0) >= 8) return 2;
    if ((e.score ?? 0) >= 5) return 1;
    return 0;
  }

  /** Every colony event comes through here. Most become log lines only. */
  push(e) {
    const tier = this.tierOf(e);
    if (!tier) return;
    const item = { text: e.text, kind: e.type, tier, x: e.x, z: e.z, follow: e.follow ?? null, dur: tier === 2 ? 8 : 6, at: this.t };
    const cur = this.current;
    if (!cur || (tier > cur.tier && cur.tier < 3) || (cur.tier === 1 && this.t - cur.shownAt > 2.5)) { this.show(item); return; }
    if (tier === 2) {
      this.queue = this.queue.filter((q) => q.tier === 2).slice(-2);
      this.queue.push(item);
    } else if (!this.queue.length) this.queue.push(item);
  }

  /** A caption that is not an event (the morning thought, creator feedback). */
  say(text, kind = 'thought', tier = 1, pos = null) { this.push({ text, type: kind, score: tier === 2 ? 9 : 6, x: pos?.x, z: pos?.z }); }

  show(item) {
    item.shownAt = this.t;
    item.until = this.t + item.dur;
    this.current = item;
    if (item.tier >= 2) this.lastStoryPhase = this.c.phase;
    this.c.hooks.onCaption?.(item);
  }

  update(dt) {
    this.t += dt;
    const c = this.c, P = c.progress, ph = c.phase;
    if (this.current && this.t >= this.current.until) {
      this.current = null;
      this.queue = this.queue.filter((q) => this.t - q.at < 25);
      const next = this.queue.shift();
      if (next) this.show(next); else c.hooks.onCaption?.(null);
    }

    // milestones: spaced out, max 4 a day, never on top of another milestone
    if (P.pending.length && this.msToday < MAX_PER_DAY && this.t - this.lastMs >= MIN_GAP && ph >= SLOTS[this.msToday] && ph < 0.99
      && (!this.current || this.current.tier < 3)) {
      const ms = P.commitNext(c.day);
      if (ms) {
        this.msToday++;
        this.lastMs = this.t;
        this.show({ text: ms.text || `${ms.title} ${ms.word}`, kind: 'milestone', tier: 3, x: ms.x, z: ms.z, follow: ms.follow, dur: 7, at: this.t, milestone: ms });
        c.onMilestone(ms);
      }
    }

    // midday crisis (the "struggle" part of the day) when nothing dramatic happened yet
    if (!this.crisisDone && ph > 0.36 && ph < 0.5 && c.mycel.length && this.lastStoryPhase < 0.22) {
      this.crisisDone = true;
      c.crisis();
    } else if (ph >= 0.5) this.crisisDone = true;

    // nudges: keep the tech tree moving (the hive mind's focus first, then the next tech)
    if (ph > 0.12 && ph < 0.68) {
      const avail = P.available(c.day);
      const focus = c.plan.focusTech;
      if (focus && avail.includes(focus) && !this.nudged.has(focus) && ph > 0.15) { this.nudged.add(focus); c.nudge(focus); }
      const first = avail[0];
      if (first && !this.nudged.has(first) && ph > 0.42) { this.nudged.add(first); c.nudge(first); }
    }
  }

  /** Camera target: the current main event (following a Mycel when it has one). */
  focus() {
    const cur = this.current;
    if (!cur) return null;
    const f = cur.follow && this.c.mycel.includes(cur.follow) ? cur.follow : null;
    const x = f ? f.x : cur.x, z = f ? f.z : cur.z;
    if (x === undefined || z === undefined) return null;
    return { x, z, score: cur.tier >= 3 ? 11 : cur.tier === 2 ? 10 : 5 };
  }
}
