// ============================================================
//  Fiches générées : la carte est dessinée à partir du texte
// ============================================================
//  Même gabarit que les fiches PNG (1016 × 1489) : en-tête, identité,
//  mécanisme, silhouette avec les blessures, ABCDE, cartouche de tri
//  (aux mêmes positions : les zones cliquables restent alignées).
//  Fond : VOS fiches vierges (jeu/SMUR-Tri/img/fiches/modele-homme|femme|enfant|bebe.jpg), choisies selon l'âge et le sexe ;
//  à défaut, fiche entièrement dessinée.
//  Blessures : tableau fait main (outils/blessures.py → victims[].injuries), à défaut lecture du bilan lésionnel :
//  région (cuisse, thorax, avant-bras…), côté (droit / gauche / bilatéral),
//  type (balle, arme blanche, contusion, brûlure, éclats, blast, garrot).
//  Le côté est celui du patient : son côté droit est à gauche du dessin (vue de face).

const W = 1016, H = 1489;
// caractères de contrôle (présents dans certains textes copiés du PDF) : interdits en XML
const clean = (s) => String(s ?? '').replace(/\u0002/g, '-').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const esc = (s) => clean(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- mesure du texte (retour à la ligne) ----------
let measureCtx = null;
function measure(text, font) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
function wrap(text, font, maxW) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (measure(t, font) <= maxW || !line) line = t;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}
// taille de police la plus grande qui tient en maxLines lignes
function fit(text, family, weight, size, minSize, maxW, maxLines) {
  for (let s = size; s >= minSize; s -= 1) {
    const lines = wrap(text, `${weight} ${s}px ${family}`, maxW);
    if (lines.length <= maxLines) return { size: s, lines };
  }
  const lines = wrap(text, `${weight} ${minSize}px ${family}`, maxW);
  return { size: minSize, lines: lines.slice(0, maxLines) };
}

// ---------- silhouette (repère 300 × 560, vue de face) ----------
//  x < 150 : côté DROIT du patient (à gauche du dessin)
const LIMBS = [
  // [x1, y1, x2, y2, largeur]
  [150, 76, 150, 104, 30],           // cou
  [106, 124, 88, 212, 30], [194, 124, 212, 212, 30],     // bras
  [88, 212, 72, 292, 24], [212, 212, 228, 292, 24],      // avant-bras
  [130, 282, 127, 402, 44], [170, 282, 173, 402, 44],    // cuisses
  [127, 402, 131, 512, 30], [173, 402, 169, 512, 30],    // jambes
];
const TORSO = 'M104 112 Q150 100 196 112 Q210 118 208 140 L196 214 Q190 240 192 262 Q196 292 184 300 L116 300 Q104 292 108 262 Q110 240 104 214 L92 140 Q90 118 104 112 Z';

function bodySVG(sex) {
  const skin = '#f4efe9', line = '#b4a89e';
  const limbs = (w, color) => LIMBS.map(([x1, y1, x2, y2, lw]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${lw + w}" stroke-linecap="round"/>`).join('');
  const ends = (grow, color) => [
    [68, 312, 11, 19], [232, 312, 11, 19],      // mains
    [128, 532, 13, 18], [172, 532, 13, 18],     // pieds
  ].map(([cx, cy, rx, ry]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx + grow}" ry="${ry + grow}" fill="${color}"/>`).join('');
  const hair = sex === 'Femme'
    ? '<path d="M118 52 Q116 14 150 12 Q184 14 182 52 L186 96 Q176 84 176 60 Q170 30 150 30 Q130 30 124 60 Q124 84 114 96 Z" fill="#8d7b6e" opacity=".55"/>'
    : '<path d="M123 42 Q124 16 150 15 Q176 16 177 42 Q170 28 150 28 Q130 28 123 42 Z" fill="#8d7b6e" opacity=".55"/>';
  return `
    <g>
      ${limbs(5, line)}${ends(2.5, line)}
      <path d="${TORSO}" fill="${line}" stroke="${line}" stroke-width="5"/>
      <ellipse cx="150" cy="48" rx="29.5" ry="35.5" fill="${line}"/>
      ${limbs(0, skin)}${ends(0, skin)}
      <path d="${TORSO}" fill="${skin}"/>
      <ellipse cx="150" cy="48" rx="27" ry="33" fill="${skin}"/>
      ${hair}
      <path d="M150 120 L150 290 M122 150 Q136 160 150 152 Q164 160 178 150 M132 300 Q150 312 168 300" fill="none" stroke="#d8cfc7" stroke-width="2"/>
    </g>`;
}

// ---------- modèles de fiche vierge et points d'ancrage ----------
//  Vos fiches vierges (jeu/SMUR-Tri/img/fiches/modele-*.jpg, 1016 × 1489) servent de fond.
//  Points relevés sur chaque silhouette, dans le cadre silhouette (posé en x = 60, y = 390
//  sur la fiche), côté DROIT du patient (à gauche du dessin) ; le côté gauche est le miroir
//  autour de l'axe. k = taille des symboles.
export const TEMPLATES = {
  homme: {
    axis: 175, k: 1,
    a: { head: [175, 72], forehead: [175, 64], face: [175, 92], ear: [148, 80], neck: [175, 118], shoulder: [120, 150],
      chest: [150, 175], ribs: [146, 212], heart: [191, 178], abdomen: [175, 238], flank: [135, 236], pelvis: [175, 282],
      groin: [156, 305], femoral: [154, 325], arm: [109, 212], elbow: [100, 242], forearm: [88, 272], hand: [77, 318],
      thigh: [151, 360], knee: [151, 415], calf: [151, 468], ankle: [155, 520], foot: [150, 543] },
    tq: { arm: [111, 190, 'v'], forearm: [95, 252, 'v'], groin: [151, 300, 'h'], thigh: [151, 322, 'h'], leg: [151, 392, 'h'] },
  },
  femme: {
    axis: 174, k: 1,
    a: { head: [174, 96], forehead: [174, 100], face: [174, 118], ear: [148, 118], neck: [174, 150], shoulder: [125, 175],
      chest: [152, 205], ribs: [148, 230], heart: [190, 204], abdomen: [174, 270], flank: [143, 262], pelvis: [174, 305],
      groin: [159, 325], femoral: [157, 340], arm: [120, 235], elbow: [111, 260], forearm: [100, 285], hand: [90, 325],
      thigh: [152, 370], knee: [155, 420], calf: [152, 465], ankle: [157, 515], foot: [154, 535] },
    tq: { arm: [120, 215, 'v'], forearm: [106, 272, 'v'], groin: [153, 318, 'h'], thigh: [152, 340, 'h'], leg: [154, 400, 'h'] },
  },
  enfant: {
    axis: 174, k: 0.85,
    a: { head: [174, 160], forehead: [174, 172], face: [174, 188], ear: [150, 188], neck: [174, 215], shoulder: [131, 235],
      chest: [153, 258], ribs: [150, 285], heart: [190, 260], abdomen: [174, 312], flank: [143, 308], pelvis: [174, 345],
      groin: [160, 360], femoral: [159, 372], arm: [125, 280], elbow: [118, 305], forearm: [109, 325], hand: [100, 360],
      thigh: [155, 395], knee: [157, 440], calf: [157, 480], ankle: [159, 525], foot: [156, 540] },
    tq: { arm: [126, 262, 'v'], forearm: [113, 318, 'v'], groin: [155, 352, 'h'], thigh: [155, 372, 'h'], leg: [157, 425, 'h'] },
  },
  bebe: {
    axis: 172, k: 0.6,
    a: { head: [172, 282], forehead: [172, 290], face: [172, 300], ear: [151, 305], neck: [172, 328], shoulder: [143, 338],
      chest: [161, 352], ribs: [159, 367], heart: [181, 352], abdomen: [172, 385], flank: [150, 382], pelvis: [172, 408],
      groin: [162, 415], femoral: [162, 422], arm: [141, 370], elbow: [135, 387], forearm: [129, 400], hand: [125, 412],
      thigh: [161, 437], knee: [162, 470], calf: [161, 492], ankle: [162, 515], foot: [160, 522] },
    tq: { arm: [141, 355, 'v'], forearm: [133, 392, 'v'], groin: [161, 412, 'h'], thigh: [161, 425, 'h'], leg: [162, 458, 'h'] },
  },
};
/** Modèle selon l'âge et le sexe */
export function templateFor(c) {
  const age = Number(c?.age);
  if (age && age < 3) return 'bebe';
  if (age && age < 13) return 'enfant';
  return c?.sex === 'Femme' ? 'femme' : 'homme';
}
const CENTRAL = new Set(['head', 'forehead', 'face', 'neck', 'abdomen', 'pelvis', 'heart', 'body']);

/** « ball:thigh:R cut:forearm:L tq:groin:R:bad » → liste de blessures */
export function parseSpec(spec) {
  return String(spec ?? '').split(/\s+/).filter(Boolean).map((tok) => {
    const [kind, region, ...rest] = tok.split(':');
    const side = rest.find((r) => ['R', 'L', 'C'].includes(r)) ?? 'C';
    return { kind, region, side, big: rest.includes('big'), bad: rest.includes('bad'), x2: rest.includes('x2'), dos: rest.includes('dos') };
  });
}

// ---------- secours : lecture automatique du bilan (fiche absente du tableau) ----------
const REGION_WORDS = [
  ['ear', /auricul|oreille|tympan/], ['face', /cervico-?faciale|face|visage/], ['head', /cr[âa]n|t[êe]te|frontal/],
  ['neck', /\bcou\b|cervical/], ['shoulder', /[ée]paule/], ['forearm', /avant-?bras/], ['hand', /\bmain\b|palmaire/],
  ['arm', /(?<!avant-?)\bbras\b/], ['heart', /m[ée]diothorac|c[œo]eur|tamponnade/], ['chest', /thora|pulmonaire|pneumothorax|costal/],
  ['abdomen', /abdom/], ['flank', /flanc/], ['groin', /racine de cuisse/], ['femoral', /f[ée]morale/], ['pelvis', /bassin/],
  ['thigh', /cuisse/], ['knee', /genou/], ['calf', /jambe|mollet/], ['ankle', /cheville/], ['foot', /\bpied\b/],
];
function kindIn(seg) {
  if (/br[ûu]l/.test(seg)) return 'burn';
  if (/[ée]clats|shrapnel|projections/.test(seg)) return 'shards';
  if (/fracture/.test(seg)) return 'fracture';
  if (/entorse|contusion|luxation|ferm[ée]|pi[ée]tinement/.test(seg)) return 'blunt';
  if (/couteau|incis|coupure|arme blanche/.test(seg)) return 'cut';
  if (/tangentielle|[ée]raflure/.test(seg)) return 'graze';
  if (/balisti|balle|impact|tir\b/.test(seg)) return 'ball';
  return null;
}
export function autoSpec(clinical, id = '') {
  const n = parseInt(String(id).replace(/\D/g, ''), 10) || 0;
  const lesion = clean(clinical?.lesion).toLowerCase(), mech = clean(clinical?.mechanism).toLowerCase(), pres = clean(clinical?.pres).toLowerCase();
  if (/aucune l[ée]sion/.test(lesion)) return [];
  const out = [];
  const defKind = /couteau/.test(mech) && !/tir|ak-?47|arme [àa] feu/.test(mech) ? 'cut' : 'ball';
  let prev = null;
  for (const seg of lesion.split(/\bet\b|,|;|:|\+|\(|\)|\/| avec | par /).map((x) => x.trim()).filter(Boolean)) {
    const k = kindIn(seg) ?? (/plaie|p[ée]n[ée]trant|art[ée]rielle/.test(seg) ? defKind : prev ?? kindIn(lesion) ?? defKind);
    if (kindIn(seg) || /plaie/.test(seg)) prev = k;
    let regs = REGION_WORDS.filter(([, re]) => re.test(seg)).map(([r]) => r);
    if (regs.includes('heart')) regs = regs.filter((r) => r !== 'chest');
    if (regs.includes('groin')) regs = regs.filter((r) => r !== 'thigh');
    const sides = /bilat|deux|des cuisses/.test(seg + lesion) ? ['R', 'L'] : /droit/.test(seg) || (/droit/.test(lesion) && !/gauche/.test(lesion)) ? ['R'] : /gauche/.test(seg) || (/gauche/.test(lesion) && !/droit/.test(lesion)) ? ['L'] : [n % 2 ? 'R' : 'L'];
    for (const r of regs) for (const sd of (CENTRAL.has(r) ? ['C'] : sides)) out.push({ kind: r === 'ear' ? 'ear' : k, region: r, side: sd, x2: /multiples/.test(lesion) && k === 'ball' });
  }
  if (/poly-?traumatisme|blast global|souffle|d[ée]chirure|blast massif/.test(lesion + ' ' + pres)) out.push({ kind: 'blast', region: 'body', side: 'C', big: /majeur|lourd|massi/.test(lesion) });
  if (/br[ûu]lures? (massives|[ée]tendues)|blast global et br/.test(lesion + ' ' + pres)) out.push({ kind: 'burn', region: 'body', side: 'C', big: true });
  if (/acouph/.test(lesion) && !out.some((m) => m.kind === 'ear')) out.push({ kind: 'ear', region: 'ear', side: 'R' }, { kind: 'ear', region: 'ear', side: 'L' });
  const limb = out.find((m) => ['arm', 'forearm', 'thigh', 'groin', 'femoral', 'calf'].includes(m.region));
  if (/garrot/.test(lesion + ' ' + mech) && limb) {
    const at = { arm: 'arm', forearm: 'forearm', thigh: 'groin', groin: 'groin', femoral: 'groin', calf: 'leg' }[limb.region];
    out.push({ kind: 'tq', region: at, side: limb.side, bad: /mal|inefficace/.test(lesion + ' ' + mech) });
  }
  return out;
}

// ---------- dessin des blessures (repère du cadre silhouette) ----------
//  Chaque symbole est dessiné autour de (0, 0) puis posé au point d'ancrage, à l'échelle du modèle.
const SWAP = { R: 'L', L: 'R', C: 'C' };
function markSVG(m0, T, view = 'face') {
  const m = view === 'dos' ? { ...m0, side: SWAP[m0.side] ?? 'C' } : m0;
  const A = T.a, k = T.k;
  const pt = (region, side) => {
    const r = region === 'leg' ? 'calf' : region;
    const a = A[r] ?? A.abdomen;
    return [side === 'L' && !CENTRAL.has(r) ? 2 * T.axis - a[0] : CENTRAL.has(r) || side !== 'C' ? a[0] : T.axis, a[1]];
  };
  const at = ([x, y], g, kk = k) => `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${kk})">${g}</g>`;
  const mir = (p, side) => (side === 'L' ? [2 * T.axis - p[0], p[1]] : p);
  const P = pt(m.region, m.side);
  const ball = '<circle r="10" fill="#d32f2f" opacity=".22"/><circle r="5.5" fill="#b71c1c" stroke="#fff" stroke-width="1.3"/>';
  const dot = '<circle r="3.3" fill="#c62828" stroke="#fff" stroke-width=".8"/>';
  const burn = (rx, ry) => `<ellipse rx="${rx}" ry="${ry}" fill="#ff9800" opacity=".42" stroke="#e65100" stroke-width="1.6" stroke-dasharray="4 3"/>`;
  switch (m.kind) {
    case '__raw': return at(P, m.svg);
    case 'ball': return m.x2 ? at([P[0] - 6 * k, P[1] - 5 * k], ball) + at([P[0] + 7 * k, P[1] + 6 * k], ball) : at(P, ball);
    case 'exit': return at(P, '<circle r="9" fill="#d32f2f" opacity=".2"/>' + [0, 45, 90, 135].map((d) => `<line x1="-8" y1="0" x2="8" y2="0" transform="rotate(${d})" stroke="#b71c1c" stroke-width="2.2" stroke-linecap="round"/>`).join('') + '<circle r="3.2" fill="#fff" stroke="#b71c1c" stroke-width="1.5"/>');
    case 'graze': return at(P, '<path d="M-11 3 Q0 -4 11 -2" fill="none" stroke="#e57373" stroke-width="7" stroke-linecap="round" opacity=".7"/><path d="M-9 2 Q0 -4 9 -2" fill="none" stroke="#b71c1c" stroke-width="2.5" stroke-linecap="round"/>');
    case 'cut': return at(P, '<line x1="-10" y1="8" x2="10" y2="-8" stroke="#b71c1c" stroke-width="4.5" stroke-linecap="round"/>');
    case 'blunt': return at(P, '<path d="M-10 -10 L10 10 M10 -10 L-10 10" stroke="#1976d2" stroke-width="5.5" stroke-linecap="round"/>');
    case 'fracture': return at(P, '<path d="M-12 -6 L-4 4 L2 -5 L12 6" fill="none" stroke="#1976d2" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>');
    case 'burn':
      if (m.region === 'body') return [['chest', 'C', 30, 24], ['abdomen', 'C', 30, 24], ['arm', 'R', 16, 26], ['arm', 'L', 16, 26], ['face', 'C', 20, 22]]
        .map(([r, sd, rx, ry]) => at(pt(r, sd), burn(rx, ry))).join('');
      if (m.region === 'chest' && m.big) return at([T.axis, (A.chest[1] + A.ribs[1]) / 2], burn(46, 32));
      if (m.region === 'head' && m.big) return at(A.face, burn(26, 30));
      return at(P, m.big ? burn(26, 22) : burn(17, 14));
    case 'shards': return at(P, [[-8, -7], [7, -3], [-3, 8], [9, 10], [-10, 5]].map(([dx, dy]) => `<g transform="translate(${dx} ${dy})">${dot}</g>`).join(''));
    case 'blast': {
      const spots = [['chest', 'R', -4, -6], ['chest', 'L', 6, 8], ['abdomen', 'C', -8, 4], ['ribs', 'R', 0, 0], ['flank', 'L', 0, 6], ['thigh', 'R', 4, -10],
        ['knee', 'L', 0, 4], ['shoulder', 'L', 4, 2], ['calf', 'R', 0, 0], ['forearm', 'R', 0, 0], ['arm', 'L', 0, 0], ['pelvis', 'C', 12, 0]];
      return spots.slice(0, m.big ? 12 : 8).map(([r, sd, dx, dy]) => { const q = pt(r, sd); return at([q[0] + dx * k, q[1] + dy * k], dot); }).join('');
    }
    case 'ear': { const d = P[0] < T.axis ? -1 : 1; return at(P, [7, 13, 19].map((r) => `<path d="M${d * r * 0.5} ${-r * 0.8} Q${d * r * 1.1} 0 ${d * r * 0.5} ${r * 0.8}" fill="none" stroke="#6a1b9a" stroke-width="2.6" stroke-linecap="round"/>`).join('')); }
    case 'hematoma': return at(P, '<ellipse rx="14" ry="10" fill="#7b1fa2" opacity=".35"/>');
    case 'tear': if (!['abdomen', 'chest', 'body', 'ribs', 'flank', 'pelvis'].includes(m.region))   // déchirure d'un membre : à sa place
        return at(P, '<path d="M-6 -16 L2 -9 L-4 -2 L4 5 L-2 12 L5 18" fill="none" stroke="#b71c1c" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>');
      return at([T.axis, (A.chest[1] + A.abdomen[1]) / 2], '<path d="M-26 -44 L-15 -30 L-21 -16 L-7 -3 L-12 12 L4 24 L-2 38" fill="none" stroke="#b71c1c" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>');
    case 'amput': return amputSVG(m, T);
    case 'tq': {
      const t = T.tq[m.region] ?? T.tq.thigh;
      const [w, h] = t[2] === 'v' ? [28, 8] : [36, 9];
      const tp = mir([t[0], t[1] + (m.off ?? 0)], m.side);
      const lbl = m.time ? `<g transform="translate(${tp[0] < T.axis ? -w / 2 - 50 : w / 2 + 6} -8)"><rect width="46" height="16" rx="3" fill="#212121"/><text x="23" y="12" text-anchor="middle" font-family="Arial" font-weight="700" font-size="10.5" fill="#ffd54f">${m.time}</text></g>` : '';
      return at(tp, lbl + `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="3" fill="#212121" stroke="${m.bad ? '#ff9800' : '#fff'}" stroke-width="1.8" ${m.bad ? 'stroke-dasharray="4 3"' : ''}/><rect x="${w / 2 - 3}" y="${-h / 2 - 4}" width="6" height="${h + 8}" rx="2" fill="#424242"/>`);
    }
    default: return '';
  }
}

// ---------- amputation : le membre disparaît sous la section, moignon à la bonne hauteur ----------
//  La partie amputée est effacée (fond blanc de la fiche), rappelée en pointillés gris,
//  et la section est marquée d'un bord rouge déchiqueté.
const LEG_CHAIN = ['femoral', 'thigh', 'knee', 'calf', 'ankle', 'foot'];
const ARM_CHAIN = ['shoulder', 'arm', 'elbow', 'forearm', 'hand'];
function amputSVG(m, T) {
  const A = T.a, k = T.k;
  const leg = !['shoulder', 'arm', 'elbow', 'forearm', 'hand'].includes(m.region);
  const chain = (leg ? LEG_CHAIN : ARM_CHAIN).map((r) => A[r]);
  const last = chain[chain.length - 1];
  chain.push(leg ? [last[0] + 2, last[1] + 16 * k] : [last[0] - 9, last[1] + 40 * k]);   // bout du pied / de la main
  // point de section, selon la région
  const mid = (a, b, f = 0.5) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const idx = (r) => (leg ? LEG_CHAIN : ARM_CHAIN).indexOf(r);
  const cutAt = {
    thigh: [mid(A.femoral, A.thigh, 0.8), idx('thigh')], knee: [A.knee, idx('knee')],
    calf: [mid(A.knee, A.calf, 0.55), idx('calf')], leg: [mid(A.knee, A.calf, 0.55), idx('calf')],
    ankle: [mid(A.calf, A.ankle, 0.75), idx('ankle')], foot: [mid(A.calf, A.ankle, 0.85), idx('ankle')],
    arm: [mid(A.arm, A.elbow, 0.3), idx('elbow')], elbow: [A.elbow, idx('forearm')],
    forearm: [mid(A.elbow, A.forearm, 0.6), idx('forearm')], hand: [mid(A.forearm, A.hand, 0.7), idx('hand')],
  }[m.region] ?? [A.calf, idx('calf')];
  const [c0, from] = cutAt;
  const pts = [c0, ...chain.slice(Math.max(from, 1))].filter((p, i, a) => i === 0 || p[1] > a[0][1] - 1);
  const side = (p) => (m.side === 'L' ? [2 * T.axis - p[0], p[1]] : p);
  const P = pts.map(side);
  const line = P.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L');
  const w = (leg ? 34 : 32) * k;
  // direction du membre à la section → bord déchiqueté perpendiculaire
  const [x0, y0] = P[0], [x1, y1] = P[1] ?? [x0, y0 + 10];
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len, nx = -uy, ny = ux;
  const half = w * 0.5;
  const jag = [-1, -0.6, -0.25, 0.1, 0.45, 0.8, 1].map((t, i) => {
    const o = (i % 2 ? 4.5 : -1.5) * k;
    return [x0 + nx * half * t + ux * o, y0 + ny * half * t + uy * o];
  });
  const jagD = 'M' + jag.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L');
  const drops = [0.3, 0.7].map((f) => `<circle cx="${(x0 + nx * half * (f - 0.5) + ux * 11 * k).toFixed(1)}" cy="${(y0 + ny * half * (f - 0.5) + uy * 11 * k).toFixed(1)}" r="${(2.6 * k).toFixed(1)}" fill="#b71c1c"/>`).join('');
  return `<g class="amput">
    <path d="M${line}" fill="none" stroke="#fff" stroke-width="${w.toFixed(1)}" stroke-linejoin="round" stroke-linecap="butt"/>
    <circle cx="${P[P.length - 1][0].toFixed(1)}" cy="${P[P.length - 1][1].toFixed(1)}" r="${(w / 2 + (leg ? 4 : 14) * k).toFixed(1)}" fill="#fff"/>
    ${leg ? '' : (() => { const h = side(A.hand); return `<ellipse cx="${(h[0] + (m.side === 'L' ? 6 : -6) * k).toFixed(1)}" cy="${(h[1] + 8 * k).toFixed(1)}" rx="${(24 * k).toFixed(1)}" ry="${(30 * k).toFixed(1)}" fill="#fff"/>`; })()}
    <path d="M${line}" fill="none" stroke="#9e9e9e" stroke-width="${(w * 0.62).toFixed(1)}" stroke-opacity=".16" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M${line}" fill="none" stroke="#9e9e9e" stroke-width="${(1.6 * k).toFixed(1)}" stroke-dasharray="${(5 * k).toFixed(1)} ${(4 * k).toFixed(1)}" stroke-linecap="round"/>
    <path d="${jagD}" fill="none" stroke="#e57373" stroke-width="${(9 * k).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>
    <path d="${jagD}" fill="none" stroke="#b71c1c" stroke-width="${(4 * k).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>
    ${drops}</g>`;
}

const LEGEND = {
  ball: ['<circle cx="0" cy="0" r="6" fill="#b71c1c"/>', 'balle'],
  graze: ['<path d="M-8 2 Q0 -3 8 -1" fill="none" stroke="#b71c1c" stroke-width="3" stroke-linecap="round"/>', 'éraflure'],
  cut: ['<line x1="-8" y1="6" x2="8" y2="-6" stroke="#b71c1c" stroke-width="4" stroke-linecap="round"/>', 'arme blanche'],
  blunt: ['<path d="M-6 -6 L6 6 M6 -6 L-6 6" stroke="#1976d2" stroke-width="4" stroke-linecap="round"/>', 'trauma fermé'],
  fracture: ['<path d="M-8 -4 L-3 3 L2 -3 L8 4" fill="none" stroke="#1976d2" stroke-width="3"/>', 'fracture'],
  burn: ['<ellipse cx="0" cy="0" rx="9" ry="7" fill="#ff9800" opacity=".6" stroke="#e65100" stroke-width="1.5"/>', 'brûlure'],
  shards: ['<circle cx="-4" cy="2" r="3" fill="#c62828"/><circle cx="4" cy="-3" r="3" fill="#c62828"/>', 'éclats'],
  blast: ['<circle cx="-4" cy="2" r="3" fill="#c62828"/><circle cx="4" cy="-3" r="3" fill="#c62828"/>', 'impacts'],
  ear: ['<path d="M-2 -7 Q5 0 -2 7" fill="none" stroke="#6a1b9a" stroke-width="2.5"/>', 'blast oreille'],
  hematoma: ['<ellipse cx="0" cy="0" rx="9" ry="6" fill="#7b1fa2" opacity=".45"/>', 'hématome'],
  tear: ['<path d="M-7 -6 L-2 -1 L-5 3 L2 7" fill="none" stroke="#b71c1c" stroke-width="3"/>', 'déchirure'],
  tq: ['<rect x="-10" y="-4" width="20" height="8" rx="3" fill="#212121"/>', 'garrot'],
  amput: ['<line x1="0" y1="-8" x2="0" y2="1" stroke="#bdbdbd" stroke-width="7" stroke-linecap="round"/><line x1="0" y1="3" x2="0" y2="9" stroke="#9e9e9e" stroke-width="1.5" stroke-dasharray="2 2"/><path d="M-7 1 L-3 4 L0 0 L3 4 L7 1" fill="none" stroke="#b71c1c" stroke-width="2.5"/>', 'amputation'],
  exit: ['<circle r="4" fill="#fff" stroke="#b71c1c" stroke-width="2"/><line x1="-8" y1="0" x2="8" y2="0" stroke="#b71c1c" stroke-width="2"/>', 'orifice de sortie'],
};

// ---------- carte complète ----------
// ---------- gestes réalisés, dessinés sur la silhouette ----------
const LIMB_TQ = { arm: 'arm', elbow: 'arm', forearm: 'forearm', hand: 'forearm', thigh: 'groin', groin: 'groin', femoral: 'groin',
  knee: 'thigh', calf: 'leg', leg: 'leg', ankle: 'leg', foot: 'leg' };
const limbClass = (r) => (['arm', 'elbow', 'forearm', 'hand'].includes(r) ? 'arm' : 'leg');
const JUNCTION = ['groin', 'femoral', 'neck', 'pelvis', 'flank', 'shoulder'];
const THORAX = ['chest', 'ribs', 'heart'];
const WOUNDS = ['ball', 'graze', 'cut', 'shards', 'exit', 'tear', 'hematoma', 'amput'];
const fmt0 = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

function careSVG(all, care, T, view, noTimes = false) {
  const k = T.k;
  const wounds = all.filter((m) => WOUNDS.includes(m.kind));
  const used = new Map();                      // blessure → gestes déjà posés dessus
  const take = (list, tag) => {
    const w = list.find((m) => !(used.get(m) ?? []).includes(tag)) ?? null;
    if (w) used.set(w, [...(used.get(w) ?? []), tag]);
    return w;
  };
  const tqDone = new Set(all.filter((m) => m.kind === 'tq').map((m) => `${m.side}|${['arm', 'forearm'].includes(m.region) ? 'arm' : 'leg'}`));
  const out = [];
  const place = (m, svg, both = false) => { if (both || !!m.dos === (view === 'dos')) out.push(markSVG({ ...m, kind: '__raw', svg }, T, view)); };
  let tqN = 0;
  for (const c of care) {
    const t = noTimes ? null : `T+${fmt0(c.t)}`;
    if (c.action === 'tourniquet') {
      const limbs = wounds.filter((m) => LIMB_TQ[m.region]);
      let w = limbs.find((m) => !tqDone.has(`${m.side}|${limbClass(m.region)}`)) ?? limbs[0];
      if (!w) continue;
      tqDone.add(`${w.side}|${limbClass(w.region)}`);
      out.push(markSVG({ kind: 'tq', region: LIMB_TQ[w.region], side: w.side, time: t, off: tqN++ && limbs.length < 2 ? 10 : 0 }, T, view));
    } else if (c.action === 'compressive' || c.action === 'hemostatic') {
      const pref = c.action === 'hemostatic'
        ? [...wounds.filter((m) => JUNCTION.includes(m.region)), ...wounds]
        : [...wounds.filter((m) => LIMB_TQ[m.region]), ...wounds];
      const w = take(pref, c.action);
      if (w) place(w, `<rect x="-13" y="-8" width="26" height="16" rx="3" fill="#fff" stroke="#78909c" stroke-width="1.6"/>` +
        (c.action === 'compressive' ? '<rect x="-2.5" y="-8" width="5" height="16" fill="#1565c0"/>' : '<circle r="3.6" fill="#00897b"/>'));
    } else if (c.action === 'chestSeal') {
      const w = take(wounds.filter((m) => THORAX.includes(m.region) || m.region === 'flank'), 'seal');
      if (w) place(w, '<rect x="-11" y="-11" width="22" height="22" fill="#fff" fill-opacity=".85"/><path d="M-11 11 L-11 -11 L11 -11 L11 11" fill="none" stroke="#37474f" stroke-width="2.4"/>');
    } else if (c.action === 'needle') {
      const w = wounds.find((m) => THORAX.includes(m.region) && !m.dos);
      const side = w?.side === 'R' ? 'R' : 'L';
      const [ax, ay] = T.a.chest;
      if (view === 'face') {
        const x = side === 'L' ? 2 * T.axis - ax : ax;
        out.push(`<g transform="translate(${x} ${ay - 26 * k}) scale(${k})"><line x1="0" y1="0" x2="12" y2="-12" stroke="#f57c00" stroke-width="3" stroke-linecap="round"/><circle r="3" fill="#f57c00"/></g>`);
      }
    } else if (c.action === 'oxygen' && view === 'face') {
      const [fx, fy] = T.a.face;
      out.push(`<g transform="translate(${fx + 26 * k} ${fy - 6 * k}) scale(${k})"><rect x="-12" y="-8" width="24" height="16" rx="4" fill="#2e7d32"/><text x="0" y="5" text-anchor="middle" font-family="Arial" font-weight="700" font-size="11" fill="#fff">O2</text></g>`);
    }
  }
  return out.join('');
}

function careList(care, labels, x, y0, maxLines, F, noTimes = false) {
  if (!care.length) return '';
  const lines = care.map((c) => {
    const it = labels?.[c.action];
    const name = it ? (it.group === 'position' ? `Position : ${it.label.toLowerCase()}` : it.label) : c.action;
    return `${noTimes ? '• ' : `T+${fmt0(c.t)}  `}${name}${c.by ? ` (${c.by})` : ''}`;
  });
  const shown = lines.length > maxLines ? [...lines.slice(0, maxLines - 1), `… et ${lines.length - maxLines + 1} autre(s)`] : lines;
  return `<text x="${x}" y="${y0}" font-family='${F}' font-weight="700" font-size="17" fill="#8b1a1a">GESTES RÉALISÉS</text>` +
    shown.map((l, i) => `<text x="${x}" y="${y0 + 22 + i * 19}" font-family='${F}' font-size="15" fill="#222" ${measure(l, `15px ${F}`) > 340 ? 'textLength="340" lengthAdjust="spacingAndGlyphs"' : ''}>${esc(l)}</text>`).join('');
}

function badges(care, position, labels, F) {
  const b = [];
  if (position && labels?.[position]) b.push([labels[position].short ?? labels[position].label, '#1565c0']);
  if (care.some((c) => c.action === 'blanket')) b.push(['Couverture', '#b8860b']);
  if (care.some((c) => c.action === 'oxygen')) b.push(['O2', '#2e7d32']);
  let x = 104;
  return b.map(([t, col]) => {
    const w = measure(t, `700 14px ${F}`) + 16;
    const g = `<rect x="${x}" y="${410}" width="${w}" height="22" rx="11" fill="${col}"/><text x="${x + w / 2}" y="${425.5}" text-anchor="middle" font-family='${F}' font-weight="700" font-size="14" fill="#fff">${esc(t)}</text>`;
    x += w + 6;
    return g;
  }).join('');
}

export function cardSVG(e, opts = {}) {
  const c = e.clinical ?? {};
  const F = 'Arial, Helvetica, "Liberation Sans", sans-serif';
  const view = opts.view === 'dos' ? 'dos' : 'face';
  const all = e.injuries != null ? parseSpec(e.injuries) : autoSpec(c, e.id);
  // la vue montre ses blessures ; un garrot déjà en place se voit des deux côtés
  const marks = all.filter((m) => m.kind === 'tq' || !!m.dos === (view === 'dos'));
  const care = opts.care ?? [];
  const tplName = templateFor(c);
  const T = TEMPLATES[tplName];
  const bg = opts.templates?.[tplName];            // votre fiche vierge (data URL)

  // mécanisme : après « Mécanisme : » imprimé sur la fiche (police réduite si besoin)
  const mechX = bg ? 264 : 74;
  const mechTxt = bg ? clean(c.mechanism) : `Mécanisme : ${clean(c.mechanism)}`;
  let mechSize = 28;
  while (mechSize > 16 && measure(mechTxt, `700 ${mechSize}px ${F}`) > 944 - mechX) mechSize--;

  const blocks = [
    ['PRÉSENTATION CLINIQUE', c.pres], ['A & B - VENTILATION', c.vent], ['C - CIRCULATION & CHOC', c.circ],
    ['D - NEUROLOGIE', c.neuro], ['E - BILAN LÉSIONNEL', c.lesion],
  ];
  const blockSVG = blocks.map(([t, txt], i) => {
    const y = 384 + i * 152;
    const f = fit(clean(txt), F, 400, 25, 17, 480, 3);
    const lh = Math.round(f.size * 1.1);
    const frame = bg ? '' : `<rect x="425" y="${y}" width="531" height="148" fill="#f6efeb"/><rect x="425" y="${y}" width="14" height="148" fill="#7b1c1c"/>
      <text x="456" y="${y + 41}" font-family='${F}' font-weight="700" font-size="25" fill="#8b1a1a">${esc(t)}</text>`;
    const y0 = bg ? [453, 605, 760, 916, 1070][i] : y + 69;     // lignes de base relevées sur vos fiches
    return frame + f.lines.map((l, k) => `<text x="456" y="${y0 + k * lh}" font-family='${F}' font-size="${f.size}" fill="#111">${esc(l)}</text>`).join('');
  }).join('');

  const used = [...new Set([...marks.map((m) => m.kind), ...(care.some((x) => x.action === 'tourniquet') ? ['tq'] : [])])].filter((k) => LEGEND[k]);
  const legend = used.map((k, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    return `<g transform="translate(${86 + col * 160} ${966 - (Math.ceil(used.length / 2) - 1 - row) * 20})">${LEGEND[k][0]}<text x="15" y="6" font-family='${F}' font-size="17" fill="#666">${LEGEND[k][1]}</text></g>`;
  }).join('');
  const order = ['amput', 'burn', 'hematoma', 'tq', 'tear', 'blast', 'shards', 'graze', 'cut', 'blunt', 'fracture', 'ball', 'ear'];
  const drawn = [...marks].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).map((m) => markSVG(m, T, view)).join('')
    + careSVG(all, care, T, view, opts.noTimes);
  const dosImg = view === 'dos' ? opts.dosImages?.[tplName] : null;
  const panelBack = view === 'dos'
    ? (dosImg ? `<image href="${dosImg}" x="60" y="390" width="354" height="603"/>` : `<rect x="74" y="404" width="326" height="575" fill="#fff"/>`)
      + `<text x="237" y="${1000 - 12}" text-anchor="middle" font-family='${F}' font-weight="700" font-size="15" fill="#9e9e9e" letter-spacing="2">VUE DE DOS</text>`
    : '';

  // sans modèle vierge : fiche entièrement dessinée (secours)
  const base = bg
    ? `<image href="${bg}" x="0" y="0" width="${W}" height="${H}"/>`
    : `<rect width="${W}" height="${H}" fill="#7b1c1c"/><rect x="36" y="36" width="944" height="1417" rx="60" fill="#fff"/>
  <text x="508" y="152" text-anchor="middle" font-family='"Arial Black", ${F}' font-weight="900" font-size="78" fill="#0d1b6e">${esc(opts.title ?? 'SMUR')}</text>
  <rect x="60" y="202" width="896" height="82" fill="#1b2a3a"/><rect x="60" y="307" width="896" height="58" fill="#f6efeb"/>
  <rect x="61.5" y="391.5" width="350" height="598" rx="30" fill="#fff" stroke="#d7ccc8" stroke-width="3"/>
  <g transform="translate(60 390) translate(${T.axis - 150 * 1.02} 18) scale(1.02)">${bodySVG(c.sex)}</g>
  <rect x="61.5" y="1194.5" width="893" height="210" rx="26" fill="#fafafa" stroke="#d7ccc8" stroke-width="3"/>
  <text x="80" y="1253" font-family='${F}' font-weight="700" font-size="28" fill="#1b2a3a">DÉCISION DE TRIAGE SMUR</text>
  ${[['UD', 79, '#616161'], ['UA', 294, '#d32f2f'], ['UR', 510, '#fbc02d'], ['IMPLIQUÉ', 726, '#388e3c']].map(([t, x, col]) => `<rect x="${x}" y="1276" width="204" height="66" rx="16" fill="${col}"/><text x="${x + 102}" y="${t.length > 3 ? 1322 : 1328}" text-anchor="middle" font-family='${F}' font-weight="900" font-size="${t.length > 3 ? 36 : 50}" fill="#fff">${t}</text>`).join('')}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${base}
  <text x="72" y="258" font-family='${F}' font-weight="700" font-size="44" fill="#fff">${esc(e.id)}</text>
  <text x="944" y="258" text-anchor="end" font-family='${F}' font-weight="700" font-size="44" fill="#fff">${esc(c.sex ?? '')}${c.age ? ` • ${c.age} ans` : ''}</text>
  <text x="${mechX}" y="346" font-family='${F}' font-weight="700" font-size="${mechSize}" fill="#8b1a1a">${esc(mechTxt)}</text>
  ${panelBack}
  <text x="80" y="424" font-family='${F}' font-weight="700" font-size="17" fill="#b0a8a0">${view === 'dos' ? 'G' : 'D'}</text>
  <text x="394" y="424" text-anchor="end" font-family='${F}' font-weight="700" font-size="17" fill="#b0a8a0">${view === 'dos' ? 'D' : 'G'}</text>
  <g transform="translate(60 390)">${drawn}</g>
  ${badges(care, opts.position, opts.labels, F)}
  ${legend}
  ${careList(care, opts.labels, 70, 1068, 6, F, opts.noTimes)}
  ${blockSVG}
</svg>`;
}

/** Fiche générée → URL d'image (blob SVG, en mémoire) */
export function generatedCardURL(e, opts) {
  const blob = new Blob([cardSVG(e, opts)], { type: 'image/svg+xml' });
  return URL.createObjectURL(blob);
}
