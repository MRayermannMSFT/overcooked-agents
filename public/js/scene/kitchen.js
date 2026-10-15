import { THREE } from './world.js';
import { C, mat, metal, woodTopTexture, rng } from './materials.js';
import { TOP_Y, box, cyl, sph, at, group, shadow, plate, sack, extinguisher } from './build.js';
import { MAP, W, D, CHAR_STATION, buildStations, isWalkable, tileToWorld } from './layout.js';
import { buildEnvironment } from './environment.js';
import { StationProp, buildPlan, buildRead, buildSearch, buildResearch, buildInstall, buildCode, buildBuild } from './stationProps.js';
import { buildTest, buildLint, buildCommit, buildShip, buildShell, buildTrash, buildAsk } from './stationProps2.js';

const BUILDERS = {
  plan: buildPlan, read: buildRead, search: buildSearch, research: buildResearch, install: buildInstall,
  code: buildCode, build: buildBuild, test: buildTest, lint: buildLint, commit: buildCommit, ship: buildShip,
  shell: buildShell, trash: buildTrash, ask: buildAsk,
};

export class Kitchen {
  constructor(world, fx) {
    this.world = world;
    this.fx = fx;
    this.root = new THREE.Group();
    this.root.name = 'kitchen';
    world.scene.add(this.root);
    this.env = buildEnvironment(world.scene);
    this.stations = [];
    this.byType = new Map();
    for (const def of buildStations()) {
      const p = new StationProp(def, fx);
      BUILDERS[def.type](p);
      this.root.add(p.group);
      this.stations.push(p);
      if (!this.byType.has(def.type)) this.byType.set(def.type, []);
      this.byType.get(def.type).push(p);
    }
    this.root.updateMatrixWorld(true);
    this.buildCounters();
    this.buildDecor();
  }

  stationAt(x, z) {
    return this.stations.find((s) => s.def.tile.x === x && s.def.tile.z === z) || null;
  }

  buildCounters() {
    const tiles = [];
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const c = MAP[z][x];
        if (c === '.' || c === 'D') continue;
        const st = CHAR_STATION[c] ? this.stationAt(x, z) : null;
        const style = st ? st.topStyle : 'wood';
        if (style === 'none') continue;
        tiles.push({ x, z, woodTop: style === 'wood' || style === 'steel' });
      }
    }
    const dummy = new THREE.Object3D();
    const make = (geo, material, list, place) => {
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((item, i) => {
        place(dummy, item);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return mesh;
    };
    const pos = (t, y) => {
      const w = tileToWorld(t.x, t.z);
      dummy.position.set(w.x, y, w.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
    };
    make(new THREE.RoundedBoxGeometry(0.985, 0.84, 0.985, 2, 0.05), mat(C.body), tiles, (_, t) => pos(t, 0.46));
    make(new THREE.BoxGeometry(0.9, 0.1, 0.9), mat(C.kick), tiles, (_, t) => pos(t, 0.05));
    const topMat = new THREE.MeshStandardMaterial({ map: woodTopTexture(), roughness: 0.7 });
    make(new THREE.RoundedBoxGeometry(1.02, 0.1, 1.02, 2, 0.035), topMat, tiles.filter((t) => t.woodTop), (_, t) => pos(t, TOP_Y - 0.05));

    // Recessed panels on every face that looks onto the floor.
    const panels = [];
    for (const t of tiles) {
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        if (isWalkable(t.x + dx, t.z + dz) || (t.z === D - 1 && dz === 1)) panels.push({ ...t, dx, dz });
      }
    }
    make(new THREE.BoxGeometry(0.74, 0.5, 0.03), mat(C.bodyPanel), panels, (d, t) => {
      const w = tileToWorld(t.x, t.z);
      d.position.set(w.x + t.dx * 0.495, 0.5, w.z + t.dz * 0.495);
      d.rotation.set(0, Math.atan2(t.dx, t.dz), 0);
      d.scale.set(1, 1, 1);
    });
  }

  buildDecor() {
    const r = rng(1234);
    const put = (x, z, obj) => {
      const w = tileToWorld(x, z);
      obj.position.x += w.x;
      obj.position.z += w.z;
      obj.position.y += TOP_Y;
      this.root.add(shadow(obj));
    };
    const plateStack = (n) => {
      const g = new THREE.Group();
      for (let i = 0; i < n; i++) g.add(at(plate(0.2), 0, i * 0.04, 0));
      return g;
    };
    const plant = () => {
      const g = group(at(cyl(0.14, 0.11, 0.2, mat('#d1813f'), 12), 0, 0.1, 0));
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12 + r() * 0.05, 0), mat(i % 2 ? '#5fa35a' : '#4e9150', { flatShading: true }));
        leaf.position.set((r() - 0.5) * 0.18, 0.28 + r() * 0.14, (r() - 0.5) * 0.18);
        g.add(leaf);
      }
      return g;
    };
    const bottles = () => group(
      at(cyl(0.05, 0.06, 0.24, mat('#3e2723', { roughness: 0.3 }), 10), -0.08, 0.12, 0),
      at(cyl(0.02, 0.02, 0.06, mat('#c62828'), 8), -0.08, 0.27, 0),
      at(cyl(0.06, 0.06, 0.18, mat('#f5f5f5', { roughness: 0.3 }), 12), 0.1, 0.09, 0.04),
      at(cyl(0.025, 0.03, 0.08, mat('#f5f5f5', { roughness: 0.3 }), 10), 0.1, 0.22, 0.04),
    );
    const utensils = () => {
      const g = group(at(cyl(0.08, 0.07, 0.18, mat('#78909c', { roughness: 0.4 }), 12), 0, 0.09, 0));
      for (let i = 0; i < 4; i++) {
        const s = cyl(0.012, 0.012, 0.32, mat(i % 2 ? '#8d6e63' : C.steel), 6);
        s.position.set((r() - 0.5) * 0.06, 0.25, (r() - 0.5) * 0.06);
        s.rotation.set((r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4);
        g.add(s);
      }
      return g;
    };
    const cups = () => group(
      at(cyl(0.06, 0.05, 0.1, mat('#e8eaf6', { roughness: 0.3 }), 12), -0.1, 0.05, 0),
      at(cyl(0.06, 0.05, 0.1, mat('#c5cae9', { roughness: 0.3 }), 12), 0.06, 0.05, 0.08),
      at(cyl(0.06, 0.05, 0.1, mat('#e8eaf6', { roughness: 0.3 }), 12), 0.1, 0.05, -0.08),
    );
    const decor = {
      '0,0': sack(1.0), '4,0': utensils(), '7,0': plateStack(5), '10,0': bottles(), '13,0': plateStack(3), '15,0': plant(),
      '0,1': plateStack(4), '15,1': plant(),
      '3,3': plant(), '6,3': utensils(), '9,3': bottles(), '12,3': plateStack(3),
      '4,4': cups(), '11,4': cups(), '15,6': bottles(),
      '0,7': plant(), '4,7': plateStack(3), '10,7': cups(), '15,7': plant(),
    };
    for (const [k, obj] of Object.entries(decor)) {
      const [x, z] = k.split(',').map(Number);
      put(x, z, obj);
    }
    const ext = extinguisher();
    put(13, 7, ext);
    this.extinguisherTile = { x: 13, z: 7 };
  }

  update(dt, t) {
    this.env.update(dt, t);
    for (const s of this.stations) s.update(dt, t);
  }
}
