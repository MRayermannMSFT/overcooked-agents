import { KitchenState } from '../shared/normalize.js';

/**
 * Demo shift: simulated Copilot sessions that emit realistic events.jsonl-style events.
 * The events go through the same normalizer the server uses, so the demo exercises the real pipeline.
 */

const CHEFS = [
  { name: 'One-click checkout', repo: 'acme/storefront', branch: 'feature/one-click-checkout', client: 'app', model: 'claude-opus-5.5', area: 'src/checkout', recipe: 'fire' },
  { name: 'Flaky auth test', repo: 'acme/api', branch: 'fix/flaky-auth-test', client: 'cli', model: 'gpt-6-sol', area: 'tests/auth', recipe: 'sous' },
  { name: 'Docs refresh', repo: 'acme/docs', branch: 'docs/getting-started', client: 'app', model: 'claude-sonnet-5.5', area: 'docs/guide', recipe: 'ask' },
  { name: 'Dependency bumps', repo: 'acme/web', branch: 'chore/deps-oct', client: 'cli', model: 'gpt-5.6-terra', area: 'packages/ui', recipe: 'install' },
  { name: 'Search ranking', repo: 'acme/search', branch: 'feat/bm25-boost', client: 'app', model: 'claude-opus-5', area: 'ranking', recipe: 'normal' },
];

const PROMPTS = {
  'acme/storefront': ['Add one-click checkout to the cart page', 'Show saved cards in the payment step', 'Fix the coupon field losing focus'],
  'acme/api': ['The auth refresh test is flaky on CI — find out why', 'Add rate limiting to the token endpoint', 'Return 409 when the email already exists'],
  'acme/docs': ['Rewrite the getting-started guide for v2', 'Add a troubleshooting page for proxies', 'Document the new webhooks API'],
  'acme/web': ['Bump React and fix any breaking changes', 'Upgrade the design system to 4.0', 'Remove unused lodash imports'],
  'acme/search': ['Boost exact title matches in ranking', 'Add BM25 parameters to the config', 'Speed up the indexer cold start'],
};

const SAYINGS = {
  plan: ['Let me plan this out.', 'Here is the plan.', 'I’ll break this into steps.'],
  read: ['Let me look at the existing code.', 'Reading the component first.', 'Checking how this works today.'],
  search: ['Searching for all the call sites.', 'Let me find where this is used.'],
  code: ['Making the change now.', 'Updating the implementation.', 'Writing the new handler.'],
  build: ['Building to make sure it compiles.'],
  test: ['Running the test suite.', 'Let’s see if the tests pass.'],
  fix: ['A test failed — fixing it.', 'Found the bug, patching it.'],
  commit: ['Committing the change.'],
  ship: ['Pushing and opening a pull request.'],
  done: ['Done! The change is ready for review.', 'All set — tests pass and the PR is up.', 'Finished. Everything is green.'],
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DemoShift {
  constructor(store, { seed = Date.now(), speed = 1, chefs = 4, prefill = true } = {}) {
    this.store = store;
    this.rand = rng(seed);
    this.speed = Math.max(0.25, speed);
    this.prefill = prefill;
    this.kitchen = new KitchenState({ countFrom: 0 });
    this.running = false;
    this.pending = { changed: new Set(), fx: [] };
    this.seq = 0;
    this.chefs = CHEFS.slice(0, Math.max(0, Math.min(CHEFS.length, chefs))).map((c, i) => ({
      ...c,
      id: `demo${i}-0000-4000-8000-${String(i).padStart(12, '0')}`,
      orders: 0,
    }));
  }

  pick(arr) {
    return arr[Math.floor(this.rand() * arr.length)];
  }

  between(a, b) {
    return a + this.rand() * (b - a);
  }

  sleep(secs) {
    return new Promise((r) => setTimeout(r, (secs * 1000) / this.speed));
  }

  uid(prefix = 'id') {
    this.seq++;
    return `${prefix}-${this.seq}-${Math.floor(this.rand() * 1e9).toString(36)}`;
  }

  emit(sessionId, type, data = {}, agentId = null, at = null) {
    const ev = { type, data, id: this.uid('ev'), timestamp: new Date(at ?? Date.now()).toISOString(), parentId: null };
    if (agentId) ev.agentId = agentId;
    const fx = this.kitchen.ingest(sessionId, ev);
    this.pending.changed.add(sessionId);
    this.pending.fx.push(...fx);
  }

  flush() {
    if (!this.pending.changed.size && !this.pending.fx.length) return;
    const sessions = [...this.pending.changed].map((id) => this.kitchen.get(id).snapshot());
    this.store.applyUpdate({ now: Date.now(), sessions, removed: [], fx: this.pending.fx, totals: this.kitchen.totals() });
    this.pending = { changed: new Set(), fx: [] };
  }

  start() {
    this.running = true;
    const now = Date.now();
    for (const c of this.chefs) {
      const t = this.kitchen.get(c.id);
      t.setMeta({ name: c.name, repo: c.repo, branch: c.branch, client: c.client, model: c.model, cwd: `C:\\src\\${c.repo.split('/')[1]}` });
      this.emit(c.id, 'session.start', { selectedModel: c.model, startTime: new Date(now - 3600e3).toISOString(), context: { repository: c.repo, branch: c.branch } }, null, now - 3600e3);
      t.setAlive(true);
    }
    if (this.prefill) this.replayHistory(now);
    this.store.setConnection('demo');
    this.store.applySnapshot({ ...this.kitchen.snapshot(), info: { mode: 'demo' } });
    this.pending = { changed: new Set(), fx: [] };
    this.timer = setInterval(() => this.flush(), 80);
    this.chefs.forEach((c, i) => this.runChef(c, i === 0 ? 0.3 : i * 4.5 + this.rand() * 3));
  }

  /** Pretend the shift has been going for a while: a few orders already served (no animation). */
  replayHistory(now) {
    const steps = [['view', { path: 'src/app.ts' }], ['grep', { pattern: 'TODO' }], ['edit', { path: 'src/app.ts' }],
      ['powershell', { command: 'npm run build' }], ['powershell', { command: 'npm test' }], ['powershell', { command: 'git commit -m wip' }],
      ['powershell', { command: 'git push' }]];
    this.chefs.forEach((c, i) => {
      for (let k = 0; k < 1 + (i % 2); k++) {
        let at = now - (50 - i * 7 - k * 20) * 60e3;
        const interaction = this.uid('past');
        this.emit(c.id, 'user.message', { content: 'Earlier order', interactionId: interaction }, null, at);
        this.emit(c.id, 'assistant.turn_start', { interactionId: interaction }, null, at);
        for (const [name, args] of steps) {
          const id = this.uid('past-call');
          at += 9e3;
          this.emit(c.id, 'tool.execution_start', { toolCallId: id, toolName: name, arguments: args }, null, at);
          this.emit(c.id, 'tool.execution_complete', { toolCallId: id, success: true, shellExecution: { exitCode: 0 } }, null, at + 4e3);
        }
        this.emit(c.id, 'assistant.message', { content: 'Done.', toolRequests: [] }, null, at + 5e3);
        this.emit(c.id, 'assistant.turn_end', {}, null, at + 5e3);
      }
    });
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
  }

  async runChef(c, delay) {
    await this.sleep(delay);
    while (this.running) {
      try {
        await this.order(c);
      } catch (err) {
        console.error('demo chef failed', err);
      }
      await this.sleep(this.between(4, 10));
    }
  }

  async say(c, key, agentId = null) {
    this.emit(c.id, 'assistant.message', { content: this.pick(SAYINGS[key] || SAYINGS.plan), toolRequests: [{ name: 'tool' }] }, agentId);
  }

  async tool(c, name, args, secs, { exit = 0, success = true, agentId = null } = {}) {
    const id = this.uid('call');
    this.emit(c.id, 'tool.execution_start', { toolCallId: id, toolName: name, arguments: args }, agentId);
    await this.sleep(secs);
    const shell = name === 'powershell';
    this.emit(c.id, 'tool.execution_complete', {
      toolCallId: id,
      success,
      ...(shell ? { shellExecution: { exitCode: exit } } : {}),
      ...(success ? { result: { content: shell ? `ok\n<shellId: 1 completed with exit code ${exit}>` : 'ok' } } : { error: { message: 'Tool failed' } }),
    }, agentId);
    if (!agentId) {
      // Like the real stream: the next model turn starts right away; "thinking" happens inside it.
      this.emit(c.id, 'assistant.turn_end', {});
      this.emit(c.id, 'assistant.turn_start', { interactionId: c.interaction });
    }
    await this.sleep(this.between(0.4, 1.4));
  }

  shell(c, command, description, secs, opts) {
    return this.tool(c, 'powershell', { command, description }, secs, opts);
  }

  async sous(c, agentName, displayName, steps) {
    const agentId = this.uid('agent');
    const taskId = this.uid('task');
    this.emit(c.id, 'tool.execution_start', { toolCallId: taskId, toolName: 'task', arguments: { description: displayName, agent_type: agentName, mode: 'background' } });
    this.emit(c.id, 'tool.execution_complete', { toolCallId: taskId, success: true, result: { content: `agent_id: ${agentId}` } });
    this.emit(c.id, 'subagent.started', { toolCallId: taskId, agentName, agentDisplayName: displayName }, agentId);
    this.emit(c.id, 'user.message', { content: displayName }, agentId);
    (async () => {
      for (const [name, args, secs] of steps) {
        this.emit(c.id, 'assistant.message', { content: '', toolRequests: [{ name }] }, agentId);
        await this.tool(c, name, args, secs, { agentId });
      }
      this.emit(c.id, 'subagent.completed', { toolCallId: taskId, agentName }, agentId);
    })();
  }

  async order(c) {
    const r = this.rand;
    const area = c.area;
    const files = ['index.ts', 'service.ts', 'utils.ts', 'types.ts', 'handler.ts', 'view.tsx', 'README.md'];
    const f = () => `${area}/${this.pick(files)}`;
    const recipe = c.orders === 0 ? c.recipe : this.pick(['normal', 'normal', 'fire', 'sous', 'ask', 'install']);
    c.orders++;
    c.interaction = this.uid('interaction');
    this.emit(c.id, 'user.message', { content: PROMPTS[c.repo][(c.orders - 1) % PROMPTS[c.repo].length], interactionId: c.interaction });
    this.emit(c.id, 'assistant.turn_start', { interactionId: c.interaction });
    await this.sleep(this.between(1.2, 2.4));

    await this.say(c, 'plan');
    await this.tool(c, 'report_intent', { intent: 'Planning the change' }, 0.8);
    await this.tool(c, 'sql', { description: 'Create todos', query: 'INSERT INTO todos (id, title) VALUES (...)' }, 0.9);
    if (recipe === 'sous') {
      await this.sous(c, 'explore', 'Explore auth flow', [
        ['grep', { pattern: 'refreshToken' }, 1.6], ['view', { path: 'src/auth/refresh.ts' }, 1.4],
        ['view', { path: 'tests/auth/refresh.test.ts' }, 1.4], ['glob', { pattern: '**/*.test.ts' }, 1.2],
      ]);
    }
    await this.say(c, 'read');
    for (let i = 0; i < 2 + Math.floor(r() * 2); i++) await this.tool(c, 'view', { path: f() }, this.between(0.8, 1.4));
    await this.say(c, 'search');
    await this.tool(c, 'grep', { pattern: this.pick(['TODO', 'export function', 'useCart', 'refresh']) }, 1.2);
    if (recipe === 'install' || r() < 0.25) {
      await this.tool(c, 'web_fetch', { url: 'https://developer.mozilla.org/en-US/docs/Web/API' }, 2.6);
    }
    if (recipe === 'install') await this.shell(c, 'npm install', 'Install dependencies', 5.5);
    if (recipe === 'ask') {
      await this.tool(c, 'ask_user', { question: 'Should the guide target v2 only?' }, 6);
    }
    await this.say(c, 'code');
    for (let i = 0; i < 2 + Math.floor(r() * 3); i++) await this.tool(c, i % 3 === 2 ? 'create' : 'edit', { path: f() }, this.between(1.0, 1.8));
    await this.say(c, 'build');
    await this.shell(c, 'npm run build', 'Build the app', this.between(4, 6.5));
    await this.say(c, 'test');
    if (recipe === 'fire') {
      await this.shell(c, 'npm test', 'Run tests', 5, { exit: 1 });
      await this.say(c, 'fix');
      await this.tool(c, 'edit', { path: f() }, 1.6);
      await this.shell(c, 'npm test', 'Run tests', 4.5);
    } else {
      await this.shell(c, 'npm test', 'Run tests', this.between(4, 6));
    }
    if (r() < 0.4) await this.shell(c, 'npx eslint . --fix', 'Lint and format', 2.5);
    await this.say(c, 'commit');
    await this.shell(c, 'git add -A && git commit -m "Update"', 'Commit the change', 1.6);
    await this.say(c, 'ship');
    await this.shell(c, 'git push -u origin HEAD', 'Push the branch', 2.2);
    await this.tool(c, 'create_pull_request', { title: 'Update' }, 1.8);
    this.emit(c.id, 'assistant.message', { content: this.pick(SAYINGS.done), toolRequests: [] });
    this.emit(c.id, 'assistant.turn_end', {});
  }
}
