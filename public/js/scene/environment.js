import { THREE } from './world.js';
import { C, mat, rng, floorTexture, shojiTexture, lanternTexture, signTexture } from './materials.js';
import { box, cyl, sph, at, group, shadow } from './build.js';
import { W, D, tileToWorld } from './layout.js';

const HALF_W = W / 2;
const HALF_D = D / 2;

/** Floor, walls, the koi pond around the floating kitchen, bridge, trees and lanterns. */
export function buildEnvironment(scene) {
  const root = new THREE.Group();
  root.name = 'environment';
  scene.add(root);
  const animated = [];

  // Kitchen floor + platform base.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTexture(W, D), roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);
  const base = box(W + 0.9, 0.7, D + 0.7, mat('#7a5136'), 0.08);
  base.position.y = -0.36;
  base.receiveShadow = true;
  root.add(base);
  const trim = box(W + 1.1, 0.12, D + 0.9, mat('#5a3828'), 0.05);
  trim.position.y = -0.66;
  root.add(trim);

  // Back wall: shoji panels between dark wooden posts, with a beam on top.
  const wallZ = -HALF_D - 0.18;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(W + 0.7, 2.7, 0.3), [
    mat(C.wallFrame), mat(C.wallFrame), mat(C.beam), mat(C.beam),
    new THREE.MeshStandardMaterial({ map: shojiTexture(W / 2), roughness: 0.9 }), mat(C.wallFrame),
  ]);
  wall.position.set(0, 1.35, wallZ);
  wall.receiveShadow = true;
  root.add(wall);
  root.add(shadow(at(box(W + 1.0, 0.24, 0.5, mat(C.beam), 0.04), 0, 2.78, wallZ)));
  for (let i = 0; i <= 4; i++) {
    const x = -HALF_W - 0.2 + (i * (W + 0.4)) / 4;
    root.add(shadow(at(box(0.26, 2.8, 0.42, mat(C.beam), 0.03), x, 1.4, wallZ + 0.02)));
  }

  // Low side walls with openings for the delivery hatch (left) and serving hatch (right).
  const hatchZ = [tileToWorld(0, 4).z - 0.5, tileToWorld(0, 5).z + 0.5];
  for (const side of [-1, 1]) {
    const x = side * (HALF_W + 0.18);
    const segs = [[-HALF_D - 0.3, hatchZ[0]], [hatchZ[1], HALF_D + 0.1]];
    for (const [z0, z1] of segs) {
      const seg = box(0.3, 1.7, z1 - z0, mat(C.wall), 0.03);
      seg.position.set(x, 0.85, (z0 + z1) / 2);
      shadow(seg);
      root.add(seg);
      root.add(shadow(at(box(0.36, 0.16, z1 - z0 + 0.06, mat(C.beam), 0.03), x, 1.74, (z0 + z1) / 2)));
    }
    // Hatch frame + little awning.
    const frameMat = mat(C.beam);
    for (const z of hatchZ) root.add(shadow(at(box(0.34, 2.1, 0.22, frameMat, 0.03), x, 1.05, z)));
    root.add(shadow(at(box(0.34, 0.22, hatchZ[1] - hatchZ[0] + 0.22, frameMat, 0.03), x, 2.1, 0)));
    const awning = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, hatchZ[1] - hatchZ[0] + 0.5), mat(side < 0 ? '#2e7d6b' : '#d84a3a', { roughness: 0.9 }));
    awning.position.set(x + side * 0.45, 2.25, 0);
    awning.rotation.z = side * -0.38;
    shadow(awning);
    root.add(awning);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.49), new THREE.MeshStandardMaterial({
      map: signTexture(side < 0 ? 'parcel' : 'cloche', side < 0 ? '#2e7d6b' : '#c0392b', '#fff', side < 0 ? 'IN' : 'OUT'),
      roughness: 0.7,
    }));
    sign.position.set(x - side * 0.17, 2.1, 0);
    sign.rotation.y = -side * Math.PI / 2;
    root.add(sign);
  }

  // Red paper lanterns hanging off the back beam.
  const lanternMat = new THREE.MeshStandardMaterial({ map: lanternTexture(), emissive: '#ff5a3a', emissiveIntensity: 0.35, roughness: 0.8 });
  for (const lx of [-6, -2, 2, 6]) {
    const l = sph(0.26, lanternMat, 20, 14);
    l.scale.set(1, 1.2, 1);
    const capT = cyl(0.12, 0.12, 0.07, mat('#222222'), 12);
    const capB = capT.clone();
    const string = cyl(0.008, 0.008, 0.3, mat('#222222'), 4);
    const lantern = group(at(string, 0, 0.47, 0), at(capT, 0, 0.32, 0), l, at(capB, 0, -0.32, 0));
    lantern.position.set(lx, 2.2, wallZ + 0.45);
    root.add(lantern);
    animated.push((dt, t) => (lantern.rotation.z = Math.sin(t * 1.3 + lx) * 0.06));
  }

  // Koi pond: low-poly, flat-shaded animated water.
  const waterGeo = new THREE.PlaneGeometry(90, 90, 70, 70);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({ color: C.water, roughness: 0.3, metalness: 0.05, flatShading: true }));
  water.position.y = -0.55;
  water.receiveShadow = true;
  root.add(water);
  const wp = waterGeo.attributes.position;
  const base0 = Float32Array.from(wp.array);
  animated.push((dt, t) => {
    for (let i = 0; i < wp.count; i++) {
      const x = base0[i * 3];
      const z = base0[i * 3 + 2];
      wp.array[i * 3 + 1] = Math.sin(x * 0.55 + t * 1.1) * 0.05 + Math.cos(z * 0.7 + t * 0.9) * 0.05;
    }
    wp.needsUpdate = true;
  });

  // Wooden bridge from the door toward the viewer (where chefs arrive).
  const door = tileToWorld(7.5, D - 1);
  const bridge = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const plank = box(2.6, 0.12, 0.42, mat(i % 2 ? '#a8754b' : '#b98557'), 0.03);
    plank.position.set(door.x, -0.12, HALF_D + 0.45 + i * 0.46);
    bridge.add(plank);
  }
  for (const sx of [-1.35, 1.35]) {
    for (let i = 0; i < 3; i++) bridge.add(at(cyl(0.07, 0.08, 0.9, mat(C.beam), 8), door.x + sx, 0.05, HALF_D + 0.7 + i * 1.6));
    const rail = box(0.1, 0.08, 3.6, mat(C.beam), 0.02);
    rail.position.set(door.x + sx, 0.45, HALF_D + 2.25);
    bridge.add(rail);
  }
  root.add(shadow(bridge));

  // Grassy islands with cherry trees and stone lanterns.
  const r = rng(42);
  const islands = [[-12.2, 3.5, 2.6], [12.4, 3.2, 2.4], [-11.6, -5.2, 2.2], [11.8, -5.4, 2.3], [-5.6, 9.2, 1.4], [5.8, 9.0, 1.5]];
  for (const [ix, iz, ir] of islands) {
    const isl = group(
      at(cyl(ir, ir * 1.1, 0.5, mat(C.stoneDark), 24), 0, -0.4, 0),
      at(cyl(ir * 0.96, ir, 0.2, mat(C.grass, { flatShading: true }), 24), 0, -0.1, 0),
    );
    isl.position.set(ix, 0, iz);
    root.add(shadow(isl));
    if (ir > 2) root.add(cherryTree(ix + (r() - 0.5), iz - 0.3, 1 + r() * 0.3, animated));
    else root.add(stoneLantern(ix, iz));
  }

  // Lily pads + flowers.
  for (let i = 0; i < 26; i++) {
    const ang = r() * Math.PI * 2;
    const rad = 10.5 + r() * 9;
    const x = Math.cos(ang) * rad * 1.15;
    const z = Math.sin(ang) * rad * 0.8;
    const pad = cyl(0.32 + r() * 0.2, 0.32, 0.03, mat(r() > 0.5 ? '#5fa35a' : '#4e9150', { flatShading: true }), 9);
    pad.position.set(x, -0.5, z);
    pad.rotation.y = r() * 6;
    root.add(pad);
    if (r() > 0.6) root.add(at(sph(0.1, mat(C.blossom), 8, 6), x + 0.08, -0.43, z));
  }

  // Koi swimming laps around the platform.
  for (let i = 0; i < 6; i++) {
    const koi = koiFish(i % 2 ? '#ff7a3d' : '#ffffff', i % 3 === 0 ? '#ff5722' : '#222222');
    root.add(koi);
    const rx = 10 + i * 0.7;
    const rz = 7.4 + (i % 3) * 0.6;
    const speed = 0.12 + i * 0.015;
    const phase = i * 1.7;
    animated.push((dt, t) => {
      const a = t * speed * (i % 2 ? 1 : -1) + phase;
      koi.position.set(Math.cos(a) * rx, -0.49, Math.sin(a) * rz);
      const da = (i % 2 ? 1 : -1);
      koi.rotation.y = Math.atan2(-Math.sin(a) * rx * da, Math.cos(a) * rz * da) + Math.sin(t * 6 + i) * 0.15;
    });
  }

  return { root, update: (dt, t) => animated.forEach((fn) => fn(dt, t)) };
}

function cherryTree(x, z, s, animated) {
  const trunk = cyl(0.12 * s, 0.2 * s, 1.6 * s, mat(C.trunk), 8);
  trunk.position.y = 0.8 * s;
  const crown = new THREE.Group();
  const r = rng(Math.round(x * 100 + z));
  for (let i = 0; i < 9; i++) {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry((0.45 + r() * 0.35) * s, 0), mat(i % 3 ? C.blossom : C.blossomDark, { flatShading: true }));
    blob.position.set((r() - 0.5) * 1.5 * s, (1.7 + r() * 0.8) * s, (r() - 0.5) * 1.2 * s);
    crown.add(blob);
  }
  const tree = group(trunk, crown);
  tree.position.set(x, 0, z);
  animated.push((dt, t) => (crown.rotation.z = Math.sin(t * 0.8 + x) * 0.025));
  return shadow(tree);
}

function stoneLantern(x, z) {
  const m = mat(C.stone, { flatShading: true });
  const g = group(
    at(cyl(0.22, 0.28, 0.2, m, 6), 0, 0.1, 0),
    at(cyl(0.07, 0.09, 0.5, m, 6), 0, 0.45, 0),
    at(box(0.36, 0.3, 0.36, m), 0, 0.84, 0),
    at(box(0.2, 0.16, 0.38, mat('#ffe9a8', { emissive: '#ffcc66', emissiveIntensity: 0.7 })), 0, 0.84, 0),
    at(new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 4), m), 0, 1.14, 0),
  );
  g.children[4].rotation.y = Math.PI / 4;
  g.position.set(x, 0, z);
  return shadow(g);
}

function koiFish(color, spot) {
  const body = sph(0.2, mat(color, { roughness: 0.5 }), 12, 8);
  body.scale.set(0.45, 0.25, 1);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 4), mat(color));
  tail.rotation.x = -Math.PI / 2;
  tail.scale.set(1, 1, 0.3);
  const dot = sph(0.07, mat(spot), 8, 6);
  dot.scale.set(1, 0.4, 1.3);
  return group(body, at(tail, 0, 0, -0.24), at(dot, 0, 0.04, 0.02));
}
