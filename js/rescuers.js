// ============================================================
//  Secouristes : on peut en poster un auprès d'une victime
//  (compression manuelle, surveillance) pour continuer le tri.
// ============================================================
//  - Ils arrivent avec les renforts (scenario.json → evacuation.teams[].rescuers).
//  - Poster un secouriste ralentit l'aggravation : fort sur une hémorragie
//    compressible (compression manuelle), léger sinon (surveillance, PLS tenue).
//  - Il donne l'alerte si l'état de la victime s'aggrave.
//  - Il est libéré quand la victime part au PMA, décède, ou sur rappel.

import { logEvent } from './state.js';
import { stretchRemaining } from './evolution.js';

export function createRescuers(state, scenario, { onAlert } = {}) {
  const E = scenario.evacuation ?? {};
  const S = E.rescuerEffect ?? { compression: 2, surveillance: 1.3 };
  let n = 0;
  const pool = (E.teams ?? []).flatMap((g) => Array.from({ length: g.rescuers ?? 0 }, () => ({
    id: `Secouriste ${++n}`, org: g.org, arriveAt: g.atMin * 60000, victim: null, postedAt: null, seenStage: 0,
  })));
  state.rescuers = pool;
  const now = () => state.clock.elapsedMs;

  const available = () => pool.filter((r) => now() >= r.arriveAt && !r.victim);
  const of = (v) => pool.find((r) => r.victim === v) ?? null;

  function post(v) {
    if (of(v)) return { ok: false, message: 'Un secouriste est déjà auprès de cette victime.' };
    if (v.status === 'DEAD') return { ok: false, message: 'Victime décédée.' };
    if (['pma', 'transport', 'loading', 'walking'].includes(v.evac?.state)) return { ok: false, message: 'Victime déjà en cours d\'évacuation.' };
    const r = available()[0];
    if (!r) {
      const next = pool.filter((x) => now() < x.arriveAt).sort((a, b) => a.arriveAt - b.arriveAt)[0];
      return { ok: false, message: next ? `Aucun secouriste libre (prochains avec : ${next.org}).` : 'Aucun secouriste libre.' };
    }
    r.victim = v; r.postedAt = now(); r.seenStage = v.evo.stage;
    // compression manuelle si la victime saigne d'une plaie compressible, sinon surveillance
    const bleeds = ['compressive', 'hemostatic', 'tourniquet'].some((a) => ['stop', 'slow'].includes(v.actions?.[a]?.type));
    const factor = bleeds ? S.compression : S.surveillance;
    r.mode = bleeds ? 'compression manuelle' : 'surveillance';
    if (!v.evo.frozen && v.status !== 'DEAD') stretchRemaining(v, now(), factor);
    v.guard = r.id;
    logEvent(state, 'rescuer', { id: v.id, rescuer: r.id, mode: r.mode, initialUD: v.truth.triage === 'BLACK' });
    return { ok: true, message: `${r.id} (${r.org}) posté : ${r.mode}.` };
  }

  function release(v, reason = 'rappel') {
    const r = of(v);
    if (!r) return { ok: false, message: 'Aucun secouriste auprès de cette victime.' };
    r.victim = null; r.postedAt = null;
    v.guard = null;
    logEvent(state, 'rescuer-free', { id: v.id, rescuer: r.id, reason });
    return { ok: true, message: `${r.id} libéré.` };
  }

  function update() {
    for (const r of pool) {
      const v = r.victim;
      if (!v) continue;
      if (v.status === 'DEAD') { release(v, 'décès'); continue; }
      if (['pma', 'transport', 'loading', 'walking'].includes(v.evac?.state)) { release(v, 'évacuation'); continue; }
      if (v.evo.stage > r.seenStage) {         // le secouriste donne l'alerte
        r.seenStage = v.evo.stage;
        onAlert?.(v, r);
        logEvent(state, 'rescuer-alert', { id: v.id, rescuer: r.id });
      }
    }
  }

  function summary() {
    const t = now();
    const arrived = pool.filter((r) => t >= r.arriveAt);
    const next = pool.filter((r) => t < r.arriveAt).sort((a, b) => a.arriveAt - b.arriveAt)[0];
    return {
      free: arrived.filter((r) => !r.victim).length,
      total: arrived.length,
      next: next ? { org: next.org, inMs: next.arriveAt - t, count: pool.filter((r) => r.arriveAt === next.arriveAt).length } : null,
    };
  }

  // ---------- dessin : secouriste agenouillé près de la victime ----------
  function draw(ctx, camera) {
    for (const r of pool) {
      const v = r.victim;
      if (!v) continue;
      const [x, y] = camera.worldToScreen(v.x - v.w * 0.75, v.y + v.h * 0.1);
      ctx.save();
      ctx.fillStyle = '#ff9800'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.font = '800 10px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('S', x, y + 0.5);
      ctx.restore();
    }
  }

  return { post, release, of, update, summary, draw };
}
