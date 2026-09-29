// ============================================================
//  Évolution des victimes dans le temps + effets des gestes
// ============================================================
//  Chaque victime suit un "profil" (data/profiles.json) : une suite
//  d'étapes datées en minutes de jeu. Les gestes peuvent :
//    stop       figer la victime (hémorragie contrôlée…)
//    slow       repousser les étapes restantes
//    helpful    pertinent, sans effet sur la cinétique
//    excessive  efficace mais disproportionné
//    impossible refusé (matériel non consommé)
//    useless    non indiqué (matériel consommé)
//    worsen     délétère : accélère l'aggravation (position inadaptée)

import { CONFIG, STATUS } from './config.js';
import { logEvent } from './state.js';

const MIN = 60_000;

export function initEvolution(v, profile, overrides = {}) {
  v.profile = profile;
  v.actions = { ...profile.actions, ...overrides };
  v.evo = {
    stages: profile.stages.map((s) => ({ ...s, atMs: s.at * MIN })),
    stage: 0,          // 0 = état de la fiche imprimée
    seenStage: 0,      // dernière étape montrée au joueur
    frozen: false,     // stabilisé par un geste
    frozenAt: null,
  };
  v.care = {};         // { tourniquet: 2, blanket: 1, … }
  v.careLog = [];      // [{ action, t, kind }]
  v.garroted = !!profile.garroted;
}

export function currentStage(v) {
  return v.evo.stage === 0 ? null : v.evo.stages[v.evo.stage - 1];
}

// Tri attendu à l'instant présent
export function expectedTriage(v) {
  const s = currentStage(v);
  let t = s ? s.triage : v.truth.triage;
  if (CONFIG.garrotedIsUA && v.garroted && (t === 'YELLOW' || t === 'GREEN')) t = 'RED';
  return t;
}

export function acceptedTriages(v) {
  const exp = expectedTriage(v);
  // les tolérances ne valent que pour l'état initial de la fiche
  const extra = v.evo.stage === 0 && !(v.garroted && exp !== v.truth.triage) ? v.truth.accept || [] : [];
  return [exp, ...extra];
}

const RANK = { GREEN: 0, YELLOW: 1, RED: 2 };

/** 'exact' | 'accepted' | 'over' (sur-tri) | 'under' (sous-tri) */
export function judgeTriage(v, cat) {
  const exp = expectedTriage(v);
  if (cat === exp) return 'exact';
  if (acceptedTriages(v).includes(cat)) return 'accepted';
  if (exp === 'BLACK') return 'over';     // ressources engagées sur une UD
  if (cat === 'BLACK') return 'under';    // victime sauvable abandonnée
  return RANK[cat] > RANK[exp] ? 'over' : 'under';
}

// ---------- Horloge biologique ----------

export function updateVictims(state) {
  const now = state.clock.elapsedMs;
  for (const v of state.victims) {
    const e = v.evo;
    if (e.frozen) continue;
    while (e.stage < e.stages.length && e.stages[e.stage].atMs <= now) {
      const s = e.stages[e.stage++];
      v.status = STATUS[s.status] ?? v.status;
      logEvent(state, 'evolve', { id: v.id, stage: e.stage, triage: s.triage, status: s.status });
    }
  }
}

export function stretchRemaining(v, now, factor) {
  for (let i = v.evo.stage; i < v.evo.stages.length; i++) {
    const s = v.evo.stages[i];
    s.atMs = now + (s.atMs - now) * factor;
  }
}

// ---------- Gestes ----------

export const KIND_LABEL = {
  stop: 'Geste efficace',
  slow: 'Geste utile',
  helpful: 'Geste pertinent',
  excessive: 'Geste excessif',
  useless: 'Geste non indiqué',
  impossible: 'Geste impossible',
  worsen: 'Position délétère',
  dead: 'Victime décédée',
};

/** Applique un geste. Retourne { ok, kind, message }. */
export function applyCare(state, v, action) {
  const item = CONFIG.items[action];
  if (!item) return { ok: false, message: 'Geste inconnu.' };
  const consumable = item.consumable !== false;
  const now = state.clock.elapsedMs;
  let effect = v.actions[action] ?? { type: 'useless' };
  // geste indiqué seulement à partir d'un certain stade (ex. exsufflation : pneumothorax devenu compressif)
  if (effect.fromStage != null && v.evo.stage < effect.fromStage) {
    effect = { type: 'useless', msg: effect.earlyMsg ?? 'Geste pas encore indiqué.' };
  }

  if (consumable && (state.inventory[action] ?? 0) <= 0) {
    return { ok: false, message: `Plus de ${item.label.toLowerCase()} dans le sac.` };
  }
  if (effect.type === 'impossible') {
    logEvent(state, 'care', { id: v.id, action, kind: 'impossible' });
    return { ok: false, kind: 'impossible', message: effect.msg || 'Geste impossible sur cette victime.' };
  }
  const isPos = item.group === 'position';
  if (isPos && v.position === action) return { ok: false, message: 'Déjà dans cette position.' };

  if (consumable) state.inventory[action]--;
  const count = (v.care[action] = (v.care[action] ?? 0) + 1);

  let kind = effect.type;
  if (v.status === STATUS.DEAD) kind = 'dead';
  else if (isPos) {
    // une seule position à la fois ; l'effet ne joue qu'à la première installation
    v.position = action;
    if (count === 1 && effect.type === 'slow') stretchRemaining(v, now, effect.factor ?? 1.2);
    if (count === 1 && effect.type === 'worsen') stretchRemaining(v, now, effect.factor ?? 0.85);
  }
  else if (effect.type === 'stop') {
    const needed = effect.count ?? 1;
    if (count >= needed) { v.evo.frozen = true; v.evo.frozenAt = now; }
    else stretchRemaining(v, now, effect.partial ?? 1.5);
    if (count > needed) kind = 'useless';
  } else if (effect.type === 'excessive') {
    v.evo.frozen = true; v.evo.frozenAt = now;
  } else if (effect.type === 'slow') {
    if (count <= (effect.max ?? 1)) stretchRemaining(v, now, effect.factor ?? 1.5);
    else kind = 'useless';
  }

  if (action === 'tourniquet' && ['stop', 'excessive', 'slow'].includes(kind)) v.garroted = true;

  v.careLog.push({ action, t: now, kind });
  logEvent(state, 'care', { id: v.id, action, kind });

  const base = isPos ? `Installée : ${item.label.toLowerCase()}.` : `${item.label} : fait.`;
  return { ok: true, kind, message: kind === 'dead' ? 'Victime décédée : geste inutile.' : base };
}

/** Message détaillé (pour le débriefing) */
export function careDetail(v, action) {
  const e = v.actions[action];
  return e?.msg ?? '';
}
