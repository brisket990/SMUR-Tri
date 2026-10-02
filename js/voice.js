// ============================================================
//  Voix enregistrées (vos MP3) — à défaut, voix de synthèse du navigateur
// ============================================================
//  Dossier sons/voix/ :
//    briefing-<scénario>.mp3   lecture du briefing (bouton « Écouter »), ex. briefing-metro.mp3
//    briefing.mp3              briefing commun à tous les scénarios (si pas de fichier propre)
//    appel-<scénario>.mp3      « Si vous pouvez marcher, venez vers moi ! » à l'arrivée
//    appel.mp3                 appel commun
//  Scénarios : bataclan, metro, nice (le mode MPAP utilise les fichiers du scénario).

const DIR = 'sons/voix/';
const cache = new Map();

async function exists(url) {
  if (cache.has(url)) return cache.get(url);
  let ok = false;
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    ok = r.ok && !/text\/html/.test(r.headers.get('content-type') ?? '');
  } catch { ok = false; }
  cache.set(url, ok);
  return ok;
}

/** URL du MP3 à utiliser pour cette voix, ou null (→ synthèse vocale) */
export async function findVoice(name, scenarioId) {
  for (const f of [scenarioId && `${name}-${scenarioId}.mp3`, `${name}.mp3`].filter(Boolean)) {
    if (await exists(DIR + f)) return DIR + f;
  }
  return null;
}

/** Joue un MP3 ; retourne { stop, done } */
export function playVoice(url, { volume = 1, onEnd } = {}) {
  const a = new Audio(url);
  a.volume = volume;
  const end = () => onEnd?.();
  a.addEventListener('ended', end);
  a.addEventListener('error', end);
  a.play().catch(end);
  return { stop: () => { a.pause(); a.currentTime = 0; }, audio: a };
}
