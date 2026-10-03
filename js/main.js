// ============================================================
//  Point d'entrée : chargement → construction de l'état → boucle
// ============================================================

import { CONFIG, STATUS } from './config.js';
import { createRng } from './rng.js';
import { loadImage, fetchJSON, makeThumb, mapPool, placeholderCard, placeholderPlan } from './assets.js';
import { placeVictims } from './placement.js';
import { placeMPAP, makeExtraDead } from './mpap.js';
import { createVictim, createGameState, assignTriage, markSeen, logEvent } from './state.js';
import { updateSim } from './sim.js';
import { Camera } from './camera.js';
import { attachInput } from './input.js';
import { createRenderer, pickVictim } from './renderer.js';
import { createHud, formatTime } from './hud.js';
import { createModal } from './modal.js';
import { createDebrief } from './debrief.js';
import { initEvolution, applyCare, judgeTriage, expectedTriage } from './evolution.js';
import { threatCard } from './assets.js';
import { showMenu, gameNumber, victimRange } from './menu.js';
import { fillBriefing, showBriefing } from './briefing.js';
import { createSound } from './sound.js';
import { createAmbience } from './ambience.js';
import { createOutside } from './outside.js';
import { setupHelp } from './tuto.js';
import { createHistory } from './history.js';
import { createTeam } from './team.js';
import { createEvacuation } from './evacuation.js';
import { createRescuers } from './rescuers.js';
import { createSmurTeams } from './smurTeams.js';
import { createPompiers } from './pompiers.js';
import { createIntro } from './intro.js';
import { primeCinematic, playCinematic, musicCtl } from './cinematique.js';
import { createMusic } from './musique.js';
import { setReal, realizeVictim } from './realmode.js';
import { createHost, createPlayer, ROLES, drawLook } from './multi.js';
import { setupScrollHints } from './scrollhint.js';
import { drawZoneLight } from './orders.js';
import { selectVictims } from './selection.js';
import { scaledStock } from './stock.js';
import { unlock, openJSON, openImageURL } from './secure.js';
import { activeCorrections, applyCorrections } from './corrections.js';
import { findVoice } from './voice.js';
import { generatedCardURL } from './cardgen.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hudWidth = () => (document.getElementById('hud')?.offsetWidth ?? 540) + 24; // largeur du tableau de bord (2 colonnes), laissée libre au recadrage

async function boot() {
  const setProgress = (done, total, label) => {
    $('loading-bar').style.width = `${(100 * done) / total}%`;
    $('loading-text').textContent = label ?? `${done} / ${total} fiches`;
  };

  // 1. Scénarios disponibles (données publiques : plan, zones, briefing — rien de clinique)
  const index = await fetchJSON(CONFIG.scenariosIndex);
  const scenarios = await Promise.all(index.scenarios.map(async (s) => {
    const base = `${CONFIG.scenariosDir}${s.id}/`;
    const [desc, pub] = await Promise.all([fetchJSON(base + 'scenario.json'), fetchJSON(base + 'public.json')]);
    return { ...s, ...desc, base, public: pub };
  }));
  if (!scenarios.length) throw new Error('Aucun scénario : lancez outils/chiffrer.py');
  // mode MPAP : même scénario, présenté sur écran (sans chrono, compteurs ni déplacement)
  for (const s of [...scenarios]) {
    if (s.mpap === false) continue;
    scenarios.push({ ...s, id: `${s.id}-mpap`, dataId: s.id, code: `${s.code}M`, name: `${s.name} (MPAP)`, mpapOf: s.id,
      subtitle: 'MPAP : scène projetée, cliquer une carte au hasard, discuter des gestes, trier, envoyer au PMA. Sans chrono, sans compteurs, sans déplacement.' });
  }

  // 2. Menu : nom, scénario / hasard total, nombre de victimes, n° de partie, code
  const history = createHistory();
  $('menu-history').addEventListener('click', () => history.open());
  const choice = await showMenu(scenarios);
  const music = createMusic({ volume: choice.ambience.musicVol });
  // encore dans le clic « Lancer » : on prépare la vidéo et on débloque le son
  if (choice.ambience.cine) primeCinematic({ withMusic: choice.ambience.sound });
  $('loading').hidden = false;
  $('loading-text').textContent = 'Vérification…';

  // Hasard total : scénario et nombre de victimes tirés au sort (le n° de partie
  // obtenu permet ensuite de rejouer exactement la même partie)
  let scenario = scenarios.find((s) => s.id === choice.scenarioId);
  let count = choice.count;
  if (!scenario) {
    const pool = scenarios.filter((s) => !s.mpapOf);
    scenario = pool[Math.floor(Math.random() * pool.length)];
    const r = victimRange(scenario);
    const steps = Math.floor((r.max - r.min) / r.step);
    count = r.min + r.step * Math.floor(Math.random() * (steps + 1));
  }
  const zones = scenario.zones;
  const MPAP = !!scenario.mpapOf;
  const REAL = !!choice.real;            // mode réel : fiches sans constantes chiffrées
  setReal(REAL);
  // multijoueur : l'hôte (PC formateur) fait tourner la simulation, les joueurs la suivent
  const MP = choice.mp ?? null;
  const HOST = MP?.role === 'host';
  const PLAYER = MP?.role === 'player';
  if (MP) CONFIG.clock.pauseOnModal = false;   // le temps ne s'arrête pour personne

  // 3. Le code déverrouille la clé des fichiers ; sans elle, rien n'est lisible
  let access = null;
  try {
    access = await unlock(await fetchJSON(CONFIG.access.keysSrc), choice.code);
  } catch (err) {
    console.warn('Déverrouillage impossible :', err);
  }
  const authorized = !!access;

  const seed = choice.seed ?? CONFIG.seed ?? Math.floor(Math.random() * 1e6);
  const rng = createRng(seed);

  let entries;
  let profiles = {};
  if (authorized) {
    const sid = scenario.dataId ?? scenario.id;
    const manifest = await openJSON(access.key, `${scenario.base}victims.enc`, `${sid}/victims`);
    ({ profiles } = await openJSON(access.key, `${scenario.base}profiles.enc`, `${sid}/profiles`));
    // corrections faites dans l'éditeur (⚙ Options) : brouillon de ce navigateur, sinon version publiée
    const corr = await activeCorrections(access.key, scenario.base, sid);
    ({ victims: manifest.victims, profiles } = applyCorrections(manifest.victims, profiles, corr));
    // MPAP : toutes les fiches, plus une cinquantaine de décédés entassés à l'entrée
    if (MPAP) {
      entries = selectVictims(manifest.victims, manifest.victims.length, rng);
      const n = scenario.mpap?.extraDead ?? 50;
      const last = Math.max(...manifest.victims.map((v) => parseInt(v.id.replace(/\D/g, ''), 10) || 0));
      entries = entries.concat(makeExtraDead(n, rng, last + 1));
    } else entries = selectVictims(manifest.victims, count, rng);
  } else {
    // non autorisé : de simples identifiants, les données restent chiffrées
    entries = rng.shuffle(scenario.public.ids.slice()).slice(0, count).map((id) => ({ id }));
  }

  // 4. Plan du scénario (remplaçant schématique s'il est absent)
  let planImage;
  try {
    planImage = await loadImage(scenario.base + (scenario.plan ?? 'plan.jpg'));
  } catch {
    console.warn('Plan absent, utilisation du plan schématique.');
    planImage = placeholderPlan(zones);
  }
  const plan = { w: planImage.naturalWidth || planImage.width, h: planImage.naturalHeight || planImage.height };

  // 5. Verso commun (une seule miniature partagée par toutes les cartes)
  const cardBackSrc = scenario.cardBack ? scenario.base + scenario.cardBack : CONFIG.cardBackSrc;
  let backThumb = null;
  if (CONFIG.faceDownUntilSeen || !authorized) {
    try {
      backThumb = makeThumb(await loadImage(cardBackSrc), CONFIG.thumbWidth);
    } catch {
      console.warn('Verso introuvable : cartes affichées face visible.');
    }
  }

  // 6. Fiches : déchiffrées en mémoire (jamais écrites en clair).
  //    Sans autorisation, elles ne sont même pas téléchargées.
  let missing = 0;
  let visuals;
  let cardOpts = null;       // fiches générées : options pour les redessiner (gestes, vue de dos)
  let leurres = [];
  {
    // vos fiches vierges (images publiques, sans donnée clinique) : une par type de silhouette
    const asDataURL = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(url);
      const b = await r.blob();
      return new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
    };
    const templates = {}, dosImages = {};
    const tplDir = scenario.cards?.templatesDir ? scenario.base + scenario.cards.templatesDir : (CONFIG.cards?.templatesDir ?? 'img/fiches/');
    await Promise.all(['homme', 'femme', 'enfant', 'bebe'].map(async (n) => {
      try { templates[n] = await asDataURL(`${tplDir}modele-${n}.jpg`); } catch { console.warn(`Modèle de fiche absent : modele-${n}.jpg`); }
      try { dosImages[n] = await asDataURL(`${tplDir}dos-${n}.png`); } catch { /* vue de dos : silhouette absente */ }
    }));
    cardOpts = { title: scenario.cards?.title ?? CONFIG.cards?.title, templates, dosImages, labels: CONFIG.items, real: REAL };
  }
  if (!authorized) {
    // sans code : 2 ou 3 fiches LEURRES jouables (inventées, publiques), puis la menace
    try { leurres = (await fetchJSON('data/leurres.json')).leurres ?? []; } catch { leurres = []; }
    let threatSrc;
    try { await loadImage(CONFIG.access.threatSrc); threatSrc = CONFIG.access.threatSrc; }
    catch { threatSrc = threatCard().toDataURL('image/jpeg', 0.85); }
    const thumb = backThumb ?? makeThumb(threatCard(), CONFIG.thumbWidth);
    visuals = entries.map(() => ({ src: threatSrc, thumb }));
  } else {
    // mode réel : toujours des fiches générées (les PNG portent les chiffres imprimés)
    const mode = REAL ? 'generated' : scenario.cards?.mode ?? CONFIG.cards?.mode ?? 'generated';
    const generate = async (e) => {
      const src = generatedCardURL(e, cardOpts);
      return { src, thumb: makeThumb(await loadImage(src), CONFIG.thumbWidth), generated: true };
    };
    visuals = await mapPool(
      entries,
      CONFIG.loadConcurrency,
      async (e) => {
        try {
          if (mode === 'generated' && e.clinical) return await generate(e);
          const src = await openImageURL(access.key, `${scenario.base}cartes/${e.id}.enc`, `${scenario.id}/${e.id}`);
          const img = await loadImage(src);
          return { src, thumb: makeThumb(img, CONFIG.thumbWidth) };
        } catch {
          if (e.clinical && mode !== 'generated') { try { return await generate(e); } catch {} }   // PNG absente : fiche générée
          missing++;
          const ph = placeholderCard(e.id);
          return { src: ph.toDataURL('image/png'), thumb: makeThumb(ph, CONFIG.thumbWidth) };
        }
      },
      setProgress
    );
  }
  if (missing) console.warn(`${missing} fiche(s) introuvable(s), remplacées par des cartes provisoires.`);

  // 7. Taille des cartes au sol (proportions réelles de la 1re fiche)
  const aspect = visuals[0].thumb.height / visuals[0].thumb.width;
  const card = { w: plan.w * CONFIG.cardWidthRatio, h: plan.w * CONFIG.cardWidthRatio * aspect };

  // 8. Placement + état
  // pas de carte autour du PMA / de la sortie (trompeur avec l'icône PMA)
  const pxPerM = plan.w / (scenario.scale?.planWidthMeters ?? 50);
  const avoid = [scenario.evacuation?.pma, scenario.evacuation?.walkTo].filter(Boolean)
    .map((p) => ({ x: p[0] * plan.w, y: p[1] * plan.h, r: (scenario.evacuation.pmaClearMeters ?? 7) * pxPerM }));
  const placements = MPAP && authorized
    ? placeMPAP(entries, zones, plan, card, rng, scenario, avoid.map((a) => ({ ...a, r: (scenario.mpap?.pmaClearMeters ?? 4) * pxPerM })))
    : placeVictims(entries, zones, plan, card, CONFIG, rng, avoid);
  const zoneLabel = Object.fromEntries(zones.map((z) => [z.id, z.label]));
  const victims = entries.map((e, i) => {
    const v = createVictim(e, placements[i], { ...visuals[i], back: backThumb, ...card });
    if (visuals[i].generated) { v.entry = e; v.cardView = 'face'; v.cardSig = '0||face'; }
    v.sortY = placements[i].coverY ?? v.y;          // MPAP : carte cachée sous un corps
    v.hiddenUnder = !!placements[i].hidden;
    v.zoneLabel = zoneLabel[v.zone];
    const profile = profiles[e.profile] ?? { stages: [], actions: {} };
    if (authorized && !profiles[e.profile]) console.warn(`${e.id} : profil "${e.profile}" inconnu`);
    initEvolution(v, profile, e.actions);
    realizeVictim(v);
    return v;
  });
  // les cartes "devant" sont dessinées en dernier ; une carte cachée est dessinée juste avant son couvercle
  victims.sort((a, b) => (a.sortY - b.sortY) || ((b.hiddenUnder ? 1 : 0) - (a.hiddenUnder ? 1 : 0)));
  const stock = scaledStock(entries.length, scenario);
  const player = { name: choice.name, authorized, label: access?.label ?? null };
  const state = createGameState({ plan, zones, victims, stock, player });
  state.clock.running = false;           // démarre à l'engagement (fin du briefing)
  state.mpap = MPAP;
  state.real = REAL;
  if (MPAP) for (const k of Object.keys(state.inventory)) state.inventory[k] = Infinity;   // matériel illimité
  state.seed = seed;
  state.count = entries.length;
  const realCount = entries.filter((e) => !e.extra).length;
  state.scenario = { id: scenario.id, name: scenario.name, random: !choice.scenarioId };
  state.gameNumber = gameNumber(scenario, seed, realCount);
  state.startedAt = Date.now();
  state.gameId = `${state.gameNumber}@${state.startedAt}`;
  $('hud-seed').innerHTML = `${choice.name ? esc(choice.name) + '<br>' : ''}${esc(scenario.name)} · ${entries.length} victimes${realCount !== entries.length ? ` (dont ${entries.length - realCount} décédés ajoutés)` : ''}<br>Partie n° <b>${state.gameNumber}</b>`;
  $('hud-seed').title = 'Saisir ce numéro dans le menu (« N° de partie ») pour rejouer exactement cette partie';

  // 9. Affichage + interactions
  if (HOST) CONFIG.flashlight.darkness = Math.min(CONFIG.flashlight.darkness, 0.25);   // formateur : tout le terrain visible
  if (MPAP) {
    // scène projetée : moins de pénombre, pas de tableau de bord chiffré
    CONFIG.flashlight.darkness = Math.min(CONFIG.flashlight.darkness, scenario.mpap?.darkness ?? 0.3);
    document.body.classList.add('mpap');
    $('mpap-bar').hidden = false;
    $('mpap-title').textContent = scenario.name;
    if (cardOpts) cardOpts.noTimes = true;
  }
  const canvas = $('board');
  const camera = new Camera();
  const renderer = createRenderer(canvas, camera, CONFIG);
  renderer.resize();
  camera.fit(plan.w, plan.h, { rightReserve: MPAP ? 0 : hudWidth() });

  // Équipe SMUR (périmètre d'action) et évacuation vers le PMA
  const team = createTeam(state, scenario, plan);
  let amb = null; // créé plus loin (ambiance) ; alertes et annonces l'utilisent
  const evac = createEvacuation(state, scenario, plan, {
    onSupply: (tm) => amb?.say({ x: evac.pma.x, y: evac.pma.y, h: 40 }, `${tm.id} : matériel déposé (${Object.values(tm.items).reduce((a, q) => a + q, 0)} articles)`, 'alert', 6000),
  });
  state.team = team.team;
  if (PLAYER) { team.team.color = ROLES[MP.myRole]?.color; team.team.label = ROLES[MP.myRole]?.short ?? 'SMUR'; }
  let mpHost = null, mpPlayer = null, mpPending = null;
  const mpPendingKey = new Map();            // n° d'action → geste (pour afficher le résultat)
  const hostOnly = () => ({ ok: false, kind: 'impossible', message: 'Écran du formateur : observation seulement. Les joueurs agissent depuis leur poste.' });
  const mpSend = (msg, key = null) => { const rid = mpPlayer.send(msg); if (key) mpPendingKey.set(rid, key); return rid; };
  const SENT = { ok: true, message: '…' };
  if (PLAYER) for (const k of Object.keys(state.inventory)) state.inventory[k] = 0;   // le sac arrive du formateur
  state.evacSummary = evac.summary;
  const rescuers = createRescuers(state, scenario, {
    onAlert: (v) => amb?.alert(v, 'Docteur ! Elle s\'aggrave !'),
  });
  state.rescuerSummary = rescuers.summary;
  const smur = createSmurTeams(state, scenario, plan, { playerTeam: team, evac });
  // équipe de pompiers déjà sur place : bilans, gestes de secourisme, signalement des UA
  const pompiers = createPompiers(state, MPAP ? { ...scenario, pompiers: { enabled: false } } : scenario, plan, {
    playerTeam: team,
    onSignal: (v, tm) => amb?.alert(v, `${tm.id} : urgence absolue ici !`),
    onGive: (tm, got) => {
      const n = Object.values(got).reduce((a, q) => a + q, 0);
      amb?.say({ x: team.team.x, y: team.team.y, h: 40 }, n ? `${tm.id} : +${n} articles pour votre sac` : `${tm.id} : plus rien à donner`, 'alert', 5000);
      hud.update(state);
    },
  });

  const hud = createHud();
  const checkScroll = setupScrollHints();
  const debrief = createDebrief(state, { history });
  $('hud-debrief').addEventListener('click', () => debrief.open());
  const modal = createModal({
    // MPAP : état de la victime à T+n minutes (sans prise en charge ; un geste qui stabilise arrête l'évolution)
    onEvoAt: (v, min) => {
      v.status0 ??= v.status;
      const e = v.evo;
      const target = e.stages.filter((st) => st.atMs <= min * 60000).length;
      const stage = e.frozen ? Math.min(e.stage, target) : target;
      e.stage = stage;
      e.seenStage = stage;
      v.status = stage ? (STATUS[e.stages[stage - 1].status] ?? v.status0) : v.status0;
      v.mpapT = min;
      logEvent(state, 'mpap-evo', { id: v.id, min, stage });
      if (e.frozen && target > stage) return { message: 'Stabilisée par un geste : plus d\'aggravation.' };
      return { message: stage ? `T+${min} min : ${e.stages[stage - 1].text}` : (min ? `T+${min} min : pas d'aggravation à ce stade.` : 'État initial de la fiche.') };
    },
    onView: (v) => { v.cardView = v.cardView === 'dos' ? 'face' : 'dos'; logEvent(state, 'view', { id: v.id, view: v.cardView }); return refreshCard(v, true); },
    state,
    evac,
    rescuers,
    onRescuer: (id, what) => {
      if (HOST) return hostOnly();
      if (PLAYER) { mpSend({ t: 'rescuer', vid: id, what }, 'rescuer'); return SENT; }
      const v = state.byId.get(id);
      const res = what === 'free' ? rescuers.release(v) : rescuers.post(v);
      hud.update(state);
      return res;
    },
    onEvac: (id, mode) => {
      const v = state.byId.get(id);
      if (HOST) return hostOnly();
      if (PLAYER) { mpSend({ t: 'evac', vid: id, mode }, 'evac'); return SENT; }
      const res = mode === 'walk' ? evac.walk(v) : mode === 'cancel' ? evac.cancel(v) : mode === 'priority' ? evac.prioritize(v) : mode === 'pma' ? evac.sendToPMA(v) : evac.requestStretcher(v);
      hud.update(state);
      return res;
    },
    onTriage: (id, cat) => {
      if (HOST) return hostOnly();
      if (PLAYER) { const v = state.byId.get(id); if (v) v.assignedTriage = cat; mpSend({ t: 'triage', vid: id, cat }); return undefined; }
      return assignTriage(state, id, cat, judgeTriage, expectedTriage);
    },
    onCare: (id, action) => {
      if (HOST) return hostOnly();
      if (PLAYER) { mpSend({ t: 'care', vid: id, action }, action); return SENT; }
      const res = applyCare(state, state.byId.get(id), action);
      hud.update(state);
      return res;
    },
    onClose: () => {
      if (PLAYER) mpSend({ t: 'close' });
      if (CONFIG.clock.pauseOnModal && !MPAP) state.clock.running = true;
    },
    // Mode non autorisé : la carte retournée révèle une menace → mort
    onRevealed: (v) => {
      if (authorized || v?.decoy) return true;       // fiche leurre : jouable
      state.clock.running = false;
      state.over = true;
      setTimeout(() => { modal.close(); $('death').hidden = false; }, 900);
      return false;
    },
  });

  const mouse = attachInput(canvas, camera, CONFIG, {
    onGrab: MPAP ? (sx, sy) => {
      const [wx, wy] = camera.screenToWorld(sx, sy);
      const v = pickVictim(state, wx, wy);
      if (!v) return null;
      const i = state.victims.indexOf(v);            // la carte saisie passe au-dessus
      state.victims.splice(i, 1); state.victims.push(v);
      return { move: (dx, dy) => { v.x += dx / camera.zoom; v.y += dy / camera.zoom; } };
    } : null,
    onMove: (m, dragging) => {
      const [wx, wy] = camera.screenToWorld(m.x, m.y);
      const v = dragging ? null : pickVictim(state, wx, wy);
      state.ui.hoveredId = v?.id ?? null;
      state.ui.hoverNote = v && !MPAP && !team.inReach(v)
        ? `Hors de portée · ${Math.round(team.distMeters(v))} m (≈ ${Math.ceil(team.etaTo(v))} s de marche)`
        : null;
      canvas.classList.toggle('hovering', !!v);
      if (state.ui.debugZones) {
        $('debug-coords').textContent = `x ${(wx / plan.w).toFixed(3)}  y ${(wy / plan.h).toFixed(3)}  (clic = copier)`;
      }
    },
    onClick: (sx, sy) => {
      if (state.over || (!(PLAYER ? state.mpRunning : state.clock.running) && !MPAP && !HOST)) return;
      const [wx, wy] = camera.screenToWorld(sx, sy);
      if (state.ui.debugZones) {
        const txt = `[${(wx / plan.w).toFixed(3)}, ${(wy / plan.h).toFixed(3)}]`;
        navigator.clipboard?.writeText(txt).catch(() => {});
        console.log('Point du plan :', txt);
        return;
      }
      const v = pickVictim(state, wx, wy);
      // périmètre : on n'examine que les victimes à portée ; sinon l'équipe s'y rend
      if (MPAP) { if (v) examine(v); return; }      // MPAP : pas de déplacement
      if (HOST) { if (v) examine(v); return; }       // formateur : observe tout, sans se déplacer
      if (PLAYER) {
        const dp = depotPos();
        const [dsx, dsy] = camera.worldToScreen(dp.x, dp.y);
        if (!v && Math.hypot(sx - dsx, sy - dsy) < 24 && depotTotal() > 0) {
          if (Math.hypot(team.team.x - dp.x, team.team.y - dp.y) <= team.team.reach * 1.5) mpSend({ t: 'pickup' }, 'pickup');
          else { mpSend({ t: 'goto', x: dp.x, y: dp.y }); team.team.target = { x: dp.x, y: dp.y }; }
          return;
        }
        if (v && team.inReach(v)) { examine(v); return; }
        mpPending = v ?? null;
        mpPlayer.send(v ? { t: 'goto', x: v.x, y: v.y, vid: v.id } : { t: 'goto', x: wx, y: wy });
        team.team.target = { x: wx, y: wy, victim: v ?? null };
        return;
      }
      if (!v) { team.goTo(wx, wy); return; }
      if (team.inReach(v)) examine(v);
      else team.goTo(v.x, v.y, v);
    },
  });

  const decoyMax = CONFIG.access.decoys?.[0] + Math.floor(rng.next() * ((CONFIG.access.decoys?.[1] ?? 3) - (CONFIG.access.decoys?.[0] ?? 2) + 1)) || 0;
  let decoyUsed = 0;
  function makeDecoy(v) {
    const d = leurres[decoyUsed % leurres.length];
    decoyUsed++;
    v.decoy = true;
    v.clinical = d.clinical;
    v.truth = { triage: null, accept: [], limit: false, why: '', note: '', ...d.truth };
    v.entry = { id: v.id, clinical: d.clinical, injuries: d.injuries };
    initEvolution(v, { stages: [], actions: {}, ...d.profile });
    realizeVictim(v);
    v.cardView = 'face'; v.cardSig = '0||face';
    v.src = generatedCardURL(v.entry, cardOpts);
  }
  function examine(v) {
    team.stop();
    if (PLAYER) { mpPending = null; mpSend({ t: 'stop' }); mpSend({ t: 'look', vid: v.id }); }
    if (!authorized && v.seenAt == null && !v.decoy && decoyUsed < decoyMax && leurres.length && cardOpts) makeDecoy(v);
    const firstLook = (v.seenAt == null && !!v.back) || (!authorized && !v.decoy) || (v.decoy && v.seenAt == null);
    markSeen(state, v.id);
    if (CONFIG.clock.pauseOnModal) state.clock.running = false;
    modal.open(v, firstLook ? cardBackSrc : null); // retournement au 1er examen
  }
  team.onArrive = (v) => { if (!modal.isOpen() && !state.over) examine(v); };

  // ---------- multijoueur ----------
  const mpStart = scenario.team?.start ?? [0.5, 0.9];
  const depotPos = () => ({ x: mpStart[0] * plan.w + 40, y: mpStart[1] * plan.h });     // matériel des renforts : à l'entrée
  let depotRemote = {};
  const depotInv = () => (HOST ? state.inventory : depotRemote);
  const depotTotal = () => Object.values(depotInv()).reduce((s, q) => s + (Number.isFinite(q) ? q : 0), 0);
  const TRI = { RED: 'UA', YELLOW: 'UR', GREEN: 'Impliqué', BLACK: 'UD' };
  const itemShort = (k) => CONFIG.items[k]?.short ?? k;
  const mpFeed = [];
  const escH = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtT = (ms) => formatTime(ms ?? 0);
  if (HOST || PLAYER) {
    const panel = document.createElement('div');
    panel.className = 'mp-hud';
    document.body.appendChild(panel);
    const banner = document.createElement('div');
    banner.className = 'mp-banner'; banner.hidden = true;
    document.body.appendChild(banner);
    const toastEl = document.createElement('div');
    toastEl.className = 'mp-toast'; toastEl.hidden = true;
    document.body.appendChild(toastEl);
    let toastTimer = null;
    const toast = (txt, warn = false) => {
      toastEl.textContent = txt; toastEl.hidden = false; toastEl.classList.toggle('warn', warn);
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
    };
    const badge = (role) => { const r = ROLES[role] ?? ROLES.med; return `<span class="mp-badge" style="background:${r.color}">${r.short}</span>`; };
    const feedHTML = (list) => list.slice(-10).reverse().map((e) => `<li><span class="mp-t">${fmtT(e.t)}</span>${badge(e.role)}<b>${escH(e.name)}</b> ${escH(e.text)}</li>`).join('');
    const bagTxt = (inv) => Object.entries(inv ?? {}).filter(([, q]) => q > 0).map(([k, q]) => `${itemShort(k)} ${q}`).join(' · ') || 'sac vide';

    if (HOST) {
      if ($('hud-inventory')) $('hud-inventory').previousElementSibling.textContent = 'Dépôt (entrée) : renforts logistiques';
      const feed = (a, text, vid = null) => {
        const e = { t: state.clock.elapsedMs, pid: a.pid, name: a.name, role: a.role, text };
        mpFeed.push(e); mpFeed.splice(0, Math.max(0, mpFeed.length - 60));
        logEvent(state, 'mp', { pid: a.pid, name: a.name, role: a.role, text, id: vid });
      };
      const near = (a, b, m) => Math.hypot(a.t.team.x - b.t.team.x, a.t.team.y - b.t.team.y) <= m * pxPerM;
      const applyInput = (a, msg) => {
        const v = msg.vid ? state.byId.get(msg.vid) : null;
        switch (msg.t) {
          case 'look': {
            if (!v) return null;
            const first = v.seenAt == null;
            markSeen(state, v.id);
            v.seenBy ??= a.name;
            for (const x of state.victims) if (x.mpLook === a.pid) delete x.mpLook;
            v.mpLook = a.pid;
            a.stats.seen.add(v.id);
            a.doing = `fiche ${v.id}`;
            if (first) feed(a, `retourne la fiche ${v.id}`, v.id);
            return null;
          }
          case 'ready':
            if (!a.ready) { a.ready = true; feed(a, 'a lu le briefing : prêt'); }
            return null;
          case 'close':
            for (const x of state.victims) if (x.mpLook === a.pid) delete x.mpLook;
            a.doing = null;
            return null;
          case 'triage': {
            if (!v || !TRI[msg.cat]) return null;
            const prev = v.assignedTriage, prevWho = v.triageHistory.at(-1)?.who;
            assignTriage(state, v.id, msg.cat, judgeTriage, expectedTriage);
            const h = v.triageHistory.at(-1);
            if (h) { h.pid = a.pid; h.who = a.name; }
            v.triagedByPid = a.pid;
            a.stats.triage++;
            feed(a, `trie ${v.id} → ${TRI[msg.cat]}${prev && prev !== msg.cat ? ` (était ${TRI[prev]}${prevWho && prevWho !== a.name ? ` par ${prevWho}` : ''})` : ''}`, v.id);
            return null;
          }
          case 'care': {
            if (!v || !CONFIG.items[msg.action]) return null;
            if (msg.action === 'needle' && a.role !== 'med') { a.stats.refused++; return { ok: false, kind: 'impossible', message: "Exsufflation : geste réservé au médecin." }; }
            const saved = state.inventory;
            state.inventory = a.inv;               // le geste puise dans le sac de ce joueur
            let res;
            try { res = applyCare(state, v, msg.action); } finally { state.inventory = saved; }
            if (res?.ok !== false) {
              const last = v.careLog.at(-1);
              if (last) last.who = a.name;
              a.stats.care++;
              feed(a, `${itemShort(msg.action).toLowerCase()} sur ${v.id}`, v.id);
            }
            return res;
          }
          case 'evac': {
            if (!v) return null;
            const m = msg.mode;
            const res = m === 'walk' ? evac.walk(v) : m === 'cancel' ? evac.cancel(v) : m === 'priority' ? evac.prioritize(v) : m === 'pma' ? evac.sendToPMA(v) : evac.requestStretcher(v);
            if (res?.ok !== false) feed(a, { walk: `envoie ${v.id} à pied`, cancel: `annule l'évacuation de ${v.id}`, priority: `${v.id} prioritaire`, pma: `${v.id} au PMA` }[m] ?? `demande un brancard pour ${v.id}`, v.id);
            return res;
          }
          case 'rescuer': {
            if (!v) return null;
            const res = msg.what === 'free' ? rescuers.release(v) : rescuers.post(v);
            if (res?.ok) feed(a, msg.what === 'free' ? `libère le secouriste de ${v.id}` : `poste un secouriste auprès de ${v.id}`, v.id);
            return res;
          }
          case 'give': {
            const b = mpHost.avatars.get(msg.to);
            const k = msg.item;
            if (!b || !CONFIG.items[k]) return { ok: false, message: 'Destinataire inconnu.' };
            if (!near(a, b, 5)) return { ok: false, message: `${b.name} est trop loin (à moins de 5 m pour donner du matériel).` };
            if (!((a.inv[k] ?? 0) > 0)) return { ok: false, message: `Plus de ${itemShort(k).toLowerCase()} dans votre sac.` };
            a.inv[k]--; b.inv[k] = (b.inv[k] ?? 0) + 1;
            a.stats.given++;
            b.results.push([`gift-${a.pid}-${state.clock.elapsedMs}-${k}`, { ok: true, gift: true, message: `${a.name} vous donne 1 ${CONFIG.items[k].label.toLowerCase()}.` }]);
            feed(a, `donne 1 ${itemShort(k).toLowerCase()} à ${b.name}`);
            return { ok: true, message: `1 ${CONFIG.items[k].label.toLowerCase()} donné à ${b.name}.` };
          }
          case 'pickup': {
            const dp = depotPos();
            if (Math.hypot(a.t.team.x - dp.x, a.t.team.y - dp.y) > a.t.team.reach * 1.6) return { ok: false, message: 'Trop loin du dépôt.' };
            let n = 0;
            for (const [k, q] of Object.entries(state.inventory)) {
              if (!(q > 0) || !Number.isFinite(q)) continue;
              a.inv[k] = (a.inv[k] ?? 0) + q; n += q; state.inventory[k] = 0;
            }
            if (!n) return { ok: false, message: 'Dépôt vide.' };
            feed(a, `récupère ${n} articles au dépôt`);
            return { ok: true, message: `${n} articles ajoutés à votre sac.` };
          }
          case 'cmd': {
            if (msg.mod === 'sp' || msg.mod === 'smur') {
              const tm = (msg.mod === 'sp' ? pompiers.teams : smur.teams).find((t) => t.id === msg.id);
              if (!tm) return null;
              tm.setSector(msg.z);
              const z = (scenario.zones ?? []).find((x) => x.id === msg.z);
              feed(a, `ordre à ${tm.id} : ${z ? z.label : 'autonome'}`);
              return null;
            }
            if (msg.mod === 'sp-give') {
              const tm = pompiers.teams.find((t) => t.id === msg.id);
              if (!tm) return null;
              const got = tm.giveTo(a.inv);
              const n = Object.values(got).reduce((x, q) => x + q, 0);
              feed(a, n ? `reçoit ${n} articles de ${tm.id}` : `${tm.id} n'a plus rien à donner`);
              return { ok: !!n, message: n ? `${tm.id} : +${n} articles dans votre sac.` : `${tm.id} : plus rien à donner.` };
            }
            return null;
          }
          default: return null;
        }
      };
      mpHost = createHost({
        state,
        makeTeam: () => createTeam(state, scenario, plan),
        applyInput,
        extra: (codec) => ({
          depot: state.inventory,
          feed: mpFeed.slice(-12),
          evacTeams: (state.evac?.teams ?? []).map((t) => codec.enc(t)),
          evacQueue: (state.evac?.queue ?? []).map((v) => v.id),
          sp: pompiers.teams.map((t) => ({ ...codec.enc(t), elText: t.el?.textContent ?? '' })),
          smur: smur.teams.map((t) => ({ ...codec.enc(t), elText: t.el?.textContent ?? '' })),
          resc: (state.rescuers ?? []).map((r) => codec.enc(r)),
          logi: state.logistics.map((l) => ({ arrived: !!l.arrived, smurSpawned: !!l.smurSpawned })),
        }),
        onPlayers: (list) => {
          panel.innerHTML = `<h4>Équipe sur le terrain (${list.length})</h4><ul class="mp-list">${list.map((a) => `<li>${badge(a.role)}<b>${escH(a.name)}</b>${a.age > 6 ? ' <span class="mp-lost">déconnecté</span>' : ''}${a.doing ? ` <span class="mp-doing">${escH(a.doing)}</span>` : ''}<span class="mp-m">${Math.round(a.t.team.walkedM)} m</span></li><li class="mp-bag">${escH(bagTxt(a.inv))}</li>`).join('') || '<li class="muted">Aucun joueur</li>'}</ul>
            <h4>En direct</h4><ul class="mp-feed">${feedHTML(mpFeed) || '<li class="muted">—</li>'}</ul>`;
          banner.hidden = mpHost.online;
          banner.textContent = 'Serveur injoignable : la fenêtre du serveur est-elle encore ouverte ?';
        },
      });
      // répartition des sacs au top départ : à parts égales, exsufflation au(x) médecin(s)
      mpHost.splitBags = () => {
        const list = [...mpHost.avatars.values()].filter((a) => !(a.age > 6));
        if (!list.length) return;
        for (const [k, q] of Object.entries(state.inventory)) {
          if (!Number.isFinite(q) || q <= 0) continue;
          let order = list;
          if (k === 'needle') order = list.filter((a) => a.role === 'med');
          else if (k === 'oxygen') order = [...list.filter((a) => a.role !== 'med'), ...list.filter((a) => a.role === 'med')];
          if (!order.length) continue;
          for (let i = 0; i < q; i++) { const a = order[i % order.length]; a.inv[k] = (a.inv[k] ?? 0) + 1; }
          state.inventory[k] = 0;
        }
        logEvent(state, 'mp-bags', { bags: list.map((a) => ({ name: a.name, inv: { ...a.inv } })) });
      };
      state.mpTeam = () => [...mpHost.avatars.values()].map((a) => ({ name: a.name, role: a.role, seen: a.stats.seen.size, triage: a.stats.triage, care: a.stats.care, given: a.stats.given, refused: a.stats.refused, m: Math.round(a.t.team.walkedM) }));
      mpHost.start();
      addEventListener('pagehide', () => navigator.sendBeacon?.('/mp/host/stop', '{}'));
    } else {
      let giftOpen = null, lastPanel = 0, endShown = false;
      const inv0 = Object.keys(state.inventory);
      mpPlayer = createPlayer({
        pid: MP.pid, state, team,
        onVictims: () => { hud.update(state); },
        onResult: (rid, res) => {
          if (res.ok && !res.message) return;
          const key = mpPendingKey.get(rid);
          mpPendingKey.delete(rid);
          if (modal.isOpen() && key && !res.gift) modal.toast(res, key);
          else toast(res.message ?? (res.ok === false ? 'Impossible.' : 'Fait.'), res.ok === false);
          hud.update(state);
        },
        onState: (s, me, others, info) => {
          const codec = info.codec;
          // sac personnel, dépôt, équipes, brancardage, secouristes
          const inv = {};
          for (const k of inv0) inv[k] = me?.inv?.[k] ?? 0;
          state.inventory = inv;
          depotRemote = s.depot ?? {};
          (s.evacTeams ?? []).forEach((d, i) => { const tm = state.evac?.teams?.[i]; if (tm) Object.assign(tm, codec.dec(d)); });
          if (s.evacQueue && state.evac) state.evac.queue.splice(0, state.evac.queue.length, ...s.evacQueue.map((id) => state.byId.get(id)).filter(Boolean));
          const mirror = (tm, d) => {
            const { elText, ...rest } = d;
            Object.assign(tm, codec.dec(rest));
            if (tm.el) tm.el.textContent = elText;
            if (tm.picker && tm.picker.get() !== (tm.sector ?? '')) tm.picker.set(tm.sector ?? '');
            tm.refreshGive?.();
          };
          (s.sp ?? []).forEach((d) => { const tm = pompiers.teams.find((t) => t.id === d.id); if (tm) mirror(tm, d); });
          (s.smur ?? []).forEach((d) => mirror(smur.ensure(d.id, d.from), d));
          (s.resc ?? []).forEach((d, i) => { if (state.rescuers?.[i]) Object.assign(state.rescuers[i], codec.dec(d)); });
          (s.logi ?? []).forEach((d, i) => { if (state.logistics[i]) Object.assign(state.logistics[i], d); });
          if (s.over && !endShown) {
            endShown = true; state.over = true;
            if (modal.isOpen()) modal.close();
            banner.hidden = false; banner.textContent = 'Partie terminée : bilan sur l\'écran du formateur (touche B pour votre bilan).';
          }
          if (mpPending && team.inReach(mpPending) && !modal.isOpen()) examine(mpPending);
          // panneau équipe (2 fois par seconde : les boutons restent cliquables)
          const now = performance.now();
          if (now - lastPanel > 500) {
            lastPanel = now;
            const dist = (a) => (me ? Math.hypot(a.x - me.x, a.y - me.y) / pxPerM : 99);
            const myBag = Object.entries(state.inventory).filter(([, q]) => q > 0);
            panel.innerHTML = `<h4>Votre équipe</h4><ul class="mp-list">
              ${me ? `<li>${badge(me.role)}<b>${escH(me.name)}</b> <span class="muted">(vous)</span><span class="mp-m">${me.m} m</span></li>` : ''}
              ${others.map((a) => {
                const ok = dist(a) <= 5 && !a.lost;
                return `<li>${badge(a.role)}<b>${escH(a.name)}</b>${a.lost ? ' <span class="mp-lost">déconnecté</span>' : a.doing ? ` <span class="mp-doing">${escH(a.doing)}</span>` : ''}<span class="mp-m">${Math.round(dist(a))} m</span>
                  <button type="button" class="mp-gift" data-gift="${a.pid}" ${ok && myBag.length ? '' : 'disabled'} title="${ok ? 'Donner du matériel' : 'À moins de 5 m pour donner du matériel'}">🎁</button></li>
                  ${giftOpen === a.pid && ok ? `<li class="mp-giftlist">${myBag.map(([k, q]) => `<button type="button" data-give="${k}" data-to="${a.pid}">${escH(itemShort(k))} <b>×${q}</b></button>`).join('')}</li>` : ''}`;
              }).join('')}</ul>
              ${depotTotal() ? `<p class="mp-depot">📦 Dépôt à l'entrée : ${depotTotal()} articles (cliquer le dépôt sur le plan)</p>` : ''}
              <h4>En direct</h4><ul class="mp-feed">${feedHTML(s.feed ?? []) || '<li class="muted">—</li>'}</ul>`;
          }
          if (!info.hostOnline) { banner.hidden = false; banner.textContent = 'Écran du formateur fermé : la partie est en attente.'; }
          else if (info.gen) { banner.hidden = false; banner.textContent = 'Le formateur a lancé une nouvelle partie : revenez au menu (Menu → Multi).'; }
          else if (!endShown) banner.hidden = true;
        },
        onLost: (l) => { banner.hidden = !l; banner.textContent = 'Connexion au serveur perdue… reconnexion en cours'; },
      });
      // boutons du panneau (pointerdown : le panneau se redessine souvent)
      panel.addEventListener('pointerdown', (e) => {
        const g = e.target.closest('[data-gift]');
        if (g && !g.disabled) { giftOpen = giftOpen === g.dataset.gift ? null : g.dataset.gift; lastPanel = 0; return; }
        const b = e.target.closest('[data-give]');
        if (b) { mpSend({ t: 'give', to: b.dataset.to, item: b.dataset.give }, 'give'); }
      });
      state.mpRoute = (msg) => { mpSend(msg, msg.mod === 'sp-give' ? 'give' : null); };
      mpPlayer.start();
    }
  }

  if (authorized) window.sim = { state, camera, modal, debrief, team, evac, rescuers, smur, pompiers, examine, get mpHost() { return mpHost; }, get mpPlayer() { return mpPlayer; } }; // accès console (formateur / tests)
  else $('hud-debrief').hidden = true;

  // Retour au menu (tous modes), avec confirmation
  const quit = $('quit-confirm');
  document.querySelectorAll('.menu-back').forEach((b) => b.addEventListener('click', () => { quit.hidden = false; $('quit-no').focus(); }));
  $('quit-no').addEventListener('click', () => { quit.hidden = true; });
  $('quit-yes').addEventListener('click', () => newGame());
  quit.addEventListener('click', (e) => { if (e.target === quit) quit.hidden = true; });
  addEventListener('keydown', (e) => { if (!quit.hidden && e.key === 'Escape') { e.stopImmediatePropagation(); quit.hidden = true; } }, true);
  $('mpap-fit').addEventListener('click', () => camera.fit(plan.w, plan.h, { rightReserve: MPAP ? 0 : hudWidth() }));
  $('mpap-debrief').addEventListener('click', () => debrief.open());

  addEventListener('resize', () => {
    renderer.resize();
    camera.clamp();
  });
  addEventListener('keydown', (e) => {
    if ((e.key === 'h' || e.key === 'H') && !state.over && !debrief.isOpen() && $('briefing').hidden) {
      help.isOpen() ? help.close() : help.open();
      return;
    }
    if (modal.isOpen() || debrief.isOpen() || help.isOpen() || history.isOpen() || state.over || !$('briefing').hidden) return;
    if ((e.key === 'b' || e.key === 'B') && authorized) debrief.open();
    if (e.key === 'c' || e.key === 'C') { camera.x = team.team.x; camera.y = team.team.y; camera.clamp(); }
    // N : nouvelle partie avec une nouvelle disposition
    if (e.key === 'n' || e.key === 'N') newGame();
    if (e.key === 'f' || e.key === 'F') camera.fit(plan.w, plan.h, { rightReserve: MPAP ? 0 : hudWidth() });
    if (e.key === 'd' || e.key === 'D') {
      state.ui.debugZones = !state.ui.debugZones;
      $('debug-coords').hidden = !state.ui.debugZones;
    }
  });

  const help = setupHelp();
  $('death-menu').addEventListener('click', newGame);
  $('debrief-new').addEventListener('click', newGame);

  // Ambiance : bulles et téléphones (options du menu)
  const sound = createSound();
  if (authorized) window.sim.sound = sound;
  // téléphones : sonnerie seulement si les sons sont activés
  amb = createAmbience(state, camera, sound, { ...choice.ambience, sound: choice.ambience.sound && choice.ambience.phones, mouse });
  if (authorized) window.sim.amb = amb;
  // sirènes avant chaque arrivée (équipes de brancardage, VL LOG avec SMUR) + radio
  const arrivals = [
    ...[...new Set((scenario.evacuation?.teams ?? []).map((g) => g.atMin))].map((m) => ({ atMs: m * 60000 })),
    ...state.logistics.map((l) => ({ atMs: l.atMin * 60000 })),
  ];
  const outside = choice.ambience.outside ? createOutside(state, sound, arrivals) : null;
  renderer.addOverlay((ctx) => evac.draw(ctx, camera));
  if (evac.cri?.separate) $('evac-walk').textContent = `🚶 À pied vers le ${evac.cri.label.toLowerCase()}`;
  renderer.addOverlay((ctx) => rescuers.draw(ctx, camera));
  renderer.addOverlay((ctx) => smur.draw(ctx, camera));
  renderer.addOverlay((ctx) => pompiers.draw(ctx, camera));
  renderer.addOverlay((ctx) => drawZoneLight(ctx, camera, scenario, plan, performance.now() / 1000));
  // voix enregistrées (sons/voix/), sinon synthèse vocale
  const voiceId = scenario.dataId ?? scenario.id;
  const [briefVoice, callVoice] = await Promise.all([findVoice('briefing', voiceId), findVoice('appel', voiceId)]);
  // animation d'arrivée : appel des valides
  const intro = createIntro(state, scenario, plan, {
    voiceUrl: callVoice,
    team, pma: evac.pma, cri: evac.cri, camera, amb, backImage: backThumb, count: entries.length,
    voice: choice.ambience.sound,
  });
  if (authorized) window.sim.intro = intro;
  renderer.addOverlay((ctx) => intro.draw(ctx));
  if (!MPAP && !HOST) renderer.addOverlay((ctx) => team.draw(ctx, camera, performance.now()));
  if (HOST || PLAYER) {
    renderer.addOverlay((ctx) => {
      const now = performance.now();
      // fiche en cours de lecture : anneau à la couleur du rôle
      const roleOf = (pid) => (HOST ? mpHost.avatars.get(pid)?.role : (mpPlayer.others.find((a) => a.pid === pid) ?? mpPlayer.me)?.role);
      for (const v of state.victims) if (v.mpLook && v.mpLook !== MP.pid) drawLook(ctx, camera, v, roleOf(v.mpLook), now);
      // dépôt du matériel des renforts (entrée)
      const n = depotTotal();
      if (n > 0) {
        const dp = depotPos();
        const [x, y] = camera.worldToScreen(dp.x, dp.y);
        ctx.save();
        ctx.fillStyle = '#8d6e3f'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.fillRect(x - 13, y - 11, 26, 22); ctx.strokeRect(x - 13, y - 11, 26, 22);
        ctx.beginPath(); ctx.moveTo(x - 13, y - 3); ctx.lineTo(x + 13, y - 3); ctx.stroke();
        ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe0a3';
        ctx.fillText(`Dépôt · ${n}`, x, y + 26);
        ctx.restore();
      }
    });
  }
  if (HOST) renderer.addOverlay((ctx) => mpHost.draw(ctx, camera, performance.now()));
  if (PLAYER) renderer.addOverlay((ctx) => mpPlayer.draw(ctx, camera, performance.now()));
  renderer.addOverlay((ctx) => amb.draw(ctx));
  addEventListener('keydown', (e) => {
    if ((e.key === 'm' || e.key === 'M') && !e.target.closest?.('input')) { sound.setMuted(!sound.muted); music.setMuted(sound.muted); }
  });

  // 10. Boucle principale
  $('loading').remove();
  let last = performance.now();
  let hudTimer = 0;
  let mpIntroStarted = false;
  function frame(now) {
    const dt = Math.min(100, now - last); // onglet en veille : pas de saut géant
    last = now;
    updateSim(state, dt);
    if (state.over && music.playing) music.stop(4);   // fin de partie : fondu de sortie
    if (PLAYER) {
      mpPlayer.update(dt);                       // l'état vient de l'écran du formateur
      if (state.mpRunning && !mpIntroStarted) { mpIntroStarted = true; intro.start(); }
    } else {
      if (state.clock.running && !HOST) team.update(dt * CONFIG.clock.timeScale);
      if (HOST) mpHost.update(dt * CONFIG.clock.timeScale);
      evac.update();
      if (state.clock.running) rescuers.update();
      smur.update(dt * CONFIG.clock.timeScale);
      pompiers.update(dt * CONFIG.clock.timeScale);
    }
    intro.update(dt);
    amb.update(dt);
    outside?.update();
    renderer.render(state, planImage, mouse, now / 1000, dt / 1000);
    if ((hudTimer += dt) > 200) { hud.update(state); modal.tick(); refreshCards(); checkEnd(); checkScroll(); hudTimer = 0; }
    requestAnimationFrame(frame);
  }
  // Fiches générées : la carte montre les gestes réalisés et la vue choisie (face / dos)
  async function refreshCard(v, force = false) {
    if (!v.entry || !cardOpts) return;
    const sig = `${v.careLog.length}|${v.position ?? ''}|${v.cardView}`;
    if (!force && sig === v.cardSig) return;
    v.cardSig = sig;
    const old = v.src;
    const src = generatedCardURL(v.entry, { ...cardOpts, view: v.cardView, care: v.careLog, position: v.position });
    const img = await loadImage(src);
    v.src = src;
    if (v.cardView === 'face') v.thumb = makeThumb(img, CONFIG.thumbWidth);   // la carte au sol montre aussi les gestes
    modal.updateImage(v);
    setTimeout(() => URL.revokeObjectURL(old), 2000);
  }
  function refreshCards() { for (const v of state.victims) if (v.entry && `${v.careLog.length}|${v.position ?? ''}|${v.cardView}` !== v.cardSig) refreshCard(v); }

  // Fin automatique : toutes les victimes sont au PMA, décédées ou UD sur place
  function checkEnd() {
    if (!authorized || state.over || !state.clock.running) return;
    const left = state.victims.filter((v) => v.evac?.state !== 'pma' && v.status !== 'DEAD');
    const done = left.every((v) => (v.evac?.state ?? 'none') === 'none' && (v.assignedTriage === 'BLACK' || expectedTriage(v) === 'BLACK'));
    if (!done || !state.victims.some((v) => v.evac?.state === 'pma')) return;
    state.over = true;
    state.clock.running = false;
    state.endReason = left.length
      ? `Toutes les victimes ont été évacuées vers le PMA ; il ne reste sur place que des décédés et des urgences dépassées (${left.length}).`
      : 'Toutes les victimes ont été évacuées vers le PMA ou sont décédées.';
    logEvent(state, 'end', { reason: 'evacuated', left: left.length });
    if (modal.isOpen()) modal.close();
    amb.stopAll();
    const ban = $('end-banner');
    ban.querySelector('p').textContent = state.endReason;
    ban.hidden = false;
    setTimeout(() => { ban.hidden = true; debrief.open(); }, 3500);
  }

  hud.update(state);
  requestAnimationFrame(frame);

  // 11. Briefing du scénario (le plan est déjà visible en fond), puis top chrono
  const cine = choice.ambience.cine ? await playCinematic() : false;
  // multijoueur : le départ n'est donné que lorsque chaque joueur a lu le briefing
  let mpWait = null;
  if (HOST) {
    const go = $('briefing-go');
    const info = document.createElement('div');
    info.className = 'mp-ready';
    go.closest('.briefing-actions').after(info);
    let armed = false, forced = false;
    const team = () => [...mpHost.avatars.values()].filter((a) => !(a.age > 6));
    const allReady = () => team().length > 0 && team().every((a) => a.ready);
    go.textContent = 'Donner le départ ▸';
    go.addEventListener('click', (e) => {
      if (forced || allReady()) return;
      e.stopImmediatePropagation(); e.preventDefault();
      armed = true;
    }, true);
    const tick = () => {
      const t = team(), ok = t.filter((a) => a.ready);
      const waiting = t.filter((a) => !a.ready).map((a) => escH(a.name)).join(', ');
      info.innerHTML = `<b>Joueurs prêts : ${ok.length}/${t.length}</b>${waiting ? ` · encore au briefing : ${waiting}` : ''}
        ${armed && !allReady() ? '<br>Départ automatique dès que tous sont prêts…' : ''}
        ${!allReady() ? ' <button type="button" class="mp-force">Démarrer sans attendre</button>' : ''}`;
      info.querySelector('.mp-force')?.addEventListener('click', () => { forced = true; go.click(); });
      if (armed && allReady()) { forced = true; go.click(); return; }
      mpWait = setTimeout(tick, 400);
    };
    tick();
  }
  await showBriefing(fillBriefing(scenario, { count: entries.length, stock, player }), {
    voiceUrl: briefVoice,
    paper: cine,              // après la vidéo : le briefing s'écrit sur la feuille du fax
    music: musicCtl,
    onEngage: () => {
      if (choice.ambience.sound && (choice.ambience.phones || choice.ambience.outside)) sound.unlock();
      if (choice.ambience.music && !MPAP) music.unlock();
    },
  });
  clearTimeout(mpWait);
  document.querySelector('.mp-ready')?.remove();
  if (PLAYER) {
    // prêt : on attend le départ donné par le formateur
    mpSend({ t: 'ready' });
    if (!state.mpRunning) {
      const w = document.createElement('div');
      w.className = 'mp-waiting';
      document.body.appendChild(w);
      await new Promise((resolve) => {
        const tick = () => {
          if (state.mpRunning) { w.remove(); return resolve(); }
          const t = [mpPlayer.me, ...mpPlayer.others].filter(Boolean);
          const ok = t.filter((a) => a.ready);
          w.innerHTML = `<div><b>Vous êtes prêt.</b><br>En attente des autres joueurs et du départ donné par le formateur…<br><span>${ok.length}/${t.length} prêts${t.filter((a) => !a.ready).length ? ` · encore au briefing : ${t.filter((a) => !a.ready).map((a) => escH(a.name)).join(', ')}` : ''}</span></div>`;
          setTimeout(tick, 300);
        };
        tick();
      });
    }
  }
  if (HOST) mpHost.splitBags();
  state.clock.running = !MPAP && !PLAYER;  // MPAP : le temps ne passe pas ; joueur réseau : temps de l'hôte
  logEvent(state, 'start', { scenario: scenario.id, real: REAL, mp: MP?.role ?? null });
  if (!MPAP && !PLAYER) intro.start();
  // musique d'ambiance : après le fondu de la musique de la vidéo
  if (choice.ambience.music && !MPAP) setTimeout(() => { if (!state.over) music.start(scenario.dataId ?? scenario.id, 6); }, 1200);
}

// Nouvelle partie = retour au menu (nouvelle disposition)
function newGame() {
  location.href = location.pathname;
}

boot().catch((err) => {
  console.error(err);
  document.querySelector('.cine')?.remove();     // ne pas masquer le message d'erreur
  $('menu').hidden = true;
  $('loading').hidden = false;
  const hint = location.protocol === 'file:'
    ? 'Le jeu doit être servi par un serveur local (voir README) : ouvrir index.html directement ne fonctionne pas.'
    : err.message;
  $('loading-text').textContent = hint;
});
