#!/usr/bin/env node
/**
 * Regenerates the documentation screenshots in docs/screenshots.
 *
 *   npm run screenshots              # demo-mode shots only (no real data)
 *   npm run screenshots -- --live owner/repo
 *                                    # also capture live.png, filtered to one repo, prompts hidden
 *
 * Demo shots run against a server pointed at an empty temp state dir, so no real session data can leak in.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openBrowser } from './shot.js';
import { KitchenState } from '../public/shared/normalize.js';
import { CopilotWatcher } from '../server/watcher.js';
import { createKitchenServer, ROOT } from '../server/server.js';
import { defaultStateDir, parseSince } from '../server/config.js';

const OUT = path.join(ROOT, 'docs', 'screenshots');
const W = 1600;
const H = 900;
const args = process.argv.slice(2);
const liveRepo = args.includes('--live') ? args[args.indexOf('--live') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;

async function startServer(stateDir) {
  const kitchen = new KitchenState({ countFrom: parseSince('today') });
  const watcher = new CopilotWatcher({ stateDir, kitchen, since: parseSince('today') });
  await watcher.start();
  const server = createKitchenServer({ kitchen, watcher, info: { mode: 'live' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, stop: async () => { watcher.stop(); await server.stop(); } };
}

/** Wait (polling) until a JS expression in the page is truthy. */
async function until(page, expr, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await page.eval(expr)) return true;
    await page.wait(250);
  }
  throw new Error(`Timed out waiting for: ${expr}`);
}

const HOOKS = `(() => {
  window.__shots = { fire: 0, served: 0, sub: 0, serveAnim: 0 };
  __kitchen.store.on('fx', (f) => {
    if (f.kind === 'fire' && f.severity === 'fire') __shots.fire++;
    if (f.kind === 'served') __shots.served++;
    if (f.kind === 'sub-start') __shots.sub++;
  });
  __kitchen.director.on((type) => { if (type === 'serve') __shots.serveAnim++; });
  return true;
})()`;

const shots = [];
const want = (name) => !only || only.includes(name);
async function save(page, name, clip) {
  if (!want(name)) return;
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot(file, clip);
  shots.push(file);
  console.log(`  📸 ${path.relative(ROOT, file)}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const emptyState = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-empty-'));
  const srv = await startServer(emptyState);
  const page = await openBrowser({ width: W, height: H });
  const demo = (q = '') => `${srv.url}/?demo&nointro&seed=7${q}`;
  try {
    // 1. The kitchen itself, before the shift starts (station map).
    console.log('Kitchen layout…');
    await page.goto(demo('&chefs=0&prefill=0'), 1500);
    await page.wait(400);
    await save(page, 'kitchen');

    // 2. Busy demo shift: capture each moment the first time it happens (they overlap in time).
    console.log('Demo shift (this takes about a minute)…');
    await page.goto(demo(), 300);
    await page.eval(HOOKS);
    const moments = [
      {
        when: '__shots.fire > 0',
        delay: 1100,
        run: async () => {
          await save(page, 'hero');
          await save(page, 'fire', { x: 470, y: 150, width: 760, height: 430 });
          await save(page, 'tickets', { x: 0, y: 0, width: 760, height: 150 });
        },
      },
      { when: '__shots.serveAnim > 0', delay: 450, run: () => save(page, 'serve') },
      {
        when: '[...__kitchen.director.entities.values()].some((e) => e.sous && e.task && e.task.arrivedAt != null && !e.path.length)',
        delay: 300,
        run: () => save(page, 'sous-chef'),
      },
      // Close-ups at 2× device pixels, taken while a chef is actually working there.
      {
        when: `[...__kitchen.director.entities.values()].some((e) => !e.sous && e.task && ['code', 'read'].includes(e.task.station) && e.task.arrivedAt != null && !e.path.length && e.pos.z < -1.5)`,
        delay: 250,
        run: async () => {
          await page.setScale(2);
          await save(page, 'closeup-prep', { x: 250, y: 180, width: 560, height: 315 });
          await page.setScale(1);
        },
      },
      {
        when: `[...__kitchen.director.entities.values()].some((e) => !e.sous && e.task && ['build', 'test'].includes(e.task.station) && e.task.arrivedAt != null && !e.path.length)`,
        delay: 250,
        run: async () => {
          await page.setScale(2);
          await save(page, 'closeup-cook', { x: 780, y: 180, width: 560, height: 315 });
          await page.setScale(1);
        },
      },
    ];
    const deadline = Date.now() + 150000;
    while (moments.length && Date.now() < deadline) {
      for (let i = 0; i < moments.length; i++) {
        if (!(await page.eval(moments[i].when))) continue;
        const [m] = moments.splice(i, 1);
        await page.wait(m.delay);
        await m.run();
        break;
      }
      await page.wait(200);
    }
    if (moments.length) throw new Error(`Timed out waiting for: ${moments.map((m) => m.when).join(' | ')}`);

    // 3. Brigade panel with a chef selected (wait until the shift has some history to show).
    console.log('Panels…');
    await until(page, '__kitchen.store.totals.served >= 4');
    await page.eval(`(() => { const k = __kitchen; k.director.selected = k.store.list()[0].id; k.panels.setRoster(true); return true; })()`);
    await page.wait(900);
    await save(page, 'brigade');
    await page.eval(`(() => { __kitchen.director.selected = null; __kitchen.panels.setRoster(false); return true; })()`);

    // 4. The menu (legend).
    await page.eval(`document.querySelector('[data-act="legend"]').click()`);
    await page.wait(600);
    await save(page, 'menu');
    await page.eval(`document.querySelector('.legend .x').click()`);

    // 5. Settings popover.
    await page.eval(`document.querySelector('[data-act="settings"]').click()`);
    await page.wait(400);
    await save(page, 'settings', { x: 1150, y: 0, width: 450, height: 470 });
    await page.eval(`document.querySelector('[data-act="settings"]').click()`);

    // 7. Privacy mode (prompts and file names hidden).
    console.log('Privacy mode…');
    await page.goto(demo('&privacy=1'), 18000);
    await save(page, 'privacy');

    // 8. Optional: live view of one repository on this machine, prompts hidden.
    if (liveRepo) {
      console.log(`Live view of ${liveRepo}…`);
      const live = await startServer(defaultStateDir());
      try {
        await page.goto(`${live.url}/?nointro&privacy=1&chatter=0&repo=${encodeURIComponent(liveRepo)}`, 6000);
        await save(page, 'live');
      } finally {
        await live.stop();
      }
    }

    const errors = page.errors.filter((e) => !/favicon/.test(e));
    if (errors.length) {
      console.error(`\n${errors.length} page error(s):\n  ${errors.join('\n  ')}`);
      process.exitCode = 1;
    }
    console.log(`\nSaved ${shots.length} screenshot(s) to ${path.relative(ROOT, OUT)}`);
  } finally {
    await page.close();
    await srv.stop();
    fs.rmSync(emptyState, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
