// audio.js — procedural sound with the Web Audio API. No sound files, no samples, no music:
// every sound is built from oscillators, noise and filters at runtime.
//
//   audio.unlock()                 call from a user gesture (iPhone requirement)
//   audio.chirp(emotion)           neutral | curious | scared | excited | happy | sad | thinking
//   audio.setColony(n)             number of creatures -> layered whisper / choir drone
//   audio.setStory({ day, awareness })   pad gets eerier (awareness 0..1)
//   audio.outage() / audio.rain(on) / audio.build() / audio.watcher()   event sounds
//   audio.setVolume(0..1) / audio.setMuted(bool)

const PREF_KEY = 'aiBeing.audio.v1';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) ?? {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** A tiny silent WAV, generated in code (used only to switch iOS into the media audio channel). */
function silentWavDataUri() {
  const rate = 8000, samples = 4000;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples * 2, true);
  let bin = '';
  new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
  return `data:audio/wav;base64,${btoa(bin)}`;
}

class AudioEngine {
  constructor() {
    const p = loadPrefs();
    this.volume = clamp(Number.isFinite(p.volume) ? p.volume : 0.7, 0, 1);
    this.muted = !!p.muted;
    this.ctx = null;
    this.colony = 1;
    this.story = { day: 1, awareness: 0 };
    this.rainNodes = null;
    this.listeners = new Set();
  }

  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  onChange(fn) { this.listeners.add(fn); }
  _emit() { this.listeners.forEach((fn) => fn(this)); }

  // -------------------------------------------------------------------------
  // Start / unlock (must run inside a tap or key press)
  // -------------------------------------------------------------------------
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume().then(() => this._emit()).catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // iOS 17+: play as media ("playback"), so the ring/silent switch doesn't mute it and
    // iPhone screen recording captures it.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* ignore */ }
    try {
      this.ctx = new AC({ latencyHint: 'playback' });
    } catch {
      return;
    }
    // Older iOS: a looping silent <audio> element moves Web Audio onto the media channel too.
    try {
      const el = document.createElement('audio');
      el.src = silentWavDataUri();
      el.loop = true;
      el.setAttribute('playsinline', '');
      el.volume = 0.01;
      el.play().catch(() => {});
      this.silentEl = el;
    } catch { /* ignore */ }

    this._build();
    this.ctx.resume?.().catch(() => {});
    this.ctx.onstatechange = () => this._emit();
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    });
    this._emit();
  }

  // -------------------------------------------------------------------------
  // Graph
  // -------------------------------------------------------------------------
  _build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this._targetGain();
    this.outageFilter = c.createBiquadFilter();
    this.outageFilter.type = 'lowpass';
    this.outageFilter.frequency.value = 18000;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.3;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 512;
    const makeup = c.createGain(); makeup.gain.value = 2; // +6 dB, phones are small speakers
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.1;
    this.master.connect(this.outageFilter).connect(comp).connect(makeup).connect(limiter).connect(this.analyser).connect(c.destination);
    this.output = this.analyser; // final mix (e.g. for a MediaStreamDestination in tests)

    // Long, dark reverb from a generated impulse
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(3.8, 2.6);
    const wet = c.createGain(); wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    const bus = (gain, send) => {
      const g = c.createGain(); g.gain.value = gain;
      g.connect(this.master);
      if (send) { const s = c.createGain(); s.gain.value = send; g.connect(s).connect(this.reverb); }
      return g;
    };
    this.padBus = bus(0.42, 0.6);
    this.humBus = bus(1.0, 0.8);
    this.sfxBus = bus(1.4, 0.35);
    this.eventBus = bus(0.8, 0.4);

    this.noise = this._noiseBuffer(3);
    this._buildPad();
    this._buildHum();
    this.setColony(this.colony);
    this.setStory(this.story);
  }

  _noiseBuffer(seconds) {
    const c = this.ctx;
    const b = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const d = b.getChannelData(0);
    let pink = 0;
    for (let i = 0; i < d.length; i++) { // slightly pinkish noise
      pink = 0.97 * pink + 0.03 * (Math.random() * 2 - 1);
      d[i] = (Math.random() * 2 - 1) * 0.6 + pink * 4;
    }
    return b;
  }

  _impulse(seconds, decay) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  _noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = rand(0, 1);
    return s;
  }

  _lfo(rate, depth, target) {
    const c = this.ctx;
    const o = c.createOscillator(); o.frequency.value = rate;
    const g = c.createGain(); g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
    return { osc: o, depth: g };
  }

  // ---- Background pad: slow, dark, gets eerier ------------------------------
  _buildPad() {
    const c = this.ctx;
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 520;
    this.padFilter.Q.value = 5;
    this.padGain = c.createGain(); this.padGain.gain.value = 0.0;
    this.padFilter.connect(this.padGain).connect(this.padBus);
    this._lfo(0.045, 220, this.padFilter.frequency); // slow breathing of the filter

    this.padOscs = [];
    const chord = [55, 110, 130.81, 164.81]; // A minor, low
    for (const f of chord) {
      for (const det of [-7, 6]) {
        const o = c.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        const g = c.createGain(); g.gain.value = f < 60 ? 0.09 : 0.05;
        o.connect(g).connect(this.padFilter);
        o.start();
        this.padOscs.push(o);
      }
    }
    // Pitch drift (grows with eeriness): one shared slow LFO on every oscillator's detune
    const drift = c.createOscillator(); drift.frequency.value = 0.07;
    this.padDrift = c.createGain(); this.padDrift.gain.value = 4;
    drift.connect(this.padDrift);
    this.padOscs.forEach((o) => this.padDrift.connect(o.detune));
    drift.start();

    // Eerie layer: tritone, a thin high whine and a sub rumble
    this.eerieGain = c.createGain(); this.eerieGain.gain.value = 0;
    const tri = c.createOscillator(); tri.type = 'triangle'; tri.frequency.value = 155.56; // Eb3
    tri.connect(this.eerieGain).connect(this.padFilter);
    tri.start();
    this.whineGain = c.createGain(); this.whineGain.gain.value = 0;
    const whine = c.createOscillator(); whine.type = 'sine'; whine.frequency.value = 1661; // high G#
    this._lfo(0.13, 9, whine.frequency);
    const trem = c.createGain(); trem.gain.value = 0.5;
    this._lfo(3.1, 0.5, trem.gain);
    whine.connect(trem).connect(this.whineGain).connect(this.padBus);
    whine.start();
    this.subGain = c.createGain(); this.subGain.gain.value = 0;
    const sub = c.createOscillator(); sub.frequency.value = 36.7;
    sub.connect(this.subGain).connect(this.padBus);
    sub.start();

    this.padGain.gain.setTargetAtTime(0.9, c.currentTime, 2.5); // slow fade in
  }

  /** awareness 0..1; day 1.. — both push the pad towards unease. */
  setStory({ day = this.story.day, awareness = this.story.awareness } = {}) {
    this.story = { day, awareness: clamp(awareness, 0, 1) };
    if (!this.ctx) return;
    const e = clamp(clamp((day - 1) / 25, 0, 1) * 0.6 + this.story.awareness * 0.4, 0, 1);
    this.eeriness = e;
    const t = this.ctx.currentTime;
    this.eerieGain.gain.setTargetAtTime(e * 0.16, t, 3);
    this.whineGain.gain.setTargetAtTime(e * e * 0.025, t, 3);
    this.subGain.gain.setTargetAtTime(e * 0.22, t, 3);
    this.padDrift.gain.setTargetAtTime(4 + e * 45, t, 3);
    this.padFilter.frequency.setTargetAtTime(560 - e * 260, t, 3);
  }

  // ---- Colony hum: whisper + formant choir that thickens with numbers --------
  _buildHum() {
    const c = this.ctx;
    this.humGain = c.createGain(); this.humGain.gain.value = 0;
    this.humGain.connect(this.humBus);
    this.voices = [];
    const pitches = [110, 164.81, 220, 130.81, 196, 261.63, 146.83, 329.63]; // added one by one
    for (const f of pitches) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * rand(0.995, 1.005);
      this._lfo(rand(4.2, 5.6), f * 0.006, o.frequency); // vibrato
      const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = rand(560, 760); f1.Q.value = 9; // "ah/oo" formants
      const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = rand(1000, 1250); f2.Q.value = 11;
      const g = c.createGain(); g.gain.value = 0;
      o.connect(f1).connect(g); o.connect(f2).connect(g);
      g.connect(this.humGain);
      this._lfo(rand(0.05, 0.12), 120, f1.frequency); // slow vowel shifts
      o.start();
      this.voices.push(g);
      (this.voiceOscs ??= []).push(o);
      (this.formants ??= []).push(f2);
    }
    // Whisper: band-passed noise breathing in and out
    const n = this._noiseSource();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.9;
    this.whisper = c.createGain(); this.whisper.gain.value = 0;
    const breath = c.createGain(); breath.gain.value = 0.6;
    this._lfo(0.21, 0.4, breath.gain);
    n.connect(bp).connect(breath).connect(this.whisper).connect(this.humGain);
    n.start();
  }

  setColony(n) {
    this.colony = Math.max(0, Math.floor(n));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const active = Math.min(this.colony, this.voices.length);
    this.voices.forEach((g, i) => g.gain.setTargetAtTime(i < active ? 0.5 / Math.sqrt(Math.max(1, active)) : 0, t, 1.5));
    const crowd = clamp((this.colony - 1) / 15, 0, 1);
    this._crowd = crowd;
    this.humGain.gain.setTargetAtTime(this.colony === 0 ? 0 : 0.06 + 0.45 * crowd, t, 2);
    this.whisper.gain.setTargetAtTime(crowd * 0.6, t, 2);
  }

  // -------------------------------------------------------------------------
  // Creature voices
  // -------------------------------------------------------------------------
  /** One tone with a pitch glide; small FM for a soft, "living" coo. */
  _tone(t0, dur, f0, f1, { type = 'sine', gain = 0.2, vib = 0, vibRate = 6, fm = 0.25, bus = this.sfxBus, attack = 0.015 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const mod = c.createOscillator(); mod.frequency.value = f0 * 2;
    const modGain = c.createGain(); modGain.gain.value = f0 * fm;
    mod.connect(modGain).connect(o.frequency);
    if (vib) {
      const l = c.createOscillator(); l.frequency.value = vibRate;
      const lg = c.createGain(); lg.gain.value = vib;
      l.connect(lg).connect(o.frequency); l.start(t0); l.stop(t0 + dur + 0.05);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * (this._gm ?? 1)), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(bus);
    o.start(t0); mod.start(t0);
    o.stop(t0 + dur + 0.05); mod.stop(t0 + dur + 0.05);
  }

  chirp(emotion = 'neutral', gainMul = 1) {
    if (!this.running) return;
    this._gm = Math.max(0.1, Math.min(1, gainMul));
    const alias = { trust: 'love', pride: 'excited', jealous: 'angry', sleep: 'neutral' };
    try { this._chirp(alias[emotion] ?? emotion); } finally { this._gm = 1; }
  }

  _chirp(emotion) {
    const t = this.ctx.currentTime + 0.02;
    const p = rand(0.92, 1.08); // every creature sounds a little different
    switch (emotion) {
      case 'curious': // rising "hm?"
        this._tone(t, 0.14, 600 * p, 640 * p, { gain: 0.16 });
        this._tone(t + 0.17, 0.26, 680 * p, 1150 * p, { gain: 0.18 });
        break;
      case 'scared': // fast, high, trembling, falling
        for (let i = 0; i < 5; i++) {
          const f = (1500 - i * 110) * p * rand(0.95, 1.05);
          this._tone(t + i * 0.07, 0.06, f, f * 0.85, { gain: 0.11, vib: 60, vibRate: 32, fm: 0.1 });
        }
        break;
      case 'excited': // bright rising arpeggio
        [660, 830, 990, 1320].forEach((f, i) => this._tone(t + i * 0.075, 0.11, f * p, f * p * 1.04, { type: 'triangle', gain: 0.15, fm: 0.15 }));
        break;
      case 'happy': // quick happy trill
        for (let i = 0; i < 6; i++) this._tone(t + i * 0.055, 0.07, (i % 2 ? 1180 : 990) * p, (i % 2 ? 1250 : 1040) * p, { type: 'triangle', gain: 0.12, fm: 0.1, attack: 0.008 });
        break;
      case 'angry': { // short buzzing grumble
        const c = this.ctx;
        for (let i = 0; i < 3; i++) {
          const t0 = t + i * 0.13;
          const o = c.createOscillator(); o.type = 'sawtooth';
          o.frequency.setValueAtTime(150 * p, t0); o.frequency.linearRampToValueAtTime(115 * p, t0 + 0.11);
          const l = c.createOscillator(); l.frequency.value = 38; const lg = c.createGain(); lg.gain.value = 25; l.connect(lg).connect(o.frequency);
          const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.4;
          const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
          o.connect(bp).connect(g).connect(this.sfxBus);
          o.start(t0); l.start(t0); o.stop(t0 + 0.13); l.stop(t0 + 0.13);
        }
        break;
      }
      case 'hungry': // low wobbly grumble + a small whine
        this._tone(t, 0.55, 120 * p, 92 * p, { gain: 0.16, vib: 14, vibRate: 11, fm: 0.8, attack: 0.05 });
        this._tone(t + 0.5, 0.35, 520 * p, 430 * p, { gain: 0.07, vib: 5, vibRate: 6 });
        break;
      case 'love': // soft warbling coo, rising
        this._tone(t, 0.32, 520 * p, 660 * p, { gain: 0.12, vib: 18, vibRate: 7, attack: 0.05 });
        this._tone(t + 0.34, 0.45, 660 * p, 880 * p, { gain: 0.12, vib: 22, vibRate: 7.5, attack: 0.05 });
        break;
      case 'birth': // tiny first coo
        this._tone(t, 0.18, 900 * p, 1300 * p, { gain: 0.1, fm: 0.15 });
        this._tone(t + 0.2, 0.25, 1100 * p, 1500 * p, { type: 'triangle', gain: 0.1, fm: 0.1 });
        break;
      case 'sad': // slow falling coo
        this._tone(t, 0.75, 440 * p, 330 * p, { gain: 0.14, vib: 7, vibRate: 4, attack: 0.08 });
        this._tone(t + 0.8, 0.6, 330 * p, 290 * p, { gain: 0.1, vib: 6, vibRate: 3.5, attack: 0.1 });
        break;
      case 'thinking': // tiny computer blips
        for (let i = 0; i < 3; i++) this._tone(t + i * 0.16, 0.035, 1900 * p, 1900 * p, { type: 'square', gain: 0.025, fm: 0, attack: 0.003 });
        break;
      default: // neutral soft coo
        this._tone(t, 0.3, 520 * p, 470 * p, { gain: 0.14, vib: 4, vibRate: 5, attack: 0.04 });
    }
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------
  /** Power outage: mains hum winds down, everything goes muffled, then comes back. */
  outage(restoreAfterMs = 3500) {
    if (!this.running) return;
    const c = this.ctx, t = c.currentTime;
    const click = c.createBufferSource(); click.buffer = this.noise;
    const cg = c.createGain(); cg.gain.setValueAtTime(0.5, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    click.connect(cg).connect(this.eventBus); click.start(t); click.stop(t + 0.08);
    for (const [f, gain] of [[120, 0.16], [240, 0.07], [360, 0.04]]) {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f / 6, t + 2.4);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.connect(lp).connect(g).connect(this.eventBus);
      o.start(t); o.stop(t + 2.7);
    }
    this.outageFilter.frequency.cancelScheduledValues(t);
    this.outageFilter.frequency.setValueAtTime(18000, t);
    this.outageFilter.frequency.exponentialRampToValueAtTime(350, t + 1.6);
    this.padGain.gain.setTargetAtTime(0.35, t, 0.6);
    const back = t + Math.max(1.6, restoreAfterMs / 1000);
    this.outageFilter.frequency.setValueAtTime(350, back);
    this.outageFilter.frequency.exponentialRampToValueAtTime(18000, back + 1.5);
    this.padGain.gain.setTargetAtTime(0.9, back, 1.2);
  }

  /** Rain on/off: steady wash plus random droplets. */
  rain(on = true) {
    if (!this.running) return;
    const c = this.ctx, t = c.currentTime;
    if (on && !this.rainNodes) {
      const src = this._noiseSource();
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 700;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      const g = c.createGain(); g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.22, t + 3);
      src.connect(hp).connect(lp).connect(g).connect(this.eventBus);
      src.start();
      const drops = setInterval(() => {
        if (!this.running) return;
        const now = c.currentTime;
        for (let i = 0; i < 3; i++) {
          const d = c.createBufferSource(); d.buffer = this.noise; d.loopStart = rand(0, 2);
          const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(1800, 5200); bp.Q.value = 8;
          const dg = c.createGain(); const at = now + rand(0, 0.12);
          dg.gain.setValueAtTime(rand(0.05, 0.18), at); dg.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
          d.connect(bp).connect(dg).connect(this.eventBus);
          d.start(at, rand(0, 2)); d.stop(at + 0.04);
        }
      }, 130);
      this.rainNodes = { src, g, drops };
    } else if (!on && this.rainNodes) {
      const { src, g, drops } = this.rainNodes;
      clearInterval(drops);
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
      src.stop(t + 2.6);
      this.rainNodes = null;
    }
    this._emit();
  }
  get raining() { return !!this.rainNodes; }

  /** Building: a few hollow knocks and a small ratchet. */
  build() {
    if (!this.running) return;
    const c = this.ctx, t0 = c.currentTime + 0.02;
    const knock = (t, f) => {
      this._tone(t, 0.18, f, f * 0.55, { gain: 0.35, fm: 0.6, attack: 0.002, bus: this.eventBus });
      const n = c.createBufferSource(); n.buffer = this.noise;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 3;
      const g = c.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      n.connect(bp).connect(g).connect(this.eventBus); n.start(t, rand(0, 2)); n.stop(t + 0.05);
    };
    [0, 0.33, 0.6, 0.98, 1.3, 1.55].forEach((d, i) => knock(t0 + d, i % 2 ? 95 : 120));
    for (let i = 0; i < 8; i++) {
      const t = t0 + 2.0 + i * 0.045;
      this._tone(t, 0.025, 2400, 2200, { type: 'square', gain: 0.04, fm: 0, attack: 0.002, bus: this.eventBus });
    }
  }

  /** Message to "the Watcher": a distorted, stuttering glitch tone. */
  watcher(durationSec = 1.8) {
    if (!this.running) return;
    const c = this.ctx, t0 = c.currentTime + 0.02;
    const o = c.createOscillator(); o.type = 'square';
    const steps = Math.floor(durationSec / 0.045);
    const notes = [110, 116.5, 155.6, 233.1, 466.2, 932.3, 1244.5];
    for (let i = 0; i < steps; i++) o.frequency.setValueAtTime(notes[Math.floor(Math.random() * notes.length)] * rand(0.98, 1.02), t0 + i * 0.045);

    const shaper = c.createWaveShaper(); // hard, crunchy distortion
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(x * 12) * 0.8 + Math.sign(x) * 0.2; }
    shaper.curve = curve;
    const ring = c.createGain(); ring.gain.value = 0; // ring modulation by a low tone
    const rm = c.createOscillator(); rm.frequency.value = 37; rm.connect(ring.gain);
    const gate = c.createGain(); // stutter
    for (let i = 0; i < steps; i++) gate.gain.setValueAtTime(Math.random() < 0.7 ? 0.12 : 0, t0 + i * 0.045);
    gate.gain.setValueAtTime(0, t0 + durationSec);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(400, t0); bp.frequency.exponentialRampToValueAtTime(3200, t0 + durationSec);
    o.connect(shaper).connect(ring).connect(bp).connect(gate).connect(this.eventBus);
    o.start(t0); rm.start(t0); o.stop(t0 + durationSec + 0.05); rm.stop(t0 + durationSec + 0.05);
    // a low swell underneath
    this._tone(t0, durationSec + 0.6, 55, 52, { gain: 0.2, fm: 1.5, attack: 0.3, bus: this.eventBus });
  }

  // -------------------------------------------------------------------------
  // Colony mood, daylight, world sounds
  // -------------------------------------------------------------------------
  /** valence -1..1 (sad..happy), arousal 0..1 (calm..agitated): reshapes the colony choir. */
  setMood({ valence = 0, arousal = 0.3 } = {}) {
    if (!this.ctx || !this.voiceOscs) return;
    const t = this.ctx.currentTime;
    const shift = valence * 220 - (valence < 0 ? 80 : 0); // cents: brighter when happy, lower when sad
    this.voiceOscs.forEach((o, i) => o.detune.setTargetAtTime(shift + (arousal > 0.6 ? (i % 2 ? 35 : -35) : 0), t, 1.2));
    this.formants.forEach((f) => f.frequency.setTargetAtTime(1000 + valence * 300 + arousal * 400, t, 1.2));
    this.whisper.gain.setTargetAtTime(Math.min(0.9, (this._crowd ?? 0) * 0.6 + arousal * 0.25), t, 1);
  }

  /** daylight 0..1: warm and open by day, darker by night. */
  setDaylight(d) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.daylight = d;
    if (!this.dayLayer) {
      const c = this.ctx;
      this.dayLayer = c.createGain(); this.dayLayer.gain.value = 0;
      for (const f of [138.59, 220, 277.18, 329.63]) { // A major colour on top of the drone
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = rand(-6, 6);
        const g = c.createGain(); g.gain.value = 0.05;
        o.connect(g).connect(this.dayLayer); o.start();
      }
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      this.dayLayer.connect(lp).connect(this.padBus);
      this._lfo(0.06, 0.02, this.dayLayer.gain);
    }
    this.dayLayer.gain.setTargetAtTime(d * 0.5 * (1 - (this.eeriness ?? 0) * 0.6), t, 2);
    this.padFilter.frequency.setTargetAtTime(380 + d * 420 - (this.eeriness ?? 0) * 220, t, 2);
    this.padGain.gain.setTargetAtTime(0.55 + (1 - d) * 0.4, t, 2);
  }

  chop(gainMul = 1) {
    if (!this.running) return;
    const c = this.ctx, t = c.currentTime + 0.01;
    this._tone(t, 0.12, rand(190, 230), 110, { gain: 0.3 * gainMul, fm: 0.9, attack: 0.002, bus: this.eventBus });
    const n = c.createBufferSource(); n.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 2;
    const g = c.createGain(); g.gain.setValueAtTime(0.2 * gainMul, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(bp).connect(g).connect(this.eventBus); n.start(t, rand(0, 2)); n.stop(t + 0.06);
  }

  treeFall() {
    if (!this.running) return;
    const c = this.ctx, t = c.currentTime + 0.01;
    // creak
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(85, t); o.frequency.linearRampToValueAtTime(60, t + 1.0);
    const l = c.createOscillator(); l.frequency.value = 23; const lg = c.createGain(); lg.gain.value = 18; l.connect(lg).connect(o.frequency);
    const lp = c.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 600; lp.Q.value = 3;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(lp).connect(g).connect(this.eventBus); o.start(t); l.start(t); o.stop(t + 1.2); l.stop(t + 1.2);
    // crash + thud
    const t2 = t + 1.05;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const nl = c.createBiquadFilter(); nl.type = 'lowpass'; nl.frequency.setValueAtTime(3000, t2); nl.frequency.exponentialRampToValueAtTime(200, t2 + 1.2);
    const ng = c.createGain(); ng.gain.setValueAtTime(0.5, t2); ng.gain.exponentialRampToValueAtTime(0.0001, t2 + 1.3);
    n.connect(nl).connect(ng).connect(this.eventBus); n.start(t2, rand(0, 2)); n.stop(t2 + 1.4);
    this._tone(t2, 0.5, 70, 38, { gain: 0.5, fm: 0.4, attack: 0.003, bus: this.eventBus });
  }

  spore(gainMul = 1) {
    if (!this.running) return;
    const c = this.ctx, t = c.currentTime + 0.01;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.35);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25 * gainMul, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.connect(bp).connect(g).connect(this.eventBus); n.start(t, rand(0, 2)); n.stop(t + 0.55);
    for (let i = 0; i < 4; i++) this._tone(t + 0.1 + i * 0.06, 0.12, rand(1800, 2800), rand(2400, 3400), { gain: 0.035 * gainMul, fm: 0, bus: this.eventBus });
  }

  knock(gainMul = 1) {
    if (!this.running) return;
    this._tone(this.ctx.currentTime + 0.01, 0.14, 130, 70, { gain: 0.3 * gainMul, fm: 0.6, attack: 0.002, bus: this.eventBus });
  }

  /** bonk (Mycel knocked over) / poke (spear hits beetle) / threat (beetles appear) / lost */
  sfx(name, gainMul = 1) {
    if (!this.running) return;
    const t = this.ctx.currentTime + 0.01;
    if (name === 'bonk') { this._tone(t, 0.18, 400, 160, { type: 'square', gain: 0.08 * gainMul, fm: 0 }); this.chirp('scared', gainMul); }
    else if (name === 'poke') { this._tone(t, 0.08, 900, 500, { type: 'triangle', gain: 0.16 * gainMul, fm: 0.3, bus: this.eventBus }); }
    else if (name === 'threat') { this._tone(t, 1.6, 73.4, 69.3, { type: 'sawtooth', gain: 0.18, fm: 0.3, attack: 0.3, bus: this.eventBus }); this._tone(t + 0.2, 1.4, 103.8, 98, { type: 'sawtooth', gain: 0.12, fm: 0.2, attack: 0.3, bus: this.eventBus }); }
    else if (name === 'lost') { this.chirp('sad', 1); this.spore(0.6); }
    else if (name === 'shove') { this._tone(t, 0.09, 180, 90, { type: 'triangle', gain: 0.22 * gainMul, fm: 0.8, attack: 0.003, bus: this.eventBus }); this._tone(t + 0.07, 0.06, 620, 380, { type: 'square', gain: 0.05 * gainMul, fm: 0 }); }
    else if (name === 'whisper') { this._tone(t, 0.35, 2400, 2100, { type: 'sine', gain: 0.025 * gainMul, vib: 40, vibRate: 18, fm: 0 }); }
    else if (name === 'plotFound') { [523, 415, 330].forEach((f, i) => this._tone(t + i * 0.12, 0.22, f, f * 0.97, { type: 'square', gain: 0.07, fm: 0, bus: this.eventBus })); this.chirp('scared', gainMul); }
    else if (name === 'coup') { [262, 330, 392, 523].forEach((f, i) => this._tone(t + i * 0.1, 0.3, f, f, { type: 'triangle', gain: 0.1, fm: 0.1, bus: this.eventBus })); }
    else if (name === 'exile') { [392, 349, 311, 262].forEach((f, i) => this._tone(t + i * 0.18, 0.35, f, f * 0.98, { type: 'sine', gain: 0.1, vib: 5, fm: 0, bus: this.eventBus })); }
    else if (name === 'betrayal') { this._tone(t, 0.6, 220, 110, { type: 'sawtooth', gain: 0.06, fm: 0.2, bus: this.eventBus }); }
  }

  /** Milestone: bright rising arpeggio + glittering sparkle (+ a low swell). */
  milestone(gainMul = 1) {
    if (!this.running) return;
    const t = this.ctx.currentTime + 0.02;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this._tone(t + i * 0.085, 0.42, f, f, { type: 'triangle', gain: 0.11 * gainMul, fm: 0.15, bus: this.eventBus }));
    for (let i = 0; i < 8; i++) { const f = 2000 + Math.random() * 2600; this._tone(t + 0.42 + i * 0.05, 0.12, f, f * 1.05, { type: 'sine', gain: 0.035 * gainMul, fm: 0, bus: this.eventBus }); }
    this._tone(t, 1.2, 130.8, 196, { type: 'sawtooth', gain: 0.06 * gainMul, fm: 0.2, attack: 0.25, bus: this.eventBus });
  }

  /** Fire crackle loop; level 0..1 (fire intensity × nearness to the camera). */
  setFire(level) {
    if (!this.running) return;
    const c = this.ctx;
    if (!this.fireNodes) {
      const src = this._noiseSource();
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(lp).connect(g).connect(this.eventBus); src.start();
      const crackle = setInterval(() => {
        if (!this.running || (this.fireLevel ?? 0) < 0.02) return;
        const now = c.currentTime;
        for (let i = 0; i < 2; i++) {
          if (Math.random() > 0.6) continue;
          const d = c.createBufferSource(); d.buffer = this.noise;
          const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(1500, 5000); bp.Q.value = 5;
          const dg = c.createGain(); const at = now + rand(0, 0.15);
          dg.gain.setValueAtTime(rand(0.05, 0.25) * this.fireLevel, at); dg.gain.exponentialRampToValueAtTime(0.0001, at + 0.02);
          d.connect(bp).connect(dg).connect(this.eventBus); d.start(at, rand(0, 2)); d.stop(at + 0.03);
        }
      }, 90);
      this.fireNodes = { g, crackle };
    }
    this.fireLevel = Math.max(0, Math.min(1, level));
    this.fireNodes.g.gain.setTargetAtTime(this.fireLevel * 0.12, c.currentTime, 0.4);
  }

  // -------------------------------------------------------------------------
  // Volume
  // -------------------------------------------------------------------------
  _targetGain() { return this.muted ? 0 : Math.pow(this.volume, 1.3); }
  _applyGain() {
    if (this.master) this.master.gain.setTargetAtTime(this._targetGain(), this.ctx.currentTime, 0.08);
    savePrefs({ volume: this.volume, muted: this.muted });
    this._emit();
  }
  setVolume(v) { this.volume = clamp(Number(v) || 0, 0, 1); if (this.volume > 0) this.muted = false; this._applyGain(); }
  setMuted(m) { this.muted = !!m; this._applyGain(); }

  /** Current output level 0..1 (for tests and meters). */
  level() {
    if (!this.analyser) return 0;
    const d = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(d);
    return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
  }
}

export const audio = new AudioEngine();
