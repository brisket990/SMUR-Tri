// ============================================================
//  Multijoueur en réseau local (serveur : outils/multijoueur.py)
// ============================================================
//  - Le PC du formateur lance le serveur et ouvre le jeu : c'est l'« hôte ».
//    Il fait tourner la simulation (temps, aggravations…) et voit tout.
//  - Les joueurs (1 à N, rôles libres : médecin, infirmier, ambulancier…)
//    ouvrent l'adresse du serveur : ils envoient leurs actions à l'hôte et
//    reçoivent l'état du terrain ~10 fois par seconde.
//  - La disposition des victimes est identique partout (même n° de partie) ;
//    seul « ce qui bouge » transite. Les fiches restent chiffrées : chaque
//    poste les déchiffre avec son propre code d'accès.

export const ROLES = {
  med: { label: 'Médecin', short: 'MED', color: '#d6322f' },
  ide: { label: 'Infirmier', short: 'IDE', color: '#1f9d55' },
  amb: { label: 'Ambulancier', short: 'AMB', color: '#2f6fd0' },
};

const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* privé */ } },
};

/** Identifiant de ce poste (stable pour l'onglet : reconnexion après veille) */
export function myPid() {
  let p = store.get('mp.pid');
  if (!p) { p = Math.random().toString(36).slice(2, 10); store.set('mp.pid', p); }
  return p;
}

export async function post(path, body, timeout = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: ctl.signal, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j });
    return j;
  } finally { clearTimeout(t); }
}

/** Le jeu est-il servi par le serveur multijoueur ? → infos du serveur, sinon null */
export async function probeServer() {
  if (location.protocol === 'file:') return null;
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('/mp/info', { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.server) return null;
    // ?joueur=1 : jouer depuis le PC du serveur (2e onglet)
    if (new URLSearchParams(location.search).has('joueur')) j.host = false;
    return j;
  } catch { return null; }
}

// ------------------------------------------------------------ dessin
/** Dessine un intervenant (pion + étiquette), repère écran */
export function drawAvatar(ctx, camera, a, { me = false, reach = 0, now = 0, lost = false } = {}) {
  const [sx, sy] = camera.worldToScreen(a.x, a.y);
  const role = ROLES[a.role] ?? ROLES.med;
  ctx.save();
  if (reach && !me) {
    ctx.strokeStyle = hexA(role.color, 0.55);
    ctx.fillStyle = hexA(role.color, 0.06);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -now / 80;
    ctx.beginPath(); ctx.arc(sx, sy, reach * camera.zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (a.tx != null && !me) {
    const [tx, ty] = camera.worldToScreen(a.tx, a.ty);
    ctx.strokeStyle = hexA(role.color, 0.7);
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = lost ? 0.4 : 1;
  ctx.fillStyle = role.color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(sx, sy, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '800 9px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(role.short, sx, sy + 0.5);
  const label = (a.name || role.label) + (me ? ' (vous)' : '') + (lost ? ' · déconnecté' : '');
  ctx.font = '700 11px system-ui, sans-serif';
  const w = ctx.measureText(label).width + 10;
  ctx.fillStyle = 'rgba(0,0,0,.65)';
  ctx.fillRect(sx - w / 2, sy + 19, w, 16);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, sx, sy + 27.5);
  if (a.doing) {
    ctx.font = '600 11px system-ui, sans-serif';
    const w2 = ctx.measureText(a.doing).width + 10;
    ctx.fillStyle = hexA(role.color, 0.9);
    ctx.fillRect(sx - w2 / 2, sy + 37, w2, 15);
    ctx.fillStyle = '#fff';
    ctx.fillText(a.doing, sx, sy + 45);
  }
  ctx.restore();
}

/** Anneau autour de la fiche qu'un intervenant est en train de lire */
export function drawLook(ctx, camera, v, role, now) {
  const [sx, sy] = camera.worldToScreen(v.x, v.y);
  const r = Math.max(v.w, v.h) * camera.zoom * 0.62 + 4 + Math.sin(now / 200) * 2;
  ctx.save();
  ctx.strokeStyle = (ROLES[role] ?? ROLES.med).color;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ------------------------------------------------------------ sérialisation
//  Les objets du jeu se référencent (une équipe de brancardage porte « sa »
//  victime…) : une victime devient { $v: id } à l'envoi et redevient l'objet
//  du poste qui reçoit. Fonctions et éléments de page ne voyagent pas.
const SKIP = new Set(['picker', 'el', 'giveBtn', 'li']);
export function makeCodec(state) {
  const isNode = (x) => typeof Node !== 'undefined' && x instanceof Node;
  function enc(x, depth = 0) {
    if (x == null || typeof x !== 'object') return typeof x === 'function' ? undefined : x;
    if (x.id != null && state.byId.get(x.id) === x) return { $v: x.id };
    if (isNode(x) || depth > 4) return undefined;
    if (Array.isArray(x)) return x.map((y) => enc(y, depth + 1));
    if (x instanceof Set) return [...x].map((y) => enc(y, depth + 1));
    const o = {};
    for (const [k, y] of Object.entries(x)) {
      if (SKIP.has(k) || typeof y === 'function') continue;
      const e = enc(y, depth + 1);
      if (e !== undefined) o[k] = e;
    }
    return o;
  }
  function dec(x) {
    if (x == null || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(dec);
    if ('$v' in x) return state.byId.get(x.$v) ?? null;
    const o = {};
    for (const [k, y] of Object.entries(x)) o[k] = dec(y);
    return o;
  }
  return { enc, dec };
}

/** champs d'une victime qui changent en cours de partie (le reste est identique partout) */
const VFIELDS = ['status', 'assignedTriage', 'triageJudgement', 'triageHistory', 'triagedAt', 'triagedBy', 'triagedByPid',
  'seenAt', 'seenBy', 'care', 'careLog', 'position', 'garroted', 'x', 'y', 'evac', 'spFlag', 'guard', 'mpLook'];
export function victimState(v, codec) {
  const o = {};
  for (const k of VFIELDS) if (v[k] !== undefined) o[k] = codec.enc(v[k]);
  o.evo = { stage: v.evo?.stage ?? 0, frozen: !!v.evo?.frozen, frozenAt: v.evo?.frozenAt ?? null, byPMA: v.evo?.byPMA ?? null };
  return o;
}
export function applyVictimState(v, d, codec) {
  const { evo, ...rest } = d;
  for (const [k, x] of Object.entries(rest)) v[k] = codec.dec(x);
  if (evo && v.evo) Object.assign(v.evo, evo);
}

// ------------------------------------------------------------ hôte
/**
 * Écran du formateur : fait vivre un intervenant par joueur, applique leurs
 * actions (applyInput) et publie l'état : intervenants, victimes modifiées,
 * équipes (extra()).
 */
export function createHost({ state, makeTeam, onPlayers, applyInput, extra }) {
  const avatars = new Map();          // pid -> { pid, name, role, t (team), inv, doing, stats, results }
  const codec = makeCodec(state);
  const lastSent = new Map();         // id victime -> dernier état envoyé (texte)
  let ack = 0, timer = null, online = true, lastOk = performance.now(), tick = 0;

  function ensure(list) {
    const seen = new Set();
    list.forEach((p, i) => {
      seen.add(p.pid);
      let a = avatars.get(p.pid);
      if (!a) {
        const t = makeTeam();
        t.team.x += (avatars.size % 3 - 1) * 30;          // départ groupé, sans superposition
        t.team.y += Math.floor(avatars.size / 3) * 30;
        a = { pid: p.pid, t, inv: {}, doing: null, results: [], stats: { seen: new Set(), triage: 0, care: 0, given: 0, refused: 0 } };
        avatars.set(p.pid, a);
      }
      Object.assign(a, { name: p.name, role: p.role, age: p.age });
    });
    for (const a of avatars.values()) if (!seen.has(a.pid)) a.age = 999;
  }

  function victimsDelta(force) {
    const out = {};
    for (const v of state.victims) {
      const d = victimState(v, codec);
      const txt = JSON.stringify(d);
      if (force || lastSent.get(v.id) !== txt) { out[v.id] = d; lastSent.set(v.id, txt); }
    }
    return out;
  }

  function snapshot() {
    tick++;
    return {
      t: Math.round(state.clock.elapsedMs),
      running: state.clock.running,
      over: !!state.over,
      avatars: [...avatars.values()].map((a) => {
        const tg = a.t.team.target;
        return {
          pid: a.pid, name: a.name, role: a.role, lost: a.age > 6,
          x: Math.round(a.t.team.x), y: Math.round(a.t.team.y),
          tx: tg ? Math.round(tg.victim ? tg.victim.x : tg.x) : null,
          ty: tg ? Math.round(tg.victim ? tg.victim.y : tg.y) : null,
          vid: tg?.victim?.id ?? null,
          m: Math.round(a.t.team.walkedM),
          inv: a.inv, doing: a.doing, res: a.results.slice(-12), ready: !!a.ready,
        };
      }),
      victims: victimsDelta(tick % 50 === 1),        // tout, de temps en temps (sécurité)
      ...(extra?.(codec) ?? {}),
    };
  }

  async function sync() {
    try {
      const r = await post('/mp/host/sync', { snapshot: snapshot(), ack });
      lastOk = performance.now();
      online = true;
      ensure(r.players ?? []);
      for (const [seq, pid, msg] of r.inputs ?? []) {
        ack = Math.max(ack, seq);
        const a = avatars.get(pid);
        if (!a) continue;
        if (msg.t === 'goto') a.t.goTo(msg.x, msg.y, msg.vid ? state.byId.get(msg.vid) ?? null : null);
        else if (msg.t === 'stop') a.t.stop();
        else {
          let res;
          try { res = applyInput?.(a, msg); } catch (e) { console.error(e); res = { ok: false, message: 'Erreur côté formateur.' }; }
          if (msg.rid != null && res) a.results.push([msg.rid, res]);
        }
      }
      onPlayers?.([...avatars.values()]);
    } catch {
      online = performance.now() - lastOk < 3000;
      lastSent.clear();                               // renvoyer tout au retour du serveur
    }
    timer = setTimeout(sync, 100);
  }

  return {
    avatars,
    codec,
    start() { if (!timer) sync(); },
    update(dtMs) { if (state.clock.running) for (const a of avatars.values()) a.t.update(dtMs); },
    draw(ctx, camera, now) {
      for (const a of avatars.values()) {
        const tg = a.t.team.target;
        drawAvatar(ctx, camera, { ...a.t.team, tx: tg ? (tg.victim?.x ?? tg.x) : null, ty: tg ? (tg.victim?.y ?? tg.y) : null, name: a.name, role: a.role, doing: a.doing }, { reach: a.t.team.reach, now, lost: a.age > 6 });
      }
    },
    get online() { return online; },
    stop: () => post('/mp/host/stop', {}).catch(() => {}),
  };
}

// ------------------------------------------------------------ joueur
/**
 * Poste joueur : son intervenant et le terrain suivent l'état publié par
 * l'hôte ; clics et gestes deviennent des ordres envoyés à l'hôte.
 */
export function createPlayer({ pid, state, team, onState, onLost, onVictims, onResult }) {
  let others = [];
  let me = null;
  const queue = [];
  const codec = makeCodec(state);
  const shown = new Set();
  let timer = null, lastOk = performance.now(), lost = false, hostOnline = true, gen = null, vrev = 0, rid = 0;

  async function sync() {
    const inputs = queue.splice(0, queue.length);
    try {
      const r = await post('/mp/play', { pid, inputs, vrev });
      lastOk = performance.now();
      if (lost) { lost = false; onLost?.(false); }
      hostOnline = r.hostOnline !== false;
      if (gen == null) gen = r.gen;
      if (r.victims && Object.keys(r.victims).length) {
        for (const [id, d] of Object.entries(r.victims)) {
          const v = state.byId.get(id);
          if (v) applyVictimState(v, d, codec);
        }
        onVictims?.();
      }
      vrev = r.vrev ?? vrev;
      const s = r.snapshot;
      if (s) {
        state.clock.elapsedMs = s.t;
        state.mpRunning = s.running;
        others = (s.avatars ?? []).filter((a) => a.pid !== pid);
        me = (s.avatars ?? []).find((a) => a.pid === pid) ?? null;
        if (me) {
          team.team.walkedM = me.m;
          me.target = me.tx != null ? { x: me.tx, y: me.ty, victim: me.vid ? state.byId.get(me.vid) ?? null : null } : null;
          for (const [k, res] of me.res ?? []) {
            if (shown.has(k)) continue;
            shown.add(k);
            onResult?.(k, res);
          }
        }
        onState?.(s, me, others, { hostOnline, gen: r.gen !== gen, codec });
      }
    } catch (e) {
      queue.unshift(...inputs);
      if (!lost && performance.now() - lastOk > 2500) { lost = true; onLost?.(true); }
    }
    timer = setTimeout(sync, 100);
  }

  return {
    codec,
    start() { if (!timer) sync(); },
    /** envoie une action ; renvoie son n° (le résultat revient par onResult) */
    send(msg) { const id = `${pid}-${++rid}`; queue.push({ ...msg, rid: id }); return id; },
    update(dtMs) {
      if (!me) return;
      const k = Math.min(1, dtMs / 120);
      team.team.x += (me.x - team.team.x) * k;
      team.team.y += (me.y - team.team.y) * k;
      team.team.target = me.target;
    },
    draw(ctx, camera, now) {
      for (const a of others) drawAvatar(ctx, camera, a, { reach: team.team.reach, now, lost: a.lost });
    },
    get others() { return others; },
    get me() { return me; },
  };
}
