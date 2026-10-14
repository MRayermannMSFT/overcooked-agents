import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP, W, D, buildStations, findPath, isWalkable, IDLE_SPOTS, SPAWN, DOOR_INSIDE, lineClear } from '../public/js/scene/layout.js';
import { STATIONS } from '../shared/stations.js';

test('map is rectangular', () => {
  for (const row of MAP) assert.equal(row.length, W);
  assert.equal(MAP.length, D);
});

test('every catalog station exists in the kitchen with a reachable access tile', () => {
  const stations = buildStations();
  for (const s of STATIONS) assert.ok(stations.some((k) => k.type === s.id), `missing station ${s.id}`);
  const access = new Map();
  for (const k of stations) {
    const key = `${k.access.x},${k.access.z}`;
    assert.ok(!access.has(key), `${k.id} shares its access tile with ${access.get(key)}`);
    access.set(key, k.id);
  }
  for (const k of stations) {
    assert.ok(isWalkable(k.access.x, k.access.z), `${k.id} access walkable`);
    const path = findPath(SPAWN, k.access);
    assert.ok(path && path.length >= 2, `path to ${k.id}`);
    assert.deepEqual(path[path.length - 1], k.access);
    for (let i = 1; i < path.length; i++) assert.ok(lineClear(path[i - 1], path[i]), `${k.id} segment ${i} clear`);
  }
});

test('idle spots and the door are reachable', () => {
  const access = new Set(buildStations().map((k) => `${k.access.x},${k.access.z}`));
  for (const spot of IDLE_SPOTS) {
    assert.ok(isWalkable(spot.x, spot.z), `idle ${spot.x},${spot.z}`);
    assert.ok(!access.has(`${spot.x},${spot.z}`), `idle spot ${spot.x},${spot.z} blocks a station`);
    assert.ok(findPath(SPAWN, spot), `path to idle ${spot.x},${spot.z}`);
  }
  assert.ok(findPath(DOOR_INSIDE, SPAWN));
  assert.equal(findPath(SPAWN, { x: 0, z: 0 }), null, 'counters are not walkable');
});
