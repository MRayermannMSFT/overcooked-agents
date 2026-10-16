import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { FileTailer } from './tail.js';
import { parseFlatYaml, workspaceMeta } from './yaml.js';
import { LockLiveness, isPidAlive, processStartTimes } from './liveness.js';
import { wantsLine } from '../public/shared/normalize.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCK = /^inuse\.(\d+)\.lock$/;

/**
 * Watches ~/.copilot/session-state for Copilot sessions (used by the Copilot CLI, the GitHub
 * Copilot app and SDK clients) and feeds their events.jsonl into a KitchenState.
 *
 * Read-only: it never writes to the state directory.
 *
 * Emits:
 *  - 'update' { changed: string[], fx: object[] }  whenever sessions change
 *  - 'warn'   message
 *  - 'error'  err
 */
export class CopilotWatcher extends EventEmitter {
  constructor({
    stateDir,
    kitchen,
    since = 0,
    pollMs = 500,
    scanMs = 3000,
    graceMs = 5 * 60 * 1000,
    maxReplayBytes = 64 * 1024 * 1024,
    pidAlive = isPidAlive,
    startTimes = processStartTimes,
    liveness = new LockLiveness({ pidAlive, startTimes }),
    now = () => Date.now(),
  }) {
    super();
    this.stateDir = stateDir;
    this.kitchen = kitchen;
    this.since = since;
    this.pollMs = pollMs;
    this.scanMs = scanMs;
    this.graceMs = graceMs;
    this.maxReplayBytes = maxReplayBytes;
    this.liveness = liveness;
    this.now = now;
    this.files = new Map(); // tracked: id -> { id, dir, file, tailer, yamlMtime }
    this.untracked = new Map(); // id -> events.jsonl mtime when last seen
    this.busy = false;
    this.missingWarned = false;
    this.ready = false;
  }

  async start() {
    await this.scan({ initial: true });
    this.ready = true;
    this.pollTimer = setInterval(() => this.exclusive(() => this.poll()), this.pollMs);
    this.scanTimer = setInterval(() => this.exclusive(() => this.scan({ initial: false })), this.scanMs);
    this.pollTimer.unref?.();
    this.scanTimer.unref?.();
  }

  stop() {
    clearInterval(this.pollTimer);
    clearInterval(this.scanTimer);
  }

  async exclusive(fn) {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
    } catch (err) {
      this.emit('error', err);
    } finally {
      this.busy = false;
    }
  }

  /** The inuse.<pid>.lock files in a session folder, with their write times. */
  async locksIn(dir) {
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch {
      return [];
    }
    const locks = [];
    for (const n of names) {
      const m = LOCK.exec(n);
      if (!m) continue;
      try {
        const st = await fsp.stat(path.join(dir, n));
        locks.push({ pid: Number(m[1]), mtimeMs: st.mtimeMs });
      } catch {
        // removed while we looked
      }
    }
    return locks;
  }

  async refreshMeta(entry) {
    const file = path.join(entry.dir, 'workspace.yaml');
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      return false;
    }
    if (st.mtimeMs === entry.yamlMtime) return false;
    entry.yamlMtime = st.mtimeMs;
    try {
      const ws = parseFlatYaml(await fsp.readFile(file, 'utf8'));
      return this.kitchen.get(entry.id).setMeta(workspaceMeta(ws));
    } catch {
      return false;
    }
  }

  async readInto(entry, fx, fxSince) {
    const tracker = this.kitchen.get(entry.id);
    await entry.tailer.readNew((line) => {
      if (!wantsLine(line)) return;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      const out = tracker.ingest(ev);
      if (fx) for (const f of out) if (f.at >= fxSince) fx.push(f);
    });
  }

  async track(id, dir, file, fx) {
    const tailer = new FileTailer(file);
    await tailer.startNear(this.maxReplayBytes);
    const entry = { id, dir, file, tailer, yamlMtime: 0 };
    this.files.set(id, entry);
    this.untracked.delete(id);
    await this.refreshMeta(entry);
    // Replay history silently; only very recent effects (e.g. a brand-new session's first order) animate.
    await this.readInto(entry, fx, this.now() - 15_000);
    return entry;
  }

  refreshLiveness(entry, lockAlive) {
    const tracker = this.kitchen.get(entry.id);
    const alive = lockAlive || (!tracker.ended && this.now() - tracker.lastEventAt < this.graceMs);
    return tracker.setAlive(alive);
  }

  async scan({ initial }) {
    let entries;
    try {
      entries = await fsp.readdir(this.stateDir, { withFileTypes: true });
    } catch {
      if (!this.missingWarned) {
        this.missingWarned = true;
        this.emit('warn', `Copilot session-state directory not found: ${this.stateDir}`);
      }
      return;
    }
    this.missingWarned = false;
    const changed = new Set();
    const fx = initial ? null : [];
    const present = new Set();
    const candidates = [];

    for (const ent of entries) {
      if (!ent.isDirectory() || !UUID.test(ent.name)) continue;
      const id = ent.name;
      present.add(id);
      if (this.files.has(id)) continue;
      const dir = path.join(this.stateDir, id);
      const file = path.join(dir, 'events.jsonl');
      let st;
      try {
        st = await fsp.stat(file);
      } catch {
        continue;
      }
      const seen = this.untracked.get(id);
      // New to us: track it if it was active in the window, or if a Copilot process still has it open.
      if (seen === undefined) candidates.push({ id, dir, file, mtimeMs: st.mtimeMs, needsLock: st.mtimeMs < this.since });
      // An old session that just got new activity (e.g. resumed).
      else if (st.mtimeMs !== seen) candidates.push({ id, dir, file, mtimeMs: st.mtimeMs, needsLock: false });
    }

    // Read every relevant lock first so process start times are looked up in one batch.
    const locks = new Map();
    for (const c of candidates) locks.set(c.id, await this.locksIn(c.dir));
    for (const [id, entry] of this.files) if (present.has(id)) locks.set(id, await this.locksIn(entry.dir));
    const verdicts = await this.liveness.check([...locks.values()].flat());
    const lockAlive = (id) => (locks.get(id) || []).some((l) => verdicts.get(LockLiveness.key(l)));

    for (const c of candidates) {
      if (c.needsLock && !lockAlive(c.id)) {
        this.untracked.set(c.id, c.mtimeMs);
        continue;
      }
      await this.track(c.id, c.dir, c.file, fx);
      changed.add(c.id);
    }

    for (const [id, entry] of this.files) {
      if (!present.has(id)) {
        // Session folder was deleted.
        const t = this.kitchen.get(id);
        if (!t.ended) {
          t.ended = true;
          t.setAlive(false);
          changed.add(id);
        }
        this.files.delete(id);
        continue;
      }
      if (await this.refreshMeta(entry)) changed.add(id);
      if (this.refreshLiveness(entry, lockAlive(id))) changed.add(id);
    }

    if (!initial && (changed.size || fx.length)) this.emit('update', { changed: [...changed], fx });
  }

  async poll() {
    const changed = new Set();
    const fx = [];
    for (const [id, entry] of this.files) {
      let st;
      try {
        st = await fsp.stat(entry.file);
      } catch {
        continue;
      }
      if (st.size === entry.tailer.offset) continue;
      const before = this.kitchen.get(id).version;
      await this.readInto(entry, fx, 0);
      const t = this.kitchen.get(id);
      if (t.version !== before) {
        changed.add(id);
        if (t.alive !== true && !t.ended) t.setAlive(true); // fresh activity means someone is cooking
      }
    }
    if (changed.size || fx.length) this.emit('update', { changed: [...changed], fx });
  }
}
