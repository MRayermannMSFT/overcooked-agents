/**
 * Kitchen floor plan. One character per 1×1 tile, viewed from above with the camera at the bottom.
 *
 *   . floor   D door   # plain counter   E counter with fire extinguisher
 *   P recipe book (plan)     N nori crate (read)       F fish crate (search)
 *   W delivery hatch (research)   I pantry (install)   C chopping board (code)
 *   R rice cooker (build)    T tempura fryer (test)    S sink (lint)
 *   L plating counter (commit)    H serving hatch (ship)    X prep station (shell)
 *   B bin (trash)            Q order bell (ask)
 */
export const MAP = [
  '#INN#CC#RR#TT#S#',
  '#..............#',
  'P..............L',
  'P..#FF#..#XX#..L',
  'W..####..####..H',
  'W..............H',
  'B..............#',
  '##Q####DD####E##',
];

export const CHAR_STATION = {
  P: 'plan', N: 'read', F: 'search', W: 'research', I: 'install', C: 'code', R: 'build',
  T: 'test', S: 'lint', L: 'commit', H: 'ship', X: 'shell', B: 'trash', Q: 'ask',
};

export const W = MAP[0].length;
export const D = MAP.length;
/** Extra walkable rows outside the door so chefs can arrive and leave. */
const OUTSIDE_ROWS = 2;
export const GRID_D = D + OUTSIDE_ROWS;
const DOOR_XS = [...MAP[D - 1]].map((c, x) => (c === 'D' ? x : -1)).filter((x) => x >= 0);

/** Grid → world: tile centres, kitchen centred on the origin. */
export function tileToWorld(x, z) {
  return { x: x - (W - 1) / 2, z: z - (D - 1) / 2 };
}

export function worldToTile(wx, wz) {
  return { x: Math.round(wx + (W - 1) / 2), z: Math.round(wz + (D - 1) / 2) };
}

export function charAt(x, z) {
  if (x < 0 || x >= W || z < 0) return null;
  if (z >= D) return z < GRID_D && x >= Math.min(...DOOR_XS) - 2 && x <= Math.max(...DOOR_XS) + 2 ? 'o' : null;
  return MAP[z][x];
}

export function isWalkable(x, z) {
  const c = charAt(x, z);
  return c === '.' || c === 'D' || c === 'o';
}

const DIRS4 = [[0, 1], [0, -1], [1, 0], [-1, 0]];

/** Every station tile with where a chef stands to use it, which way they face, and spare spots. */
export function buildStations() {
  const stations = [];
  const accessTiles = new Set();
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const type = CHAR_STATION[MAP[z][x]];
      if (!type) continue;
      let access = null;
      for (const [dx, dz] of DIRS4) {
        if (isWalkable(x + dx, z + dz) && charAt(x + dx, z + dz) !== 'o') {
          access = { x: x + dx, z: z + dz };
          break;
        }
      }
      if (!access) continue;
      const facing = Math.atan2(x - access.x, z - access.z);
      stations.push({ id: `${type}-${x}-${z}`, type, tile: { x, z }, access, facing, overflow: [] });
      accessTiles.add(`${access.x},${access.z}`);
    }
  }
  // Spare spots beside the access tile for when a station is busy.
  for (const s of stations) {
    const ax = s.access.x;
    const az = s.access.z;
    const perp = s.access.x === s.tile.x ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    for (const [dx, dz] of perp) {
      const x = ax + dx;
      const z = az + dz;
      if (isWalkable(x, z) && charAt(x, z) !== 'o' && !accessTiles.has(`${x},${z}`)) {
        s.overflow.push({ x, z, facing: Math.atan2(s.tile.x - x, s.tile.z - z) });
      }
    }
  }
  return stations;
}

/** Where idle chefs hang out (front of the kitchen, away from the door lane). */
export const IDLE_SPOTS = [
  { x: 4, z: 6 }, { x: 11, z: 6 }, { x: 3, z: 5 }, { x: 12, z: 5 }, { x: 5, z: 6 }, { x: 10, z: 6 },
  { x: 13, z: 6 }, { x: 3, z: 6 }, { x: 12, z: 6 }, { x: 6, z: 5 }, { x: 9, z: 5 }, { x: 4, z: 5 },
  { x: 11, z: 5 }, { x: 6, z: 6 }, { x: 9, z: 6 }, { x: 2, z: 5 }, { x: 13, z: 5 },
];

/** Bounding box of the kitchen (for camera fitting): x/z in world units, y up to the wall beam. */
export const BOUNDS = { minX: -W / 2 - 0.3, maxX: W / 2 + 0.3, minZ: -D / 2 - 0.45, maxZ: D / 2 + 0.25, maxY: 2.9 };

export const DOOR_INSIDE = { x: DOOR_XS[0], z: D - 2 };
export const SPAWN = { x: DOOR_XS[0], z: GRID_D - 1 };

// ---------------------------------------------------------------------------
// A* pathfinding on the tile grid (8-way, no corner cutting) + line-of-sight smoothing.
// ---------------------------------------------------------------------------

const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function findPath(from, to) {
  const key = (x, z) => z * W + x;
  if (!isWalkable(to.x, to.z)) return null;
  if (!isWalkable(from.x, from.z)) from = nearestWalkable(from) || from;
  const open = new Map();
  const closed = new Set();
  const g = new Map();
  const parent = new Map();
  const h = (x, z) => {
    const dx = Math.abs(x - to.x);
    const dz = Math.abs(z - to.z);
    return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
  };
  const start = key(from.x, from.z);
  g.set(start, 0);
  open.set(start, { x: from.x, z: from.z, f: h(from.x, from.z) });
  while (open.size) {
    let bestK = null;
    let best = null;
    for (const [k, n] of open) if (!best || n.f < best.f) { best = n; bestK = k; }
    open.delete(bestK);
    if (best.x === to.x && best.z === to.z) {
      const path = [];
      let k = bestK;
      while (k !== undefined) {
        path.push({ x: k % W, z: Math.floor(k / W) });
        k = parent.get(k);
      }
      return smooth(path.reverse());
    }
    closed.add(bestK);
    for (const [dx, dz] of DIRS8) {
      const nx = best.x + dx;
      const nz = best.z + dz;
      if (!isWalkable(nx, nz)) continue;
      if (dx && dz && (!isWalkable(best.x + dx, best.z) || !isWalkable(best.x, best.z + dz))) continue;
      const nk = key(nx, nz);
      if (closed.has(nk)) continue;
      const ng = g.get(bestK) + (dx && dz ? Math.SQRT2 : 1);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        parent.set(nk, bestK);
        open.set(nk, { x: nx, z: nz, f: ng + h(nx, nz) });
      }
    }
  }
  return null;
}

export function nearestWalkable(p) {
  let best = null;
  for (let r = 1; r < 6 && !best; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (isWalkable(p.x + dx, p.z + dz)) {
          const d = dx * dx + dz * dz;
          if (!best || d < best.d) best = { x: p.x + dx, z: p.z + dz, d };
        }
      }
    }
  }
  return best && { x: best.x, z: best.z };
}

/** Can a chef walk in a straight line between two tile centres? (sampled with a small body radius) */
export function lineClear(a, b) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 4);
  for (let i = 0; i <= steps; i++) {
    const t = i / Math.max(1, steps);
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    for (const [ox, oz] of [[0.28, 0.28], [-0.28, 0.28], [0.28, -0.28], [-0.28, -0.28]]) {
      if (!isWalkable(Math.round(x + ox), Math.round(z + oz))) return false;
    }
  }
  return true;
}

function smooth(path) {
  if (path.length <= 2) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !lineClear(path[i], path[j])) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
}
