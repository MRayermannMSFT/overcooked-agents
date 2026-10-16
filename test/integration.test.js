import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { KitchenState } from '../public/shared/normalize.js';
import { CopilotWatcher } from '../server/watcher.js';
import { createKitchenServer } from '../server/server.js';

const SID = '11111111-2222-3333-4444-555555555555';
const OLD = '99999999-2222-3333-4444-555555555555';
const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const line = (type, data = {}, extra = {}) =>
  `${JSON.stringify({ type, data, id: Math.random().toString(36).slice(2), timestamp: new Date().toISOString(), parentId: null, ...extra })}\n`;

function setupStateDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-state-'));
  tmpDirs.push(root);
  const dir = path.join(root, SID);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'workspace.yaml'), `id: ${SID}\nrepository: me/demo\nbranch: main\nname: Demo chef\nclient_name: github/cli\n`);
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    line('session.start', { context: { cwd: 'C:\\demo', repository: 'me/demo', branch: 'main' }, selectedModel: 'test-model' }) +
      line('model.messages_snapshot', { huge: 'x'.repeat(10_000) }) +
      line('user.message', { content: 'Make sushi', interactionId: 'i1' }) +
      line('assistant.turn_start', { interactionId: 'i1' }),
  );
  fs.writeFileSync(path.join(dir, `inuse.${process.pid}.lock`), String(process.pid));

  // An old session whose process is gone: should be ignored entirely.
  const old = path.join(root, OLD);
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'events.jsonl'), line('session.start', {}));
  const past = new Date(Date.now() - 3 * 86400e3);
  fs.utimesSync(path.join(old, 'events.jsonl'), past, past);
  fs.mkdirSync(path.join(root, '.session-operation-locks'));
  return { root, dir };
}

async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Fake process start-time lookup: every process started a minute ago (no PowerShell/ps needed in tests). */
const startedAMinuteAgo = async (pids) => new Map(pids.map((p) => [p, Date.now() - 60_000]));

function makeWatcher(root, kitchen, extra = {}) {
  return new CopilotWatcher({ stateDir: root, kitchen, since: Date.now() - 86400e3, pollMs: 30, scanMs: 60, startTimes: startedAMinuteAgo, ...extra });
}

test('watcher: a crashed session whose PID was reused by another process stays out of the kitchen', async (t) => {
  const CRASHED = '33333333-2222-3333-4444-555555555555';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-state-'));
  tmpDirs.push(root);
  const dir = path.join(root, CRASHED);
  fs.mkdirSync(dir);
  // Sixteen days ago a session asked the user a question, then its process crashed without a shutdown event.
  const past = new Date(Date.now() - 16 * 86400e3);
  const old = { timestamp: past.toISOString() };
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    line('session.start', {}, old) + line('user.message', { content: 'old', interactionId: 'o' }, old) +
      line('assistant.turn_start', { interactionId: 'o' }, old) + line('tool.execution_start', { toolCallId: 'q', toolName: 'ask_user', arguments: {} }, old),
  );
  // Its lock names a PID that is running right now (ours) — but the lock predates that process.
  fs.writeFileSync(path.join(dir, `inuse.${process.pid}.lock`), String(process.pid));
  for (const f of ['events.jsonl', `inuse.${process.pid}.lock`]) fs.utimesSync(path.join(dir, f), past, past);

  const kitchen = new KitchenState();
  const watcher = makeWatcher(root, kitchen);
  t.after(() => watcher.stop());
  await watcher.start();
  assert.ok(!kitchen.has(CRASHED), 'a recycled PID is not mistaken for the session’s process');

  // Control: if that process had really started before the lock was written, it's an idle session waiting on you.
  const kitchen2 = new KitchenState();
  const watcher2 = makeWatcher(root, kitchen2, { startTimes: async (pids) => new Map(pids.map((p) => [p, past.getTime() - 60_000])) });
  t.after(() => watcher2.stop());
  await watcher2.start();
  assert.ok(kitchen2.has(CRASHED));
  assert.equal(kitchen2.get(CRASHED).status, 'waiting');
});

test('watcher: discovers live sessions, replays history, tails new events', async (t) => {
  const { root, dir } = setupStateDir();
  const kitchen = new KitchenState();
  const watcher = makeWatcher(root, kitchen);
  t.after(() => watcher.stop());
  await watcher.start();

  assert.ok(kitchen.has(SID));
  assert.ok(!kitchen.has(OLD), 'old dead sessions are not loaded');
  const s = kitchen.get(SID);
  assert.equal(s.alive, true, 'lock file with a live pid');
  assert.equal(s.meta.name, 'Demo chef');
  assert.equal(s.meta.client, 'cli');
  assert.equal(s.status, 'thinking');
  assert.equal(s.orders.length, 1);

  const updates = [];
  watcher.on('update', (u) => updates.push(u));
  fs.appendFileSync(path.join(dir, 'events.jsonl'), line('tool.execution_start', { toolCallId: 'c1', toolName: 'powershell', arguments: { command: 'npm run build' } }));
  const u = await waitFor(() => updates.find((x) => x.fx.some((f) => f.kind === 'tool')));
  assert.deepEqual(u.changed, [SID]);
  assert.equal(u.fx.find((f) => f.kind === 'tool').station, 'build');
  assert.equal(s.status, 'working');

  // Rename via workspace.yaml is picked up by the periodic scan.
  fs.writeFileSync(path.join(dir, 'workspace.yaml'), `id: ${SID}\nname: Renamed chef\n`);
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(path.join(dir, 'workspace.yaml'), later, later);
  await waitFor(() => s.meta.name === 'Renamed chef');

  // Process exits: lock removed, and outside the grace window → chef clocks out.
  watcher.graceMs = 0;
  fs.rmSync(path.join(dir, `inuse.${process.pid}.lock`));
  await waitFor(() => s.status === 'offline');
});

test('watcher: picks up brand-new sessions and resumed old ones', async (t) => {
  const { root } = setupStateDir();
  const kitchen = new KitchenState();
  const watcher = makeWatcher(root, kitchen);
  t.after(() => watcher.stop());
  await watcher.start();
  const updates = [];
  watcher.on('update', (u) => updates.push(u));

  const NEW = '22222222-2222-3333-4444-555555555555';
  fs.mkdirSync(path.join(root, NEW));
  fs.writeFileSync(path.join(root, NEW, 'events.jsonl'), line('session.start', {}) + line('user.message', { content: 'New order!', interactionId: 'n' }));
  await waitFor(() => kitchen.has(NEW));
  const u = await waitFor(() => updates.find((x) => x.fx.some((f) => f.kind === 'order' && f.sessionId === NEW)));
  assert.ok(u, 'recent order on a new session animates');

  fs.appendFileSync(path.join(root, OLD, 'events.jsonl'), line('session.resume', { context: { branch: 'b' } }));
  await waitFor(() => kitchen.has(OLD));
  assert.equal(kitchen.get(OLD).meta.branch, 'b');
});

function request(port, pathname, { method = 'GET', host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: pathname, method, headers: host ? { Host: host } : {} }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('server: health, state, SSE stream, static files and security checks', async (t) => {
  const { root, dir } = setupStateDir();
  const kitchen = new KitchenState();
  const watcher = makeWatcher(root, kitchen);
  await watcher.start();
  const server = createKitchenServer({ kitchen, watcher, host: '127.0.0.1', info: { mode: 'live' }, tickMs: 100 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  t.after(async () => {
    watcher.stop();
    await server.stop();
  });

  const health = await request(port, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, true);
  assert.equal(health.headers['x-content-type-options'], 'nosniff');

  const state = JSON.parse((await request(port, '/api/state')).body);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].title, 'Demo chef');
  assert.equal(state.sessions[0].orders[0].text, 'Make sushi');

  assert.equal((await request(port, '/shared/stations.js')).status, 200);
  assert.match((await request(port, '/shared/stations.js')).headers['content-type'], /javascript/);
  assert.equal((await request(port, '/vendor/README.md')).status, 200);
  assert.equal((await request(port, '/nope.js')).status, 404);
  assert.equal((await request(port, '/api/nope')).status, 404);
  assert.ok([403, 404].includes((await request(port, '/%2e%2e/package.json')).status));
  assert.equal((await request(port, '/api/state', { method: 'POST' })).status, 405);
  assert.equal((await request(port, '/api/state', { host: 'evil.example' })).status, 403, 'DNS-rebinding guard');

  // SSE: snapshot first, then live updates.
  const events = [];
  const res = await new Promise((resolve) => http.get({ port, path: '/api/stream' }, resolve));
  assert.match(res.headers['content-type'], /text\/event-stream/);
  let buf = '';
  res.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (ev && data) events.push({ ev, data: JSON.parse(data) });
    }
  });
  const snap = await waitFor(() => events.find((e) => e.ev === 'snapshot'));
  assert.equal(snap.data.sessions[0].id, SID);

  fs.appendFileSync(
    path.join(dir, 'events.jsonl'),
    line('tool.execution_start', { toolCallId: 'e1', toolName: 'edit', arguments: { path: 'src/roll.js' } }) +
      line('tool.execution_complete', { toolCallId: 'e1', success: true }),
  );
  const upd = await waitFor(() => events.find((e) => e.ev === 'update' && e.data.fx.some((f) => f.kind === 'tool')));
  const toolFx = upd.data.fx.find((f) => f.kind === 'tool');
  assert.equal(toolFx.station, 'code');
  assert.equal(toolFx.label, 'Chopping roll.js');
  assert.ok(upd.data.totals.tools >= 1);
  assert.equal(upd.data.sessions[0].orders[0].stations[0], 'code');
  res.destroy();
});

test('server: idle sessions expire from SSE and reappear when resumed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-state-'));
  tmpDirs.push(root);
  const dir = path.join(root, SID);
  fs.mkdirSync(dir);
  const staleAt = Date.now() - 2 * 3600e3;
  const stale = { timestamp: new Date(staleAt).toISOString() };
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    line('session.start', { context: { repository: 'me/stale' } }, stale) +
      line('assistant.turn_end', {}, stale),
  );
  fs.writeFileSync(path.join(dir, `inuse.${process.pid}.lock`), String(process.pid));

  const idleMs = 60 * 60e3;
  const kitchen = new KitchenState({ idleMs });
  const watcher = makeWatcher(root, kitchen, {
    startTimes: async (pids) => new Map(pids.map((pid) => [pid, staleAt - 60_000])),
  });
  await watcher.start();
  kitchen.get(SID).lastEventAt = Date.now();
  const server = createKitchenServer({ kitchen, watcher, host: '127.0.0.1', info: { mode: 'live' }, tickMs: 10_000 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  let stream;
  t.after(async () => {
    stream?.destroy();
    watcher.stop();
    await server.stop();
  });

  const events = [];
  stream = await new Promise((resolve) => http.get({ port, path: '/api/stream' }, resolve));
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event && data) events.push({ event, data: JSON.parse(data) });
    }
  });
  const snapshot = await waitFor(() => events.find((event) => event.event === 'snapshot'));
  assert.ok(snapshot.data.sessions.some((session) => session.id === SID));

  kitchen.get(SID).lastEventAt = Date.now() - idleMs - 1;
  server.pushUpdate();
  const expired = await waitFor(() => events.find((event) => event.event === 'update' && event.data.removed.includes(SID)));
  assert.deepEqual(expired.data.sessions, []);
  const hidden = JSON.parse((await request(port, '/api/state')).body);
  assert.ok(!hidden.sessions.some((session) => session.id === SID), 'stale idle chef leaves the kitchen');

  fs.appendFileSync(path.join(dir, 'events.jsonl'), line('session.resume', { context: { repository: 'me/stale' } }));
  const returned = await waitFor(() => events.find((event) =>
    event.event === 'update' && event.data.sessions.some((session) => session.id === SID)));
  const resumed = returned.data.sessions.find((session) => session.id === SID);
  assert.equal(resumed.status, 'idle');
});
