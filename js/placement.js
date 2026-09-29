// ============================================================
//  Répartition des 150 victimes dans les zones de la salle
// ============================================================
//  - Une victime avec `zone` renseignée dans victims.json y est placée.
//  - Une victime avec `x`/`y` (0..1) renseignés garde cette position exacte.
//  - Les autres sont réparties selon le poids (`weight`) de chaque zone.

export function placeVictims(entries, zones, plan, card, cfg, rng, avoid = []) {
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const assigned = assignZones(entries, zones, rng);
  const placed = [];
  const minDist = card.w * cfg.cardMinSpacing;
  const maxRot = (cfg.cardMaxRotationDeg * Math.PI) / 180;

  return entries.map((entry, i) => {
    const zone = zoneById.get(assigned[i]);
    let pos;
    if (entry.x != null && entry.y != null) {
      pos = { x: entry.x * plan.w, y: entry.y * plan.h };
    } else {
      pos = samplePoint(zone, plan, card, placed, minDist, rng, avoid);
    }
    placed.push(pos);
    return {
      zone: zone.id,
      x: pos.x,
      y: pos.y,
      rot: entry.rot ?? rng.range(-maxRot, maxRot),
    };
  });
}

// Tirage au sort des zones pour les victimes sans zone imposée,
// au prorata des poids (méthode du plus fort reste).
function assignZones(entries, zones, rng) {
  const known = new Set(zones.map((z) => z.id));
  const result = entries.map((e) => {
    if (e.zone && !known.has(e.zone)) {
      console.warn(`${e.id} : zone "${e.zone}" inconnue dans zones.json → répartition automatique`);
      return null;
    }
    return e.zone ?? null;
  });
  const free = result.map((z, i) => (z ? -1 : i)).filter((i) => i >= 0);
  const totalW = zones.reduce((s, z) => s + (z.weight ?? 0), 0);
  if (!free.length || totalW <= 0) return result.map((z) => z ?? zones[0].id);

  const quotas = zones.map((z) => {
    const exact = (free.length * (z.weight ?? 0)) / totalW;
    return { id: z.id, n: Math.floor(exact), rest: exact % 1 };
  });
  let missing = free.length - quotas.reduce((s, q) => s + q.n, 0);
  [...quotas].sort((a, b) => b.rest - a.rest).slice(0, missing).forEach((q) => q.n++);

  const pool = quotas.flatMap((q) => Array(q.n).fill(q.id));
  rng.shuffle(pool);
  free.forEach((idx, k) => (result[idx] = pool[k]));
  return result;
}

// Point aléatoire dans la zone, le plus éloigné possible des cartes déjà posées,
// et jamais dans une zone interdite (autour du PMA / de la sortie : trompeur).
function samplePoint(zone, plan, card, placed, minDist, rng, avoid = []) {
  const rects = zone.rects.map(([x, y, w, h]) => ({
    x: x * plan.w, y: y * plan.h, w: w * plan.w, h: h * plan.h,
  }));
  const areas = rects.map((r) => r.w * r.h);
  const total = areas.reduce((a, b) => a + b, 0);
  const mx = card.w * 0.5;
  const my = card.h * 0.5;

  let best = null;
  let bestD = -1;
  let fallback = null, fallbackD = -1;
  const inAvoid = (x, y) => avoid.some((a) => Math.hypot(a.x - x, a.y - y) < a.r);
  for (let t = 0; t < 80; t++) {
    let pick = rng.next() * total;
    let r = rects[0];
    for (let k = 0; k < rects.length; k++) {
      if ((pick -= areas[k]) <= 0) { r = rects[k]; break; }
    }
    const x = r.x + mx + rng.next() * Math.max(0, r.w - 2 * mx);
    const y = r.y + my + rng.next() * Math.max(0, r.h - 2 * my);
    if (inAvoid(x, y)) {
      const da = Math.min(...avoid.map((a) => Math.hypot(a.x - x, a.y - y) - a.r));
      if (da > fallbackD) { fallbackD = da; fallback = { x, y }; }
      continue;
    }
    let d = Infinity;
    for (const p of placed) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
    if (d >= minDist) return { x, y };
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  return best ?? fallback; // zone saturée : on accepte un léger chevauchement
}
