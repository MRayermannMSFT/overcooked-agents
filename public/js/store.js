/** Client-side copy of the kitchen state, fed by the live SSE stream or the demo simulator. */
export class Store {
  constructor({ repo = null } = {}) {
    this.sessions = new Map();
    this.serverTotals = { served: 0, aborted: 0, coins: 0, tools: 0, fires: 0 };
    this.info = {};
    this.connection = 'connecting';
    this.repo = repo ? repo.toLowerCase() : null;
    this.listeners = {};
    this.lastUpdate = 0;
  }

  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  emit(type, data) {
    for (const fn of this.listeners[type] || []) fn(data);
  }

  matches(s) {
    return !this.repo || (s.repo || '').toLowerCase() === this.repo;
  }

  setConnection(state) {
    if (state === this.connection) return;
    this.connection = state;
    this.emit('connection', state);
  }

  get totals() {
    if (!this.repo) return this.serverTotals;
    const t = { served: 0, aborted: 0, coins: 0, tools: 0, fires: 0 };
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

  list() {
    return [...this.sessions.values()].sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  }

  applySnapshot(snap) {
    this.sessions.clear();
    for (const s of snap.sessions || []) if (this.matches(s)) this.sessions.set(s.id, s);
    if (snap.totals) this.serverTotals = snap.totals;
    if (snap.info) this.info = snap.info;
    this.lastUpdate = Date.now();
    this.emit('sessions', this.list());
    this.emit('totals', this.totals);
  }

  applyUpdate(u) {
    for (const s of u.sessions || []) {
      if (this.matches(s)) this.sessions.set(s.id, s);
      else this.sessions.delete(s.id);
    }
    for (const id of u.removed || []) this.sessions.delete(id);
    if (u.totals) this.serverTotals = u.totals;
    this.lastUpdate = Date.now();
    this.emit('sessions', this.list());
    this.emit('totals', this.totals);
    for (const f of u.fx || []) if (this.sessions.has(f.sessionId)) this.emit('fx', f);
  }
}

/** Live mode: Server-Sent Events from the local server (EventSource reconnects on its own). */
export function connectLive(store, { onUnavailable } = {}) {
  let opened = false;
  let failures = 0;
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', (ev) => {
    opened = true;
    failures = 0;
    store.setConnection('live');
    store.applySnapshot(JSON.parse(ev.data));
  });
  es.addEventListener('update', (ev) => store.applyUpdate(JSON.parse(ev.data)));
  es.onerror = () => {
    failures++;
    store.setConnection(opened ? 'reconnecting' : 'offline');
    if (!opened && failures >= 2 && onUnavailable) {
      es.close();
      onUnavailable();
    }
  };
  return { close: () => es.close() };
}
