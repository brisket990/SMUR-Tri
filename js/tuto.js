// ============================================================
//  Tuto « Comment jouer » : légende du plan, du tri et du sac
//  Affiché dans un onglet du briefing et en jeu (touche H).
// ============================================================

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
};

export function mountTuto(host) {
  if (!host || host.childElementCount) return;
  host.appendChild(document.getElementById('tuto-tpl').content.cloneNode(true));
}

/** Onglets Situation / Comment jouer du briefing */
export function setupBriefingTabs() {
  const box = document.getElementById('briefing');
  const tabs = [...box.querySelectorAll('.briefing-tabs [data-tab]')];
  const panes = [...box.querySelectorAll('[data-pane]')];
  const badge = document.getElementById('tuto-new');
  mountTuto(box.querySelector('.tuto-host'));
  badge.hidden = store.get('smur.tutoSeen') === '1';   // badge « à lire » tant que jamais ouvert

  function show(name) {
    tabs.forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    panes.forEach((p) => (p.hidden = p.dataset.pane !== name));
    if (name === 'tuto') { badge.hidden = true; store.set('smur.tutoSeen', '1'); }
  }
  tabs.forEach((t) => (t.onclick = () => show(t.dataset.tab)));
  show('situation');
  return { show };
}

/** Aide en jeu : touche H ou bouton, Échap pour fermer */
export function setupHelp() {
  const box = document.getElementById('help');
  mountTuto(box.querySelector('.tuto-host'));
  const open = () => { box.hidden = false; };
  const close = () => { box.hidden = true; };
  document.getElementById('help-close').addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  addEventListener('keydown', (e) => { if (!box.hidden && e.key === 'Escape') close(); });
  return { open, close, isOpen: () => !box.hidden };
}
