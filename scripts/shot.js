#!/usr/bin/env node
/**
 * Headless screenshots via the Chrome DevTools Protocol, with zero dependencies.
 * Works with Microsoft Edge or Google Chrome/Chromium (set BROWSER_PATH to override).
 *
 *   node scripts/shot.js <url> <out.png> [--width 1600] [--height 900] [--wait 3000] [--eval "<js>"]
 *
 * Prints any page errors (exceptions, console.error, failed requests) and exits non-zero if there were any.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CANDIDATES = {
  win32: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
  darwin: [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

export function findBrowser() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  const found = (CANDIDATES[process.platform] || []).find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Edge/Chrome found. Set BROWSER_PATH to a Chromium-based browser.');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data || ''}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(fn) {
    this.listeners.push(fn);
  }
}

/** Launch a headless browser and return a page session helper. */
export async function openBrowser({ width = 1600, height = 900 } = {}) {
  const exe = findBrowser();
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-shot-'));
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDir}`, `--window-size=${width},${height}`,
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = path.join(userDir, 'DevToolsActivePort');
  let lines = null;
  for (let i = 0; i < 150 && !lines; i++) {
    await sleep(100);
    if (fs.existsSync(portFile)) {
      const txt = fs.readFileSync(portFile, 'utf8').trim().split('\n');
      if (txt.length >= 2) lines = txt;
    }
  }
  if (!lines) {
    proc.kill();
    throw new Error('Browser did not start (no DevToolsActivePort)');
  }
  const ws = new WebSocket(`ws://127.0.0.1:${lines[0]}${lines[1]}`);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const cdp = new CDP(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => cdp.send(m, p, sessionId);
  const errors = [];
  const logs = [];
  let loaded = null;
  cdp.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(`exception: ${d.exception?.description || d.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (msg.params.type === 'error') errors.push(`console.error: ${text}`);
      else logs.push(`${msg.params.type}: ${text}`);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
    } else if (msg.method === 'Page.loadEventFired' && loaded) {
      loaded();
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const page = {
    errors,
    logs,
    async goto(url, waitMs = 0) {
      const p = new Promise((r) => (loaded = r));
      await send('Page.navigate', { url });
      await Promise.race([p, sleep(20000)]);
      if (waitMs) await sleep(waitMs);
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    },
    async screenshot(out) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, Buffer.from(data, 'base64'));
      return out;
    },
    wait: sleep,
    async close() {
      try {
        await cdp.send('Browser.close');
      } catch {
        // already gone
      }
      ws.close();
      await sleep(300);
      try {
        proc.kill();
      } catch {
        // ignore
      }
      try {
        fs.rmSync(userDir, { recursive: true, force: true });
      } catch {
        // Windows may keep the profile locked for a moment; harmless.
      }
    },
  };
  return page;
}

async function cli() {
  const [url, out, ...rest] = process.argv.slice(2);
  if (!url || !out) {
    console.error('Usage: node scripts/shot.js <url> <out.png> [--width 1600] [--height 900] [--wait 3000] [--eval "<js>"]');
    process.exit(2);
  }
  const opt = { width: 1600, height: 900, wait: 3000, eval: null };
  for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, '')] = rest[i + 1];
  const page = await openBrowser({ width: Number(opt.width), height: Number(opt.height) });
  try {
    await page.goto(url, Number(opt.wait));
    if (opt.eval) {
      const v = await page.eval(opt.eval);
      if (v !== undefined) console.log('eval →', typeof v === 'string' ? v : JSON.stringify(v));
      await page.wait(500);
    }
    await page.screenshot(out);
    console.log(`saved ${out}`);
    for (const l of page.logs.slice(-10)) console.log(`  ${l}`);
    if (page.errors.length) {
      console.error(`${page.errors.length} page error(s):`);
      for (const e of page.errors) console.error(`  ${e}`);
      process.exitCode = 1;
    }
  } finally {
    await page.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  cli().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
