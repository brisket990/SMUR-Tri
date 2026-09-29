// ============================================================
//  Boucle de simulation (indépendante de l'affichage)
// ============================================================

import { CONFIG } from './config.js';
import { logEvent } from './state.js';
import { updateVictims } from './evolution.js';

export function updateSim(state, dtMs) {
  if (!state.clock.running) return;
  state.clock.elapsedMs += dtMs * CONFIG.clock.timeScale;

  updateLogistics(state);
  updateVictims(state);
}

function updateLogistics(state) {
  const now = state.clock.elapsedMs;
  for (const l of state.logistics) {
    if (l.arrived || now < l.atMin * 60_000) continue;
    l.arrived = true;
    for (const [key, qty] of Object.entries(l.items)) {
      state.inventory[key] = (state.inventory[key] ?? 0) + qty;
    }
    logEvent(state, 'logistics', { label: l.label, items: l.items });
  }
}
