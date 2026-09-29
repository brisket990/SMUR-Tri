// ============================================================
//  Tirage d'un sous-ensemble représentatif de victimes
// ============================================================
//  - proportions UA / UR / UD / Impliqué respectées (plus fort reste),
//    avec au moins une victime de chaque catégorie ;
//  - évite les fiches "jumelles" (même tableau clinique, ex. BC-02 / BC-126)
//    tant qu'il reste des fiches différentes.

const CATS = ['RED', 'YELLOW', 'BLACK', 'GREEN'];

function signature(e) {
  const c = e.clinical;
  return c ? [c.pres, c.vent, c.circ, c.neuro, c.lesion].join('|') : e.id;
}

export function countByTriage(entries) {
  return Object.fromEntries(CATS.map((c) => [c, entries.filter((e) => e.truth?.triage === c).length]));
}

/** counts = { RED: 62, YELLOW: 57, … } (données publiques, sans détail par fiche) */
export function composition(counts, n) {
  const byCat = Object.fromEntries(CATS.map((c) => [c, counts[c] ?? 0]));
  const total = CATS.reduce((s, c) => s + byCat[c], 0);
  const quota = {};
  const rest = [];
  let used = 0;
  for (const c of CATS) {
    if (!byCat[c]) { quota[c] = 0; continue; }
    const exact = (n * byCat[c]) / total;
    quota[c] = Math.max(1, Math.floor(exact));
    used += quota[c];
    rest.push([c, exact - Math.floor(exact)]);
  }
  rest.sort((a, b) => b[1] - a[1]);
  for (let i = 0; used < n && rest.length; i = (i + 1) % rest.length) {
    const c = rest[i][0];
    if (quota[c] < byCat[c]) { quota[c]++; used++; }
  }
  // trop (à cause du minimum de 1) : on retire dans les plus grosses catégories
  while (used > n) {
    const c = CATS.slice().sort((a, b) => quota[b] - quota[a])[0];
    quota[c]--; used--;
  }
  return quota;
}

export function selectVictims(entries, n, rng) {
  if (n >= entries.length) return entries.slice();
  const quota = composition(countByTriage(entries), n);
  const picked = [];
  for (const cat of CATS) {
    const pool = rng.shuffle(entries.filter((e) => e.truth?.triage === cat));
    const seen = new Set();
    const uniques = [];
    const twins = [];
    for (const e of pool) {
      const s = signature(e);
      (seen.has(s) ? twins : uniques).push(e);
      seen.add(s);
    }
    picked.push(...[...uniques, ...twins].slice(0, quota[cat]));
  }
  return picked;
}
