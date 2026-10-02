import { playVoice } from './voice.js';
// ============================================================
//  Animation d'arrivée : « Si vous pouvez marcher, venez vers moi ! »
// ============================================================
//  Au top départ, le SMUR lance l'appel des valides : des silhouettes
//  (fausses cartes, face cachée) se relèvent un peu partout, rejoignent
//  le joueur puis sortent vers le PMA et disparaissent. Purement visuel :
//  ce ne sont pas des victimes du jeu (les impliqués valides déjà sortis).
//  Réglages : scenario.json → "intro": { "walkers": [min, max], "text": "…" }  ("enabled": false pour la retirer).

import { logEvent } from './state.js';

export function createIntro(state, scenario, plan, { team, pma, cri = null, camera, amb, backImage, voice = true, voiceUrl = null, count }) {
  const C = { enabled: true, walkers: [45, 55], speedMps: 3.2, text: 'Si vous pouvez marcher, venez vers moi !', ...(scenario.intro ?? {}) };
  const walkers = [];
  let started = false;
  const pxPerM = plan.w / (scenario.scale?.planWidthMeters ?? 50);
  const speed = C.speedMps * pxPerM;          // px monde par seconde réelle
  const cardW = (state.victims[0]?.w ?? 60) * 0.8;
  const cardH = cardW * (backImage ? backImage.height / backImage.width : 1.4);

  function start() {
    if (!C.enabled || started) return;
    started = true;
    const T = team.team;
    const n = C.walkers[0] + Math.floor(Math.random() * (C.walkers[1] - C.walkers[0] + 1));
    // points de départ : dans les zones du plan (au prorata de leur poids), sinon autour des victimes
    const rects = (scenario.zones ?? []).flatMap((z) => z.rects.map((r) => ({ r, w: (z.weight ?? 1) * r[2] * r[3] / z.rects.reduce((a, q) => a + q[2] * q[3], 0) })));
    const total = rects.reduce((a, x) => a + x.w, 0);
    function spot() {
      if (total > 0) {
        let k = Math.random() * total;
        const { r } = rects.find((x) => (k -= x.w) <= 0) ?? rects[0];
        return [(r[0] + Math.random() * r[2]) * plan.w, (r[1] + Math.random() * r[3]) * plan.h];
      }
      const v = state.victims[Math.floor(Math.random() * state.victims.length)];
      return [v.x + (Math.random() - 0.5) * 3 * v.w, v.y + (Math.random() - 0.5) * 3 * v.w];
    }
    for (let i = 0; i < n; i++) {
      const [x, y] = spot();
      walkers.push({
        x, y,
        wait: 0.5 + Math.random() * 5,                 // se relèvent par vagues (s)
        phase: 'wait', age: 0, alpha: 0,
        gx: T.x + (Math.random() - 0.5) * 6 * pxPerM, gy: T.y - (1 + Math.random() * 3) * pxPerM,
        spd: speed * (0.75 + Math.random() * 0.5), tilt: (Math.random() - 0.5) * 0.3, seed: Math.random() * 10,
      });
    }
    amb?.say?.({ x: T.x, y: T.y, h: 40 }, C.text, 'shout', 6500);
    if (voice) speak(C.text);
    logEvent(state, 'walkers-call', { count: n });
  }

  function speak(text) {
    if (voiceUrl) { playVoice(voiceUrl); return; }    // votre enregistrement
    const synth = globalThis.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR'; u.rate = 1.05; u.pitch = 0.9; u.volume = 1;
    const fr = synth.getVoices().find((x) => x.lang?.toLowerCase().startsWith('fr'));
    if (fr) u.voice = fr;
    synth.cancel();
    synth.speak(u);
  }

  function update(dtMs) {
    if (!walkers.length) return;
    const dt = dtMs / 1000;
    for (let i = walkers.length - 1; i >= 0; i--) {
      const w = walkers[i];
      w.age += dt;
      if (w.phase === 'wait') {
        w.alpha = Math.min(1, w.age / 0.6);
        if (w.age >= w.wait) w.phase = 'toTeam';
        continue;
      }
      const [tx, ty] = w.phase === 'toTeam' ? [w.gx, w.gy] : [(cri ?? pma).x, (cri ?? pma).y];
      const d = Math.hypot(tx - w.x, ty - w.y);
      const step = w.spd * dt;
      if (d <= step) {
        w.x = tx; w.y = ty;
        if (w.phase === 'toTeam') w.phase = 'toPMA';
        else { w.phase = 'gone'; }
      } else {
        w.x += ((tx - w.x) / d) * step; w.y += ((ty - w.y) / d) * step;
      }
      if (w.phase === 'toPMA') {
        const left = Math.hypot((cri ?? pma).x - w.x, (cri ?? pma).y - w.y);
        w.alpha = Math.min(1, left / (4 * pxPerM));    // s'efface en arrivant au PMA
      }
      if (w.phase === 'gone') walkers.splice(i, 1);
    }
  }

  function draw(ctx) {
    for (const w of walkers) {
      const [sx, sy] = camera.worldToScreen(w.x, w.y);
      const z = camera.zoom;
      const bob = w.phase === 'wait' ? 0 : Math.sin(w.age * 9 + w.seed) * 2.5;
      const rise = w.phase === 'wait' ? Math.min(1, w.age / w.wait) : 1;   // se relève
      ctx.save();
      ctx.globalAlpha = Math.max(0, w.alpha) * 0.92;
      ctx.translate(sx, sy + bob);
      ctx.rotate(w.phase === 'wait' ? (1 - rise) * 1.2 + w.tilt : w.tilt * 0.3 + Math.sin(w.age * 9 + w.seed) * 0.05);
      const cw = cardW * z, ch = cardH * z;
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      if (backImage) ctx.drawImage(backImage, -cw / 2, -ch / 2, cw, ch);
      else { ctx.fillStyle = '#546e7a'; ctx.fillRect(-cw / 2, -ch / 2, cw, ch); }
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(129, 199, 132, 0.95)'; ctx.lineWidth = 2;
      ctx.strokeRect(-cw / 2, -ch / 2, cw, ch);
      ctx.restore();
    }
  }

  return { start, update, draw, active: () => walkers.length > 0 };
}
