// ============================================================
//  Fiche victime plein écran
//  - tri en cliquant directement les cases imprimées sur la fiche
//  - gestes du premier tour (panneau de droite)
//  - fenêtre de réévaluation quand l'état a évolué
// ============================================================

import { CONFIG, TRIAGE } from './config.js';
import { formatTime } from './hud.js';
import { KIND_LABEL } from './evolution.js';

const JUDGE_LABEL = { exact: 'Tri juste', accepted: 'Tri défendable', over: 'Sur-tri', under: 'Sous-tri' };

export function createModal({ state, evac, onEvac, rescuers, onRescuer, onTriage, onCare, onClose, onRevealed, onView, onEvoAt }) {
  const $ = (id) => document.getElementById(id);
  const modal = $('victim-modal');
  const title = $('modal-title');
  const img = $('modal-img');
  const back = $('modal-back');
  const flip = $('modal-flip');
  const hotspots = modal.querySelector('.triage-hotspots');
  const hsButtons = [...modal.querySelectorAll('[data-triage]')];
  const careBox = $('care-buttons');
  const toast = $('care-toast');
  const done = $('care-done');
  const popup = $('evo-popup');
  const evoHist = $('evo-hist');
  const evoHistTitle = $('evo-hist-title');
  let current = null;
  let popupDelay = null;

  // ---------- boutons de gestes (générés depuis la config) ----------
  const posBox = $('pos-buttons');
  // pictogrammes des positions d'attente (vue de profil, sol en bas)
  const L = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`;
  const H = (x, y) => `<circle cx="${x}" cy="${y}" r="2.9" fill="currentColor"/>`;
  const G = '<line x1="1" y1="19" x2="43" y2="19" stroke="currentColor" stroke-width="1" opacity=".35"/>';
  const POS_ICON = {
    pls: G + H(6, 12.5) + L('M9 14 L24 15') + L('M24 15 L31 9.5 L36 15') + L('M24 16 L39 17.5') + L('M10 16.5 L16 18'),
    posSit: G + '<line x1="5" y1="19" x2="15" y2="4" stroke="currentColor" stroke-width="1" opacity=".45"/>' + H(12.5, 4.5) + L('M14.5 8 L21 16.5') + L('M21 16.5 L39 17') + L('M16 10.5 L22 13'),
    posLegs: G + '<rect x="30" y="10" width="11" height="9" rx="1" fill="currentColor" opacity=".25"/>' + H(5, 15.5) + L('M8 16.5 L22 16.5') + L('M22 16.5 L39 8.5'),
    posFlexed: G + H(5, 15.5) + L('M8 16.5 L23 16.5') + L('M23 16.5 L30 8 L37 17.5'),
    posFlat: G + H(5, 15.5) + L('M8 16.5 L24 16.5') + L('M24 16.5 L40 16.5'),
  };
  const careButtons = Object.entries(CONFIG.items).map(([key, item]) => {
    const b = document.createElement('button');
    b.dataset.care = key;
    b.innerHTML = POS_ICON[key]
      ? `<svg class="pos-ico" viewBox="0 0 44 21" aria-hidden="true">${POS_ICON[key]}</svg><span class="pos-label">${item.label}</span><span class="qty"></span>`
      : `<span>${item.label}</span><span class="qty"></span>`;
    if (item.group === 'position') b.classList.add('pos-btn');
    b.addEventListener('click', () => {
      if (!current) return;
      const res = onCare(current.id, key);
      showToast(res, key);
      refresh();
    });
    (item.group === 'position' && posBox ? posBox : careBox).appendChild(b);
    return b;
  });

  // ---------- MPAP : envoi au PMA et évolution à la demande ----------
  const pmaBtn = $('evac-pma');
  pmaBtn.addEventListener('click', () => evacAction('pma')());   // evacAction est défini plus bas
  const evoBox = $('mpap-evo');
  const evoNote = $('mpap-evo-note');
  const EVO_TIMES = [0, 5, 10, 20, 30];
  evoBox.innerHTML = EVO_TIMES.map((m) => `<button type="button" data-evo="${m}">${m ? `T+${m}` : 'Initial'}</button>`).join('');
  evoBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-evo]');
    if (!b || !current || !onEvoAt) return;
    const res = onEvoAt(current, Number(b.dataset.evo));
    evoNote.textContent = res?.message ?? '';
    refresh();
  });
  function refreshMpap(v) {
    if (!state.mpap) return;
    const has = v.evo.stages.length > 0;
    evoBox.querySelectorAll('[data-evo]').forEach((b) => {
      b.classList.toggle('on', Number(b.dataset.evo) === (v.mpapT ?? 0));
      b.disabled = !has;
    });
    if (!has) evoNote.textContent = 'Pas d\'évolution prévue pour cette victime.';
    const st = v.evac?.state ?? 'none';
    pmaBtn.disabled = st === 'pma' || v.status === 'DEAD';
    pmaBtn.textContent = st === 'pma' ? '🏥 Au PMA' : '🏥 Envoyer au PMA';
  }

  // ---------- vue de face / de dos (fiches générées) ----------
  const viewBtn = $('card-view-btn');
  const viewLabel = (v) => (v.cardView === 'dos' ? '↻ Voir de face' : '↻ Voir le dos');
  viewBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!current || !onView) return;
    viewBtn.disabled = true;
    await onView(current);
    viewBtn.disabled = false;
    viewBtn.textContent = viewLabel(current);
  });

  /** La fiche a été redessinée (geste posé, vue changée) */
  function updateImage(v) {
    if (current !== v) return;
    img.src = v.src;
  }

  // ---------- évacuation ----------
  const evacStatus = $('evac-status');
  const evacWalk = $('evac-walk');
  const evacStretch = $('evac-stretcher');
  const evacCancel = $('evac-cancel');
  const evacPrio = $('evac-priority');
  const evacAction = (mode) => () => {
    if (!current || !onEvac) return;
    const res = onEvac(current.id, mode);
    toast.textContent = res.message;
    toast.classList.toggle('warn', !res.ok);
    refresh();
  };
  evacWalk.addEventListener('click', evacAction('walk'));
  evacStretch.addEventListener('click', evacAction('stretcher'));
  evacCancel.addEventListener('click', evacAction('cancel'));
  evacPrio.addEventListener('click', evacAction('priority'));

  // ---------- secouriste ----------
  const rescStatus = $('resc-status');
  const rescPost = $('resc-post');
  const rescFree = $('resc-free');
  const rescAction = (what) => () => {
    if (!current || !onRescuer) return;
    const res = onRescuer(current.id, what);
    toast.textContent = res.message;
    toast.classList.toggle('warn', !res.ok);
    refresh();
  };
  rescPost.addEventListener('click', rescAction('post'));
  rescFree.addEventListener('click', rescAction('free'));

  function refreshRescuer(v) {
    if (!rescuers) return;
    const r = rescuers.of(v);
    const s = rescuers.summary();
    rescStatus.textContent = r
      ? `${r.id} (${r.org}) : ${r.mode}`
      : s.total ? `Secouristes libres : ${s.free} / ${s.total}` : `Aucun secouriste sur place${s.next ? ` · ${s.next.org} dans ${Math.ceil(s.next.inMs / 60000)} min` : ''}`;
    rescStatus.className = `evac-status ${r ? 's-pickup' : ''}`;
    rescPost.hidden = !!r;
    rescPost.disabled = !s.free || v.status === 'DEAD' || ['pma', 'transport', 'loading', 'walking'].includes(v.evac?.state);
    rescFree.hidden = !r;
  }

  function refreshEvac(v) {
    if (!evac) return;
    const st = v.evac?.state ?? 'none';
    evacStatus.textContent = evac.statusText(v);
    evacStatus.className = `evac-status s-${st}`;
    const free = st === 'none';
    const untriaged = !v.assignedTriage;
    for (const b of [evacWalk, evacStretch]) {
      b.disabled = !free || untriaged || v.status === 'DEAD';
      b.title = untriaged ? 'Triez la victime d\'abord' : '';
    }
    evacCancel.hidden = st !== 'queued';
    // priorité : possible si la victime est triée et pas encore prise en charge
    const prio = !!v.evac?.priority;
    evacPrio.hidden = !['none', 'queued'].includes(st) || v.status === 'DEAD';
    evacPrio.disabled = untriaged || prio;
    evacPrio.textContent = prio ? '⚡ Prioritaire (demandé)' : '⚡ Brancardage prioritaire';
    evacPrio.classList.toggle('on', prio);
  }

  function showToast(res, key) {
    let msg = res.message;
    if (res.kind === 'impossible') msg = res.message; // toujours expliqué : c'est une impossibilité physique
    else if (CONFIG.immediateFeedback && res.kind) {
      const detail = current.actions[key]?.msg;
      msg = `${KIND_LABEL[res.kind] ?? ''} — ${res.message}${detail ? ' ' + detail : ''}`;
    }
    toast.textContent = msg;
    toast.classList.toggle('warn', !res.ok);
  }

  // ---------- rafraîchissement ----------
  function refresh() {
    if (!current) return;
    const v = current;

    const choice = v.assignedTriage;
    hsButtons.forEach((b) => b.classList.toggle('active', b.dataset.triage === choice));
    hotspots.classList.toggle('has-choice', !!choice);

    let tri = choice ? ` — ${TRIAGE[choice].short}` : '';
    if (choice && CONFIG.immediateFeedback) tri += ` (${JUDGE_LABEL[v.triageJudgement]})`;
    const dead = v.status === 'DEAD' ? ' — ✝ décédé' : '';
    title.textContent = `${v.id} · ${v.zoneLabel ?? v.zone}${tri}${dead}`;

    careButtons.forEach((b) => {
      const key = b.dataset.care;
      const item = CONFIG.items[key];
      const q = b.querySelector('.qty');
      if (item.group === 'position') {
        const on = v.position === key;
        q.textContent = on ? '✓' : '';
        b.classList.toggle('on', on);
        b.disabled = on;
      } else if (item.consumable === false) {
        q.textContent = v.care[key] ? '✓' : '';
        b.disabled = !!v.care[key];
      } else {
        const n = state.inventory[key] ?? 0;
        q.textContent = n > 0 ? `×${n}` : (item.note && !state.inventoryEver?.[key] ? 'à venir' : 'épuisé');
        if (item.note) b.title = item.note;
        q.classList.toggle('empty', n === 0);
        b.disabled = n === 0;
      }
    });

    done.innerHTML = v.careLog.length
      ? v.careLog.map((c) => {
          const cls = CONFIG.immediateFeedback ? `k-${c.kind}` : '';
          const it = CONFIG.items[c.action];
          const who = c.by ? ` <span class="muted">(${c.by})</span>` : '';
          return `<li class="${cls}">${state.mpap ? '' : `<span class="t">${formatTime(c.t)}</span>`}${it.group === 'position' ? 'Position : ' + it.label.toLowerCase() : it.label}${who}</li>`;
        }).join('')
      : '<li class="muted">Aucun</li>';

    refreshEvac(v);
    refreshRescuer(v);
    refreshMpap(v);
    refreshSheet(v);

    const seen = v.evo.stages.slice(0, v.evo.seenStage);
    evoHistTitle.hidden = seen.length === 0;
    evoHist.innerHTML = seen
      .map((s) => `<li><span class="t">${formatTime(s.atMs)}</span>${s.text}<br><span class="muted">${s.params}</span></li>`)
      .join('');
  }

  // ---------- évolution complète par-dessus la fiche ----------
  const esSheet = $('evo-sheet');
  const esBody = $('es-body');
  const esShow = $('es-show');
  let esHidden = false;           // le joueur a demandé à revoir la fiche d'origine
  let esKey = '';
  $('es-hide').addEventListener('click', () => { esHidden = true; esKey = ''; refresh(); });
  esShow.addEventListener('click', () => { esHidden = false; esKey = ''; refresh(); });

  function refreshSheet(v) {
    const n = v.evo.seenStage;     // seules les évolutions déjà annoncées (la fenêtre de réévaluation annonce les nouvelles)
    esSheet.hidden = !n || esHidden;
    esShow.hidden = !n || !esHidden;
    const key = `${v.id}|${n}|${v.status}`;
    if (!n || key === esKey) return;
    esKey = key;
    const seen = v.evo.stages.slice(0, n);
    const cur = seen[n - 1];
    const dead = v.status === 'DEAD';
    esBody.innerHTML = `
      <div class="es-now ${dead ? 'dead' : ''}">
        <div class="es-t">${dead ? '✝ Décès constaté' : 'Maintenant'} · T+${formatTime(cur.atMs)}</div>
        <div class="es-text">${cur.text}</div>
        ${cur.params ? `<div class="es-params">${cur.params}</div>` : ''}
      </div>
      <ol class="es-steps">
        <li><span class="t">T+00:00</span>Fiche imprimée (état initial)</li>
        ${seen.slice(0, -1).map((st) => `<li><span class="t">T+${formatTime(st.atMs)}</span>${st.text}${st.params ? `<br><span class="p">${st.params}</span>` : ''}</li>`).join('')}
        <li class="cur"><span class="t">T+${formatTime(cur.atMs)}</span>${dead ? 'Décès' : 'État actuel (ci-dessus)'}</li>
      </ol>`;
  }

  // ---------- réévaluation ----------
  function hasNews(v) {
    return v.evo.stage > v.evo.seenStage;
  }

  function showEvolution() {
    popupDelay = null; // popupDelay sert de verrou pendant l'animation de retournement
    const v = current;
    if (!v || !hasNews(v)) return;
    const fresh = v.evo.stages.slice(v.evo.seenStage, v.evo.stage);
    const last = fresh[fresh.length - 1];
    $('evo-time').textContent = `T+${formatTime(last.atMs)}`;
    const deadBanner = v.status === 'DEAD' ? '<div class="evo-dead">✝ Décès constaté</div>' : '';
    const more = fresh.length > 1
      ? `<p class="muted small">${fresh.length} aggravations depuis la dernière évaluation.</p>` : '';
    $('evo-content').innerHTML = `${deadBanner}<p class="evo-text">${last.text}</p>`
      + (last.params ? `<div class="evo-params">${last.params}</div>` : '') + more;
    popup.hidden = false;
  }

  function ackEvolution() {
    if (!current) return;
    current.evo.seenStage = current.evo.stage;
    popup.hidden = true;
    refresh();
  }
  $('evo-ok').addEventListener('click', ackEvolution);

  // ---------- retournement de la carte ----------
  //  En deux temps pour ne jamais dépendre de backface-visibility (mal gérée
  //  par certains navigateurs) : le verso seul pivote jusqu'à la tranche,
  //  puis le recto seul termine la rotation.
  let flipRun = null; // jeton : une nouvelle ouverture annule l'animation en cours
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function setFlip(deg, ms = 0, ease = 'linear') {
    flip.style.transition = ms ? `transform ${ms}ms ${ease}` : 'none';
    flip.style.transform = `rotateY(${deg}deg)`;
    if (!ms) void flip.offsetWidth; // applique immédiatement, sans animation
  }

  async function flipReveal(backSrc) {
    const run = (flipRun = {});
    back.src = backSrc;
    flip.dataset.side = 'back';          // seul le verso est visible
    setFlip(180);
    // le recto doit être décodé avant de commencer, sinon il "pop" en cours de route
    await Promise.all([img.decode?.(), back.decode?.()].map((p) => p?.catch(() => {})));
    await wait(220);
    if (run !== flipRun) return false;
    setFlip(90, 300, 'ease-in');         // verso → tranche
    await wait(300);
    if (run !== flipRun) return false;
    flip.dataset.side = 'front';         // bascule invisible : la carte est vue par la tranche
    setFlip(0, 420, 'cubic-bezier(.2,.8,.3,1)');
    await wait(420);
    return run === flipRun;
  }

  function showFront() {
    flipRun = null;
    back.removeAttribute('src');
    flip.dataset.side = 'front';
    setFlip(0);
  }

  // ---------- ouverture / fermeture ----------
  function open(victim, backSrc = null) {
    current = victim;
    evoNote.textContent = '';
    viewBtn.hidden = !victim.entry || !onView;
    if (victim.entry) viewBtn.textContent = viewLabel(victim);
    esHidden = false;
    esKey = '';
    img.src = victim.src;
    popup.hidden = true;
    toast.textContent = '';
    clearTimeout(popupDelay);
    popupDelay = null;
    if (backSrc) {
      flip.dataset.side = 'back';        // avant affichage : aucune image du recto ne peut flasher
      setFlip(180);
    } else {
      showFront();
    }
    modal.hidden = false;
    refresh();
    // la fiche imprimée = état initial ; s'il a changé depuis, on l'annonce par-dessus
    const news = hasNews(victim);
    if (backSrc) {
      if (news) popupDelay = 'flip'; // verrou : pas de réévaluation pendant le retournement
      flipReveal(backSrc).then((done) => {
        if (!done || current !== victim) return;
        if (onRevealed?.(victim) === false) return; // false = la partie s'arrête (mode non autorisé)
        if (news) showEvolution();
      });
    } else if (news) {
      popupDelay = setTimeout(showEvolution, 150);
    }
  }

  function close() {
    if (!current) return;
    flipRun = null;
    clearTimeout(popupDelay);
    popupDelay = null;
    if (!popup.hidden) current.evo.seenStage = current.evo.stage;
    modal.hidden = true;
    popup.hidden = true;
    img.removeAttribute('src');
    current = null;
    onClose?.();
  }

  // Appelé par la boucle de jeu : la victime peut s'aggraver sous nos yeux
  function tick() {
    if (!current) return;
    if (popup.hidden && hasNews(current) && !popupDelay) showEvolution();
    refresh();
  }

  function setTriage(cat) {
    if (!current) return;
    onTriage(current.id, cat);
    refresh();
  }

  hsButtons.forEach((b) => b.addEventListener('click', () => setTriage(b.dataset.triage)));
  $('modal-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  addEventListener('keydown', (e) => {
    if (!current) return;
    if (e.key === 'Escape') { if (!popup.hidden) ackEvolution(); else close(); return; }
    if (e.key === 'Enter' && !popup.hidden) { ackEvolution(); return; }
    // touches dans l'ordre du cartouche : 1 UD, 2 UA, 3 UR, 4 Impliqué
    const k = { 1: 'BLACK', 2: 'RED', 3: 'YELLOW', 4: 'GREEN' }[e.key];
    if (k) setTriage(k);
  });

  return { open, close, tick, updateImage, isOpen: () => current != null };
}
