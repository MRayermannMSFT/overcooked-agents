import { THREE } from './scene/world.js';
import { ChefModel, CHEF_COLORS, STATION_ACTION, hashString } from './scene/chef.js';
import { findPath, tileToWorld, worldToTile, IDLE_SPOTS, SPAWN, isWalkable, nearestWalkable } from './scene/layout.js';
import { EXPECTED_SECONDS } from './scene/stationProps.js';

/** What a chef carries away from each station. */
const ITEM_AFTER = {
  plan: 'ticket', read: 'nori', search: 'fish', research: 'parcel', install: 'sack', code: 'sashimi', build: 'rice',
  test: 'tempura', lint: 'plate', commit: 'sushi', ship: null, shell: 'bowl', trash: null, ask: null,
};
const WALK_SPEED = 4.4;
const DASH_SPEED = 6.6;
const MAX_QUEUE = 3;
/** Only long "thinking" pauses send a chef to the recipe book; short ones are spent in place. */
const THINK_DELAY = 3;

const angleLerp = (a, b, k) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

class ChefEntity {
  constructor(director, { key, sessionId, agentId = null, color, name, sous = false }) {
    this.key = key;
    this.sessionId = sessionId;
    this.agentId = agentId;
    this.sous = sous;
    this.name = name;
    this.model = new ChefModel({ id: key, color, sous });
    this.model.entity = this;
    director.world.scene.add(this.model.root);
    const s = tileToWorld(SPAWN.x + (sous ? 1 : 0), SPAWN.z);
    this.pos = new THREE.Vector3(s.x, 0, s.z);
    this.yaw = Math.PI;
    this.path = [];
    this.spot = null;
    this.facing = null;
    this.queue = [];
    this.task = null;
    this.prop = null;
    this.state = 'arriving';
    this.mood = null;
    this.moodUntil = 0;
    this.say = null;
    this.emote = null;
    this.status = 'idle';
    this.statusSince = 0;
    this.idleSince = 0;
    this.moving = false;
    this.speed = 0;
    this.extinguishing = null;
    this.headPos = new THREE.Vector3();
    this.model.root.position.copy(this.pos);
    director.fx.emit('poof', { x: this.pos.x, y: 0.5, z: this.pos.z }, 14);
  }

  setMood(mood, t, secs) {
    this.mood = mood;
    this.moodUntil = t + secs;
  }
}

export class Director {
  constructor({ world, kitchen, fx }) {
    this.world = world;
    this.kitchen = kitchen;
    this.fx = fx;
    this.entities = new Map();
    this.sessions = new Map();
    this.spots = new Map();
    this.colors = new Map();
    this.time = 0;
    this.selected = null;
    this.listeners = [];
    this.raycaster = new THREE.Raycaster();
  }

  on(fn) {
    this.listeners.push(fn);
  }

  emit(type, data) {
    for (const fn of this.listeners) fn(type, data);
  }

  colorFor(sessionId) {
    if (this.colors.has(sessionId)) return this.colors.get(sessionId);
    const used = new Set([...this.entities.values()].filter((e) => !e.sous && e.state !== 'gone').map((e) => this.colors.get(e.sessionId)));
    const start = hashString(sessionId) % CHEF_COLORS.length;
    let color = CHEF_COLORS[start];
    for (let i = 0; i < CHEF_COLORS.length; i++) {
      const c = CHEF_COLORS[(start + i) % CHEF_COLORS.length];
      if (!used.has(c)) {
        color = c;
        break;
      }
    }
    this.colors.set(sessionId, color);
    return color;
  }

  /** Reconcile chefs with the latest session list from the store. */
  sync(sessions) {
    const t = this.time;
    this.sessions = new Map(sessions.map((s) => [s.id, s]));
    const wanted = new Set();
    for (const s of sessions) {
      if (s.status === 'offline') continue;
      wanted.add(s.id);
      let e = this.entities.get(s.id);
      if (!e || e.state === 'leaving' || e.state === 'gone') {
        if (e) this.remove(e);
        e = new ChefEntity(this, { key: s.id, sessionId: s.id, color: this.colorFor(s.id), name: s.title });
        this.entities.set(s.id, e);
        this.emit('arrive', e);
      }
      e.name = s.title;
      if (e.status !== s.status) {
        e.status = s.status;
        e.statusSince = t;
      }
      for (const sa of s.subagents || []) {
        const key = `${s.id}:${sa.agentId}`;
        wanted.add(key);
        if (!this.entities.has(key)) this.spawnSous(s.id, sa);
      }
    }
    for (const e of this.entities.values()) {
      if (!wanted.has(e.key) && e.state !== 'leaving' && e.state !== 'gone') this.leave(e);
    }
  }

  spawnSous(sessionId, sa) {
    const key = `${sessionId}:${sa.agentId}`;
    const e = new ChefEntity(this, {
      key, sessionId, agentId: sa.agentId, sous: true, color: this.colorFor(sessionId), name: sa.displayName || sa.name || 'Sous-chef',
    });
    e.status = 'working';
    this.entities.set(key, e);
    this.emit('arrive', e);
    return e;
  }

  entityFor(fx) {
    if (fx.agentId) {
      const key = `${fx.sessionId}:${fx.agentId}`;
      return this.entities.get(key) || null;
    }
    return this.entities.get(fx.sessionId) || null;
  }

  /** One-shot effects from the server (or demo). */
  onFx(f) {
    const t = this.time;
    const e = this.entityFor(f);
    switch (f.kind) {
      case 'tool': {
        if (!e || e.state === 'leaving') return;
        const last = e.queue[e.queue.length - 1] || (e.task && !e.task.ambient && !e.task.special ? e.task : null);
        if (last && last.station === f.station && !last.special) {
          last.toolCalls.set(f.toolCallId, null);
          last.label = f.label;
          last.ended = false;
          return;
        }
        e.queue.push({ station: f.station, label: f.label, toolCalls: new Map([[f.toolCallId, null]]), ended: false, ok: null, queuedAt: t });
        this.trimQueue(e);
        break;
      }
      case 'tool-end': {
        if (!e) return;
        for (const task of [e.task, ...e.queue]) {
          if (!task || !task.toolCalls || !task.toolCalls.has(f.toolCallId)) continue;
          task.toolCalls.set(f.toolCallId, f.ok);
          task.ended = [...task.toolCalls.values()].every((v) => v !== null);
          if (f.ok === false) task.ok = false;
          else if (task.ended && task.ok !== false) task.ok = true;
          if (task === e.task && e.prop && task.ended) e.prop.endJob(t, task.ok !== false);
        }
        break;
      }
      case 'fire': {
        const prop = (e && e.prop && e.prop.type === f.station ? e.prop : null) || this.nearestProp(f.station, e ? e.pos : null);
        if (!prop) return;
        prop.ignite(f.severity, t);
        if (prop.job && prop.job.end == null) prop.endJob(t, false);
        if (e && f.severity === 'fire') {
          e.setMood('panic', t, 0.9);
          e.queue.unshift({ special: 'extinguish', station: prop.type, prop, label: 'Putting out a fire!', toolCalls: new Map(), ended: true, ok: true, queuedAt: t });
          if (e.task && !e.task.special) this.finishTask(e, true);
        } else if (e) {
          e.setMood('sad', t, 1.2);
        }
        this.emit('fire', { entity: e, prop, fx: f });
        break;
      }
      case 'served': {
        if (!e) return;
        // Turn the pending "ship" step (if any) into the hand-off at the pass so the order of events stays natural.
        const ship = [...e.queue].reverse().find((q) => q.station === 'ship' && !q.special);
        if (ship) {
          ship.special = 'serve';
          ship.coins = f.coins;
          ship.ended = true;
          ship.label = 'Order up!';
        } else {
          e.queue.push({ special: 'serve', station: 'ship', label: 'Order up!', toolCalls: new Map(), ended: true, ok: true, queuedAt: t, coins: f.coins });
          this.trimQueue(e);
        }
        if (e.task && e.task.ambient) this.finishTask(e, true);
        break;
      }
      case 'failed':
        if (e) {
          e.setMood('sad', t, 2.5);
          this.fx.emit('smoke', { x: e.pos.x, y: 1.6, z: e.pos.z }, 10);
        }
        break;
      case 'order':
        if (e) e.emote = { text: '!', until: t + 2.2, kind: 'order' };
        break;
      case 'say':
        if (e) e.say = { text: f.text, until: t + 5.5 };
        break;
      case 'sub-start': {
        const key = `${f.sessionId}:${f.agentId}`;
        if (!this.entities.has(key) && this.entities.has(f.sessionId)) this.spawnSous(f.sessionId, { agentId: f.agentId, displayName: f.displayName, name: f.name });
        const boss = this.entities.get(f.sessionId);
        if (boss) boss.emote = { text: '📣', until: t + 1.8, kind: 'call' };
        break;
      }
      case 'sub-end': {
        const s = this.entities.get(`${f.sessionId}:${f.agentId}`);
        if (s) {
          s.emote = { text: f.ok ? '✓' : '✗', until: t + 2, kind: f.ok ? 'ok' : 'bad' };
          if (f.ok) s.setMood('happy', t, 1);
          this.leave(s, 1.0);
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Keep chefs close to real time: when work piles up, drop the oldest steps that already finished
   * (they were quick and are history now). Special steps (serving, fire fighting) are never dropped.
   */
  trimQueue(e) {
    while (e.queue.length > MAX_QUEUE) {
      let idx = e.queue.findIndex((q) => q.ended && !q.special && q.ok !== false);
      if (idx < 0) idx = e.queue.findIndex((q) => !q.special);
      if (idx < 0) break;
      e.queue.splice(idx, 1);
    }
  }

  nearestProp(type, from) {
    const list = this.kitchen.byType.get(type) || [];
    if (!list.length) return null;
    if (!from) return list[0];
    let best = list[0];
    let bd = Infinity;
    for (const p of list) {
      const d = p.center.distanceToSquared(from);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  leave(e, delay = 0) {
    if (e.state === 'leaving' || e.state === 'gone') return;
    e.state = 'leaving';
    e.leaveAt = this.time + delay;
    e.queue = [];
    if (e.task) this.finishTask(e, true);
    for (const sub of this.entities.values()) if (sub.sous && sub.sessionId === e.sessionId && !e.sous && sub.state !== 'leaving') this.leave(sub);
  }

  remove(e) {
    this.release(e);
    this.world.scene.remove(e.model.root);
    this.entities.delete(e.key);
    if (this.selected === e.key) this.selected = null;
    this.emit('depart', e);
  }

  release(e) {
    if (e.spot) {
      if (this.spots.get(e.spot) === e.key) this.spots.delete(e.spot);
      e.spot = null;
    }
  }

  reserve(e, x, z) {
    this.release(e);
    e.spot = `${x},${z}`;
    this.spots.set(e.spot, e.key);
  }

  spotFree(e, x, z) {
    const owner = this.spots.get(`${x},${z}`);
    return !owner || owner === e.key;
  }

  /** Pick a station instance + standing spot for a station type, preferring free and close ones. */
  chooseSpot(e, type) {
    const props = this.kitchen.byType.get(type) || [];
    let best = null;
    for (const p of props) {
      const opts = [{ x: p.def.access.x, z: p.def.access.z, facing: p.def.facing, main: true }, ...p.def.overflow];
      for (const o of opts) {
        if (!this.spotFree(e, o.x, o.z)) continue;
        const w = tileToWorld(o.x, o.z);
        const d = Math.hypot(w.x - e.pos.x, w.z - e.pos.z) + (o.main ? 0 : 2.5) + (p.burning ? 4 : 0);
        if (!best || d < best.d) best = { prop: p, x: o.x, z: o.z, facing: o.facing, d, main: Boolean(o.main) };
      }
    }
    return best;
  }

  chooseIdleSpot(e) {
    const offset = hashString(e.key) % IDLE_SPOTS.length;
    for (let i = 0; i < IDLE_SPOTS.length; i++) {
      const s = IDLE_SPOTS[(offset + i) % IDLE_SPOTS.length];
      if (this.spotFree(e, s.x, s.z)) return s;
    }
    return IDLE_SPOTS[offset];
  }

  walkTo(e, x, z, facing, offset = null) {
    const from = worldToTile(e.pos.x, e.pos.z);
    const start = isWalkable(from.x, from.z) ? from : nearestWalkable(from) || from;
    const tiles = findPath(start, { x, z });
    const w = tileToWorld(x, z);
    const end = new THREE.Vector3(w.x + (offset ? offset.x : 0), 0, w.z + (offset ? offset.z : 0));
    e.path = tiles ? tiles.slice(1).map((p) => {
      const pw = tileToWorld(p.x, p.z);
      return new THREE.Vector3(pw.x, 0, pw.z);
    }) : [];
    if (e.path.length) e.path[e.path.length - 1] = end;
    else e.path = [end];
    e.facing = facing;
    e.target = `${x},${z}`;
  }

  finishTask(e, ok) {
    const task = e.task;
    if (!task) return;
    if (e.prop) {
      e.prop.users.delete(e.key);
      if (task.ended) e.prop.endJob(this.time, ok !== false && task.ok !== false);
      else if (e.prop.job && !e.prop.users.size) e.prop.job = null;
    }
    if (task.arrivedAt != null && !task.special) e.model.setHeld(ITEM_AFTER[task.station] ?? null);
    if (task.special === 'serve' || task.special === 'extinguish') e.model.setHeld(null);
    e.task = null;
    e.prop = null;
  }

  /** The "background" thing a chef should do when nothing is queued, based on session status. */
  ambientFor(e) {
    if (e.sous) {
      const s = this.sessions.get(e.sessionId);
      const tool = s?.tools?.filter((x) => x.agentId === e.agentId).sort((a, b) => b.startedAt - a.startedAt)[0];
      return tool ? { station: tool.station, label: tool.label, ambient: true, ended: false } : null;
    }
    const s = this.sessions.get(e.sessionId);
    if (!s) return null;
    switch (s.status) {
      case 'waiting':
        return { station: 'ask', label: 'Waiting on you…', ambient: true, ended: false };
      case 'working': {
        const tool = (s.tools || []).filter((x) => !x.agentId).sort((a, b) => b.startedAt - a.startedAt)[0];
        if (tool) return { station: tool.station, label: tool.label, ambient: true, ended: false };
        if (s.compacting) return { station: 'lint', label: 'Tidying up the kitchen', ambient: true, ended: false };
        return { station: 'plan', label: 'Supervising sous-chefs', ambient: true, ended: false };
      }
      case 'thinking':
        return this.time - e.statusSince > THINK_DELAY ? { station: 'plan', label: 'Thinking…', ambient: true, ended: false, thinking: true } : { hold: true };
      default:
        return null;
    }
  }

  startTask(e, task) {
    e.task = task;
    task.startedAt = this.time;
    const prop = task.prop && task.special === 'extinguish' ? task.prop : null;
    if (prop) {
      const o = [{ x: prop.def.access.x, z: prop.def.access.z, facing: prop.def.facing }, ...prop.def.overflow].find((s) => this.spotFree(e, s.x, s.z));
      const spot = o || { x: prop.def.access.x, z: prop.def.access.z, facing: prop.def.facing };
      e.prop = prop;
      this.reserve(e, spot.x, spot.z);
      this.walkTo(e, spot.x, spot.z, spot.facing, this.towards(spot, prop, 0.1));
      e.model.setHeld('extinguisher');
      return;
    }
    const spot = this.chooseSpot(e, task.station);
    if (!spot) {
      e.task = null;
      return;
    }
    e.prop = spot.prop;
    this.reserve(e, spot.x, spot.z);
    this.walkTo(e, spot.x, spot.z, spot.facing, this.towards(spot, spot.prop, spot.main ? 0.16 : 0.08));
  }

  towards(spot, prop, amount) {
    const w = tileToWorld(spot.x, spot.z);
    const dx = prop.center.x - w.x;
    const dz = prop.center.z - w.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: (dx / len) * amount, z: (dz / len) * amount };
  }

  update(dt, t) {
    this.time = t;
    for (const e of [...this.entities.values()]) this.updateEntity(e, dt, t);
  }

  updateEntity(e, dt, t) {
    if (e.mood && t > e.moodUntil) e.mood = null;
    if (e.say && t > e.say.until) e.say = null;
    if (e.emote && t > e.emote.until) e.emote = null;

    if (e.state === 'leaving') {
      if (t >= (e.leaveAt || 0) && e.target !== 'exit') {
        this.release(e);
        this.walkTo(e, SPAWN.x, SPAWN.z, Math.PI);
        e.target = 'exit';
      }
      if (e.target === 'exit' && !e.path.length) {
        this.fx.emit('poof', { x: e.pos.x, y: 0.5, z: e.pos.z }, 14);
        e.state = 'gone';
        this.remove(e);
        return;
      }
    } else {
      this.think(e, t, dt);
    }
    this.move(e, dt, t);
    this.pose(e, dt, t);
  }

  think(e, t, dt = 1 / 60) {
    if (e.state === 'arriving') e.state = 'active';
    const task = e.task;
    const arrived = task && !e.path.length && task.arrivedAt != null;

    if (task) {
      if (!e.path.length && task.arrivedAt == null) {
        task.arrivedAt = t;
        if (e.prop) {
          e.prop.users.add(e.key);
          if (!task.special && !task.thinking) e.prop.startJob(t, EXPECTED_SECONDS[task.station]);
        }
        if (task.special === 'serve' && e.prop?.serve) {
          e.prop.serve(t);
          this.fx.emit('sparkle', e.prop.local(0, 1.3, -0.3), 26);
          e.setMood('happy', t, 1.4);
          this.emit('serve', { entity: e, prop: e.prop, coins: task.coins });
        }
      }
      if (arrived) {
        const dwell = t - task.arrivedAt;
        const busyQueue = e.queue.length > 0;
        const minDwell = task.special === 'serve' ? 1.4 : task.special === 'extinguish' ? 2.4 : busyQueue ? (e.queue.length >= 2 ? 0.4 : 0.6) : 0.9;
        if (task.special === 'extinguish') {
          const p = e.prop.local(0, 1.2, 0.9);
          const dir = new THREE.Vector3().subVectors(e.prop.center, p).normalize();
          this.fx.stream(`${e.key}:foam`, 'foam', { x: e.pos.x + Math.sin(e.yaw) * 0.45, y: 0.7, z: e.pos.z + Math.cos(e.yaw) * 0.45 }, 40, dt, { dir, speed: 2.2 });
          if (dwell > 1.6) e.prop.extinguish(t);
        }
        if (task.ambient) {
          const amb = this.ambientFor(e);
          const changed = !amb || amb.hold || amb.station !== task.station || amb.label !== task.label;
          if ((busyQueue && dwell > 0.6) || (changed && dwell > 0.8)) this.finishTask(e, true);
          else if (amb && !amb.hold) task.label = amb.label;
        } else if (dwell >= minDwell && (task.ended || (busyQueue && dwell > 1.8))) {
          this.finishTask(e, task.ok !== false);
        }
      }
      if (e.task) return;
    }

    // Pick what to do next.
    const next = e.queue.shift();
    if (next) {
      this.startTask(e, next);
      return;
    }
    const amb = this.ambientFor(e);
    if (amb && !amb.hold) {
      this.startTask(e, amb);
      return;
    }
    if (amb && amb.hold) return;
    // Idle: wander to a resting spot.
    if (!e.target || !e.target.startsWith('idle')) {
      const s = this.chooseIdleSpot(e);
      this.reserve(e, s.x, s.z);
      this.walkTo(e, s.x, s.z, 0);
      e.target = `idle:${s.x},${s.z}`;
      e.idleSince = t;
    }
  }

  move(e, dt) {
    const root = e.model.root;
    if (e.path.length) {
      const next = e.path[0];
      const dx = next.x - e.pos.x;
      const dz = next.z - e.pos.z;
      const dist = Math.hypot(dx, dz);
      const speed = e.queue.length >= 2 || e.state === 'leaving' || e.task?.special ? DASH_SPEED : WALK_SPEED;
      const step = speed * dt;
      if (dist <= step || dist < 0.02) {
        e.pos.x = next.x;
        e.pos.z = next.z;
        e.path.shift();
      } else {
        e.pos.x += (dx / dist) * step;
        e.pos.z += (dz / dist) * step;
        e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), Math.min(1, dt * 12));
      }
      e.moving = true;
      e.speed = speed;
      if (speed > WALK_SPEED && Math.random() < dt * 9) this.fx.emit('dust', { x: e.pos.x, y: 0.08, z: e.pos.z }, 1);
    } else {
      e.moving = false;
      e.speed = 0;
      if (e.facing != null) e.yaw = angleLerp(e.yaw, e.facing, Math.min(1, dt * 10));
    }
    // Gentle separation so chefs don't overlap when standing around.
    if (!e.moving && !e.task) {
      for (const o of this.entities.values()) {
        if (o === e || o.moving) continue;
        const dx = e.pos.x - o.pos.x;
        const dz = e.pos.z - o.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 0.6) {
          const push = (0.6 - d) * dt * 2;
          const nx = e.pos.x + (dx / d) * push;
          const nz = e.pos.z + (dz / d) * push;
          const tile = worldToTile(nx, nz);
          if (isWalkable(tile.x, tile.z)) {
            e.pos.x = nx;
            e.pos.z = nz;
          }
        }
      }
    }
    root.position.set(e.pos.x, 0, e.pos.z);
    root.rotation.y = e.yaw;
    e.model.ring.visible = this.selected === e.key;
  }

  pose(e, dt, t) {
    const task = e.task;
    const working = Boolean(task && task.arrivedAt != null && !e.path.length);
    let action = task ? (task.special === 'extinguish' ? 'extinguish' : STATION_ACTION[task.station]) : null;
    if (task?.special === 'serve') action = 'serve';
    let mood = e.mood;
    if (!mood && !task && !e.moving && e.target?.startsWith('idle') && t - e.idleSince > 25) mood = 'sleep';
    e.model.animate(dt, t, { moving: e.moving, speed: e.speed, action, working, mood });
    e.headPos.set(e.pos.x, e.sous ? 1.25 : 1.95, e.pos.z);
  }

  /** Text describing what a chef is doing right now (for name tags and the roster). */
  activityOf(e) {
    if (e.state === 'leaving') return { station: null, text: e.sous ? 'Heading out' : 'Clocking out' };
    const t = e.task;
    if (t) return { station: t.station, text: t.label, special: t.special || null, thinking: Boolean(t.thinking) };
    if (e.status === 'thinking') return { station: 'plan', text: 'Thinking…', thinking: true };
    return { station: null, text: e.sous ? 'Waiting for orders' : 'On break' };
  }

  /** Raycast a click to a chef. */
  pick(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.world.camera);
    const roots = [...this.entities.values()].map((e) => e.model.root);
    const hit = this.raycaster.intersectObjects(roots, true).find((h) => h.object.userData.chef);
    return hit ? hit.object.userData.chef.entity : null;
  }
}
