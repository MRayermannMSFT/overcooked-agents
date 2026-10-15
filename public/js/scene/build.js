import { THREE } from './world.js';
import { C, mat, metal } from './materials.js';

/** Height of the counter work surface. */
export const TOP_Y = 0.97;

export function shadow(obj, cast = true, receive = true) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return obj;
}

export function box(w, h, d, material, radius = 0) {
  const geo = radius ? new THREE.RoundedBoxGeometry(w, h, d, 2, radius) : new THREE.BoxGeometry(w, h, d);
  return new THREE.Mesh(geo, material);
}

export function cyl(rTop, rBottom, h, material, seg = 24) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), material);
}

export function sph(r, material, ws = 20, hs = 14) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), material);
}

export function at(obj, x, y, z) {
  obj.position.set(x, y, z);
  return obj;
}

export function group(...children) {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  return g;
}

/** A plate: flattened cylinder with a rim. */
export function plate(r = 0.22, color = C.white) {
  const g = group(
    at(cyl(r, r * 0.82, 0.035, mat(color, { roughness: 0.35 }), 28), 0, 0.0175, 0),
    at(new THREE.Mesh(new THREE.TorusGeometry(r * 0.96, 0.012, 6, 28), mat(color, { roughness: 0.35 })), 0, 0.036, 0),
  );
  g.children[1].rotation.x = Math.PI / 2;
  return g;
}

/** One maki roll (nori outside, rice ring, coloured filling). */
export function maki(filling = C.salmon, r = 0.06) {
  return group(
    at(cyl(r, r, r * 1.15, mat(C.nori), 18), 0, (r * 1.15) / 2, 0),
    at(cyl(r * 0.82, r * 0.82, 0.006, mat(C.rice), 18), 0, r * 1.15 + 0.002, 0),
    at(cyl(r * 0.36, r * 0.36, 0.008, mat(filling), 12), 0, r * 1.15 + 0.004, 0),
  );
}

/** Nigiri: rice pillow topped with a slice of fish. */
export function nigiri(top = C.salmon) {
  const rice = sph(0.06, mat(C.rice));
  rice.scale.set(1.4, 0.7, 0.9);
  const fish = box(0.17, 0.025, 0.1, mat(top, { roughness: 0.5 }), 0.01);
  return group(at(rice, 0, 0.04, 0), at(fish, 0, 0.085, 0));
}

export function parcel(size = 0.26) {
  const b = box(size, size * 0.8, size, mat('#c99258'), 0.015);
  const tape = box(size * 1.01, 0.012, size * 0.22, mat('#efdcb3'));
  return group(at(b, 0, size * 0.4, 0), at(tape, 0, size * 0.8 + 0.002, 0));
}

export function sack(scale = 1) {
  const body = sph(0.17 * scale, mat('#ead9b2'));
  body.scale.set(1, 1.15, 0.9);
  const neck = cyl(0.06 * scale, 0.1 * scale, 0.1 * scale, mat('#d9c492'), 12);
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.065 * scale, 0.015 * scale, 6, 16), mat('#8b6a38'));
  tie.rotation.x = Math.PI / 2;
  return group(at(body, 0, 0.19 * scale, 0), at(neck, 0, 0.42 * scale, 0), at(tie, 0, 0.4 * scale, 0));
}

export function fishModel(len = 0.42) {
  const m = mat(C.salmon, { roughness: 0.45 });
  const body = sph(len / 2, m, 18, 12);
  body.scale.set(1, 0.42, 0.34);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(len * 0.17, len * 0.22, 4), m);
  tail.rotation.z = Math.PI / 2;
  tail.scale.set(1, 1, 0.3);
  const eye = sph(0.018, mat('#222222'), 8, 6);
  const belly = sph(len / 2.1, mat('#ffd0bf'), 14, 8);
  belly.scale.set(0.9, 0.22, 0.3);
  return group(at(body, 0, len * 0.12, 0), at(tail, -len * 0.56, len * 0.12, 0), at(eye, len * 0.32, len * 0.16, len * 0.06), at(belly, 0, len * 0.07, 0));
}

export function noriSheet() {
  const s = box(0.3, 0.012, 0.26, mat(C.nori, { roughness: 0.9 }), 0.004);
  return group(at(s, 0, 0.006, 0));
}

export function riceBowl() {
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#4f7cf0', { side: THREE.DoubleSide, roughness: 0.4 }));
  bowl.rotation.x = Math.PI;
  bowl.position.y = 0.13;
  const riceTop = sph(0.115, mat(C.rice));
  riceTop.scale.set(1, 0.55, 1);
  return group(bowl, at(riceTop, 0, 0.13, 0));
}

export function tempuraPiece(len = 0.2) {
  const b = sph(len / 2, mat(C.tempura, { roughness: 0.95 }), 14, 10);
  b.scale.set(1, 0.42, 0.42);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), mat('#ff7043'));
  tail.rotation.z = -Math.PI / 2;
  return group(at(b, 0, 0.04, 0), at(tail, len / 2 + 0.02, 0.05, 0));
}

export function ticketPaper() {
  const p = box(0.18, 0.006, 0.24, mat('#fffaf0'));
  const l1 = box(0.12, 0.007, 0.012, mat('#c9a76f'));
  const l2 = l1.clone();
  return group(at(p, 0, 0.003, 0), at(l1, 0, 0.006, -0.04), at(l2, 0, 0.006, 0.02));
}

export function extinguisher() {
  const body = cyl(0.085, 0.085, 0.36, mat('#e53935', { roughness: 0.4 }), 16);
  const top = cyl(0.03, 0.05, 0.06, mat('#2b2b2b'), 10);
  const nozzle = cyl(0.018, 0.024, 0.16, mat('#2b2b2b'), 8);
  nozzle.rotation.x = Math.PI / 2;
  return group(at(body, 0, 0.18, 0), at(top, 0, 0.39, 0), at(nozzle, 0, 0.4, 0.09));
}

/** Items a chef can carry between stations (what they "picked up" last). */
export function makeItem(kind) {
  switch (kind) {
    case 'nori': return noriSheet();
    case 'fish': return fishModel(0.36);
    case 'parcel': return parcel(0.24);
    case 'sack': return sack(0.75);
    case 'sashimi': {
      const p = plate(0.15);
      for (let i = 0; i < 3; i++) p.add(at(box(0.07, 0.03, 0.12, mat(C.salmon, { roughness: 0.45 }), 0.01), -0.07 + i * 0.07, 0.05, 0));
      return p;
    }
    case 'rice': return riceBowl();
    case 'tempura': {
      const p = plate(0.15);
      p.add(at(tempuraPiece(0.18), 0, 0.03, -0.03));
      p.add(at(tempuraPiece(0.16), 0, 0.03, 0.05));
      return p;
    }
    case 'plate': return plate(0.17);
    case 'sushi': {
      const p = plate(0.18);
      p.add(at(maki(C.salmon), -0.07, 0.035, 0));
      p.add(at(maki('#9ccc65'), 0.07, 0.035, 0));
      p.add(at(nigiri(), 0, 0.03, 0.08));
      return p;
    }
    case 'bowl': {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 9, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), metal(C.steel, { side: THREE.DoubleSide }));
      b.rotation.x = Math.PI;
      b.position.y = 0.12;
      const batter = cyl(0.1, 0.1, 0.01, mat('#f3e2b3'), 16);
      return group(b, at(batter, 0, 0.1, 0));
    }
    case 'ticket': return ticketPaper();
    case 'extinguisher': return extinguisher();
    default: return null;
  }
}
