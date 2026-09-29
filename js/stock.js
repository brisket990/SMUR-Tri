// ============================================================
//  Sac et renforts ajustés au nombre de victimes
// ============================================================
//  Chaque scénario définit son sac ("stock") et ses renforts ("logistics")
//  pour "stockFor" victimes (à défaut : valeurs de config.js pour 150).
//  On garde les mêmes proportions — donc le même dilemme — quel que soit
//  le nombre de victimes choisi.

import { CONFIG } from './config.js';

export function scaledStock(n, scenario = {}) {
  const on = CONFIG.scaleStockWithVictims;
  const ref = scenario.stockFor ?? 150;
  const scale = (qty) => (on && qty > 0 ? Math.max(1, Math.round((qty * n) / ref)) : qty);
  const items = {};
  for (const [k, item] of Object.entries(CONFIG.items)) {
    if (item.consumable === false) continue;
    const q = scenario.stock?.[k] ?? item.initial;
    items[k] = scenario.stockFixed ? q : scale(q);      // stockFixed : le sac du SMUR ne dépend pas du nombre de victimes
  }
  const logistics = (scenario.logistics ?? CONFIG.logistics).map((l) => ({
    ...l,
    items: Object.fromEntries(Object.entries(l.items).map(([k, q]) => [k, scale(q)])),
  }));
  return { items, logistics };
}

/** "Garrot tactique ×2 · Pansement compressif ×3 …" */
export function describeStock(items) {
  return Object.entries(items).filter(([, v]) => v > 0).map(([k, v]) => `${CONFIG.items[k].label} ×${v}`).join(' · ');
}
