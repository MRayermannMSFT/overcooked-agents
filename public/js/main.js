import { World } from './scene/world.js';
import { BOUNDS } from './scene/layout.js';
import { Effects } from './scene/fx.js';
import { Kitchen } from './scene/kitchen.js';
import { Director } from './director.js';
import { Store, connectLive } from './store.js';
import { DemoShift } from './demo.js';
import { Overlay } from './overlay.js';
import { Hud } from './hud.js';
import { Panels } from './panels.js';
import { Sounds } from './audio.js';

const params = new URLSearchParams(location.search);
const KEY = 'agent-kitchen-settings';
const DEFAULTS = { labels: true, chatter: true, privacy: false, sound: false, roster: false };

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    saved = {};
  }
  const s = { ...DEFAULTS, ...saved };
  for (const k of Object.keys(DEFAULTS)) {
    if (params.has(k)) s[k] = !['0', 'false', 'off', 'no'].includes((params.get(k) || '1').toLowerCase());
  }
  return s;
}

const settings = loadSettings();
const saveSettings = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable (private mode); settings stay in memory
  }
};
const mode = params.has('demo') ? 'demo' : 'live';
document.body.dataset.mode = mode;
document.body.classList.toggle('privacy', settings.privacy);

const canvas = document.getElementById('scene');
let world;
try {
  world = new World(canvas, { quality: params.get('quality') || 'high', bounds: BOUNDS });
} catch (err) {
  document.getElementById('hud').innerHTML = '<div class="empty"><div class="card"><h2>WebGL isn’t available</h2><p>Agent Kitchen needs a browser with WebGL enabled.</p></div></div>';
  throw err;
}
const fx = new Effects(world);
const kitchen = new Kitchen(world, fx);
const director = new Director({ world, kitchen, fx });
const store = new Store({ repo: params.get('repo') });
const overlay = new Overlay(document.getElementById('labels'), { world, kitchen, director, settings });
const hudEl = document.getElementById('hud');
const hud = new Hud(hudEl, { store, director, overlay, settings, mode });
const panels = new Panels(hudEl, { store, director, settings, saveSettings, mode });
const sounds = new Sounds(settings);

store.on('sessions', (list) => director.sync(list));
store.on('fx', (f) => {
  director.onFx(f);
  if (f.kind === 'order' && !f.implicit) sounds.play('order');
  else if (f.kind === 'served') sounds.play('served');
  else if (f.kind === 'failed') sounds.play('failed');
  else if (f.kind === 'fire' && f.severity === 'fire') sounds.play('fire');
});

world.onFrame((dt, t) => {
  director.update(dt, t);
  kitchen.update(dt, t);
  fx.update(dt);
  overlay.update(t);
  hud.update();
});

canvas.addEventListener('click', (ev) => {
  const e = director.pick(ev.clientX, ev.clientY);
  director.selected = e ? (e.sous ? e.sessionId : e.key) : null;
  if (e && !panels.roster.classList.contains('open')) panels.setRoster(true);
  panels.renderRoster();
});
canvas.addEventListener('pointermove', (ev) => {
  canvas.style.cursor = director.pick(ev.clientX, ev.clientY) ? 'pointer' : '';
});

let demo = null;
if (mode === 'demo') {
  demo = new DemoShift(store, {
    seed: Number(params.get('seed')) || Date.now(),
    speed: Number(params.get('speed')) || 1,
    chefs: params.has('chefs') ? Number(params.get('chefs')) || 0 : 4,
    prefill: params.get('prefill') !== '0',
  });
  demo.start();
} else {
  connectLive(store, { onUnavailable: () => store.setConnection('offline') });
}

world.start();
if (!params.has('nointro')) hud.readyGo();

// Handy for debugging and for the screenshot script.
window.__kitchen = { world, kitchen, director, store, hud, panels, fx, settings, demo };
