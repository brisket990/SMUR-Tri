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
  state.evac = { teams, queue, pma };

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
      arriveAt: t + travelMs(v.x, v.y, pma.x, pma.y, speed.walk),
    });
    return { ok: true, message: 'Victime orientée à pied vers le PMA.' };
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
    v.x = pma.x; v.y = pma.y;
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
        v.x = e.from.x + (pma.x - e.from.x) * k;
        v.y = e.from.y + (pma.y - e.from.y) * k;
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
        // première victime de la file encore concernée
        while (queue.length && queue[0].evac?.state !== 'queued') queue.shift();
        const v = queue.shift();
        if (!v) continue;
        const f = 1 + fatigueOf(tm);   // équipe fatiguée : tout prend plus de temps
        const toVictim = travelMs(pma.x, pma.y, v.x, v.y, speed.empty) * f;
        const back = travelMs(v.x, v.y, pma.x, pma.y, speed.stretcher) * f;
        const load = loadMs * f, unload = unloadMs * f;
        tm.job = { v, fatigue: f - 1, t0: t, at: t + toVictim, loaded: t + toVictim + load, atPMA: t + toVictim + load + back, free: t + toVictim + load + back + unload, vx: v.x, vy: v.y };
        v.evac.fatigue = f - 1;
        Object.assign(v.evac, { state: 'pickup', team: tm.id, org: tm.org, startAt: t, pickupAt: tm.job.at });
        logEvent(state, 'evac-team', { id: v.id, team: tm.id, fatigue: f - 1, trip: tm.trips + 1 });
        continue;
      }
      const v = j.v;
      if (t < j.at) {                                    // en route vers la victime
        const k = (t - j.t0) / (j.at - j.t0);
        tm.x = pma.x + (j.vx - pma.x) * k; tm.y = pma.y + (j.vy - pma.y) * k;
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
        const pos = queue.indexOf(v) + 1;
        const s = summary();
        return `En attente de brancardage (${pos}ᵉ dans la file)${s.free + s.busy === 0 && s.next ? ` · premières équipes (${s.next.org}) dans ${fmt(s.next.inMs)}` : ''}`;
      }
      case 'pickup': return `${e.team} (${e.org}) en route vers la victime${fat(e)}`;
      case 'loading': return `${e.team} : conditionnement sur brancard${fat(e)}`;
      case 'transport': return `${e.team} : transport vers le PMA${fat(e)}`;
      case 'walking': return 'Rejoint le PMA à pied';
      case 'pma': return 'Au PMA';
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
    ctx.fillText(`${pma.label} · ${s.atPMA}`, px, py + 28);
    ctx.restore();

    // victimes en attente de brancardage : sablier
    for (const v of queue) {
      if (v.evac?.state !== 'queued') continue;
      const [x, y] = camera.worldToScreen(v.x, v.y);
      ctx.save();
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⏳', x + v.w * camera.zoom * 0.5 + 6, y - v.h * camera.zoom * 0.35);
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

  return { walk, requestStretcher, cancel, update, summary, statusText, draw, pma };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
