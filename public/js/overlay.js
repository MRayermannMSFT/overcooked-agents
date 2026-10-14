import { THREE } from './scene/world.js';
import { STATION_BY_ID } from '/shared/stations.js';
import { stationIconSvg, iconSvg } from './icons.js';

const el = (cls, html = '') => {
  const d = document.createElement('div');
  d.className = cls;
  if (html) d.innerHTML = html;
  return d;
};

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** HTML elements pinned to 3D positions: station labels, progress bars, fire alerts, chef tags and bubbles. */
export class Overlay {
  constructor(root, { world, kitchen, director, settings }) {
    this.root = root;
    this.world = world;
    this.kitchen = kitchen;
    this.director = director;
    this.settings = settings;
    this.p = { x: 0, y: 0, visible: true };
    this.v = new THREE.Vector3();
    this.stationLabels = this.buildStationLabels();
    this.propEls = new Map();
    this.chefEls = new Map();
    this.floaters = [];
  }

  /** One label per run of adjacent same-type stations (e.g. the two chopping boards share a label). */
  buildStationLabels() {
    const labels = [];
    const seen = new Set();
    for (const p of this.kitchen.stations) {
      if (seen.has(p)) continue;
      const cluster = [p];
      seen.add(p);
      for (let i = 0; i < cluster.length; i++) {
        for (const q of this.kitchen.byType.get(p.type)) {
          if (seen.has(q)) continue;
          const d = Math.abs(q.def.tile.x - cluster[i].def.tile.x) + Math.abs(q.def.tile.z - cluster[i].def.tile.z);
          if (d === 1) {
            cluster.push(q);
            seen.add(q);
          }
        }
      }
      const info = STATION_BY_ID[p.type];
      const anchor = new THREE.Vector3();
      for (const c of cluster) {
        anchor.add(c.center);
        anchor.x += Math.sin(c.def.facing + Math.PI) * 0.56;
        anchor.z += Math.cos(c.def.facing + Math.PI) * 0.56;
      }
      anchor.divideScalar(cluster.length);
      anchor.y = 0.5;
      const node = el(`st-label st-${p.type}`, `${stationIconSvg(p.type, 18)}<span>${escapeHtml(info.short || info.sdlc)}</span>`);
      node.title = `${info.kitchen} → ${info.sdlc}\n${info.examples}`;
      this.root.appendChild(node);
      labels.push({ node, anchor, cluster });
    }
    return labels;
  }

  place(node, pos, dy = 0) {
    this.world.toScreen(pos, this.p);
    node.style.transform = `translate3d(${this.p.x.toFixed(1)}px, ${(this.p.y + dy).toFixed(1)}px, 0)`;
    return this.p;
  }

  floater(pos, html, cls = '') {
    const node = el(`floater ${cls}`, html);
    this.root.appendChild(node);
    this.floaters.push({ node, pos: pos.clone(), born: performance.now() });
  }

  update(t) {
    const showLabels = this.settings.labels;
    for (const l of this.stationLabels) {
      l.node.style.display = showLabels ? '' : 'none';
      if (!showLabels) continue;
      this.place(l.node, l.anchor);
      l.node.classList.toggle('busy', l.cluster.some((c) => c.busy));
    }

    // Progress bars + fire alerts per station instance.
    for (const p of this.kitchen.stations) {
      let rec = this.propEls.get(p.id);
      const prog = p.progress(t);
      const burning = Boolean(p.fire && p.fire.severity === 'fire');
      if (!prog && !burning) {
        if (rec) rec.node.style.display = 'none';
        continue;
      }
      if (!rec) {
        const node = el('st-pop', `<div class="pbar"><div class="fill"></div></div><div class="firewarn">${iconSvg('fire', 30)}</div>`);
        this.root.appendChild(node);
        rec = { node, fill: node.querySelector('.fill'), bar: node.querySelector('.pbar') };
        this.propEls.set(p.id, rec);
      }
      rec.node.style.display = '';
      rec.node.classList.toggle('burning', burning);
      rec.bar.style.display = prog ? '' : 'none';
      if (prog) {
        rec.fill.style.width = `${Math.round(prog.value * 100)}%`;
        rec.bar.dataset.state = prog.state;
      }
      this.place(rec.node, p.anchor);
    }

    // Chef name tags, speech bubbles and emotes.
    const live = new Set();
    const placed = [];
    for (const e of this.director.entities.values()) {
      live.add(e.key);
      let rec = this.chefEls.get(e.key);
      if (!rec) {
        const node = el(`chef-pop${e.sous ? ' sous' : ''}`, '<div class="emote"></div><div class="bubble"></div><div class="tag"><span class="tag-icon"></span><span class="tag-name"></span></div>');
        this.root.appendChild(node);
        rec = { node, emote: node.querySelector('.emote'), bubble: node.querySelector('.bubble'), tag: node.querySelector('.tag'), icon: node.querySelector('.tag-icon'), name: node.querySelector('.tag-name'), last: {} };
        this.chefEls.set(e.key, rec);
      }
      const color = e.model.color;
      if (rec.last.color !== color) {
        rec.node.style.setProperty('--chef', color);
        rec.last.color = color;
      }
      const name = e.sous ? `↳ ${e.name}` : e.name;
      if (rec.last.name !== name) {
        rec.name.textContent = name;
        rec.last.name = name;
      }
      const act = this.director.activityOf(e);
      const iconKey = act.station || 'none';
      if (rec.last.icon !== iconKey) {
        rec.icon.innerHTML = act.station ? stationIconSvg(act.station, 16) : '';
        rec.last.icon = iconKey;
      }
      rec.tag.title = act.text;

      const chatter = this.settings.chatter && !this.settings.privacy;
      const bubbleText = chatter && e.say ? e.say.text : '';
      if (rec.last.bubble !== bubbleText) {
        rec.bubble.textContent = bubbleText;
        rec.bubble.style.display = bubbleText ? '' : 'none';
        rec.last.bubble = bubbleText;
      }

      let emote = '';
      let emoteCls = '';
      if (e.emote) {
        emote = e.emote.text;
        emoteCls = e.emote.kind;
      } else if (e.status === 'waiting' && !e.sous) {
        emote = '?';
        emoteCls = 'ask';
      } else if (e.task?.thinking || (e.status === 'thinking' && !e.task && !e.sous)) {
        emote = '<i></i><i></i><i></i>';
        emoteCls = 'think';
      } else if (e.task?.special === 'extinguish' || (e.mood === 'panic')) {
        emote = '!!';
        emoteCls = 'panic';
      } else if (!e.task && !e.moving && e.target?.startsWith('idle') && t - e.idleSince > 25) {
        emote = 'z<small>z</small><small>z</small>';
        emoteCls = 'sleep';
      }
      const emoteKey = `${emote}|${emoteCls}`;
      if (rec.last.emote !== emoteKey) {
        rec.emote.innerHTML = emote;
        rec.emote.className = `emote ${emoteCls}`;
        rec.emote.style.display = emote ? '' : 'none';
        rec.last.emote = emoteKey;
      }
      rec.node.classList.toggle('selected', this.director.selected === e.key);
      this.world.toScreen(e.headPos, this.p);
      placed.push({ rec, x: this.p.x, y: this.p.y, w: rec.w || 120, h: rec.h || 30 });
    }
    // Keep tags readable when chefs bunch up: nearer chefs keep their spot, farther ones get nudged up.
    placed.sort((a, b) => b.y - a.y);
    for (let i = 0; i < placed.length; i++) {
      const a = placed[i];
      for (let j = 0; j < i; j++) {
        const b = placed[j];
        if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && a.y > b.y - b.h && a.y - a.h < b.y) a.y = Math.max(a.y - 70, b.y - b.h - 2);
      }
      a.rec.node.style.transform = `translate3d(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px, 0)`;
    }
    for (const a of placed) {
      a.rec.w = a.rec.node.offsetWidth;
      a.rec.h = a.rec.node.offsetHeight;
    }
    for (const [key, rec] of this.chefEls) {
      if (!live.has(key)) {
        rec.node.remove();
        this.chefEls.delete(key);
      }
    }

    // Floating "+coins" texts.
    const now = performance.now();
    this.floaters = this.floaters.filter((f) => {
      const k = (now - f.born) / 1700;
      if (k >= 1) {
        f.node.remove();
        return false;
      }
      this.place(f.node, f.pos, -k * 70);
      f.node.style.opacity = String(k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
      return true;
    });
  }
}
