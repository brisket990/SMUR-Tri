// ============================================================
//  État de la partie — source de vérité unique
// ============================================================
//  Le rendu, le HUD et la fiche LISENT cet état.
//  Seuls state.js, sim.js et evolution.js le MODIFIENT.

import { CONFIG, TRIAGE, STATUS } from './config.js';

/**
 * Victime
 * {
 *   id, src, thumb, back, w, h, zone, x, y, rot,
 *   clinical: { sex, age, mechanism, pres, vent, circ, neuro, lesion },
 *   truth: { triage, accept[], limit, why, note },   // tri attendu à l'état initial
 *   profile, actions, evo: { stages[], stage, seenStage, frozen },  // cf. evolution.js
 *   status: 'STABLE'|'CRITICAL'|'DEAD',
 *   care: { tourniquet: n, … }, careLog: [{ action, t, kind }], garroted,
 *   assignedTriage, triageJudgement: 'exact'|'accepted'|'over'|'under'|null,
 *   triageHistory: [{ t, category, expected, judgement }],
 *   seenAt, triagedAt,
 * }
 */
export function createVictim(entry, placement, visual) {
  return {
    id: entry.id,
    src: visual.src,
    thumb: visual.thumb,
    back: visual.back,
    w: visual.w,
    h: visual.h,
    ...placement,
    clinical: entry.clinical ?? null,
    truth: { triage: null, accept: [], limit: false, why: '', note: '', ...(entry.truth || {}) },
    status: STATUS.STABLE,
    assignedTriage: null,
    triageJudgement: null,
    triageHistory: [],
    seenAt: null,
    triagedAt: null,
    evac: { state: 'none' },   // none | queued | walking | pickup | loading | transport | pma
  };
}

export function createGameState({ plan, zones, victims, stock, player = {} }) {
  const inventory = {};
  for (const [key, item] of Object.entries(CONFIG.items)) {
    if (item.consumable !== false) inventory[key] = stock?.items[key] ?? item.initial;
  }
  return {
    player,                                // { name, authorized, label }
    plan,
    zones,
    victims,
    byId: new Map(victims.map((v) => [v.id, v])),
    inventory,
    logistics: (stock?.logistics ?? CONFIG.logistics).map((l) => ({ ...l, arrived: false })),
    clock: { elapsedMs: 0, running: true },
    ui: { hoveredId: null, openId: null, debugZones: false },
    log: [],
  };
}

export function logEvent(state, type, data = {}) {
  state.log.push({ t: state.clock.elapsedMs, type, ...data });
}

export function markSeen(state, id) {
  const v = state.byId.get(id);
  if (v && v.seenAt == null) {
    v.seenAt = state.clock.elapsedMs;
    logEvent(state, 'seen', { id });
  }
}

/** judge(v, category) est fourni par evolution.js (évite une dépendance circulaire) */
/** by = null : le joueur ; sinon l'équipe de renfort qui a trié (ex. « SMUR 2 ») */
export function assignTriage(state, id, category, judge, expected, by = null) {
  const v = state.byId.get(id);
  if (!v || !(category in TRIAGE)) return;
  const judgement = judge(v, category);
  v.assignedTriage = category;
  v.triageJudgement = judgement;
  v.triagedAt = state.clock.elapsedMs;
  v.triagedBy = by;
  v.triageHistory.push({ t: v.triagedAt, category, expected: expected(v), judgement, by });
  logEvent(state, 'triage', { id, category, judgement, by });
}

export function triageCounts(state) {
  const counts = { RED: 0, YELLOW: 0, GREEN: 0, BLACK: 0, NONE: 0 };
  for (const v of state.victims) counts[v.assignedTriage ?? 'NONE']++;
  return counts;
}

export function nextLogistics(state) {
  return state.logistics.find((l) => !l.arrived) ?? null;
}
