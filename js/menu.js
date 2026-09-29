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

  // ---------- liste des scénarios ----------
  select.innerHTML = scenarios.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')
    + (CONFIG.randomMode ? `<option value="${RANDOM}">🎲 Hasard total — scénario et victimes surprises</option>` : '');
  const saved = store.get('smur.scenario');
  if (saved && [...select.options].some((o) => o.value === saved)) select.value = saved;
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
    countWrap.hidden = random;
    desc.textContent = random
      ? 'Le scénario et le nombre de victimes seront tirés au sort. Vous les découvrirez au briefing.'
      : sc.subtitle ?? '';
    if (random) {
      stock.textContent = 'Sac de départ : selon le scénario tiré.';
      return;
    }
    const n = Number(range.value);
    out.textContent = n;
    stock.textContent = sc.mpapOf ? 'MPAP : matériel illimité, pas de chrono, pas de déplacement. Évolution des victimes à la demande (T+5, T+10…).'
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
      else if (select.value !== sc.id) { select.value = sc.id; setupRange(); }
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
  for (const k of ['bubbles', 'phones', 'sound', 'outside']) {
    const box = $(`opt-${k}`);
    const saved = store.get(`smur.opt.${k}`);
    box.checked = saved == null ? CONFIG.ambience.defaults[k] ?? true : saved === '1';
    opts[k] = box;
  }
  // « Sons » est l'interrupteur général : sonneries (si téléphones) et sirènes/radio
  const syncSound = () => {
    const off = !opts.sound.checked;
    opts.outside.disabled = off;
    opts.outside.closest('label').classList.toggle('off', off);
  };
  opts.sound.addEventListener('change', syncSound);
  syncSound();

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
        },
      });
    });
  });
}
