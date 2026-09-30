// ============================================================
//  Publication directe sur GitHub (éditeur des fiches)
// ============================================================
//  Un jeton d'accès « fine-grained », limité au dépôt du jeu (droit Contents :
//  lecture et écriture), est gardé CHIFFRÉ dans ce navigateur (clé des fichiers :
//  il faut donc aussi le code d'accès pour s'en servir). « Publier » écrit
//  scenarios/<id>/corrections.enc dans le dépôt ; GitHub Pages remet le site à jour.

import { seal, open } from './secure.js';

const STORE = 'smur.gh';
const AAD = 'smur-tri/github/v1';
const API = 'https://api.github.com';
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Dépôt deviné depuis l'adresse du site : https://<compte>.github.io/<dépôt>/ */
export function guessRepo() {
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
  if (!m) return '';
  const first = location.pathname.split('/').filter(Boolean)[0];
  return first && !first.includes('.') ? `${m[1]}/${first}` : `${m[1]}/${m[1]}.github.io`;
}

export async function loadGH(key) {
  let raw = null;
  try { raw = localStorage.getItem(STORE); } catch { return null; }
  if (!raw) return null;
  try { return JSON.parse(new TextDecoder().decode(await open(key, unb64(raw), AAD))); } catch { return null; }
}
export async function saveGH(key, cfg) {
  const bytes = await seal(key, new TextEncoder().encode(JSON.stringify(cfg)), AAD);
  try { localStorage.setItem(STORE, b64(bytes)); return true; } catch { return false; }
}
export function forgetGH() { try { localStorage.removeItem(STORE); } catch { /* */ } }

async function gh(cfg, path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers ?? {}) },
  });
  let body = null;
  try { body = await r.json(); } catch { /* */ }
  return { status: r.status, body };
}

/** Vérifie le dépôt et le droit d'écriture ; complète la branche par défaut. */
export async function checkGH(cfg) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo ?? '')) return { ok: false, msg: 'Dépôt : écrire compte/nom-du-dépôt.' };
  if (!cfg.token) return { ok: false, msg: 'Jeton manquant.' };
  let res;
  try { res = await gh(cfg, `/repos/${cfg.repo}`); } catch { return { ok: false, msg: 'GitHub injoignable (connexion internet ?).' }; }
  if (res.status === 401) return { ok: false, msg: 'Jeton refusé (expiré ou mal copié).' };
  if (res.status === 404) return { ok: false, msg: 'Dépôt introuvable, ou le jeton n\'y a pas accès.' };
  if (res.status !== 200) return { ok: false, msg: `Réponse inattendue de GitHub (${res.status}).` };
  if (res.body?.permissions && !res.body.permissions.push) return { ok: false, msg: 'Le jeton ne peut pas écrire dans ce dépôt (droit « Contents : Read and write »).' };
  return { ok: true, branch: cfg.branch || res.body.default_branch || 'main' };
}

/** Écrit (crée ou remplace) un fichier du dépôt. */
export async function putFile(cfg, path, bytes, message) {
  const p = [cfg.dir, path].filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\//, '');
  const url = `/repos/${cfg.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;
  let sha;
  const cur = await gh(cfg, `${url}?ref=${encodeURIComponent(cfg.branch)}`);
  if (cur.status === 200) sha = cur.body.sha;
  else if (cur.status !== 404) throw new Error(cur.status === 401 ? 'Jeton refusé (expiré ?).' : `GitHub : erreur ${cur.status}`);
  const res = await gh(cfg, url, { method: 'PUT', body: JSON.stringify({ message, content: b64(bytes), branch: cfg.branch, ...(sha ? { sha } : {}) }) });
  if (res.status !== 200 && res.status !== 201) {
    const why = res.status === 403 ? 'droit d\'écriture refusé' : res.status === 409 ? 'conflit, réessayez' : res.status === 422 ? 'refusé par GitHub' : `erreur ${res.status}`;
    throw new Error(`Publication impossible : ${why}.`);
  }
  return res.body?.commit?.html_url ?? null;
}
