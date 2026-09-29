// ============================================================
//  Chargement des images + miniatures + remplaçants provisoires
// ============================================================

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image introuvable : ${src}`));
    img.src = src;
  });
}

export async function fetchJSON(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src} : HTTP ${res.status}`);
  return res.json();
}

// Réduit une grande fiche en miniature nette (réductions successives par 2,
// sinon un PNG de 2000 px réduit d'un coup à 200 px devient granuleux).
export function makeThumb(source, targetWidth) {
  let w = source.naturalWidth || source.width;
  let h = source.naturalHeight || source.height;
  let current = source;
  while (w / 2 >= targetWidth) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    current = drawTo(current, w, h);
  }
  const ratio = targetWidth / w;
  return drawTo(current, targetWidth, Math.round(h * ratio));
}

function drawTo(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return c;
}

// Exécute fn sur chaque élément avec au plus `limit` tâches en parallèle.
export async function mapPool(items, limit, fn, onProgress) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      onProgress?.(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ------------------------------------------------------------
//  Remplaçants : permettent de tester sans les vrais fichiers
// ------------------------------------------------------------

export function placeholderCard(id) {
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 879; // proportions des fiches SMUR (1016×1489)
  const g = c.getContext('2d');
  g.fillStyle = '#e9e4d8';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#2b2b2b';
  g.fillRect(0, 0, c.width, 120);
  g.fillStyle = '#fff';
  g.font = 'bold 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(id, c.width / 2, 88);
  g.fillStyle = '#8a8373';
  g.font = '34px system-ui, sans-serif';
  g.fillText('Fiche PNG manquante', c.width / 2, 470);
  g.fillText(`images/${id}.png`, c.width / 2, 520);
  g.strokeStyle = '#b9b2a2';
  g.lineWidth = 4;
  for (let y = 180; y < 830; y += 70) {
    if (y > 400 && y < 560) continue;
    g.beginPath(); g.moveTo(50, y); g.lineTo(550, y); g.stroke();
  }
  return c;
}

// Plan schématique généré à partir des zones (en attendant le vrai plan).
export function placeholderPlan(zones, w = 2400, h = 1600) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#26221e';
  g.fillRect(0, 0, w, h);

  // parquet
  g.strokeStyle = 'rgba(255,255,255,0.03)';
  g.lineWidth = 2;
  for (let x = 0; x < w; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }

  // murs extérieurs
  g.strokeStyle = '#8c8577';
  g.lineWidth = 18;
  g.strokeRect(30, 30, w - 60, h - 60);

  const palette = {
    scene: '#3a2f45', fosse: '#2e2a26', bar: '#4a3a28', escalier: '#3b3b3b',
    hall: '#2b3036', sortie: '#23402f', default: '#2f2f2f',
  };
  for (const z of zones) {
    const color = palette[z.kind] || palette.default;
    for (const [x, y, rw, rh] of z.rects) {
      g.fillStyle = color;
      g.fillRect(x * w, y * h, rw * w, rh * h);
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 4;
      g.strokeRect(x * w, y * h, rw * w, rh * h);
      if (z.kind === 'escalier') {
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        g.lineWidth = 3;
        for (let sy = y * h; sy < (y + rh) * h; sy += 22) {
          g.beginPath(); g.moveTo(x * w, sy); g.lineTo((x + rw) * w, sy); g.stroke();
        }
      }
    }
    const [x, y, rw] = z.rects[0];
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(z.label.toUpperCase(), (x + rw / 2) * w, y * h + 46);
  }
  return c;
}

// Carte "menace" (mode non autorisé) : utilisée si images/menace.png est absente.
export function threatCard() {
  const c = document.createElement('canvas');
  c.width = 1016;
  c.height = 1489;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;

  // fond : rouge sombre, halo derrière la silhouette
  g.fillStyle = '#1a0405';
  g.fillRect(0, 0, W, H);
  const halo = g.createRadialGradient(W / 2, H * 0.45, 40, W / 2, H * 0.45, W * 0.75);
  halo.addColorStop(0, '#b3171b');
  halo.addColorStop(0.55, '#4a0709');
  halo.addColorStop(1, '#120203');
  g.fillStyle = halo;
  g.fillRect(40, 40, W - 80, H - 80);

  // cadre
  g.strokeStyle = '#e53935';
  g.lineWidth = 14;
  g.strokeRect(40, 40, W - 80, H - 80);

  // silhouette en contre-jour (tête + épaules), sans détail
  g.fillStyle = '#050505';
  g.beginPath();
  g.ellipse(W / 2, H * 0.34, 125, 150, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(W * 0.16, H * 0.74);
  g.bezierCurveTo(W * 0.18, H * 0.52, W * 0.34, H * 0.46, W / 2, H * 0.46);
  g.bezierCurveTo(W * 0.66, H * 0.46, W * 0.82, H * 0.52, W * 0.84, H * 0.74);
  g.closePath();
  g.fill();

  // bandeau
  g.fillStyle = '#e53935';
  g.fillRect(40, H * 0.74, W - 80, 170);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = '900 120px system-ui, sans-serif';
  g.fillText('MENACE', W / 2, H * 0.74 + 125);
  g.fillStyle = '#ffcdd2';
  g.font = '600 46px system-ui, sans-serif';
  g.fillText('Zone non sécurisée', W / 2, H * 0.74 + 250);
  return c;
}
