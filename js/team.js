// ============================================================
//  L'équipe SMUR du joueur : un pion sur le plan, un périmètre
//  d'action, des déplacements qui prennent du temps.
// ============================================================
//  On n'examine / soigne que les victimes à portée (reachMeters).
//  Cliquer plus loin fait marcher l'équipe (speedMps) : impossible de
//  « sauter » d'un bout à l'autre de la salle.

export function createTeam(state, scenario, plan) {
  const t = scenario.team ?? {};
  const pxPerM = plan.w / (scenario.scale?.planWidthMeters ?? 50);
  const start = t.start ?? [0.5, 0.9];
  const team = {
    label: t.label ?? 'SMUR',
    x: start[0] * plan.w,
    y: start[1] * plan.h,
    reach: (t.reachMeters ?? 4) * pxPerM,
    speed: (t.speedMps ?? 1.5) * pxPerM,     // px par seconde de jeu
    target: null,                            // { x, y, victim? }
    walkedM: 0,
  };
  let onArrive = null;

  const toM = (px) => px / pxPerM;
  const dist = (x, y) => Math.hypot(x - team.x, y - team.y);
  const inReach = (v) => dist(v.x, v.y) <= team.reach + v.w * 0.5;

  /** Se diriger vers un point ou une victime (ouverture automatique à l'arrivée) */
  function goTo(x, y, victim = null) {
    team.target = { x, y, victim };
  }

  /** Secondes de marche pour atteindre la portée de la victime */
  function etaTo(v) {
    return Math.max(0, toM(dist(v.x, v.y) - team.reach - v.w * 0.5)) / (team.speed / pxPerM);
  }

  function update(dtMs) {
    const tg = team.target;
    if (!tg || !state.clock.running) return;
    if (tg.victim && (tg.victim.evac?.state === 'pma')) { team.target = null; return; }
    const tx = tg.victim ? tg.victim.x : tg.x;
    const ty = tg.victim ? tg.victim.y : tg.y;
    if (tg.victim && inReach(tg.victim)) {
      team.target = null;
      onArrive?.(tg.victim);
      return;
    }
    const d = dist(tx, ty);
    const step = team.speed * (dtMs / 1000);
    if (d <= step) {
      team.walkedM += toM(d);
      team.x = tx; team.y = ty;
      if (!tg.victim) team.target = null;
    } else {
      team.walkedM += toM(step);
      team.x += ((tx - team.x) / d) * step;
      team.y += ((ty - team.y) / d) * step;
    }
  }

  // ---------- dessin (repère écran, par-dessus la pénombre) ----------
  function draw(ctx, camera, now) {
    const [sx, sy] = camera.worldToScreen(team.x, team.y);
    const r = team.reach * camera.zoom;

    // périmètre d'action
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.75)';
    ctx.fillStyle = 'rgba(120, 200, 255, 0.07)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -now / 60;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // trajet en cours
    const tg = team.target;
    if (tg) {
      const [tx, ty] = camera.worldToScreen(tg.victim ? tg.victim.x : tg.x, tg.victim ? tg.victim.y : tg.y);
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.9)';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    // pion
    ctx.save();
    ctx.fillStyle = '#0b3d91';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(sx, sy, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '800 9px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(team.label, sx, sy + 0.5);
    if (tg) {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(200, 230, 255, 0.95)';
      ctx.fillText('déplacement…', sx, sy + 26);
    }
    ctx.restore();
  }

  return {
    team, goTo, etaTo, inReach, update, draw,
    distMeters: (v) => toM(dist(v.x, v.y)),
    stop: () => { team.target = null; },
    set onArrive(fn) { onArrive = fn; },
  };
}
