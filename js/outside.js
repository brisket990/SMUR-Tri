// ============================================================
//  Ambiance extérieure : sirènes qui approchent avant chaque
//  arrivée de renfort, sirènes lointaines, grésillements radio.
// ============================================================

const rand = (a, b) => a + Math.random() * (b - a);

/** arrivals = [{ atMs, label }] (équipes de brancardage, VL LOG…) */
export function createOutside(state, sound, arrivals, { leadSec = 25 } = {}) {
  const pending = arrivals.map((a) => ({ ...a, done: false })).sort((a, b) => a.atMs - b.atMs);
  let nextRadio = rand(8, 20) * 1000;
  let nextDistant = rand(30, 60) * 1000;

  function update() {
    if (!(state.clock.running || state.mpRunning) || state.over) return;
    const t = state.clock.elapsedMs;
    for (const a of pending) {
      if (!a.done && t >= a.atMs - leadSec * 1000) {
        a.done = true;
        sound.siren(Math.max(4, (a.atMs - t) / 1000), rand(-0.6, 0.6), 0.22);   // arrive pile à l'heure
      }
    }
    if (t >= nextDistant) {
      sound.siren(rand(8, 14), rand(-0.9, 0.9), 0.05);                           // au loin
      nextDistant = t + rand(45, 90) * 1000;
    }
    if (t >= nextRadio) {
      sound.radio(rand(-0.3, 0.3));
      nextRadio = t + rand(12, 30) * 1000;
    }
  }

  return { update };
}
