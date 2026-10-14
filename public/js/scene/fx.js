import { THREE } from './world.js';

const VERT = /* glsl */ `
  attribute float size;
  attribute vec4 tint;
  uniform float uScale;
  varying vec4 vTint;
  void main() {
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uScale / max(0.001, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform float uSoft;
  varying vec4 vTint;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float a = 1.0 - smoothstep(uSoft, 1.0, d);
    gl_FragColor = vec4(vTint.rgb, vTint.a * a);
  }
`;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const PRESETS = {
  steam: { layer: 'soft', life: [1.1, 1.7], size: [0.3, 0.95], color: ['#ffffff', '#f4f7fa'], alpha: [0.5, 0], vy: [0.55, 0.95], spread: 0.14, jitter: 0.12, gravity: -0.05 },
  smoke: { layer: 'soft', life: [1.5, 2.3], size: [0.45, 1.5], color: ['#4f4f55', '#6d6d72', '#3a3a3e'], alpha: [0.6, 0], vy: [0.6, 1.05], spread: 0.25, jitter: 0.2 },
  fire: { layer: 'glow', life: [0.4, 0.75], size: [0.6, 0.12], color: ['#ff4d1a', '#ff8f26', '#ffcc33'], alpha: [0.95, 0], vy: [1.0, 1.8], spread: 0.24, jitter: 0.25 },
  ember: { layer: 'glow', life: [0.6, 1.1], size: [0.11, 0.03], color: ['#ffd04a', '#ff9a2e'], alpha: [1, 0], vy: [1.4, 2.4], spread: 0.3, jitter: 0.6 },
  bubble: { layer: 'soft', life: [0.4, 0.8], size: [0.07, 0.15], color: ['#ffffff', '#fff3c4'], alpha: [0.95, 0], vy: [0.2, 0.5], spread: 0.18, jitter: 0.1 },
  water: { layer: 'soft', life: [0.4, 0.7], size: [0.08, 0.14], color: ['#bfe9ff', '#e6f7ff'], alpha: [0.9, 0], vy: [0.3, 0.8], spread: 0.15, jitter: 0.5, gravity: 4 },
  foam: { layer: 'soft', life: [0.45, 0.85], size: [0.2, 0.5], color: ['#ffffff', '#eef7ff'], alpha: [0.95, 0], vy: [0.2, 0.6], spread: 0.05, jitter: 0.3, gravity: 1.8, drag: 1.4 },
  dust: { layer: 'soft', life: [0.35, 0.6], size: [0.16, 0.42], color: ['#efe4cf', '#e2d4b8'], alpha: [0.65, 0], vy: [0.15, 0.45], spread: 0.08, jitter: 0.35 },
  sparkle: { layer: 'glow', life: [0.6, 1.1], size: [0.2, 0.02], color: ['#fff6a8', '#ffd54f', '#ffffff'], alpha: [1, 0], vy: [1.5, 3.2], spread: 0.1, jitter: 2.2, gravity: 4.5 },
  poof: { layer: 'soft', life: [0.45, 0.8], size: [0.35, 1.1], color: ['#ffffff', '#f2f2f2'], alpha: [0.9, 0], vy: [0.2, 1.0], spread: 0.25, jitter: 1.6, drag: 2.5 },
  zap: { layer: 'glow', life: [0.3, 0.5], size: [0.25, 0.05], color: ['#9be7ff', '#ffffff'], alpha: [1, 0], vy: [0.5, 1.5], spread: 0.1, jitter: 1.5 },
};

class Layer {
  constructor(scene, max, blending) {
    this.max = max;
    this.cursor = 0;
    this.p = Array.from({ length: max }, () => ({ alive: false }));
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.tint = new Float32Array(max * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.tint, 4).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 }, uSoft: { value: blending === THREE.AdditiveBlending ? 0.0 : 0.35 } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 3 : 2;
    scene.add(this.points);
    this.geometry = g;
  }

  spawn(init) {
    const p = this.p[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    Object.assign(p, init, { alive: true, age: 0 });
  }

  update(dt) {
    const c = new THREE.Color();
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.alive) {
        p.age += dt;
        if (p.age >= p.life) p.alive = false;
      }
      if (!p.alive) {
        this.size[i] = 0;
        this.tint[i * 4 + 3] = 0;
        continue;
      }
      const t = p.age / p.life;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vz *= k;
        p.vy *= k;
      }
      p.vy -= (p.gravity || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.s0 + (p.s1 - p.s0) * t;
      c.set(p.color);
      this.tint[i * 4] = c.r;
      this.tint[i * 4 + 1] = c.g;
      this.tint[i * 4 + 2] = c.b;
      this.tint[i * 4 + 3] = p.a0 + (p.a1 - p.a0) * t;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
    this.geometry.attributes.tint.needsUpdate = true;
  }
}

export class Effects {
  constructor(world) {
    this.world = world;
    this.layers = {
      soft: new Layer(world.scene, 900, THREE.NormalBlending),
      glow: new Layer(world.scene, 700, THREE.AdditiveBlending),
    };
    this.rates = new Map();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const cam = this.world.camera;
    const h = this.world.renderer.domElement.height;
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    for (const l of Object.values(this.layers)) l.material.uniforms.uScale.value = scale;
  }

  /** Emit `count` particles of a preset at `at`. `dir` adds a directional velocity. */
  emit(name, at, count = 1, { dir = null, speed = 0, spread = null } = {}) {
    const pr = PRESETS[name];
    if (!pr) return;
    const layer = this.layers[pr.layer];
    const sp = spread ?? pr.spread;
    for (let i = 0; i < count; i++) {
      const j = pr.jitter || 0;
      layer.spawn({
        x: at.x + rand(-sp, sp),
        y: at.y + rand(-sp, sp) * 0.5,
        z: at.z + rand(-sp, sp),
        vx: rand(-j, j) + (dir ? dir.x * speed : 0),
        vy: rand(pr.vy[0], pr.vy[1]) + (dir ? dir.y * speed : 0),
        vz: rand(-j, j) + (dir ? dir.z * speed : 0),
        life: rand(pr.life[0], pr.life[1]),
        s0: pr.size[0] * rand(0.8, 1.2),
        s1: pr.size[1] * rand(0.8, 1.2),
        a0: pr.alpha[0],
        a1: pr.alpha[1],
        color: pick(pr.color),
        gravity: pr.gravity || 0,
        drag: pr.drag || 0,
      });
    }
  }

  /** Continuous emission helper: call every frame with a rate (particles/second). */
  stream(key, name, at, rate, dt, opts) {
    const acc = (this.rates.get(key) || 0) + rate * dt;
    const n = Math.floor(acc);
    this.rates.set(key, acc - n);
    if (n > 0) this.emit(name, at, n, opts);
  }

  update(dt) {
    this.layers.soft.update(dt);
    this.layers.glow.update(dt);
  }
}
