import { THREE } from './world.js';
import { drawIcon } from '../icons.js';

/** Original palette: warm cedar counters, birch tops, teal water, cherry blossoms. */
export const C = {
  floorA: '#e6cc9c',
  floorB: '#d8b885',
  grout: '#b89466',
  top: '#f1e3c4',
  topEdge: '#dcc7a0',
  body: '#a65f3d',
  bodyPanel: '#8f4e31',
  kick: '#4a3022',
  wall: '#f5eedd',
  wallFrame: '#6e4632',
  beam: '#5a3828',
  stove: '#363b47',
  steel: '#c5ced6',
  steelDark: '#8d98a3',
  white: '#fbfaf6',
  nori: '#22402d',
  salmon: '#ff8a65',
  rice: '#fffdf5',
  tempura: '#f6b73c',
  wood: '#c98d58',
  woodLight: '#e8c9a0',
  crate: '#b97a45',
  crateDark: '#8b5730',
  red: '#e0473c',
  gold: '#f6b400',
  water: '#4fb6c8',
  grass: '#86c06c',
  blossom: '#f7a8c4',
  blossomDark: '#ef8ab0',
  trunk: '#6b4430',
  stone: '#b9b4ad',
  stoneDark: '#8f8a84',
};

const matCache = new Map();

/** Shared MeshStandardMaterial per colour/options (keeps draw state small). */
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, ...opts });
    matCache.set(key, m);
  }
  return m;
}

export function metal(color = C.steel, opts = {}) {
  return mat(color, { roughness: 0.32, metalness: 0.65, ...opts });
}

/** Deterministic pseudo-random generator (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTexture(w, h, draw, { repeat = null, anisotropy = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return `#${c.getHexString()}`;
}

/** Two-tone wooden checker floor: each 256px tile = one kitchen tile, three planks per tile. */
export function floorTexture(tilesX, tilesZ) {
  const r = rng(7);
  return canvasTexture(512, 512, (ctx) => {
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const base = (tx + ty) % 2 ? C.floorB : C.floorA;
        const x0 = tx * 256;
        const y0 = ty * 256;
        for (let p = 0; p < 3; p++) {
          ctx.fillStyle = shade(base, (r() - 0.5) * 0.04);
          const vertical = (tx + ty) % 2 === 0;
          if (vertical) ctx.fillRect(x0 + p * 85.3, y0, 85.3, 256);
          else ctx.fillRect(x0, y0 + p * 85.3, 256, 85.3);
        }
        ctx.strokeStyle = 'rgba(120,80,40,0.18)';
        ctx.lineWidth = 2;
        for (let p = 1; p < 3; p++) {
          ctx.beginPath();
          if ((tx + ty) % 2 === 0) {
            ctx.moveTo(x0 + p * 85.3, y0);
            ctx.lineTo(x0 + p * 85.3, y0 + 256);
          } else {
            ctx.moveTo(x0, y0 + p * 85.3);
            ctx.lineTo(x0 + 256, y0 + p * 85.3);
          }
          ctx.stroke();
        }
        // grain speckles
        for (let i = 0; i < 90; i++) {
          ctx.fillStyle = `rgba(110,70,35,${0.04 + r() * 0.06})`;
          ctx.fillRect(x0 + r() * 256, y0 + r() * 256, 2 + r() * 18, 1.5);
        }
      }
    }
    ctx.strokeStyle = C.grout;
    ctx.lineWidth = 5;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 256, 0);
      ctx.lineTo(i * 256, 512);
      ctx.moveTo(0, i * 256);
      ctx.lineTo(512, i * 256);
      ctx.stroke();
    }
  }, { repeat: [tilesX / 2, tilesZ / 2] });
}

/** Paper shoji screen with a wooden lattice. */
export function shojiTexture(repeatX = 1) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#fffaf0');
    g.addColorStop(1, '#f1e6cf');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = C.wallFrame;
    ctx.lineWidth = 6;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo((i * w) / 4, 0);
      ctx.lineTo((i * w) / 4, h);
      ctx.stroke();
    }
    for (let i = 0; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (i * h) / 3);
      ctx.lineTo(w, (i * h) / 3);
      ctx.stroke();
    }
    ctx.lineWidth = 14;
    ctx.strokeRect(0, 0, w, h);
  }, { repeat: [repeatX, 1] });
}

/** Light birch wood grain for counter tops. */
export function woodTopTexture() {
  const r = rng(11);
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = C.top;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(160,120,70,${0.05 + r() * 0.08})`;
      ctx.lineWidth = 1 + r() * 2;
      const y = r() * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 12, w * 0.7, y + (r() - 0.5) * 12, w, y + (r() - 0.5) * 6);
      ctx.stroke();
    }
  });
}

/** Crate lid: planks with the ingredient painted on top (like the ingredient boxes in cooking games). */
export function lidTexture(icon) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = C.crate;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#c0854f' : '#b5773f';
      ctx.fillRect(0, (i * h) / 4 + 3, w, h / 4 - 6);
    }
    ctx.strokeStyle = C.crateDark;
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = 'rgba(255,248,230,0.92)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 78, 0, Math.PI * 2);
    ctx.fill();
    drawIcon(ctx, icon, w / 2 - 62, h / 2 - 62, 124);
  });
}

/** Sign board with an icon (used above hatches). */
export function signTexture(icon, bg = '#2c3e50', fg = '#ffffff', text = '') {
  return canvasTexture(512, 192, (ctx, w, h) => {
    ctx.fillStyle = bg;
    roundRect(ctx, 6, 6, w - 12, h - 12, 36);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
    drawIcon(ctx, icon, 30, 26, 140);
    if (text) {
      ctx.fillStyle = fg;
      ctx.font = '700 84px Fredoka, "Trebuchet MS", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 190, h / 2 + 4);
    }
  });
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Soft round shadow for grounding chefs and props. */
export function blobTexture() {
  return canvasTexture(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(30,20,10,0.55)');
    g.addColorStop(0.6, 'rgba(30,20,10,0.25)');
    g.addColorStop(1, 'rgba(30,20,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  }, { anisotropy: 1 });
}

/** Conveyor belt stripes (scrolled via texture offset). */
export function beltTexture() {
  return canvasTexture(64, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2f3237';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#454a52';
    for (let i = 0; i < 8; i++) ctx.fillRect(0, i * 32, w, 12);
    ctx.fillStyle = '#f6c343';
    ctx.beginPath();
    ctx.moveTo(w * 0.25, 120);
    ctx.lineTo(w * 0.5, 96);
    ctx.lineTo(w * 0.75, 120);
    ctx.lineTo(w * 0.65, 120);
    ctx.lineTo(w * 0.5, 108);
    ctx.lineTo(w * 0.35, 120);
    ctx.fill();
  }, { repeat: [1, 1], anisotropy: 4 });
}

/** Red paper lantern face with a painted band. */
export function lanternTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e8483a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,20,10,0.35)';
    ctx.lineWidth = 3;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (i * h) / 8);
      ctx.lineTo(w, (i * h) / 8);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,240,200,0.9)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 22, 0, Math.PI * 2);
    ctx.fill();
  });
}
