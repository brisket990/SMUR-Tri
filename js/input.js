// ============================================================
//  Souris / tactile : glisser = déplacer, molette = zoom, clic = action
// ============================================================

const DRAG_THRESHOLD = 5; // px : en dessous, c'est un clic

export function attachInput(canvas, camera, cfg, { onMove, onClick }) {
  const mouse = { x: camera.vw / 2, y: camera.vh / 2, inside: false };
  let down = null; // { x, y, lastX, lastY, dragging }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    down = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, dragging: false };
  });

  canvas.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.inside = true;
    if (down) {
      if (!down.dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_THRESHOLD) {
        down.dragging = true;
        canvas.classList.add('dragging');
      }
      if (down.dragging) {
        camera.pan(e.clientX - down.lastX, e.clientY - down.lastY);
      }
      down.lastX = e.clientX;
      down.lastY = e.clientY;
    }
    onMove?.(mouse, !!down?.dragging);
  });

  const release = (e) => {
    if (!down) return;
    const wasDrag = down.dragging;
    down = null;
    canvas.classList.remove('dragging');
    if (!wasDrag && e.type === 'pointerup') onClick?.(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => (mouse.inside = false));

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      // exp() : zoom doux à la molette comme au pavé tactile
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      camera.zoomAt(e.clientX, e.clientY, factor, cfg.zoom.min, cfg.zoom.max);
      onMove?.(mouse, false);
    },
    { passive: false }
  );

  return mouse;
}
