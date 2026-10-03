// ============================================================
//  Menu de départ : nom, scénario (ou hasard total), nombre de
//  victimes, n° de partie, code d'accès caché
// ============================================================

import { CONFIG } from './config.js';
import { scaledStock, describeStock } from './stock.js';
import { probeServer, post, myPid, ROLES } from './multi.js';

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
  tabs.find((t) => t.dataset.mode === 'mpap').hidden = !hasMpap;
  // ?mp=1 : ouvert par le serveur multijoueur → onglet Multi d'emblée
  const urlMp = new URLSearchParams(location.search).has('mp');
  let mode = urlMp ? 'multi' : ({ mpap: hasMpap ? 'mpap' : 'jeu', multi: 'multi' }[store.get('smur.mode')] ?? 'jeu');

  function fillSelect() {
    const list = scenarios.filter((s) => isMpap(s) === (mode === 'mpap'));
    select.innerHTML = list.map((s) => `<option value="${s.id}">${mode === 'mpap' ? s.name.replace(/\s*\(MPAP\)\s*$/, '') : s.name}</option>`).join('')
      + (mode === 'jeu' && CONFIG.randomMode ? `<option value="${RANDOM}">🎲 Hasard total — scénario et victimes surprises</option>` : '');
    const saved = store.get(`smur.scenario.${mode}`) ?? store.get('smur.scenario');
    if (saved && [...select.options].some((o) => o.value === saved)) select.value = saved;
  }
  let mpHooks = null;              // branché plus bas (onglet Multi)
  function setMode(m, { animate = true } = {}) {
    mode = m;
    card.dataset.mode = m;
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === m)));
    startBtn.textContent = m === 'mpap' ? 'Lancer la projection' : 'Commencer l\'exercice';
    fillSelect();
    if (m === 'multi') mpHooks?.enter(); else mpHooks?.leave();
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
    const vis = tabs.filter((x) => !x.hidden);
    const i = vis.findIndex((x) => x.dataset.mode === mode);
    const t = vis[(i + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length];
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

  // ---------- mode réel (sans constantes chiffrées) ----------
  const real = $('menu-real');
  real.checked = store.get('smur.real') === '1';
  real.addEventListener('change', () => store.set('smur.real', real.checked ? '1' : '0'));

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


  // ---------- Multijoueur (réseau local) ----------
  const mpPanel = $('mp-panel');
  const mpRole = $('mp-role');
  const codeWrapMp = $('menu-code-wrap');
  mpRole.value = store.get('smur.mp.role') ?? 'med';
  const mpS = { info: null, joined: false, joinGen: null, poll: null, resolve: null };
  const escH = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function lobbyHTML(list) {
    if (!list?.length) return '<p class="muted small">Personne pour l\'instant.</p>';
    return `<ul class="mp-list">${list.map((p) => {
      const r = ROLES[p.role] ?? ROLES.med;
      return `<li><span class="mp-badge" style="background:${r.color}">${r.short}</span><b>${escH(p.name)}</b>${p.pid === myPid() ? ' <span class="muted">(vous)</span>' : ''}<span class="mp-ip">${escH(p.ip)}</span>${p.age > 6 ? '<span class="mp-lost">perdu</span>' : ''}</li>`;
    }).join('')}</ul>`;
  }
  function renderMp() {
    const st = card.dataset.mp;
    mpPanel.hidden = mode !== 'multi';
    if (mode !== 'multi') return;
    const info = mpS.info;
    codeWrapMp.hidden = st === 'none' || st === 'probing' ? codeWrapMp.hidden : false;
    if (st === 'probing') { mpPanel.innerHTML = '<div class="mp-box"><p class="muted">Recherche du serveur…</p></div>'; return; }
    if (st === 'none') {
      const saved = store.get('smur.mp.addr') ?? '';
      mpPanel.innerHTML = `<div class="mp-box">
        <h3>Partie en réseau</h3>
        <p>Le formateur lance le serveur sur son PC : double-clic sur <b>Serveur multijoueur.bat</b> (dossier du projet). Le jeu s'ouvre alors chez lui dans cet onglet, et une adresse s'affiche.</p>
        <p><b>Joueur :</b> saisissez cette adresse pour rejoindre l'équipe.</p>
        <div class="mp-row"><input id="mp-addr" placeholder="ex. 192.168.1.20:8765" value="${escH(saved)}" autocomplete="off" /><button type="button" id="mp-go">Se connecter</button></div>
        <p class="muted small">Tous les postes doivent être sur le même réseau (Wi-Fi de la salle).</p></div>`;
      const go = () => {
        let a = $('mp-addr').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
        if (!a) return $('mp-addr').focus();
        if (!/:\d+$/.test(a)) a += ':8765';
        store.set('smur.mp.addr', a);
        location.href = `http://${a}/?mp=1`;
      };
      $('mp-go').onclick = go;
      $('mp-addr').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      startBtn.hidden = true;
      return;
    }
    startBtn.hidden = false;
    const players = info?.players ?? [];
    if (st === 'host') {
      const addrs = (info?.addresses ?? []).map((ip) => `<b class="mp-addr">http://${ip}:${info.port}</b>`).join(' ou ') || '<b>adresse introuvable</b>';
      mpPanel.innerHTML = `<div class="mp-box host">
        <div class="mp-status">● Serveur actif · écran du formateur</div>
        <p>Sur les PC des joueurs, ouvrir : ${addrs}<br><span class="muted small">puis onglet Multi → choisir son rôle → Rejoindre l'équipe.</span></p>
        <h4>Équipe (${players.length})</h4>${lobbyHTML(players)}
        <p class="muted small">Vous voyez tout le terrain et l'avancement ; vous ne jouez pas. Rôles libres (plusieurs médecins possible). Choisissez le scénario ci-dessous.</p></div>`;
      startBtn.textContent = players.length ? `Lancer la partie pour l'équipe (${players.length})` : 'En attente de joueurs…';
      startBtn.disabled = !players.length;
      return;
    }
    // joueur
    const g = info?.game;
    mpPanel.innerHTML = `<div class="mp-box">
      <div class="mp-status">● Connecté au serveur du formateur</div>
      ${mpS.joined
        ? `<p><b>Vous êtes dans l'équipe.</b> ${g ? 'Partie en cours : vous allez la rejoindre…' : 'En attente du lancement par le formateur…'}</p>`
        : `<p>Entrez votre nom, votre rôle et le code d'accès, puis rejoignez l'équipe.</p>`}
      <h4>Équipe (${players.length})</h4>${lobbyHTML(players)}</div>`;
    startBtn.textContent = mpS.joined ? 'En attente du formateur…' : 'Rejoindre l\'équipe';
    startBtn.disabled = mpS.joined;
  }
  async function mpPoll() {
    if (mode !== 'multi' || menu.hidden) return;
    // joueur inscrit : se signaler à chaque tour (sinon il serait retiré de l'équipe au lancement)
    const r = mpS.joined
      ? await mpJoin().then((j) => ({ ...mpS.info, players: j.players, game: j.game, gen: j.gen, hostOnline: j.hostOnline })).catch(() => null)
      : await fetch('/mp/info', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
    if (r) {
      if (new URLSearchParams(location.search).has('joueur')) r.host = false;
      mpS.info = r;
      if (mpS.joined && r.game && !r.players.some((p) => p.pid === myPid())) mpS.joined = false;   // retiré par le formateur
      if (mpS.joined && r.game && r.hostOnline !== false) return mpLaunchPlayer(r);
    }
    renderMp();
    mpS.poll = setTimeout(mpPoll, 1000);
  }
  async function mpEnter() {
    if (mpS.info === null && card.dataset.mp !== 'probing') {
      card.dataset.mp = 'probing';
      renderMp();
      mpS.info = await probeServer();
      if (mode !== 'multi') return;
      card.dataset.mp = mpS.info ? (mpS.info.host ? 'host' : 'player') : 'none';
      // écran du formateur revenu au menu : l'ancienne partie est close (les joueurs ne la rejoignent plus)
      if (mpS.info?.host && mpS.info.game) { await post('/mp/host/stop', {}).catch(() => {}); mpS.info.game = null; }
    }
    renderMp();
    clearTimeout(mpS.poll);
    if (mpS.info) mpS.poll = setTimeout(mpPoll, 1000);
  }
  function mpLeave() {
    clearTimeout(mpS.poll);
    mpPanel.hidden = true;
    startBtn.hidden = false;
    startBtn.disabled = false;
    delete card.dataset.mp;
    mpS.info = mpS.info ?? null;
  }
  mpHooks = { enter: mpEnter, leave: mpLeave };
  const mpJoin = () => post('/mp/join', { pid: myPid(), name: name.value.trim() || ROLES[mpRole.value].label, role: mpRole.value });
  mpRole.addEventListener('change', () => { store.set('smur.mp.role', mpRole.value); if (mpS.joined) mpJoin().catch(() => {}); });
  name.addEventListener('change', () => { if (mpS.joined) mpJoin().catch(() => {}); });
  function mpLaunchPlayer(info) {
    const g = info.game;
    clearTimeout(mpS.poll);
    finish({
      name: name.value.trim(), code: code.value,
      scenarioId: g.scenarioId, count: g.count, seed: g.seed, real: !!g.real,
      mp: { role: 'player', pid: myPid(), myRole: mpRole.value, gen: info.gen },
    });
  }

  menu.hidden = false;
  name.focus();
  if (mode === 'multi') mpEnter();

  const ambience = () => ({
    bubbles: opts.bubbles.checked,
    phones: opts.phones.checked,
    sound: opts.sound.checked,
    outside: opts.sound.checked && opts.outside.checked,
    cine: opts.cine.checked,
    music: opts.sound.checked && opts.music.checked,
    musicVol: Number(musicVol.value) / 100,
  });
  let finish = null;
  return new Promise((resolve) => {
    finish = (choice) => {
      store.set('smur.name', name.value.trim());
      store.set('smur.mode', mode);
      if (code.value) session.set('smur.code', code.value);
      for (const [k, box] of Object.entries(opts)) store.set(`smur.opt.${k}`, box.checked ? '1' : '0');
      optsBox.hidden = true;
      menu.hidden = true;
      clearTimeout(mpS.poll);
      $('menu-form').removeEventListener('submit', onSubmit);
      resolve({ ambience: ambience(), ...choice });
    };
    async function onSubmit(e) {
      e.preventDefault();
      const sc = current();
      if (mode === 'multi') {
        const st = card.dataset.mp;
        if (!code.value) { codeWrapMp.hidden = false; code.focus(); return; }
        if (st === 'player') {
          startBtn.disabled = true;
          try {
            const r = await mpJoin();
            mpS.joined = true;
            store.set('smur.mp.role', mpRole.value);
            if (r.game && r.hostOnline) return mpLaunchPlayer({ game: r.game, gen: r.gen });
          } catch (err) { startBtn.disabled = false; alert(`Impossible de rejoindre : ${err.message}`); return; }
          renderMp();
          return;
        }
        if (st === 'host' && sc) {
          const seed = Math.floor(Math.random() * 1e6);
          const count = Number(range.value);
          store.set(`smur.scenario.${mode}`, select.value);
          store.set(`smur.count.${sc.id}`, range.value);
          try {
            await post('/mp/host/start', { game: { scenarioId: sc.id, scenarioName: sc.name, count, seed, real: real.checked } });
          } catch (err) { alert(`Lancement impossible : ${err.message}`); return; }
          return finish({ name: name.value.trim(), code: code.value, scenarioId: sc.id, count, seed, real: real.checked, mp: { role: 'host' } });
        }
        return;
      }
      const g = parseGameNumber(game.value);
      if (game.value.trim() && (!g || game.classList.contains('invalid'))) { game.focus(); return; }
      store.set('smur.scenario', select.value);
      store.set(`smur.scenario.${mode}`, select.value);
      if (sc) store.set(`smur.count.${sc.id}`, range.value);
      finish({
        name: name.value.trim(),
        code: code.value,
        scenarioId: sc?.id ?? null,           // null = hasard total
        count: sc ? Number(range.value) : null,
        seed: g?.seed ?? null,
        real: real.checked,
      });
    }
    $('menu-form').addEventListener('submit', onSubmit);
  });
}
