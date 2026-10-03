// ============================================================
//  Mode réel : pas de scope, pas de brassard, pas de saturomètre
// ============================================================
//  Les fiches et les évolutions n'affichent plus FC, PA, SpO2 ni GCS chiffrés,
//  mais ce que l'on constate en quelques secondes, à mains nues :
//    - respiration : fréquence comptée, amplitude, régularité, cyanose ;
//    - circulation : pouls radial / carotidien au toucher, temps de
//      recoloration cutanée (TRC), aspect de la peau ;
//    - conscience : yeux, parole, réponse aux ordres, réaction à la douleur.
//  Conversion automatique ; une fiche peut avoir sa version écrite à la main
//  (clinical.real = { vent, circ, neuro } ; stage.paramsReal), via l'éditeur.
//  Le tri attendu ne change pas. Les vraies constantes restent dans le bilan.

let REAL = false;
export const setReal = (on) => { REAL = !!on; };
export const isReal = () => REAL;

// ------------------------------------------------------------ lecture
const num = (s) => Number(String(s).replace(',', '.'));

/** Découpe un texte de constantes (fiche ou évolution) en valeurs. */
export function parseVitals(str) {
  const r = { extras: [] };
  const segs = String(str ?? '').replace(/\.\s*$/, '').split(/\s+[-·]\s+|\s*·\s*/).map((s) => s.trim()).filter(Boolean);
  for (const s of segs) {
    let m;
    if ((m = /^FR\s*:?\s*(\d+)\s*(?:\/\s*min)?\s*(.*)$/i.exec(s))) {
      r.fr = num(m[1]);
      const note = m[2].replace(/^[,(\s]+|[)\s]+$/g, '').toLowerCase();
      if (/gasp/.test(note)) r.gasps = true;
      if (/agoni/.test(note)) r.agonal = true;
      if (/irr[ée]guli/.test(note)) r.frIrreg = true;
      if (/ralenti/.test(note)) r.frSlowing = true;
    } else if (/^Sp[O0]2/i.test(s)) {
      m = /(\d+)\s*%/.exec(s);
      r.spo2 = m ? num(m[1]) : 0;                 // non mesurable / indétectable
    } else if ((m = /^FC\s*:?\s*(\d+)\s*(?:bpm)?\s*(.*)$/i.exec(s))) {
      r.fc = num(m[1]);
      const note = m[2].toLowerCase();
      if (/filant/.test(note)) r.thready = true;
      if (/irr[ée]guli/.test(note)) r.fcIrreg = true;
      if (/agoni/.test(note)) r.fcAgonal = true;
    } else if (/^PA\b/i.test(s)) {
      m = /(\d+)\s*\/\s*(\d+)/.exec(s);
      if (m) { r.pas = num(m[1]); r.pad = num(m[2]); } else r.paNone = true;
    } else if ((m = /^GCS\s*(\d+)(?:\s*\(\s*E(\d)\s*V(\d)\s*M(\d)\s*\))?/i.exec(s))) {
      r.gcs = num(m[1]);
      if (m[2]) { r.E = num(m[2]); r.V = num(m[3]); r.M = num(m[4]); }
    } else if ((m = /^T°\s*([\d,.]+)/i.exec(s))) {
      r.temp = num(m[1]);
    } else if ((m = /^TRC\s*(?:à\s*)?([\d,.]+)\s*s/i.exec(s))) {
      r.trc = num(m[1]);
    } else if (/^apn[ée]e/i.test(s)) {
      r.fr = 0;
    } else if (/^asystolie/i.test(s)) {
      r.fc = 0;
    } else {
      r.extras.push(s);
    }
  }
  return r;
}

// ------------------------------------------------------------ normes selon l'âge
//  frLow/frHigh : bradypnée / tachypnée ; fcLow/fcHigh : brady / tachycardie ;
//  fcCrit : bradycardie de bas débit ; hypo : PAS limite (enfant 70 + 2 × âge)
function norms(age) {
  const a = Number(age);
  if (!Number.isFinite(a) || a >= 12) return { a: a || 30, frLow: 12, frHigh: 20, fcLow: 60, fcCrit: 50, fcHigh: 100, hypo: 90 };
  if (a < 1) return { a, frLow: 25, frHigh: 50, fcLow: 100, fcCrit: 80, fcHigh: 160, hypo: 65 };
  if (a < 5) return { a, frLow: 20, frHigh: 30, fcLow: 80, fcCrit: 60, fcHigh: 140, hypo: 70 + 2 * a };
  return { a, frLow: 15, frHigh: 25, fcLow: 65, fcCrit: 55, fcHigh: 120, hypo: 70 + 2 * a };
}

const fem = (sex) => /femme|fille/i.test(sex ?? '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------ respiration
//  ctx : { gcs, chest } (conscience, lésion thoracique)
function resp(v, n, short, ctx = {}) {
  const out = [];
  if (v.fr === 0) {
    out.push(short ? 'ne respire pas' : 'Ne respire pas : aucun mouvement du thorax');
  } else if (v.fr != null) {
    const hypox = v.spo2 != null && v.spo2 <= 94;
    const coma = ctx.gcs != null && ctx.gcs <= 8;
    if (v.gasps || v.agonal) {
      out.push(short ? `gasps ${v.fr}/min` : `Gasps, ${v.fr}/min : respiration agonique`);
    } else {
      const q = [];
      const veryFast = n.a >= 12 ? v.fr >= 30 : v.fr > n.frHigh * 1.4;
      const superficial = hypox || ctx.chest || (ctx.gcs ?? 15) < 13;
      if (v.fr < n.frLow) q.push('lente');
      else if (veryFast) q.push('très rapide', superficial ? 'superficielle' : 'ample');
      else if (v.fr > n.frHigh) q.push('rapide');
      else q.push(coma || short ? 'régulière' : 'calme, ample');
      if (v.frIrreg) q.push('irrégulière');
      if (v.frSlowing) q.push('qui ralentit');
      if (veryFast && !superficial && n.a >= 12 && (ctx.gcs ?? 15) >= 14 && !short) q.push('parle sans difficulté');
      out.push(`${short ? 'respire' : 'Respire'} ${v.fr}/min, ${q.join(', ')}`);
    }
    // ce que l'on voit sans saturomètre
    if (v.spo2 != null && v.spo2 <= 85) out.push(short ? 'lèvres cyanosées' : 'lèvres et extrémités cyanosées');
    else if (v.spo2 != null && v.spo2 <= 90) out.push('lèvres légèrement bleutées');
    if (!short && v.fr > n.frHigh * 1.4 && !v.gasps && ((v.spo2 != null && v.spo2 <= 92) || ctx.chest)) out.push('signes de lutte (tirage)');
  }
  for (const x of v.extras) {
    if (/silence auscultatoire/i.test(x)) out.push(short ? 'un hémithorax se soulève mal' : "un côté du thorax se soulève moins que l'autre");
    else if (/souffle au thorax/i.test(x)) out.push(short ? 'plaie thoracique soufflante' : 'bruit de souffle à la plaie du thorax à chaque inspiration');
  }
  return out;
}

// ------------------------------------------------------------ circulation
function circ(v, n, short) {
  const out = [];
  if (v.fc === 0) {
    out.push(short ? 'pas de pouls' : 'Pas de pouls carotidien');
    return out;
  }
  if (v.fc == null && v.pas == null && !v.paNone) return out;
  const pas = v.pas;
  const site = n.a < 1 ? 'brachial' : 'radial';
  const brady = v.fc != null && v.fc < n.fcLow;
  const crit = v.fc != null && v.fc <= n.fcCrit;
  const tachy = v.fc != null && v.fc > n.fcHigh;
  const veryTachy = v.fc != null && v.fc > n.fcHigh * 1.2;
  const noPA = pas == null && !v.paNone;
  const cushing = brady && pas != null && pas >= 140;
  // pouls périphérique perdu
  const severe = v.paNone || (pas != null && pas <= n.hypo - 20) || v.fcAgonal || (noPA && crit);
  // pouls périphérique faible (filant)
  const shock = severe || (pas != null && pas < n.hypo) || v.thready
    || (noPA && v.fc != null && v.fc > n.fcHigh * 1.4)
    || (v.trc ?? 0) >= 4 || (n.a < 12 && tachy && (v.trc ?? 0) >= 3);
  // choc compensé : tachycardie franche, PA encore « correcte »
  const compensated = !shock && ((veryTachy && pas != null && pas < n.hypo + 25) || (v.fc != null && v.fc > n.fcHigh * 1.3) || (v.trc ?? 0) >= 3);
  // choc médullaire : pouls lent + PA basse, peau chaude
  const spinal = shock && !severe && brady && pas != null;
  const rate = brady ? 'lent' : veryTachy ? 'très rapide' : tachy ? 'rapide' : '';
  const irr = v.fcIrreg ? 'irrégulier' : '';
  const q = [rate, irr].filter(Boolean).join(', ');
  const P = short ? 'pouls' : 'Pouls';

  if (severe) out.push(`${P} ${site} absent, carotidien ${brady ? 'lent et faible' : `faible${q ? `, ${q}` : ''}`}`);
  else if (shock) out.push(`${P} ${site} filant${q ? `, ${q}` : ''}`);
  else if (cushing) out.push(`${P} lent, bien frappé`);
  else out.push(`${P} ${site} bien frappé${q ? `, ${q}` : ', régulier'}`);

  // temps de recoloration cutanée : se fait sans matériel
  const trc = v.trc ?? (spinal ? 2.5 : severe ? 5 : shock ? 4 : compensated ? 3 : 1.5);
  if (!short || trc >= 3) out.push(trc >= 3 ? `TRC ${trc >= 5 ? '> 4' : Math.round(trc)} s` : trc > 2 ? 'TRC 2 à 3 s' : 'TRC < 2 s');

  if (!short) {
    if (spinal) out.push('peau chaude, sèche et rosée');
    else if (severe) out.push('peau pâle, froide, marbrures');
    else if (shock || compensated) out.push('peau pâle et moite');
  }
  if (v.temp != null && v.temp < 35.5) out.push(v.temp < 32 ? (short ? 'peau glacée, ne frissonne plus' : 'peau glacée, ne frissonne plus') : (short ? 'peau froide, frissons' : 'peau froide au toucher, frissons'));
  return out;
}

// ------------------------------------------------------------ conscience
const EYES = { 4: 'ouvre les yeux spontanément', 3: 'ouvre les yeux à la voix', 2: 'ouvre les yeux à la douleur', 1: "n'ouvre pas les yeux, même à la douleur" };
const VERB = { 5: 'orienté', 4: 'confus', 3: 'mots inappropriés', 2: 'sons incompréhensibles, gémit', 1: 'aucun son' };
const VERB_KID = { 5: 'babille, interagit', 4: 'pleurs consolables, irritable', 3: 'pleurs inconsolables', 2: 'gémit', 1: 'aucun son' };
const MOTOR = { 6: 'obéit aux ordres simples', 5: 'localise la douleur', 4: 'retrait à la douleur', 3: 'flexion anormale à la douleur', 2: 'extension à la douleur', 1: 'aucune réaction à la douleur' };

function neuro(v, sex, short, n) {
  const f = fem(sex), e = f ? 'e' : '';
  const kid = n && n.a < 5;
  const out = [];
  if (v.gcs != null) {
    if (v.gcs === 3) out.push(short ? 'aucune réaction' : 'Aucune réaction, même à la douleur');
    else if (v.E != null) {
      if (v.gcs === 15) {
        out.push(kid ? (short ? 'éveillé' + e + ', interagit' : `Éveillé${e}, babille, interagit normalement`)
          : short ? `conscient${e}, orienté${e}` : `Conscient${e}, orienté${e}, obéit aux ordres simples`);
      } else {
        const verb = (kid ? VERB_KID : VERB)[v.V].replace('orienté', `orienté${e}`).replace(/^confus$/, `confus${e}`);
        const motor = kid && v.M === 6 ? 'bouge normalement' : MOTOR[v.M];
        const parts = short ? [verb, motor] : [EYES[v.E], verb, motor];
        out.push(cap(parts.join(', ')));
      }
    } else {
      const g = v.gcs;
      const t = g >= 15 ? (kid ? `éveillé${e}, interagit` : `conscient${e}, orienté${e}`)
        : g >= 14 ? (kid ? 'irritable, se console' : `conscient${e}, un peu confus${e}`)
        : g >= 13 ? `confus${e}, ouvre les yeux à la voix`
        : g >= 9 ? `somnolent${e}, réponses confuses ou inadaptées`
        : g >= 6 ? "ne réagit qu'à la douleur, réponse inadaptée"
        : 'réaction anormale à la douleur seulement';
      out.push(short ? t : cap(t));
    }
  }
  for (const x of v.extras) if (/retrait psychologique/i.test(x)) out.push(short ? 'prostré' : 'retrait psychologique');
  return out;
}

const CHEST = /thora|poumon|pneumo|h[ée]mothorax|blast pulm|côtes|volet/i;
const sentence = (parts) => (parts.length ? `${cap(parts.join(' ; '))}.` : '');

// ------------------------------------------------------------ fiche
/** Version « mode réel » des blocs Ventilation / Circulation / Neurologie */
export function realClinical(c) {
  if (!c) return c;
  const n = norms(c.age);
  const o = c.real ?? {};
  const vv = parseVitals(c.vent), vc = parseVitals(c.circ), vn = parseVitals(c.neuro);
  const R = { ...vv, extras: vv.extras };
  const C = { ...vc, temp: vc.temp ?? vv.temp ?? vn.temp, extras: vc.extras };
  const N = { ...vn, extras: vn.extras };
  return {
    ...c,
    pres: c.pres ? scrub(c.pres) : c.pres,
    vent: o.vent?.trim() || sentence(resp(R, n, false, { gcs: vn.gcs, chest: CHEST.test(`${c.lesion} ${c.pres}`) })) || c.vent,
    circ: o.circ?.trim() || sentence(circ(C, n, false)) || c.circ,
    neuro: o.neuro?.trim() || sentence(neuro(N, c.sex, false, n)) || c.neuro,
  };
}

/** Ligne de paramètres d'une évolution, version mode réel */
export function realParams(params, { age, sex } = {}) {
  if (!params) return params;
  const v = parseVitals(params);
  const n = norms(age);
  const parts = [...resp({ ...v, extras: v.extras }, n, true, { gcs: v.gcs }), ...circ({ ...v, extras: [] }, n, true), ...neuro({ ...v, extras: v.extras }, sex, true, n)];
  return parts.length ? parts.join(' · ') : params;
}

/** Affichage d'une ligne de paramètres selon le mode */
export function shownParams(stage, clinical) {
  if (!REAL || !stage?.params) return stage?.params ?? '';
  return stage.paramsReal?.trim() || realParams(stage.params, clinical ?? {});
}

/** Textes libres affichés en cours de partie (évolutions, messages des gestes) */
export function realText(t) {
  if (!REAL || !t) return t;
  return scrub(t);
}
function scrub(t) {
  return String(t)
    .replace(/SpO2 correcte/gi, 'lèvres bien colorées')
    .replace(/\s*\((?:[^()]*\b(?:SpO2|PA|FC|GCS)\b[^()]*)\)/g, '')
    .replace(/la saturation s'effondre/gi, 'les lèvres deviennent bleues')
    .replace(/la saturation (?:remonte|s'améliore)/gi, 'la coloration s\'améliore')
    .replace(/\bSpO2\s*(?:abaissée|basse)/gi, 'hypoxie')
    .replace(/\s{2,}/g, ' ');
}

/**
 * Prépare une victime pour l'affichage en mode réel : textes des évolutions
 * et messages des gestes sans chiffres. Les valeurs d'origine restent
 * (stage.params, stage.text) pour la logique du jeu et le bilan.
 */
export function realizeVictim(v) {
  if (!REAL) return;
  const c = v.clinical ?? v.entry?.clinical ?? {};
  for (const st of v.evo?.stages ?? []) {
    st.pShow = st.params ? (st.paramsReal?.trim() || realParams(st.params, c)) : '';
    st.tShow = realText(st.text);
  }
  const acts = {};
  for (const [k, a] of Object.entries(v.actions ?? {})) {
    acts[k] = a && typeof a === 'object' ? { ...a, ...(a.msg ? { msg: realText(a.msg) } : {}), ...(a.earlyMsg ? { earlyMsg: realText(a.earlyMsg) } : {}) } : a;
  }
  v.actions = acts;
}
