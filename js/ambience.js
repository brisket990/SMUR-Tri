// ============================================================
//  Ambiance : bulles de BD (appels à l'aide, cris, pleurs) et
//  téléphones qui sonnent, de plus en plus nombreux avec le temps
// ============================================================
//  Les bulles restent cohérentes avec l'état des victimes : seules les
//  victimes conscientes parlent ; une victime inconsciente, agonique ou
//  décédée se tait… mais son téléphone peut sonner.

import { CONFIG } from './config.js';

const LINES = {
  talk: ['Aidez-moi !', 'Par ici !', "J'ai mal…", 'Je saigne !', 'Ne me laissez pas !', "S'il vous plaît…",
    'Vite !', "J'ai froid…", 'Il y a quelqu\'un ?', 'Où est mon amie ?', 'Appelez ma mère…', 'Je veux sortir…',
    'Ma jambe !', 'Je ne sens plus mon bras…', 'Ils sont partis ?'],
  shout: ['AU SECOURS !', "À L'AIDE !!", 'AAAAH !', 'ICI !!', 'AIDEZ-NOUS !', 'VENEZ !'],
  cry: ['(sanglots)', 'Snif… snif…', 'Hnnn… hnnn…', '(pleurs)', 'Mmmh…', '(gémissements)'],
  breath: ["J'arrive plus… à respirer…", '(respiration sifflante)', 'Hhh… hhh…'],
  phone: { marimba: ['♪ ♫ ♪ ♫', '♫ ♪♪ ♫'], synth: ['♪ ♪ ♫', '♫ ♫ ♪'], bell: ['DRIIING !', 'DRING DRING !'],
    digital: ['Bip bip bip…', 'BIP BIP'], vibrate: ['BZZZ… BZZZ…', 'Vrrr… vrrr…'], file: ['♪ ♫ ♪', 'DRIIING !'] },
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const gcsOf = (txt) => { const m = /GCS\s*(\d+)/i.exec(txt ?? ''); return m ? +m[1] : null; };

/** Ce que la victime peut « dire » dans son état actuel (null = silencieuse) */
function voiceOf(v) {
  if (v.status === 'DEAD') return null;
  const stage = v.evo?.stage ? v.evo.stages[v.evo.stage - 1] : null;
  if (stage && (stage.triage === 'BLACK' || (gcsOf(stage.params) ?? 15) <= 12)) return null;
  const c = v.clinical;
  if (!c) return 'talk';                                  // pas de données (mode non autorisé)
  const text = `${c.pres} ${c.lesion}`.toLowerCase();
  if ((gcsOf(c.neuro) ?? 15) <= 12 || /inerte|aréactif|inconscien|arrêt/.test(text)) return null;
  if (/mutique|prostré/.test(text)) return null;          // sidération : ne parle pas
  if (/thora|dyspnée|respirat|pneumo/.test(text) && Math.random() < 0.5) return 'breath';
  if (/panique|pleure|hurle|agité/.test(text) && Math.random() < 0.5) return Math.random() < 0.5 ? 'shout' : 'cry';
  const r = Math.random();
  return r < 0.55 ? 'talk' : r < 0.8 ? 'cry' : 'shout';
}

export function createAmbience(state, camera, sound, opts) {
  const A = CONFIG.ambience;
  const bubbles = [];   // { v, text, kind, born, life, phone? }
  let nextTalk = 2000;
  let nextPhone = A.phones.firstAfterSec * 1000;

  const minutes = () => state.clock.elapsedMs / 60000;
  const phoneInterval = () => Math.max(A.phones.minIntervalSec, A.phones.startIntervalSec - minutes() * A.phones.accelPerMin) * 1000;
  const maxPhones = () => Math.min(A.phones.maxConcurrent, 1 + Math.floor(minutes() / A.phones.addOneEveryMin));

  function spawnTalk(now) {
    const pool = state.victims.filter((v) => v.evac?.state !== 'pma' && !bubbles.some((b) => b.v === v)).map((v) => [v, voiceOf(v)]).filter(([, k]) => k);
    if (!pool.length) return;
    const [v, kind] = pick(pool);
    const [l0, l1] = A.talk.lifeSec;
    bubbles.push({ v, kind, text: pick(LINES[kind]), born: now, life: (l0 + Math.random() * (l1 - l0)) * 1000 });
  }

  function spawnPhone(now) {
    const pool = state.victims.filter((v) => v.evac?.state !== 'pma' && !bubbles.some((b) => b.v === v && b.phone));
    if (!pool.length) return;
    const v = pick(pool);
    const ringer = opts.sound ? sound.ring() : null;
    const kind = ringer?.kind ?? pick(['marimba', 'bell', 'digital', 'vibrate', 'synth']);
    const life = (A.phones.ringSec[0] + Math.random() * (A.phones.ringSec[1] - A.phones.ringSec[0])) * 1000;
    bubbles.push({ v, kind: 'phone', ring: kind, text: pick(LINES.phone[kind]), born: now, life, phone: true, ringer });
  }

  function update(dtMs) {
    const now = state.clock.elapsedMs;
    const active = state.clock.running && !state.over;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (!active || now - b.born > b.life || (!b.phone && b.v.status === 'DEAD') || b.v.evac?.state === 'pma') {
        b.ringer?.stop();
        bubbles.splice(i, 1);
      } else if (b.ringer) {
        // volume selon la distance à la lampe de poche, panoramique selon la position à l'écran
        const [sx, sy] = camera.worldToScreen(b.v.x, b.v.y);
        const d = Math.hypot(sx - opts.mouse.x, sy - opts.mouse.y);
        const onScreen = sx > 0 && sx < camera.vw && sy > 0 && sy < camera.vh;
        const vol = (0.12 + 0.88 * Math.exp(-d / 420)) * (onScreen ? 1 : 0.5);
        b.ringer.update(vol, (sx - camera.vw / 2) / (camera.vw / 2));
      }
    }
    if (!active) return;

    if (opts.bubbles && (nextTalk -= dtMs) <= 0) {
      if (bubbles.filter((b) => !b.phone).length < A.talk.maxConcurrent) spawnTalk(now);
      nextTalk = (A.talk.intervalSec[0] + Math.random() * (A.talk.intervalSec[1] - A.talk.intervalSec[0])) * 1000;
    }
    if (opts.phones && (nextPhone -= dtMs) <= 0) {
      if (bubbles.filter((b) => b.phone).length < maxPhones()) spawnPhone(now);
      nextPhone = phoneInterval() * (0.6 + Math.random() * 0.8);
    }
  }

  // ---------- dessin (repère écran, par-dessus la pénombre) ----------
  function draw(ctx) {
    const now = state.clock.elapsedMs;
    const placed = [];   // rectangles déjà dessinés : on empile au lieu de superposer
    for (const b of [...bubbles].sort((a, c) => a.born - c.born)) {
      const [sx, sy0] = camera.worldToScreen(b.v.x, b.v.y - b.v.h * 0.55);
      if (sx < -150 || sx > camera.vw + 150 || sy0 < -80 || sy0 > camera.vh + 80) continue;
      const w = bubbleWidth(ctx, b), h = 34;
      let sy = sy0;
      for (let k = 0; k < 6; k++) {
        const top = sy - 44, clash = placed.find((r) => sx - w / 2 < r.x + r.w && sx + w / 2 > r.x && top < r.y + r.h && top + h > r.y);
        if (!clash) break;
        sy = clash.y - 6 + 44 - h;        // juste au-dessus de la bulle gênante
      }
      placed.push({ x: sx - w / 2, y: sy - 44, w, h });
      const age = now - b.born;
      const pop = Math.min(1, age / 160);
      const fade = Math.min(1, (b.life - age) / 300);
      const wobble = b.phone ? Math.sin(age / 45) * 2.2 : 0;   // le téléphone « vibre »
      drawBubble(ctx, sx + wobble, sy, b, 0.6 + 0.4 * easeOutBack(pop), Math.max(0, fade), sy0 - sy);
    }
  }

  /** Bulle d'alerte (secouriste qui signale une aggravation) */
  function alert(v, text) {
    bubbles.push({ v, kind: 'alert', text, born: state.clock.elapsedMs, life: 5000 });
  }

  /** Bulle libre (ex. appel des valides par le SMUR à l'arrivée) */
  function say(anchor, text, kind = 'talk', life = 5000) {
    bubbles.push({ v: anchor, kind, text, born: state.clock.elapsedMs, life });
  }

  function stopAll() { bubbles.forEach((b) => b.ringer?.stop()); bubbles.length = 0; }

  return { update, draw, stopAll, alert, say, count: () => bubbles.length };
}

function easeOutBack(x) { const c = 1.7; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; }

const STYLE = {
  talk:   { bg: '#fffdf6', fg: '#111', border: '#111', font: '600 15px "Comic Sans MS", "Comic Neue", "Chalkboard SE", system-ui, sans-serif' },
  breath: { bg: '#eef3ff', fg: '#1b2a4a', border: '#1b2a4a', font: 'italic 600 14px "Comic Sans MS", "Comic Neue", system-ui, sans-serif' },
  cry:    { bg: '#e8f1ff', fg: '#23406e', border: '#23406e', font: 'italic 600 14px "Comic Sans MS", "Comic Neue", system-ui, sans-serif' },
  shout:  { bg: '#fff3c4', fg: '#b3120f', border: '#b3120f', font: '900 17px Impact, "Arial Black", system-ui, sans-serif' },
  phone:  { bg: '#ffffff', fg: '#0d47a1', border: '#1565c0', font: '800 15px system-ui, sans-serif' },
  alert:  { bg: '#ff9800', fg: '#111', border: '#111', font: '900 15px system-ui, sans-serif' },
};

function bubbleWidth(ctx, b) {
  ctx.save();
  ctx.font = (STYLE[b.kind] ?? STYLE.talk).font;
  const w = ctx.measureText(b.phone ? `📱 ${b.text}` : b.text).width + 26;
  ctx.restore();
  return w;
}

function drawBubble(ctx, x, y, b, scale, alpha, lift = 0) {
  const st = STYLE[b.kind] ?? STYLE.talk;
  const text = b.phone ? `📱 ${b.text}` : b.text;
  // bulle décalée pour ne pas en masquer une autre : fin trait jusqu'à la victime
  if (lift > 2) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = st.border;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + lift); ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = st.font;
  const w = ctx.measureText(text).width + 22;
  const h = 30;
  const bx = -w / 2, by = -h - 14;

  ctx.fillStyle = st.bg;
  ctx.strokeStyle = st.border;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (b.kind === 'shout') spiky(ctx, bx - 4, by - 4, w + 8, h + 8);
  else if (b.phone) roundRect(ctx, bx, by, w, h, 8);
  else roundRect(ctx, bx, by, w, h, h / 2);
  ctx.fill();
  ctx.stroke();

  // pointe vers la victime (ou petites ondes pour le téléphone)
  ctx.beginPath();
  if (b.phone) {
    ctx.lineWidth = 2;
    for (const r of [6, 11]) { ctx.moveTo(r, 0); ctx.arc(0, 0, r, -0.9, 0.9); ctx.moveTo(-r, 0); ctx.arc(0, 0, r, Math.PI - 0.9, Math.PI + 0.9); }
    ctx.stroke();
  } else {
    ctx.moveTo(-7, by + h - 1); ctx.lineTo(-2, -2); ctx.lineTo(7, by + h - 1);
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(-7, by + h); ctx.lineTo(-2, -2); ctx.lineTo(7, by + h); ctx.stroke();
    ctx.fillStyle = st.bg; ctx.fillRect(-6, by + h - 3.5, 12, 4);
  }

  ctx.fillStyle = st.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, by + h / 2 + 1);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function spiky(ctx, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2, n = 18;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = i % 2 ? 1 : 1.22;
    const px = cx + Math.cos(a) * (w / 2) * k, py = cy + Math.sin(a) * (h / 2) * k;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
