// ============================================================
//  Caméra 2D : déplacement + zoom centré sur le curseur
// ============================================================
//  Coordonnées "monde" = pixels du plan de salle.
//  (x, y) = point du monde affiché au centre de l'écran.

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.fitZoom = 1;
    this.vw = 1;
    this.vh = 1;
    this.bounds = null; // { w, h } du plan
  }

  setViewport(w, h) {
    this.vw = w;
    this.vh = h;
  }

  // Recadre pour voir toute la salle (en laissant la place du HUD à droite).
  fit(planW, planH, { padding = 24, rightReserve = 0 } = {}) {
    this.bounds = { w: planW, h: planH };
    const availW = this.vw - rightReserve - padding * 2;
    const availH = this.vh - padding * 2;
    this.fitZoom = Math.min(availW / planW, availH / planH);
    this.zoom = this.fitZoom;
    // centrer le plan dans la zone libre (à gauche du HUD)
    this.x = planW / 2 + rightReserve / 2 / this.zoom;
    this.y = planH / 2;
  }

  worldToScreen(wx, wy) {
    return [(wx - this.x) * this.zoom + this.vw / 2, (wy - this.y) * this.zoom + this.vh / 2];
  }

  screenToWorld(sx, sy) {
    return [(sx - this.vw / 2) / this.zoom + this.x, (sy - this.vh / 2) / this.zoom + this.y];
  }

  pan(dxScreen, dyScreen) {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clamp();
  }

  zoomAt(sx, sy, factor, minRel, maxRel) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const z = Math.min(this.fitZoom * maxRel, Math.max(this.fitZoom * minRel, this.zoom * factor));
    this.zoom = z;
    // garder le point sous le curseur immobile
    this.x = wx - (sx - this.vw / 2) / z;
    this.y = wy - (sy - this.vh / 2) / z;
    this.clamp();
  }

  // Empêche de perdre le plan hors de l'écran.
  clamp() {
    if (!this.bounds) return;
    const { w, h } = this.bounds;
    this.x = Math.min(w, Math.max(0, this.x));
    this.y = Math.min(h, Math.max(0, this.y));
  }

  applyTo(ctx, dpr) {
    const s = this.zoom * dpr;
    ctx.setTransform(s, 0, 0, s, dpr * (this.vw / 2 - this.x * this.zoom), dpr * (this.vh / 2 - this.y * this.zoom));
  }
}
