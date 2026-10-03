// ============================================================
//  Équipe de pompiers déjà sur place (présente dès T+0)
// ============================================================
//  Elle ne trie pas (le tri est médical) : elle fait des bilans
//  secouristes, réalise les gestes de secourisme avec son propre sac
//  (garrot, pansements, 3 côtés, couverture, position d'attente),
//  et SIGNALE les urgences absolues (bulle + drapeau « ! » sur le plan).
//  Elle évite votre périmètre et les victimes déjà prises en charge.
//  Réglages : scenario.json → "pompiers": { … }  ("enabled": false pour la retirer).

import { applyCare, expectedTriage } from './evolution.js';
import { logEvent } from './state.js';
import { createOrderPicker } from './orders.js';
import { CONFIG } from './config.js';

const DEFAULTS = {
  enabled: true,
  label: 'Pompiers',
  vehicle: 'VSAV',
  teams: 1,
  speedMps: 1.2,
  bilanSec: 35,        // bilan secouriste d'une victime
  careSec: 25,         // par geste
  deadSec: 10,         // constat d'une victime sans signe de vie
  start: null,         // [x, y] relatifs au plan ; défaut : au fond de la salle
  bag: { tourniquet: 4, compressive: 6, blanket: 6, oxygen: 3 },   // pas d'hémostatique, de 3 côtés ni de stylo
  gestures: ['tourniquet', 'compressive', 'blanket', 'oxygen'],
  giveItems: ['tourniquet', 'compressive', 'blanket'],   // matériel qu'ils peuvent vous distribuer
};

export function createPompiers(state, scenario, plan, { playerTeam, onSignal, onGive } = {}) {
  const C = { ...DEFAULTS, ...(scenario.pompiers ?? {}) };
  C.bag = scenario.pompiers?.bag ? { ...scenario.pompiers.bag } : { ...DEFAULTS.bag };
  const teams = [];
  if (!C.enabled) return { update() {}, draw() {}, teams, bag: () => ({}) };

  const pxPerM = plan.w / (scenario.scale?.planWidthMeters ?? 50);
  const speed = C.speedMps * pxPerM;
  const now = () => state.clock.elapsedMs;
  const host = document.getElementById('hud-smur');
  const hostBlock = document.getElementById('hud-smur-block');
  const visited = new Set();

  // point de départ : zone la plus éloignée de l'entrée (ils sont entrés avant vous)
  function startPoint(i) {
    if (C.start) return [C.start[0] * plan.w, C.start[1] * plan.h];
    const [ex, ey] = scenario.team?.start ?? [0.5, 0.9];
    const far = [...state.victims].sort((a, b) => Math.hypot(b.x - ex * plan.w, b.y - ey * plan.h) - Math.hypot(a.x - ex * plan.w, a.y - ey * plan.h))[i * 3];
    return far ? [far.x + 30, far.y] : [plan.w * 0.3, plan.h * 0.3];
  }

  for (let i = 0; i < C.teams; i++) {
    const [x, y] = startPoint(i);
    const id = C.teams > 1 ? `${C.label} ${i + 1}` : C.label;
    const tm = { id, x, y, target: null, busyUntil: 0, busyFrom: 0, task: 'bilans', sector: '', seen: 0, cares: 0, signals: 0, bag: { ...C.bag } };
    teams.push(tm);
    tm.setSector = (z) => {
      tm.sector = z;
      tm.doneNote = '';
      if (tm.target && tm.sector && tm.target.zone !== tm.sector) tm.target = null;
      tm.picker?.set(z);
      logEvent(state, 'sp-sector', { team: id, sector: tm.sector || 'auto' });
    };
    // les pompiers donnent la moitié de certains articles (au sac indiqué)
    tm.giveTo = (inv) => {
      const got = {};
      for (const k of C.giveItems) {
        const q = Math.ceil((tm.bag[k] ?? 0) / 2);
        if (!q) continue;
        tm.bag[k] -= q;
        inv[k] = (inv[k] ?? 0) + q;
        got[k] = q;
      }
      state.inventoryEver ??= {};
      Object.keys(got).forEach((k) => (state.inventoryEver[k] = true));
      logEvent(state, 'sp-give', { team: tm.id, items: got });
      tm.refreshGive?.();
      return got;
    };
    tm.refreshGive = () => {
      if (!tm.giveBtn) return;
      tm.giveBtn.disabled = !C.giveItems.some((k) => tm.bag[k] > 0);
      if (tm.giveBtn.disabled) tm.giveBtn.textContent = '📦 Sac des pompiers vide';
    };
    if (host) {
      hostBlock.hidden = false;
      const li = document.createElement('li');
      li.className = 'smur-row sp-row';
      li.innerHTML = `<span><b>${id}</b> <span class="muted">(${C.vehicle}, sur place)</span> <span class="smur-task muted"></span></span>`;
      // ordre de zone : menu maison, la zone survolée s'éclaire sur le plan
      tm.picker = createOrderPicker({
        zones: scenario.zones ?? [], team: id,
        onPick: (z) => {
          if (state.mpRoute) return state.mpRoute({ t: 'cmd', mod: 'sp', id, z });   // multijoueur : ordre transmis au formateur
          tm.setSector(z);
        },
      });
      li.appendChild(tm.picker.el);
      // distribution : les pompiers donnent une partie de leur matériel au SMUR
      const give = document.createElement('button');
      give.type = 'button';
      give.className = 'sp-give';
      give.title = 'Les pompiers vous donnent la moitié de leurs garrots, pansements compressifs et couvertures (ils en auront moins pour leurs propres gestes)';
      give.textContent = '📦 Demander leur matériel';
      give.addEventListener('click', () => {
        if (state.mpRoute) return state.mpRoute({ t: 'cmd', mod: 'sp-give', id });
        const got = tm.giveTo(state.inventory);
        onGive?.(tm, got);
      });
      tm.giveBtn = give;
      li.appendChild(give);
      tm.el = li.querySelector('.smur-task');
      host.prepend(li);
    }
  }

  const taken = () => new Set(teams.map((t) => t.target).filter(Boolean));

  function pickTarget(tm) {
    const busy = taken();
    let best = null, bestD = Infinity;
    for (const v of state.victims) {
      if (visited.has(v) || busy.has(v)) continue;
      if (v.careLog.length || v.assignedTriage) continue;              // déjà prise en charge
      if (['pma', 'walking', 'pickup', 'loading', 'transport'].includes(v.evac?.state)) continue;
      if (tm.sector && v.zone !== tm.sector) continue;
      if (playerTeam?.inReach(v)) continue;
      const d = Math.hypot(v.x - tm.x, v.y - tm.y);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  // geste réalisé avec le sac des pompiers (et non le sac commun)
  function care(tm, v, a) {
    const item = CONFIG.items[a];
    const consumable = item?.consumable !== false;
    if (consumable && !(tm.bag[a] > 0)) return false;
    const saved = state.inventory[a];
    if (consumable) state.inventory[a] = tm.bag[a];
    const res = applyCare(state, v, a);
    if (consumable) { tm.bag[a] = state.inventory[a]; state.inventory[a] = saved; }
    if (res.ok) { v.careLog.at(-1).by = tm.id; tm.cares++; }
    return res.ok;
  }

  function work(tm, v) {
    visited.add(v);
    tm.seen++;
    let dur = C.bilanSec * 1000;
    const exp = expectedTriage(v);
    if (v.status === 'DEAD' || exp === 'BLACK') {
      dur = C.deadSec * 1000;
    } else {
      const acts = Object.entries(v.actions ?? {});
      // gestes qui stoppent l'aggravation, dans les limites du sac
      for (const [a, e] of acts) {
        if (v.evo.frozen) break;          // un seul geste efficace suffit (compressif OU hémostatique…)
        if (!C.gestures.includes(a) || e.type !== 'stop' || e.fromStage != null) continue;
        for (let i = v.care[a] ?? 0; i < (e.count ?? 1); i++) if (care(tm, v, a)) dur += C.careSec * 1000;
      }
      // gestes qui ralentissent (3 côtés sur thorax soufflant, couverture…), s'il n'y a pas mieux
      const stopped = acts.some(([a, e]) => e.type === 'stop' && (v.care[a] ?? 0) >= (e.count ?? 1));
      for (const [a, e] of acts) {
        if (!C.gestures.includes(a) || e.type !== 'slow' || v.care[a]) continue;
        if (stopped && a !== 'blanket') continue;
        if (care(tm, v, a)) dur += (a === 'blanket' ? 10 : C.careSec) * 1000;
      }
      // position d'attente
      const pos = acts.filter(([a, e]) => CONFIG.items[a]?.group === 'position' && e.type === 'slow')[0];
      if (pos && v.position !== pos[0] && care(tm, v, pos[0])) dur += 10_000;
      // signalement des urgences absolues au SMUR
      if (exp === 'RED' && !v.spFlag) {
        v.spFlag = { by: tm.id, t: now() };
        tm.signals++;
        logEvent(state, 'sp-flag', { id: v.id, team: tm.id });
        onSignal?.(v, tm);
      }
    }
    tm.busyFrom = now();
    tm.busyUntil = now() + dur;
    tm.task = `bilan ${v.id}`;
  }

  function update(dtMs) {
    if (!state.clock.running) return;
    const t = now();
    for (const tm of teams) {
      if (t < tm.busyUntil) continue;
      if (!tm.target || tm.target.careLog.length || tm.target.assignedTriage) {
        tm.target = pickTarget(tm);
        if (!tm.target && tm.sector) {               // zone terminée : l'équipe repasse en autonome
          const z = (scenario.zones ?? []).find((x) => x.id === tm.sector);
          logEvent(state, 'sector-done', { team: tm.id, sector: tm.sector });
          tm.sector = '';
          tm.picker?.set('');
          tm.doneNote = `${z?.label ?? 'zone'} terminée`;
          tm.target = pickTarget(tm);
        }
        tm.task = tm.target ? `${tm.doneNote ? tm.doneNote + ', autonome ' : ''}→ ${tm.target.id}` : (tm.sector ? 'secteur terminé' : 'plus de victime à voir');
      }
      const v = tm.target;
      if (!v) continue;
      const d = Math.hypot(v.x - tm.x, v.y - tm.y);
      const step = speed * (dtMs / 1000);
      if (d <= Math.max(step, v.w)) { tm.target = null; work(tm, v); }
      else { tm.x += ((v.x - tm.x) / d) * step; tm.y += ((v.y - tm.y) / d) * step; }
    }
    for (const tm of teams) {
      if (!tm.el) continue;
      const left = C.gestures.filter((a) => a !== 'blanket').reduce((n, a) => n + (tm.bag[a] ?? 0), 0);
      tm.el.textContent = `· ${tm.task} · ${tm.seen} vue${tm.seen > 1 ? 's' : ''}, ${tm.signals} UA signalée${tm.signals > 1 ? 's' : ''}${left ? '' : ' · sac vide'}`;
    }
  }

  function draw(ctx, camera) {
    // drapeaux « ! » sur les UA signalées et pas encore triées par le SMUR
    for (const v of state.victims) {
      if (!v.spFlag || v.assignedTriage || v.status === 'DEAD' || v.evac?.state === 'pma') continue;
      const [x, y] = camera.worldToScreen(v.x + v.w * 0.42, v.y - v.h * 0.5);
      ctx.save();
      ctx.fillStyle = '#d32f2f'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x + 10, y + 7); ctx.lineTo(x - 10, y + 7); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '900 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('!', x, y + 1.5);
      ctx.restore();
    }
    for (const tm of teams) {
      const [x, y] = camera.worldToScreen(tm.x, tm.y);
      ctx.save();
      ctx.fillStyle = '#c62828'; ctx.strokeStyle = '#ffeb3b'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '800 8px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(C.vehicle.slice(0, 4), x, y + 0.5);
      if (now() < tm.busyUntil) {
        ctx.strokeStyle = '#ffeb3b'; ctx.lineWidth = 3;
        const k = (now() - tm.busyFrom) / (tm.busyUntil - tm.busyFrom);
        ctx.beginPath(); ctx.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, k))); ctx.stroke();
      }
      ctx.restore();
    }
  }

  return { update, draw, teams };
}
