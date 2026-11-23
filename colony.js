// colony.js — the Mycel colony simulation. Each Mycel follows simple rules (gather, chop,
// eat, build, craft, flee, defend, sleep, follow, explore, release spores). The daily hive-mind
// plan (brain.js) only sets priorities; everything else emerges here.
import * as THREE from './vendor/three.module.js';
import { CLEARING_R, FIRE_POS, STORAGE_POS, HUT_SLOTS, inPond, POND, isNearStream, SYMBOL_POS, FARM_SPOTS } from './forest.js';
import { Progress } from './progress.js';
import { Director } from './director.js';
import { Social, TRAITS } from './social.js';
import { createSprout, createBeetle, MAX_MYCEL, CAP_COLORS } from './mycel.js';

export const DAY_SECONDS = 165; // one in-game day (day + night) at 1× speed
const NIGHT_START = 0.74, NIGHT_END = 0.97;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const SYL = ['pi', 'mo', 'lu', 'ka', 'ro', 'ne', 'ti', 'sa', 'vu', 'mi', 'zo', 'fe', 'bri', 'qua', 'el', 'om', 'ny', 'ash', 'ul', 'ki', 'po', 'wen', 'dra', 'is'];
// names are made from syllables; skip the few combinations that read as rude words
const BAD_NAME = /(wenis|penis|anus|anal|nazi|cum|sex|fuk|fag|tit|ass|poo|pis)/i;
function makeName(used) {
  for (let k = 0; k < 50; k++) {
    const n = pick(SYL) + pick(SYL);
    const name = n[0].toUpperCase() + n.slice(1);
    if (!used.has(name) && name.length <= 6 && !BAD_NAME.test(name)) { used.add(name); return name; }
  }
  return `M${used.size + 1}`;
}

function pickTrait() {
  const w = { brave: 1, greedy: 0.8, shy: 0.8, loyal: 1, jealous: 0.8, curious: 1 };
  let r = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; }
  return 'curious';
}

export const DEFAULT_PRIORITIES = { food: 1, wood: 1, stone: 0.6, build: 0.8, craft: 0.5, defend: 0.3, explore: 0.6 };

/** In the evening of day 1 the fire comes before the storage pile. */
const fireWantedEarly = (c) => c.world.fire.discovered && !c.world.fire.lit && c.phase > 0.5 && c.resources.wood < 6;

export class Colony {
  constructor(world, scene, saved, hooks = {}) {
    this.world = world;
    this.scene = scene;
    this.hooks = hooks; // onEvent(evt), onSound(name, opts), onChirp(emotion, pos)
    this.mycel = [];
    this.sprouts = [];
    this.beetles = [];
    this.names = new Set();
    this.nextId = 1;
    this.phase = 0.02;
    this.day = saved?.day ?? 1;
    this.resources = { food: 0, wood: 0, stone: 0, ...(saved?.resources ?? {}) };
    this.awareness = saved?.awareness ?? 0;
    this.discoveries = new Set(saved?.discoveries ?? []);
    this.plan = { goal: 'explore the clearing', priorities: { ...DEFAULT_PRIORITIES } };
    this.events = [];
    this.stats = this.freshStats();
    this.interest = null;
    this.chirpBudget = 0;
    this.hutSite = null;
    this.dayLength = DAY_SECONDS;
    this.timers = [];
    this.progress = new Progress(saved?.progress);
    this.awareness = this.progress.iq / 100;
    this.director = new Director(this);
    this.nightSeen = false;

    world.restore({ fallenTrees: saved?.fallenTrees, storageBuilt: saved?.storageBuilt, huts: saved?.huts, fire: saved?.fire, farms: saved?.farms, symbols: saved?.symbols });
    world.trees.forEach((t) => { t.onFallen = () => this.event('treeFall', `${t.lastChopper ?? 'A Mycel'} brought a tree down.`, t, 6); });
    if (saved?.mycel?.length) {
      for (const s of saved.mycel.slice(0, MAX_MYCEL)) {
        const p = s.exiled ? this.exileSpot({ id: this.nextId }) : this.world.randomClearingPoint(8);
        this.spawn({ ...s, ...p, grown: 1 }, true);
      }
    } else {
      this.spawn({ x: STORAGE_POS.x + 2, z: STORAGE_POS.z - 2, grown: 1 }, true);
    }
    this.social = new Social(this, saved?.social);
    for (const f of this.social.factions) { const L = this.social.byName(f.leader); if (L) L.crown = true; }
    this.world.drawStorage(this.resources);
  }

  /** Run fn after `sec` simulated seconds (works with fast-forward). */
  later(sec, fn) { this.timers.push({ t: sec, fn }); }

  exileSpot(m) {
    const a = (m.id * 2.399) % (Math.PI * 2);
    return { x: Math.cos(a) * (CLEARING_R + 2.5), z: Math.sin(a) * (CLEARING_R + 2.5) };
  }

  freshStats() { return { born: [], fallen: 0, built: [], crafted: [], ate: 0, fights: 0, threats: 0, discoveries: [], lost: [] }; }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------
  spawn(opts = {}, quiet = false) {
    if (this.mycel.length >= MAX_MYCEL) return null;
    const name = opts.name && !this.names.has(opts.name) ? (this.names.add(opts.name), opts.name) : makeName(this.names);
    const p = opts.x !== undefined ? opts : this.world.randomClearingPoint(8);
    const m = {
      id: this.nextId++, name,
      x: p.x, z: p.z, y: this.world.heightAt(p.x, p.z), yaw: rand(0, Math.PI * 2),
      color: opts.color ?? pick(CAP_COLORS),
      grown: opts.grown ?? 0.35, age: opts.age ?? (opts.grown >= 1 ? 60 : 0),
      hunger: rand(0.1, 0.3), energy: rand(0.7, 1), safety: 1,
      tool: opts.tool ?? null,
      task: null, emotion: 'happy', moodLock: 0,
      bubble: null, bubbleT: 0, icon: null,
      walk: 0, moving: 0, bob: 0, squash: 0, pop: 1, tilt: 0, blink: false, blinkT: rand(1, 4),
      sporeCd: opts.grown >= 1 ? rand(6, 12) : rand(30, 40), stun: 0, starve: 0, carrying: null, love: null,
      spots: 1, capScale: 0.6,
      trait: TRAITS.includes(opts.trait) ? opts.trait : pickTrait(),
      injured: opts.injured ?? 0, exiled: !!opts.exiled, faction: opts.faction ?? null, crown: false,
      socialIcon: null, socialIconT: 0,
    };
    this.mycel.push(m);
    if (!quiet) {
      this.setEmotion(m, 'happy', 3);
      this.stats.born.push(name);
      this.event('birth', `${name} sprouted from the moss.`, m, 4);
    }
    this.updateLooks(m);
    return m;
  }

  updateLooks(m) {
    // individual growth: bigger caps and more spots as the colony grows wiser and the Mycel older
    const maturity = Math.min(1, m.age / 90);
    m.capScale = 0.55 + maturity * 0.35 + Math.min(this.awareness, 1) * 0.2;
    m.spots = Math.round(1 + maturity * 4 + Math.min(this.awareness, 1) * 4);
  }

  // -------------------------------------------------------------------------
  // Events, emotions, sound
  // -------------------------------------------------------------------------
  event(type, text, pos = null, score = 3) {
    const follow = pos && pos.grown !== undefined ? pos : null;
    const e = { type, text, day: this.day, phase: this.phase, x: pos?.x, z: pos?.z, drama: score >= 10, score, follow };
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    this.hooks.onEvent?.(e);
    this.learnFromEvent(e, follow);
    this.director.push(e);
  }

  /** Firsts and new emotions that an event teaches (become milestones via the director). */
  learnFromEvent(e, who) {
    const n = who?.name ?? 'A Mycel';
    const at = who ?? (e.x !== undefined ? { x: e.x, z: e.z } : null);
    const feel = (emo, text) => this.progress.earn('emotion', emo, text, at, this.day);
    const first = (id) => this.progress.earn('first', id, e.text, at, this.day);
    switch (e.type) {
      case 'birth': first('birth'); break;
      case 'love': feel('love', `${n} feels a soft pull towards another Mycel.`); break;
      case 'friendship': feel('trust', `${n} found a true friend. It feels safe.`); break;
      case 'scuffle': feel('angry', `${n} felt something hot and sharp inside.`); break;
      case 'steal': first('theft'); feel('angry', 'Someone took what was ours. Something hot and sharp.'); break;
      case 'betrayal': first('betrayal'); feel('jealous', `${n} switched sides. The old friends watch with narrowed eyes.`); break;
      case 'exile': first('exile'); feel('sad', `${n} walks into the dark forest alone. The others feel heavy.`); break;
      case 'defend': first('victory'); break;
      case 'faction': if (/is born/.test(e.text)) { first('leader'); feel('jealous', 'Some Mycel follow a leader now. The others watch with narrowed eyes.'); } else if (/Watcher favoured/.test(e.text)) feel('jealous', 'The Watcher chose favourites. The others watch with narrowed eyes.'); break;
      case 'lost': feel('sad', `${e.text} The colony feels heavy.`); break;
      case 'threat': feel('scared', 'Something crawled out of the dark. Their screens flicker: fear.'); break;
      case 'crisis': if (/storm/i.test(e.text)) feel('scared', 'Thunder over the clearing. Their screens flicker: fear.'); break;
      default:
    }
  }

  /** Earn a tech; if it is not a milestone (already known / not yet allowed), log a normal event. */
  learnTech(id, text, pos, fallbackType = null, score = 6) {
    const ok = this.progress.earn('tech', id, text, pos, this.day);
    if (!ok && fallbackType) this.event(fallbackType, text, pos, score);
    else if (ok) this.events.push({ type: 'learn', text, day: this.day, phase: this.phase });
    return ok;
  }

  /** Called by the director when a milestone banner goes up. */
  onMilestone(ms) {
    this.awareness = this.progress.iq / 100;
    if (ms.kind === 'emotion') {
      // everyone tries the new feeling once
      this.mycel.forEach((m) => { if (!m.exiled && m.task?.type !== 'sleep') this.setEmotion(m, ms.id, 3); });
    } else if (ms.kind === 'tech') {
      this.mycel.forEach((m) => { if (dist(m, ms) < 14 && m.task?.type !== 'sleep') this.setEmotion(m, this.progress.feels('happy') ? 'happy' : 'curious', 2.5); });
    }
    this.hooks.onMilestone?.(ms);
  }

  setEmotion(m, emotion, lock = 1.5) {
    if (!this.progress.feels(emotion)) emotion = emotion === 'sad' && m.hunger > 0.6 ? 'hungry' : 'neutral';
    if (m.emotion === emotion) { m.moodLock = Math.max(m.moodLock, lock); return; }
    m.emotion = emotion;
    m.moodLock = lock;
    if (emotion !== 'neutral' && emotion !== 'sleep') {
      m.bubble = emotion; m.bubbleT = 3;
      if (this.chirpBudget > 0) { this.chirpBudget--; this.hooks.onChirp?.(emotion, m); }
    }
  }

  groupMood() {
    const n = this.mycel.length || 1;
    const val = { happy: 1, love: 1, curious: 0.4, neutral: 0, sleep: 0.2, hungry: -0.5, sad: -0.9, scared: -0.6, angry: -0.7 };
    const aro = { happy: 0.5, love: 0.3, curious: 0.5, neutral: 0.2, sleep: 0, hungry: 0.4, sad: 0.1, scared: 1, angry: 0.9 };
    let v = 0, a = 0;
    const counts = {};
    for (const m of this.mycel) { v += val[m.emotion] ?? 0; a += aro[m.emotion] ?? 0; counts[m.emotion] = (counts[m.emotion] ?? 0) + 1; }
    return { valence: v / n, arousal: a / n, counts };
  }

  // -------------------------------------------------------------------------
  // Creator actions (from the Creator panel)
  // -------------------------------------------------------------------------
  creator(action, extra) {
    const w = this.world;
    switch (action) {
      case 'berries':
        for (const b of w.bushes) { b.berries = 6; w.drawBush(b); }
        this.resources.food += 6;
        this.mycel.forEach((m) => this.setEmotion(m, 'happy', 3));
        this.event('creator', 'Berries rained from the sky. The Mycel cheered.', { x: STORAGE_POS.x, z: STORAGE_POS.z }, 7);
        break;
      case 'fire':
        w.fire.discovered = true; w.fire.lit = true; w.fire.fuel = 1;
        this.discover('fire', null);
        if (!this.learnTech('fire', 'A spark fell from the sky into the old stones. Fire!', FIRE_POS)) this.event('creator', 'A spark fell from above and the fire pit caught flame.', FIRE_POS, 8);
        this.mycel.forEach((m) => this.setEmotion(m, dist(m, FIRE_POS) < 8 ? 'curious' : 'happy', 3));
        break;
      case 'beetles':
        this.spawnBeetles(2, true);
        break;
      case 'spores': {
        const p = w.randomClearingPoint(10);
        this.addSprout(p.x, p.z, pick(CAP_COLORS), true);
        this.event('creator', 'A gift of spores drifted into the clearing.', p, 6);
        break;
      }
      case 'message':
        // everyone stops and looks up at the Watcher
        this.mycel.forEach((m) => { this.setEmotion(m, Math.random() < 0.55 ? 'curious' : 'scared', 4); m.listen = rand(7, 9); m.moving = 0; });
        this.event('watcher', `The Watcher spoke: “${extra}”`, this.centroid(), 8);
        if (this.progress.allowed('watcher', this.day)) this.watcherScene();
        break;
      case 'knowledge':
        this.progress.addIQ(1);
        break;
      default:
    }
    this.world.drawStorage(this.resources);
  }

  discover(what, m) {
    if (this.discoveries.has(what)) return;
    if (what === 'stream') {
      if (!this.progress.allowed('water', this.day)) return;
      this.discoveries.add(what);
      this.stats.discoveries.push(what);
      this.learnTech('water', `${m?.name ?? 'A Mycel'} followed a sound and found running water.`, m ?? { x: 3, z: -12 }, 'discovery', 7);
      return;
    }
    if (what === 'fire') this.progress.earn('emotion', 'curious', `${m?.name ?? 'A Mycel'} found a ring of old stones. What is it?`, m ?? FIRE_POS, this.day);
    if (what === 'fireLit') { this.discoveries.add(what); this.awareness = Math.min(1, this.awareness + 0.04); return; }
    this.discoveries.add(what);
    this.awareness = Math.min(1, this.awareness + 0.04);
    this.stats.discoveries.push(what);
    const who = m?.name ?? 'The colony';
    const text = { fire: `${who} discovered the old fire pit.`, stream: `${who} found the stream. Water sings.`, tools: `${who} figured out how to tie stone to wood.`, spears: `${who} made the first spear.` }[what] ?? `${who} discovered ${what}.`;
    this.event('discovery', text, m ?? FIRE_POS, 7);
  }

  // -------------------------------------------------------------------------
  // Reproduction
  // -------------------------------------------------------------------------
  addSprout(x, z, color, gift = false) {
    if (this.mycel.length + this.sprouts.length >= MAX_MYCEL) return;
    const g = createSprout(this.scene, color);
    g.position.set(x, this.world.heightAt(x, z), z);
    g.scale.setScalar(0.01);
    this.sprouts.push({ x, z, color, t: 0, grow: gift ? 6 : 15, g });
    this.world.puff(x, z, color, gift ? 50 : 35, 0.6);
    this.hooks.onSound?.('spore', { x, z });
  }

  /** Soft population cap: a small colony for a long time, a little more room once they are wise. */
  popCap() { return this.progress.has('watcher') ? 16 : 14; }

  maxBirthsToday() {
    const room = Math.max(0, this.popCap() - this.mycel.length - this.sprouts.length + this.stats.born.length);
    if (this.day === 1) return Math.min(2, room);
    return Math.min(this.birthQuota ?? 1, room);
  }

  tryReproduce(m) {
    if (m.grown < 1 || this.isNight() || m.hunger > 0.65 || m.stun > 0 || m.exiled) return;
    if (m.sporeCd > 0) return;
    const pending = this.sprouts.length;
    if (this.stats.born.length + pending >= this.maxBirthsToday()) { m.sporeCd = 20; return; }
    if (this.mycel.length + pending >= Math.min(MAX_MYCEL, this.popCap())) { m.sporeCd = 40; return; }
    if (this.day > 1 && this.resources.food < 3) { m.sporeCd = 15; return; }
    if (this.day > 1) this.resources.food -= 3;
    m.task = { type: 'spore', t: 0 };
    m.sporeCd = this.day === 1 ? rand(28, 40) : rand(55, 90);
  }

  // -------------------------------------------------------------------------
  // Threats
  // -------------------------------------------------------------------------
  spawnBeetles(n, fromCreator = false) {
    for (let i = 0; i < n; i++) {
      const p = this.world.randomEdgePoint();
      const g = createBeetle(this.scene);
      g.position.set(p.x, this.world.heightAt(p.x, p.z), p.z);
      this.beetles.push({ x: p.x, z: p.z, hp: 3, state: 'approach', t: 0, g, stolen: 0 });
    }
    this.stats.threats += n;
    this.event('threat', fromCreator ? 'Thorn beetles crawled out of the forest. The Watcher sent them.' : 'Thorn beetles crawled out of the dark forest.', this.beetles.at(-1), 9);
    this.hooks.onSound?.('threat');
  }

  // -------------------------------------------------------------------------
  // Task selection
  // -------------------------------------------------------------------------
  isNight() { return this.phase >= NIGHT_START && this.phase < NIGHT_END; }
  centroid() {
    if (!this.mycel.length) return { x: 0, z: 0 };
    let x = 0, z = 0;
    for (const m of this.mycel) { x += m.x; z += m.z; }
    return { x: x / this.mycel.length, z: z / this.mycel.length };
  }
  countTool(t) { return this.mycel.filter((m) => m.tool === t).length; }
  nearestThreat(m, r = 9) {
    let best = null, bd = r;
    for (const b of this.beetles) { if (b.state === 'flee') continue; const d = dist(m, b); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  nearest(list, m, filter) {
    let best = null, bd = Infinity;
    for (const it of list) { if (!filter(it)) continue; const d = dist(m, it); if (d < bd) { bd = d; best = it; } }
    return best;
  }

  chooseTask(m) {
    const w = this.world, P = this.plan.priorities, R = this.resources;
    if (m.exiled) return { type: 'exiled', t: 0 };
    if (this.isNight()) {
      const deed = this.social.plotTask(m);
      if (deed) return deed;
      if (this.social.activePlotOf(m)) return { type: 'huddle' };
    }
    const threat = this.nearestThreat(m, m.trait === 'brave' ? 5 : 9);
    if (threat && m.tool !== 'spear') return { type: 'flee', from: threat };
    if (threat && m.tool === 'spear') return { type: 'defend', target: threat };
    if (this.beetles.length && m.tool === 'spear') return { type: 'defend', target: this.nearest(this.beetles, m, (b) => b.state !== 'flee') };
    if (this.isNight()) return { type: 'sleep' };
    if (m.hunger > (m.trait === 'greedy' ? 0.45 : 0.6)) return { type: 'eat' };
    if (m.energy < 0.15) return { type: 'rest', t: 0 };

    const opts = [];
    const add = (w8, task) => { if (w8 > 0) opts.push([w8, task]); };
    const pop = this.mycel.length;
    // storage first: it is the colony's first build
    if (!w.storage.built && R.wood >= 3 && !fireWantedEarly(this)) add(3, { type: 'build', what: 'storage' });
    // food
    const bush = this.nearest(w.bushes, m, (b) => b.berries > 0);
    const mush = this.nearest(w.items, m, (i) => i.alive && i.kind === 'mushroom' && !i.reservedBy);
    const foodNeed = R.food < pop * 2 ? 1.6 : R.food < pop * 4 ? 1 : 0.35;
    if (bush) add(P.food * foodNeed * 1.2, { type: 'gather', target: bush, kind: 'berry' });
    if (mush) add(P.food * foodNeed, { type: 'gather', target: mush, kind: 'mushroom' });
    // wood
    const fireWanted = w.fire.discovered && !w.fire.lit && this.phase > 0.45;
    const woodNeed = (R.wood < 6 ? 1.4 : R.wood < 16 ? 0.9 : 0.3) * (fireWanted && R.wood < 3 ? 2.5 : 1);
    const stick = this.nearest(w.items, m, (i) => i.alive && (i.kind === 'stick' || i.kind === 'log') && !i.reservedBy);
    if (stick) add(P.wood * woodNeed, { type: 'gather', target: stick, kind: stick.kind });
    const tree = this.nearest(w.trees, m, (t) => t.state === 'standing');
    if (tree && (m.tool === 'axe' || !stick || R.wood > 4)) add(P.wood * woodNeed * (m.tool === 'axe' ? 1.6 : 0.7), { type: 'chop', target: tree });
    // stone
    const stone = this.nearest(w.items, m, (i) => i.alive && i.kind === 'stone' && !i.reservedBy);
    if (stone) add(P.stone * (R.stone < 5 ? 1.2 : 0.4), { type: 'gather', target: stone, kind: 'stone' });
    // building huts
    if (this.hutSite) add(P.build * 2.2, { type: 'build', what: 'hut', site: this.hutSite });
    // crafting
    const axes = this.countTool('axe'), spears = this.countTool('spear');
    const G = this.progress;
    if (!m.tool && R.wood >= 2 && R.stone >= 1) {
      if (G.has('tools') && axes < Math.ceil(pop / 5)) add(P.craft * 1.5, { type: 'craft', kind: 'axe' });
      if (G.has('weapons') && spears < Math.ceil(pop / 3)) add((P.craft + P.defend) * 1.3, { type: 'craft', kind: 'spear' });
    }
    // farming and symbols, once learned
    if (G.has('farming') && w.farmCount < FARM_SPOTS.length && R.food >= 4) add(0.35, { type: 'plant' });
    if (G.has('symbols') && w.symbolsCarved < 6 && !this.isNight()) add(0.12, { type: 'carve' });
    // fire
    if (w.fire.discovered && !w.fire.lit && R.wood >= 3 && G.allowed('fire', this.day)) add(this.phase > 0.45 ? 6 : 2.5, { type: 'lightFire' });
    if (w.fire.lit && w.fire.fuel < 0.45 && R.wood >= 1) add(1.6, { type: 'feedFire' });
    // repair a wrecked hut
    const broken = w.huts.find((h) => h.built && h.damaged);
    if (broken && R.wood >= 1) add(P.build * 2.5, { type: 'repair', hut: broken });
    // loyal followers stick with their leader
    const fac = this.social.factionOf(m);
    const leader = fac && this.social.byName(fac.leader);
    if (leader && leader !== m && !leader.exiled) add(m.trait === 'loyal' ? 0.9 : 0.25, { type: 'follow', leader, t: 0 });
    // explore / follow
    const camp = this.social.campOf(m);
    if (camp && Math.random() < 0.3) add(0.5, { type: 'explore', target: { x: camp.x + rand(-3, 3), z: camp.z + rand(-3, 3) } });
    add(P.explore * (w.fire.discovered ? 0.4 : 1.2) * (m.trait === 'curious' ? 2.2 : m.trait === 'shy' ? 0.6 : 1), { type: 'explore', target: !w.fire.discovered && Math.random() < 0.35 ? { x: FIRE_POS.x + rand(-1.5, 1.5), z: FIRE_POS.z + rand(-1.5, 1.5) } : w.randomClearingPoint() });
    if (pop > 3) add(0.25, { type: 'follow', leader: pick(this.mycel.filter((o) => o !== m)), t: 0 });
    // love: two content adults (from day 2)
    if (this.day >= 2 && m.grown >= 1 && m.hunger < 0.4 && !this.isNight() && Math.random() < 0.02) {
      const partner = this.nearest(this.mycel, m, (o) => o !== m && o.grown >= 1 && !o.love && o.hunger < 0.5 && dist(o, m) < 10);
      if (partner) return { type: 'love', partner, t: 0 };
    }

    const total = opts.reduce((s, o) => s + o[0], 0);
    let r = Math.random() * total;
    for (const [w8, task] of opts) { r -= w8; if (r <= 0) return task; }
    return { type: 'explore', target: w.randomClearingPoint() };
  }

  // -------------------------------------------------------------------------
  // Movement helper: returns true when arrived
  // -------------------------------------------------------------------------
  moveTo(m, tx, tz, dt, stopDist = 0.9, speedMul = 1) {
    const dx = tx - m.x, dz = tz - m.z;
    const d = Math.hypot(dx, dz);
    if (d <= stopDist) { m.moving = Math.max(0, m.moving - dt * 6); return true; }
    const speed = (1.8 + m.grown * 0.9) * speedMul * (m.energy < 0.2 ? 0.7 : 1) * (1 - 0.45 * Math.min(1, m.injured || 0));
    let vx = dx / d, vz = dz / d;
    // separation from neighbours
    for (const o of this.mycel) {
      if (o === m) continue;
      const ox = m.x - o.x, oz = m.z - o.z, od = ox * ox + oz * oz;
      if (od < 2.6 && od > 0.0001) { const f = (2.6 - od) * 0.7; vx += ox * f; vz += oz * f; }
    }
    const vl = Math.hypot(vx, vz) || 1;
    m.x += (vx / vl) * speed * dt;
    m.z += (vz / vl) * speed * dt;
    const r = Math.hypot(m.x, m.z);
    if (r > CLEARING_R + 3.5) { m.x *= (CLEARING_R + 3.5) / r; m.z *= (CLEARING_R + 3.5) / r; }
    if (inPond(m.x, m.z, 0.5)) { const a = Math.atan2(m.z - POND.z, m.x - POND.x); m.x = POND.x + Math.cos(a) * (POND.r + 0.55); m.z = POND.z + Math.sin(a) * (POND.r + 0.55); }
    m.targetYaw = Math.atan2(vx, vz);
    m.moving = Math.min(1, m.moving + dt * 6);
    return false;
  }

  // -------------------------------------------------------------------------
  // Per-Mycel task step
  // -------------------------------------------------------------------------
  stepTask(m, dt) {
    const w = this.world, R = this.resources, t = m.task;
    const deliver = () => this.moveTo(m, STORAGE_POS.x + rand(-0.4, 0.4), STORAGE_POS.z + rand(-0.4, 0.4), dt, 2.5);
    switch (t.type) {
      case 'gather': {
        m.icon = t.kind === 'berry' || t.kind === 'mushroom' ? 'berry' : t.kind === 'stone' ? 'stone' : 'wood';
        if (!t.picked) {
          const tg = t.target;
          if ((t.kind === 'berry' && tg.berries <= 0) || (t.kind !== 'berry' && (!tg.alive || (tg.reservedBy && tg.reservedBy !== m.id)))) return true;
          if (t.kind !== 'berry') tg.reservedBy = m.id;
          if (this.moveTo(m, tg.x, tg.z, dt, t.kind === 'berry' ? 1.9 : 0.9)) {
            t.work = (t.work ?? 0) + dt;
            m.squash = Math.sin(t.work * 14) * 0.06;
            if (t.work > (t.kind === 'log' ? 1.4 : 0.9)) {
              const ok = t.kind === 'berry' ? w.pickBerry(tg) : w.takeItem(tg);
              if (!ok) return true;
              t.picked = true;
              m.carrying = { kind: t.kind, amount: t.kind === 'log' ? 2 : 1 };
              if (Math.random() < 0.2) this.setEmotion(m, 'happy', 1.5);
              if (!this.discoveries.has('stream') && isNearStream(tg.x, tg.z, 4)) this.discover('stream', m);
            }
          }
          return false;
        }
        if (deliver()) {
          const c = m.carrying;
          if (c) {
            if (c.kind === 'berry' || c.kind === 'mushroom') R.food += c.amount;
            else if (c.kind === 'stone') R.stone += c.amount;
            else R.wood += c.amount;
            m.carrying = null;
            w.drawStorage(R);
          }
          return true;
        }
        return false;
      }
      case 'chop': {
        const tr = t.target;
        if (tr.state !== 'standing') return true;
        m.icon = 'axe';
        const ang = Math.atan2(m.x - tr.x, m.z - tr.z);
        if (this.moveTo(m, tr.x + Math.sin(ang) * 1.5, tr.z + Math.cos(ang) * 1.5, dt, 0.3)) {
          m.targetYaw = Math.atan2(tr.x - m.x, tr.z - m.z);
          t.cd = (t.cd ?? 0.4) - dt;
          m.squash = Math.max(0, Math.sin((t.cd) * 12)) * 0.12;
          if (t.cd <= 0) {
            t.cd = m.tool === 'axe' ? 0.45 : 0.8;
            tr.lastChopper = m.name;
            this.hooks.onSound?.('chop', m);
            if (w.chopTree(tr, m.tool === 'axe' ? 2 : 1)) {
              this.stats.fallen++;
              this.hooks.onSound?.('treeFall', tr);
              this.setEmotion(m, 'happy', 3);
              this.interest = { x: tr.x, z: tr.z, score: 7, t: performance.now() };
              return true;
            }
          }
        }
        return false;
      }
      case 'eat': {
        m.icon = 'berry';
        if (R.food > 0) {
          if (deliver()) {
            t.work = (t.work ?? 0) + dt;
            m.squash = Math.abs(Math.sin(t.work * 10)) * 0.08;
            if (t.work > 1.2) {
              if (R.food <= 0) return true;
              // squabble when food is scarce
              const rival = R.food <= 2 && this.mycel.find((o) => o !== m && o.task?.type === 'eat' && dist(o, m) < 2.5);
              if (rival && Math.random() < (m.trait === 'greedy' || rival.trait === 'greedy' ? 0.8 : 0.5)) {
                const grudge = this.social.get(m, rival) < -0.3 || (m.faction && rival.faction && m.faction !== rival.faction);
                if (this.simT - (this.lastScuffle ?? -1e9) > (grudge ? 12 : 30)) { this.scuffle(m, rival, 'food'); return true; }
                this.setEmotion(m, 'angry', 2); this.setEmotion(rival, 'angry', 2);
                this.social.change(m, rival, -0.08, { quiet: true });
              }
              R.food--; m.hunger = Math.max(0, m.hunger - 0.65); m.starve = 0;
              this.stats.ate++;
              this.ateTogether(m);
              w.drawStorage(R);
              this.setEmotion(m, rival ? 'angry' : 'happy', 2);
              return true;
            }
          }
          return false;
        }
        // nothing stored: eat straight from a bush
        const bush = t.bush ?? (t.bush = this.nearest(w.bushes, m, (b) => b.berries > 0));
        if (!bush || bush.berries <= 0) {
          this.setEmotion(m, m.hunger > 0.85 ? 'sad' : 'hungry', 3);
          return true;
        }
        if (this.moveTo(m, bush.x, bush.z, dt, 1.9)) {
          t.work = (t.work ?? 0) + dt;
          if (t.work > 1) { if (w.pickBerry(bush)) { m.hunger = Math.max(0, m.hunger - 0.5); m.starve = 0; this.setEmotion(m, 'happy', 2); this.ateTogether(m); } return true; }
        }
        return false;
      }
      case 'rest': {
        m.icon = 'sleep';
        t.t += dt; m.energy = Math.min(1, m.energy + dt * 0.12);
        this.setEmotion(m, 'sleep', 1);
        return t.t > 6;
      }
      case 'sleep': {
        m.icon = 'sleep';
        if (!t.spot) {
          const hut = w.huts.find((h) => h.built && !h.damaged && h.sleepers < 4 && (!h.faction || h.faction === m.faction));
          if (hut) { hut.sleepers++; t.hut = hut; t.spot = { x: hut.x + rand(-0.6, 0.6), z: hut.z + rand(-0.6, 0.6) }; }
          else {
            const c = this.social.campOf(m) ?? (w.fire.lit ? FIRE_POS : STORAGE_POS);
            const a = rand(0, Math.PI * 2), r = rand(2.6, 4.2 + this.mycel.length * 0.06);
            t.spot = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
          }
        }
        if (this.moveTo(m, t.spot.x, t.spot.z, dt, 0.4)) {
          m.energy = Math.min(1, m.energy + dt * 0.05);
          this.setEmotion(m, 'sleep', 1);
          m.hidden = !!t.hut;
        }
        if (!this.isNight()) { if (t.hut) t.hut.sleepers--; m.hidden = false; return true; }
        return false;
      }
      case 'build': {
        m.icon = 'hammer';
        if (t.what === 'storage') {
          if (w.storage.built) return true;
          if (deliver()) {
            t.cd = (t.cd ?? 0.6) - dt;
            m.squash = Math.max(0, Math.sin(t.cd * 10)) * 0.1;
            if (t.cd <= 0) {
              t.cd = 0.6;
              w.storage.progress = Math.min(1, w.storage.progress + 0.12);
              if (Math.random() < 0.3) this.hooks.onSound?.('knock', m);
              if (w.storage.progress >= 1) {
                w.storage.built = true; R.wood = Math.max(0, R.wood - 3);
                this.stats.built.push('storage');
                this.event('build', `${m.name} finished the storage pile.`, STORAGE_POS, 6);
                this.hooks.onSound?.('build', STORAGE_POS);
                this.setEmotion(m, 'happy', 3);
              }
              w.drawStorage(R);
            }
          }
          return false;
        }
        const site = t.site;
        if (!site || site.built) return true;
        if (this.moveTo(m, site.x + rand(-0.3, 0.3), site.z + 2.4, dt, 0.6)) {
          m.targetYaw = Math.atan2(site.x - m.x, site.z - m.z);
          t.cd = (t.cd ?? 0.5) - dt;
          m.squash = Math.max(0, Math.sin(t.cd * 12)) * 0.12;
          if (t.cd <= 0) {
            t.cd = 0.5;
            site.progress = Math.min(1, site.progress + 0.035);
            if (Math.random() < 0.35) this.hooks.onSound?.('knock', site);
            w.drawHut(site);
            if (site.progress >= 1) {
              site.built = true; this.hutSite = null; site.faction = m.faction;
              if (this.learnTech('shelter', `${m.name} and friends finished the first hut. A roof against the dark.`, m)) {
                this.progress.earn('emotion', 'pride', `${m.name} looks at the hut. We made this.`, m, this.day);
              }
              w.drawHut(site);
              this.stats.built.push('hut');
              this.event('build', `${m.name} and friends finished a hut.`, site, 7);
              this.hooks.onSound?.('build', site);
              this.setEmotion(m, 'happy', 3);
              return true;
            }
          }
          if (Math.random() < dt * 0.15) return true; // let others help, too
        }
        return false;
      }
      case 'craft': {
        m.icon = t.kind === 'spear' ? 'spear' : 'hammer';
        if (R.wood < 2 || R.stone < 1) return true;
        if (deliver()) {
          t.work = (t.work ?? 0) + dt;
          m.squash = Math.abs(Math.sin(t.work * 9)) * 0.08;
          if (t.work > 2.5) {
            R.wood -= 2; R.stone -= 1; m.tool = t.kind;
            this.stats.crafted.push(t.kind);
            this.discoveries.add(t.kind === 'axe' ? 'tools' : 'spears');
            this.learnTech(t.kind === 'axe' ? 'tools' : 'weapons', t.kind === 'axe' ? `${m.name} tied a sharp stone to a stick. An axe!` : `${m.name} sharpened a long stick into a spear.`, m, 'craft', 5);
            this.hooks.onSound?.('knock', m);
            this.setEmotion(m, 'happy', 3);
            w.drawStorage(R);
            return true;
          }
        }
        return false;
      }
      case 'lightFire': {
        m.icon = 'fire';
        if (w.fire.lit || R.wood < 3) return true;
        if (this.moveTo(m, FIRE_POS.x + 2.0, FIRE_POS.z + 0.4, dt, 0.5)) {
          m.targetYaw = Math.atan2(FIRE_POS.x - m.x, FIRE_POS.z - m.z);
          t.work = (t.work ?? 0) + dt;
          m.squash = Math.abs(Math.sin(t.work * 16)) * 0.1;
          if (t.work > 3) {
            R.wood -= 3; w.fire.lit = true; w.fire.fuel = 1;
            this.discover('fireLit', null);
            this.learnTech('fire', `${m.name} rubbed two sticks until they smoked. Warm light everywhere!`, m, 'fire', 7);
            this.mycel.forEach((o) => { if (dist(o, FIRE_POS) < 12) this.setEmotion(o, 'happy', 3); });
            w.drawStorage(R);
            return true;
          }
        }
        return false;
      }
      case 'feedFire': {
        m.icon = 'fire';
        if (!w.fire.lit || R.wood < 1) return true;
        if (this.moveTo(m, FIRE_POS.x - 2.0, FIRE_POS.z + 0.6, dt, 0.5)) {
          R.wood -= 1; w.fire.fuel = Math.min(1, w.fire.fuel + 0.45);
          w.drawStorage(R);
          return true;
        }
        return false;
      }
      case 'explore': {
        m.icon = 'explore';
        if (!this.discoveries.has('stream') && isNearStream(m.x, m.z, 3.5)) this.discover('stream', m);
        if (!w.fire.discovered && dist(m, FIRE_POS) < 3) {
          w.fire.discovered = true;
          this.setEmotion(m, 'curious', 3.5);
          this.discover('fire', m);
        }
        if (this.moveTo(m, t.target.x, t.target.z, dt, 0.8, 0.8)) {
          t.wait = (t.wait ?? rand(0.6, 2)) - dt;
          if (Math.random() < 0.01) this.setEmotion(m, 'curious', 2);
          return t.wait <= 0;
        }
        return false;
      }
      case 'follow': {
        m.icon = null;
        t.t += dt;
        if (!t.leader || !this.mycel.includes(t.leader)) return true;
        this.moveTo(m, t.leader.x, t.leader.z, dt, 2.0);
        return t.t > 8;
      }
      case 'flee': {
        m.icon = 'alert';
        this.setEmotion(m, 'scared', 1.5);
        const from = t.from;
        const safe = w.fire.lit ? FIRE_POS : (w.huts.find((h) => h.built) ?? STORAGE_POS);
        const away = { x: m.x + (m.x - from.x) * 2, z: m.z + (m.z - from.z) * 2 };
        const goal = dist(m, safe) > 3 ? safe : away;
        this.moveTo(m, goal.x, goal.z, dt, 1.2, 1.5);
        m.safety = Math.max(0, m.safety - dt * 0.3);
        t.t = (t.t ?? 0) + dt;
        return t.t > 3 && !this.nearestThreat(m, 7);
      }
      case 'defend': {
        m.icon = 'spear';
        const b = t.target;
        if (!b || !this.beetles.includes(b) || b.state === 'flee') return true;
        this.setEmotion(m, 'angry', 1.5);
        if (this.moveTo(m, b.x, b.z, dt, 1.7, 1.3)) {
          m.targetYaw = Math.atan2(b.x - m.x, b.z - m.z);
          t.cd = (t.cd ?? 0.2) - dt;
          m.attacking = t.cd > 0.5;
          if (t.cd <= 0) {
            t.cd = 0.8; b.hp--; b.hit = 0.3;
            this.hooks.onSound?.('poke', b);
            if (b.hp <= 0) {
              b.state = 'flee';
              this.event('defend', `${m.name} chased a thorn beetle back into the forest.`, b, 8);
              this.setEmotion(m, 'happy', 3);
              m.attacking = false;
              return true;
            }
          }
        }
        return false;
      }
      case 'spore': {
        m.icon = 'spore';
        t.t += dt;
        m.pop = 1 + Math.sin(Math.min(1, t.t / 1.4) * Math.PI) * 0.25;
        this.setEmotion(m, t.love ? 'love' : 'happy', 1.5);
        if (t.t > 1.4) {
          m.pop = 1;
          const a = rand(0, Math.PI * 2), r = rand(1.2, 2.2);
          this.addSprout(m.x + Math.cos(a) * r, m.z + Math.sin(a) * r, Math.random() < 0.45 ? m.color : pick(CAP_COLORS));
          return true;
        }
        return false;
      }
      case 'love': {
        const p = t.partner;
        if (!p || !this.mycel.includes(p)) return true;
        m.icon = 'heart';
        m.love = p; t.t += dt;
        this.setEmotion(m, 'love', 2);
        this.setEmotion(p, 'love', 2);
        if (this.moveTo(m, p.x, p.z, dt, 1.5)) {
          if (t.t > 4) {
            m.love = null;
            if (this.mycel.length + this.sprouts.length < Math.min(MAX_MYCEL, this.popCap()) && this.stats.born.length + this.sprouts.length < this.maxBirthsToday()) {
              this.event('love', `${m.name} and ${p.name} fell in love. Spores everywhere.`, m, 8);
              m.task = { type: 'spore', t: 0, love: true };
              return false;
            }
            this.event('love', `${m.name} and ${p.name} sit close together. Their screens glow pink.`, m, 7);
            return true;
          }
        }
        return t.t > 12;
      }
      case 'plant': {
        m.icon = 'berry';
        const spot = FARM_SPOTS[w.farmCount];
        if (!spot) return true;
        if (!t.got) {
          if (R.food < 1) return true;
          if (deliver()) { R.food--; t.got = true; w.drawStorage(R); }
          return false;
        }
        if (this.moveTo(m, spot.x + 1.3, spot.z, dt, 0.5)) {
          m.targetYaw = Math.atan2(spot.x - m.x, spot.z - m.z);
          t.work = (t.work ?? 0) + dt;
          m.squash = Math.abs(Math.sin(t.work * 8)) * 0.12;
          if (t.work > 3.2) {
            if (w.plantBush(spot)) {
              w.puff(spot.x, spot.z, 0x7dff9a, 30, 0.5);
              this.learnTech('farming', `${m.name} pushed a berry into the soil. Days later, a bush!`, m, 'build', 5);
            }
            return true;
          }
        }
        return false;
      }
      case 'carve': {
        m.icon = 'hammer';
        if (w.symbolsCarved >= 6) return true;
        const a = Math.atan2(FIRE_POS.x - SYMBOL_POS.x, FIRE_POS.z - SYMBOL_POS.z);
        if (this.moveTo(m, SYMBOL_POS.x + Math.sin(a) * 1.3, SYMBOL_POS.z + Math.cos(a) * 1.3, dt, 0.4)) {
          m.targetYaw = Math.atan2(SYMBOL_POS.x - m.x, SYMBOL_POS.z - m.z);
          t.work = (t.work ?? 0) + dt;
          m.squash = Math.max(0, Math.sin(t.work * 11)) * 0.1;
          if (t.work > 4) {
            const n = w.carveSymbol();
            this.hooks.onSound?.('knock', m);
            this.learnTech('symbols', `${m.name} scratched a glowing mark into the stone. It means: us.`, m, n % 2 ? 'build' : null, 5);
            return true;
          }
        }
        return false;
      }
      case 'pose': { // stand still facing a direction (screenshots / inspect)
        m.icon = null; m.moving = 0;
        if (t.yaw !== undefined) { m.targetYaw = t.yaw; m.yaw = t.yaw; }
        t.t = (t.t ?? 0) + dt;
        return t.t > (t.dur ?? 8);
      }
      case 'scuffle': {
        const o = t.opp;
        if (!o || !this.mycel.includes(o)) return true;
        m.icon = null;
        this.setEmotion(m, 'angry', 1);
        if (this.moveTo(m, o.x, o.z, dt, 1.3, 1.3)) {
          t.t += dt;
          m.targetYaw = Math.atan2(o.x - m.x, o.z - m.z);
          const beat = Math.floor(t.t / 0.32);
          const lunge = (beat % 2 === (t.lead ? 0 : 1)) ? Math.sin((t.t % 0.32) / 0.32 * Math.PI) : 0;
          m.x += Math.sin(m.targetYaw) * lunge * dt * 3; m.z += Math.cos(m.targetYaw) * lunge * dt * 3;
          m.tilt = (t.lead ? 1 : -1) * lunge * 0.4;
          m.squash = lunge * 0.15;
          m.attacking = m.tool === 'spear' && lunge > 0.5;
          if (t.lead && (t.dustT = (t.dustT ?? 0) - dt) <= 0) {
            t.dustT = 0.45;
            this.world.dust((m.x + o.x) / 2, (m.z + o.z) / 2, 22);
            this.hooks.onSound?.(m.tool === 'spear' ? 'poke' : 'shove', m);
          }
          if (t.lead && t.t > 3.2) { this.resolveScuffle(m, o, t.reason); return true; }
        }
        return t.t > 6;
      }
      case 'exiled': {
        m.icon = null;
        const spot = t.spot ?? (t.spot = this.exileSpot(m));
        if (this.moveTo(m, spot.x + Math.sin(t.t * 0.3) * 1.5, spot.z + Math.cos(t.t * 0.3) * 1.5, dt, 0.6, 0.6)) t.t += dt;
        m.hunger = Math.max(0, m.hunger - dt / 160); // forages in the forest
        if (m.moodLock <= 0) this.setEmotion(m, Math.random() < 0.7 ? 'sad' : 'angry', 4);
        return !m.exiled || t.t > 20;
      }
      case 'huddle': {
        if (!this.isNight() || !this.social.activePlotOf(m)) return true;
        const spot = t.spot ?? (t.spot = this.social.huddleSpot(m));
        if (this.moveTo(m, spot.x + rand(-0.6, 0.6), spot.z + rand(-0.6, 0.6), dt, 1.4, 0.8)) {
          this.social.huddle(m, dt);
          m.bob = Math.sin(performance.now() / 200 + m.id) * 0.03;
        }
        return false;
      }
      case 'steal': {
        m.icon = 'berry';
        if (!t.took) {
          if (deliver()) {
            t.work = (t.work ?? 0) + dt;
            if (t.work > 1.5) {
              const take = Math.min(5, R.food);
              R.food -= take; t.took = take; w.drawStorage(R);
              this.setEmotion(m, 'happy', 2);
            }
          }
          return false;
        }
        const spot = this.social.huddleSpot(m);
        if (this.moveTo(m, spot.x, spot.z, dt, 1.5, 1.2)) { m.hunger = 0; this.social.deedDone(t.plot, m, t.took); return true; }
        return false;
      }
      case 'sabotage': {
        m.icon = 'hammer';
        const h = t.hut;
        if (!h || h.damaged) return true;
        if (this.moveTo(m, h.x + 1.8, h.z, dt, 0.6)) {
          t.work = (t.work ?? 0) + dt;
          m.squash = Math.max(0, Math.sin(t.work * 14)) * 0.12;
          if (t.work > 2.2) {
            h.damaged = true; w.drawHut(h); w.dust(h.x, h.z, 50);
            this.hooks.onSound?.('knock', h);
            this.social.deedDone(t.plot, m);
            return true;
          }
        }
        return false;
      }
      case 'repair': {
        m.icon = 'hammer';
        const h = t.hut;
        if (!h || !h.damaged || R.wood < 1) return true;
        if (this.moveTo(m, h.x - 1.8, h.z + 1, dt, 0.6)) {
          t.work = (t.work ?? 0) + dt;
          m.squash = Math.max(0, Math.sin(t.work * 12)) * 0.12;
          if (t.work > 3) { h.damaged = false; R.wood -= 1; w.drawHut(h); w.drawStorage(R); this.event('build', `${m.name} repaired the wrecked hut.`, h, 6); return true; }
        }
        return false;
      }
      default:
        return true;
    }
  }

  /** First meal: FOOD. First meal with someone close by: JOY. */
  ateTogether(m) {
    this.learnTech('food', `${m.name} bit into a berry. Sweet! Food means life.`, m);
    if (this.progress.has('food') && !this.progress.feels('happy')) {
      const mate = this.mycel.find((o) => o !== m && !o.exiled && dist(o, m) < 6);
      if (mate) this.progress.earn('emotion', 'happy', `${m.name} and ${mate.name} shared a meal. A warm glow on their screens.`, m, this.day);
    }
  }

  /** The director's push: make the next tech happen today (a small, visible scene). */
  nudge(id) {
    const R = this.resources, w = this.world;
    const busy = ['scuffle', 'spore', 'love', 'flee', 'defend', 'sleep', 'exiled', 'steal', 'sabotage'];
    const free = this.mycel.filter((m) => m.grown >= 1 && !m.exiled && !busy.includes(m.task?.type));
    const m = free.find((o) => (id === 'tools' || id === 'weapons') && !o.tool) ?? pick(free);
    if (!m) return;
    const assign = (task, who = m) => { if (who.task?.target?.reservedBy === who.id) who.task.target.reservedBy = null; if (who.carrying) this.addCarry(who); who.task = task; };
    const need = (k, n) => { if (R[k] < n) { R[k] = n; w.drawStorage(R); } };
    switch (id) {
      case 'food': need('food', 1); m.hunger = Math.max(m.hunger, 0.62); assign({ type: 'eat' }); break;
      case 'water': assign({ type: 'explore', target: { x: 4 + rand(-1, 1), z: -10.5 + rand(-1, 1) } }); break;
      case 'fire':
        if (!w.fire.discovered) assign({ type: 'explore', target: { x: FIRE_POS.x + 1, z: FIRE_POS.z + 1 } });
        else { need('wood', 3); assign({ type: 'lightFire' }); }
        break;
      case 'tools': need('wood', 2); need('stone', 1); assign({ type: 'craft', kind: 'axe' }); break;
      case 'weapons': need('wood', 2); need('stone', 1); assign({ type: 'craft', kind: 'spear' }); break;
      case 'shelter':
        if (!this.hutSite) { need('wood', 6); need('stone', 2); this.planHut(true); }
        if (this.hutSite) for (const o of free.slice(0, 3)) assign({ type: 'build', what: 'hut', site: this.hutSite }, o);
        break;
      case 'farming': need('food', 1); assign({ type: 'plant' }); break;
      case 'symbols': assign({ type: 'carve' }); break;
      case 'watcher': this.watcherScene(); break;
      default:
    }
  }

  /** Midday struggle when the day had no drama yet. */
  crisis() {
    const adults = this.mycel.filter((m) => m.grown >= 1 && !m.exiled && m.task?.type !== 'sleep');
    const opts = ['hunger'];
    if (adults.length >= 2 && this.day >= 2) opts.push('quarrel', 'quarrel');
    if (this.day >= 2) opts.push('storm');
    if (this.day >= 3 && this.progress.has('fire')) opts.push('beetles');
    const kind = !this.progress.feels('angry') && opts.includes('quarrel') ? 'quarrel' : pick(opts);
    if (kind === 'quarrel') {
      const a = pick(adults), b = this.nearest(adults, a, (o) => o !== a);
      if (a && b) { this.scuffle(a, b, 'food'); return; }
    }
    if (kind === 'beetles') { this.spawnBeetles(1); return; }
    if (kind === 'storm') {
      this.hooks.onCrisis?.('storm');
      this.mycel.forEach((m) => this.setEmotion(m, 'scared', 3));
      this.event('crisis', 'Dark clouds roll in. A storm hits the clearing.', this.centroid(), 9);
      return;
    }
    // hunger: the wild bushes go bare for a while
    let near = null;
    for (const b of this.world.bushes) { if (b.farm) continue; b.berries = 0; b.regrow = -35; this.world.drawBush(b); near = near ?? b; }
    this.mycel.forEach((m) => { m.hunger = Math.min(1, m.hunger + 0.25); });
    this.event('crisis', 'The berry bushes are bare. Bellies are rumbling.', near ?? this.centroid(), 9);
  }

  /** Last tech: they all stop, look up, and know someone is watching. */
  watcherScene() {
    const c = this.centroid();
    this.mycel.forEach((m) => { if (!m.exiled) { m.listen = 7; m.moving = 0; this.setEmotion(m, 'curious', 6); } });
    this.later(5, () => this.learnTech('watcher', 'All Mycel looked up at once. They know someone is watching.', c, 'watcher', 9));
  }

  planHut(force = false) {
    const w = this.world;
    if (this.hutSite || !w.storage.built && !force) return;
    if (!force && (this.resources.wood < 6 || this.resources.stone < 2)) return;
    const want = Math.max(1, Math.ceil(this.mycel.length / 4));
    if (!force && w.huts.length >= want) return;
    if (w.huts.length >= HUT_SLOTS.length) return;
    const used = new Set(w.huts.map((h) => h.slot));
    const slot = HUT_SLOTS.findIndex((_, i) => !used.has(i));
    if (slot < 0) return;
    this.resources.wood -= 6; this.resources.stone -= 2;
    this.hutSite = w.addHut(slot, 0.02);
    w.drawStorage(this.resources);
    this.event('plan', 'The colony marked a spot for a new hut.', this.hutSite, 4);
  }

  // -------------------------------------------------------------------------
  // Scuffles (cartoon fights: shoving, pokes, dust — no gore)
  // -------------------------------------------------------------------------
  scuffle(a, b, reason = 'food') {
    if (!a || !b || a === b || a.task?.type === 'scuffle' || b.task?.type === 'scuffle') return;
    for (const m of [a, b]) { if (m.task?.target?.reservedBy === m.id) m.task.target.reservedBy = null; if (m.carrying) this.addCarry(m); }
    a.task = { type: 'scuffle', opp: b, t: 0, reason, lead: true };
    b.task = { type: 'scuffle', opp: a, t: 0, reason, lead: false };
    this.setEmotion(a, 'angry', 3); this.setEmotion(b, 'angry', 3);
    this.stats.fights++;
    this.lastScuffle = this.simT;
    const grudge = this.social.get(a, b) < -0.3 || (a.faction && b.faction && a.faction !== b.faction);
    const why = { food: 'the last berries', territory: 'their camp', betrayal: 'a betrayal' }[reason] ?? reason;
    this.event('scuffle', `${a.name} and ${b.name} are fighting over ${why}!`, a, reason !== 'food' || grudge ? 11 : 8);
    this.hooks.onSound?.('fight', a);
  }

  resolveScuffle(a, b, reason) {
    const power = (m) => 1 + (m.tool === 'spear' ? 0.7 : 0) + (m.trait === 'brave' ? 0.5 : 0) - (m.injured > 0 ? 0.6 : 0) + m.grown * 0.3 + Math.random() * 1.2;
    const [win, lose] = power(a) >= power(b) ? [a, b] : [b, a];
    lose.injured = 1; lose.socialIcon = 'bandage'; lose.socialIconT = 6;
    this.social.change(win, lose, -0.4);
    for (const m of [a, b]) { m.tilt = 0; m.attacking = false; if (m.task?.type === 'scuffle') m.task = null; }
    this.setEmotion(win, 'happy', 2.5);
    this.setEmotion(lose, 'sad', 4);
    this.hooks.onSound?.('bonk', lose);
    this.event('scuffle', `${win.name} won the scuffle. ${lose.name} limps away.`, lose, 7);
    // repeat offenders against the colony can be exiled
    if (reason !== 'food' && this.social.get(lose, win) < -0.8 && Math.random() < 0.35) {
      this.social.exile(lose, `${lose.name} lost the fight and was chased to the forest edge.`);
    }
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------
  update(dt) {
    const w = this.world;
    this.phase += dt / DAY_SECONDS;
    this.simT = (this.simT ?? 0) + dt;
    for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }
    this.social.update(dt);
    this.director.update(dt);
    this.awareness = this.progress.iq / 100;
    this.chirpBudget = Math.min(3, this.chirpBudget + dt * 1.2);
    const night = this.isNight();

    // colony-level planning: hut sites (once shelter may be learned)
    if (this.progress.allowed('shelter', this.day) && (this.progress.has('shelter') || this.progress.isPending('tech', 'shelter') || w.huts.length === 0)) this.planHut();
    if (!this.hutSite) this.hutSite = w.huts.find((h) => !h.built) ?? null;

    // fire burns down
    if (w.fire.lit) {
      w.fire.fuel -= dt / (DAY_SECONDS * 0.45);
      if (w.fire.fuel <= 0) { w.fire.lit = false; w.fire.fuel = 0; this.event('fireOut', 'The fire went out.', FIRE_POS, 4); }
    }

    // Mycel
    for (const m of this.mycel) {
      m.age += dt;
      if (m.grown < 1) m.grown = Math.min(1, m.grown + dt / 35);
      m.hunger = Math.min(1, m.hunger + dt / (night ? 100 : 50));
      if (!night) m.energy = Math.max(0, m.energy - dt / 160);
      m.safety = Math.min(1, m.safety + dt * 0.05);
      m.moodLock -= dt;
      if (m.bubbleT > 0) m.bubbleT -= dt;
      if (m.hunger >= 1) {
        m.starve += dt;
        if (m.starve > 90 && Math.random() < dt * 0.04) { this.dissolve(m); continue; }
      }
      if (m.stun > 0) { m.stun -= dt; m.moving = 0; m.tilt = Math.sin(m.stun * 10) * 0.2; this.setEmotion(m, 'scared', 0.5); continue; }
      if (m.listen > 0) {
        m.listen -= dt; m.moving = Math.max(0, m.moving - dt * 6);
        if (this.cameraPos) m.targetYaw = Math.atan2(this.cameraPos.x - m.x, this.cameraPos.z - m.z);
        let d = m.targetYaw - m.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); m.yaw += d * Math.min(1, dt * 6);
        m.bob = Math.sin(performance.now() / 300 + m.id) * 0.02; m.y = w.heightAt(m.x, m.z);
        if (m.moodLock <= 0) this.setEmotion(m, Math.random() < 0.5 ? 'curious' : 'love', 3);
        continue;
      }
      if (m.tilt && m.task?.type !== 'eat') m.tilt *= 1 - Math.min(1, dt * 4);

      // threats interrupt calm tasks
      if (m.task && !['flee', 'defend', 'scuffle', 'exiled'].includes(m.task.type) && this.beetles.length) {
        const th = this.nearestThreat(m, 6);
        if (th) { if (m.task.target?.reservedBy === m.id) m.task.target.reservedBy = null; m.task = null; }
      }
      if (night && m.task && !['sleep', 'flee', 'defend', 'scuffle', 'huddle', 'steal', 'sabotage', 'exiled'].includes(m.task.type)) {
        if (m.task.target?.reservedBy === m.id) m.task.target.reservedBy = null;
        if (m.carrying) { this.addCarry(m); }
        m.task = null;
      }
      if (m.grown >= 1 && !night) m.sporeCd -= dt;
      if (!m.task) { this.tryReproduce(m); if (!m.task) m.task = this.chooseTask(m); }
      if (m.task && this.stepTask(m, dt)) {
        if (m.task?.target?.reservedBy === m.id) m.task.target.reservedBy = null;
        m.task = null; m.icon = null;
      }

      // emotion from needs, when no event emotion is locked
      if (m.moodLock <= 0) {
        let e = 'neutral';
        if (m.task?.type === 'sleep' || m.task?.type === 'rest') e = 'sleep';
        else if (m.hunger > 0.85 && this.resources.food <= 0) e = 'sad';
        else if (m.hunger > 0.72) e = 'hungry';
        else if (m.safety < 0.5) e = 'scared';
        else if (m.task?.type === 'explore') e = Math.random() < 0.5 ? 'curious' : 'neutral';
        else if (m.hunger < 0.3 && Math.random() < 0.3) e = 'happy';
        this.setEmotion(m, e, rand(2, 4));
      }

      // animation bits
      m.y = w.heightAt(m.x, m.z);
      if (m.targetYaw !== undefined) {
        let d = m.targetYaw - m.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        m.yaw += d * Math.min(1, dt * 8);
      }
      if (m.moving > 0.01) m.walk += dt * 12;
      m.bob = Math.abs(Math.sin(m.walk)) * 0.06 * m.moving + (m.emotion === 'sleep' ? -0.06 : Math.sin(performance.now() / 500 + m.id) * 0.015);
      m.squash *= 1 - Math.min(1, dt * 6);
      m.blinkT -= dt;
      if (m.blinkT <= 0) { m.blink = true; if (m.blinkT < -0.12) { m.blink = false; m.blinkT = rand(2, 5); } }
      if (m.emotion !== 'neutral' && m.emotion !== 'sad') m.blink = false;
      if (Math.random() < dt * 0.1) this.updateLooks(m);
    }

    // sprouts grow into Mycel
    for (let i = this.sprouts.length - 1; i >= 0; i--) {
      const s = this.sprouts[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.grow);
      s.g.scale.setScalar(0.2 + k * 1.1 + Math.sin(s.t * 6) * 0.03);
      if (k >= 1) {
        this.scene.remove(s.g);
        this.sprouts.splice(i, 1);
        this.world.puff(s.x, s.z, s.color, 25, 0.4);
        const m = this.spawn({ x: s.x, z: s.z, color: s.color, grown: 0.35 });
        if (m) this.hooks.onSound?.('birth', m);
      }
    }

    // Day 1: make sure the colony visibly multiplies (5-8 by the end of the first day)
    if (this.day === 1 && this.phase > 0.2 && this.phase < NIGHT_START && this.mycel.length + this.sprouts.length < (this.phase > 0.5 ? 3 : 2) && this.stats.born.length + this.sprouts.length < 2) {
      const adult = this.mycel.find((m) => m.grown >= 1 && m.task?.type !== 'spore');
      if (adult && Math.random() < dt * 0.15) { adult.task = { type: 'spore', t: 0 }; adult.sporeCd = rand(28, 40); }
    }

    // night threats from day 3
    if (!this.nightSeen && this.phase > NIGHT_START) {
      this.nightSeen = true;
      const m = this.mycel.find((o) => !o.exiled) ?? null;
      this.progress.earn('emotion', 'scared', `The first darkness fell. ${m?.name ?? 'A Mycel'}'s screen flickers: fear.`, m, this.day);
    }
    if (this.day >= 3 && this.progress.has('fire') && !this.beetlesTonight && this.phase > NIGHT_START + 0.02) {
      this.beetlesTonight = true;
      this.discoveries.add('beetles');
      this.spawnBeetles(Math.min(4, 1 + Math.floor((this.day - 3) / 2)));
    }
    this.updateBeetles(dt);
  }

  addCarry(m) {
    const c = m.carrying; if (!c) return;
    if (c.kind === 'berry' || c.kind === 'mushroom') this.resources.food += c.amount;
    else if (c.kind === 'stone') this.resources.stone += c.amount;
    else this.resources.wood += c.amount;
    m.carrying = null;
    this.world.drawStorage(this.resources);
  }

  dissolve(m) {
    this.world.puff(m.x, m.z, m.color, 60, 0.8);
    this.mycel.splice(this.mycel.indexOf(m), 1);
    this.stats.lost.push(m.name);
    this.event('lost', `${m.name} was too hungry and dissolved into spores.`, m, 8);
    this.mycel.forEach((o) => this.setEmotion(o, 'sad', 4));
    this.hooks.onSound?.('lost', m);
  }

  updateBeetles(dt) {
    const w = this.world;
    for (let i = this.beetles.length - 1; i >= 0; i--) {
      const b = this.beetles[i];
      b.t += dt;
      let tx, tz, speed = 2.1;
      if (b.state === 'approach') {
        tx = STORAGE_POS.x; tz = STORAGE_POS.z;
        if (dist(b, STORAGE_POS) < 2) { b.state = 'steal'; b.t = 0; }
        // knock over unarmed Mycel nearby
        for (const m of this.mycel) {
          if (m.tool !== 'spear' && m.stun <= 0 && dist(m, b) < 1.5) { m.stun = 2.5; this.hooks.onSound?.('bonk', m); }
        }
      } else if (b.state === 'steal') {
        tx = b.x; tz = b.z;
        if (b.t > 2.5) {
          const take = Math.min(3, this.resources.food);
          this.resources.food -= take; b.stolen += take;
          w.drawStorage(this.resources);
          if (take) this.event('steal', `A thorn beetle stole ${take} food from the storage.`, b, 7);
          b.state = 'flee';
        }
      } else {
        const a = Math.atan2(b.z, b.x);
        tx = Math.cos(a) * 40; tz = Math.sin(a) * 40; speed = 3.2;
        if (Math.hypot(b.x, b.z) > 34) { this.scene.remove(b.g); this.beetles.splice(i, 1); continue; }
      }
      const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
      if (d > 0.1) { b.x += (dx / d) * speed * dt; b.z += (dz / d) * speed * dt; b.g.rotation.y = Math.atan2(dx, dz); }
      b.g.position.set(b.x, w.heightAt(b.x, b.z) + (b.hit > 0 ? 0.25 : 0), b.z);
      if (b.hit > 0) b.hit -= dt;
      b.g.userData.legs.forEach((l, k) => { l.rotation.x = Math.sin(b.t * 18 + k) * 0.5; });
    }
  }

  // -------------------------------------------------------------------------
  // Day boundaries
  // -------------------------------------------------------------------------
  startDay(day, plan) {
    this.day = day;
    this.phase = 0.0;
    this.beetlesTonight = false;
    this.nightSeen = this.progress.feels('scared');
    this.director.newDay();
    this.progress.addIQ(1);
    // births today: usually 1–2, sometimes 3 when food is plenty and the mood is good
    const pop = this.mycel.length || 1;
    this.birthQuota = 1 + (this.resources.food >= pop * 1.5 && Math.random() < 0.7 ? 1 : 0) + (this.groupMood().valence > 0.3 && Math.random() < 0.3 ? 1 : 0);
    this.stats = this.freshStats();
    this.events = [];
    if (plan) this.plan = plan;
    this.world.respawnMorning();
    this.mycel.forEach((m) => { m.hidden = false; if (m.task?.type === 'sleep') { if (m.task.hut) m.task.hut.sleepers = 0; m.task = null; } });
    this.world.huts.forEach((h) => { h.sleepers = 0; });
  }

  summary() {
    const mood = this.groupMood();
    return {
      day: this.day,
      population: this.mycel.length,
      names: this.mycel.map((m) => m.name),
      resources: { ...this.resources },
      tools: { axes: this.countTool('axe'), spears: this.countTool('spear') },
      buildings: { storage: this.world.storage.built, huts: this.world.huts.filter((h) => h.built).length, fireDiscovered: this.world.fire.discovered, fireLit: this.world.fire.lit },
      treesLeft: this.world.trees.filter((t) => t.state === 'standing').length,
      discoveries: [...this.discoveries],
      awareness: Math.round(this.awareness * 100) / 100,
      mood: mood.counts,
      stats: this.stats,
      events: this.events.map((e) => e.text).slice(-14),
      drama: this.events.filter((e) => e.drama).map((e) => e.text).slice(-8),
      social: this.social.summary(),
      progress: this.progress.summary(this.day),
    };
  }

  serialize() {
    return {
      day: this.day,
      mycel: this.mycel.map((m) => ({ name: m.name, color: m.color, age: Math.round(m.age), tool: m.tool, trait: m.trait, exiled: m.exiled, faction: m.faction, injured: Math.round(m.injured * 100) / 100 })),
      social: this.social.serialize(),
      resources: { ...this.resources },
      fallenTrees: this.world.trees.filter((t) => t.state !== 'standing').map((t) => t.id),
      storageBuilt: this.world.storage.built,
      huts: this.world.huts.map((h) => ({ slot: h.slot, progress: h.progress, built: h.built, damaged: !!h.damaged, faction: h.faction ?? null })),
      fire: { discovered: this.world.fire.discovered, lit: this.world.fire.lit, fuel: this.world.fire.fuel },
      discoveries: [...this.discoveries],
      awareness: this.awareness,
      progress: this.progress.serialize(),
      farms: this.world.farmCount,
      symbols: this.world.symbolsCarved,
    };
  }

  /** The most interesting place right now (for the auto camera). */
  focus() {
    const f = this.director.focus();
    if (f) return f;
    if (this.beetles.length) return this.beetles[0];
    const c = this.centroid();
    return { x: c.x, z: c.z, score: 1 };
  }

  spread() {
    const c = this.centroid();
    let r = 0;
    for (const m of this.mycel) r = Math.max(r, dist(m, c));
    return r;
  }
}

export { NIGHT_START, NIGHT_END };
