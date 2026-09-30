// ============================================================
//  Évacuation des victimes vers le PMA
// ============================================================
//  - À pied : seulement si la victime peut marcher ; elle rejoint seule le PMA.
//  - Brancardage : une équipe (pompiers, Croix-Rouge, Sécurité civile…) part du
//    PMA, rejoint la victime, la conditionne, la ramène, puis se libère.
//    Les équipes arrivent progressivement (scenario.json → evacuation.teams).
//  - Les demandes de brancardage forment une file d'attente, servie dans
//    l'ordre des demandes : c'est au joueur de choisir qui passe en premier.
//  - Arrivée au PMA = prise en charge médicale : l'aggravation s'arrête.

import { logEvent } from './state.js';
import { expectedTriage } from './evolution.js';

const LOWER_BODY = /cuisse|jambe|genou|pied|mollet|cheville|bassin|fémor|abdom|racine/i;

/** La victime peut-elle rejoindre le PMA à pied ? { ok, reason } */
export function canWalk(v) {
  if (v.status === 'DEAD') return { ok: false, reason: 'Victime décédée.' };
  if (v.status === 'CRITICAL') return { ok: false, reason: "État critique : elle ne tient pas debout." };
  const exp = expectedTriage(v);
  if (exp === 'RED' || exp === 'BLACK') return { ok: false, reason: 'Détresse vitale : brancardage nécessaire.' };
  if (v.garroted) return { ok: false, reason: 'Victime garrottée : brancardage nécessaire.' };
  const c = v.clinical;
  if (!c) return { ok: false, reason: 'Impossible à évaluer.' };
  const gcs = +(/GCS\s*(\d+)/i.exec(c.neuro ?? '')?.[1] ?? 15);
  if (gcs < 14) return { ok: false, reason: 'Troubles de conscience : ne peut pas marcher seule.' };
  if (LOWER_BODY.test(`${c.lesion} ${c.pres}`)) return { ok: false, reason: 'Lésion du membre inférieur, du bassin ou de l\'abdomen : ne peut pas marcher.' };
  return { ok: true };
}

/** Pouvait-elle marcher d'après la fiche initiale ? (pour le bilan) */
export function walkableAtStart(v) {
  if (!['GREEN', 'YELLOW'].includes(v.truth.triage) || v.profile?.garroted) return false;
  const c = v.clinical;
  if (!c) return false;
  const gcs = +(/GCS\s*(\d+)/i.exec(c.neuro ?? '')?.[1] ?? 15);
  return gcs >= 14 && !LOWER_BODY.test(`${c.lesion} ${c.pres}`);
}

export function createEvacuation(state, scenario, plan, { onSupply } = {}) {
  const E = scenario.evacuation ?? {};
  const pxPerM = plan.w / (scenario.scale?.planWidthMeters ?? 50);
  const pma = { x: (E.pma?.[0] ?? 0.5) * plan.w, y: (E.pma?.[1] ?? 0.95) * plan.h, label: E.pmaLabel ?? 'PMA' };
  // point de regroupement des impliqués (victimes à pied) : sinon, le PMA
  const cri = E.walkTo
    ? { x: E.walkTo[0] * plan.w, y: E.walkTo[1] * plan.h, label: E.walkLabel ?? 'Regroupement des impliqués', separate: true }
    : pma;
  const destOf = (v) => (v.evac?.mode === 'walk' ? cri : pma);
  const speed = {
    walk: (E.walkSpeedMps ?? 0.8) * pxPerM,
    stretcher: (E.stretcherSpeedMps ?? 0.9) * pxPerM,
    empty: (E.emptySpeedMps ?? 1.4) * pxPerM,
  };
  const loadMs = (E.loadSec ?? 70) * 1000;
  const unloadMs = (E.unloadSec ?? 30) * 1000;
  // Fatigue : chaque brancardage effectué allonge les suivants (plafonné)
  const fatigueOf = (tm) => Math.min(E.fatigueMax ?? 0.6, (E.fatiguePerTrip ?? 0.12) * tm.trips);

  // équipes : toutes connues d'avance, disponibles à leur heure d'arrivée
  const counters = {};
  const teams = (E.teams ?? []).flatMap((g) => Array.from({ length: g.count }, () => {
    counters[g.prefix] = (counters[g.prefix] ?? 0) + 1;
    return { id: `${g.prefix} ${counters[g.prefix]}`, org: g.org, color: g.color ?? '#e53935', arriveAt: g.atMin * 60000, job: null, x: pma.x, y: pma.y, trips: 0, items: g.items ?? null };
  }));
  const queue = [];     // victimes en attente de brancardage (ordre des demandes)
  state.evac = { teams, queue, pma, cri };

  const now = () => state.clock.elapsedMs;
  const travelMs = (x1, y1, x2, y2, v) => (Math.hypot(x2 - x1, y2 - y1) / v) * 1000;

  function ensure(v) {
    v.evac ??= { state: 'none' };
    return v.evac;
  }

  function precheck(v) {
    const e = ensure(v);
    if (!v.assignedTriage) return 'Triez la victime avant de l\'évacuer.';
    if (e.state !== 'none') return 'Évacuation déjà engagée.';
    return null;
  }

  /** Envoi à pied vers le PMA */
  function walk(v, by = null) {
    const err = precheck(v);
    if (err) return { ok: false, message: err };
    const cw = canWalk(v);
    logEvent(state, 'evac', { id: v.id, mode: 'walk', ok: cw.ok, by });
    if (!cw.ok) return { ok: false, message: `Ne peut pas marcher : ${cw.reason}` };
    const t = now();
    Object.assign(v.evac, {
      state: 'walking', mode: 'walk', by, requestedAt: t, startAt: t, from: { x: v.x, y: v.y },
      arriveAt: t + travelMs(v.x, v.y, cri.x, cri.y, speed.walk),
    });
    return { ok: true, message: `Victime orientée à pied vers ${cri.separate ? 'le ' + cri.label.toLowerCase() : 'le PMA'}.` };
  }

  /** Demande de brancardage (mise en file d'attente) */
  function requestStretcher(v, by = null) {
    const err = precheck(v);
    if (err) return { ok: false, message: err };
    Object.assign(v.evac, { state: 'queued', mode: 'stretcher', by, requestedAt: now() });
    queue.push(v);
    logEvent(state, 'evac', { id: v.id, mode: 'stretcher', by });
    return { ok: true, message: `Brancardage demandé (${queue.length}ᵉ en attente).` };
  }

  // ---------- priorités ----------
  //  Une priorité passe devant la file. On ne peut avoir en attente qu'autant de priorités
  //  que d'équipes sur place : au-delà, la plus ancienne (pas encore prise en charge) redevient normale.
  //  S'il n'y a pas d'équipe libre, l'équipe la plus proche encore EN ROUTE vers une victime
  //  non prioritaire lâche sa mission (cette victime retourne dans la file) et part vers la priorité.
  const byOrder = (a, b) => (a.evac.priority ? 0 : 1) - (b.evac.priority ? 0 : 1)
    || (a.evac.priority ?? a.evac.requestedAt) - (b.evac.priority ?? b.evac.requestedAt);
  function nextInQueue() {
    const waiting = queue.filter((v) => v.evac?.state === 'queued').sort(byOrder);
    const v = waiting[0];
    if (v) queue.splice(queue.indexOf(v), 1);
    return v ?? null;
  }
  const activeTeams = () => teams.filter((tm) => now() >= tm.arriveAt);

  function startJob(tm, v, fx = pma.x, fy = pma.y) {
    const t = now();
    const f = 1 + fatigueOf(tm);   // équipe fatiguée : tout prend plus de temps
    const toVictim = travelMs(fx, fy, v.x, v.y, speed.empty) * f;
    const back = travelMs(v.x, v.y, pma.x, pma.y, speed.stretcher) * f;
    const load = loadMs * f, unload = unloadMs * f;
    tm.job = { v, fatigue: f - 1, t0: t, fx, fy, at: t + toVictim, loaded: t + toVictim + load, atPMA: t + toVictim + load + back, free: t + toVictim + load + back + unload, vx: v.x, vy: v.y };
    v.evac.fatigue = f - 1;
    Object.assign(v.evac, { state: 'pickup', team: tm.id, org: tm.org, startAt: t, pickupAt: tm.job.at });
    logEvent(state, 'evac-team', { id: v.id, team: tm.id, fatigue: f - 1, trip: tm.trips + 1, priority: !!v.evac.priority });
  }

  function prioritize(v) {
    const e = ensure(v);
    if (e.state === 'none') {
      const r = requestStretcher(v);
      if (!r.ok) return r;
    }
    if (e.state !== 'queued') return { ok: false, message: e.priority ? 'Déjà prioritaire et prise en charge.' : 'Brancardage déjà en cours.' };
    if (e.priority) return { ok: false, message: 'Déjà prioritaire.' };
    e.priority = now();
    logEvent(state, 'evac-priority', { id: v.id });
    let msg = 'Brancardage PRIORITAIRE demandé.';
    // limite : une priorité « pas encore commencée » par équipe sur place
    //  (pas commencée = encore dans la file, ou équipe en route sans avoir chargé la victime)
    const t = now();
    const teamOf = (x) => teams.find((tm) => tm.job?.v === x);
    const notStarted = () => state.victims.filter((x) => x.evac?.priority && (x.evac.state === 'queued'
      || (x.evac.state === 'pickup' && t < (teamOf(x)?.job.at ?? 0)))).sort((a, b) => a.evac.priority - b.evac.priority);
    const limit = Math.max(1, activeTeams().length);
    const divert = (tm, why) => {                    // l'équipe lâche sa mission et part vers la nouvelle priorité
      const dropped = tm.job.v;
      Object.assign(dropped.evac, { state: 'queued', team: null, org: null, pickupAt: null });
      queue.push(dropped);
      logEvent(state, 'evac-diverted', { id: dropped.id, team: tm.id, to: v.id });
      const fx = tm.x, fy = tm.y;
      tm.job = null;
      queue.splice(queue.indexOf(v), 1);
      startJob(tm, v, fx, fy);
      msg += ` ${tm.id} abandonne ${dropped.id}${why} et part vers ${v.id}.`;
    };
    let done = false;
    let list = notStarted();
    while (list.length > limit) {
      const lost = list.find((x) => x !== v);
      lost.evac.priority = null;
      logEvent(state, 'evac-priority-lost', { id: lost.id, by: v.id });
      msg += ` ${lost.id} perd sa priorité (une seule priorité par équipe).`;
      const tm = lost.evac.state === 'pickup' ? teamOf(lost) : null;
      if (tm && !done && v.evac.state === 'queued') { divert(tm, ' (remise dans la file)'); done = true; }
      list = notStarted();
    }
    // pas d'équipe libre : on détourne l'équipe la plus proche encore en route vers une victime non prioritaire
    if (!done && v.evac.state === 'queued' && !activeTeams().some((tm) => !tm.job)) {
      const cand = activeTeams().filter((tm) => tm.job && t < tm.job.at && !tm.job.v.evac.priority)
        .sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y))[0];
      if (cand) divert(cand, ' (remise dans la file)');
      else if (activeTeams().length) msg += ' Aucune équipe ne peut être détournée : première équipe libérée.';
    }
    return { ok: true, message: msg };
  }

  /** MPAP : envoi immédiat au PMA (pas de brancardage simulé) */
  function sendToPMA(v) {
    const e = ensure(v);
    if (e.state === 'pma') return { ok: false, message: 'Déjà au PMA.' };
    const i = queue.indexOf(v);
    if (i >= 0) queue.splice(i, 1);
    Object.assign(e, { state: 'pma', mode: 'mpap', requestedAt: now() });
    logEvent(state, 'evac', { id: v.id, mode: 'pma' });
    arrive(v, now());
    return { ok: true, message: 'Victime envoyée au PMA.' };
  }

  function cancel(v) {
    const i = queue.indexOf(v);
    if (i < 0) return { ok: false, message: 'Aucune demande en attente.' };
    queue.splice(i, 1);
    v.evac = { state: 'none' };
    logEvent(state, 'evac-cancel', { id: v.id });
    return { ok: true, message: 'Demande de brancardage annulée.' };
  }

  function arrive(v, t) {
    v.evac.state = 'pma';
    v.evac.arrivedAt = t;
    const d = destOf(v);
    v.x = d.x; v.y = d.y;
    // prise en charge médicale au PMA : l'aggravation s'arrête
    if (v.status !== 'DEAD' && !v.evo.frozen) { v.evo.frozen = true; v.evo.frozenAt = t; v.evo.byPMA = true; }
    logEvent(state, 'pma', { id: v.id, mode: v.evac.mode, team: v.evac.team ?? null });
  }

  function update() {
    const t = now();
    if (!state.clock.running) return;

    // victimes à pied
    for (const v of state.victims) {
      const e = v.evac;
      if (e?.state !== 'walking') continue;
      if (t >= e.arriveAt) arrive(v, e.arriveAt);
      else {
        const k = (t - e.startAt) / (e.arriveAt - e.startAt);
        v.x = e.from.x + (cri.x - e.from.x) * k;
        v.y = e.from.y + (cri.y - e.from.y) * k;
      }
    }

    // équipes de brancardage
    for (const tm of teams) {
      if (t < tm.arriveAt) continue;
      if (tm.items && !tm.supplied) {        // matériel apporté par l'équipe (ex. oxygène des pompiers) → sac commun
        tm.supplied = true;
        state.inventoryEver ??= {};
        for (const [k, q] of Object.entries(tm.items)) {
          state.inventory[k] = (state.inventory[k] ?? 0) + q;
          state.inventoryEver[k] = true;
        }
        logEvent(state, 'team-supply', { team: tm.id, items: tm.items });
        onSupply?.(tm);
      }
      const j = tm.job;
      if (!j) {
        // priorités d'abord, puis ordre des demandes
        const v = nextInQueue();
        if (!v) continue;
        startJob(tm, v);
        continue;
      }
      const v = j.v;
      if (t < j.at) {                                    // en route vers la victime
        const k = (t - j.t0) / (j.at - j.t0);
        tm.x = j.fx + (j.vx - j.fx) * k; tm.y = j.fy + (j.vy - j.fy) * k;
      } else if (t < j.loaded) {                         // conditionnement
        tm.x = j.vx; tm.y = j.vy;
        v.evac.state = 'loading';
      } else if (t < j.atPMA) {                          // transport
        const k = (t - j.loaded) / (j.atPMA - j.loaded);
        tm.x = v.x = j.vx + (pma.x - j.vx) * k;
        tm.y = v.y = j.vy + (pma.y - j.vy) * k;
        v.evac.state = 'transport';
      } else if (t < j.free) {                           // dépose au PMA
        if (v.evac.state !== 'pma') arrive(v, j.atPMA);
        tm.x = pma.x; tm.y = pma.y;
      } else {
        tm.job = null; tm.trips++;
      }
    }
  }

  // ---------- résumé pour le tableau de bord ----------
  function summary() {
    const t = now();
    const active = teams.filter((tm) => t >= tm.arriveAt);
    const next = teams.filter((tm) => t < tm.arriveAt).sort((a, b) => a.arriveAt - b.arriveAt)[0];
    const at = state.victims.filter((v) => v.evac?.state === 'pma');
    return {
      free: active.filter((tm) => !tm.job).length,
      busy: active.filter((tm) => tm.job).length,
      next: next ? { org: next.org, count: teams.filter((x) => x.arriveAt === next.arriveAt).length, inMs: next.arriveAt - t } : null,
      queued: queue.filter((v) => v.evac?.state === 'queued').length,
      moving: state.victims.filter((v) => ['walking', 'pickup', 'loading', 'transport'].includes(v.evac?.state)).length,
      atPMA: at.length,
      atPMARed: at.filter((v) => v.truth.triage === 'RED').length,
      trips: active.reduce((n, tm) => n + tm.trips, 0),
      fatigue: active.length ? active.reduce((n, tm) => n + fatigueOf(tm), 0) / active.length : 0,
    };
  }

  /** Texte d'état pour la fiche */
  function statusText(v) {
    const e = v.evac;
    const fat = (ev) => (ev.fatigue > 0.001 ? ` · équipe fatiguée (+${Math.round(ev.fatigue * 100)} % de temps)` : '');
    const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    switch (e?.state) {
      case 'queued': {
        const pos = queue.filter((x) => x.evac?.state === 'queued').sort(byOrder).indexOf(v) + 1;
        if (e.priority) return `⚡ PRIORITAIRE — ${pos === 1 ? 'prochaine équipe libre' : `${pos}ᵉ dans la file`}`;
        const s = summary();
        return `En attente de brancardage (${pos}ᵉ dans la file)${s.free + s.busy === 0 && s.next ? ` · premières équipes (${s.next.org}) dans ${fmt(s.next.inMs)}` : ''}`;
      }
      case 'pickup': return `${e.priority ? '⚡ ' : ''}${e.team} (${e.org}) en route vers la victime${fat(e)}`;
      case 'loading': return `${e.team} : conditionnement sur brancard${fat(e)}`;
      case 'transport': return `${e.team} : transport vers le PMA${fat(e)}`;
      case 'walking': return cri.separate ? `Rejoint à pied : ${cri.label}` : 'Rejoint le PMA à pied';
      case 'pma': return e.mode === 'walk' && cri.separate ? `Arrivée : ${cri.label}` : 'Au PMA';
      default: return 'Sur place';
    }
  }

  // ---------- dessin (repère écran) ----------
  function draw(ctx, camera) {
    const t = now();
    // PMA
    const [px, py] = camera.worldToScreen(pma.x, pma.y);
    const s = summary();
    ctx.save();
    ctx.fillStyle = '#1b5e20';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - 22, py + 12); ctx.lineTo(px, py - 16); ctx.lineTo(px + 22, py + 12); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(px - 2, py - 6, 4, 14); ctx.fillRect(px - 7, py - 1, 14, 4);
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c8f7c5';
    ctx.fillText(`${pma.label} · ${cri.separate ? state.victims.filter((v) => v.evac?.state === 'pma' && v.evac.mode !== 'walk').length : s.atPMA}`, px, py + 28);
    ctx.restore();
    // point de regroupement des impliqués (s'il est distinct du PMA)
    if (cri.separate) {
      const [cx, cy] = camera.worldToScreen(cri.x, cri.y);
      const n = state.victims.filter((v) => v.evac?.state === 'pma' && v.evac.mode === 'walk').length;
      ctx.save();
      ctx.fillStyle = '#1565c0'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';                        // pictogramme : deux personnes
      for (const dx of [-5, 5]) { ctx.beginPath(); ctx.arc(cx + dx, cy - 5, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(cx + dx - 3.5, cy - 1, 7, 9); }
      ctx.font = '800 12px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#bbdefb';
      ctx.fillText(`${cri.label} · ${n}`, cx, cy + 30);
      ctx.restore();
    }

    // victimes en attente de brancardage : sablier
    for (const v of queue) {
      if (v.evac?.state !== 'queued') continue;
      const [x, y] = camera.worldToScreen(v.x, v.y);
      ctx.save();
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(v.evac.priority ? '⚡⏳' : '⏳', x + v.w * camera.zoom * 0.5 + 6, y - v.h * camera.zoom * 0.35);
      ctx.restore();
    }

    // équipes en mission
    for (const tm of teams) {
      if (!tm.job || t < tm.arriveAt) continue;
      const [x, y] = camera.worldToScreen(tm.x, tm.y);
      ctx.save();
      ctx.fillStyle = tm.color;
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      const label = tm.trips ? `${tm.id} · ${tm.trips}✚` : tm.id;
      ctx.font = '800 10px system-ui, sans-serif';
      const w = ctx.measureText(label).width + 12;
      roundRect(ctx, x - w / 2, y + 14, w, 16, 4);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = tm.color === '#f5f5f5' ? '#c62828' : '#111';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + 22.5);
      // jauge de fatigue sous l'étiquette
      const fg = tm.job.fatigue / (E.fatigueMax ?? 0.6);
      if (fg > 0) {
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - w / 2, y + 32, w, 4);
        ctx.fillStyle = fg > 0.66 ? '#ff5252' : fg > 0.33 ? '#ffb300' : '#9ccc65';
        ctx.fillRect(x - w / 2, y + 32, w * Math.min(1, fg), 4);
      }
      ctx.restore();
    }
  }

  return { walk, requestStretcher, prioritize, sendToPMA, cancel, update, summary, statusText, draw, pma, cri };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
