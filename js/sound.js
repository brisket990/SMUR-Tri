// ============================================================
//  Sons d'ambiance synthétisés (Web Audio) — aucune ressource externe
// ============================================================
//  Sonneries ORIGINALES reconnaissables comme des téléphones :
//    marimba  mélodie courte façon smartphone (motifs originaux)
//    bell     « dring-dring » de téléphone à sonnette
//    digital  bips électroniques
//    vibrate  vibreur
//  + vos MP3 dans jeu/sons/ (sonnerie-01.mp3, sonnerie-02.mp3…), détectés
//    automatiquement ; à n'utiliser que si vous en détenez les droits.

import { CONFIG } from './config.js';

// Motifs originaux (fréquences en Hz, durées en temps)
const MARIMBA_PATTERNS = [
  [[784, 1], [1047, 1], [880, 1], [1175, 2], [988, 1], [784, 2]],
  [[659, 1], [988, 1], [831, 1], [659, 1], [1109, 2], [988, 2]],
  [[1047, 1], [784, 1], [1319, 1], [1175, 1], [880, 2], [1047, 2]],
];
const SYNTH_PATTERNS = [
  [[523, 1], [659, 1], [784, 1], [1047, 3]],
  [[880, 1], [740, 1], [880, 1], [988, 1], [1175, 3]],
];

export function createSound() {
  let ctx = null;
  let master = null;
  let muted = false;
  const files = [];

  function ensure() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : CONFIG.ambience.volume;
    master.connect(ctx.destination);
    loadFiles();
    return ctx;
  }

  // Détection automatique : sonnerie-01.mp3, sonnerie-02.mp3… jusqu'au premier manquant
  async function loadFiles() {
    const A = CONFIG.ambience;
    for (let i = 1; i <= A.ringtoneMax; i++) {
      const url = `${A.ringtoneDir}sonnerie-${String(i).padStart(2, '0')}.mp3`;
      try {
        const res = await fetch(url);
        if (!res.ok) break;
        files.push(await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch (e) {
        console.warn('Sonnerie illisible :', url, e);
        break;
      }
    }
    if (files.length) console.info(`${files.length} sonnerie(s) MP3 chargée(s)`);
  }

  // ---------- briques ----------
  function tone(out, t, freq, dur, { type = 'sine', gain = 0.3, attack = 0.005, decay = null } = {}) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    if (decay) g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    else { g.gain.setValueAtTime(gain, t + dur - 0.01); g.gain.linearRampToValueAtTime(0, t + dur); }
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + (decay ?? dur) + 0.05);
  }

  // Chaque voix joue UNE occurrence du motif à l'instant t ; retourne sa durée (s)
  const VOICES = {
    marimba(out, t, v) {
      const beat = 0.13 + v.tempo * 0.05;
      let x = t;
      for (const [f, d] of v.pattern) {
        tone(out, x, f, beat * d, { gain: 0.32, decay: 0.45 });
        tone(out, x, f * 4, beat * d, { gain: 0.05, decay: 0.08 }); // attaque boisée
        x += beat * d;
      }
      return x - t + 0.7;
    },
    synth(out, t, v) {
      const beat = 0.14;
      let x = t;
      for (const [f, d] of v.pattern) {
        tone(out, x, f, beat * d * 0.9, { type: 'triangle', gain: 0.5 });
        x += beat * d;
      }
      return x - t + 0.8;
    },
    bell(out, t) {
      // double sonnerie : 0,4 s / 0,2 s / 0,4 s, puis silence
      for (const start of [0, 0.6]) {
        const g = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 22;              // battement du marteau sur la cloche
        lfoGain.gain.value = 0.12;
        lfo.connect(lfoGain).connect(g.gain);
        g.gain.value = 0.12;
        g.connect(out);
        for (const f of [1300, 1650]) {
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = f;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
          o.connect(bp).connect(g);
          o.start(t + start); o.stop(t + start + 0.4);
        }
        lfo.start(t + start); lfo.stop(t + start + 0.4);
      }
      return 3.0;
    },
    digital(out, t) {
      for (let i = 0; i < 4; i++) tone(out, t + i * 0.12, 1760, 0.07, { type: 'square', gain: 0.22 });
      return 1.1;
    },
    vibrate(out, t) {
      for (const start of [0, 0.7]) {
        const o = ctx.createOscillator();
        const lp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = 160;
        lp.type = 'lowpass'; lp.frequency.value = 420;
        g.gain.setValueAtTime(0, t + start);
        g.gain.linearRampToValueAtTime(0.35, t + start + 0.02);
        g.gain.setValueAtTime(0.35, t + start + 0.45);
        g.gain.linearRampToValueAtTime(0, t + start + 0.5);
        o.connect(lp).connect(g).connect(out);
        o.start(t + start); o.stop(t + start + 0.55);
      }
      return 1.6;
    },
    file(out, t, v) {
      const src = ctx.createBufferSource();
      const len = Math.min(v.buffer.duration, CONFIG.ambience.maxFileSec);
      src.buffer = v.buffer;
      src.connect(out);
      src.start(t);
      src.stop(t + len);
      v.sources.push(src);
      return len + 0.5;
    },
  };

  /** Crée une sonnerie ; kind au hasard si absent. Retourne un objet contrôlable. */
  function ring(kind) {
    if (!ensure() || ctx.state === 'closed') return null;
    const synthKinds = ['marimba', 'marimba', 'bell', 'digital', 'vibrate', 'synth'];
    if (!kind) {
      kind = files.length && Math.random() < CONFIG.ambience.fileShare
        ? 'file'
        : synthKinds[Math.floor(Math.random() * synthKinds.length)];
    }
    const v = {
      kind,
      tempo: Math.random(),
      pattern: kind === 'synth'
        ? SYNTH_PATTERNS[Math.floor(Math.random() * SYNTH_PATTERNS.length)]
        : MARIMBA_PATTERNS[Math.floor(Math.random() * MARIMBA_PATTERNS.length)],
      buffer: files[Math.floor(Math.random() * files.length)],
      sources: [],
    };
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    gain.gain.value = 0;
    if (pan) gain.connect(pan).connect(master); else gain.connect(master);
    let next = ctx.currentTime + 0.05;
    let stopped = false;
    return {
      kind,
      /** à appeler à chaque image : programme la suite, règle volume et panoramique */
      update(volume, panning) {
        if (stopped) return;
        gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.08);
        if (pan) pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, panning)), ctx.currentTime, 0.08);
        while (next < ctx.currentTime + 0.25) next += VOICES[kind](gain, next, v);
      },
      stop() {
        if (stopped) return;
        stopped = true;
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        setTimeout(() => { v.sources.forEach((s) => { try { s.stop(); } catch { /* déjà arrêté */ } }); gain.disconnect(); }, 400);
      },
    };
  }

  // ---------- ambiance extérieure ----------
  let noiseBuf = null;
  function noise() {
    if (noiseBuf) return noiseBuf;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /** Sirène « deux tons » qui s'approche pendant durSec secondes, puis s'arrête */
  function siren(durSec = 25, pan = 0, peak = 0.22) {
    if (!ensure()) return;
    const t = ctx.currentTime + 0.05;
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    osc.type = 'square';
    lp.type = 'lowpass';
    // de loin : son étouffé et faible ; en approchant : plus clair et plus fort
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(2200, t + durSec);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + durSec * 0.9);
    g.gain.linearRampToValueAtTime(0, t + durSec);
    for (let k = 0, x = t; x < t + durSec; k++, x += 0.55) {
      osc.frequency.setValueAtTime(k % 2 ? 488 : 435, x);      // alternance deux tons
    }
    osc.connect(lp).connect(g);
    if (p) { p.pan.value = pan; g.connect(p).connect(master); } else g.connect(master);
    osc.start(t); osc.stop(t + durSec + 0.1);
  }

  /** Grésillement de radio (voix brouillée, sans paroles) + bip de fin */
  function radio(pan = 0, level = 0.14) {
    if (!ensure()) return;
    const t = ctx.currentTime + 0.05;
    const dur = 0.8 + Math.random() * 1.6;
    const src = ctx.createBufferSource();
    src.buffer = noise(); src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.4;
    const g = ctx.createGain();
    // modulation irrégulière : rythme de parole brouillée
    g.gain.setValueAtTime(0, t);
    for (let x = t; x < t + dur; x += 0.07 + Math.random() * 0.09) {
      g.gain.linearRampToValueAtTime(level * (0.25 + Math.random() * 0.75), x);
    }
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(bp).connect(g);
    if (p) { p.pan.value = pan; g.connect(p).connect(master); } else g.connect(master);
    src.start(t); src.stop(t + dur + 0.1);
    tone(master, t + dur + 0.08, 1300, 0.09, { type: 'sine', gain: level * 0.9 });   // bip de fin d'émission
  }

  return {
    siren,
    radio,
    unlock: () => ensure()?.resume(),
    fileCount: () => files.length,        // à appeler sur un clic (règle des navigateurs)
    ring,
    suspend: () => ctx?.suspend(),
    resume: () => ctx?.resume(),
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : CONFIG.ambience.volume, ctx.currentTime, 0.05);
    },
    available: () => !!(globalThis.AudioContext || globalThis.webkitAudioContext),
  };
}
