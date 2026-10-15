import { THREE } from './world.js';
import { C, mat, metal, beltTexture } from './materials.js';
import { TOP_Y, box, cyl, sph, at, group, shadow, plate, maki, nigiri, tempuraPiece, makeItem } from './build.js';

const pop = (k) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};

export function buildTest(p) {
  p.topStyle = 'steel';
  const steel = metal(C.steel);
  const g = new THREE.Group();
  g.add(at(box(0.86, 0.24, 0.76, steel, 0.03), 0, TOP_Y + 0.12, 0));
  const oilMat = mat('#d99a2b', { emissive: '#6b3d00', emissiveIntensity: 0.3, roughness: 0.15 });
  g.add(at(box(0.64, 0.02, 0.52, oilMat), 0, TOP_Y + 0.235, -0.02));
  const basket = new THREE.Group();
  const wire = metal('#7d8790');
  for (const [x, z, w, d] of [[0, -0.18, 0.5, 0.02], [0, 0.18, 0.5, 0.02], [-0.25, 0, 0.02, 0.38], [0.25, 0, 0.02, 0.38]]) basket.add(at(box(w, 0.1, d, wire), x, 0.05, z));
  basket.add(at(box(0.5, 0.012, 0.38, wire), 0, 0, 0));
  const handle = cyl(0.015, 0.015, 0.4, wire, 6);
  handle.rotation.x = Math.PI / 2;
  basket.add(at(handle, 0, 0.1, 0.36), at(cyl(0.028, 0.028, 0.14, mat('#2b2b2b'), 8), 0, 0.1, 0.5));
  basket.children[basket.children.length - 1].rotation.x = Math.PI / 2;
  basket.add(at(tempuraPiece(0.22), -0.08, 0.02, -0.06), at(tempuraPiece(0.2), 0.08, 0.02, 0.06));
  basket.position.set(0, TOP_Y + 0.3, -0.02);
  const dial = cyl(0.05, 0.05, 0.02, mat('#fafafa'), 16);
  dial.rotation.x = Math.PI / 2;
  dial.position.set(0.28, TOP_Y + 0.12, 0.39);
  g.add(basket, dial, at(box(0.006, 0.04, 0.006, mat('#e53935')), 0.28, TOP_Y + 0.13, 0.4));
  p.group.add(shadow(g));
  const bubbleAt = new THREE.Vector3();
  p.animate = (dt, t) => {
    const a = p.activity;
    basket.position.y = TOP_Y + 0.3 - a * 0.06 + Math.sin(t * 6) * 0.015 * a;
    if (a > 0.3) p.fx.stream(`${p.id}:bub`, 'bubble', p.local((Math.random() - 0.5) * 0.5, TOP_Y + 0.25, (Math.random() - 0.5) * 0.4, bubbleAt), 28 * a, dt);
  };
}

export function buildLint(p) {
  p.topStyle = 'ceramic';
  const ceramic = mat('#f7f7f4', { roughness: 0.28 });
  const g = new THREE.Group();
  g.add(at(box(1.02, 0.12, 1.02, ceramic, 0.03), 0, TOP_Y - 0.04, 0));
  for (const [x, z, w, d] of [[0, -0.31, 0.8, 0.08], [0, 0.31, 0.8, 0.08], [-0.37, 0, 0.08, 0.7], [0.37, 0, 0.08, 0.7]]) g.add(at(box(w, 0.06, d, ceramic, 0.02), x, TOP_Y + 0.04, z));
  g.add(at(box(0.66, 0.012, 0.54, mat('#7fd0ec', { roughness: 0.08, metalness: 0.1 })), 0, TOP_Y + 0.03, 0));
  const chrome = metal('#dfe5ea', { roughness: 0.2 });
  g.add(at(cyl(0.03, 0.035, 0.42, chrome, 12), 0, TOP_Y + 0.21, -0.4));
  const spout = cyl(0.025, 0.025, 0.26, chrome, 10);
  spout.rotation.x = Math.PI / 2;
  g.add(at(spout, 0, TOP_Y + 0.41, -0.28));
  for (const sx of [-0.12, 0.12]) g.add(at(cyl(0.03, 0.03, 0.05, mat(sx < 0 ? '#e53935' : '#1e88e5'), 10), sx, TOP_Y + 0.3, -0.4));
  const streamMat = new THREE.MeshStandardMaterial({ color: '#bfe9ff', transparent: true, opacity: 0.75, roughness: 0.1 });
  const stream = at(cyl(0.016, 0.022, 0.36, streamMat, 8), 0, TOP_Y + 0.22, -0.16);
  stream.visible = false;
  const plates = [plate(0.17), plate(0.15)];
  plates[0].position.set(-0.08, TOP_Y + 0.04, 0.04);
  plates[0].rotation.x = 0.3;
  plates[1].position.set(0.12, TOP_Y + 0.05, -0.02);
  plates[1].rotation.z = -0.35;
  for (const pl of plates) pl.add(at(box(0.06, 0.005, 0.04, mat('#a1887f')), 0.02, 0.04, 0.03));
  g.add(stream, ...plates);
  p.group.add(shadow(g));
  stream.castShadow = false;
  const at2 = new THREE.Vector3();
  p.animate = (dt, t) => {
    const a = p.activity;
    stream.visible = a > 0.3;
    plates[0].rotation.y = t * 1.5 * a;
    plates[1].rotation.y = -t * 1.2 * a;
    if (a > 0.3) {
      p.fx.stream(`${p.id}:bub`, 'bubble', p.local((Math.random() - 0.5) * 0.5, TOP_Y + 0.06, (Math.random() - 0.5) * 0.4, at2), 22 * a, dt);
      p.fx.stream(`${p.id}:spl`, 'water', p.local(0, TOP_Y + 0.05, -0.16, at2), 12 * a, dt);
    }
  };
}

export function buildCommit(p) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) g.add(at(plate(0.19), 0.27, TOP_Y + i * 0.04, -0.22));
  g.add(at(plate(0.26), -0.06, TOP_Y, 0.06));
  const pieces = [maki(C.salmon), maki('#9ccc65'), maki(C.tempura), nigiri()];
  const spots = [[-0.16, 0], [-0.02, -0.06], [0.08, 0.06], [-0.06, 0.16]];
  pieces.forEach((pc, i) => {
    pc.position.set(spots[i][0], TOP_Y + 0.04, spots[i][1] + 0.04);
    g.add(pc);
  });
  const soy = group(at(cyl(0.06, 0.05, 0.03, mat('#fafafa'), 14), 0, 0.015, 0), at(cyl(0.045, 0.045, 0.005, mat('#3e2723'), 14), 0, 0.03, 0));
  soy.position.set(0.3, TOP_Y, 0.25);
  g.add(soy);
  p.group.add(shadow(g));
  p.animate = (dt, t) => {
    if (p.activity > 0.3) {
      const k = (t * 1.3) % (pieces.length + 1.5);
      pieces.forEach((pc, i) => pc.scale.setScalar(Math.max(0.001, Math.min(1, pop(Math.min(1, Math.max(0, k - i))) ))));
    } else {
      pieces.forEach((pc) => pc.scale.setScalar(1));
    }
  };
}

export function buildShip(p) {
  const g = new THREE.Group();
  g.add(at(box(0.98, 0.09, 0.98, metal(C.steelDark), 0.02), 0, TOP_Y + 0.045, 0));
  const tex = beltTexture();
  const belt = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.96), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  belt.rotation.x = -Math.PI / 2;
  belt.position.y = TOP_Y + 0.093;
  for (const sx of [-0.44, 0.44]) g.add(at(box(0.05, 0.08, 0.98, metal(C.steel), 0.01), sx, TOP_Y + 0.12, 0));
  const dish = makeItem('sushi');
  dish.visible = false;
  const bell = group(at(cyl(0.07, 0.08, 0.02, mat(C.wood), 12), 0, 0.01, 0));
  bell.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal('#f4c542', { roughness: 0.25 })), 0, 0.02, 0));
  bell.position.set(0.3, TOP_Y + 0.16, 0.38);
  g.add(belt, dish, bell);
  p.group.add(shadow(g));
  belt.receiveShadow = true;
  let serveUntil = 0;
  let serveStart = 0;
  p.serve = (t) => {
    serveStart = t;
    serveUntil = t + 1.6;
  };
  p.animate = (dt, t) => {
    const a = Math.max(p.activity, t < serveUntil ? 1 : 0);
    tex.offset.y -= dt * 0.9 * a;
    const k = t < serveUntil ? (t - serveStart) / 1.6 : p.activity > 0.3 ? (t * 0.6) % 1 : -1;
    dish.visible = k >= 0;
    if (k >= 0) {
      dish.position.set(0, TOP_Y + 0.1, 0.3 - k * 1.15);
      dish.scale.setScalar(k > 0.8 ? Math.max(0.01, 1 - (k - 0.8) * 5) : 1);
    }
    bell.scale.y = t < serveUntil && t - serveStart < 0.25 ? 0.75 : 1;
  };
}

export function buildShell(p) {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.22, 26, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), metal('#c3ccd4', { side: THREE.DoubleSide }));
  bowl.rotation.x = Math.PI;
  bowl.position.set(0, TOP_Y + 0.22, 0);
  const batter = at(cyl(0.19, 0.19, 0.012, mat('#f3e2b3'), 22), 0, TOP_Y + 0.17, 0);
  const whisk = new THREE.Group();
  whisk.add(at(cyl(0.014, 0.02, 0.28, mat('#8d6e63'), 8), 0, 0.24, 0));
  for (let i = 0; i < 3; i++) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.004, 6, 16), metal());
    loop.scale.set(1, 1.7, 1);
    loop.rotation.y = (i * Math.PI) / 3;
    loop.position.y = 0.06;
    whisk.add(loop);
  }
  whisk.position.set(0, TOP_Y + 0.14, 0);
  whisk.rotation.z = 0.3;
  const jars = [['#e57373', 0.3, -0.22], ['#64b5f6', 0.33, 0.1]].map(([c, x, z]) =>
    at(group(at(cyl(0.06, 0.06, 0.14, mat('#f4f1e8', { roughness: 0.3 }), 12), 0, 0.07, 0), at(cyl(0.065, 0.065, 0.035, mat(c), 12), 0, 0.155, 0)), x, TOP_Y, z));
  g.add(bowl, batter, whisk, ...jars);
  p.group.add(shadow(g));
  p.animate = (dt, t) => {
    const a = p.activity;
    whisk.rotation.y += dt * 9 * a;
    whisk.position.x = Math.cos(t * 9) * 0.05 * a;
    whisk.position.z = Math.sin(t * 9) * 0.05 * a;
    bowl.rotation.z = Math.sin(t * 11) * 0.03 * a;
  };
}

export function buildTrash(p) {
  p.topStyle = 'none';
  const binMat = mat('#5f7380', { roughness: 0.45, metalness: 0.35 });
  const g = new THREE.Group();
  g.add(at(cyl(0.36, 0.31, 0.86, binMat, 24), 0, 0.43, 0));
  for (const y of [0.18, 0.7]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.345 - y * 0.03, 0.02, 6, 24), mat('#455a64'));
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    g.add(band);
  }
  g.add(at(box(0.18, 0.04, 0.12, mat('#37474f'), 0.01), 0, 0.04, 0.38));
  const pivot = new THREE.Group();
  pivot.position.set(0, 0.88, -0.36);
  pivot.add(at(cyl(0.38, 0.38, 0.06, mat('#546e7a', { roughness: 0.4, metalness: 0.3 }), 24), 0, 0.03, 0.36), at(box(0.16, 0.04, 0.05, mat('#37474f'), 0.01), 0, 0.08, 0.36));
  const junk = sph(0.08, mat('#f5f5f5', { flatShading: true }), 6, 4);
  junk.visible = false;
  g.add(pivot, junk);
  p.group.add(shadow(g));
  p.animate = (dt, t) => {
    const a = p.activity;
    pivot.rotation.x = -a * 1.25;
    junk.visible = a > 0.4;
    if (junk.visible) {
      const k = (t * 0.9) % 1;
      junk.position.set(0, 1.45 - k * 1.1, 0.05);
      junk.rotation.set(t * 5, t * 3, 0);
    }
  };
  p.anchor.y = 1.55;
}

export function buildAsk(p) {
  const g = new THREE.Group();
  const gold = metal('#f4c542', { roughness: 0.22 });
  const bell = group(
    at(cyl(0.15, 0.16, 0.04, mat(C.wood), 18), 0, 0.02, 0),
    at(new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold), 0, 0.04, 0),
    at(cyl(0.02, 0.02, 0.05, gold, 8), 0, 0.18, 0),
  );
  bell.position.set(-0.05, TOP_Y, 0.05);
  const pad = at(box(0.22, 0.02, 0.28, mat('#fffaf0'), 0.005), 0.27, TOP_Y + 0.01, -0.05);
  pad.rotation.y = 0.3;
  const pen = cyl(0.008, 0.008, 0.2, mat('#1e88e5'), 6);
  pen.rotation.set(Math.PI / 2, 0, 0.6);
  pen.position.set(0.3, TOP_Y + 0.03, 0.05);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd54f', transparent: true, opacity: 0, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 32), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(-0.05, TOP_Y + 0.12, 0.05);
  g.add(bell, pad, pen, ring);
  p.group.add(shadow(g));
  ring.castShadow = false;
  p.animate = (dt, t) => {
    const a = p.activity;
    const k = (t * 0.7) % 1;
    const ding = a > 0.3 && k < 0.12;
    bell.scale.y = ding ? 0.82 : 1;
    ringMat.opacity = a > 0.3 ? Math.max(0, 0.9 - k * 2.2) : 0;
    ring.scale.setScalar(1 + k * 3);
  };
}
