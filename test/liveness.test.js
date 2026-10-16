import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LockLiveness, isPidAlive, linuxStartTimes, parsePsStartTimes, parseWindowsStartTimes, processStartTimes,
} from '../server/liveness.js';

const T = Date.parse('2026-10-16T16:00:00Z');
const { key } = LockLiveness;

/** A fake start-time lookup that records the PIDs it was asked about. */
function fakeStarts(known) {
  const fn = async (pids) => {
    fn.calls.push(pids.slice());
    return new Map(pids.filter((p) => known.has(p)).map((p) => [p, known.get(p)]));
  };
  fn.calls = [];
  return fn;
}

test('a lock is live only if its process started before the lock was written', async () => {
  const running = new Set([10, 11, 12, 13]);
  const startTimes = fakeStarts(new Map([[10, T - 5_000], [11, T + 86_400_000], [12, -1]])); // 13 exits meanwhile
  const liveness = new LockLiveness({ pidAlive: (p) => running.has(p), startTimes });
  const verdicts = await liveness.check([
    { pid: 10, mtimeMs: T }, // the Copilot process that wrote the lock
    { pid: 11, mtimeMs: T }, // PID recycled by a process that started a day later
    { pid: 12, mtimeMs: T }, // exists, but its start time is hidden (someone else's process)
    { pid: 13, mtimeMs: T }, // exited between the two checks
    { pid: 14, mtimeMs: T }, // no such process
    { pid: 10, mtimeMs: T }, // duplicate
  ]);
  assert.deepEqual([10, 11, 12, 13, 14].map((pid) => verdicts.get(key({ pid, mtimeMs: T }))), [true, false, false, false, false]);
  assert.deepEqual(startTimes.calls, [[10, 11, 12, 13]], 'one batched lookup, only for PIDs that exist');
});

test('verdicts allow a little clock slack, are cached, and rewritten locks are checked again', async () => {
  const startTimes = fakeStarts(new Map([[20, T + 3_000]]));
  const liveness = new LockLiveness({ pidAlive: () => true, startTimes, slackMs: 10_000 });
  assert.equal((await liveness.check([{ pid: 20, mtimeMs: T }])).get(key({ pid: 20, mtimeMs: T })), true);
  await liveness.check([{ pid: 20, mtimeMs: T }]);
  assert.equal(startTimes.calls.length, 1, 'cached');
  await liveness.check([{ pid: 20, mtimeMs: T + 60_000 }]);
  assert.equal(startTimes.calls.length, 2, 'a rewritten lock is verified again');
});

test('a lock whose PID went away is forgotten, so a reused PID gets verified afresh', async () => {
  let running = true;
  const startTimes = fakeStarts(new Map([[30, T - 1_000]]));
  const liveness = new LockLiveness({ pidAlive: () => running, startTimes });
  const lock = { pid: 30, mtimeMs: T };
  await liveness.check([lock]);
  running = false;
  assert.equal((await liveness.check([lock])).get(key(lock)), false);
  running = true;
  await liveness.check([lock]);
  assert.equal(startTimes.calls.length, 2);
});

test('falls back to trusting the PID when start times cannot be looked up', async () => {
  let calls = 0;
  const liveness = new LockLiveness({
    pidAlive: () => true,
    startTimes: async () => {
      calls++;
      throw new Error('powershell.exe not found');
    },
  });
  const lock = { pid: 40, mtimeMs: T };
  assert.equal((await liveness.check([lock])).get(key(lock)), true);
  assert.equal((await liveness.check([lock])).get(key(lock)), true);
  await liveness.check([lock]);
  await liveness.check([{ pid: 41, mtimeMs: T }]);
  assert.equal(calls, 2, 'gives up after repeated failures instead of spawning a helper every scan');
});

test('parseWindowsStartTimes reads PowerShell FILETIMEs', () => {
  const ms = Date.parse('2026-10-16T16:16:02.123Z');
  const filetime = (BigInt(ms) + 11644473600000n) * 10000n + 4567n; // sub-millisecond ticks are dropped
  assert.deepEqual([...parseWindowsStartTimes(`\r\n41212 ${filetime}\r\n11656 -1\r\nnoise\r\n`)], [[41212, ms], [11656, -1]]);
});

test('parsePsStartTimes reads `ps -o pid=,lstart=` (local time)', () => {
  const out = parsePsStartTimes('  123 Thu Oct 16 09:16:02 2026\n 4567 Fri Oct  2 23:05:59 2026\nnot a process\n');
  assert.equal(out.get(123), new Date(2026, 9, 16, 9, 16, 2).getTime());
  assert.equal(out.get(4567), new Date(2026, 9, 2, 23, 5, 59).getTime());
  assert.equal(out.size, 2);
});

test('linuxStartTimes reads /proc, even when command names contain spaces and parentheses', async () => {
  const proc = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-proc-'));
  try {
    fs.writeFileSync(path.join(proc, 'stat'), 'cpu  1 2 3\nbtime 1792000000\nprocesses 42\n');
    fs.mkdirSync(path.join(proc, '77'));
    // Fields 3..21, then field 22 (starttime) = 12345 clock ticks after boot.
    const fields = ['S', ...Array.from({ length: 18 }, (_, i) => String(i)), '12345', '0', '0'];
    fs.writeFileSync(path.join(proc, '77', 'stat'), `77 (copilot (main) x) ${fields.join(' ')}\n`);
    const out = await linuxStartTimes([77, 78], { procRoot: proc, clockTicks: 100 });
    assert.deepEqual([...out], [[77, 1792000123450]]);
  } finally {
    fs.rmSync(proc, { recursive: true, force: true });
  }
});

test('processStartTimes finds this test process on the current platform', async () => {
  const before = Date.now();
  const missing = 2 ** 31 - 2; // never a valid PID (not a multiple of 4 on Windows, above pid_max elsewhere)
  const out = await processStartTimes([process.pid, missing]);
  const started = out.get(process.pid);
  assert.ok(Number.isFinite(started) && started > 0, `start time for ${process.pid}: ${started}`);
  assert.ok(started <= before + 1_000, 'started before now');
  assert.ok(started > before - 6 * 3600e3, 'started recently');
  assert.equal(out.has(missing), false);
});

test('isPidAlive', () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(0), false);
  assert.equal(isPidAlive(-5), false);
  assert.equal(isPidAlive(1.5), false);
});
