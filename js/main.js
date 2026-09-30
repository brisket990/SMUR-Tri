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
import { createHud } from './hud.js';
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
import { setupScrollHints } from './scrollhint.js';
import { drawZoneLight } from './orders.js';
import { selectVictims } from './selection.js';
import { scaledStock } from './stock.js';
import { unlock, openJSON, openImageURL } from './secure.js';
import { activeCorrections, applyCorrections } from './corrections.js';
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
    cardOpts = { title: scenario.cards?.title ?? CONFIG.cards?.title, templates, dosImages, labels: CONFIG.items };
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
    const mode = scenario.cards?.mode ?? CONFIG.cards?.mode ?? 'generated';
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
    return v;
  });
  // les cartes "devant" sont dessinées en dernier ; une carte cachée est dessinée juste avant son couvercle
  victims.sort((a, b) => (a.sortY - b.sortY) || ((b.hiddenUnder ? 1 : 0) - (a.hiddenUnder ? 1 : 0)));
  const stock = scaledStock(entries.length, scenario);
  const player = { name: choice.name, authorized, label: access?.label ?? null };
  const state = createGameState({ plan, zones, victims, stock, player });
  state.clock.running = false;           // démarre à l'engagement (fin du briefing)
  state.mpap = MPAP;
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
      const v = state.byId.get(id);
      const res = what === 'free' ? rescuers.release(v) : rescuers.post(v);
      hud.update(state);
      return res;
    },
    onEvac: (id, mode) => {
      const v = state.byId.get(id);
      const res = mode === 'walk' ? evac.walk(v) : mode === 'cancel' ? evac.cancel(v) : mode === 'priority' ? evac.prioritize(v) : mode === 'pma' ? evac.sendToPMA(v) : evac.requestStretcher(v);
      hud.update(state);
      return res;
    },
    onTriage: (id, cat) => assignTriage(state, id, cat, judgeTriage, expectedTriage),
    onCare: (id, action) => {
      const res = applyCare(state, state.byId.get(id), action);
      hud.update(state);
      return res;
    },
    onClose: () => { if (CONFIG.clock.pauseOnModal && !MPAP) state.clock.running = true; },
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
      if (state.over || (!state.clock.running && !MPAP)) return;
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
    v.cardView = 'face'; v.cardSig = '0||face';
    v.src = generatedCardURL(v.entry, cardOpts);
  }
  function examine(v) {
    team.stop();
    if (!authorized && v.seenAt == null && !v.decoy && decoyUsed < decoyMax && leurres.length && cardOpts) makeDecoy(v);
    const firstLook = (v.seenAt == null && !!v.back) || (!authorized && !v.decoy) || (v.decoy && v.seenAt == null);
    markSeen(state, v.id);
    if (CONFIG.clock.pauseOnModal) state.clock.running = false;
    modal.open(v, firstLook ? cardBackSrc : null); // retournement au 1er examen
  }
  team.onArrive = (v) => { if (!modal.isOpen() && !state.over) examine(v); };

  if (authorized) window.sim = { state, camera, modal, debrief, team, evac, rescuers, smur, pompiers, examine }; // accès console (formateur / tests)
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
  // animation d'arrivée : appel des valides
  const intro = createIntro(state, scenario, plan, {
    team, pma: evac.pma, cri: evac.cri, camera, amb, backImage: backThumb, count: entries.length,
    voice: choice.ambience.sound,
  });
  if (authorized) window.sim.intro = intro;
  renderer.addOverlay((ctx) => intro.draw(ctx));
  if (!MPAP) renderer.addOverlay((ctx) => team.draw(ctx, camera, performance.now()));
  renderer.addOverlay((ctx) => amb.draw(ctx));
  addEventListener('keydown', (e) => {
    if ((e.key === 'm' || e.key === 'M') && !e.target.closest?.('input')) sound.setMuted(!sound.muted);
  });

  // 10. Boucle principale
  $('loading').remove();
  let last = performance.now();
  let hudTimer = 0;
  function frame(now) {
    const dt = Math.min(100, now - last); // onglet en veille : pas de saut géant
    last = now;
    updateSim(state, dt);
    if (state.clock.running) team.update(dt * CONFIG.clock.timeScale);
    evac.update();
    if (state.clock.running) rescuers.update();
    smur.update(dt * CONFIG.clock.timeScale);
    pompiers.update(dt * CONFIG.clock.timeScale);
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
  await showBriefing(fillBriefing(scenario, { count: entries.length, stock, player }), {
    onEngage: () => { if (choice.ambience.sound && (choice.ambience.phones || choice.ambience.outside)) sound.unlock(); },
  });
  state.clock.running = !MPAP;             // MPAP : le temps ne passe pas (pas d'aggravation)
  logEvent(state, 'start', { scenario: scenario.id });
  if (!MPAP) intro.start();
}

// Nouvelle partie = retour au menu (nouvelle disposition)
function newGame() {
  location.href = location.pathname;
}

boot().catch((err) => {
  console.error(err);
  $('menu').hidden = true;
  $('loading').hidden = false;
  const hint = location.protocol === 'file:'
    ? 'Le jeu doit être servi par un serveur local (voir README) : ouvrir index.html directement ne fonctionne pas.'
    : err.message;
  $('loading-text').textContent = hint;
});
