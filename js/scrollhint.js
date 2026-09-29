// ============================================================
//  « ▼ suite » : signale clairement qu'un panneau défile
// ============================================================
//  Ajoute en bas de chaque .scroll-hint un bandeau (dégradé + bouton) visible
//  tant qu'il reste du contenu caché dessous ; un clic fait défiler.

export function setupScrollHints(root = document) {
  const boxes = [...root.querySelectorAll('.scroll-hint')];
  for (const box of boxes) {
    const more = document.createElement('div');
    more.className = 'scroll-more';
    more.hidden = true;
    more.innerHTML = '<span>▼ suite en dessous</span>';
    more.querySelector('span').addEventListener('click', () => box.scrollBy({ top: box.clientHeight * 0.7, behavior: 'smooth' }));
    box.appendChild(more);
    const check = () => {
      const hide = box.scrollHeight - box.scrollTop - box.clientHeight <= 6 || box.offsetParent === null;
      if (more.hidden !== hide) more.hidden = hide;          // n'écrit que si ça change (sinon boucle avec l'observateur)
    };
    box.addEventListener('scroll', check, { passive: true });
    new ResizeObserver(check).observe(box);
    new MutationObserver((recs) => { if (recs.some((r) => r.target !== more)) check(); })
      .observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    addEventListener('resize', check);
    box._checkMore = check;
    check();
  }
  return () => boxes.forEach((b) => b._checkMore?.());
}
