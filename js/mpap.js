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
  const M = { entrance: scenario.team?.start ?? [0.5, 0.9], hiddenShare: 0.1, jitter: 0.5, deadSpacing: 0.28, spacing: 0.95, deadBand: 0.09, ...(scenario.mpap ?? {}) };
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
  const nHidden = Math.max(2, Math.round(entries.filter((e) => !e.extra).length * M.hiddenShare));
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

// ============================================================
//  MPAP : une cinquantaine de décédés supplémentaires (inventés)
// ============================================================
//  Ils s'ajoutent aux 150 fiches et s'entassent à l'entrée. Fiches BC-151, BC-152…
//  Aucune donnée réelle : textes tirés au hasard parmi des formulations types.
const DEAD_MECH = ["Tir d'AK-47 en rafale", "Tir d'AK-47 à bout portant", "Tir d'AK-47 dans la fosse", 'Explosion kamikaze (proche épicentre)',
  "Explosion kamikaze", "Tir d'AK-47 en fuyant vers la sortie", 'Tirs croisés près de l\'entrée', 'Grenade'];
const DEAD_PRES = ['Inerte, aréactif, décédé sur place.', 'Inerte, aréactif, lésions incompatibles avec la vie.',
  'Inerte, aréactif, aucun mouvement ventilatoire.', 'En arrêt cardio-respiratoire, rigidité débutante.', 'Inerte, face contre le sol, aréactif.'];
const DEAD_LES = [
  ['Plaie balistique crânienne transfixiante.', 'ball:head:C:x2'],
  ['Plaies balistiques multiples du thorax.', 'ball:chest:R ball:chest:L ball:chest:C'],
  ['Plaie balistique médiothoracique (cœur / gros vaisseaux).', 'ball:heart'],
  ['Plaie balistique cervicale avec section vasculaire.', 'ball:neck:C hematoma:neck:L'],
  ['Délabrement thoraco-abdominal par blast.', 'tear:abdomen:C blast:body blast:body:dos'],
  ['Poly-criblage par éclats, brûlures étendues.', 'blast:body:big burn:body:C:big blast:body:dos'],
  ['Plaies balistiques multiples thorax et abdomen.', 'ball:chest:L ball:abdomen:C ball:abdomen:R ball:chest:R:dos'],
  ['Plaie balistique crânio-faciale destructrice.', 'ball:face:C:x2 ball:head:C'],
  ['Plaies balistiques du dos et du thorax (tir en fuyant).', 'ball:chest:R:dos ball:chest:L:dos exit:chest:L'],
];
export function makeExtraDead(n, rng, firstNum = 151) {
  const pick = (a) => a[Math.floor(rng.next() * a.length)];
  return Array.from({ length: n }, (_, i) => {
    const [lesion, injuries] = pick(DEAD_LES);
    const sex = rng.next() < 0.5 ? 'Homme' : 'Femme';
    return {
      id: `BC-${firstNum + i}`, extra: true, zone: null,
      clinical: { sex, age: 18 + Math.floor(rng.next() * 45), mechanism: pick(DEAD_MECH), pres: pick(DEAD_PRES),
        vent: 'FR : 0/min - Apnée.', circ: 'FC : 0 bpm - PA : imprenable.', neuro: 'GCS 3 (E1 V1 M1). Mydriase bilatérale aréactive.', lesion },
      truth: { triage: 'BLACK', accept: [], limit: false, why: 'Décès constaté : aucune ressource à engager.', note: '' },
      profile: 'dead', actions: {}, injuries,
    };
  });
}
