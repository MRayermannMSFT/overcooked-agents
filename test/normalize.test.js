import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KitchenState, SessionTracker, firstSentence, tipFor, wantsLine, exitCodeOf } from '../public/shared/normalize.js';

let clock = Date.parse('2026-10-14T10:00:00.000Z');
const T = (secs = 1) => new Date((clock += secs * 1000)).toISOString();
const ev = (type, data = {}, extra = {}) => ({ type, data, timestamp: T(), id: `e${clock}`, ...extra });

function run(tracker, events) {
  const fx = [];
  for (const e of events) fx.push(...tracker.ingest(e));
  return fx;
}

test('a full order: prompt → read → edit → test → final answer is served with coins', () => {
  const s = new SessionTracker('s1');
  run(s, [ev('session.start', { selectedModel: 'claude', context: { cwd: 'C:\\repo', repository: 'me/repo', branch: 'main' } })]);
  assert.equal(s.meta.repo, 'me/repo');
  assert.equal(s.status, 'idle');

  let fx = run(s, [ev('user.message', { content: 'Add a login page', interactionId: 'i1' })]);
  assert.deepEqual(fx.map((f) => f.kind), ['order']);
  assert.equal(s.status, 'thinking');
  assert.equal(s.orders.length, 1);

  run(s, [
    ev('assistant.turn_start', { turnId: '0', interactionId: 'i1' }),
    ev('assistant.message', { content: 'Let me look around.', toolRequests: [{}] }),
  ]);
  fx = run(s, [ev('tool.execution_start', { toolCallId: 't1', toolName: 'view', arguments: { path: '/repo/src/app.js' } })]);
  assert.equal(fx[0].kind, 'tool');
  assert.equal(fx[0].station, 'read');
  assert.equal(s.status, 'working');
  run(s, [ev('tool.execution_complete', { toolCallId: 't1', success: true, result: { content: 'x' } })]);
  assert.equal(s.status, 'thinking');

  run(s, [
    ev('tool.execution_start', { toolCallId: 't2', toolName: 'edit', arguments: { path: '/repo/src/login.js' } }),
    ev('tool.execution_complete', { toolCallId: 't2', success: true }),
    ev('tool.execution_start', { toolCallId: 't3', toolName: 'powershell', arguments: { command: 'npm test', description: 'Run tests' } }),
    ev('tool.execution_complete', { toolCallId: 't3', success: true, shellExecution: { exitCode: 0 }, result: { content: 'ok\n<shellId: 1 completed with exit code 0>' } }),
    ev('assistant.turn_end', { turnId: '0' }),
    ev('assistant.turn_start', { turnId: '1', interactionId: 'i1' }),
  ]);
  assert.deepEqual(s.orders[0].stations, ['read', 'code', 'test']);
  assert.equal(s.orders[0].toolCount, 3);

  fx = run(s, [
    ev('assistant.message', { content: 'Done! The login page is ready. More text here.', toolRequests: [] }),
    ev('assistant.turn_end', { turnId: '1' }),
  ]);
  const say = fx.find((f) => f.kind === 'say');
  assert.equal(say.text, 'Done!');
  const served = fx.find((f) => f.kind === 'served');
  assert.ok(served, 'order served');
  assert.equal(served.coins, 20 + served.tip);
  assert.equal(s.orders.length, 0);
  assert.equal(s.status, 'idle');
  assert.equal(s.stats.served, 1);
  assert.equal(s.stats.tools, 3);
  assert.deepEqual(s.stats.stations, { read: 1, code: 1, test: 1 });
  assert.equal(s.recent.length, 3);
  assert.equal(s.recent[2].ok, true);
});

test('a failing test run sets the fryer on fire; failed reads only smoke', () => {
  const s = new SessionTracker('s2');
  run(s, [ev('user.message', { content: 'fix', interactionId: 'i' }), ev('assistant.turn_start', { interactionId: 'i' })]);
  let fx = run(s, [
    ev('tool.execution_start', { toolCallId: 'a', toolName: 'powershell', arguments: { command: 'npm test' } }),
    ev('tool.execution_complete', { toolCallId: 'a', success: true, shellExecution: { exitCode: 1 } }),
  ]);
  const fire = fx.find((f) => f.kind === 'fire');
  assert.equal(fire.station, 'test');
  assert.equal(fire.severity, 'fire');
  assert.equal(s.stats.fires, 1);
  assert.equal(s.fire.station, 'test');

  fx = run(s, [
    ev('tool.execution_start', { toolCallId: 'b', toolName: 'view', arguments: { path: '/nope' } }),
    ev('tool.execution_complete', { toolCallId: 'b', success: false, error: { message: 'Path does not exist' } }),
  ]);
  const smoke = fx.find((f) => f.kind === 'fire');
  assert.equal(smoke.severity, 'smoke');
  assert.equal(smoke.message, 'Path does not exist');
  assert.equal(s.stats.fires, 1);
});

test('background shells: read_powershell inherits the station of its shell', () => {
  const s = new SessionTracker('s3');
  run(s, [ev('assistant.turn_start', {})]);
  run(s, [
    ev('tool.execution_start', { toolCallId: 'p', toolName: 'powershell', arguments: { command: 'dotnet build', mode: 'async' } }),
    ev('tool.execution_complete', { toolCallId: 'p', success: true, result: { content: '<command with shellId: 7 is still running>' } }),
    ev('tool.execution_start', { toolCallId: 'x', toolName: 'view', arguments: { path: 'a' } }),
    ev('tool.execution_complete', { toolCallId: 'x', success: true }),
  ]);
  const fx = run(s, [
    ev('tool.execution_start', { toolCallId: 'r', toolName: 'read_powershell', arguments: { shellId: '7', delay: 30 } }),
    ev('tool.execution_complete', { toolCallId: 'r', success: true, result: { content: 'error CS1002\n<shellId: 7 completed with exit code 1>' } }),
  ]);
  assert.equal(fx.find((f) => f.kind === 'tool').station, 'build');
  const fire = fx.find((f) => f.kind === 'fire');
  assert.equal(fire.station, 'build');
  assert.equal(fire.message, 'Exited with code 1');
});

test('sub-agents become sous-chefs with their own tools', () => {
  const s = new SessionTracker('s4');
  run(s, [ev('user.message', { content: 'research', interactionId: 'i' }), ev('assistant.turn_start', { interactionId: 'i' })]);
  run(s, [ev('tool.execution_start', { toolCallId: 'task1', toolName: 'task', arguments: { description: 'Explore', agent_type: 'explore' } })]);
  let fx = run(s, [ev('subagent.started', { toolCallId: 'task1', agentName: 'explore', agentDisplayName: 'Explore Agent' }, { agentId: 'ag1' })]);
  assert.equal(fx[0].kind, 'sub-start');
  assert.equal(s.subagents.size, 1);
  run(s, [ev('user.message', { content: 'Find the auth code' }, { agentId: 'ag1' })]);
  assert.equal(s.subagents.get('ag1').task, 'Find the auth code');
  assert.equal(s.orders.length, 1, 'sub-agent prompts are not new orders');
  fx = run(s, [ev('tool.execution_start', { toolCallId: 'g', toolName: 'grep', arguments: { pattern: 'auth' }, parentToolCallId: 'task1' }, { agentId: 'ag1' })]);
  assert.equal(fx[0].agentId, 'ag1');
  assert.equal(fx[0].station, 'search');
  assert.deepEqual(s.orders[0].stations, ['plan'], "sous-chef work doesn't add ingredients to the head chef's ticket");
  fx = run(s, [ev('subagent.completed', { toolCallId: 'task1', agentName: 'explore' }, { agentId: 'ag1' })]);
  assert.equal(fx[0].kind, 'sub-end');
  assert.equal(fx[0].ok, true);
  assert.equal(s.subagents.size, 0);
  assert.equal([...s.tools.values()].filter((t) => t.agentId).length, 0);
});

test('ask_user and permission prompts make the chef wait at the bell', () => {
  const s = new SessionTracker('s5');
  run(s, [ev('assistant.turn_start', {}), ev('tool.execution_start', { toolCallId: 'q', toolName: 'ask_user', arguments: {} })]);
  assert.equal(s.status, 'waiting');
  run(s, [ev('tool.execution_complete', { toolCallId: 'q', success: true })]);
  assert.equal(s.status, 'thinking');
  run(s, [ev('permission.requested', { requestId: 'r1' })]);
  assert.equal(s.status, 'waiting');
  run(s, [ev('permission.completed', { requestId: 'r1' })]);
  assert.equal(s.status, 'thinking');
});

test('abort fails the open order; task_complete serves it', () => {
  const s = new SessionTracker('s6');
  run(s, [ev('user.message', { content: 'a', interactionId: 'i1' }), ev('assistant.turn_start', { interactionId: 'i1' })]);
  run(s, [ev('tool.execution_start', { toolCallId: 'v', toolName: 'view', arguments: {} })]);
  let fx = run(s, [ev('abort', { reason: 'user_initiated' })]);
  assert.equal(fx[0].kind, 'failed');
  assert.equal(s.stats.aborted, 1);
  assert.equal(s.stats.coins, -10);
  assert.equal(s.tools.size, 0);

  run(s, [ev('user.message', { content: 'b', interactionId: 'i2' }), ev('assistant.turn_start', { interactionId: 'i2' })]);
  fx = run(s, [
    ev('tool.execution_start', { toolCallId: 'tc', toolName: 'task_complete', arguments: { summary: 'ok' } }),
    ev('tool.execution_complete', { toolCallId: 'tc', success: true }),
    ev('session.task_complete', { summary: 'ok', success: true }),
  ]);
  assert.equal(fx.filter((f) => f.kind === 'served').length, 1, 'served exactly once');
});

test('turns without a prompt get an implicit follow-up ticket; empty ones vanish quietly', () => {
  const s = new SessionTracker('s7');
  let fx = run(s, [ev('assistant.turn_start', { interactionId: 'n1' })]);
  assert.equal(fx[0].kind, 'order');
  assert.equal(fx[0].implicit, true);
  fx = run(s, [ev('assistant.message', { content: 'Nothing to do.', toolRequests: [] }), ev('assistant.turn_end', {})]);
  assert.equal(fx.filter((f) => f.kind === 'served').length, 0);
  assert.equal(s.orders.length, 0);
});

test('shutdown, liveness and errors', () => {
  const s = new SessionTracker('s8');
  run(s, [ev('assistant.turn_start', {}), ev('tool.execution_start', { toolCallId: 'b', toolName: 'powershell', arguments: { command: 'npm run build' } })]);
  const fx = run(s, [ev('session.error', { errorType: 'query', message: '400 bad request' })]);
  assert.equal(fx[0].kind, 'fire');
  assert.equal(fx[0].station, 'build');
  assert.equal(s.status, 'working');
  assert.equal(s.setAlive(false), true);
  assert.equal(s.status, 'offline');
  assert.equal(s.tools.size, 0);
  assert.equal(s.setAlive(false), false);
  s.setAlive(true);
  run(s, [ev('session.shutdown', { shutdownType: 'routine' })]);
  assert.equal(s.status, 'offline');
  run(s, [ev('session.resume', { context: { branch: 'dev' } })]);
  assert.equal(s.status, 'idle');
  assert.equal(s.meta.branch, 'dev');
});

test('stats only count events after countFrom', () => {
  const s = new SessionTracker('s9', { countFrom: clock + 5_000 });
  run(s, [ev('tool.execution_start', { toolCallId: 'old', toolName: 'view', arguments: {} })]);
  assert.equal(s.stats.tools, 0);
  clock += 10_000;
  run(s, [ev('tool.execution_start', { toolCallId: 'new', toolName: 'view', arguments: {} })]);
  assert.equal(s.stats.tools, 1);
});

test('compaction sends the chef to wash up', () => {
  const s = new SessionTracker('s10');
  const fx = run(s, [ev('session.compaction_start', {})]);
  assert.equal(fx[0].kind, 'say');
  assert.equal(s.status, 'working');
  run(s, [ev('session.compaction_complete', {})]);
  assert.equal(s.status, 'idle');
});

test('titles fall back from name → summary → repo → cwd → id', () => {
  const s = new SessionTracker('abcdef12-0000-0000-0000-000000000000');
  assert.equal(s.title, 'Chef abcd');
  s.setMeta({ cwd: 'C:\\code\\my-app' });
  assert.equal(s.title, 'my-app');
  s.setMeta({ repo: 'me/widgets' });
  assert.equal(s.title, 'widgets');
  s.setMeta({ name: 'Fix the bug' });
  assert.equal(s.title, 'Fix the bug');
});

test('KitchenState visibility and totals', () => {
  const k = new KitchenState({ recentMs: 60_000 });
  const a = k.get('a');
  a.setAlive(true);
  a.lastEventAt = 0;
  const b = k.get('b');
  b.setAlive(false);
  b.lastEventAt = 1_000_000;
  const c = k.get('c');
  c.setAlive(false);
  c.lastEventAt = 0;
  const vis = k.visible(1_030_000).map((s) => s.id).sort();
  assert.deepEqual(vis, ['a', 'b']);
  a.stats.coins = 30;
  b.stats.coins = -50;
  assert.equal(k.totals().coins, 0, 'coins never go negative');
  const snap = k.snapshot(1_030_000);
  assert.equal(snap.sessions.length, 2);
});

test('helpers', () => {
  assert.equal(tipFor(30_000), 8);
  assert.equal(tipFor(4 * 3600_000), 0);
  assert.equal(firstSentence('**Bold** start. Then more'), 'Bold start.');
  assert.equal(firstSentence('```js\ncode\n```\nAfter code'), 'After code');
  assert.equal(wantsLine('{"type":"tool.execution_start","data":{}}'), true);
  assert.equal(wantsLine('{"type":"model.messages_snapshot","data":{}}'), false);
  assert.equal(wantsLine('{"data":{},"type":"tool.execution_start"}'), true, 'unknown key order falls back to parsing');
  assert.equal(wantsLine('garbage'), false);
  assert.equal(exitCodeOf({ shellExecution: { exitCode: 2 } }), 2);
  assert.equal(exitCodeOf({ result: { content: 'x\n<shellId: 3 completed with exit code 127>' } }), 127);
  assert.equal(exitCodeOf({ result: 'nothing' }), null);
});
