// ============================================================
//  Menu de départ : nom, scénario (ou hasard total), nombre de
//  victimes, n° de partie, code d'accès caché
// ============================================================

import { CONFIG } from './config.js';
import { scaledStock, describeStock } from './stock.js';

const RANDOM = '__hasard__';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
};
// le code reste mémorisé pour l'onglet (nouvelle partie sans le retaper), jamais au-delà
const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* navigation privée */ } },
};

/**
 * N° de partie : "BAT-835416-40" (scénario, disposition, victimes).
 * Formes courtes acceptées : "835416-40", "835416".
 */
export function parseGameNumber(text) {
  const m = String(text ?? '').trim().match(/^(?:([A-Za-z]{2,8})\s*[-–/ ]\s*)?(\d{1,9})(?:\s*[-–/ ]\s*(\d{1,3}))?$/);
  if (!m) return null;
  return { code: m[1]?.toUpperCase() ?? null, seed: Number(m[2]), count: m[3] ? Number(m[3]) : null };
}

export const gameNumber = (scenario, seed, count) => `${scenario.code}-${seed}-${count}`;

export const victimRange = (sc) => {
  const r = { ...CONFIG.victimCount, ...(sc.victims ?? {}) };
  r.max = Math.min(r.max, sc.public?.count ?? r.max);
  r.min = Math.min(r.min, r.max);
  return r;
};

/**
 * Affiche le menu. scenarios = [{ id, code, name, subtitle, victims, public }]
 * Résout { name, code, scenarioId | null (hasard), count, seed }.
 */
export function showMenu(scenarios) {
  const $ = (id) => document.getElementById(id);
  const menu = $('menu');
  const name = $('menu-name');
  const code = $('menu-code');
  const select = $('menu-scenario');
  const desc = $('menu-scenario-desc');
  const countWrap = $('menu-count-wrap');
  const range = $('menu-count');
  const out = $('menu-count-out');
  const stock = $('menu-stock');
  const game = $('menu-game');

  // ---------- onglets Jeu / MPAP : chacun sa liste de scénarios ----------
  const card = $('menu-form');
  const fields = menu.querySelector('.menu-fields');
  const tabs = [...menu.querySelectorAll('.mode-tab')];
  const startBtn = menu.querySelector('.menu-start');
  const isMpap = (s) => !!s.mpapOf;
  const hasMpap = scenarios.some(isMpap);
  $('mode-switch').hidden = !hasMpap;
  let mode = hasMpap && store.get('smur.mode') === 'mpap' ? 'mpap' : 'jeu';

  function fillSelect() {
    const list = scenarios.filter((s) => isMpap(s) === (mode === 'mpap'));
    select.innerHTML = list.map((s) => `<option value="${s.id}">${mode === 'mpap' ? s.name.replace(/\s*\(MPAP\)\s*$/, '') : s.name}</option>`).join('')
      + (mode === 'jeu' && CONFIG.randomMode ? `<option value="${RANDOM}">🎲 Hasard total — scénario et victimes surprises</option>` : '');
    const saved = store.get(`smur.scenario.${mode}`) ?? store.get('smur.scenario');
    if (saved && [...select.options].some((o) => o.value === saved)) select.value = saved;
  }
  function setMode(m, { animate = true } = {}) {
    mode = m;
    card.dataset.mode = m;
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === m)));
    startBtn.textContent = m === 'mpap' ? 'Lancer la projection' : 'Commencer l\'exercice';
    fillSelect();
    if (animate) { fields.classList.remove('swap'); void fields.offsetWidth; fields.classList.add('swap'); }
  }
  tabs.forEach((t) => t.addEventListener('click', () => {
    if (t.dataset.mode === mode) return;
    setMode(t.dataset.mode);
    store.set('smur.mode', mode);
    setupRange(); preview();
  }));
  // flèches gauche / droite sur les onglets
  $('mode-switch').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = tabs.find((x) => x.dataset.mode !== mode);
    t.click(); t.focus();
  });
  setMode(mode, { animate: false });
  name.value = store.get('smur.name') ?? '';

  const current = () => scenarios.find((s) => s.id === select.value) ?? null;

  function setupRange() {
    const sc = current();
    if (!sc) return;
    const r = victimRange(sc);
    Object.assign(range, { min: r.min, max: r.max, step: r.step });
    const want = Number(store.get(`smur.count.${sc.id}`)) || r.default;
    range.value = Math.max(r.min, Math.min(r.max, want));
  }

  function preview() {
    const sc = current();
    const random = !sc;
    countWrap.hidden = random || !!sc?.mpapOf;      // MPAP : toutes les fiches, pas de choix du nombre
    desc.textContent = random
      ? 'Le scénario et le nombre de victimes seront tirés au sort. Vous les découvrirez au briefing.'
      : sc.subtitle ?? '';
    if (random) {
      stock.textContent = 'Sac de départ : selon le scénario tiré.';
      return;
    }
    const n = Number(range.value);
    out.textContent = n;
    stock.textContent = sc.mpapOf ? `MPAP : les ${sc.public?.count ?? 150} fiches${(sc.mpap?.extraDead ?? 50) > 0 ? ` + ${sc.mpap?.extraDead ?? 50} décédés entassés à l'entrée` : ''}, survivants cachés sous les corps. Matériel illimité, pas de chrono, pas de déplacement. Évolution à la demande (T+5, T+10…).`
      : 'Sac de départ : ' + describeStock(scaledStock(n, sc).items);
  }

  select.addEventListener('change', () => { setupRange(); preview(); });
  range.addEventListener('input', preview);

  // ---------- n° de partie (rejouer) ----------
  const params = new URLSearchParams(location.search);
  game.value = params.get('partie') ?? params.get('seed') ?? '';
  function applyGame() {
    const g = parseGameNumber(game.value);
    game.classList.toggle('invalid', !!game.value.trim() && !g);
    if (g?.code) {
      const sc = scenarios.find((s) => s.code.toUpperCase() === g.code);
      if (!sc) game.classList.add('invalid');
      else if (select.value !== sc.id) {
        if (isMpap(sc) !== (mode === 'mpap')) setMode(isMpap(sc) ? 'mpap' : 'jeu');   // n° d'une partie de l'autre mode
        select.value = sc.id; setupRange();
      }
    }
    if (g?.count && current()) {
      const r = victimRange(current());
      range.value = Math.max(r.min, Math.min(r.max, g.count));
    }
    preview();
  }
  game.addEventListener('input', applyGame);
  setupRange();
  applyGame();

  // ---------- champ du code caché : N clics rapides sur la carte ----------
  const codeWrap = $('menu-code-wrap');
  code.value = session.get('smur.code') ?? '';
  let clicks = 0;
  let clickTimer = null;
  menu.querySelector('.menu-art').addEventListener('click', () => {
    clicks++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => (clicks = 0), 600);
    if (clicks >= CONFIG.access.revealClicks) {
      clicks = 0;
      codeWrap.hidden = false;
      code.focus();
    }
  });

  // ---------- options d'ambiance (mémorisées) ----------
  const opts = {};
  for (const k of ['bubbles', 'phones', 'sound', 'outside', 'cine', 'music']) {
    const box = $(`opt-${k}`);
    const saved = store.get(`smur.opt.${k}`);
    box.checked = saved == null ? CONFIG.ambience.defaults[k] ?? true : saved === '1';
    opts[k] = box;
  }
  // « Sons » est l'interrupteur général : sonneries (si téléphones) et sirènes/radio
  const syncSound = () => {
    const off = !opts.sound.checked;
    for (const k of ['outside', 'music']) {
      opts[k].disabled = off;
      opts[k].closest('label').classList.toggle('off', off);
    }
    const volOff = off || !opts.music.checked;
    musicVol.disabled = volOff;
    musicVol.closest('label').classList.toggle('off', volOff);
  };
  const musicVol = $('opt-music-vol');
  musicVol.value = store.get('smur.opt.musicVol') ?? CONFIG.music.volume * 100;
  const showVol = () => { $('opt-music-vol-out').textContent = `${musicVol.value} %`; };
  showVol();
  musicVol.addEventListener('input', () => { showVol(); store.set('smur.opt.musicVol', musicVol.value); });
  opts.music.addEventListener('change', () => syncSound());
  opts.sound.addEventListener('change', syncSound);
  syncSound();
  // enregistrées dès qu'on les change (pas besoin de lancer une partie)
  for (const [k, box] of Object.entries(opts)) box.addEventListener('change', () => store.set(`smur.opt.${k}`, box.checked ? '1' : '0'));

  // ---------- panneau Options ----------
  const optsBox = $('menu-opts');
  const optsBtn = $('menu-options-btn');
  const closeOpts = () => { optsBox.hidden = true; optsBtn.focus(); };
  optsBtn.onclick = () => { optsBox.hidden = false; optsBox.querySelector('.opts-ok').focus(); };
  optsBox.onclick = (e) => { if (e.target === optsBox || e.target.closest('.opts-close, .opts-ok')) closeOpts(); };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !optsBox.hidden && document.getElementById('editor').hidden) { e.stopPropagation(); closeOpts(); }
  });
  // éditeur des fiches victimes (chargé à la demande)
  $('open-editor').onclick = async () => {
    if (code.value) session.set('smur.code', code.value);
    const { openEditor } = await import('./editor.js');
    openEditor({ scenarios });
  };

  menu.hidden = false;
  name.focus();

  return new Promise((resolve) => {
    $('menu-form').addEventListener('submit', function onSubmit(e) {
      e.preventDefault();
      const g = parseGameNumber(game.value);
      if (game.value.trim() && (!g || game.classList.contains('invalid'))) { game.focus(); return; }
      const sc = current();
      store.set('smur.name', name.value.trim());
      store.set('smur.scenario', select.value);
      store.set(`smur.scenario.${mode}`, select.value);
      store.set('smur.mode', mode);
      optsBox.hidden = true;
      if (sc) store.set(`smur.count.${sc.id}`, range.value);
      if (code.value) session.set('smur.code', code.value);
      for (const [k, box] of Object.entries(opts)) store.set(`smur.opt.${k}`, box.checked ? '1' : '0');
      menu.hidden = true;
      $('menu-form').removeEventListener('submit', onSubmit);
      resolve({
        name: name.value.trim(),
        code: code.value,
        scenarioId: sc?.id ?? null,           // null = hasard total
        count: sc ? Number(range.value) : null,
        seed: g?.seed ?? null,
        ambience: {
          bubbles: opts.bubbles.checked,
          phones: opts.phones.checked,
          sound: opts.sound.checked,
          outside: opts.sound.checked && opts.outside.checked,
          cine: opts.cine.checked,
          music: opts.sound.checked && opts.music.checked,
          musicVol: Number(musicVol.value) / 100,
        },
      });
    });
  });
}
