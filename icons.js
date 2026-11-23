// icons.js — everything drawn on small canvases: pixel faces for the Mycel screens,
// emote bubbles (readable from the top-down camera) and task icons over their heads.
import * as THREE from './vendor/three.module.js';

export const EMOTIONS = ['neutral', 'happy', 'curious', 'scared', 'angry', 'sad', 'hungry', 'love', 'sleep'];

// Screen colour per emotion, so moods read even when the faces are tiny.
export const FACE_COLORS = {
  neutral: '#8dffe0', happy: '#8dffb0', curious: '#7fe8ff', scared: '#e8f4ff', angry: '#ff6a55',
  sad: '#7fa8ff', hungry: '#ffb35c', love: '#ff8fd0', sleep: '#5fbfa8', blink: '#8dffe0',
};

// Pixel faces on a 32×32 grid; p(x, y, w, h) lights pixels.
const HEART = ['.#.#.', '#####', '#####', '.###.', '..#..'];
const FACES = {
  neutral: (p) => { p(8, 10, 4, 7); p(20, 10, 4, 7); p(12, 22, 8, 2); },
  blink: (p) => { p(8, 15, 4, 2); p(20, 15, 4, 2); p(12, 22, 8, 2); },
  happy: (p) => {
    for (const cx of [10, 22]) { p(cx - 4, 15, 2, 2); p(cx - 2, 12, 2, 3); p(cx, 11, 1, 2); p(cx + 1, 12, 2, 3); p(cx + 3, 15, 2, 2); }
    p(7, 19, 2, 2); p(9, 21, 2, 2); p(11, 23, 10, 2); p(21, 21, 2, 2); p(23, 19, 2, 2);
  },
  curious: (p) => {
    p(6, 9, 8, 2); p(6, 17, 8, 2); p(6, 11, 2, 6); p(12, 11, 2, 6); p(9, 12, 2, 3);
    p(20, 12, 4, 5);
    p(13, 21, 5, 2); p(13, 26, 5, 2); p(11, 23, 2, 3); p(18, 23, 2, 3);
    p(24, 2, 4, 2); p(27, 4, 2, 3); p(25, 7, 2, 2); p(25, 10, 2, 2);
  },
  scared: (p) => {
    for (const x of [5, 19]) { p(x, 8, 8, 2); p(x, 17, 8, 2); p(x, 10, 2, 7); p(x + 6, 10, 2, 7); p(x + 3, 12, 2, 2); }
    for (let i = 0; i < 6; i++) p(9 + i * 2, 23 + (i % 2) * 2, 2, 2);
  },
  angry: (p) => {
    p(5, 8, 3, 2); p(8, 10, 3, 2); p(11, 12, 2, 2);
    p(24, 8, 3, 2); p(21, 10, 3, 2); p(19, 12, 2, 2);
    p(7, 15, 5, 3); p(20, 15, 5, 3);
    p(9, 25, 2, 2); p(11, 23, 10, 2); p(21, 25, 2, 2);
  },
  sad: (p) => {
    p(5, 10, 3, 2); p(8, 11, 3, 2); p(11, 12, 1, 2);
    p(24, 10, 3, 2); p(21, 11, 3, 2); p(20, 12, 1, 2);
    p(8, 15, 4, 4); p(20, 15, 4, 4);
    p(9, 26, 2, 2); p(11, 24, 10, 2); p(21, 26, 2, 2);
    p(9, 20, 2, 3);
  },
  hungry: (p) => {
    p(8, 12, 4, 3); p(20, 12, 4, 3);
    p(12, 19, 8, 2); p(12, 27, 8, 2); p(10, 21, 2, 6); p(20, 21, 2, 6);
    p(19, 29, 2, 2);
  },
  love: (p) => {
    for (const ox of [5, 19]) HEART.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') p(ox + x * 2, 9 + y * 2, 2, 2); }));
    p(11, 23, 2, 2); p(13, 25, 6, 2); p(19, 23, 2, 2);
  },
  sleep: (p) => { p(7, 16, 6, 2); p(19, 16, 6, 2); p(13, 23, 6, 2); p(23, 3, 6, 2); p(26, 5, 2, 2); p(24, 7, 2, 2); p(23, 9, 6, 2); },
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, nearest = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; }
  return t;
}

function drawFace(g, name, ox, oy, scale, color) {
  const fn = FACES[name] ?? FACES.neutral;
  g.fillStyle = color;
  fn((x, y, w = 1, h = 1) => g.fillRect(ox + x * scale, oy + y * scale, w * scale, h * scale));
}

/** Texture for a Mycel's screen (64×64, pixel face on a dark glass). */
const faceCache = {};
export function faceTexture(name) {
  if (faceCache[name]) return faceCache[name];
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#071816'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(141,255,224,0.06)';
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 64, 2);
  const col = FACE_COLORS[name] ?? FACE_COLORS.neutral;
  g.globalAlpha = 0.28; drawFace(g, name, -1, -1, 2, col); drawFace(g, name, 1, 1, 2, col);
  g.globalAlpha = 1; drawFace(g, name, 0, 0, 2, col);
  return (faceCache[name] = tex(c));
}

/** Emote bubble: white bubble with a small screen face (or a heart for love). */
const bubbleCache = {};
export function bubbleTexture(name) {
  if (bubbleCache[name]) return bubbleCache[name];
  const [c, g] = canvas(96, 112);
  g.fillStyle = 'rgba(255,255,255,0.96)';
  g.beginPath(); g.arc(48, 46, 44, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(38, 84); g.lineTo(48, 108); g.lineTo(58, 84); g.fill();
  g.lineWidth = 5; g.strokeStyle = FACE_COLORS[name] ?? '#8dffe0';
  g.beginPath(); g.arc(48, 46, 41, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#0b2420'; g.beginPath(); g.arc(48, 46, 34, 0, Math.PI * 2); g.fill();
  drawFace(g, name, 16, 14, 2, FACE_COLORS[name] ?? FACE_COLORS.neutral);
  return (bubbleCache[name] = tex(c, false));
}

// Task icons as tiny pixel maps (12×12). Letters pick colours.
const PAL = { w: '#ffffff', b: '#8a5a3a', d: '#5a3a24', g: '#b9c2c8', s: '#8d969c', r: '#ff4f6d', p: '#8e4dff', o: '#ff9a2e', y: '#ffd84a', k: '#2a2a2a', l: '#7fe86a', c: '#7fe8ff' };
const ICONS = {
  axe: ['....gg......', '...gggg.....', '..ggggg.....', '..gggbd.....', '...gg.bd....', '.......bd...', '........bd..', '.........bd.', '..........bd', '............', '............', '............'],
  berry: ['.....l......', '....ll......', '...l.l......', '..rr..pp....', '.rrrr.ppp...', '.rrwr.pwp...', '.rrrr.ppp...', '..rr...p....', '....rr......', '...rrrr.....', '...rwrr.....', '....rr......'],
  wood: ['............', '............', '..bbbbbbbbb.', '.bdbbbbbbbbb', '.bbdbbbbbbbb', '..bbbbbbbbb.', '...bbbbbbbbb', '..bdbbbbbbbb', '..bbdbbbbbbb', '...bbbbbbbb.', '............', '............'],
  stone: ['............', '............', '....gggg....', '...ggggss...', '..ggwgggss..', '..gggggsss..', '.gggggssss..', '.ggggsssss..', '..sssssss...', '............', '............', '............'],
  fire: ['.....o......', '....oo......', '....oyo.....', '...oyyo..o..', '..ooyyoo.o..', '..oyyyyoo...', '.ooyywyyoo..', '.oyywwwyyo..', '.oyywwwyyo..', '..oyyyyyo...', '...bbbbb....', '..bd...db...'],
  hammer: ['..ggggg.....', '.gggggggs...', '.gggggggs...', '..ssbss.....', '....bd......', '....bd......', '....bd......', '....bd......', '....bd......', '....bd......', '....dd......', '............'],
  spear: ['..........ww', '.........wgw', '........wgg.', '.......gg...', '......bd....', '.....bd.....', '....bd......', '...bd.......', '..bd........', '.bd.........', 'bd..........', '............'],
  sleep: ['............', '...cccccc...', '.......cc...', '......cc....', '.....cc.....', '....cc......', '...cccccc...', '........ccc.', '.........c..', '........ccc.', '............', '............'],
  alert: ['.....rr.....', '.....rr.....', '.....rr.....', '.....rr.....', '.....rr.....', '.....rr.....', '.....rr.....', '............', '.....rr.....', '.....rr.....', '............', '............'],
  explore: ['....cccc....', '...cc..cc...', '.......cc...', '......cc....', '.....cc.....', '.....cc.....', '............', '.....cc.....', '.....cc.....', '............', '............', '............'],
  heart: ['............', '..rr...rr...', '.rrrr.rrrr..', '.rwrrrrrrr..', '.rrrrrrrrr..', '..rrrrrrr...', '...rrrrr....', '....rrr.....', '.....r......', '............', '............', '............'],
  bolt: ['......yy....', '.....yy.....', '....yy......', '...yyyy.....', '..yyyyyyy...', '.....yyy....', '....yy......', '...yy.......', '..yy........', '.yy.........', '............', '............'],
  whisper: ['............', '.wwwwwwwww..', 'wwkwwkwwkww.', 'wwwwwwwwwww.', '.wwwwwwwww..', '...ww.......', '..w.........', '............', '.....c..c...', '....c....c..', '.....c..c...', '............'],
  crown: ['............', '............', '.y...y...y..', '.yy.yyy.yy..', '.yyyyyyyyy..', '.yyryyyryy..', '.yyyyyyyyy..', '.yyyyyyyyy..', '............', '............', '............', '............'],
  bandage: ['............', '.......ww...', '......wwww..', '.....wwgwww.', '....wwwwwww.', '...wwgwgww..', '..wwwwwww...', '.wwwgwww....', '.wwwwww.....', '..wwww......', '...ww.......', '............'],
  spore: ['............', '...p....p...', '.....p......', '..p..pp..p..', '....pppp....', '...pppppp...', '....pppp....', '..p..pp..p..', '.....p......', '...p....p...', '............', '............'],
};
export const ICON_NAMES = Object.keys(ICONS);

const iconCache = {};
export function iconTexture(name) {
  if (iconCache[name]) return iconCache[name];
  const [c, g] = canvas(64, 64);
  g.fillStyle = 'rgba(22,40,30,0.88)';
  g.beginPath(); g.roundRect(4, 4, 56, 56, 14); g.fill();
  g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.stroke();
  const map = ICONS[name] ?? ICONS.explore;
  map.forEach((row, y) => [...row].forEach((ch, x) => {
    if (PAL[ch]) { g.fillStyle = PAL[ch]; g.fillRect(8 + x * 4, 8 + y * 4, 4, 4); }
  }));
  return (iconCache[name] = tex(c));
}

/** Data-URL version of an icon for HTML (resource bar, buttons). */
export function iconDataUrl(name) {
  const [c, g] = canvas(24, 24);
  const map = ICONS[name] ?? ICONS.explore;
  map.forEach((row, y) => [...row].forEach((ch, x) => {
    if (PAL[ch]) { g.fillStyle = PAL[ch]; g.fillRect(x * 2, y * 2, 2, 2); }
  }));
  return c.toDataURL();
}

/** Soft round glow (spores, light pools). */
let glowTex;
export function glowTexture() {
  if (glowTex) return glowTex;
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return (glowTex = tex(c, false));
}
