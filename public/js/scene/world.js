import * as THREE from '../../vendor/three/three.bundle.min.js';

export { THREE };

/**
 * Renderer, camera, lights and the frame loop. The camera is a fixed, tilted "diorama" view
 * (like the classic co-op cooking games) that auto-fits the kitchen to any window size.
 */
export class World {
  constructor(canvas, { background = '#8fd0e8', quality = 'high', bounds = null } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(background);
    this.scene.fog = new THREE.Fog(background, 32, 62);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    this.target = new THREE.Vector3(0, 0, 0.5);
    this.elevation = THREE.MathUtils.degToRad(56);
    const b = bounds || { minX: -8.3, maxX: 8.3, minZ: -4.5, maxZ: 4.3, maxY: 2.9 };
    this.fitBox = new THREE.Box3(new THREE.Vector3(b.minX, 0, b.minZ), new THREE.Vector3(b.maxX, b.maxY, b.maxZ));
    /** Screen-space band (NDC) the kitchen must fit in; leaves room for the HUD. */
    this.band = { left: -0.97, right: 0.97, bottom: -0.93, top: 0.7 };

    this.addLights();
    this.frameCallbacks = [];
    this.lastTs = null;
    this.time = 0;
    this.frames = 0;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  addLights() {
    const hemi = new THREE.HemisphereLight(0xfff6e5, 0x7a6f8f, 1.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0d8, 2.35);
    sun.position.set(-7, 16, 9);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const size = this.quality === 'low' ? 1024 : 2048;
    sun.shadow.mapSize.set(size, size);
    const cam = sun.shadow.camera;
    cam.left = -13;
    cam.right = 13;
    cam.top = 10;
    cam.bottom = -10;
    cam.near = 1;
    cam.far = 45;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);

    const fill = new THREE.DirectionalLight(0xcfe8ff, 0.55);
    fill.position.set(8, 6, 10);
    this.scene.add(fill);
    this.sun = sun;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.fitCamera();
  }

  placeCamera(distance) {
    const dir = new THREE.Vector3(0, Math.sin(this.elevation), Math.cos(this.elevation));
    this.camera.position.copy(this.target).addScaledVector(dir, distance);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
  }

  /** Projected NDC bounds of the kitchen bounding box at the current camera. */
  projectedBounds() {
    const b = this.fitBox;
    const v = new THREE.Vector3();
    const out = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      v.set(x, y, z).project(this.camera);
      out.minX = Math.min(out.minX, v.x);
      out.maxX = Math.max(out.maxX, v.x);
      out.minY = Math.min(out.minY, v.y);
      out.maxY = Math.max(out.maxY, v.y);
    }
    return out;
  }

  fitCamera() {
    const band = this.band;
    const bandH = band.top - band.bottom;
    const bandW = band.right - band.left;
    this.target.set(0, 0, 0.5);
    for (let iter = 0; iter < 4; iter++) {
      let lo = 4;
      let hi = 120;
      for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        this.placeCamera(mid);
        const p = this.projectedBounds();
        if (p.maxX - p.minX <= bandW && p.maxY - p.minY <= bandH) hi = mid;
        else lo = mid;
      }
      this.placeCamera(hi);
      // Shift the look-at point so the kitchen sits in the middle of the band.
      const p = this.projectedBounds();
      const offY = (p.maxY + p.minY) / 2 - (band.top + band.bottom) / 2;
      const worldPerNdc = (this.fitBox.max.z - this.fitBox.min.z) / Math.max(0.01, p.maxY - p.minY);
      this.target.z -= offY * worldPerNdc * 0.9;
    }
    this.placeCamera(this.camera.position.distanceTo(this.target));
  }

  /** World → CSS pixel position. */
  toScreen(vec3, out = { x: 0, y: 0, visible: true }) {
    const v = this._v || (this._v = new THREE.Vector3());
    v.copy(vec3).project(this.camera);
    out.x = (v.x + 1) * 0.5 * window.innerWidth;
    out.y = (1 - v.y) * 0.5 * window.innerHeight;
    out.visible = v.z < 1;
    return out;
  }

  onFrame(cb) {
    this.frameCallbacks.push(cb);
  }

  start() {
    this.renderer.setAnimationLoop((ts) => {
      const now = ts ?? performance.now();
      const dt = this.lastTs == null ? 1 / 60 : Math.min(Math.max(0, (now - this.lastTs) / 1000), 0.05);
      this.lastTs = now;
      this.time += dt;
      for (const cb of this.frameCallbacks) cb(dt, this.time);
      this.renderer.render(this.scene, this.camera);
      this.frames++;
    });
  }
}
