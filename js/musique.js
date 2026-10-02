// ============================================================
//  Musique d'ambiance pendant la partie (vos MP3)
// ============================================================
//  sons/musique/ambiance-<scénario>.mp3   propre à un scénario (ex. ambiance-metro.mp3)
//  sons/musique/ambiance.mp3              pour tous les scénarios
//  Fichier absent = pas de musique. Lecture en boucle sans coupure,
//  démarrage en fondu à l'engagement, fondu de sortie en fin de partie.
//  Volume et interrupteur dans ⚙ Options ; touche M = couper tous les sons.

const DIR = 'sons/musique/';

async function exists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    return r.ok && !/text\/html/.test(r.headers.get('content-type') ?? '');
  } catch { return false; }
}

export function createMusic({ volume = 0.35 } = {}) {
  let ctx = null, gain = null, src = null, buffer = null;
  let muted = false, playing = false;
  const target = () => (muted ? 0 : volume);

  return {
    /** à appeler dans un clic : le navigateur autorise alors le son */
    unlock() {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC || ctx) return;
      ctx = new AC();
      gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
    },
    /** charge la piste du scénario (ou la piste commune) et la lance en fondu */
    async start(scenarioId, fadeIn = 5) {
      if (!ctx) return false;
      let url = null;
      for (const f of [scenarioId && `ambiance-${scenarioId}.mp3`, 'ambiance.mp3'].filter(Boolean)) {
        if (await exists(DIR + f)) { url = DIR + f; break; }
      }
      if (!url) return false;
      try {
        buffer = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      } catch (e) { console.warn('Musique illisible :', url, e); return false; }
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;                       // boucle sans blanc
      src.connect(gain);
      src.start();
      playing = true;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(target(), ctx.currentTime + fadeIn);
      return true;
    },
    setMuted(m) {
      muted = m;
      if (gain) gain.gain.setTargetAtTime(target(), ctx.currentTime, 0.1);
    },
    setVolume(v) {
      volume = v;
      if (gain && playing) gain.gain.setTargetAtTime(target(), ctx.currentTime, 0.2);
    },
    /** fondu de sortie (fin de partie) */
    stop(fadeOut = 3) {
      if (!playing) return;
      playing = false;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + fadeOut);
      const s = src;
      setTimeout(() => { try { s.stop(); } catch { /* déjà arrêtée */ } }, fadeOut * 1000 + 100);
    },
    get playing() { return playing; },
  };
}
