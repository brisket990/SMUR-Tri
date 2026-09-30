// ============================================================
//  Corrections des fiches victimes (éditeur intégré, menu ⚙ Options)
// ============================================================
//  Une correction remplace, pour une fiche, tout ou partie de :
//    clinical (texte), truth (tri attendu), injuries (blessures dessinées),
//    profile (modèle d'évolution), evo (étapes propres à la fiche), actions (effet des gestes).
//  Deux sources, toujours chiffrées avec la clé des fichiers :
//    - scenarios/<id>/corrections.enc  : corrections PUBLIÉES (pour tout le monde)
//    - brouillon dans ce navigateur     : corrections en cours, déjà actives ici
//  Le jeu utilise le brouillon s'il existe, sinon la version publiée.

import { seal, open, openJSON } from './secure.js';

const draftKey = (sid) => `smur.corr.${sid}`;
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const emptyCorrections = (sid) => ({ v: 1, scenario: sid, updated: null, victims: {} });

export async function loadPublished(key, base, sid) {
  try { return await openJSON(key, `${base}corrections.enc`, `${sid}/corrections`); } catch { return null; }
}

export async function loadDraft(key, sid) {
  let raw = null;
  try { raw = localStorage.getItem(draftKey(sid)); } catch { return null; }
  if (!raw) return null;
  try { return JSON.parse(new TextDecoder().decode(await open(key, unb64(raw), `${sid}/corrections-draft`))); }
  catch { return null; }          // autre clé (jeu rechiffré depuis) : brouillon illisible, ignoré
}

export async function saveDraft(key, sid, corr) {
  const bytes = await seal(key, new TextEncoder().encode(JSON.stringify(corr)), `${sid}/corrections-draft`);
  try { localStorage.setItem(draftKey(sid), b64(bytes)); return true; } catch { return false; }
}
export function dropDraft(sid) { try { localStorage.removeItem(draftKey(sid)); } catch { /* */ } }
export function hasDraft(sid) { try { return !!localStorage.getItem(draftKey(sid)); } catch { return false; } }

/** Fichier à publier (scenarios/<id>/corrections.enc) */
export async function sealForPublish(key, sid, corr) {
  return seal(key, new TextEncoder().encode(JSON.stringify(corr)), `${sid}/corrections`);
}

/** Corrections actives pour une partie : brouillon local, sinon version publiée */
export async function activeCorrections(key, base, sid) {
  return (await loadDraft(key, sid)) ?? (await loadPublished(key, base, sid));
}

/** Applique les corrections : nouvelles fiches + profils (étapes propres à une fiche) */
export function applyCorrections(victims, profiles, corr) {
  if (!corr?.victims || !Object.keys(corr.victims).length) return { victims, profiles };
  const P = { ...profiles };
  const out = victims.map((e) => {
    const c = corr.victims[e.id];
    if (!c) return e;
    const n = {
      ...e,
      clinical: c.clinical ? { ...e.clinical, ...c.clinical } : e.clinical,
      truth: c.truth ? { ...e.truth, ...c.truth } : e.truth,
      injuries: c.injuries ?? e.injuries,
      profile: c.profile ?? e.profile,
      actions: c.actions ?? e.actions,
    };
    if (c.evo) {
      const name = `__fiche_${e.id}`;
      P[name] = { ...(P[n.profile] ?? { stages: [], actions: {} }), ...c.evo };
      n.profile = name;
    }
    return n;
  });
  return { victims: out, profiles: P };
}
