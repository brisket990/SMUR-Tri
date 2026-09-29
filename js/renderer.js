// ============================================================
//  Rendu Canvas : plan → cartes → lampe de poche → infobulle
// ============================================================

import { TRIAGE, STATUS } from './config.js';

export function createRenderer(canvas, camera, cfg) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  const light = { x: innerWidth / 2, y: innerHeight / 2 };
  const overlays = []; // dessins supplémentaires en repère écran (bulles…)

  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    camera.setViewport(innerWidth, innerHeight);
  }

  function render(state, planImage, mouse, timeSec, dtSec) {
    // 1. fond
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07080b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. monde (plan + cartes), dans le repère caméra
    camera.applyTo(ctx, dpr);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(planImage, 0, 0, state.plan.w, state.plan.h);
    if (state.ui.debugZones) drawZones(ctx, state);

    let hovered = null;
    for (const v of state.victims) {
      if (v.evac?.state === 'pma') continue;           // prise en charge au PMA : plus sur le plan
      if (v.id === state.ui.hoveredId) { hovered = v; continue; }
      drawCard(ctx, v, false, timeSec);
    }
    if (hovered) drawCard(ctx, hovered, true, timeSec); // toujours au-dessus

    // 3. écran : lampe de poche puis infobulle
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = Math.min(1, dtSec * cfg.flashlight.follow);
    light.x += (mouse.x - light.x) * k;
    light.y += (mouse.y - light.y) * k;
    drawFlashlight(ctx, light, cfg.flashlight, timeSec, camera.vw, camera.vh);
    for (const draw of overlays) draw(ctx);
    if (hovered) drawTooltip(ctx, hovered, mouse, camera, state.ui.hoverNote);
  }

  return { resize, render, addOverlay: (fn) => overlays.push(fn) };
}

// ---------- Cartes ----------

function drawCard(ctx, v, hovered, t) {
  const { w, h } = v;
  const s = hovered ? 1.12 : 1;
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(hovered ? v.rot * 0.3 : v.rot);
  ctx.scale(s, s);

  // ombre portée (rectangle décalé : bien plus rapide que shadowBlur ×150)
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(-w / 2 + w * 0.05, -h / 2 + w * 0.07, w, h);

  // face cachée tant que la victime n'a pas été examinée
  const face = v.seenAt == null && v.back ? v.back : v.thumb;
  ctx.drawImage(face, -w / 2, -h / 2, w, h);

  // décès : voile sombre + croix
  if (v.status === STATUS.DEAD) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = '#9aa0a6';
    ctx.lineWidth = w * 0.06;
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, -w * 0.3); ctx.lineTo(w * 0.3, w * 0.3);
    ctx.moveTo(w * 0.3, -w * 0.3); ctx.lineTo(-w * 0.3, w * 0.3);
    ctx.stroke();
  }

  // cadre de tri + pastille (lisible même dézoomé)
  if (v.assignedTriage) {
    const c = TRIAGE[v.assignedTriage].color;
    ctx.strokeStyle = c;
    ctx.lineWidth = w * 0.07;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(-w / 2, -h / 2, w * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = w * 0.04;
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }

  // garrot en place : bande noire en travers du bas de la carte
  if (v.garroted) {
    ctx.fillStyle = '#111';
    ctx.fillRect(-w / 2, h / 2 - w * 0.2, w, w * 0.1);
  }
  // au moins un geste réalisé : pastille blanche "+"
  if (v.careLog.length) {
    const r = w * 0.13;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c62828';
    ctx.fillRect(w / 2 - r * 0.6, h / 2 - r * 0.18, r * 1.2, r * 0.36);
    ctx.fillRect(w / 2 - r * 0.18, h / 2 - r * 0.6, r * 0.36, r * 1.2);
  }

  // état critique : anneau rouge pulsant
  if (v.status === STATUS.CRITICAL) {
    const a = 0.45 + 0.45 * Math.sin(t * 6);
    ctx.strokeStyle = `rgba(255,40,30,${a})`;
    ctx.lineWidth = w * 0.08;
    ctx.strokeRect(-w / 2 - w * 0.1, -h / 2 - w * 0.1, w * 1.2, h + w * 0.2);
  }

  if (hovered) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = w * 0.03;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

// ---------- Lampe de poche ----------

function drawFlashlight(ctx, p, f, t, vw, vh) {
  // léger tremblement de la main
  const r = f.radius * (1 + 0.012 * Math.sin(t * 7.3) + 0.008 * Math.sin(t * 13.1));

  const dark = ctx.createRadialGradient(p.x, p.y, r * 0.12, p.x, p.y, r);
  dark.addColorStop(0, 'rgba(3,5,12,0)');
  dark.addColorStop(0.55, `rgba(3,5,12,${f.darkness * 0.45})`);
  dark.addColorStop(1, `rgba(3,5,12,${f.darkness})`);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, vw, vh);

  if (f.warmth > 0) {
    const warm = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 0.8);
    warm.addColorStop(0, `rgba(255,225,170,${f.warmth})`);
    warm.addColorStop(1, 'rgba(255,225,170,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = warm;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---------- Infobulle ----------

function drawTooltip(ctx, v, mouse, camera, note) {
  const lines = [v.id];
  if (v.assignedTriage) lines.push(TRIAGE[v.assignedTriage].label);
  else lines.push(v.seenAt != null ? 'Vue — non triée' : 'Non examinée');
  if (v.status === STATUS.DEAD) lines.push('✝ Décédée');
  else if (v.seenAt != null && v.evo.stage > v.evo.seenStage) lines.push('⚠ État modifié : réévaluer');
  if (note) lines.push(note);
  ctx.font = '600 13px system-ui, sans-serif';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const h = lines.length * 17 + 10;
  let x = mouse.x + 16;
  let y = mouse.y + 16;
  if (x + w > camera.vw) x = mouse.x - w - 10;
  if (y + h > camera.vh) y = mouse.y - h - 10;
  ctx.fillStyle = 'rgba(14,16,22,0.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#2a2f3a';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#d9dde5';
  lines.forEach((l, i) => ctx.fillText(l, x + 8, y + 20 + i * 17));
}

// ---------- Mode calibrage ----------

function drawZones(ctx, state) {
  const { w: W, h: H } = state.plan;
  ctx.save();
  ctx.lineWidth = 3 / (ctx.getTransform().a || 1);
  ctx.font = `${Math.max(14, W / 90)}px system-ui, sans-serif`;
  state.zones.forEach((z, i) => {
    const hue = (i * 57) % 360;
    for (const [x, y, w, h] of z.rects) {
      ctx.fillStyle = `hsla(${hue},80%,55%,0.18)`;
      ctx.strokeStyle = `hsla(${hue},80%,60%,0.9)`;
      ctx.fillRect(x * W, y * H, w * W, h * H);
      ctx.strokeRect(x * W, y * H, w * W, h * H);
      ctx.fillStyle = `hsla(${hue},80%,75%,1)`;
      ctx.fillText(`${z.id}`, x * W + 6, y * H + W / 70);
    }
  });
  ctx.restore();
}

// ---------- Détection du clic (cartes tournées) ----------

export function pickVictim(state, wx, wy) {
  for (let i = state.victims.length - 1; i >= 0; i--) {
    const v = state.victims[i];
    if (v.evac?.state === 'pma') continue;
    const dx = wx - v.x;
    const dy = wy - v.y;
    const c = Math.cos(-v.rot);
    const s = Math.sin(-v.rot);
    const lx = dx * c - dy * s;
    const ly = dx * s + dy * c;
    if (Math.abs(lx) <= v.w / 2 && Math.abs(ly) <= v.h / 2) return v;
  }
  return null;
}
