import { THREE } from './world.js';
import { C, mat, metal, lidTexture } from './materials.js';
import { TOP_Y, box, cyl, sph, at, group, shadow, fishModel, noriSheet, parcel, sack } from './build.js';
import { tileToWorld } from './layout.js';

const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

/** Typical seconds a job takes at each station (drives the cooking progress bar). */
export const EXPECTED_SECONDS = {
  plan: 4, read: 1.5, search: 2, research: 6, install: 25, code: 3, build: 20, test: 25, lint: 10,
  commit: 3, ship: 6, shell: 6, trash: 2, ask: 30,
};

export class StationProp {
  constructor(def, fx) {
    this.def = def;
    this.id = def.id;
    this.type = def.type;
    this.fx = fx;
    const w = tileToWorld(def.tile.x, def.tile.z);
    this.center = new THREE.Vector3(w.x, TOP_Y, w.z);
    this.group = new THREE.Group();
    this.group.position.set(w.x, 0, w.z);
    this.group.rotation.y = def.facing + Math.PI;
    this.anchor = new THREE.Vector3(w.x, TOP_Y + 0.95, w.z);
    this.labelAnchor = new THREE.Vector3(w.x, 0.35, w.z);
    this.users = new Set();
    this.activity = 0;
    this.job = null;
    this.fire = null;
    this.topStyle = 'wood';
    this.animate = null;
    this._v = new THREE.Vector3();
  }

  get busy() {
    return this.users.size > 0;
  }

  /** World position of a point in the prop's local frame (+z faces the chef). */
  local(x, y, z, out = new THREE.Vector3()) {
    this.group.updateMatrixWorld();
    return this.group.localToWorld(out.set(x, y, z));
  }

  startJob(t, expected = EXPECTED_SECONDS[this.type] || 4) {
    this.job = { start: t, expected, ok: null, end: null };
  }

  endJob(t, ok) {
    if (this.job && this.job.end == null) {
      this.job.ok = ok;
      this.job.end = t;
    }
  }

  /** Progress bar state for the HUD, or null when nothing is cooking. */
  progress(t) {
    const j = this.job;
    if (!j) return null;
    if (j.end != null) {
      if (t - j.end > 0.9) {
        this.job = null;
        return null;
      }
      return { value: 1, state: j.ok === false ? 'failed' : 'done' };
    }
    const el = t - j.start;
    const v = 1 - Math.exp((-el / Math.max(0.5, j.expected)) * 1.3);
    return { value: Math.min(0.96, v), state: el > Math.max(45, j.expected * 4) ? 'warn' : 'cooking' };
  }

  ignite(severity, t) {
    const dur = severity === 'fire' ? 6 : 1.6;
    if (this.fire && this.fire.severity === 'fire' && severity !== 'fire') return;
    this.fire = { severity, start: t, until: t + dur };
    if (severity === 'fire' && !this.flames) this.flames = this.makeFlames();
  }

  makeFlames() {
    const g = new THREE.Group();
    const cone = (r, h, color, x, z) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, depthWrite: false }));
      m.geometry.translate(0, h / 2, 0);
      m.position.set(x, 0, z);
      return m;
    };
    g.add(cone(0.24, 0.8, '#ff4d1a', 0, 0), cone(0.17, 0.62, '#ff8f26', 0.15, 0.08), cone(0.16, 0.58, '#ff8f26', -0.15, -0.06), cone(0.11, 0.42, '#ffd23f', 0.03, 0.12), cone(0.1, 0.36, '#ffd23f', -0.06, -0.1));
    g.position.set(0, (this.topStyle === 'none' ? 0.9 : TOP_Y + 0.12), 0);
    g.visible = false;
    this.group.add(g);
    return g;
  }

  extinguish(t) {
    if (this.fire) this.fire.until = Math.min(this.fire.until, t + 0.5);
  }

  get burning() {
    return Boolean(this.fire && this.fire.severity === 'fire');
  }

  update(dt, t) {
    this.activity += ((this.busy ? 1 : 0) - this.activity) * Math.min(1, dt * 5);
    if (this.animate) this.animate(dt, t);
    if (this.flames) {
      const on = Boolean(this.fire && this.fire.severity === 'fire' && t < this.fire.until);
      this.flames.visible = on;
      if (on) {
        const grow = Math.min(1, (t - this.fire.start) * 3) * Math.min(1, (this.fire.until - t) * 1.5);
        this.flames.children.forEach((c, i) => {
          c.scale.set(grow * (1 + Math.cos(t * 17 + i * 2) * 0.12), grow * (1 + Math.sin(t * 21 + i * 1.3) * 0.22), grow * (1 + Math.sin(t * 15 + i) * 0.12));
        });
        this.flames.rotation.y += dt * 2.5;
      }
    }
    if (this.fire) {
      const p = this.local(0, TOP_Y + 0.3, 0, this._v);
      if (t < this.fire.until) {
        if (this.fire.severity === 'fire') {
          this.fx.stream(`${this.id}:f`, 'fire', p, 55, dt);
          this.fx.stream(`${this.id}:e`, 'ember', p, 8, dt);
          p.y += 0.5;
          this.fx.stream(`${this.id}:s`, 'smoke', p, 7, dt);
        } else {
          this.fx.stream(`${this.id}:s`, 'smoke', p, 16, dt);
        }
      } else {
        this.fx.emit('smoke', p, 10);
        this.fire = null;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Builders (part 1). Each adds meshes to p.group and sets p.animate.
// Local frame: +z points toward the chef, y is up from the floor.
// ---------------------------------------------------------------------------

export function buildPlan(p) {
  const stand = at(box(0.58, 0.1, 0.48, mat(C.wood), 0.03), 0, TOP_Y + 0.05, 0);
  const book = new THREE.Group();
  book.position.set(0, TOP_Y + 0.13, 0);
  book.rotation.x = 0.32;
  const pageMat = mat('#fff8ea');
  const pageL = at(box(0.27, 0.035, 0.38, pageMat), -0.14, 0.03, 0);
  pageL.rotation.z = 0.07;
  const pageR = at(box(0.27, 0.035, 0.38, pageMat), 0.14, 0.03, 0);
  pageR.rotation.z = -0.07;
  const lineMat = mat('#c9a76f');
  for (const sx of [-0.14, 0.14]) for (let i = 0; i < 4; i++) book.add(at(box(0.18, 0.004, 0.018, lineMat), sx, 0.05, -0.12 + i * 0.07));
  const flipPivot = new THREE.Group();
  flipPivot.position.set(0, 0.05, 0);
  flipPivot.add(at(box(0.26, 0.008, 0.36, mat('#fffdf7')), 0.13, 0, 0));
  flipPivot.visible = false;
  book.add(at(box(0.6, 0.03, 0.42, mat('#c0392b'), 0.01), 0, 0, 0), pageL, pageR, flipPivot);
  book.add(at(box(0.025, 0.006, 0.22, mat('#f1c40f')), 0.02, 0.05, 0.25));
  const spike = group(
    at(cyl(0.06, 0.07, 0.025, mat(C.wood), 12), 0, 0, 0),
    at(cyl(0.008, 0.008, 0.26, metal(), 6), 0, 0.13, 0),
  );
  for (let i = 0; i < 3; i++) {
    const tk = at(box(0.13, 0.004, 0.17, mat('#fffaf0')), 0, 0.05 + i * 0.045, 0);
    tk.rotation.y = i * 0.5 - 0.4;
    spike.add(tk);
  }
  spike.position.set(0.34, TOP_Y, -0.28);
  p.group.add(shadow(group(stand, book, spike)));
  let phase = 0;
  p.animate = (dt, t) => {
    if (p.activity > 0.4) {
      phase += dt * 0.85;
      flipPivot.visible = true;
      flipPivot.rotation.z = Math.PI * ease(phase % 1);
    } else {
      flipPivot.visible = false;
      phase = 0;
    }
    book.position.y = TOP_Y + 0.13 + Math.sin(t * 3) * 0.006 * p.activity;
  };
}

function buildCrate(p, icon, makeInner) {
  const wood = mat(C.crate);
  const dark = mat(C.crateDark);
  const g = new THREE.Group();
  g.add(at(box(0.86, 0.38, 0.86, wood, 0.025), 0, TOP_Y + 0.19, 0));
  for (const y of [0.07, 0.19, 0.31]) g.add(at(box(0.88, 0.03, 0.88, dark), 0, TOP_Y + y, 0));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(at(box(0.09, 0.4, 0.09, dark, 0.01), sx * 0.41, TOP_Y + 0.2, sz * 0.41));
  const inner = makeInner();
  inner.position.set(0, TOP_Y + 0.3, 0);
  inner.visible = false;
  const pivot = new THREE.Group();
  pivot.position.set(0, TOP_Y + 0.4, -0.43);
  const lidMat = new THREE.MeshStandardMaterial({ map: lidTexture(icon), roughness: 0.85 });
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.9), [wood, wood, lidMat, wood, wood, wood]);
  lid.position.set(0, 0.025, 0.43);
  lid.rotation.y = -p.group.rotation.y; // keep the painted ingredient upright for the camera
  pivot.add(lid);
  g.add(pivot, inner);
  p.group.add(shadow(g));
  p.animate = (dt, t) => {
    const open = p.activity;
    pivot.rotation.x = -open * 1.05;
    inner.visible = open > 0.15;
    inner.position.y = TOP_Y + 0.26 + open * 0.2 + Math.sin(t * 4) * 0.02 * open;
    inner.rotation.y = t * 0.8;
  };
}

export const buildRead = (p) => buildCrate(p, 'nori', () => {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) g.add(at(noriSheet(), 0, i * 0.015, 0));
  return g;
});

export const buildSearch = (p) => buildCrate(p, 'fish', () => fishModel(0.42));

export function buildResearch(p) {
  const g = new THREE.Group();
  g.add(at(box(0.82, 0.05, 0.74, mat(C.wood), 0.015), 0, TOP_Y + 0.025, 0));
  const rollers = [];
  for (let i = 0; i < 5; i++) {
    const r = cyl(0.03, 0.03, 0.7, metal(), 10);
    r.rotation.z = Math.PI / 2;
    r.position.set(0, TOP_Y + 0.07, -0.3 + i * 0.15);
    rollers.push(r);
    g.add(r);
  }
  g.add(at(parcel(0.28), 0.2, TOP_Y + 0.1, 0.18), at(parcel(0.22), 0.17, TOP_Y + 0.33, 0.16));
  const incoming = parcel(0.26);
  incoming.visible = false;
  g.add(incoming);
  p.group.add(shadow(g));
  p.animate = (dt, t) => {
    const active = p.activity > 0.3;
    incoming.visible = active;
    if (active) {
      const k = (t * 0.75) % 1;
      incoming.position.set(-0.12, TOP_Y + 0.1, -0.85 + ease(Math.min(1, k * 1.4)) * 0.8);
      const s = k > 0.85 ? Math.max(0.01, 1 - (k - 0.85) * 6) : 1;
      incoming.scale.setScalar(s);
      for (const r of rollers) r.rotation.x += dt * 8;
    }
  };
}

export function buildInstall(p) {
  const wood = mat(C.wood);
  const g = new THREE.Group();
  g.add(at(box(0.92, 1.05, 0.05, wood), 0, TOP_Y + 0.52, -0.42));
  for (const sx of [-0.44, 0.44]) g.add(at(box(0.05, 1.05, 0.38, wood), sx, TOP_Y + 0.52, -0.25));
  for (const y of [0.48, 0.98]) g.add(at(box(0.92, 0.04, 0.38, wood), 0, TOP_Y + y, -0.25));
  const jarColors = ['#e57373', '#81c784', '#ffd54f'];
  jarColors.forEach((c, i) => {
    const jar = group(at(cyl(0.07, 0.07, 0.17, mat('#f4f1e8', { roughness: 0.3 }), 14), 0, 0.085, 0), at(cyl(0.075, 0.075, 0.04, mat(c), 14), 0, 0.19, 0));
    jar.position.set(-0.28 + i * 0.28, TOP_Y + 0.5, -0.25);
    g.add(jar);
  });
  const shelfSacks = [sack(0.5), sack(0.5)];
  shelfSacks[0].position.set(-0.2, TOP_Y + 1.0, -0.25);
  shelfSacks[1].position.set(0.18, TOP_Y + 1.0, -0.25);
  const bigSack = sack(1.05);
  bigSack.position.set(-0.18, TOP_Y, 0.16);
  const drop = sack(0.6);
  drop.visible = false;
  g.add(...shelfSacks, bigSack, drop);
  p.group.add(shadow(g));
  p.animate = (dt, t) => {
    const a = p.activity;
    bigSack.scale.set(1, 1 + Math.sin(t * 9) * 0.05 * a, 1);
    shelfSacks.forEach((s, i) => (s.rotation.z = Math.sin(t * 7 + i) * 0.08 * a));
    drop.visible = a > 0.3;
    if (drop.visible) {
      const k = (t * 0.6) % 1;
      drop.position.set(0.22, TOP_Y + Math.max(0, 1.2 - k * k * 3), 0.18);
    }
  };
}

export function buildCode(p) {
  const g = new THREE.Group();
  g.add(at(box(0.72, 0.05, 0.5, mat(C.woodLight), 0.015), 0, TOP_Y + 0.025, 0));
  const fish = group(at(box(0.3, 0.08, 0.16, mat(C.salmon, { roughness: 0.45 }), 0.02), 0, 0, 0));
  for (let i = 0; i < 3; i++) fish.add(at(box(0.012, 0.081, 0.161, mat('#ffe0d3')), -0.09 + i * 0.09, 0, 0));
  fish.position.set(-0.1, TOP_Y + 0.09, 0.02);
  const slices = [];
  for (let i = 0; i < 4; i++) {
    const s = box(0.055, 0.05, 0.15, mat(C.salmon, { roughness: 0.45 }), 0.012);
    s.position.set(0.1 + i * 0.065, TOP_Y + 0.075, 0.02);
    s.rotation.z = -0.12;
    slices.push(s);
    g.add(s);
  }
  const knife = new THREE.Group();
  knife.add(at(box(0.36, 0.012, 0.085, metal('#dfe6ea')), -0.18, 0, 0));
  knife.add(at(box(0.14, 0.035, 0.045, mat('#5d4037'), 0.01), 0.07, 0, 0));
  knife.position.set(0.3, TOP_Y + 0.07, -0.16);
  g.add(fish, knife);
  p.group.add(shadow(g));
  p.animate = (dt, t) => {
    const a = p.activity;
    fish.visible = a > 0.2;
    const n = a > 0.2 ? Math.floor((t * 1.6) % 5) : 0;
    slices.forEach((s, i) => (s.visible = i < n));
    if (a > 0.2) {
      knife.rotation.set(0, 0.15, -Math.abs(Math.sin(t * 13)) * 0.55 * a);
      knife.position.set(0.18, TOP_Y + 0.08, 0.02);
    } else {
      knife.rotation.set(0, 0.5, 0);
      knife.position.set(0.3, TOP_Y + 0.06, -0.16);
    }
  };
}

export function buildBuild(p) {
  p.topStyle = 'stove';
  const g = new THREE.Group();
  g.add(at(box(1.02, 0.1, 1.02, mat(C.stove, { roughness: 0.5, metalness: 0.3 }), 0.03), 0, TOP_Y - 0.05, 0));
  const burner = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.025, 8, 28), mat('#1d1f24'));
  burner.rotation.x = Math.PI / 2;
  burner.position.y = TOP_Y + 0.008;
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ff6a2b', transparent: true, opacity: 0, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.26, 32), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = TOP_Y + 0.012;
  const potMat = metal('#b9c3cc');
  const pot = group(
    at(cyl(0.25, 0.23, 0.28, potMat, 28), 0, 0.14, 0),
    at(new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.018, 8, 28), potMat), 0, 0.28, 0),
    at(box(0.12, 0.03, 0.05, mat('#2b2b2b'), 0.01), 0.31, 0.22, 0),
    at(box(0.12, 0.03, 0.05, mat('#2b2b2b'), 0.01), -0.31, 0.22, 0),
  );
  pot.children[1].rotation.x = Math.PI / 2;
  pot.position.y = TOP_Y + 0.02;
  const lid = group(at(cyl(0.26, 0.26, 0.03, potMat, 28), 0, 0, 0), at(sph(0.04, mat('#2b2b2b'), 10, 8), 0, 0.04, 0));
  lid.position.y = TOP_Y + 0.32;
  for (const sx of [-0.22, 0.22]) {
    const knob = cyl(0.05, 0.05, 0.05, mat('#2b2b2b'), 12);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(sx, 0.72, 0.52);
    g.add(knob);
  }
  g.add(burner, glow, pot, lid);
  p.group.add(shadow(g));
  const steamAt = new THREE.Vector3();
  p.animate = (dt, t) => {
    const a = p.activity;
    glowMat.opacity = a * (0.7 + Math.sin(t * 20) * 0.08);
    lid.position.y = TOP_Y + 0.32 + Math.abs(Math.sin(t * 17)) * 0.014 * a;
    lid.rotation.z = Math.sin(t * 23) * 0.04 * a;
    if (a > 0.3) p.fx.stream(`${p.id}:steam`, 'steam', p.local(0.12, TOP_Y + 0.38, 0, steamAt), 9 * a, dt);
  };
}
