// social.js — the Mycel's social life: personalities, relationships (friends / rivals),
// factions around leaders, secret plots (steal, sabotage, overthrow), cartoon scuffles,
// injuries, exile and reconciliation. Everything is remembered across days.
// The colony (colony.js) owns the Mycel; this module decides the drama and tells the colony
// which tasks to run. Drama events get the highest interest score (auto camera + captions).
import { CAMP_SPOTS, STORAGE_POS, CLEARING_R } from './forest.js';

export const TRAITS = ['brave', 'greedy', 'shy', 'loyal', 'jealous', 'curious'];
function hash(str) { let h = 7; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }

export const FACTION_COLORS = [0xff6a3a, 0x3fb8ff, 0x8cff4a, 0xff3f7f];
const FACTION_WORDS = ['Band', 'Circle', 'Kin', 'Moss Clan', 'Spore Guard', 'Ring'];
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const DRAMA_TYPES = new Set(['plot', 'plotFound', 'scuffle', 'exile', 'coup', 'betrayal', 'reconcile', 'steal', 'sabotage', 'faction', 'leader', 'rumor', 'rivalry', 'friendship']);

export class Social {
  constructor(colony, saved = {}) {
    this.c = colony;
    this.rel = new Map();
    for (const [a, b, v] of saved.relations ?? []) this.rel.set(key(a, b), v);
    this.factions = (saved.factions ?? []).map((f) => ({ ...f, banner: null }));
    this.plots = (saved.plots ?? []).filter((p) => !p.done);
    this.history = saved.history ?? [];
    this.nextPlotId = saved.nextPlotId ?? 1;
    this.tickT = 0; this.slowT = 0;
    for (const f of this.factions) this.raiseBanner(f);
  }

  // -------------------------------------------------------------------------
  // Relationships
  // -------------------------------------------------------------------------
  get(a, b) { return this.rel.get(key(a.name ?? a, b.name ?? b)) ?? 0; }
  change(a, b, d, { quiet = false } = {}) {
    if (!a || !b || a === b) return;
    const k = key(a.name, b.name);
    const before = this.rel.get(k) ?? 0;
    const after = Math.max(-1, Math.min(1, before + d));
    this.rel.set(k, after);
    if (quiet) return;
    if (before < 0.55 && after >= 0.55) {
      a.socialIcon = b.socialIcon = 'heart'; a.socialIconT = b.socialIconT = 3;
      this.drama('friendship', `${a.name} and ${b.name} became friends.`, a, 6);
    } else if (before > -0.55 && after <= -0.55) {
      a.socialIcon = b.socialIcon = 'bolt'; a.socialIconT = b.socialIconT = 3;
      this.drama('rivalry', `${a.name} and ${b.name} are rivals now.`, a, 8);
    }
  }
  friendsOf(m) { return this.c.mycel.filter((o) => o !== m && this.get(m, o) >= 0.55); }
  rivalsOf(m) { return this.c.mycel.filter((o) => o !== m && this.get(m, o) <= -0.55); }
  byName(n) { return this.c.mycel.find((m) => m.name === n); }

  drama(type, text, pos, score = 10, record = true) {
    this.c.event(type, text, pos, score);
    if (record && ['betrayal', 'reconcile', 'exile', 'coup', 'faction', 'plotFound', 'leader'].includes(type)) {
      this.history.push({ day: this.c.day, type, text });
      if (this.history.length > 80) this.history.shift();
    }
  }

  // -------------------------------------------------------------------------
  // Factions
  // -------------------------------------------------------------------------
  factionOf(m) { return this.factions.find((f) => f.id === m.faction); }
  raiseBanner(f) {
    const spot = CAMP_SPOTS[f.camp % CAMP_SPOTS.length];
    f.banner = this.c.world.addBanner(spot.x, spot.z, f.color);
  }
  campOf(m) { const f = this.factionOf(m); return f ? CAMP_SPOTS[f.camp % CAMP_SPOTS.length] : null; }

  updateFactions() {
    const c = this.c, pop = c.mycel.length;
    // drop factions whose leader is gone
    for (const f of [...this.factions]) {
      const leader = this.byName(f.leader);
      if (!leader || leader.exiled) {
        const heir = c.mycel.filter((m) => m.faction === f.id && !m.exiled && m.name !== f.leader).sort((a, b) => this.influence(b) - this.influence(a))[0];
        if (heir) { this.setLeader(f, heir, `${heir.name} now leads ${f.name}.`); }
        else this.disband(f);
      }
    }
    if (pop < 15) return;
    const want = pop >= 30 ? 3 : 2;
    if (this.factions.length < want) {
      const cand = c.mycel.filter((m) => !m.exiled && m.grown >= 1 && !this.factions.some((f) => f.leader === m.name))
        .sort((a, b) => this.influence(b) - this.influence(a))[0];
      if (cand) {
        const used = new Set(this.factions.map((f) => f.camp));
        const camp = [0, 1, 2, 3].find((i) => !used.has(i)) ?? 0;
        const f = { id: `f${Date.now() % 100000}${Math.floor(Math.random() * 99)}`, leader: cand.name, color: FACTION_COLORS[camp], camp, name: `${cand.name}'s ${pick(FACTION_WORDS)}` };
        this.factions.push(f);
        this.raiseBanner(f);
        this.setLeader(f, cand, null);
        this.drama('faction', `${cand.name} gathered followers: ${f.name} is born.`, CAMP_SPOTS[camp], 11);
      }
    }
    // members choose the leader they like most
    const size = {};
    for (const m of c.mycel) if (m.faction) size[m.faction] = (size[m.faction] ?? 0) + 1;
    for (const m of c.mycel) {
      if (m.exiled || this.factions.some((f) => f.leader === m.name)) continue;
      let best = null, bv = -0.05;
      for (const f of this.factions) {
        const L = this.byName(f.leader); if (!L) continue;
        // liking + loyalty + a personal taste per pair, minus a pull away from crowded factions
        const taste = ((hash(m.name + f.leader) % 100) / 100) * 0.16;
        const crowd = ((size[f.id] ?? 0) - (m.faction === f.id ? 1 : 0)) / Math.max(1, pop) * 0.5;
        const v = this.get(m, L) + taste - crowd + (m.trait === 'loyal' && m.faction === f.id ? 0.3 : 0) + (m.faction === f.id ? 0.12 : 0);
        if (v > bv) { bv = v; best = f; }
      }
      const prev = m.faction;
      m.faction = best?.id ?? null;
      if (prev !== m.faction) { if (prev) size[prev]--; if (m.faction) size[m.faction] = (size[m.faction] ?? 0) + 1; }
      if (prev && m.faction && prev !== m.faction && Math.random() < 0.5) {
        const pf = this.factions.find((f) => f.id === prev);
        if (pf) { const L = this.byName(pf.leader); if (L) this.change(L, m, -0.3, { quiet: true }); this.drama('betrayal', `${m.name} left ${pf.name} for ${best.name}.`, m, 10); }
      }
    }
  }
  influence(m) {
    return Math.min(m.age, 400) / 150 + this.friendsOf(m).length * 0.35 + (m.trait === 'brave' ? 0.6 : m.trait === 'loyal' ? 0.4 : m.trait === 'shy' ? -0.6 : 0) + (m.tool === 'spear' ? 0.3 : 0) + Math.random() * 0.3;
  }
  setLeader(f, m, text) {
    const old = this.byName(f.leader); if (old) old.crown = false;
    f.leader = m.name; m.faction = f.id; m.crown = true;
    if (text) this.drama('leader', text, m, 10);
  }
  disband(f) {
    this.c.world.removeBanner(f.banner);
    this.factions.splice(this.factions.indexOf(f), 1);
    for (const m of this.c.mycel) if (m.faction === f.id) m.faction = null;
    this.drama('faction', `${f.name} fell apart.`, null, 8);
  }

  // -------------------------------------------------------------------------
  // Plots
  // -------------------------------------------------------------------------
  planPlots() {
    const c = this.c;
    if (this.plots.filter((p) => !p.done).length >= 2 || c.mycel.length < 6) return;
    const schemers = c.mycel.filter((m) => !m.exiled && m.grown >= 1 && (m.trait === 'jealous' || m.trait === 'greedy') && !this.plots.some((p) => !p.done && p.members.includes(m.name)));
    for (const s of schemers) {
      if (Math.random() > 0.35) continue;
      const rivals = this.rivalsOf(s).filter((r) => !r.exiled);
      const myF = this.factionOf(s);
      const leader = myF && this.byName(myF.leader);
      let type = null, target = null;
      const otherLeader = this.factions.filter((f) => f !== myF).map((f) => this.byName(f.leader)).find((L) => L && !L.exiled);
      if (leader && leader !== s && (this.get(s, leader) < -0.1 || (s.trait === 'jealous' && Math.random() < 0.55))) { type = 'overthrow'; target = leader; }
      else if (s.trait === 'greedy' && c.resources.food > 4 && Math.random() < 0.6) { type = 'steal'; target = rivals[0] ?? null; }
      else if (rivals.length || otherLeader) {
        const victim = rivals[0] ?? otherLeader;
        const rf = this.factionOf(victim);
        const hut = c.world.huts.find((h) => h.built && !h.damaged && (rf ? h.faction === rf.id : true));
        if (hut) { type = 'sabotage'; target = victim; }
        else if (c.resources.food > 4) { type = 'steal'; target = victim; }
      }
      if (!type) continue;
      const members = [s.name];
      for (const o of c.mycel) {
        if (o === s || o.exiled || members.length >= 4) continue;
        if (this.get(o, s) > 0.4 && (!target || this.get(o, target) < -0.1)) members.push(o.name);
      }
      const plot = { id: `p${this.nextPlotId++}`, type, plotter: s.name, target: target?.name ?? null, members, progress: 0, day: c.day, discovered: false, done: false };
      this.plots.push(plot);
      const what = { overthrow: `is plotting to overthrow ${target?.name}`, steal: 'is plotting to raid the storage pile', sabotage: `is plotting against ${target?.name}` }[type];
      this.drama('plot', `${s.name} ${what}.`, s, 12, false);
      s.socialIcon = 'whisper'; s.socialIconT = 4;
      return;
    }
  }
  activePlotOf(m) { return this.plots.find((p) => !p.done && !p.discovered && p.members.includes(m.name)); }

  /** Called while plotters huddle at night. */
  huddle(m, dt) {
    const p = this.activePlotOf(m);
    if (!p) return;
    p.progress = Math.min(1, p.progress + dt / (this.c.dayLength * 0.12) / Math.max(1, p.members.length * 0.7));
    m.socialIcon = 'whisper'; m.socialIconT = 1.2;
  }
  huddleSpot(m) {
    const p = this.activePlotOf(m);
    const lead = p && this.byName(p.plotter);
    const a = ((lead?.id ?? 1) * 1.7) % (Math.PI * 2);
    return { x: Math.cos(a) * (CLEARING_R - 2), z: Math.sin(a) * (CLEARING_R - 2) };
  }

  /** Plots ready to strike: returns a task for the plotter (night), or null. */
  plotTask(m) {
    const p = this.activePlotOf(m);
    if (!p || p.progress < 1 || p.plotter !== m.name) return null;
    if (p.type === 'steal') return { type: 'steal', plot: p };
    if (p.type === 'sabotage') {
      const target = this.byName(p.target);
      const tf = target && this.factionOf(target);
      const hut = this.c.world.huts.find((h) => h.built && !h.damaged && (tf ? h.faction === tf.id : true)) ?? this.c.world.huts.find((h) => h.built && !h.damaged);
      return hut ? { type: 'sabotage', plot: p, hut } : null;
    }
    if (p.type === 'overthrow') { this.strike(p); return null; }
    return null;
  }

  /** Plot executed (steal / sabotage) — called by colony when the deed is done. */
  deedDone(p, m, detail) {
    p.done = true;
    if (p.type === 'steal') this.drama('steal', `Someone raided the storage pile at night: ${detail} food gone.`, STORAGE_POS, 10, false);
    if (p.type === 'sabotage') this.drama('sabotage', `A hut was wrecked in the night. ${m.name} slips away…`, m, 12);
    this.c.awareness = Math.min(1, this.c.awareness + 0.01);
  }

  /** Overthrow attempt: the plotters confront the leader. */
  strike(p) {
    p.done = true;
    const leader = this.byName(p.target), plotter = this.byName(p.plotter);
    if (!leader || !plotter) return;
    const f = this.factionOf(leader);
    const rebels = p.members.map((n) => this.byName(n)).filter(Boolean);
    const guards = this.c.mycel.filter((o) => o !== leader && o.faction === leader.faction && !rebels.includes(o) && this.get(o, leader) > 0.3);
    const power = (list) => list.reduce((s, o) => s + 1 + (o.tool === 'spear' ? 0.8 : 0) + (o.trait === 'brave' ? 0.4 : 0) - (o.injured > 0 ? 0.5 : 0), 0) + Math.random() * 1.5;
    this.drama('coup', rebels.length > 1 ? `${plotter.name} and ${rebels.length - 1} other${rebels.length > 2 ? 's' : ''} rose up against ${leader.name}!` : `${plotter.name} rose up against ${leader.name} alone!`, leader, 14);
    this.c.scuffle(plotter, leader, 'betrayal');
    const rebelsWin = power(rebels) > power([leader, ...guards]);
    this.c.later(3.5, () => {
      if (!this.c.mycel.includes(leader) || !this.c.mycel.includes(plotter)) return;
      if (rebelsWin && f) {
        this.setLeader(f, plotter, null);
        this.drama('coup', `${plotter.name} overthrew ${leader.name} and now leads ${f.name}.`, plotter, 14);
        if (Math.random() < 0.6) this.exile(leader, `${leader.name} was driven to the forest edge.`);
      } else {
        this.drama('coup', `The uprising failed. ${leader.name} still leads.`, leader, 12);
        this.exile(plotter, `${plotter.name} was exiled for the uprising.`);
      }
    });
  }

  /** A plot comes to light (hive mind, rule or creator). */
  reveal(p, by = 'the colony') {
    if (!p || p.discovered || p.done) return false;
    p.discovered = true;
    const plotter = this.byName(p.plotter), target = this.byName(p.target);
    const what = { overthrow: `planned to overthrow ${p.target}`, steal: 'planned to raid the storage pile', sabotage: `planned to wreck ${p.target}'s hut` }[p.type];
    this.drama('plotFound', `Plot discovered by ${by}: ${p.plotter} ${what}!`, plotter ?? STORAGE_POS, 13);
    if (!plotter) return true;
    for (const o of this.c.mycel) if (o !== plotter && !p.members.includes(o.name)) this.change(o, plotter, -0.25, { quiet: true });
    const victim = target ?? (this.factionOf(plotter) && this.byName(this.factionOf(plotter).leader)) ?? this.c.mycel.find((o) => o !== plotter);
    if (victim && victim !== plotter) {
      this.change(victim, plotter, -0.5);
      this.c.scuffle(victim, plotter, 'betrayal');
    }
    // forgiveness or exile
    const friends = this.friendsOf(plotter).filter((f) => f.trait === 'loyal');
    if (friends.length && Math.random() < 0.45) {
      const fr = friends[0];
      this.c.later(4, () => this.reconcile(plotter, victim, `${fr.name} stood up for ${plotter.name}. The colony forgives — for now.`));
    } else {
      this.c.later(4, () => this.exile(plotter, `${plotter.name} was exiled to the forest edge.`));
    }
    p.done = true;
    return true;
  }

  // -------------------------------------------------------------------------
  // Exile & reconciliation
  // -------------------------------------------------------------------------
  exile(m, text) {
    if (!m || m.exiled || !this.c.mycel.includes(m)) return;
    m.exiled = true; m.task = null; m.crown = false;
    const f = this.factionOf(m); if (f && f.leader === m.name) this.updateFactionsSoon = true;
    m.faction = null;
    this.drama('exile', text ?? `${m.name} was exiled to the forest edge.`, m, 13);
    this.c.setEmotion(m, 'sad', 6);
    this.c.hooks.onSound?.('exile', m);
  }
  reconcile(a, b, text) {
    if (!a) return;
    if (b) this.change(a, b, 0.5, { quiet: true });
    a.exiled = false; a.task = null;
    this.drama('reconcile', text ?? `${a.name} and ${b?.name} made peace.`, a, 11);
    this.c.setEmotion(a, 'happy', 4);
    if (b) this.c.setEmotion(b, 'love', 3);
  }

  // -------------------------------------------------------------------------
  // Creator actions
  // -------------------------------------------------------------------------
  revealAny() {
    const p = this.plots.find((x) => !x.done && !x.discovered);
    if (!p) return false;
    return this.reveal(p, 'the Watcher');
  }
  rumor() {
    const pool = this.c.mycel.filter((m) => !m.exiled && m.grown >= 1);
    if (pool.length < 2) return null;
    const a = pick(pool);
    const b = pick(pool.filter((o) => o !== a && o.faction !== a.faction)) ?? pick(pool.filter((o) => o !== a));
    this.change(a, b, -0.7);
    if (a.trait !== 'jealous' && Math.random() < 0.5) a.trait = 'jealous';
    const lies = ['stole berries at night', 'laughed at their cap', 'wants to lead the colony', 'hid food in the forest'];
    this.drama('rumor', `A rumor spreads: ${b.name} ${pick(lies)}. ${a.name} believes it.`, a, 11);
    return [a, b];
  }
  gift(factionId) {
    const f = this.factions.find((x) => x.id === factionId) ?? this.factions[0];
    if (!f) return null;
    this.c.resources.food += 6;
    for (const m of this.c.mycel) {
      if (m.faction === f.id) { this.c.setEmotion(m, 'happy', 3); }
      else if (m.faction) {
        const L = this.byName(f.leader);
        if (L) this.change(m, L, m.trait === 'jealous' ? -0.35 : -0.12, { quiet: true });
        if (m.trait === 'jealous') this.c.setEmotion(m, 'angry', 3);
      }
    }
    this.drama('faction', `The Watcher favoured ${f.name}. The others are jealous.`, CAMP_SPOTS[f.camp % CAMP_SPOTS.length], 11);
    return f;
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------
  update(dt) {
    const c = this.c;
    this.tickT -= dt; this.slowT -= dt;
    for (const m of c.mycel) {
      m.factionColor = m.faction ? (this.factionOf(m)?.color ?? null) : null;
      if (m.socialIconT > 0) { m.socialIconT -= dt; if (m.socialIconT <= 0) m.socialIcon = null; }
      if (m.injured > 0) m.injured = Math.max(0, m.injured - dt / (c.dayLength * 1.2));
    }
    if (this.tickT <= 0) {
      this.tickT = 0.6;
      // bonding / friction by proximity
      for (const m of c.mycel) {
        if (m.exiled) continue;
        const o = c.mycel[Math.floor(Math.random() * c.mycel.length)];
        if (!o || o === m || o.exiled || dist(m, o) > 4) continue;
        let d = 0.025;
        if (m.task?.type && m.task.type === o.task?.type) d += 0.03;
        if (m.faction && m.faction === o.faction) d += 0.02;
        if (m.faction && o.faction && m.faction !== o.faction) d -= 0.03;
        if (m.trait === 'shy') d *= 0.4;
        if (m.trait === 'jealous' && (o.crown || o.emotion === 'love')) d -= 0.06;
        this.change(m, o, d);
        // rivals glare at each other
        if (this.get(m, o) <= -0.55 && Math.random() < 0.15) { m.socialIcon = 'bolt'; m.socialIconT = 1.5; c.setEmotion(m, 'angry', 1.5); }
      }
      // whispering plotters by day
      for (const p of this.plots) {
        if (p.done || p.discovered || p.members.length < 2) continue;
        const ms = p.members.map((n) => this.byName(n)).filter(Boolean);
        for (const a of ms) for (const b of ms) if (a !== b && dist(a, b) < 3 && Math.random() < 0.08) { a.socialIcon = 'whisper'; a.socialIconT = 2; }
      }
    }
    if (this.slowT <= 0) {
      this.slowT = 5;
      this.updateFactions();
      this.planPlots();
    }
  }

  /** Morning: plots discovered by the hive mind (ids) or, without one, by rule. */
  morning(revealIds = null) {
    const open = this.plots.filter((p) => !p.done && !p.discovered);
    if (revealIds) {
      for (const id of revealIds) this.reveal(open.find((p) => p.id === id), 'the hive mind');
    } else {
      for (const p of open) {
        const witnesses = this.c.mycel.filter((m) => m.trait === 'loyal' && !p.members.includes(m.name)).length;
        if (Math.random() < 0.12 + p.progress * 0.35 + Math.min(0.3, witnesses * 0.03)) this.reveal(p, 'loyal eyes');
      }
    }
    // exiles may come home: a loyal friend fetches them
    for (const m of this.c.mycel.filter((x) => x.exiled)) {
      const fr = this.friendsOf(m).find((f) => !f.exiled && (f.trait === 'loyal' || Math.random() < 0.3));
      if (fr && Math.random() < 0.35) this.reconcile(m, fr, `${fr.name} brought ${m.name} back from the forest edge.`);
    }
  }

  /** Short text for the hive mind and the diary. */
  summary() {
    return {
      factions: this.factions.map((f) => ({ name: f.name, leader: f.leader, members: this.c.mycel.filter((m) => m.faction === f.id).length })),
      openPlots: this.plots.filter((p) => !p.done && !p.discovered).map((p) => ({ id: p.id, type: p.type, plotter: p.plotter, target: p.target, members: p.members.length, progress: Math.round(p.progress * 100) })),
      exiled: this.c.mycel.filter((m) => m.exiled).map((m) => m.name),
      history: this.history.slice(-8).map((h) => `Day ${h.day}: ${h.text}`),
    };
  }

  serialize() {
    const relations = [];
    for (const [k, v] of this.rel) if (Math.abs(v) > 0.15) { const [a, b] = k.split('|'); relations.push([a, b, Math.round(v * 100) / 100]); }
    return {
      relations: relations.slice(0, 900),
      factions: this.factions.map(({ banner, ...f }) => f),
      plots: this.plots.filter((p) => !p.done).slice(0, 10),
      history: this.history.slice(-80),
      nextPlotId: this.nextPlotId,
    };
  }
}
