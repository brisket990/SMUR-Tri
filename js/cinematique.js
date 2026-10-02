// ============================================================
//  Cinématique d'ouverture : l'appel, le fax… puis le briefing
// ============================================================
//  video/intro.mp4          la vidéo (sans musique)
//  sons/intro-musique.mp3   la musique, lancée en même temps que la vidéo ;
//                           elle continue sous le briefing, baisse pendant la
//                           voix et s'éteint en fondu à l'engagement.
//  À la fin, zoom sur la feuille du fax : le briefing s'y affiche.
//  Désactivable dans ⚙ Options ; bouton « Passer » toujours visible.

const VIDEO_MP4 = 'video/intro.mp4';
const VIDEO_WEBM = 'video/intro.webm';   // pour les navigateurs sans H.264
let VIDEO = VIDEO_MP4;
const MUSIC = 'sons/intro-musique.mp3';
const SHEET = { x: 48, y: 47 };          // centre de la feuille sur la dernière image (%)

let video = null;
let music = null;
let box = null;                          // écran noir posé dès le clic « Lancer »

async function exists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    return r.ok && !/text\/html/.test(r.headers.get('content-type') ?? '');
  } catch { return false; }
}

/** À appeler pendant le clic « Lancer » : prépare les médias et débloque le son. */
export function primeCinematic({ withMusic = true } = {}) {
  video = document.createElement('video');
  VIDEO = video.canPlayType('video/mp4; codecs="avc1.4D401F"') ? VIDEO_MP4 : VIDEO_WEBM;
  video.src = VIDEO;
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = true;               // la vidéo n'a pas de son : la musique est à part
  video.load();
  // écran noir tout de suite : le terrain ne doit pas apparaître avant la vidéo
  box = document.createElement('div');
  box.className = 'cine on';
  box.innerHTML = `
    <div class="cine-stage"></div>
    <div class="cine-white"></div>
    <div class="cine-wait">Chargement…</div>
    <button type="button" class="cine-play" hidden>▶ Lancer la vidéo</button>
    <button type="button" class="cine-skip" hidden>Passer ▸▸</button>`;
  document.body.appendChild(box);
  if (withMusic) {
    music = new Audio(MUSIC);
    music.preload = 'auto';
    // lecture muette immédiate puis pause : le navigateur retient l'autorisation
    music.volume = 0;
    music.play().then(() => { music.pause(); music.currentTime = 0; music.volume = 1; }).catch(() => { music.volume = 1; });
  }
}

function fade(a, to, ms) {
  if (!a) return Promise.resolve();
  clearInterval(a._fade);
  const from = a.volume, t0 = performance.now();
  return new Promise((res) => {
    a._fade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) { clearInterval(a._fade); res(); }
    }, 30);
  });
}

/** Contrôle de la musique, transmis au briefing. */
export const musicCtl = {
  duck: () => fade(music, 0.18, 400),
  unduck: () => fade(music, 1, 600),
  async stop(ms = 1500) {
    if (!music) return;
    const a = music;
    music = null;
    await fade(a, 0, ms);
    a.pause();
  },
};

/**
 * Joue la cinématique. Résout quand la feuille remplit l'écran
 * (fin de vidéo ou « Passer »). Résout tout de suite si la vidéo manque.
 */
export async function playCinematic() {
  if (!video || !(await exists(VIDEO))) {
    musicCtl.stop(0);
    if (box) { const b = box; b.classList.add('out'); setTimeout(() => b.remove(), 900); }
    return false;
  }
  const stage = box.querySelector('.cine-stage');
  stage.appendChild(video);
  stage.style.transformOrigin = `${SHEET.x}% ${SHEET.y}%`;

  // attendre que la vidéo puisse démarrer, puis vidéo + musique au même instant
  if (video.readyState < 3) {
    await new Promise((res) => {
      const ok = () => res();
      video.addEventListener('canplay', ok, { once: true });
      video.addEventListener('error', ok, { once: true });
      setTimeout(ok, 6000);
    });
  }

  box.querySelector('.cine-wait').remove();
  box.querySelector('.cine-skip').hidden = false;
  let finished = false;
  return new Promise((resolve) => {
    const end = async (fast) => {
      if (finished) return;
      finished = true;
      box.querySelector('.cine-skip').hidden = true;
      box.querySelector('.cine-play').hidden = true;
      // zoom sur la feuille, puis blanc : le briefing prend le relais
      box.style.setProperty('--zoom', fast ? '450ms' : '1100ms');
      box.classList.add('zoom');
      await new Promise((r) => setTimeout(r, fast ? 480 : 1150));
      video.pause();
      resolve(true);
      box.classList.add('out');
      setTimeout(() => box.remove(), 900);
    };
    const start = () => {
      box.querySelector('.cine-play').hidden = true;
      video.currentTime = 0;
      if (music) music.currentTime = 0;
      const p = video.play();
      music?.play().catch(() => {});
      return p;
    };
    video.addEventListener('ended', () => end(false), { once: true });
    video.addEventListener('error', () => end(true), { once: true });
    box.querySelector('.cine-skip').onclick = () => end(true);
    const play = box.querySelector('.cine-play');
    play.onclick = () => start().catch(() => end(true));
    start().catch(() => {
      // lecture automatique refusée : un clic du joueur la lance (vidéo + musique)
      music?.pause();
      play.hidden = false;
      play.focus();
    });
    const onKey = (e) => {
      if (finished) return document.removeEventListener('keydown', onKey);
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); end(true); }
    };
    document.addEventListener('keydown', onKey);
  });
}
