/**
 * Minimal reader for Copilot's flat `workspace.yaml` files (`key: value` pairs,
 * optionally quoted, plus `|`/`>` block scalars). Not a general YAML parser.
 */
export function parseFlatYaml(text) {
  const out = {};
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^([A-Za-z0-9_.-]+):(?:\s+(.*)|\s*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = (m[2] ?? '').trim();
    if (/^[|>][+-]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        block.push(lines[++i].replace(/^\s{1,2}/, ''));
      }
      value = (value.startsWith('>') ? block.join(' ') : block.join('\n')).trim();
    } else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1).replace(/''/g, "'");
    }
    if (value === 'null' || value === '~') value = null;
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    out[key] = value;
  }
  return out;
}

const CLIENTS = { 'github/autopilot': 'app', 'github/cli': 'cli' };

/** Map a parsed workspace.yaml to SessionTracker meta fields. */
export function workspaceMeta(ws) {
  let name = typeof ws.name === 'string' ? ws.name.trim() : null;
  if (name && /^new (session|chat)$/i.test(name)) name = null; // placeholder until the session is named
  const clientRaw = typeof ws.client_name === 'string' ? ws.client_name : null;
  return {
    name: name || null,
    summary: typeof ws.summary === 'string' ? ws.summary : null,
    repo: typeof ws.repository === 'string' ? ws.repository : null,
    branch: typeof ws.branch === 'string' ? ws.branch : null,
    cwd: typeof ws.cwd === 'string' ? ws.cwd : null,
    client: clientRaw ? CLIENTS[clientRaw] || clientRaw.split('/').pop() : null,
  };
}
