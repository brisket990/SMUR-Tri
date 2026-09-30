// ============================================================
//  Éditeur des fiches victimes (menu ⚙ Options → Fiches victimes)
// ============================================================
//  Réservé aux formateurs : il faut le code d'accès (les fiches sont chiffrées).
//  Chaque modification est enregistrée CHIFFRÉE dans ce navigateur (brouillon) et
//  s'applique aussitôt aux parties lancées ici. « Publier » télécharge
//  corrections-<scénario>.enc : outils/publier.py le récupère dans Téléchargements (→ jeu/SMUR-Tri)
//  et le met en ligne avec le jeu (voir README).

import { CONFIG } from './config.js';
import { unlock, openJSON } from './secure.js';
import { generatedCardURL, templateFor } from './cardgen.js';
import { loadPublished, loadDraft, saveDraft, dropDraft, sealForPublish, emptyCorrections } from './corrections.js';
import { loadGH, saveGH, forgetGH, checkGH, putFile, guessRepo } from './github.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fetchJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} : HTTP ${r.status}`); return r.json(); };
const session = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } } };

const TRI = [['BLACK', 'UD'], ['RED', 'UA'], ['YELLOW', 'UR'], ['GREEN', 'Impliqué']];
const TRI_LABEL = Object.fromEntries(TRI);
const STATUS = [['STABLE', 'Stable'], ['CRITICAL', 'S\'aggrave'], ['DEAD', 'Décédé']];

const KINDS = [
  ['ball', 'Plaie par balle'], ['exit', 'Orifice de sortie'], ['graze', 'Éraflure (tangentielle)'], ['cut', 'Plaie arme blanche'],
  ['blunt', 'Contusion / entorse / luxation'], ['fracture', 'Fracture'], ['burn', 'Brûlure'], ['shards', 'Éclats'],
  ['blast', 'Criblage (explosion)'], ['ear', 'Blast auriculaire'], ['hematoma', 'Hématome'], ['tear', 'Déchirure / éviscération'],
  ['tq', 'Garrot déjà posé'],
];
const REGIONS = [
  ['head', 'Crâne'], ['forehead', 'Front'], ['face', 'Visage'], ['ear', 'Oreille'], ['neck', 'Cou'], ['shoulder', 'Épaule'],
  ['chest', 'Thorax'], ['ribs', 'Côtes'], ['heart', 'Région cardiaque'], ['abdomen', 'Abdomen'], ['flank', 'Flanc'],
  ['pelvis', 'Bassin'], ['groin', 'Pli de l\'aine'], ['femoral', 'Racine de cuisse'], ['arm', 'Bras'], ['elbow', 'Coude'],
  ['forearm', 'Avant-bras'], ['hand', 'Main'], ['thigh', 'Cuisse'], ['knee', 'Genou'], ['leg', 'Jambe (au-dessus du genou)'],
  ['calf', 'Jambe (mollet)'], ['ankle', 'Cheville'], ['foot', 'Pied'], ['body', 'Corps entier'],
];
const TQ_REGIONS = ['arm', 'forearm', 'thigh', 'groin', 'leg'];
const FLAGS = [['dos', 'Dos'], ['big', 'Étendue'], ['x2', 'Double'], ['bad', 'Mal posé']];

const EFFECTS = [
  ['stop', 'Arrête l\'aggravation'], ['slow', 'Ralentit'], ['helpful', 'Utile'], ['excessive', 'Excessif'],
  ['worsen', 'Aggrave'], ['useless', 'Inutile / non indiqué'], ['impossible', 'Impossible'],
];
const POS_EFFECTS = ['slow', 'helpful', 'worsen', 'useless', 'impossible'];

const TABS = [['fiche', 'Fiche'], ['tri', 'Tri attendu'], ['blessures', 'Blessures'], ['evolution', 'Évolution'], ['gestes', 'Gestes']];

let root = null;

export async function openEditor({ scenarios }) {
  root ??= document.getElementById('editor');
  root.hidden = false;
  document.body.classList.add('editor-open');
  const list = scenarios.filter((s) => !s.mpapOf);
  const code = session.get('smur.code') ?? document.getElementById('menu-code')?.value ?? '';
  const access = code ? await tryUnlock(code) : null;
  if (access) return start(list, access);
  gate(list);
}

async function tryUnlock(code) {
  try { return await unlock(await fetchJSON(CONFIG.access.keysSrc), code); } catch { return null; }
}

function close() {
  root.hidden = true;
  root.innerHTML = '';
  document.body.classList.remove('editor-open');
  document.getElementById('open-editor')?.focus();
}

// ---------- accès : code formateur ----------
function gate(list) {
  root.innerHTML = `
    <div class="ed-gate">
      <form class="ed-gate-card" autocomplete="off">
        <h2>✎ Fiches victimes</h2>
        <p class="muted">Réservé aux formateurs : saisissez le code d'accès pour ouvrir les fiches.</p>
        <input type="password" class="ed-code" placeholder="Code d'accès" />
        <p class="ed-err" hidden>Code incorrect.</p>
        <div class="ed-gate-actions"><button type="button" class="muted-btn ed-close">Annuler</button><button type="submit" class="ed-primary">Ouvrir</button></div>
      </form>
    </div>`;
  const f = root.querySelector('form');
  root.querySelector('.ed-close').onclick = close;
  f.querySelector('.ed-code').focus();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const code = f.querySelector('.ed-code').value;
    const access = await tryUnlock(code);
    if (!access) { f.querySelector('.ed-err').hidden = false; return; }
    session.set('smur.code', code);
    start(list, access);
  };
}

// ---------- éditeur ----------
async function start(list, access) {
  root.innerHTML = '<div class="ed-loading">Ouverture des fiches…</div>';
  const key = access.key;
  let sc = list[0];

  // fiches vierges pour l'aperçu (images publiques)
  const asDataURL = async (url) => {
    const r = await fetch(url); if (!r.ok) throw new Error(url);
    const b = await r.blob();
    return new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); });
  };
  const cardOptsFor = async (s) => {
    const templates = {}, dosImages = {};
    const dir = s.cards?.templatesDir ? s.base + s.cards.templatesDir : (CONFIG.cards?.templatesDir ?? 'img/fiches/');
    await Promise.all(['homme', 'femme', 'enfant', 'bebe'].map(async (n) => {
      try { templates[n] = await asDataURL(`${dir}modele-${n}.jpg`); } catch { /* */ }
      try { dosImages[n] = await asDataURL(`${dir}dos-${n}.png`); } catch { /* */ }
    }));
    return { title: s.cards?.title ?? CONFIG.cards?.title, templates, dosImages, labels: CONFIG.items };
  };

  let orig, byId, profiles, pub, corr, cardOpts, pushed = null;
  async function loadScenario(s) {
    sc = s;
    const sid = s.id;
    const manifest = await openJSON(key, `${s.base}victims.enc`, `${sid}/victims`);
    ({ profiles } = await openJSON(key, `${s.base}profiles.enc`, `${sid}/profiles`));
    orig = manifest.victims;
    byId = new Map(orig.map((e) => [e.id, e]));
    pub = await loadPublished(key, s.base, sid);
    const draft = await loadDraft(key, sid);
    corr = clone(draft ?? pub ?? emptyCorrections(sid));
    corr.victims ??= {};
    if (draft && same(draft.victims, pub?.victims ?? {})) dropDraft(sid);    // brouillon déjà publié
    cardOpts = await cardOptsFor(s);
  }
  await loadScenario(sc);

  // ---------- modèle : fiche d'origine, fiche corrigée ----------
  const evoOf = (P) => ({ stages: clone(P?.stages ?? []), if_nothing: P?.if_nothing ?? '', garroted: !!P?.garroted });
  function base(id) {
    const e = byId.get(id);
    return {
      clinical: { sex: '', age: '', mechanism: '', pres: '', vent: '', circ: '', neuro: '', lesion: '', ...e.clinical },
      truth: { triage: null, accept: [], limit: false, why: '', note: '', ...e.truth },
      injuries: e.injuries ?? '',
      profile: e.profile,
      evo: evoOf(profiles[e.profile]),
      actions: e.actions ?? {},
    };
  }
  function effective(id) {
    const b = base(id);
    const c = corr.victims[id] ?? {};
    const profile = c.profile ?? b.profile;
    return clone({
      clinical: { ...b.clinical, ...c.clinical },
      truth: { ...b.truth, ...c.truth },
      injuries: c.injuries ?? b.injuries,
      profile,
      evo: c.evo ? { ...evoOf(profiles[profile]), ...c.evo } : evoOf(profiles[profile]),
      actions: c.actions ?? b.actions,
    });
  }
  // différences par onglet (pastille sur l'onglet)
  function diffs(id, cur) {
    const b = base(id);
    return {
      fiche: !same(cur.clinical, b.clinical),
      tri: !same(cur.truth, b.truth),
      blessures: (cur.injuries ?? '') !== (b.injuries ?? ''),
      evolution: cur.profile !== b.profile || !same(cur.evo, evoOf(profiles[cur.profile])),
      gestes: !same(cur.actions, b.actions),
    };
  }
  function commit() {
    const id = sel, b = base(id), r = {};
    if (!same(cur.clinical, b.clinical)) r.clinical = cur.clinical;
    if (!same(cur.truth, b.truth)) r.truth = cur.truth;
    if ((cur.injuries ?? '') !== (b.injuries ?? '')) r.injuries = cur.injuries;
    if (cur.profile !== b.profile) r.profile = cur.profile;
    if (!same(cur.evo, evoOf(profiles[cur.profile]))) r.evo = cur.evo;
    if (!same(cur.actions, b.actions)) r.actions = cur.actions;
    if (Object.keys(r).length) corr.victims[id] = clone(r); else delete corr.victims[id];
    corr.updated = new Date().toISOString();
    scheduleSave();
    refreshRow(id);
    refreshTabs();
    schedulePreview();
  }

  // ---------- enregistrement (brouillon chiffré dans ce navigateur) ----------
  let saveTimer = null;
  function scheduleSave() {
    setStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }
  async function save() {
    clearTimeout(saveTimer);
    if (same(corr.victims, pub?.victims ?? {})) dropDraft(sc.id);
    else if (!(await saveDraft(key, sc.id, corr))) { setStatus('error'); return; }
    setStatus();
  }
  const isDraft = () => !same(corr.victims, pub?.victims ?? {});
  function setStatus(s) {
    const el = root.querySelector('.ed-status');
    if (!el) return;
    const n = Object.keys(corr.victims).length;
    const pubBtn = root.querySelector('.ed-publish');
    const sent = pushed && same(corr.victims, pushed);
    if (pubBtn) pubBtn.disabled = !isDraft() || sent;
    root.querySelector('.ed-drop').hidden = !isDraft();
    if (s === 'saving') { el.className = 'ed-status saving'; el.textContent = 'Enregistrement…'; return; }
    if (s === 'error') { el.className = 'ed-status bad'; el.textContent = 'Enregistrement impossible (stockage du navigateur bloqué)'; return; }
    if (sent && isDraft()) {
      el.className = 'ed-status ok';
      el.textContent = `✓ Publié sur GitHub · en ligne d'ici 1 à 2 minutes`;
    } else if (isDraft()) {
      el.className = 'ed-status draft';
      el.innerHTML = `<b>● Brouillon</b> · ${n} fiche${n > 1 ? 's' : ''} corrigée${n > 1 ? 's' : ''} · actif ici, <u>non publié</u>`;
      el.title = 'Enregistré (chiffré) dans ce navigateur : déjà appliqué aux parties lancées ici. « Publier » pour tous les joueurs.';
    } else {
      el.className = 'ed-status ok';
      el.textContent = pub ? `✓ À jour avec la version publiée · ${n} fiche${n > 1 ? 's' : ''} corrigée${n > 1 ? 's' : ''}` : 'Aucune correction pour l\'instant';
    }
  }

  // ---------- interface ----------
  let sel = orig[0].id, cur = effective(sel), tab = 'fiche', view = 'face', filter = 'all', query = '';
  root.innerHTML = `
    <div class="ed">
      <header class="ed-top">
        <h2>✎ Fiches victimes</h2>
        ${list.length > 1 ? `<select class="ed-sc">${list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>` : `<span class="muted">${esc(sc.name)}</span>`}
        <span class="ed-status"></span>
        <span class="ed-top-actions">
          <button type="button" class="muted-btn ed-drop" hidden>Abandonner le brouillon</button>
          <button type="button" class="ed-primary ed-publish">⬆ Publier…</button>
          <button type="button" class="muted-btn ed-close" title="Fermer (Échap)">✕</button>
        </span>
      </header>
      <aside class="ed-side">
        <input type="search" class="ed-search" placeholder="Rechercher : BC-45, garrot, thorax…" />
        <div class="ed-filters">
          <button data-f="all">Toutes</button><button data-f="mod">✎ Corrigées</button>
          ${TRI.map(([t, l]) => `<button data-f="${t}" class="t-${t}">${l}</button>`).join('')}
        </div>
        <ul class="ed-list"></ul>
      </aside>
      <main class="ed-main">
        <div class="ed-head">
          <button type="button" class="ed-nav" data-nav="-1" title="Fiche précédente">◀</button>
          <h3 class="ed-title"></h3>
          <button type="button" class="ed-nav" data-nav="1" title="Fiche suivante">▶</button>
          <button type="button" class="muted-btn ed-revert" hidden>↺ Revenir à la fiche d'origine</button>
        </div>
        <nav class="ed-tabs">${TABS.map(([t, l]) => `<button data-tab="${t}">${l}<i></i></button>`).join('')}</nav>
        <div class="ed-form"></div>
      </main>
      <section class="ed-preview">
        <div class="ed-card"><img alt="Aperçu de la fiche" /></div>
        <button type="button" class="ed-view">↻ Voir le dos</button>
        <div class="ed-timeline"></div>
      </section>
    </div>
    <div class="ed-dialog" hidden></div>`;
  const $ = (s) => root.querySelector(s);

  // ---------- liste ----------
  const triOf = (id) => (corr.victims[id]?.truth?.triage ?? byId.get(id).truth?.triage);
  function rowHTML(e) {
    const c = { ...e.clinical, ...corr.victims[e.id]?.clinical };
    const t = triOf(e.id);
    return `<li data-id="${e.id}" class="${e.id === sel ? 'on' : ''}">
      <span class="dot t-${t}"></span><b>${e.id}</b>${corr.victims[e.id] ? '<span class="ed-mod" title="Fiche corrigée">✎</span>' : ''}
      <small>${esc(c.sex ?? '')}${c.age !== '' && c.age != null ? ', ' + esc(c.age) + ' ans' : ''} · ${esc(c.lesion ?? '')}</small></li>`;
  }
  function renderList() {
    const q = query.trim().toLowerCase();
    const rows = orig.filter((e) => {
      if (filter === 'mod' && !corr.victims[e.id]) return false;
      if (TRI_LABEL[filter] && triOf(e.id) !== filter) return false;
      if (!q) return true;
      const c = { ...e.clinical, ...corr.victims[e.id]?.clinical };
      return [e.id, c.mechanism, c.lesion, c.pres, c.vent, c.circ, c.neuro].join(' ').toLowerCase().includes(q.replace('_', '-'));
    });
    $('.ed-list').innerHTML = rows.length ? rows.map(rowHTML).join('') : '<li class="muted empty">Aucune fiche.</li>';
    root.querySelectorAll('.ed-filters button').forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
  }
  function refreshRow(id) {
    const li = $(`.ed-list li[data-id="${id}"]`);
    if (li) li.outerHTML = rowHTML(byId.get(id));
  }
  $('.ed-list').onclick = (e) => { const li = e.target.closest('li[data-id]'); if (li) select(li.dataset.id); };
  $('.ed-search').oninput = (e) => { query = e.target.value; renderList(); };
  $('.ed-filters').onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; renderList(); } };

  function select(id) {
    sel = id; cur = effective(id);
    root.querySelectorAll('.ed-list li').forEach((li) => li.classList.toggle('on', li.dataset.id === id));
    $(`.ed-list li[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
    view = 'face';
    renderForm(); schedulePreview(0);
  }
  root.querySelectorAll('.ed-nav').forEach((b) => (b.onclick = () => {
    const ids = [...root.querySelectorAll('.ed-list li[data-id]')].map((li) => li.dataset.id);
    const i = ids.indexOf(sel);
    const n = ids[i + Number(b.dataset.nav)];
    if (n) select(n);
  }));
  $('.ed-revert').onclick = () => {
    confirmBox(`Revenir à la fiche d'origine ${sel} ?`, 'Toutes les corrections de cette fiche (texte, tri, blessures, évolution, gestes) seront retirées.', 'Revenir à l\'origine', () => {
      delete corr.victims[sel];
      cur = effective(sel);
      corr.updated = new Date().toISOString();
      scheduleSave(); refreshRow(sel); renderForm(); schedulePreview(0);
    });
  };

  // ---------- onglets ----------
  function refreshTabs() {
    const d = diffs(sel, cur);
    root.querySelectorAll('.ed-tabs button').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.classList.toggle('mod', !!d[b.dataset.tab]);
    });
    $('.ed-revert').hidden = !corr.victims[sel];
    $('.ed-title').innerHTML = `${sel} <span class="dot t-${cur.truth.triage}"></span> <small>${esc(cur.clinical.sex)}${cur.clinical.age !== '' ? ', ' + esc(cur.clinical.age) + ' ans' : ''}</small>`;
  }
  $('.ed-tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; renderForm(); } };

  // ---------- formulaires ----------
  const field = (label, html, hint = '') => `<label class="ed-field"><span>${label}${hint ? ` <em>${hint}</em>` : ''}</span>${html}</label>`;
  const txt = (path, v, rows = 2) => `<textarea data-p="${path}" rows="${rows}">${esc(v)}</textarea>`;
  const inp = (path, v, attrs = '') => `<input data-p="${path}" value="${esc(v)}" ${attrs} />`;
  const triSeg = (path, v, small = false) => `<div class="ed-seg ${small ? 'small' : ''}" data-seg="${path}">${TRI.map(([t, l]) => `<button type="button" data-v="${t}" class="t-${t} ${v === t ? 'on' : ''}">${l}</button>`).join('')}</div>`;

  function renderForm() {
    const f = $('.ed-form');
    const c = cur.clinical, t = cur.truth;
    if (tab === 'fiche') {
      const sil = { homme: 'homme', femme: 'femme', enfant: 'enfant', bebe: 'bébé' }[templateFor(c)] ?? '';
      f.innerHTML = `
        <div class="ed-row">
          ${field('Sexe', `<select data-p="clinical.sex">${['Homme', 'Femme'].map((s) => `<option ${c.sex === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
          ${field('Âge', inp('clinical.age', c.age, 'type="number" min="0" max="110" data-num'), `silhouette : ${sil}`)}
        </div>
        ${field('Mécanisme', inp('clinical.mechanism', c.mechanism))}
        ${field('Présentation clinique', txt('clinical.pres', c.pres))}
        ${field('A & B — Ventilation', txt('clinical.vent', c.vent))}
        ${field('C — Circulation et choc', txt('clinical.circ', c.circ))}
        ${field('D — Neurologie', txt('clinical.neuro', c.neuro))}
        ${field('E — Bilan lésionnel', txt('clinical.lesion', c.lesion))}
        <p class="ed-hint">Le texte s'affiche tel quel sur la fiche : vérifiez dans l'aperçu qu'il tient dans son cadre.</p>`;
    } else if (tab === 'tri') {
      f.innerHTML = `
        ${field('Tri attendu (état de la fiche imprimée)', triSeg('truth.triage', t.triage))}
        ${field('Autres tris acceptés', `<div class="ed-checks">${TRI.filter(([k]) => k !== t.triage).map(([k, l]) => `<label class="ed-chk"><input type="checkbox" data-accept="${k}" ${t.accept?.includes(k) ? 'checked' : ''} /><span class="dot t-${k}"></span>${l}</label>`).join('')}</div>`, 'comptés « défendables » au bilan')}
        <label class="ed-chk big"><input type="checkbox" data-p="truth.limit" ${t.limit ? 'checked' : ''} /> Cas limite (à discuter en débriefing)</label>
        ${field('Justification', txt('truth.why', t.why, 3), 'affichée au bilan')}
        ${field('Note pour le formateur', txt('truth.note', t.note, 2))}
        <p class="ed-hint">Après une aggravation, le tri attendu est celui de l'étape atteinte (onglet Évolution).</p>`;
    } else if (tab === 'blessures') {
      renderInjuries(f);
    } else if (tab === 'evolution') {
      renderEvolution(f);
    } else if (tab === 'gestes') {
      renderGestes(f);
    }
    refreshTabs();
  }

  // --- blessures ---
  const parse = (spec) => String(spec ?? '').trim().split(/\s+/).filter(Boolean).map((tok) => {
    const [kind, region, ...rest] = tok.split(':');
    const side = rest.find((x) => ['R', 'L', 'C'].includes(x)) ?? 'C';
    const flags = rest.filter((x) => !['R', 'L', 'C'].includes(x));
    return { kind, region, side, flags };
  });
  const serialize = (rows) => rows.map((r) => [r.kind, r.region, ...(r.side !== 'C' ? [r.side] : []), ...r.flags].join(':')).join(' ');
  function renderInjuries(f) {
    const rows = parse(cur.injuries);
    const opt = (list, v) => list.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')
      + (list.some(([k]) => k === v) ? '' : `<option value="${esc(v)}" selected>${esc(v)} (?)</option>`);
    f.innerHTML = `
      <p class="ed-hint">Chaque ligne dessine une blessure sur la silhouette. <b>Côté</b> : celui du patient. Cochez <b>Dos</b> pour la vue de dos (bouton ↻ sous l'aperçu).</p>
      <div class="ed-inj">
        ${rows.map((r, i) => `<div class="ed-inj-row" data-i="${i}">
          <select data-inj="kind">${opt(KINDS, r.kind)}</select>
          <select data-inj="region">${opt(r.kind === 'tq' ? REGIONS.filter(([k]) => TQ_REGIONS.includes(k)) : REGIONS, r.region)}</select>
          <div class="ed-seg small" data-inj-side>${[['R', 'Droit'], ['C', 'Milieu'], ['L', 'Gauche']].map(([k, l]) => `<button type="button" data-v="${k}" class="${r.side === k ? 'on' : ''}">${l}</button>`).join('')}</div>
          <span class="ed-flags">${FLAGS.filter(([k]) => k !== 'bad' || r.kind === 'tq').map(([k, l]) => `<label class="ed-chk"><input type="checkbox" data-flag="${k}" ${r.flags.includes(k) ? 'checked' : ''} />${l}</label>`).join('')}</span>
          <button type="button" class="ed-del" data-del-inj title="Supprimer">🗑</button>
        </div>`).join('') || '<p class="muted">Aucune blessure dessinée.</p>'}
      </div>
      <button type="button" class="ed-add" data-add-inj>+ Ajouter une blessure</button>
      <details class="ed-adv"><summary>Code des blessures (avancé)</summary>
        ${inp('injuries', cur.injuries, 'spellcheck="false"')}
        <p class="ed-hint">Format : type:région[:R|L|C][:dos][:big][:x2][:bad] — ex. <code>ball:thigh:R tq:groin:R</code></p>
      </details>`;
    const rowsNow = () => parse(cur.injuries);
    const set = (rs) => { cur.injuries = serialize(rs); commit(); renderInjuries(f); refreshTabs(); };
    f.querySelectorAll('.ed-inj-row').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelectorAll('[data-inj]').forEach((s) => (s.onchange = () => {
        const rs = rowsNow(); rs[i][s.dataset.inj] = s.value;
        if (s.dataset.inj === 'kind') {
          if (s.value === 'tq' && !TQ_REGIONS.includes(rs[i].region)) rs[i].region = 'thigh';
          if (s.value !== 'tq') rs[i].flags = rs[i].flags.filter((x) => x !== 'bad');
        }
        set(rs);
      }));
      row.querySelector('[data-inj-side]').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; const rs = rowsNow(); rs[i].side = b.dataset.v; set(rs); };
      row.querySelectorAll('[data-flag]').forEach((cb) => (cb.onchange = () => {
        const rs = rowsNow(); const fl = new Set(rs[i].flags);
        cb.checked ? fl.add(cb.dataset.flag) : fl.delete(cb.dataset.flag);
        rs[i].flags = [...fl]; set(rs);
        if (cb.dataset.flag === 'dos') { view = cb.checked ? 'dos' : 'face'; schedulePreview(0); }
      }));
      row.querySelector('[data-del-inj]').onclick = () => { const rs = rowsNow(); rs.splice(i, 1); set(rs); };
    });
    f.querySelector('[data-add-inj]').onclick = () => set([...rowsNow(), { kind: 'ball', region: 'chest', side: 'C', flags: [] }]);
  }

  // --- évolution ---
  function renderEvolution(f) {
    const ev = cur.evo;
    const names = Object.keys(profiles).filter((k) => !k.startsWith('__'));
    const stages = ev.stages;
    f.innerHTML = `
      ${field('Modèle d\'évolution', `<select data-profile>${names.map((k) => `<option value="${k}" ${k === cur.profile ? 'selected' : ''}>${esc(profiles[k].label ?? k)}</option>`).join('')}</select>`, 'point de départ : étapes et effet des gestes')}
      <p class="ed-hint">Les changements ci-dessous ne concernent <b>que cette fiche</b> : le modèle reste inchangé pour les autres victimes.</p>
      <ol class="ed-stages">
        <li class="ed-stage first"><span class="ed-t">T+0</span><div><b>Fiche imprimée</b> · tri attendu <span class="tag t-${cur.truth.triage}">${TRI_LABEL[cur.truth.triage] ?? '?'}</span> <span class="muted">(onglet Tri attendu)</span></div></li>
        ${stages.map((s, i) => `<li class="ed-stage st-${s.status}" data-i="${i}">
          <label class="ed-t">T+<input type="number" min="1" max="120" value="${s.at}" data-st="at" /> min</label>
          <div class="ed-stage-body">
            <div class="ed-row">
              ${field('Tri attendu', triSeg(`stage.${i}.triage`, s.triage, true))}
              ${field('État', `<select data-st="status">${STATUS.map(([k, l]) => `<option value="${k}" ${s.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
            </div>
            ${field('Ce qui se passe', `<textarea data-st="text" rows="2">${esc(s.text)}</textarea>`)}
            ${field('Paramètres', `<input data-st="params" value="${esc(s.params ?? '')}" placeholder="FR · SpO2 · FC · PA · GCS" />`)}
          </div>
          <button type="button" class="ed-del" data-del-st title="Supprimer l'étape">🗑</button>
        </li>`).join('')}
      </ol>
      <button type="button" class="ed-add" data-add-st>+ Ajouter une étape</button>
      ${field('Sans prise en charge', `<textarea data-evo="if_nothing" rows="2">${esc(ev.if_nothing)}</textarea>`, 'résumé affiché au bilan')}
      <label class="ed-chk big"><input type="checkbox" data-evo-garroted ${ev.garroted ? 'checked' : ''} /> Garrot déjà posé à l'arrivée (une victime garrottée reste UA)</label>
      <p class="ed-hint">Un geste qui <b>arrête</b> l'aggravation (onglet Gestes) stoppe l'évolution ; un geste qui <b>ralentit</b> repousse les étapes suivantes.</p>`;
    f.querySelector('[data-profile]').onchange = (e) => {
      const name = e.target.value;
      confirmBox('Changer de modèle d\'évolution ?', 'Les étapes et l\'effet des gestes de cette fiche seront remplacés par ceux du modèle choisi.', 'Changer', () => {
        cur.profile = name; cur.evo = evoOf(profiles[name]); cur.actions = base(sel).actions;
        commit(); renderEvolution(f); refreshTabs();
      }, () => { e.target.value = cur.profile; });
    };
    f.querySelectorAll('.ed-stage[data-i]').forEach((li) => {
      const i = Number(li.dataset.i);
      li.querySelectorAll('[data-st]').forEach((el) => {
        el.addEventListener('input', () => {
          const k = el.dataset.st;
          cur.evo.stages[i][k] = k === 'at' ? Math.max(1, Number(el.value) || 1) : el.value;
          if (k === 'status') li.className = `ed-stage st-${el.value}`;
          commit();
        });
        if (el.dataset.st === 'at') el.addEventListener('change', () => { cur.evo.stages.sort((a, b) => a.at - b.at); commit(); renderEvolution(f); });
      });
      li.querySelector('.ed-seg').onclick = (e) => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        cur.evo.stages[i].triage = b.dataset.v;
        li.querySelectorAll('.ed-seg button').forEach((x) => x.classList.toggle('on', x === b));
        commit();
      };
      li.querySelector('[data-del-st]').onclick = () => { cur.evo.stages.splice(i, 1); commit(); renderEvolution(f); };
    });
    f.querySelector('[data-add-st]').onclick = () => {
      const last = stages.at(-1);
      cur.evo.stages.push({ at: (last?.at ?? 0) + 5, triage: last?.triage ?? cur.truth.triage ?? 'RED', status: last?.status === 'DEAD' ? 'CRITICAL' : (last?.status ?? 'CRITICAL'), text: '', params: '' });
      commit(); renderEvolution(f);
      f.querySelector('.ed-stage:last-child textarea')?.focus();
    };
    f.querySelector('[data-evo="if_nothing"]').oninput = (e) => { cur.evo.if_nothing = e.target.value; commit(); };
    f.querySelector('[data-evo-garroted]').onchange = (e) => { cur.evo.garroted = e.target.checked; commit(); };
  }

  // --- gestes ---
  function renderGestes(f) {
    const model = profiles[cur.profile]?.actions ?? {};
    const items = Object.entries(CONFIG.items);
    const row = ([a, it]) => {
      const own = cur.actions[a] != null;
      const e = cur.actions[a] ?? model[a] ?? { type: 'useless' };
      const isPos = it.group === 'position';
      const types = EFFECTS.filter(([k]) => !isPos || POS_EFFECTS.includes(k));
      const param = e.type === 'stop' ? `<label class="ed-param">nécessaires <input type="number" min="1" max="4" value="${e.count ?? 1}" data-ge="count" /></label>`
        : e.type === 'slow' ? `<label class="ed-param" title="1,5 = les étapes suivantes arrivent 1,5 fois plus tard">délais × <input type="number" step="0.05" min="1" max="5" value="${e.factor ?? (isPos ? 1.2 : 1.5)}" data-ge="factor" /></label>`
        : e.type === 'worsen' ? `<label class="ed-param" title="0,85 = les étapes suivantes arrivent plus tôt">délais × <input type="number" step="0.05" min="0.3" max="1" value="${e.factor ?? 0.85}" data-ge="factor" /></label>`
        : '<span></span>';
      return `<div class="ed-ge ${own ? 'own' : ''} k-${e.type}" data-a="${a}">
        <span class="ed-ge-name">${esc(it.label)}${own ? ' <em title="Réglage propre à cette fiche">✎</em>' : ''}</span>
        <select data-ge="type">${types.map(([k, l]) => `<option value="${k}" ${k === e.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${param}
        <input data-ge="msg" value="${esc(e.msg ?? '')}" placeholder="Message affiché au joueur (facultatif)" />
        <button type="button" class="ed-del" data-ge-reset title="Reprendre le réglage du modèle" ${own ? '' : 'hidden'}>↺</button>
      </div>`;
    };
    f.innerHTML = `
      <p class="ed-hint">Ce que produit chaque geste sur <b>cette</b> victime. Les lignes marquées ✎ sont propres à la fiche (↺ pour reprendre le modèle).</p>
      <dl class="ed-legend">
        <dt>Arrête l'aggravation</dt><dd>stabilise la victime (ex. garrot sur hémorragie de membre)</dd>
        <dt>Ralentit</dt><dd>les étapes suivantes arrivent plus tard (délais × 1,5 = 1,5 fois plus tard)</dd>
        <dt>Utile</dt><dd>bon geste, sans effet sur l'évolution</dd>
        <dt>Excessif</dt><dd>efficace mais disproportionné (compté en erreur au bilan)</dd>
        <dt>Aggrave</dt><dd>accélère l'évolution (délais × 0,85)</dd>
        <dt>Inutile</dt><dd>non indiqué : matériel gaspillé</dd>
        <dt>Impossible</dt><dd>refusé, matériel non consommé (le message explique pourquoi)</dd>
      </dl>
      <h4>Gestes</h4>${items.filter(([, it]) => it.group !== 'position').map(row).join('')}
      <h4>Positions d'attente</h4>${items.filter(([, it]) => it.group === 'position').map(row).join('')}`;
    f.querySelectorAll('.ed-ge').forEach((r) => {
      const a = r.dataset.a;
      const cleanup = () => {
        const b = base(sel).actions;
        if (same(cur.actions[a], model[a] ?? { type: 'useless' }) && b[a] == null) { cur.actions = { ...cur.actions }; delete cur.actions[a]; }
      };
      r.querySelectorAll('[data-ge]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const k = el.dataset.ge;
        const e = clone(cur.actions[a] ?? model[a] ?? { type: 'useless' });
        if (k === 'type') { e.type = el.value; delete e.factor; delete e.count; delete e.msg; }   // l'ancien message ne correspond plus
        else if (k === 'msg') { if (el.value) e.msg = el.value; else delete e.msg; }
        else e[k] = Number(el.value);
        cur.actions = { ...cur.actions, [a]: e };
        cleanup(); commit();
        if (k === 'type') renderGestes(f);
      }));
      r.querySelector('[data-ge-reset]').onclick = () => {
        const b = base(sel).actions;          // réglage d'origine de la fiche, sinon celui du modèle
        cur.actions = { ...cur.actions };
        if (b[a] != null && !same(cur.actions[a], b[a])) cur.actions[a] = clone(b[a]); else delete cur.actions[a];
        commit(); renderGestes(f);
      };
    });
  }

  // saisie générique (data-p="clinical.pres", etc.) et boutons à choix (data-seg)
  $('.ed-form').addEventListener('input', (e) => {
    const el = e.target.closest('[data-p]');
    if (!el) return;
    const [grp, k] = el.dataset.p.split('.');
    const v = el.type === 'checkbox' ? el.checked : el.hasAttribute('data-num') ? (el.value === '' ? '' : Number(el.value)) : el.value;
    if (k) cur[grp][k] = v; else cur[grp] = v;
    commit();
  });
  $('.ed-form').addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('select[data-p]')) { const [g, k] = el.dataset.p.split('.'); cur[g][k] = el.value; commit(); if (tab === 'fiche') renderForm(); }
    if (el.matches('[data-accept]')) {
      const s = new Set(cur.truth.accept ?? []);
      el.checked ? s.add(el.dataset.accept) : s.delete(el.dataset.accept);
      cur.truth.accept = TRI.map(([k]) => k).filter((k) => s.has(k));
      commit();
    }
    if (el.matches('[data-p="injuries"]')) renderForm();
  });
  $('.ed-form').addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg="truth.triage"] [data-v]');
    if (!b) return;
    cur.truth.triage = b.dataset.v;
    cur.truth.accept = (cur.truth.accept ?? []).filter((k) => k !== b.dataset.v);
    commit(); renderForm(); refreshRow(sel);
  });

  // ---------- aperçu ----------
  let prevURL = null, pvTimer = null;
  function schedulePreview(delay = 250) { clearTimeout(pvTimer); pvTimer = setTimeout(renderPreview, delay); }
  function renderPreview() {
    const img = $('.ed-card img');
    if (!img) return;
    const url = generatedCardURL({ id: sel, clinical: cur.clinical, injuries: cur.injuries }, { ...cardOpts, view });
    img.src = url;
    if (prevURL) setTimeout(((u) => () => URL.revokeObjectURL(u))(prevURL), 500);
    prevURL = url;
    $('.ed-view').textContent = view === 'dos' ? '↻ Voir la face' : '↻ Voir le dos';
    const st = cur.evo.stages;
    $('.ed-timeline').innerHTML = `<h4>Évolution sans prise en charge</h4><ol>
      <li><span class="ed-t">T+0</span><span class="tag t-${cur.truth.triage}">${TRI_LABEL[cur.truth.triage] ?? '?'}</span> fiche imprimée</li>
      ${st.map((s) => `<li class="st-${s.status}"><span class="ed-t">T+${s.at}</span><span class="tag t-${s.triage}">${TRI_LABEL[s.triage] ?? '?'}</span> ${s.status === 'DEAD' ? '† ' : ''}${esc(s.text || '…')}</li>`).join('')}
      </ol>${st.length ? '' : '<p class="muted small">Pas d\'aggravation prévue.</p>'}`;
  }
  $('.ed-view').onclick = () => { view = view === 'dos' ? 'face' : 'dos'; renderPreview(); };

  // ---------- publier / abandonner ----------
  function confirmBox(title, text, ok, onOk, onCancel) {
    const d = $('.ed-dialog');
    d.innerHTML = `<div class="ed-dlg"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="ed-dlg-actions"><button type="button" class="muted-btn" data-x>Annuler</button><button type="button" class="ed-primary" data-ok>${esc(ok)}</button></div></div>`;
    d.hidden = false;
    d.querySelector('[data-ok]').focus();
    d.querySelector('[data-x]').onclick = () => { d.hidden = true; onCancel?.(); };
    d.querySelector('[data-ok]').onclick = () => { d.hidden = true; onOk(); };
  }
  $('.ed-drop').onclick = () => confirmBox('Abandonner le brouillon ?', pub ? 'Les fiches reviennent à la version publiée.' : 'Toutes les corrections non publiées seront perdues.', 'Abandonner', () => {
    dropDraft(sc.id);
    corr = clone(pub ?? emptyCorrections(sc.id)); corr.victims ??= {};
    cur = effective(sel); renderList(); renderForm(); schedulePreview(0); setStatus();
  });
  $('.ed-publish').onclick = async () => { await save(); publishDialog(); };

  const fileName = () => `corrections-${sc.id}.enc`;
  const sealed = () => sealForPublish(key, sc.id, { ...corr, v: 1, scenario: sc.id, updated: new Date().toISOString() });
  async function download(btn) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([await sealed()], { type: 'application/octet-stream' }));
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    if (btn) btn.textContent = '✓ Téléchargé — étape 2 ↓';
  }
  const manualSteps = () => `
    <ol class="ed-steps">
      <li><button type="button" class="ed-primary" data-dl>⬇ Télécharger ${fileName()}</button><br><span class="muted">Fichier chiffré : illisible sans le code.</span></li>
      <li>Sur votre ordinateur, lancez <code>py outils/publier.py</code>. Il trouve le fichier dans <b>Téléchargements</b> et l'ajoute au jeu (jeu/SMUR-Tri) tout seul.</li>
      <li>GitHub Desktop : <b>Commit</b> puis <b>Push</b>.</li>
    </ol>`;

  async function publishDialog() {
    const n = Object.keys(corr.victims).length;
    const d = $('.ed-dialog');
    const cfg = await loadGH(key);
    d.innerHTML = `<div class="ed-dlg wide">
      <h3>⬆ Publier les corrections</h3>
      <p>${n} fiche${n > 1 ? 's' : ''} corrigée${n > 1 ? 's' : ''}. Elles sont déjà actives <b>dans ce navigateur</b> ; pour tous les joueurs :</p>
      ${cfg ? `
        <div class="ed-gh">
          <button type="button" class="ed-primary big" data-push>🚀 Publier sur GitHub</button>
          <p class="muted small">Dépôt <b>${esc(cfg.repo)}</b> · branche ${esc(cfg.branch)} · le site est à jour 1 à 2 min après.</p>
          <p class="ed-gh-msg" hidden></p>
          <p class="small"><button type="button" class="linkish" data-gh-setup>Réglages</button> · <button type="button" class="linkish" data-gh-forget>Oublier le jeton sur cet ordinateur</button></p>
        </div>
        <details class="ed-adv"><summary>Autre méthode : télécharger le fichier</summary>${manualSteps()}</details>`
      : `${manualSteps()}
        <div class="ed-gh-offer"><b>Publier en un clic depuis cet ordinateur ?</b>
          <span class="muted small">Réglage à faire une seule fois : un jeton GitHub limité au dépôt du jeu.</span>
          <button type="button" data-gh-setup>Configurer la publication directe…</button></div>`}
      <div class="ed-dlg-actions"><button type="button" class="muted-btn" data-x>Fermer</button></div></div>`;
    d.hidden = false;
    d.querySelector('[data-x]').onclick = () => { d.hidden = true; };
    d.querySelector('[data-dl]').onclick = (e) => download(e.currentTarget);
    d.querySelectorAll('[data-gh-setup]').forEach((b) => (b.onclick = () => setupDialog(cfg)));
    const forget = d.querySelector('[data-gh-forget]');
    if (forget) forget.onclick = () => { forgetGH(); publishDialog(); };
    const push = d.querySelector('[data-push]');
    if (push) push.onclick = async () => {
      const msg = d.querySelector('.ed-gh-msg');
      push.disabled = true; push.textContent = 'Envoi en cours…';
      msg.hidden = true;
      try {
        const bytes = await sealed();
        const path = `${sc.base.replace(/^\.?\//, '')}corrections.enc`;
        const url = await putFile(cfg, path, bytes, `Corrections des fiches (${sc.id}) : ${n} fiche${n > 1 ? 's' : ''}`);
        pushed = clone(corr.victims);         // le brouillon reste actif ici jusqu'à ce que le site serve la nouvelle version
        setStatus();
        push.textContent = '✓ Publié sur GitHub';
        msg.hidden = false; msg.className = 'ed-gh-msg ok';
        msg.innerHTML = `Envoyé. Le site sera à jour d'ici 1 à 2 minutes.${url ? ` <a href="${url}" target="_blank" rel="noopener">Voir sur GitHub</a>` : ''}<br><span class="muted small">Pensez à faire <b>Pull</b> (« Fetch origin ») dans GitHub Desktop avant votre prochaine publication avec publier.py.</span>`;
      } catch (err) {
        push.disabled = false; push.textContent = '🚀 Réessayer';
        msg.hidden = false; msg.className = 'ed-gh-msg bad';
        msg.textContent = err.message || 'Publication impossible.';
      }
    };
  }

  function setupDialog(cfg) {
    const d = $('.ed-dialog');
    d.innerHTML = `<form class="ed-dlg wide" autocomplete="off">
      <h3>Publication directe sur GitHub</h3>
      <p class="muted small">À faire <b>une seule fois, sur votre ordinateur personnel</b>. Le jeton reste dans ce navigateur, chiffré, et ne sert qu'avec le code d'accès. N'utilisez pas un poste partagé.</p>
      <ol class="ed-steps small">
        <li>Sur github.com : photo de profil → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Ouvrir la page</a></li>
        <li>Nom : « Éditeur fiches » · Expiration : au choix (1 an par exemple).</li>
        <li><b>Repository access</b> : <i>Only select repositories</i> → choisir le dépôt du jeu.</li>
        <li><b>Permissions</b> → Repository permissions → <b>Contents : Read and write</b> (rien d'autre).</li>
        <li><b>Generate token</b>, copier le jeton (github_pat_…) et le coller ci-dessous.</li>
      </ol>
      <label class="ed-field"><span>Dépôt <em>compte/nom-du-dépôt</em></span><input name="repo" value="${esc(cfg?.repo ?? guessRepo())}" placeholder="moncompte/smur-tri" spellcheck="false" /></label>
      <label class="ed-field"><span>Jeton</span><input name="token" type="password" value="${esc(cfg?.token ?? '')}" placeholder="github_pat_…" spellcheck="false" /></label>
      <details class="ed-adv"><summary>Avancé</summary>
        <label class="ed-field"><span>Branche <em>vide = branche principale</em></span><input name="branch" value="${esc(cfg?.branch ?? '')}" placeholder="main" /></label>
        <label class="ed-field"><span>Dossier du jeu dans le dépôt <em>vide = racine (cas normal avec publier.py)</em></span><input name="dir" value="${esc(cfg?.dir ?? '')}" /></label>
      </details>
      <p class="ed-gh-msg" hidden></p>
      <div class="ed-dlg-actions"><button type="button" class="muted-btn" data-back>Retour</button><button type="submit" class="ed-primary">Vérifier et enregistrer</button></div>
    </form>`;
    d.hidden = false;
    const f = d.querySelector('form');
    f.querySelector(cfg?.repo || guessRepo() ? '[name=token]' : '[name=repo]').focus();
    d.querySelector('[data-back]').onclick = () => publishDialog();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const msg = f.querySelector('.ed-gh-msg');
      const btn = f.querySelector('[type=submit]');
      const c = { repo: f.repo.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''),
        token: f.token.value.trim(), branch: f.branch.value.trim(), dir: f.dir.value.trim().replace(/^\/|\/$/g, '') };
      btn.disabled = true; btn.textContent = 'Vérification…';
      const r = await checkGH(c);
      btn.disabled = false; btn.textContent = 'Vérifier et enregistrer';
      msg.hidden = false;
      if (!r.ok) { msg.className = 'ed-gh-msg bad'; msg.textContent = r.msg; return; }
      c.branch = r.branch;
      await saveGH(key, c);
      publishDialog();
    };
  }

  $('.ed-close').onclick = async () => { await save(); close(); };
  root.onkeydown = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    const d = $('.ed-dialog');
    if (d && !d.hidden) { d.hidden = true; return; }
    $('.ed-close').click();
  };
  $('.ed-sc')?.addEventListener('change', async (e) => {
    await save();
    await loadScenario(list.find((s) => s.id === e.target.value));
    pushed = null;
    sel = orig[0].id; cur = effective(sel);
    renderList(); renderForm(); schedulePreview(0); setStatus();
  });

  renderList();
  renderForm();
  renderPreview();
  setStatus();
  window.__editor = { get corr() { return corr; }, select, save };   // tests
}
