// ============================================================
//  Bilan de l'exercice : tri, décès, gestes, export CSV
// ============================================================

import { CONFIG, TRIAGE } from './config.js';
import { formatTime } from './hud.js';
import { expectedTriage } from './evolution.js';
import { analyzeAll, feedbackText } from './feedback.js';
import { recordGame } from './history.js';

const T = (k) => (k ? TRIAGE[k].short : '—');
const tag = (k) => (k ? `<span class="tag" style="background:${TRIAGE[k].color};${k === 'BLACK' ? 'color:#fff' : ''}">${TRIAGE[k].short}</span>` : '—');
const JUDGE = { exact: 'Juste', accepted: 'Défendable', over: 'Sur-tri', under: 'Sous-tri' };
const KIND = { stop: 'efficace', slow: 'utile', helpful: 'pertinent', excessive: 'excessif', useless: 'non indiqué', impossible: 'impossible', dead: 'sur décédé', worsen: 'délétère' };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function keyActions(v) {
  // gestes qui stabilisent ; à défaut, ceux qui ralentissent le plus
  const pos = Object.entries(v.actions).filter(([a, e]) => CONFIG.items[a]?.group === 'position' && e.type === 'slow')[0];
  const acts = Object.entries(v.actions).filter(([a]) => CONFIG.items[a]?.group !== 'position');
  const stops = acts.filter(([, e]) => e.type === 'stop');
  const chosen = stops.length ? stops : acts.filter(([, e]) => e.type === 'slow' && (e.factor ?? 1) >= 1.4);
  const txt = chosen.map(([a, e]) => CONFIG.items[a]?.label + (e.count > 1 ? ` ×${e.count}` : '')).join(', ');
  const p = pos ? CONFIG.items[pos[0]].label.toLowerCase() : '';
  return (stops.length ? [txt, p] : ['Évacuation prioritaire', txt, p]).filter(Boolean).join(' + ');
}

function careList(v) {
  return v.careLog.map((c) => `${CONFIG.items[c.action].label} (${c.by ? c.by : KIND[c.kind]})`).join(', ');
}

export function computeDebrief(state) {
  const vs = state.victims;
  // les stats de tri ne portent que sur les tris du joueur (pas sur ceux des SMUR de renfort)
  const triaged = vs.filter((v) => v.assignedTriage && !v.triagedBy);
  const byReinf = vs.filter((v) => v.assignedTriage && v.triagedBy).length;
  const count = (j) => triaged.filter((v) => v.triageJudgement === j).length;
  const dead = vs.filter((v) => v.status === 'DEAD');
  const avoidable = dead.filter((v) => v.truth.triage !== 'BLACK');
  // gestes du joueur uniquement (ceux des renforts et des pompiers sont à part)
  const cares = vs.flatMap((v) => v.careLog.filter((c) => !c.by).map((c) => ({ ...c, v })));
  const byOthers = vs.reduce((n, v) => n + v.careLog.filter((c) => c.by).length, 0);
  const redSeen = vs.filter((v) => v.truth.triage === 'RED' && v.seenAt != null);
  const atPMA = vs.filter((v) => v.evac?.state === 'pma');
  const redPMA = atPMA.filter((v) => v.truth.triage === 'RED' && v.evac.requestedAt != null);
  return {
    pma: atPMA.length,
    pmaRed: atPMA.filter((v) => v.truth.triage === 'RED').length,
    pmaDelay: redPMA.length ? redPMA.reduce((s, v) => s + (v.evac.arrivedAt - v.evac.requestedAt), 0) / redPMA.length : null,
    total: vs.length,
    triaged: triaged.length,
    byReinf,
    exact: count('exact'),
    accepted: count('accepted'),
    over: count('over'),
    under: count('under'),
    dead, avoidable, cares, byOthers,
    redSeen: redSeen.length,
    redTotal: vs.filter((v) => v.truth.triage === 'RED').length,
    redDelay: redSeen.length ? redSeen.reduce((s, v) => s + v.seenAt, 0) / redSeen.length : null,
    errors: triaged.filter((v) => v.triageJudgement === 'over' || v.triageJudgement === 'under'),
    badCares: cares.filter((c) => ['useless', 'excessive', 'dead', 'worsen'].includes(c.kind)),
  };
}

export function createDebrief(state, { history } = {}) {
  const box = document.getElementById('debrief');
  const body = document.getElementById('debrief-body');
  let wasRunning = true;

  function kpi(value, label, cls = '') {
    return `<div class="kpi ${cls}"><b>${value}</b><span>${label}</span></div>`;
  }

  let fb = [];
  let filter = 'issues';
  // MPAP : le bilan ne porte que sur les fiches effectivement regardées
  const scope = () => (state.mpap ? { ...state, victims: state.victims.filter((v) => v.seenAt != null) } : state);

  function renderList() {
    const q = (document.getElementById('fb-search')?.value ?? '').trim().toLowerCase().replace('_', '-');
    const keep = fb.filter((f) => {
      if (filter === 'issues' && !f.issues.some((i) => i.weight > 0)) return false;
      if (filter === 'seen' && f.v.seenAt == null) return false;
      if (filter === 'unseen' && f.v.seenAt != null) return false;
      if (!q) return true;
      const c = f.v.clinical ?? {};
      return [f.v.id, c.mechanism, c.lesion, c.pres, ...f.did.map((x) => x.text), ...f.issues.map((i) => i.text)]
        .join(' ').toLowerCase().includes(q);
    });
    const list = document.getElementById('fb-list');
    list.innerHTML = keep.length
      ? keep.map((f, i) => card(f, keep.length === 1 || (i < 3 && filter === 'issues' && !q))).join('')
      : '<p class="muted">Aucune fiche ne correspond.</p>';
    document.querySelectorAll('.fb-filters button').forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
  }

  function card(f, openIt) {
    const v = f.v;
    const c = v.clinical ?? {};
    const nMiss = f.issues.filter((i) => i.kind === 'missed' && i.weight > 0).length;
    const nWrong = f.issues.filter((i) => i.kind === 'wrong').length;
    const chips = [
      v.assignedTriage ? `trié ${tag(v.assignedTriage)}` : '<span class="muted">non trié</span>',
      nWrong ? `<span class="chip bad">${nWrong} erreur${nWrong > 1 ? 's' : ''}</span>` : '',
      nMiss ? `<span class="chip warn">${nMiss} oubli${nMiss > 1 ? 's' : ''}</span>` : '',
      !nWrong && !nMiss && v.seenAt != null ? '<span class="chip ok">✓</span>' : '',
    ].join(' ');
    return `<details class="fb-card sev-${Math.min(3, Math.ceil(f.severity / 3))}" ${openIt ? 'open' : ''}>
      <summary>
        <button type="button" class="fb-id" data-view="${v.id}" title="Voir la fiche et son évolution">${v.id} <span aria-hidden="true">🔍</span></button> <span class="muted">${esc(c.sex ?? '')}${c.age ? ', ' + c.age + ' ans' : ''}</span>
        <span class="fb-lesion">${esc(c.lesion ?? '')}</span>
        <span class="fb-chips">attendu ${tag(v.truth.triage)} · ${chips}</span>
      </summary>
      <div class="fb-grid">
        <section><h4>Ce que vous avez fait</h4>
          ${f.did.length ? `<ul>${f.did.map((x) => `<li>${state.mpap ? '' : `<span class="t">${formatTime(x.t)}</span>`}${esc(x.text)}${x.note ? ` <span class="${x.cls ?? ''}">— ${esc(x.note)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Rien : victime non examinée.</p>'}
        </section>
        <section><h4>Ce qu'il fallait faire</h4>
          <ul>${f.should.map((s) => `<li>${s}</li>`).join('')}</ul>
          <p class="fb-why">${esc(v.truth.why)}${v.truth.note ? `<br><span class="muted">${esc(v.truth.note)}</span>` : ''}</p>
        </section>
        <section><h4>Oublis et erreurs</h4>
          ${f.issues.length ? `<ul>${f.issues.map((i) => `<li class="${i.kind === 'wrong' ? 'k-useless' : i.weight ? 'k-excessive' : 'muted'}">${esc(i.text)}</li>`).join('')}</ul>` : '<p class="k-stop">Aucun : prise en charge conforme.</p>'}
        </section>
        <section><h4>Évolution</h4>
          <p class="fb-out ${f.outcome.cls}">${esc(f.outcome.text)}</p>
          ${c.mechanism ? `<p class="muted small">${state.real ? '<b>Constantes réelles (masquées en mode réel) :</b> ' : `${esc(c.mechanism)} · `}${esc(c.vent ?? '')} ${esc(c.circ ?? '')} ${esc(c.neuro ?? '')}</p>` : ''}
        </section>
      </div>
    </details>`;
  }

  function render() {
    const S = scope();
    const d = computeDebrief(S);
    fb = analyzeAll(S);
    if (state.mpap) { filter = 'all'; body.innerHTML = mpapHead(d); }
    else body.innerHTML = `
      <p class="muted">${state.player?.name ? `<b style="color:var(--text)">${esc(state.player.name)}</b> · ` : ''}${esc(state.scenario?.name ?? '')}${state.scenario?.random ? ' (hasard total)' : ''}${state.real ? ' · <span class="real-tag">mode réel</span>' : ''} · ${state.count ?? d.total} victimes · exercice arrêté à T+${formatTime(state.clock.elapsedMs)}</p>
      ${state.endReason ? `<p class="end-reason">✓ ${esc(state.endReason)}</p>` : ''}
      <p class="replay">Pour rejouer exactement cette partie (mêmes victimes, mêmes emplacements) : saisir <b>${state.gameNumber}</b> dans « N° de partie » du menu.</p>
      <div class="kpis">
        ${kpi(`${d.triaged}/${d.total}`, 'victimes triées par vous')}
        ${d.byReinf ? kpi(d.byReinf, 'triées par les SMUR de renfort') : ''}
        ${kpi(d.exact + d.accepted, `tris justes (${d.accepted} défendables)`, 'good')}
        ${kpi(d.over, 'sur-tris', d.over ? 'bad' : '')}
        ${kpi(d.under, 'sous-tris', d.under ? 'bad' : '')}
        ${kpi(d.dead.length, 'décès sur le terrain')}
        ${kpi(d.avoidable.length, 'décès de victimes non UD au départ', d.avoidable.length ? 'bad' : 'good')}
        ${kpi(`${d.redSeen}/${d.redTotal}`, 'UA examinées')}
        ${kpi(d.redDelay != null ? formatTime(d.redDelay) : '—', 'délai moyen d’examen des UA')}
        ${state.evac ? kpi(`${d.pmaRed}/${d.redTotal}`, 'UA arrivées au PMA', d.pmaRed ? 'good' : 'bad') : ''}
        ${state.evac ? kpi(d.pma, 'victimes au PMA (total)') : ''}
        ${state.evac ? kpi(d.pmaDelay != null ? formatTime(d.pmaDelay) : '—', 'délai moyen demande → PMA des UA') : ''}
        ${kpi(d.cares.length, 'gestes réalisés par vous')}
        ${d.byOthers ? kpi(d.byOthers, 'gestes réalisés par les renforts et les pompiers') : ''}
        ${kpi(d.badCares.length, 'gestes non indiqués / excessifs', d.badCares.length ? 'bad' : '')}
      </div>
      ${teamTable()}
      ${tools()}`;
    if (!document.getElementById('fb-search')) return;     // MPAP : aucune fiche regardée
    body.querySelectorAll('.fb-filters button').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; renderList(); }));
    document.getElementById('fb-search').addEventListener('input', () => { if (filter === 'issues') filter = 'all'; renderList(); });
    renderList();
  }

  // multijoueur : ce qu'a fait chaque intervenant
  function teamTable() {
    const team = state.mpTeam?.();
    if (!team?.length) return '';
    const R = { med: 'Médecin', ide: 'Infirmier', amb: 'Ambulancier' };
    const changes = state.victims.filter((v) => new Set(v.triageHistory.filter((h) => h.who).map((h) => h.who)).size > 1);
    return `<h3 class="mp-db-title">Équipe</h3>
      <table class="mp-db"><thead><tr><th>Intervenant</th><th>Fiches lues</th><th>Tris</th><th>Gestes</th><th>Matériel donné</th><th>Refus</th><th>Distance</th></tr></thead>
      <tbody>${team.map((p) => `<tr><td><b>${esc(p.name)}</b> <span class="muted">${R[p.role] ?? ''}</span></td><td>${p.seen}</td><td>${p.triage}</td><td>${p.care}</td><td>${p.given}</td><td>${p.refused}</td><td>${p.m} m</td></tr>`).join('')}</tbody></table>
      ${changes.length ? `<p class="muted small">Tris modifiés par un autre intervenant : ${changes.map((v) => `<b>${v.id}</b> (${v.triageHistory.filter((h) => h.who).map((h) => `${esc(h.who)} → ${h.category === 'RED' ? 'UA' : h.category === 'YELLOW' ? 'UR' : h.category === 'GREEN' ? 'impliqué' : 'UD'}`).join(', ')})`).join(' · ')}</p>` : ''}`;
  }

  // MPAP : pas de chrono ni de délais ; uniquement les fiches regardées
  function mpapHead(d) {
    const pma = d.pma;
    return `
      <p class="muted">${esc(state.scenario?.name ?? '')}${state.real ? ' · <span class="real-tag">mode réel</span>' : ''} · <b style="color:var(--text)">${d.total} fiche${d.total > 1 ? 's' : ''} regardée${d.total > 1 ? 's' : ''}</b> sur ${state.victims.length} · le bilan ne porte que sur ces fiches</p>
      ${d.total ? `<div class="kpis">
        ${kpi(`${d.triaged}/${d.total}`, 'fiches triées')}
        ${kpi(d.exact + d.accepted, `tris justes (${d.accepted} défendables)`, 'good')}
        ${kpi(d.over, 'sur-tris', d.over ? 'bad' : '')}
        ${kpi(d.under, 'sous-tris', d.under ? 'bad' : '')}
        ${kpi(d.redTotal, 'UA parmi les fiches regardées')}
        ${kpi(`${d.pmaRed}/${d.redTotal}`, 'UA envoyées au PMA', d.redTotal && d.pmaRed < d.redTotal ? 'bad' : 'good')}
        ${kpi(pma, 'fiches envoyées au PMA')}
        ${kpi(d.cares.length, 'gestes réalisés')}
        ${kpi(d.badCares.length, 'gestes non indiqués / excessifs', d.badCares.length ? 'bad' : '')}
      </div>` : ''}
      ${d.total ? tools(true) : '<p class="muted">Aucune fiche regardée pour l\'instant : cliquez sur des cartes de la scène, puis revenez au bilan.</p>'}`;
  }

  function tools(mpap = false) {
    return `
      <h3>Correction fiche par fiche</h3>
      <div class="fb-tools">
        <div class="fb-filters" role="group">
          <button data-f="issues">À corriger (${fb.filter((f) => f.issues.some((i) => i.weight > 0)).length})</button>
          ${mpap ? '' : `<button data-f="seen">Examinées (${fb.filter((f) => f.v.seenAt != null).length})</button>
          <button data-f="unseen">Non examinées (${fb.filter((f) => f.v.seenAt == null).length})</button>`}
          <button data-f="all">${mpap ? 'Fiches regardées' : 'Toutes'} (${fb.length})</button>
        </div>
        <input id="fb-search" type="search" placeholder="Rechercher : BC-45, garrot, thorax…" />
      </div>
      <div id="fb-list" class="fb-list"></div>`;
  }

  function csv() {
    const head = ['ID', 'Lésion', 'Tri attendu (fiche)', 'Tolérés', 'Tri choisi', 'Verdict', 'Heure tri', 'Examinée', 'Statut final', 'Tri attendu (fin)', 'Gestes réalisés', 'Il fallait', 'Oublis et erreurs', 'Justification'];
    const rows = analyzeAll(scope()).sort((a, b) => +a.v.id.slice(3) - +b.v.id.slice(3)).map((f) => {
      const v = f.v;
      const h = v.triageHistory.at(-1);
      const t = feedbackText(f);
      return [v.id, v.clinical?.lesion ?? '', T(v.truth.triage), v.truth.accept.map(T).join(' / '), T(v.assignedTriage), h ? JUDGE[h.judgement] : '',
        h ? formatTime(h.t) : '', v.seenAt != null ? formatTime(v.seenAt) : '', f.outcome.text, T(expectedTriage(v)), careList(v), t.should, t.issues, v.truth.why];
    });
    const text = [head, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = `bilan-tri-${(state.player?.name || 'exercice').replace(/[^\w-]+/g, '_')}-${state.gameNumber}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Impression / PDF : toutes les fiches, dépliées, sur fond blanc
  function print() {
    filter = 'all';
    const search = document.getElementById('fb-search');
    if (search) search.value = '';
    renderList();
    body.querySelectorAll('details.fb-card').forEach((d) => (d.open = true));
    document.body.classList.add('print-debrief');
    const done = () => { document.body.classList.remove('print-debrief'); removeEventListener('afterprint', done); };
    addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1500);
  }

  // ---------- visionneuse de fiche (clic sur le numéro) ----------
  const viewer = document.getElementById('card-view');
  function viewCard(id) {
    const v = state.byId?.get(id) ?? state.victims.find((x) => x.id === id);
    if (!v) return;
    const reached = v.evo.stages.slice(0, v.evo.stage);
    const upcoming = v.evo.stages.slice(v.evo.stage);
    viewer.querySelector('img').src = v.src;
    viewer.querySelector('.cv-title').textContent = `${v.id} · ${v.zoneLabel ?? v.zone ?? ''}`;
    viewer.querySelector('.cv-evo').innerHTML = `
      <h4>Évolution pendant l'exercice</h4>
      <ol class="cv-steps">
        <li><span class="t">T+00:00</span>État de la fiche imprimée</li>
        ${reached.map((st) => `<li class="${st.status === 'DEAD' ? 'dead' : 'worse'}"><span class="t">T+${formatTime(st.atMs)}</span>${esc(st.text)}${st.params ? `<br><code>${esc(st.params)}</code>` : ''}<br><span class="muted">Tri attendu : ${T(st.triage)}</span></li>`).join('')}
        ${v.evac?.state === 'pma' ? `<li class="ok"><span class="t">T+${formatTime(v.evac.arrivedAt)}</span>Arrivée au PMA : évolution arrêtée</li>` : ''}
        ${v.evo.frozen && v.evac?.state !== 'pma' && upcoming.length ? `<li class="ok"><span class="t">T+${formatTime(v.evo.frozenAt)}</span>Stabilisée par un geste</li>` : ''}
      </ol>
      ${!reached.length ? '<p class="muted">Aucune aggravation pendant l\'exercice.</p>' : ''}
      ${upcoming.length && !v.evo.frozen && v.evac?.state !== 'pma' ? `<h4>Évolution à venir sans prise en charge</h4><ol class="cv-steps future">${upcoming.map((st) => `<li><span class="t">T+${formatTime(st.atMs)}</span>${esc(st.text)}</li>`).join('')}</ol>` : ''}
      <p class="muted small">${esc(v.profile?.if_nothing ? 'Sans rien faire : ' + v.profile.if_nothing : '')}</p>`;
    viewer.hidden = false;
  }
  const closeViewer = () => { viewer.hidden = true; viewer.querySelector('img').removeAttribute('src'); };
  viewer.addEventListener('click', (e) => { if (e.target === viewer || e.target.closest('.cv-close')) closeViewer(); });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    e.preventDefault();               // ne pas replier / déplier la fiche
    e.stopPropagation();
    viewCard(b.dataset.view);
  });
  addEventListener('keydown', (e) => { if (!viewer.hidden && e.key === 'Escape') { e.stopImmediatePropagation(); closeViewer(); } }, true);

  function open() {
    wasRunning = state.clock.running;
    state.clock.running = false; // le chrono s'arrête pendant le bilan
    if (state.player?.authorized) recordGame(state, computeDebrief(state));
    render();
    box.hidden = false;
  }
  function close() {
    box.hidden = true;
    state.clock.running = wasRunning;
  }

  document.getElementById('debrief-close').addEventListener('click', close);
  document.getElementById('debrief-csv').addEventListener('click', csv);
  document.getElementById('debrief-print').addEventListener('click', print);
  document.getElementById('debrief-history').addEventListener('click', () => history?.open());
  addEventListener('keydown', (e) => { if (!box.hidden && e.key === 'Escape') close(); });

  return { open, close, isOpen: () => !box.hidden };
}
