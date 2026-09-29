// ============================================================
//  Mode MPAP : placement réaliste des victimes
// ============================================================
//  Près de l'entrée : une masse de corps (UD) serrés, qui se chevauchent.
//  Plus on s'éloigne, moins c'est grave : UA, puis UR, puis impliqués.
//  Quelques survivants sont cachés SOUS des corps (ils s'y sont abrités) :
//  on déplace la carte du dessus (glisser à la souris) pour les découvrir.
//  Réglages : scenario.json → "mpap": { "entrance": [x, y], "hiddenShare": 0.1, … }

const RANK = { BLACK: 0, RED: 1, YELLOW: 2, GREEN: 3 };

export function placeMPAP(entries, zones, plan, card, rng, scenario, avoid = []) {
  const M = { entrance: scenario.team?.start ?? [0.5, 0.9], hiddenShare: 0.1, jitter: 0.5, deadSpacing: 0.3, spacing: 0.95, deadBand: 0.05, ...(scenario.mpap ?? {}) };
  const E = { x: M.entrance[0] * plan.w, y: M.entrance[1] * plan.h };

  // candidats : points tirés dans toutes les zones (au prorata de la surface), hors zones interdites
  const rects = zones.flatMap((z) => z.rects.map(([x, y, w, h]) => ({ z: z.id, x: x * plan.w, y: y * plan.h, w: w * plan.w, h: h * plan.h })));
  const area = rects.reduce((a, r) => a + r.w * r.h, 0);
  const cand = [];
  for (let i = 0; i < 9000; i++) {
    let k = rng.next() * area;
    const r = rects.find((q) => (k -= q.w * q.h) <= 0) ?? rects[0];
    const x = r.x + card.w * 0.4 + rng.next() * Math.max(0, r.w - card.w * 0.8);
    const y = r.y + card.h * 0.4 + rng.next() * Math.max(0, r.h - card.h * 0.8);
    if (avoid.some((a) => Math.hypot(a.x - x, a.y - y) < a.r)) continue;
    cand.push({ x, y, z: r.z, d: Math.hypot(x - E.x, y - E.y) });
  }
  cand.sort((a, b) => a.d - b.d);

  // gravité : UD (morts d'abord, puis agoniques), UA, UR, impliqués — un peu mélangés
  const sev = (e) => {
    const t = e.truth?.triage;
    const base = RANK[t] ?? 2;
    const dead = t === 'BLACK' && e.profile === 'dead' ? -0.4 : 0;
    return base + dead + (rng.next() - 0.5) * M.jitter;
  };
  const order = entries.map((e, i) => ({ i, s: sev(e) })).sort((a, b) => a.s - b.s);

  // cachés : une part des survivants (UA / UR / impliqués), sous un corps
  const living = order.filter((o) => (RANK[entries[o.i].truth?.triage] ?? 2) >= 1);
  const nHidden = Math.max(2, Math.round(entries.length * M.hiddenShare));
  const hidden = new Set();
  for (const o of [...living].sort(() => rng.next() - 0.5).slice(0, nHidden)) hidden.add(o.i);

  const placed = [];          // { x, y, r }
  const out = new Array(entries.length);
  const maxRot = Math.PI / 5;
  // chaque victime vise une « distance » selon son rang de gravité : les premières (les morts)
  // tout près de l'entrée, les dernières au fond de la salle ; on cherche autour de ce rang
  const visible = order.filter((o) => !hidden.has(o.i));
  const N = cand.length;
  visible.forEach((o, k) => {
    const e = entries[o.i];
    const dead = e.truth?.triage === 'BLACK';
    const minD = card.w * (dead ? M.deadSpacing : M.spacing);
    // les morts dans la toute première bande (entassés) ; les autres étalés sur toute la salle
    const nDead = visible.filter((x) => entries[x.i].truth?.triage === 'BLACK').length;
    const q = dead ? M.deadBand * (k + 0.5) / Math.max(1, nDead)
      : M.deadBand + (1 - M.deadBand) * Math.pow((k - nDead + 0.5) / Math.max(1, visible.length - nDead), M.spread ?? 1.1);
    const center = Math.floor(q * (N - 1));
    const win = Math.max(30, Math.floor(N * (dead ? 0.02 : 0.1)));
    const ok = (c) => !c.used && placed.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= (minD + p.r) / 2);
    let pick = null;
    for (let tries = 0; tries < 400 && !pick; tries++) {          // au hasard dans la fenêtre, qui s'élargit
      const w = win * (1 + Math.floor(tries / 60));
      const c = cand[Math.max(0, Math.min(N - 1, center + Math.floor((rng.next() - 0.5) * 2 * w)))];
      if (ok(c)) pick = c;
    }
    pick ??= cand.find((c) => !c.used) ?? { x: E.x, y: E.y, z: zones[0].id };
    pick.used = true;
    placed.push({ x: pick.x, y: pick.y, r: minD });
    out[o.i] = { zone: pick.z, x: pick.x, y: pick.y, rot: (rng.next() - 0.5) * 2 * (dead ? maxRot * 1.4 : maxRot), dead };
  });

  // chaque survivant caché glisse sous un corps (de préférence près de l'entrée)
  const covers = out.map((p, i) => (p?.dead ? i : -1)).filter((i) => i >= 0);
  covers.sort((a, b) => Math.hypot(out[a].x - E.x, out[a].y - E.y) - Math.hypot(out[b].x - E.x, out[b].y - E.y));
  let ci = 0;
  for (const i of hidden) {
    const c = covers.length ? out[covers[ci++ % Math.min(covers.length, Math.max(4, hidden.size * 2))]] : null;
    if (!c) continue;
    out[i] = {
      zone: c.zone,
      x: c.x + (rng.next() - 0.5) * card.w * 0.3,
      y: c.y + (rng.next() - 0.5) * card.h * 0.22,
      rot: c.rot + (rng.next() - 0.5) * 0.5,
      coverY: c.y,           // dessinée juste AVANT sa couverture (donc dessous)
      hidden: true,
    };
  }
  return out;
}
