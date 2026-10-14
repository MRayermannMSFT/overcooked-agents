/**
 * Turns raw Copilot session events (the lines of ~/.copilot/session-state/<id>/events.jsonl)
 * into kitchen state: chefs (sessions), sous-chefs (sub-agents), order tickets (user requests),
 * active stations (tool calls) and one-shot effects (fires, served orders, speech bubbles).
 *
 * Pure ESM with no Node/browser APIs: the server uses it for live data and the browser demo
 * replays synthetic events through exactly the same code.
 */
import { classifyTool, isShellFollowupTool, isShellTool, truncate } from './stations.js';

export const ORDER_BASE_COINS = 20;
export const ABORT_PENALTY = 10;
const MAX_RECENT = 30;
const MAX_ORDERS = 6;

/** Stations where a failure is a real kitchen fire. Elsewhere it's just a puff of smoke. */
const FIRE_STATIONS = new Set(['build', 'test', 'lint', 'install', 'ship', 'commit', 'shell', 'trash']);

/** Event types the kitchen cares about; everything else is skipped without JSON parsing. */
export const HANDLED_TYPES = new Set([
  'session.start', 'session.resume', 'session.shutdown', 'session.model_change', 'session.mode_changed',
  'user.message', 'assistant.turn_start', 'assistant.message', 'assistant.turn_end',
  'tool.execution_start', 'tool.execution_complete', 'subagent.started', 'subagent.completed',
  'subagent.failed', 'abort', 'session.error', 'permission.requested', 'permission.completed',
  'session.compaction_start', 'session.compaction_complete', 'session.task_complete',
]);

/**
 * Cheap pre-filter for JSONL lines. Copilot writes `{"type":"...` first, so we can skip the
 * (sometimes multi-megabyte) lines we don't need without parsing them.
 */
export function wantsLine(line) {
  if (!line.startsWith('{"type":"')) return line.startsWith('{');
  const end = line.indexOf('"', 9);
  return end > 9 && HANDLED_TYPES.has(line.slice(9, end));
}

export function tipFor(durationMs) {
  const s = durationMs / 1000;
  if (s <= 60) return 8;
  if (s <= 180) return 6;
  if (s <= 600) return 4;
  if (s <= 1800) return 2;
  return 0;
}

function timeOf(e) {
  const t = Date.parse(e?.timestamp);
  return Number.isFinite(t) ? t : Date.now();
}

/** First sentence/line of an assistant message, for the chef's speech bubble. */
export function firstSentence(text, max = 120) {
  const s = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]/g, '')
    .trim();
  const line = s.split(/\n/).find((l) => l.trim()) || '';
  const m = /^(.+?[.!?])(\s|$)/.exec(line);
  return truncate(m ? m[1] : line, max);
}

function resultText(data) {
  const r = data?.result;
  if (typeof r === 'string') return r;
  if (r && typeof r.content === 'string') return r.content;
  return '';
}

export function exitCodeOf(data) {
  const fromExec = data?.shellExecution?.exitCode;
  if (Number.isInteger(fromExec)) return fromExec;
  const m = /completed with exit code (-?\d+)/.exec(resultText(data).slice(-400));
  return m ? Number(m[1]) : null;
}

function shellIdOf(data) {
  const m = /shellId:\s*([\w-]+)/.exec(resultText(data).slice(-400));
  return m ? m[1] : null;
}

function basename(p) {
  const parts = String(p || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

export class SessionTracker {
  constructor(id, { countFrom = 0 } = {}) {
    this.id = id;
    this.meta = { name: null, summary: null, repo: null, branch: null, cwd: null, client: null, model: null, mode: null };
    this.startedAt = null;
    this.lastEventAt = 0;
    /** Process liveness from lock files (null = unknown). */
    this.alive = null;
    this.ended = false;
    this.inTurn = false;
    this.pendingFinal = false;
    this.orders = [];
    this.tools = new Map();
    this.subagents = new Map();
    this.permissions = new Set();
    this.compacting = false;
    this.shells = new Map();
    this.lastShellStation = null;
    this.say = null;
    this.fire = null;
    this.recent = [];
    this.stats = { served: 0, aborted: 0, coins: 0, tools: 0, fires: 0, stations: {} };
    /** Only events at/after this timestamp count toward stats (e.g. "today"). */
    this.countFrom = countFrom;
    this.version = 0;
  }

  get title() {
    const m = this.meta;
    return m.name || m.summary || (m.repo ? m.repo.split('/').pop() : '') || basename(m.cwd) || `Chef ${this.id.slice(0, 4)}`;
  }

  get status() {
    if (this.ended || this.alive === false) return 'offline';
    const tools = [...this.tools.values()];
    if (this.permissions.size || tools.some((t) => !t.agentId && t.station === 'ask')) return 'waiting';
    if (this.compacting || tools.some((t) => !t.agentId) || this.subagents.size) return 'working';
    if (this.inTurn) return 'thinking';
    return 'idle';
  }

  /** Station of the most recent in-flight main-agent tool (or the last thing it did). */
  currentStation(agentId = null) {
    let best = null;
    for (const t of this.tools.values()) if (t.agentId === agentId && (!best || t.startedAt >= best.startedAt)) best = t;
    if (best) return best.station;
    for (let i = this.recent.length - 1; i >= 0; i--) if (this.recent[i].agentId === agentId) return this.recent[i].station;
    return null;
  }

  setMeta(meta) {
    let changed = false;
    for (const [k, v] of Object.entries(meta || {})) {
      if (v != null && v !== '' && k in this.meta && this.meta[k] !== v) {
        this.meta[k] = v;
        changed = true;
      }
    }
    if (changed) this.version++;
    return changed;
  }

  setAlive(alive) {
    if (this.alive === alive) return false;
    this.alive = alive;
    if (alive === false) {
      // A dead process can't be mid-tool; clear in-flight work so the chef can clock out.
      this.tools.clear();
      this.subagents.clear();
      this.permissions.clear();
      this.inTurn = false;
      this.compacting = false;
    }
    this.version++;
    return true;
  }

  pushRecent(entry) {
    this.recent.push(entry);
    if (this.recent.length > MAX_RECENT) this.recent.splice(0, this.recent.length - MAX_RECENT);
  }

  closeOrders(outcome, at, counts) {
    const fx = [];
    for (const o of this.orders) {
      if (o.implicit && o.toolCount === 0) continue; // an empty follow-up turn isn't worth a ticket
      const durationMs = Math.max(0, at - o.startedAt);
      if (outcome === 'served') {
        const tip = tipFor(durationMs);
        const coins = ORDER_BASE_COINS + tip;
        if (counts) { this.stats.served++; this.stats.coins += coins; }
        fx.push({ kind: 'served', sessionId: this.id, orderId: o.id, coins, tip, durationMs, stations: o.stations.slice(), at });
      } else {
        if (counts) { this.stats.aborted++; this.stats.coins -= ABORT_PENALTY; }
        fx.push({ kind: 'failed', sessionId: this.id, orderId: o.id, coins: -ABORT_PENALTY, durationMs, at });
      }
    }
    this.orders = [];
    return fx;
  }

  openOrder(id, text, at, implicit) {
    if (this.orders.some((o) => o.id === id)) return null;
    const order = { id, text, startedAt: at, stations: [], toolCount: 0, implicit };
    this.orders.push(order);
    if (this.orders.length > MAX_ORDERS) this.orders.shift();
    return { kind: 'order', sessionId: this.id, orderId: id, text, implicit, at };
  }

  /** Apply one raw Copilot event. Returns one-shot effects for the renderer. */
  ingest(e) {
    if (!e || typeof e !== 'object' || typeof e.type !== 'string' || !HANDLED_TYPES.has(e.type)) return [];
    const at = timeOf(e);
    const data = e.data || {};
    const agentId = e.agentId || null;
    const counts = at >= this.countFrom;
    const fx = [];
    if (at > this.lastEventAt) this.lastEventAt = at;
    this.version++;

    switch (e.type) {
      case 'session.start':
      case 'session.resume': {
        const c = data.context || {};
        this.setMeta({ cwd: c.cwd, repo: c.repository, branch: c.branch, model: data.selectedModel });
        if (!this.startedAt) this.startedAt = Date.parse(data.startTime) || at;
        this.ended = false;
        if (e.type === 'session.resume') {
          this.inTurn = false;
          this.tools.clear();
          this.subagents.clear();
          this.permissions.clear();
        }
        break;
      }
      case 'session.shutdown':
        this.ended = true;
        this.inTurn = false;
        this.pendingFinal = false;
        this.compacting = false;
        this.tools.clear();
        this.subagents.clear();
        this.permissions.clear();
        this.orders = [];
        break;
      case 'session.model_change':
        if (!agentId && data.newModel) this.meta.model = data.newModel;
        break;
      case 'session.mode_changed':
        if (data.newMode) this.meta.mode = data.newMode;
        break;
      case 'user.message': {
        if (agentId) {
          const s = this.subagents.get(agentId);
          if (s && !s.task) s.task = truncate(data.content, 160);
          break;
        }
        const f = this.openOrder(data.interactionId || e.id || `order-${at}`, truncate(data.content || '', 280), at, false);
        if (f) fx.push(f);
        this.inTurn = true;
        this.pendingFinal = false;
        break;
      }
      case 'assistant.turn_start': {
        if (agentId) break;
        this.inTurn = true;
        this.pendingFinal = false;
        if (!this.orders.length) {
          const f = this.openOrder(data.interactionId || `turn-${at}`, '', at, true);
          if (f) fx.push(f);
        }
        break;
      }
      case 'assistant.message': {
        const text = firstSentence(data.content);
        if (text) {
          this.say = { text, at, agentId };
          fx.push({ kind: 'say', sessionId: this.id, agentId, text, at });
        }
        if (!agentId) this.pendingFinal = !(Array.isArray(data.toolRequests) && data.toolRequests.length);
        break;
      }
      case 'assistant.turn_end':
        if (agentId) break;
        this.inTurn = false;
        if (this.pendingFinal) {
          this.pendingFinal = false;
          fx.push(...this.closeOrders('served', at, counts));
        }
        break;
      case 'tool.execution_start': {
        const name = data.toolName || 'tool';
        const args = data.arguments;
        let { station, label } = classifyTool(name, args);
        if (isShellFollowupTool(name)) {
          const sid = args && typeof args === 'object' ? args.shellId ?? args.id : null;
          station = (sid != null && this.shells.get(String(sid))) || this.lastShellStation || 'shell';
        } else if (isShellTool(name)) {
          this.lastShellStation = station;
          if (args && args.shellId != null) this.shells.set(String(args.shellId), station);
        }
        const toolCallId = data.toolCallId || e.id || `tool-${at}`;
        const tool = { toolCallId, agentId, tool: name, station, label, startedAt: at };
        this.tools.set(toolCallId, tool);
        if (!agentId) {
          const order = this.orders[this.orders.length - 1];
          if (order) {
            order.toolCount++;
            if (!order.stations.includes(station)) order.stations.push(station);
          }
        }
        if (counts) {
          this.stats.tools++;
          this.stats.stations[station] = (this.stats.stations[station] || 0) + 1;
        }
        this.pushRecent({ at, station, label, agentId, tool: name, ok: null });
        fx.push({ kind: 'tool', sessionId: this.id, ...tool, at });
        break;
      }
      case 'tool.execution_complete': {
        const tool = this.tools.get(data.toolCallId);
        if (!tool) break; // started before we began watching
        this.tools.delete(data.toolCallId);
        const shellish = isShellTool(tool.tool) || isShellFollowupTool(tool.tool);
        if (isShellTool(tool.tool)) {
          const sid = shellIdOf(data);
          if (sid) this.shells.set(sid, tool.station);
        }
        let ok = data.success !== false;
        let error = null;
        if (!ok) {
          const err = data.error;
          error = truncate((err && typeof err === 'object' ? err.message : err) || 'Tool failed', 160);
        } else if (shellish) {
          const code = exitCodeOf(data);
          if (code != null && code !== 0) {
            ok = false;
            error = `Exited with code ${code}`;
          }
        }
        const durationMs = Math.max(0, at - tool.startedAt);
        for (let i = this.recent.length - 1; i >= 0; i--) {
          const r = this.recent[i];
          if (r.at === tool.startedAt && r.tool === tool.tool && r.agentId === tool.agentId && r.ok === null) {
            r.ok = ok;
            r.durationMs = durationMs;
            break;
          }
        }
        fx.push({ kind: 'tool-end', sessionId: this.id, agentId: tool.agentId, toolCallId: tool.toolCallId, station: tool.station, ok, durationMs, error, at });
        if (!ok) {
          const severity = FIRE_STATIONS.has(tool.station) ? 'fire' : 'smoke';
          if (severity === 'fire') {
            this.fire = { station: tool.station, agentId: tool.agentId, message: error, at };
            if (counts) this.stats.fires++;
          }
          fx.push({ kind: 'fire', severity, sessionId: this.id, agentId: tool.agentId, station: tool.station, message: error, at });
        }
        if (tool.tool === 'task_complete' && ok && !tool.agentId) fx.push(...this.closeOrders('served', at, counts));
        break;
      }
      case 'subagent.started': {
        if (!agentId) break;
        const s = {
          agentId,
          name: data.agentName || 'agent',
          displayName: data.agentDisplayName || data.agentName || 'Sous-chef',
          model: data.model || null,
          toolCallId: data.toolCallId || null,
          startedAt: at,
          task: null,
        };
        this.subagents.set(agentId, s);
        fx.push({ kind: 'sub-start', sessionId: this.id, agentId, name: s.name, displayName: s.displayName, at });
        break;
      }
      case 'subagent.completed':
      case 'subagent.failed': {
        if (!agentId) break;
        const s = this.subagents.get(agentId);
        this.subagents.delete(agentId);
        for (const [k, t] of this.tools) if (t.agentId === agentId) this.tools.delete(k);
        fx.push({ kind: 'sub-end', sessionId: this.id, agentId, ok: e.type === 'subagent.completed', displayName: s?.displayName || data.agentDisplayName || null, at });
        break;
      }
      case 'abort':
        if (agentId) break;
        this.inTurn = false;
        this.pendingFinal = false;
        for (const [k, t] of this.tools) if (!t.agentId) this.tools.delete(k);
        this.permissions.clear();
        fx.push(...this.closeOrders('aborted', at, counts));
        break;
      case 'session.error': {
        const station = this.currentStation(agentId) || 'plan';
        const message = truncate(data.message || data.errorType || 'Session error', 160);
        this.fire = { station, agentId, message, at };
        if (counts) this.stats.fires++;
        fx.push({ kind: 'fire', severity: 'fire', sessionId: this.id, agentId, station, message, at });
        break;
      }
      case 'permission.requested':
        if (data.requestId) this.permissions.add(data.requestId);
        break;
      case 'permission.completed':
        this.permissions.delete(data.requestId);
        break;
      case 'session.compaction_start':
        this.compacting = true;
        fx.push({ kind: 'say', sessionId: this.id, agentId: null, text: 'Tidying up the kitchen…', at });
        break;
      case 'session.compaction_complete':
        this.compacting = false;
        break;
      case 'session.task_complete':
        if (agentId) break;
        fx.push(...this.closeOrders(data.success === false ? 'aborted' : 'served', at, counts));
        break;
      default:
        break;
    }
    return fx;
  }

  snapshot() {
    const m = this.meta;
    return {
      id: this.id,
      title: this.title,
      name: m.name,
      summary: m.summary,
      repo: m.repo,
      branch: m.branch,
      cwd: m.cwd,
      client: m.client,
      model: m.model,
      mode: m.mode,
      status: this.status,
      alive: this.alive,
      ended: this.ended,
      compacting: this.compacting,
      startedAt: this.startedAt,
      lastEventAt: this.lastEventAt,
      orders: this.orders.map((o) => ({ ...o, stations: o.stations.slice() })),
      tools: [...this.tools.values()].map((t) => ({ ...t })),
      subagents: [...this.subagents.values()].map((s) => ({ ...s })),
      say: this.say,
      fire: this.fire,
      stats: { ...this.stats, stations: { ...this.stats.stations } },
      recent: this.recent.map((r) => ({ ...r })),
    };
  }
}

/** All sessions on the machine, plus the visibility rules for who is "in the kitchen". */
export class KitchenState {
  constructor({ countFrom = 0, recentMs = 20 * 60 * 1000 } = {}) {
    this.sessions = new Map();
    this.countFrom = countFrom;
    this.recentMs = recentMs;
  }

  get(id) {
    let s = this.sessions.get(id);
    if (!s) {
      s = new SessionTracker(id, { countFrom: this.countFrom });
      this.sessions.set(id, s);
    }
    return s;
  }

  has(id) {
    return this.sessions.has(id);
  }

  ingest(id, event) {
    return this.get(id).ingest(event);
  }

  /** Sessions worth sending to the browser: anyone not offline, or offline but recently active. */
  isVisible(s, now = Date.now()) {
    return s.status !== 'offline' || now - s.lastEventAt < this.recentMs;
  }

  visible(now = Date.now()) {
    return [...this.sessions.values()].filter((s) => this.isVisible(s, now));
  }

  totals() {
    const t = { served: 0, aborted: 0, coins: 0, tools: 0, fires: 0, sessions: this.sessions.size };
    for (const s of this.sessions.values()) {
      t.served += s.stats.served;
      t.aborted += s.stats.aborted;
      t.coins += s.stats.coins;
      t.tools += s.stats.tools;
      t.fires += s.stats.fires;
    }
    t.coins = Math.max(0, t.coins);
    return t;
  }

  snapshot(now = Date.now()) {
    return {
      now,
      since: this.countFrom,
      sessions: this.visible(now).map((s) => s.snapshot()),
      totals: this.totals(),
    };
  }
}
