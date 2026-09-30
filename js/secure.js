// ============================================================
//  Déchiffrement des fiches et des données de tri
// ============================================================
//  Format (voir outils/chiffrer.py) :
//    fichier .enc = IV (12 octets) + texte chiffré AES-256-GCM
//    keys.json    = la clé des fichiers, chiffrée par chaque code
//                   (clé dérivée du code par PBKDF2-SHA256)
//  Le navigateur n'a le chiffrement intégré (crypto.subtle) qu'en https:// ou
//  sur localhost ; ailleurs on utilise une implémentation JavaScript (noble).

const KEY_AAD = new TextEncoder().encode('smur-tri/key/v1');
const enc = (s) => new TextEncoder().encode(s);
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const normalize = (code) => code.trim().toUpperCase();

let noble = null;
async function engine() {
  if (globalThis.crypto?.subtle) return 'webcrypto';
  noble ??= await import('./vendor/noble.js');
  return 'noble';
}

async function deriveKey(code, salt, iterations) {
  if ((await engine()) === 'webcrypto') {
    const base = await crypto.subtle.importKey('raw', enc(code), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
    return new Uint8Array(bits);
  }
  return noble.pbkdf2Async(noble.sha256, enc(code), salt, { c: iterations, dkLen: 32 });
}

/** Déchiffre IV+texte ; lève une erreur si la clé est mauvaise ou le fichier altéré. */
export async function open(key, blob, aad) {
  const data = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  const iv = data.subarray(0, 12);
  const ct = data.subarray(12);
  const ad = typeof aad === 'string' ? enc(aad) : aad;
  if ((await engine()) === 'webcrypto') {
    const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: ad }, k, ct));
  }
  return noble.gcm(key, iv, ad).decrypt(ct);
}

/**
 * Essaie le code sur chaque entrée de keys.json.
 * Retourne { key, label } si le code est bon, sinon null.
 */
export async function unlock(keysDoc, code) {
  if (!code || !code.trim()) return null;
  const pass = normalize(code);
  for (const e of keysDoc.entries) {
    try {
      const kek = await deriveKey(pass, unb64(e.salt), keysDoc.iterations);
      const key = await open(kek, unb64(e.wrapped), KEY_AAD);
      return { key, label: e.label };
    } catch { /* mauvais code pour cette entrée */ }
  }
  return null;
}

export async function fetchSealed(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function openJSON(key, url, aad) {
  return JSON.parse(new TextDecoder().decode(await open(key, await fetchSealed(url), aad)));
}

/** Déchiffre une fiche et retourne une URL locale (blob:) utilisable par <img>. */
export async function openImageURL(key, url, id) {
  const bytes = await open(key, await fetchSealed(url), id);
  return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
}

/** Chiffre (IV aléatoire + AES-256-GCM) : même format que outils/chiffrer.py. */
export async function seal(key, bytes, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ad = typeof aad === 'string' ? enc(aad) : aad;
  let ct;
  if ((await engine()) === 'webcrypto') {
    const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
    ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ad }, k, bytes));
  } else ct = noble.gcm(key, iv, ad).encrypt(bytes);
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}
