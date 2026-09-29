// ============================================================
//  Ordres aux équipes : choix d'une zone, avec la zone éclairée sur le plan
// ============================================================
//  Menu maison (et non un <select>) : survoler une zone de la liste
//  l'éclaire sur le plan avant de la choisir. Survoler la ligne d'une
//  équipe éclaire la zone qu'elle a en ordre.

const light = { id: null, team: '' };   // zone éclairée en ce moment

export function createOrderPicker({ zones, team, onPick }) {
  const root = document.createElement('div');
  root.className = 'order-picker';
  root.innerHTML = `<button type="button" class="op-btn" title="Donner une zone à ${team} ; sans ordre ou zone terminée, l'équipe s'autogère"></button>
    <ul class="op-list" hidden>
      <li><button type="button" data-z="">Autonome (pas d'ordre)</button></li>
      ${zones.map((z) => `<li><button type="button" data-z="${z.id}">${z.label}</button></li>`).join('')}
    </ul>`;
  const btn = root.querySelector('.op-btn');
  const list = root.querySelector('.op-list');
  let value = '';

  const labelOf = (id) => (id ? `Ordre : ${zones.find((z) => z.id === id)?.label ?? id}` : 'Autonome (pas d\'ordre)');
  function set(id) {
    value = id;
    btn.textContent = `${labelOf(id)} ▾`;
    btn.classList.toggle('has-order', !!id);
    list.querySelectorAll('[data-z]').forEach((b) => b.classList.toggle('on', b.dataset.z === id));
  }
  const openList = (o) => { list.hidden = !o; root.classList.toggle('open', o); if (!o) light.id = null; };

  btn.addEventListener('click', (e) => { e.stopPropagation(); openList(list.hidden); });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-z]');
    if (!b) return;
    e.stopPropagation();
    set(b.dataset.z);
    openList(false);
    onPick?.(b.dataset.z);
  });
  list.addEventListener('mouseover', (e) => {
    const b = e.target.closest('[data-z]');
    if (b) { light.id = b.dataset.z || null; light.team = team; }
  });
  list.addEventListener('mouseleave', () => { light.id = null; });
  // survol de la ligne (menu fermé) : zone actuellement en ordre
  root.addEventListener('mouseenter', () => { if (list.hidden && value) { light.id = value; light.team = team; } });
  root.addEventListener('mouseleave', () => { if (list.hidden) light.id = null; });
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) openList(false); });

  set('');
  return { el: root, set, get: () => value };
}

/** Calque : la zone survolée est « éclairée » par-dessus la pénombre */
export function drawZoneLight(ctx, camera, scenario, plan, timeSec) {
  if (!light.id) return;
  const z = (scenario.zones ?? []).find((x) => x.id === light.id);
  if (!z) return;
  const pulse = 0.75 + 0.25 * Math.sin(timeSec * 4);
  ctx.save();
  let top = null;
  for (const [x, y, w, h] of z.rects) {
    const [sx, sy] = camera.worldToScreen(x * plan.w, y * plan.h);
    const [ex, ey] = camera.worldToScreen((x + w) * plan.w, (y + h) * plan.h);
    ctx.fillStyle = `rgba(255, 236, 170, ${0.22 * pulse})`;
    ctx.shadowColor = 'rgba(255, 220, 120, 0.9)';
    ctx.shadowBlur = 18;
    ctx.fillRect(sx, sy, ex - sx, ey - sy);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255, 213, 79, ${0.95 * pulse})`;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(sx, sy, ex - sx, ey - sy);
    if (!top || (ex - sx) * (ey - sy) > top.a) top = { x: (sx + ex) / 2, y: sy, a: (ex - sx) * (ey - sy) };
  }
  // étiquette
  if (top) {
    const text = `${light.team} → ${z.label}`;
    ctx.setLineDash([]);
    ctx.font = '700 14px system-ui, sans-serif';
    const tw = ctx.measureText(text).width + 18;
    const lx = top.x - tw / 2, ly = Math.max(6, top.y - 32);
    ctx.fillStyle = 'rgba(255, 213, 79, 0.95)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(lx, ly, tw, 24, 12); else ctx.rect(lx, ly, tw, 24);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, top.x, ly + 12.5);
  }
  ctx.restore();
}
