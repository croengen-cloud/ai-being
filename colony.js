// colony.js — the Mycel colony simulation. Each Mycel follows simple rules (gather, chop,
// eat, build, craft, flee, defend, sleep, follow, explore, release spores). The daily hive-mind
// plan (brain.js) only sets priorities; everything else emerges here.
import * as THREE from './vendor/three.module.js';
import { CLEARING_R, FIRE_POS, STORAGE_POS, HUT_SLOTS } from './forest.js';
import { createSprout, createBeetle, MAX_MYCEL, CAP_COLORS } from './mycel.js';

export const DAY_SECONDS = 120; // one in-game day (day + night) at 1× speed
const NIGHT_START = 0.74, NIGHT_END = 0.97;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const SYL = ['pi', 'mo', 'lu', 'ka', 'ro', 'ne', 'ti', 'sa', 'vu', 'mi', 'zo', 'fe', 'bri', 'qua', 'el', 'om', 'ny', 'ash', 'ul', 'ki', 'po', 'wen', 'dra', 'is'];
function makeName(used) {
  for (let k = 0; k < 50; k++) {
    const n = pick(SYL) + pick(SYL);
    const name = n[0].toUpperCase() + n.slice(1);
    if (!used.has(name) && name.length <= 6) { used.add(name); return name; }
  }
  return `M${used.size + 1}`;
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

    world.restore({ fallenTrees: saved?.fallenTrees, storageBuilt: saved?.storageBuilt, huts: saved?.huts, fire: saved?.fire });
    world.trees.forEach((t) => { t.onFallen = () => this.event('treeFall', `${t.lastChopper ?? 'A Mycel'} brought a tree down.`, t, 6); });
    if (saved?.mycel?.length) {
      for (const s of saved.mycel.slice(0, MAX_MYCEL)) this.spawn({ ...s, grown: 1 }, true);
    } else {
      this.spawn({ x: STORAGE_POS.x + 2, z: STORAGE_POS.z - 2, grown: 1 }, true);
    }
    this.world.drawStorage(this.resources);
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
    const e = { type, text, day: this.day, phase: this.phase, x: pos?.x, z: pos?.z };
    this.events.push(e);
    if (pos) this.interest = { x: pos.x, z: pos.z, score, t: performance.now() };
    this.hooks.onEvent?.(e);
  }

  setEmotion(m, emotion, lock = 1.5) {
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
        this.event('creator', 'A spark fell from above and the fire pit caught flame.', FIRE_POS, 8);
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
        this.awareness = Math.min(1, this.awareness + 0.03);
        this.event('watcher', `The Watcher spoke: “${extra}”`, this.centroid(), 8);
        break;
      case 'knowledge':
        this.awareness = Math.min(1, this.awareness + 0.02);
        break;
      default:
    }
    this.world.drawStorage(this.resources);
  }

  discover(what, m) {
    if (this.discoveries.has(what)) return;
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

  maxBirthsToday() {
    if (this.day === 1) return 7;
    return Math.max(2, Math.min(10, Math.floor(this.mycel.length * 0.35)));
  }

  tryReproduce(m) {
    if (m.grown < 1 || this.isNight() || m.hunger > 0.65 || m.stun > 0) return;
    if (m.sporeCd > 0) return;
    const pending = this.sprouts.length;
    if (this.stats.born.length + pending >= this.maxBirthsToday()) { m.sporeCd = 20; return; }
    if (this.mycel.length + pending >= MAX_MYCEL) { m.sporeCd = 40; return; }
    if (this.day > 1 && this.resources.food < 3) { m.sporeCd = 15; return; }
    if (this.day > 1) this.resources.food -= 3;
    m.task = { type: 'spore', t: 0 };
    m.sporeCd = this.day === 1 ? rand(18, 26) : rand(35, 60);
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
    const threat = this.nearestThreat(m);
    if (threat && m.tool !== 'spear') return { type: 'flee', from: threat };
    if (threat && m.tool === 'spear') return { type: 'defend', target: threat };
    if (this.beetles.length && m.tool === 'spear') return { type: 'defend', target: this.nearest(this.beetles, m, (b) => b.state !== 'flee') };
    if (this.isNight()) return { type: 'sleep' };
    if (m.hunger > 0.6) return { type: 'eat' };
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
    if (w.storage.built && !m.tool && R.wood >= 2 && R.stone >= 1) {
      if (axes < Math.ceil(pop / 5)) add(P.craft * 1.5, { type: 'craft', kind: 'axe' });
      const wantSpears = this.day >= 2 || this.stats.threats > 0 || this.discoveries.has('beetles');
      if (wantSpears && spears < Math.ceil(pop / 3)) add((P.craft + P.defend) * 1.3, { type: 'craft', kind: 'spear' });
    }
    // fire
    if (w.fire.discovered && !w.fire.lit && R.wood >= 3) add(this.phase > 0.45 ? 6 : 2.5, { type: 'lightFire' });
    if (w.fire.lit && w.fire.fuel < 0.45 && R.wood >= 1) add(1.6, { type: 'feedFire' });
    // explore / follow
    add(P.explore * (w.fire.discovered ? 0.4 : 1.2), { type: 'explore', target: !w.fire.discovered && Math.random() < 0.35 ? { x: FIRE_POS.x + rand(-1.5, 1.5), z: FIRE_POS.z + rand(-1.5, 1.5) } : w.randomClearingPoint() });
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
    const speed = (1.8 + m.grown * 0.9) * speedMul * (m.energy < 0.2 ? 0.7 : 1);
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
    if (r > CLEARING_R + 3) { m.x *= (CLEARING_R + 3) / r; m.z *= (CLEARING_R + 3) / r; }
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
              if (!this.discoveries.has('stream') && Math.hypot(tg.x, tg.z + 15) < 8) this.discover('stream', m);
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
              if (rival && Math.random() < 0.6) {
                this.setEmotion(m, 'angry', 3); this.setEmotion(rival, 'angry', 3);
                m.tilt = 0.3; rival.tilt = -0.3;
                this.stats.fights++;
                if (this.stats.fights === 1 || Math.random() < 0.3) this.event('fight', `${m.name} and ${rival.name} fought over the last berries.`, m, 7);
                this.hooks.onSound?.('fight', m);
              }
              R.food--; m.hunger = Math.max(0, m.hunger - 0.65); m.starve = 0;
              this.stats.ate++;
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
          if (t.work > 1) { if (w.pickBerry(bush)) { m.hunger = Math.max(0, m.hunger - 0.5); m.starve = 0; this.setEmotion(m, 'happy', 2); } return true; }
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
          const hut = w.huts.find((h) => h.built && h.sleepers < 4);
          if (hut) { hut.sleepers++; t.hut = hut; t.spot = { x: hut.x + rand(-0.6, 0.6), z: hut.z + rand(-0.6, 0.6) }; }
          else {
            const c = w.fire.lit ? FIRE_POS : STORAGE_POS;
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
              site.built = true; this.hutSite = null;
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
            if (t.kind === 'axe') this.discover('tools', m); else this.discover('spears', m);
            this.event('craft', `${m.name} made ${t.kind === 'axe' ? 'a stone axe' : 'a spear'}.`, m, 5);
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
            this.event('fire', `${m.name} lit the fire! Warm light everywhere.`, FIRE_POS, 9);
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
            if (this.mycel.length + this.sprouts.length < MAX_MYCEL && this.stats.born.length + this.sprouts.length < this.maxBirthsToday() + 1) {
              this.event('love', `${m.name} and ${p.name} fell in love. Spores everywhere.`, m, 8);
              m.task = { type: 'spore', t: 0, love: true };
              return false;
            }
            return true;
          }
        }
        return t.t > 12;
      }
      default:
        return true;
    }
  }

  // -------------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------------
  update(dt) {
    const w = this.world;
    this.phase += dt / DAY_SECONDS;
    this.chirpBudget = Math.min(3, this.chirpBudget + dt * 1.2);
    const night = this.isNight();

    // colony-level planning: hut sites
    if (!this.hutSite && w.storage.built && this.resources.wood >= 6 && this.resources.stone >= 2) {
      const want = Math.ceil(this.mycel.length / 4);
      const built = w.huts.length;
      if (built < want && built < HUT_SLOTS.length) {
        const used = new Set(w.huts.map((h) => h.slot));
        const slot = HUT_SLOTS.findIndex((_, i) => !used.has(i));
        if (slot >= 0) {
          this.resources.wood -= 6; this.resources.stone -= 2;
          this.hutSite = w.addHut(slot, 0.02);
          w.drawStorage(this.resources);
          this.event('plan', 'The colony marked a spot for a new hut.', this.hutSite, 4);
        }
      }
    }
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
      if (m.task && !['flee', 'defend'].includes(m.task.type) && this.beetles.length) {
        const th = this.nearestThreat(m, 6);
        if (th) { if (m.task.target?.reservedBy === m.id) m.task.target.reservedBy = null; m.task = null; }
      }
      if (night && m.task && !['sleep', 'flee', 'defend'].includes(m.task.type)) {
        if (m.task.target?.reservedBy === m.id) m.task.target.reservedBy = null;
        if (m.carrying) { this.addCarry(m); }
        m.task = null;
      }
      if (m.grown >= 1 && !night) m.sporeCd -= dt;
      if (!m.task) { this.tryReproduce(m); if (!m.task) m.task = this.chooseTask(m); }
      if (m.task && this.stepTask(m, dt)) {
        if (m.task.target?.reservedBy === m.id) m.task.target.reservedBy = null;
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
    if (this.day === 1 && this.phase > 0.45 && this.phase < NIGHT_START && this.mycel.length + this.sprouts.length < 5) {
      const adult = this.mycel.find((m) => m.grown >= 1 && m.task?.type !== 'spore');
      if (adult && Math.random() < dt * 0.4) { adult.task = { type: 'spore', t: 0 }; }
    }

    // night threats from day 3
    if (this.day >= 3 && !this.beetlesTonight && this.phase > NIGHT_START + 0.02) {
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
    };
  }

  serialize() {
    return {
      day: this.day,
      mycel: this.mycel.map((m) => ({ name: m.name, color: m.color, age: Math.round(m.age), tool: m.tool })),
      resources: { ...this.resources },
      fallenTrees: this.world.trees.filter((t) => t.state !== 'standing').map((t) => t.id),
      storageBuilt: this.world.storage.built,
      huts: this.world.huts.map((h) => ({ slot: h.slot, progress: h.progress, built: h.built })),
      fire: { discovered: this.world.fire.discovered, lit: this.world.fire.lit, fuel: this.world.fire.fuel },
      discoveries: [...this.discoveries],
      awareness: this.awareness,
    };
  }

  /** The most interesting place right now (for the auto camera). */
  focus() {
    const now = performance.now();
    if (this.interest && now - this.interest.t < 7000) return this.interest;
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
