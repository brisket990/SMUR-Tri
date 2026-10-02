import { playVoice } from './voice.js';
// ============================================================
//  Briefing de lancement : message de situation du scénario
// ============================================================
//  Texte défini dans scenario.json → "briefing". Variables remplacées :
//    {victimes}  estimation du nombre de victimes
//    {sac}       contenu du sac de départ
//    {renfort}   heure et nature du premier renfort logistique
//    {nom}       nom / équipe saisi au menu
//  Affichage en machine à écrire (clic ou « Afficher tout » pour passer),
//  lecture à voix haute facultative (synthèse vocale du navigateur).

import { CONFIG } from './config.js';
import { describeStock } from './stock.js';
import { setupBriefingTabs } from './tuto.js';

function estimate(n) {
  if (n <= 20) return `une quinzaine à une vingtaine`;
  const r = Math.round(n / 10) * 10;
  return `environ ${r}`;
}

export function fillBriefing(scenario, { count, stock, player }) {
  const b = scenario.briefing ?? {};
  const first = stock.logistics[0];
  const vars = {
    victimes: `Le nombre de victimes est estimé à ${estimate(count)}.`,
    sac: describeStock(stock.items).toLowerCase(),
    renfort: first ? `Premier renfort logistique (${first.label}) attendu à T+${first.atMin} min.` : 'Aucun renfort logistique annoncé.',
    nom: player?.name || 'votre équipe',
  };
  const fill = (t) => String(t).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
  return {
    from: b.from ?? 'Régulation médicale',
    time: b.time ?? '',
    title: b.title ?? scenario.name,
    paragraphs: (b.paragraphs ?? [scenario.subtitle ?? '']).map(fill),
    orders: (b.orders ?? []).map(fill),
  };
}

/** Affiche le briefing ; résout quand l'équipe est engagée. */
export function showBriefing(content, { onEngage, voiceUrl = null } = {}) {
  const $ = (id) => document.getElementById(id);
  const box = $('briefing');
  const text = $('briefing-text');
  const orders = $('briefing-orders');
  const voiceBtn = $('briefing-voice');
  const skipBtn = $('briefing-skip');
  const go = $('briefing-go');

  $('briefing-from').textContent = content.from;
  $('briefing-time').textContent = content.time;
  $('briefing-title').textContent = content.title;
  orders.innerHTML = content.orders.map((o) => `<li>${o.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</li>`).join('');
  orders.hidden = true;
  text.innerHTML = '';
  const tabs = setupBriefingTabs();
  box.hidden = false;
  go.focus();

  // ---------- machine à écrire ----------
  let done = false;
  let timer = null;
  const paras = content.paragraphs;
  function finish() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    text.innerHTML = paras.map((p) => `<p></p>`).join('');
    [...text.children].forEach((el, i) => (el.textContent = paras[i]));
    orders.hidden = !content.orders.length;
    skipBtn.hidden = true;
  }
  function type(pi = 0, ci = 0) {
    if (done) return;
    if (pi >= paras.length) return finish();
    if (ci === 0) text.insertAdjacentHTML('beforeend', '<p><span class="t"></span><span class="caret"></span></p>');
    const p = text.lastElementChild;
    p.querySelector('.t').textContent = paras[pi].slice(0, ci + 1);
    if (ci + 1 >= paras[pi].length) {
      p.querySelector('.caret')?.remove();
      timer = setTimeout(() => type(pi + 1, 0), 260);
    } else {
      timer = setTimeout(() => type(pi, ci + 1), CONFIG.briefing.typeSpeed);
    }
  }
  if (CONFIG.briefing.typeSpeed > 0) type(); else finish();
  // ouvrir l'onglet « Comment jouer » affiche tout de suite la totalité de la situation
  box.querySelector('[data-tab="tuto"]').addEventListener('click', finish, { once: true });
  void tabs;
  skipBtn.hidden = CONFIG.briefing.typeSpeed <= 0;
  skipBtn.onclick = finish;
  text.onclick = finish;

  // ---------- lecture à voix haute ----------
  const synth = globalThis.speechSynthesis;
  const canSpeak = CONFIG.briefing.voice && synth && typeof SpeechSynthesisUtterance !== 'undefined';
  voiceBtn.hidden = !canSpeak && !voiceUrl;
  let speaking = false;
  let rec = null;                       // votre enregistrement (MP3) en cours
  function stopVoice() {
    if (canSpeak) synth.cancel();
    rec?.stop(); rec = null;
    speaking = false;
    voiceBtn.textContent = '🔊 Écouter';
  }
  if (voiceUrl) {
    voiceBtn.onclick = () => {
      if (speaking) return stopVoice();
      finish();
      rec = playVoice(voiceUrl, { onEnd: stopVoice });
      speaking = true;
      voiceBtn.textContent = '■ Arrêter la lecture';
    };
  } else if (canSpeak) {
    voiceBtn.onclick = () => {
      if (speaking) return stopVoice();
      finish();
      const u = new SpeechSynthesisUtterance([content.title, ...content.paragraphs, ...content.orders].join('\n'));
      u.lang = 'fr-FR';
      u.rate = 1.02;
      const fr = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith('fr'));
      if (fr) u.voice = fr;
      u.onend = u.onerror = stopVoice;
      synth.cancel();
      synth.speak(u);
      speaking = true;
      voiceBtn.textContent = '■ Arrêter la lecture';
    };
  }

  return new Promise((resolve) => {
    go.onclick = () => {
      onEngage?.();   // dans le clic : les navigateurs n'autorisent le son qu'après un geste
      finish();
      stopVoice();
      box.hidden = true;
      resolve();
    };
  });
}
