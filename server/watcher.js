import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { FileTailer } from './tail.js';
import { parseFlatYaml, workspaceMeta } from './yaml.js';
import { wantsLine } from '../shared/normalize.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCK = /^inuse\.(\d+)\.lock$/;

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

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
    this.pidAlive = pidAlive;
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

  async lockAlive(dir) {
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch {
      return false;
    }
    for (const n of names) {
      const m = LOCK.exec(n);
      if (m && this.pidAlive(Number(m[1]))) return true;
    }
    return false;
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

  async refreshLiveness(entry) {
    const tracker = this.kitchen.get(entry.id);
    const lock = await this.lockAlive(entry.dir);
    const alive = lock || (!tracker.ended && this.now() - tracker.lastEventAt < this.graceMs);
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
      let shouldTrack;
      if (seen === undefined) shouldTrack = st.mtimeMs >= this.since || (await this.lockAlive(dir));
      else shouldTrack = st.mtimeMs !== seen; // an old session just got new activity (e.g. resumed)
      if (!shouldTrack) {
        this.untracked.set(id, st.mtimeMs);
        continue;
      }
      await this.track(id, dir, file, fx);
      changed.add(id);
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
      if (await this.refreshLiveness(entry)) changed.add(id);
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
