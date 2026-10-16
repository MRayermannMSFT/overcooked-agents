import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';

/**
 * Is there any process with this PID? It may not be the one that wrote the lock: when a Copilot
 * process crashes its inuse.<pid>.lock stays behind, and the OS eventually reuses the PID.
 */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Run a helper and return its stdout. A non-zero exit still yields its output (e.g. some PIDs not found). */
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000, maxBuffer: 1 << 20, ...opts }, (err, stdout) => {
      if (err && (typeof err.code !== 'number' || err.killed)) reject(err);
      else resolve(String(stdout));
    });
  });
}

const FILETIME_EPOCH_OFFSET_MS = 11644473600000n; // 1601-01-01 → 1970-01-01

/** Parse "<pid> <FILETIME>" lines from PowerShell; -1 means the start time isn't visible to us. */
export function parseWindowsStartTimes(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(-1|\d+)\s*$/.exec(line);
    if (!m) continue;
    out.set(Number(m[1]), m[2] === '-1' ? -1 : Number(BigInt(m[2]) / 10000n - FILETIME_EPOCH_OFFSET_MS));
  }
  return out;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** Parse `ps -o pid=,lstart=` output (LC_ALL=C), e.g. "  123 Thu Oct 16 09:16:02 2026" (local time). */
export function parsePsStartTimes(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s*$/.exec(line);
    if (!m || !(m[2] in MONTHS)) continue;
    out.set(Number(m[1]), new Date(Number(m[7]), MONTHS[m[2]], Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime());
  }
  return out;
}

/** Linux: boot time (/proc/stat btime) + the process's start time (field 22 of /proc/<pid>/stat, in clock ticks). */
export async function linuxStartTimes(pids, { procRoot = '/proc', clockTicks = 100 } = {}) {
  const btime = Number(/^btime\s+(\d+)/m.exec(await fsp.readFile(`${procRoot}/stat`, 'utf8'))?.[1]);
  if (!Number.isFinite(btime)) throw new Error('No btime in /proc/stat');
  const out = new Map();
  for (const pid of pids) {
    let text;
    try {
      text = await fsp.readFile(`${procRoot}/${pid}/stat`, 'utf8');
    } catch {
      continue; // no such process
    }
    // The command name (field 2) is in parentheses and may contain spaces or ')' itself.
    const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
    const ticks = Number(fields[19]); // field 22; `fields` starts at field 3
    if (Number.isFinite(ticks)) out.set(pid, Math.round((btime + ticks / clockTicks) * 1000));
  }
  return out;
}

/**
 * Start times (ms since the epoch) of the given processes. Processes that don't exist are missing
 * from the map; -1 means the process exists but its start time isn't visible to us (another
 * user's or a protected process, so not a Copilot session of ours).
 */
export async function processStartTimes(pids, platform = process.platform) {
  const list = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 0);
  if (!list.length) return new Map();
  if (platform === 'win32') {
    // FILETIME keeps the output culture-independent and needs no type casts (works in constrained PowerShell).
    const script = `Get-Process -Id ${list.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { $t = try { $_.StartTime.ToFileTimeUtc() } catch { -1 }; "$($_.Id) $t" }`;
    return parseWindowsStartTimes(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]));
  }
  if (platform === 'linux') return linuxStartTimes(list);
  return parsePsStartTimes(await run('ps', ['-o', 'pid=,lstart=', '-p', list.join(',')], { env: { ...process.env, LC_ALL: 'C' } }));
}

/**
 * Decides whether inuse.<pid>.lock files belong to running Copilot processes.
 *
 * A lock is live only if a process with that PID exists *and* started before the lock was written;
 * a process that started later just inherited a recycled PID. Verdicts are cached per lock file, so
 * the slower start-time lookup runs once per new lock, batched across all of them. If start times
 * can't be looked up on this machine, it falls back to trusting the PID alone.
 */
export class LockLiveness {
  constructor({ pidAlive = isPidAlive, startTimes = processStartTimes, slackMs = 10_000 } = {}) {
    this.pidAlive = pidAlive;
    this.startTimes = startTimes;
    this.slackMs = slackMs;
    this.verdicts = new Map();
    this.failures = 0;
  }

  static key(lock) {
    return `${lock.pid}@${lock.mtimeMs}`;
  }

  /**
   * @param {{ pid: number, mtimeMs: number }[]} locks
   * @returns {Promise<Map<string, boolean>>} verdict per lock, keyed by LockLiveness.key(lock)
   */
  async check(locks) {
    const result = new Map();
    const pending = [];
    for (const lock of locks) {
      const key = LockLiveness.key(lock);
      if (result.has(key) || pending.some((l) => LockLiveness.key(l) === key)) continue;
      if (!this.pidAlive(lock.pid)) {
        this.verdicts.delete(key);
        result.set(key, false);
      } else if (this.verdicts.has(key)) {
        result.set(key, this.verdicts.get(key));
      } else {
        pending.push(lock);
      }
    }
    if (!pending.length) return result;

    let times = null;
    if (this.failures < 2) {
      try {
        times = await this.startTimes(pending.map((l) => l.pid));
        this.failures = 0;
      } catch {
        this.failures++;
      }
    }
    for (const lock of pending) {
      const key = LockLiveness.key(lock);
      if (!times) {
        // Can't verify right now: trust the PID, and stop asking after repeated failures.
        result.set(key, true);
        if (this.failures >= 2) this.verdicts.set(key, true);
        continue;
      }
      const started = times.get(lock.pid);
      const live = started !== undefined && started >= 0 && started <= lock.mtimeMs + this.slackMs;
      this.verdicts.set(key, live);
      result.set(key, live);
    }
    return result;
  }
}
