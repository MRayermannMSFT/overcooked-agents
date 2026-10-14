import { THREE } from './world.js';
import { mat, blobTexture } from './materials.js';
import { sph, cyl, at, group, shadow, makeItem } from './build.js';

export const CHEF_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6fae', '#34495e', '#8bc34a'];
const SKINS = ['#f5cba7', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#f1c27d'];

/** Which hand animation to play at each station. */
export const STATION_ACTION = {
  plan: 'read', read: 'grab', search: 'grab', research: 'grab', install: 'grab', code: 'chop', build: 'stir',
  test: 'fry', lint: 'wash', commit: 'plate', ship: 'serve', shell: 'stir', trash: 'bin', ask: 'wait',
};

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

let blobTex = null;

/**
 * A chubby, armless chef with floating hands and a tall hat, built from primitives.
 * Original design: colour-coded apron + hat band so each agent is easy to spot from above.
 */
export class ChefModel {
  constructor({ id, color, sous = false }) {
    const h = hashString(id);
    this.sous = sous;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const skin = mat(SKINS[h % SKINS.length], { roughness: 0.65 });
    const white = mat('#fbfbf8', { roughness: 0.7 });
    this.colorMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    this.color = color;

    // Feet
    const footMat = mat('#33302e', { roughness: 0.6 });
    this.feet = [-1, 1].map((s) => {
      const f = sph(0.09, footMat, 12, 8);
      f.scale.set(1, 0.6, 1.4);
      f.position.set(s * 0.11, 0.05, 0.02);
      this.root.add(f);
      return f;
    });

    // Torso: white jacket on top, coloured apron below.
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.56), white);
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.305, 24, 12, 0, Math.PI * 2, Math.PI * 0.56, Math.PI * 0.44), this.colorMat);
    const torso = group(top, bottom);
    torso.scale.set(1, 1.05, 0.92);
    torso.position.y = 0.42;
    this.body.add(torso);
    for (let i = 0; i < 2; i++) this.body.add(at(sph(0.022, mat('#2b2b2b'), 8, 6), 0, 0.56 - i * 0.1, 0.275));
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.045, 8, 20), this.colorMat);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.72;
    this.body.add(scarf);

    // Head
    this.head = new THREE.Group();
    this.head.position.y = 0.95;
    this.body.add(this.head);
    this.head.add(sph(0.26, skin, 24, 18));
    this.eyes = [-1, 1].map((s) => {
      const e = sph(0.034, mat('#1c1c1c', { roughness: 0.3 }), 10, 8);
      e.scale.set(1, 1.35, 0.6);
      e.position.set(s * 0.085, 0.03, 0.232);
      e.add(at(sph(0.011, mat('#ffffff'), 6, 4), 0.01, 0.012, 0.025));
      this.head.add(e);
      return e;
    });
    this.head.add(at(sph(0.045, mat(SKINS[(h >>> 3) % SKINS.length], { roughness: 0.6 }), 10, 8), 0, -0.03, 0.26));
    for (const s of [-1, 1]) {
      const cheek = sph(0.045, mat('#f28b82', { transparent: true, opacity: 0.55 }), 10, 6);
      cheek.scale.set(1, 0.6, 0.4);
      cheek.position.set(s * 0.15, -0.04, 0.2);
      this.head.add(cheek);
    }
    if ((h >>> 5) % 5 < 2) {
      const stache = mat(['#4e342e', '#212121', '#8d6e63', '#bdbdbd'][(h >>> 7) % 4]);
      for (const s of [-1, 1]) {
        const m = sph(0.06, stache, 10, 6);
        m.scale.set(1.3, 0.5, 0.6);
        m.position.set(s * 0.055, -0.085, 0.235);
        m.rotation.z = s * -0.35;
        this.head.add(m);
      }
    }

    // Hat: tall puffy toque for head chefs, a bandana for sous-chefs.
    if (!sous) {
      const hat = group(at(cyl(0.2, 0.19, 0.16, white, 20), 0, 0.27, 0));
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 24), this.colorMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.21;
      hat.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        hat.add(at(sph(0.13, white, 14, 10), Math.cos(a) * 0.11, 0.42, Math.sin(a) * 0.11));
      }
      hat.add(at(sph(0.15, white, 14, 10), 0, 0.47, 0));
      this.head.add(hat);
    } else {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), this.colorMat);
      cap.position.y = 0.01;
      cap.rotation.x = -0.15;
      this.head.add(cap, at(sph(0.06, this.colorMat, 8, 6), 0, 0.12, -0.25));
    }

    // Floating hands
    this.hands = [-1, 1].map((s) => {
      const hand = sph(0.085, white, 14, 10);
      hand.position.set(s * 0.34, 0.42, 0.1);
      this.body.add(hand);
      return hand;
    });

    // Held item anchor
    this.holder = new THREE.Group();
    this.holder.position.set(0, 0.5, 0.36);
    this.body.add(this.holder);
    this.heldKind = null;

    // Blob shadow + selection ring (not part of the bobbing body)
    blobTex ||= blobTexture();
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.012;
    this.root.add(blob);
    this.ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.52, 40), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.visible = false;
    this.root.add(this.ring);

    shadow(this.body, true, false);
    for (const f of this.feet) f.castShadow = true;
    this.root.scale.setScalar(sous ? 0.84 : 1.14);

    this.phase = Math.random() * 10;
    this.blinkAt = 2 + Math.random() * 3;
    this.root.traverse((o) => (o.userData.chef = this));
  }

  setColor(color) {
    if (color === this.color) return;
    this.color = color;
    this.colorMat.color.set(color);
    this.ringMat.color.set(color);
  }

  setHeld(kind) {
    if (kind === this.heldKind) return;
    this.heldKind = kind;
    this.holder.clear();
    const item = kind ? makeItem(kind) : null;
    if (item) {
      shadow(item, true, false);
      this.holder.add(item);
    }
  }

  /**
   * Pose the chef for this frame.
   * state: { moving, speed, action, working, mood } where mood ∈ idle|happy|sad|sleep|panic
   */
  animate(dt, t, state) {
    const { moving, speed = 0, action, working, mood } = state;
    const [lh, rh] = this.hands;
    const body = this.body;
    let bob = 0;
    let lean = 0;
    const L = { x: -0.34, y: 0.42, z: 0.1 };
    const R = { x: 0.34, y: 0.42, z: 0.1 };
    const holding = Boolean(this.heldKind);

    if (moving) {
      this.phase += dt * (7 + speed * 2.4);
      const s = Math.sin(this.phase);
      bob = Math.abs(s) * 0.07;
      lean = 0.14;
      this.feet[0].position.z = 0.02 + s * 0.1;
      this.feet[1].position.z = 0.02 - s * 0.1;
      if (!holding) {
        L.z += s * 0.1;
        R.z -= s * 0.1;
      }
    } else {
      this.feet[0].position.z = 0.02;
      this.feet[1].position.z = 0.02;
    }

    if (holding) {
      L.x = -0.2; R.x = 0.2; L.y = R.y = 0.48; L.z = R.z = 0.34;
    }

    if (!moving && working) {
      const a = action;
      if (a === 'chop') {
        R.x = 0.18; R.z = 0.42; R.y = 0.55 + Math.abs(Math.sin(t * 13)) * 0.22;
        L.x = -0.2; L.z = 0.42; L.y = 0.5;
        lean = 0.12;
      } else if (a === 'stir') {
        R.x = 0.12 + Math.cos(t * 7) * 0.12; R.z = 0.42 + Math.sin(t * 7) * 0.08; R.y = 0.62;
        L.x = -0.26; L.y = 0.55; L.z = 0.32;
        lean = 0.1;
      } else if (a === 'fry') {
        const shake = Math.sin(t * 9) * 0.04;
        L.x = -0.14; R.x = 0.14; L.z = R.z = 0.46; L.y = R.y = 0.58 + shake;
        lean = 0.12;
      } else if (a === 'wash') {
        const w = Math.sin(t * 10) * 0.12;
        L.x = -0.16 + w; R.x = 0.16 + w; L.z = R.z = 0.45; L.y = R.y = 0.5;
        lean = 0.18;
      } else if (a === 'grab') {
        const k = (Math.sin(t * 5) + 1) / 2;
        L.x = -0.18; R.x = 0.18; L.z = R.z = 0.3 + k * 0.22; L.y = R.y = 0.55 - k * 0.08;
        lean = 0.08 + k * 0.1;
      } else if (a === 'read') {
        L.x = -0.2; R.x = 0.2; L.z = R.z = 0.36; L.y = 0.58;
        R.y = 0.58 + Math.max(0, Math.sin(t * 2.2)) * 0.12;
        lean = 0.06;
        this.head.rotation.x = 0.25;
      } else if (a === 'plate') {
        const k = Math.sin(t * 6);
        L.x = -0.18; R.x = 0.18; L.z = R.z = 0.42; L.y = 0.52 + Math.max(0, k) * 0.12; R.y = 0.52 + Math.max(0, -k) * 0.12;
        lean = 0.12;
      } else if (a === 'serve') {
        const k = (Math.sin(t * 4) + 1) / 2;
        L.x = -0.16; R.x = 0.16; L.z = R.z = 0.32 + k * 0.2; L.y = R.y = 0.56;
        lean = 0.1;
      } else if (a === 'bin') {
        const k = (t * 1.5) % 1;
        R.x = 0.2; R.z = 0.36; R.y = 0.5 + Math.sin(k * Math.PI) * 0.35;
        L.x = -0.3; L.y = 0.42;
      } else if (a === 'wait') {
        const ring = (t * 0.7) % 1 < 0.2;
        R.x = 0.12; R.z = 0.42; R.y = ring ? 0.68 : 0.55;
        L.x = -0.32; L.y = 0.42;
        bob = Math.abs(Math.sin(t * 3)) * 0.025;
        this.head.rotation.x = -0.15;
      } else if (a === 'extinguish') {
        L.x = -0.12; R.x = 0.12; L.z = R.z = 0.42; L.y = R.y = 0.55 + Math.sin(t * 30) * 0.015;
        lean = -0.05;
      }
    }

    if (mood === 'happy') {
      bob += Math.abs(Math.sin(t * 9)) * 0.18;
      L.y = R.y = 0.8;
      L.x = -0.3; R.x = 0.3; L.z = R.z = 0.05;
    } else if (mood === 'sad') {
      this.head.rotation.x = 0.35;
      L.y = R.y = 0.3;
    } else if (mood === 'panic') {
      bob += Math.abs(Math.sin(t * 16)) * 0.08;
      L.y = R.y = 0.85 + Math.sin(t * 20) * 0.05;
      L.x = -0.32; R.x = 0.32; L.z = R.z = 0.1;
    } else if (mood === 'sleep') {
      this.head.rotation.x = 0.3;
      this.head.rotation.z = 0.15;
    }

    if (!(working && (action === 'read' || action === 'wait')) && mood !== 'sad' && mood !== 'sleep') {
      this.head.rotation.x *= 0.85;
      this.head.rotation.z *= 0.85;
    }
    if (mood !== 'sleep') this.head.rotation.z *= 0.85;

    const breathe = moving ? 0 : Math.sin(t * 2.2 + this.phase) * 0.012;
    body.position.y = bob;
    body.scale.set(1 - breathe * 0.5, 1 + breathe, 1 - breathe * 0.5);
    body.rotation.x += (lean - body.rotation.x) * Math.min(1, dt * 10);
    const k = Math.min(1, dt * 14);
    lh.position.x += (L.x - lh.position.x) * k;
    lh.position.y += (L.y - lh.position.y) * k;
    lh.position.z += (L.z - lh.position.z) * k;
    rh.position.x += (R.x - rh.position.x) * k;
    rh.position.y += (R.y - rh.position.y) * k;
    rh.position.z += (R.z - rh.position.z) * k;
    this.holder.visible = holding && (moving || !working || action === 'extinguish');

    // Blink every few seconds (eyes closed while sleeping).
    this.blinkAt -= dt;
    const closed = mood === 'sleep' || this.blinkAt < 0.12;
    if (this.blinkAt < 0) this.blinkAt = 2.5 + Math.random() * 3.5;
    for (const e of this.eyes) e.scale.y = closed ? 0.15 : 1.35;
  }
}
