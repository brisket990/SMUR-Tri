// ============================================================
//  Historique des parties (sur cet ordinateur / ce navigateur)
// ============================================================
//  Chaque bilan ouvert enregistre (ou met à jour) une ligne : date, joueur,
//  scénario, n° de partie, indicateurs clés. Consultable depuis le menu et
//  le bilan, exportable en CSV, effaçable.

const KEY = 'smur.history';
const MAX = 300;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); return true; } catch { return false; }
}

export const fmtTime = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** Enregistre ou met à jour la partie en cours */
export function recordGame(state, d) {
  const list = load();
  const id = state.gameId;
  const entry = {
    id,
    date: new Date(state.startedAt ?? Date.now()).toISOString(),
    name: state.player?.name || '—',
    scenario: state.scenario?.name ?? '',
    random: !!state.scenario?.random,
    gameNumber: state.gameNumber,
    count: state.count,
    durationMs: state.clock.elapsedMs,
    triaged: d.triaged, exact: d.exact, accepted: d.accepted, over: d.over, under: d.under,
    byReinf: d.byReinf ?? 0,
    dead: d.dead.length, avoidable: d.avoidable.length,
    pma: d.pma ?? 0, pmaRed: d.pmaRed ?? 0, redTotal: d.redTotal,
    badCares: d.badCares.length,
  };
  const i = list.findIndex((e) => e.id === id);
  if (i >= 0) list[i] = entry; else list.unshift(entry);
  save(list);
}

export function createHistory() {
  const box = document.getElementById('history');
  const body = document.getElementById('history-body');
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function render() {
    const list = load();
    if (!list.length) { body.innerHTML = '<p class="muted">Aucune partie enregistrée sur ce navigateur. Les parties s\'ajoutent à l\'ouverture du bilan.</p>'; return; }
    body.innerHTML = `<table class="hist">
      <tr><th>Date</th><th>Joueur / équipe</th><th>Scénario</th><th>N° de partie</th><th>Durée</th><th>Triées</th><th>Justes</th><th>Sur / sous-tri</th><th>Décès évitables</th><th>UA au PMA</th><th>Gestes inutiles</th></tr>
      ${list.map((e) => `<tr>
        <td>${new Date(e.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td>${esc(e.name)}</td>
        <td>${esc(e.scenario)}${e.random ? ' 🎲' : ''}</td>
        <td><code>${esc(e.gameNumber)}</code></td>
        <td>${fmtTime(e.durationMs)}</td>
        <td>${e.triaged}/${e.count}</td>
        <td>${e.exact + e.accepted}</td>
        <td>${e.over} / ${e.under}</td>
        <td class="${e.avoidable ? 'j-under' : 'j-exact'}">${e.avoidable}</td>
        <td>${e.pmaRed}/${e.redTotal}</td>
        <td>${e.badCares}</td></tr>`).join('')}
    </table>`;
  }

  function csv() {
    const list = load();
    const head = ['Date', 'Joueur', 'Scénario', 'Hasard total', 'N° de partie', 'Victimes', 'Durée', 'Triées (joueur)', 'Triées (renforts)', 'Justes', 'Défendables', 'Sur-tris', 'Sous-tris', 'Décès', 'Décès évitables', 'Au PMA', 'UA au PMA', 'UA au total', 'Gestes inutiles/excessifs'];
    const rows = list.map((e) => [new Date(e.date).toLocaleString('fr-FR'), e.name, e.scenario, e.random ? 'oui' : '', e.gameNumber, e.count, fmtTime(e.durationMs),
      e.triaged, e.byReinf, e.exact, e.accepted, e.over, e.under, e.dead, e.avoidable, e.pma, e.pmaRed, e.redTotal, e.badCares]);
    const text = [head, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = `historique-parties-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function clear() {
    if (!confirm('Effacer tout l\'historique des parties de ce navigateur ?')) return;
    save([]);
    render();
  }

  const open = () => { render(); box.hidden = false; };
  const close = () => { box.hidden = true; };
  document.getElementById('history-close').addEventListener('click', close);
  document.getElementById('history-csv').addEventListener('click', csv);
  document.getElementById('history-clear').addEventListener('click', clear);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  addEventListener('keydown', (e) => { if (!box.hidden && e.key === 'Escape') { e.stopImmediatePropagation(); close(); } }, true);
  return { open, close, isOpen: () => !box.hidden };
}
