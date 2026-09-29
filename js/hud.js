// ============================================================
//  Tableau de bord : chrono, sac médical, compteurs de tri
// ============================================================

import { CONFIG, TRIAGE } from './config.js';
import { triageCounts, nextLogistics } from './state.js';

export function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud(root = document) {
  const el = {
    clock: root.getElementById('hud-clock'),
    reinf: root.getElementById('hud-reinf'),
    inv: root.getElementById('hud-inventory'),
    tri: root.getElementById('hud-triage'),
    evac: root.getElementById('hud-evac'),
  };
  let last = '';
  let prevInv = null;
  const upUntil = {};     // lignes du sac qui viennent d'augmenter (surbrillance 2,5 s)

  function update(state) {
    // n'écrit dans le DOM que si quelque chose a changé
    const counts = triageCounts(state);
    const dead = state.victims.filter((v) => v.status === 'DEAD').length;
    const next = nextLogistics(state);
    const key = [
      Math.floor(state.clock.elapsedMs / 1000),
      JSON.stringify(state.inventory),
      JSON.stringify(counts),
      dead,
      JSON.stringify(state.evacSummary?.() ?? null),
      JSON.stringify(state.rescuerSummary?.() ?? null),
    ].join('|');
    if (key === last) return;
    last = key;

    el.clock.textContent = formatTime(state.clock.elapsedMs);
    el.reinf.textContent = next
      ? `${next.label} dans ${formatTime(next.atMin * 60_000 - state.clock.elapsedMs)}`
      : 'Tous les renforts sont arrivés';

    el.inv.innerHTML = Object.entries(CONFIG.items)
      .filter(([, item]) => item.consumable !== false)
      .map(([k, item]) => {
        const n = state.inventory[k];
        if (prevInv && n > (prevInv[k] ?? 0)) upUntil[k] = performance.now() + 2500;
        const up = (upUntil[k] ?? 0) > performance.now() ? ' up' : '';
        if (item.note && !n && !state.inventoryEver?.[k]) return `<li class="muted"><span>${item.label}</span><b title="${item.note}">—</b></li>`;
        return `<li class="${up}"><span>${item.label}</span><b class="${n === 0 ? 'empty' : ''}">${n}</b></li>`;
      })
      .join('');
    prevInv = { ...state.inventory };

    const ev = state.evacSummary?.();
    if (ev && el.evac) {
      const teamsLine = ev.free + ev.busy
        ? `<li><span>Brancardage</span><b>${ev.free} libre${ev.free > 1 ? 's' : ''} / ${ev.free + ev.busy}</b></li>`
        : '<li class="muted"><span>Brancardage : aucune équipe</span></li>';
      const nextLine = ev.next
        ? `<li class="muted"><span>${ev.next.org} (${ev.next.count})</span><b>dans ${formatTime(ev.next.inMs)}</b></li>` : '';
      el.evac.innerHTML = teamsLine + nextLine
        + `<li><span>En attente de brancard</span><b>${ev.queued}</b></li>`
        + `<li><span>En cours d'évacuation</span><b>${ev.moving}</b></li>`
        + `<li class="pma-line"><span>Au PMA</span><b>${ev.atPMA}${ev.atPMARed ? ` (${ev.atPMARed} UA)` : ''}</b></li>`
        + (() => {
          const rs = state.rescuerSummary?.();
          if (!rs) return '';
          return rs.total
            ? `<li><span>Secouristes</span><b>${rs.free} libre${rs.free > 1 ? 's' : ''} / ${rs.total}</b></li>`
            : '<li class="muted"><span>Secouristes : aucun</span></li>';
        })()
        + (ev.fatigue > 0.001 ? `<li class="muted"><span>Fatigue moyenne des équipes</span><b>+${Math.round(ev.fatigue * 100)} %</b></li>` : '');
    }

    el.tri.innerHTML =
      Object.entries(TRIAGE)
        .map(([k, t]) => `<li><span><i class="dot" style="background:${t.color}"></i>${t.label}</span><b>${counts[k]}</b></li>`)
        .join('') + `<li class="muted"><span>Non triées</span><b>${counts.NONE}</b></li>`
      + `<li class="dead-line"><span>✝ Décès constatés</span><b>${dead}</b></li>`;
  }

  return { update };
}
