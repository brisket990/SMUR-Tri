// ============================================================
//  Équipes SMUR de renfort (arrivent avec les VL LOG)
// ============================================================
//  Autonomes : elles se dirigent vers la victime non triée la plus proche
//  (dans leur secteur si vous en assignez un), l'examinent, la trient,
//  réalisent le geste vital indiqué en puisant dans le sac commun, puis
//  demandent l'évacuation (brancardage des UA, à pied pour les valides).
//  Elles évitent votre propre périmètre pour ne pas doublonner.
//  Réglages : scenario.json → logistics[].smurTeams, smurTeams { … }.

import { assignTriage, markSeen, logEvent } from './state.js';
import { applyCare, judgeTriage, expectedTriage } from './evolution.js';
import { CONFIG } from './config.js';
import { createOrderPicker } from './orders.js';
import { canWalk } from './evacuation.js';

export function createSmurTeams(state, scenario, plan, { playerTeam, evac } = {}) {
  const C = { speedMps: 1.3, examineSec: 40, careSec: 30, doCare: true, requestEvac: true, walkEvac: true, ...(scenario.smurTeams ?? {}) };
  const pxPerM = plan.w / (scenario.scale?.planWidthMeters ?? 50);
  const entry = scenario.team?.start ?? [0.5, 0.9];
  const speed = C.speedMps * pxPerM;
  const teams = [];
  let n = 1;           // SMUR 1 = le joueur
  const host = document.getElementById('hud-smur');
  const hostBlock = document.getElementById('hud-smur-block');
  const now = () => state.clock.elapsedMs;

  function spawn(fromLabel) {
    const tm = {
      id: `SMUR ${++n}`, from: fromLabel, x: entry[0] * plan.w, y: entry[1] * plan.h,
      target: null, busyUntil: 0, task: 'arrivée', sector: '', triaged: 0, cares: 0, evacs: 0,
    };
    teams.push(tm);
    logEvent(state, 'smur-arrive', { team: tm.id, with: fromLabel });
    // ligne dans le tableau de bord, avec choix du secteur
    if (host) {
      hostBlock.hidden = false;
      const li = document.createElement('li');
      li.className = 'smur-row';
      li.innerHTML = `<span><b>${tm.id}</b> <span class="smur-task muted"></span></span>`;
      // ordre de zone : menu maison, la zone survolée s'éclaire sur le plan
      tm.picker = createOrderPicker({
        zones: scenario.zones ?? [], team: tm.id,
        onPick: (z) => {
          tm.sector = z;
          tm.doneNote = '';
          if (tm.target && tm.sector && tm.target.zone !== tm.sector) tm.target = null;
          logEvent(state, 'smur-sector', { team: tm.id, sector: tm.sector || 'auto' });
        },
      });
      li.appendChild(tm.picker.el);
      tm.el = li.querySelector('.smur-task');
      host.appendChild(li);
    }
  }

  const taken = () => new Set(teams.map((t) => t.target).filter(Boolean));

  function pickTarget(tm) {
    const busy = taken();
    let best = null, bestD = Infinity;
    for (const v of state.victims) {
      if (v.assignedTriage || busy.has(v)) continue;
      if (['pma', 'walking', 'pickup', 'loading', 'transport'].includes(v.evac?.state)) continue;
      if (tm.sector && v.zone !== tm.sector) continue;
      if (playerTeam?.inReach(v)) continue;          // le joueur s'en occupe
      const d = Math.hypot(v.x - tm.x, v.y - tm.y);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  function work(tm, v) {
    const t = now();
    if (v.seenAt == null) markSeen(state, v.id);
    v.seenBy ??= tm.id;
    const cat = expectedTriage(v);
    assignTriage(state, v.id, cat, judgeTriage, expectedTriage, tm.id);
    tm.triaged++;
    let dur = C.examineSec * 1000;
    // geste vital indiqué, si le sac commun le permet
    if (C.doCare && cat === 'RED' && !v.evo.frozen) {
      const key = Object.entries(v.actions ?? {}).find(([a, e]) => e.type === 'stop' && (state.inventory[a] ?? 0) > 0 && !(v.care[a] >= (e.count ?? 1)));
      if (key) {
        const need = key[1].count ?? 1;
        for (let i = v.care[key[0]] ?? 0; i < need && (state.inventory[key[0]] ?? 0) > 0; i++) {
          const res = applyCare(state, v, key[0]);
          if (res.ok) { v.careLog.at(-1).by = tm.id; tm.cares++; dur += C.careSec * 1000; }
        }
      }
    }
    // position d'attente adaptée (sauf UD)
    if (C.doCare && cat !== 'BLACK' && v.status !== 'DEAD') {
      const pos = Object.entries(v.actions ?? {}).find(([a, e]) => CONFIG.items[a]?.group === 'position' && e.type === 'slow');
      if (pos && v.position !== pos[0] && applyCare(state, v, pos[0]).ok) { v.careLog.at(-1).by = tm.id; tm.cares++; }
    }
    // demande d'évacuation : brancardage pour les UA, à pied pour ceux qui peuvent marcher
    if (evac && v.status !== 'DEAD' && (v.evac?.state ?? 'none') === 'none') {
      if (C.requestEvac && cat === 'RED') { if (evac.requestStretcher(v, tm.id).ok) tm.evacs++; }
      else if (C.walkEvac && (cat === 'YELLOW' || cat === 'GREEN') && canWalk(v).ok) { if (evac.walk(v, tm.id).ok) tm.evacs++; }
    }
    tm.busyUntil = t + dur;
    tm.task = `examine ${v.id}`;
  }

  function update(dtMs) {
    if (!state.clock.running) return;
    // arrivées avec les VL LOG
    for (const l of state.logistics) {
      if (l.arrived && !l.smurSpawned) {
        l.smurSpawned = true;
        for (let i = 0; i < (l.smurTeams ?? 0); i++) spawn(l.label);
      }
    }
    const t = now();
    for (const tm of teams) {
      if (t < tm.busyUntil) continue;
      if (!tm.target || tm.target.assignedTriage || tm.target.evac?.state === 'pma') {
        tm.target = pickTarget(tm);
        if (!tm.target && tm.sector) {               // zone terminée : l'équipe repasse en autonome
          const z = (scenario.zones ?? []).find((x) => x.id === tm.sector);
          logEvent(state, 'sector-done', { team: tm.id, sector: tm.sector });
          tm.sector = '';
          tm.picker?.set('');
          tm.doneNote = `${z?.label ?? 'zone'} terminée`;
          tm.target = pickTarget(tm);
        }
        tm.task = tm.target ? `${tm.doneNote ? tm.doneNote + ', autonome ' : ''}→ ${tm.target.id}` : (tm.sector ? 'secteur terminé' : 'plus de victime à trier');
      }
      const v = tm.target;
      if (!v) continue;
      const d = Math.hypot(v.x - tm.x, v.y - tm.y);
      const step = speed * (dtMs / 1000);
      if (d <= Math.max(step, v.w)) { tm.target = null; work(tm, v); }
      else { tm.x += ((v.x - tm.x) / d) * step; tm.y += ((v.y - tm.y) / d) * step; }
    }
    for (const tm of teams) if (tm.el) tm.el.textContent = `· ${tm.task} · ${tm.triaged} triée${tm.triaged > 1 ? 's' : ''}${tm.evacs ? `, ${tm.evacs} évac.` : ''}`;
  }

  function draw(ctx, camera) {
    for (const tm of teams) {
      const [x, y] = camera.worldToScreen(tm.x, tm.y);
      ctx.save();
      ctx.fillStyle = '#00695c'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '800 8px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(tm.id.replace('SMUR ', 'S'), x, y + 0.5);
      if (now() < tm.busyUntil) {        // anneau de progression pendant l'examen
        ctx.strokeStyle = '#80cbc4'; ctx.lineWidth = 3;
        const k = 1 - (tm.busyUntil - now()) / (C.examineSec * 1000);
        ctx.beginPath(); ctx.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, k))); ctx.stroke();
      }
      ctx.restore();
    }
  }

  return { update, draw, teams };
}
