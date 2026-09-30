// ============================================================
//  Correction détaillée, victime par victime
// ============================================================
//  Pour chaque fiche : ce que le joueur a fait, ce qu'il fallait faire,
//  ce qui a été oublié ou mal fait, et ce qu'est devenue la victime.

import { CONFIG, TRIAGE } from './config.js';
import { formatTime } from './hud.js';
import { expectedTriage } from './evolution.js';
import { walkableAtStart } from './evacuation.js';

const T = (k) => (k ? TRIAGE[k].short : '—');
const at = (ms) => `T+${formatTime(ms)}`;
const label = (a) => CONFIG.items[a]?.label ?? a;
const JUDGE = { exact: 'tri juste', accepted: 'tri défendable', over: 'sur-tri', under: 'sous-tri' };
const KIND = {
  stop: 'efficace', slow: 'utile', helpful: 'pertinent', excessive: 'excessif',
  useless: 'non indiqué', impossible: 'impossible', dead: 'sur victime décédée', worsen: 'délétère',
};

// Gravité (tri de la liste : les fiches à corriger d'abord)
const W = { position: 1, badPosition: 2, deadAvoidable: 6, under: 5, missedKey: 4, unseenUrgent: 4, retriage: 3, noEvacUA: 3, late: 2, over: 2, badCare: 2, untriaged: 2, evacUD: 2, missedHelp: 1, evacWalker: 1, walkRefused: 1 };

export function analyzeVictim(v, state) {
  const now = state.clock.elapsedMs;
  // étapes atteintes, datées à leur heure prévue (et non à l'heure où la boucle les a traitées)
  const evolves = v.evo.stages.slice(0, v.evo.stage).map((st) => ({ t: st.atMs, triage: st.triage, status: st.status }));
  const impossible = state.log.filter((e) => e.type === 'care' && e.id === v.id && e.kind === 'impossible');
  const firstWorse = evolves[0]?.t ?? null;
  const deathAt = evolves.find((e) => e.status === 'DEAD')?.t ?? null;
  const initialUD = v.truth.triage === 'BLACK';
  const isPos = (a) => CONFIG.items[a]?.group === 'position';
  const posActs = Object.entries(v.actions ?? {}).filter(([a]) => isPos(a));
  const acts = Object.entries(v.actions ?? {}).filter(([a]) => !isPos(a));
  const bestPos = posActs.filter(([, e]) => e.type === 'slow').sort((x, y) => (y[1].factor ?? 1) - (x[1].factor ?? 1))[0];
  const okPos = posActs.filter(([, e]) => e.type === 'helpful').map(([a]) => a);
  // gestes qui stoppent ; ceux « à partir d'un stade » ne comptent que si ce stade a été atteint
  const conditional = acts.filter(([, e]) => e.type === 'stop' && e.fromStage != null);
  const stops = acts.filter(([, e]) => e.type === 'stop' && (e.fromStage == null || v.evo.stage >= e.fromStage));
  // gestes qui ralentissent : cités seulement s'il n'existe aucun geste qui stoppe
  const slows = stops.length ? [] : acts.filter(([a, e]) => e.type === 'slow' && (e.factor ?? 1) >= 1.3 && CONFIG.items[a]);

  const did = [];
  const should = [];
  const issues = []; // { text, weight, kind: 'missed' | 'wrong' }
  const add = (kind, weight, text) => issues.push({ kind, weight, text });

  // ---------- ce qui a été fait ----------
  if (v.seenAt != null) did.push({ t: v.seenAt, text: 'Victime examinée' });
  for (const h of v.triageHistory) {
    did.push(h.by
      ? { t: h.t, text: `Triée ${T(h.category)} par ${h.by}`, note: 'renfort', cls: '' }
      : { t: h.t, text: `Triée ${T(h.category)}`, note: JUDGE[h.judgement], cls: `j-${h.judgement}` });
  }
  for (const c of v.careLog) {
    if (c.by) { did.push({ t: c.t, text: `${label(c.action)} par ${c.by}`, note: 'renfort', cls: '' }); continue; }
    const msg = ['useless', 'excessive', 'worsen'].includes(c.kind) ? v.actions[c.action]?.msg : '';
    did.push({ t: c.t, text: isPos(c.action) ? `Position : ${label(c.action).toLowerCase()}` : label(c.action), note: KIND[c.kind] + (msg ? ` — ${msg}` : ''), cls: `k-${c.kind}` });
  }
  for (const l of state.log) {
    if (l.type === 'sp-flag' && l.id === v.id) did.push({ t: l.t, text: `Signalée urgence absolue par les ${l.team.toLowerCase()}`, note: 'renfort', cls: '' });
  }
  for (const c of impossible) {
    did.push({ t: c.t, text: `${label(c.action)} (tentative)`, note: 'impossible — ' + (v.actions[c.action]?.msg ?? ''), cls: 'k-impossible' });
  }
  did.sort((a, b) => a.t - b.t);

  // ---------- ce qu'il fallait faire ----------
  const acc = v.truth.accept?.length ? ` (${v.truth.accept.map(T).join(', ')} défendable)` : '';
  should.push(`Tri : <b>${T(v.truth.triage)}</b>${acc}`);
  // lastEvo = première étape où la victime a pris sa catégorie actuelle
  const finalTri = evolves.at(-1)?.triage;
  const lastEvo = evolves.find((e) => e.triage === finalTri) ?? null;
  if (lastEvo && lastEvo.triage !== v.truth.triage) {
    should.push(`Puis re-tri <b>${T(lastEvo.triage)}</b> après l'aggravation (${at(lastEvo.t)})`);
  }
  if (initialUD) {
    should.push('Aucun geste : ne pas engager de ressources sur une urgence dépassée');
  } else {
    for (const [a, e] of stops) {
      const n = e.count ?? 1;
      should.push(`${label(a)}${n > 1 ? ` ×${n}` : ''} : stoppe l'aggravation${v.evo.stages.length ? `, à faire avant ${at(v.evo.stages[0].at * 60000)}` : ''}`);
    }
    for (const [a, e] of slows) should.push(`${label(a)} : ${e.msg ?? "ralentit l'aggravation"}`);
    for (const [a, e] of conditional) {
      if (v.evo.stage >= e.fromStage) continue;
      const st = v.evo.stages[e.fromStage - 1];
      should.push(`${label(a)} : seulement si l'état devient compressif${st ? ` (vers ${at(st.at * 60000)})` : ''}`);
    }
    if (bestPos) {
      should.push(`Position : <b>${label(bestPos[0]).toLowerCase()}</b> — ${bestPos[1].msg}${okPos.length ? ` (acceptable : ${okPos.map((a) => label(a).toLowerCase()).join(', ')})` : ''}`);
    } else if (okPos.length && v.evo.stages.length) {
      should.push(`Position : ${okPos.map((a) => label(a).toLowerCase()).join(' ou ')}`);
    }
    if (!stops.length && v.evo.stages.length) {
      const first = v.evo.stages[0];
      if (v.truth.triage === 'RED') should.push('Aucun geste sur place ne stoppe cette aggravation : l\'évacuation prime');
      else if (first.triage !== v.truth.triage) should.push(`Réévaluer : aggravation attendue vers ${at(first.at * 60000)}`);
      else should.push(`Surveiller / regrouper : évolution attendue vers ${at(first.at * 60000)}`);
    }
    if (!stops.length && !slows.length && !v.evo.stages.length) {
      const helpful = acts.filter(([a, e]) => e.type === 'helpful' && CONFIG.items[a]).map(([a]) => label(a));
      should.push(helpful.length ? `Pas de geste urgent — utile si besoin : ${helpful.join(', ')}` : 'Pas de geste urgent');
    }
  }

  // ---------- oublis et erreurs ----------
  const urgent = v.truth.triage === 'RED' || evolves.some((e) => e.triage === 'RED');
  if (v.seenAt == null) {
    if (urgent && !initialUD) add('missed', W.unseenUrgent, 'Victime jamais examinée alors qu\'elle relevait de l\'urgence absolue');
    else add('missed', 0, 'Victime non examinée');
  } else if (!v.assignedTriage) {
    add('missed', W.untriaged, 'Examinée mais jamais triée');
  }

  for (const h of v.triageHistory) {
    if (h.by) continue;
    if (h.judgement === 'under') add('wrong', W.under, `Sous-tri à ${at(h.t)} : ${T(h.category)} au lieu de ${T(h.expected)}`);
    if (h.judgement === 'over') add('wrong', W.over, `Sur-tri à ${at(h.t)} : ${T(h.category)} au lieu de ${T(h.expected)}`);
  }

  // re-tri manqué : l'état a changé après le dernier tri
  // réévaluation manquée : seulement si le dernier tri est celui du joueur
  const lastTri = v.triageHistory.at(-1)?.by ? null : v.triageHistory.at(-1);
  if (lastTri && lastEvo && lastEvo.t > lastTri.t && lastEvo.triage !== lastTri.expected && v.assignedTriage !== expectedTriage(v)) {
    add('missed', W.retriage, `Réévaluation manquée : passée ${T(lastEvo.triage)} à ${at(lastEvo.t)}, toujours triée ${T(v.assignedTriage)}`);
  }

  if (!initialUD) {
    for (const [a, e] of stops) {
      const n = e.count ?? 1;
      const done = v.care[a] ?? 0;
      if (done < n) {
        add('missed', W.missedKey, done ? `Oubli : ${label(a)} (${done}/${n} posé${done > 1 ? 's' : ''})` : `Oubli : ${label(a)}`);
      } else if (firstWorse != null) {
        const lastNeeded = v.careLog.filter((c) => c.action === a)[n - 1];
        if (lastNeeded && lastNeeded.t > firstWorse) {
          add('missed', W.late, `${label(a)} posé tardivement (${at(lastNeeded.t)}), après l'aggravation de ${at(firstWorse)}`);
        }
      }
    }
    if (urgent) {
      for (const [a] of slows) if (!v.care[a]) add('missed', W.missedHelp, `Aurait aidé : ${label(a)}`);
    }
    // position d'attente
    if (bestPos && v.seenAt != null && v.status !== 'DEAD' && !v.care[bestPos[0]] && !okPos.includes(v.position)) {
      add('missed', W.position, v.position
        ? `Position inadaptée : ${label(v.position).toLowerCase()} au lieu de ${label(bestPos[0]).toLowerCase()}`
        : `Position non installée : ${label(bestPos[0]).toLowerCase()}`);
    }
  }

  for (const c of v.careLog) {
    if (!c.by && c.kind === 'worsen') {
      add('wrong', W.badPosition, `Position ${label(c.action).toLowerCase()} délétère (${at(c.t)}) : ${v.actions[c.action]?.msg ?? ''}`);
    } else if (!c.by && ['useless', 'excessive', 'dead'].includes(c.kind)) {
      add('wrong', W.badCare, `${label(c.action)} ${KIND[c.kind]} (${at(c.t)})`);
    }
  }
  for (const c of impossible) add('wrong', 1, `${label(c.action)} impossible sur cette victime (${at(c.t)})`);

  // ---------- évacuation vers le PMA ----------
  if (state.evac) {
    const e = v.evac ?? { state: 'none' };
    const logs = state.log.filter((l) => l.id === v.id);
    const walker = walkableAtStart(v);
    // ce qui a été fait
    for (const l of logs) {
      if (l.type === 'evac' && l.mode === 'walk') did.push({ t: l.t, text: (l.ok ? (state.evac?.cri?.separate ? 'Orientée à pied vers le regroupement des impliqués' : 'Orientée à pied vers le PMA') : 'Envoi à pied tenté') + (l.by ? ` par ${l.by}` : ''), note: l.by ? 'renfort' : l.ok ? '' : 'ne pouvait pas marcher', cls: l.ok || l.by ? '' : 'k-useless' });
      if (l.type === 'evac' && l.mode === 'stretcher') did.push({ t: l.t, text: `Brancardage demandé${l.by ? ` par ${l.by}` : ''}`, note: l.by ? 'renfort' : '' });
      if (l.type === 'evac-cancel') did.push({ t: l.t, text: 'Demande de brancardage annulée' });
      if (l.type === 'evac-priority') did.push({ t: l.t, text: '⚡ Brancardage passé en priorité' });
      if (l.type === 'evac-priority-lost') did.push({ t: l.t, text: `Priorité perdue au profit de ${l.by}`, note: 'une priorité par équipe', cls: 'k-excessive' });
      if (l.type === 'evac-diverted') did.push({ t: l.t, text: `${l.team} détournée vers la priorité ${l.to}`, note: 'remise dans la file', cls: 'k-excessive' });
      if (l.type === 'evac-team') did.push({ t: l.t, text: `Brancardage pris en charge par ${l.team}`, note: l.fatigue > 0.001 ? `${l.trip}ᵉ brancardage de l'équipe, fatigue +${Math.round(l.fatigue * 100)} %` : '' });
      if (l.type === 'pma') did.push({ t: l.t, text: 'Arrivée au PMA' });
      if (l.type === 'rescuer') did.push({ t: l.t, text: `${l.rescuer} posté auprès de la victime`, note: l.mode });
      if (l.type === 'rescuer-alert') did.push({ t: l.t, text: `Alerte du secouriste : aggravation` });
      if (l.type === 'rescuer-free') did.push({ t: l.t, text: `Secouriste libéré (${l.reason})` });
    }
    // ce qu'il fallait faire
    if (initialUD) should.push('Évacuation : laisser sur place, ne pas mobiliser de brancard');
    else if (v.truth.triage === 'RED') should.push('Évacuation : brancardage <b>prioritaire</b> vers le PMA');
    else if (walker) should.push(`Évacuation : <b>à pied</b> vers ${state.evac?.cri?.separate ? 'le regroupement des impliqués' : 'le PMA'} (pas de brancard)`);
    else should.push('Évacuation : brancardage vers le PMA, après les UA');
    // oublis et erreurs
    const becameRed = v.truth.triage === 'RED' || evolves.some((x) => x.triage === 'RED');
    if (becameRed && !initialUD && e.state !== 'pma' && v.status !== 'DEAD') {
      add('missed', W.noEvacUA, e.state === 'none' ? 'UA jamais évacuée vers le PMA' : 'UA pas encore arrivée au PMA en fin d\'exercice');
    }
    const req = logs.find((l) => l.type === 'evac' && l.mode === 'stretcher' && !l.by);
    if (req && (initialUD || logs.some((l) => l.type === 'evolve' && l.status === 'DEAD' && l.t <= req.t) || evolves.some((x) => x.status === 'DEAD' && x.t <= req.t))) {
      add('wrong', W.evacUD, `Brancard mobilisé pour une urgence dépassée ou une victime décédée (${at(req.t)})`);
    } else if (req && walker) {
      add('wrong', W.evacWalker, `Brancardage d'une victime qui pouvait marcher : équipe immobilisée inutilement (${at(req.t)})`);
    }
    if (logs.some((l) => l.type === 'rescuer') && initialUD) {
      add('wrong', 1, 'Secouriste mobilisé auprès d\'une urgence dépassée');
    }
    if (logs.some((l) => l.type === 'evac' && l.mode === 'walk' && !l.ok && !l.by)) {
      add('wrong', W.walkRefused, 'Envoi à pied d\'une victime qui ne pouvait pas marcher');
    }
  }
  did.sort((a, b) => a.t - b.t);

  // ---------- évolution ----------
  let outcome;
  if (v.status === 'DEAD') {
    outcome = { cls: 'dead', text: `Décédée à ${at(deathAt ?? now)}` };
    if (!initialUD) add('wrong', W.deadAvoidable, `Décès d'une victime qui n'était pas UD au départ`);
  } else if (v.evac?.state === 'pma') {
    outcome = { cls: 'ok', text: `Au PMA à ${at(v.evac.arrivedAt)}${v.evo.stage ? ` (après ${v.evo.stage} aggravation${v.evo.stage > 1 ? 's' : ''})` : ''} : prise en charge médicale` };
  } else if (v.evo.frozen && v.evo.stages.length) {
    outcome = { cls: 'ok', text: `Stabilisée à ${at(v.evo.frozenAt)}${v.evo.stage ? ` (après ${v.evo.stage} aggravation${v.evo.stage > 1 ? 's' : ''})` : ''}` };
  } else if (v.evo.stage > 0) {
    outcome = { cls: 'warn', text: `Aggravée depuis ${at(firstWorse)} : ${T(expectedTriage(v))} à ${at(now)}` };
  } else if (v.evo.stages.length) {
    const next = v.evo.stages[0];
    outcome = { cls: 'warn', text: `Encore stable, mais s'aggravera à ${at(next.atMs)} sans prise en charge` };
  } else {
    outcome = { cls: 'ok', text: 'Stable' };
  }

  const severity = issues.reduce((s, i) => s + i.weight, 0);
  return { v, did, should, issues, outcome, severity, expectedNow: expectedTriage(v) };
}

export function analyzeAll(state) {
  return state.victims
    .map((v) => analyzeVictim(v, state))
    .sort((a, b) => b.severity - a.severity || +a.v.id.slice(3) - +b.v.id.slice(3));
}

/** Résumé texte pour l'export CSV */
export function feedbackText(f) {
  return {
    should: f.should.map((s) => s.replace(/<[^>]+>/g, '')).join(' | '),
    issues: f.issues.map((i) => i.text).join(' | '),
  };
}
