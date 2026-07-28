// ============================================================
// Auth brand-panel motion — cursor spotlight + a drifting field
// of task glyphs (task chips, checkmarks, dots).
//
// Framework-free on purpose: the component calls start() once
// (outside the Angular zone) and the returned dispose() on
// destroy, so pointer/rAF work never triggers change detection.
// ============================================================

type GlyphKind = 'chip' | 'check' | 'dot';

interface Glyph {
  x: number; y: number;
  vy: number;          // upward drift
  size: number;
  alpha: number;
  rot: number;         // radians
  spin: number;        // radians / frame
  sway: number;        // horizontal sway amplitude (px)
  phase: number;       // sway offset
  kind: GlyphKind;
  done: boolean;       // chips: drawn with a ticked checkbox
}

const POINTER_RADIUS = 140;
/** One glyph per N px² of panel, clamped — keeps the field even on any screen. */
const DENSITY = 26_000;
const MAX_GLYPHS = 34;

export function startBrandMotion(panel: HTMLElement, canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  const pointer = { x: -9999, y: -9999, active: false };
  const glyphs: Glyph[] = [];

  let w = 0, h = 0;
  let loop = 0;
  let varsFrame = 0;

  // ---- Pointer → CSS vars (spotlight + content parallax) ----

  const onMove = (e: PointerEvent): void => {
    const r = panel.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.active = true;
    if (varsFrame) return;
    varsFrame = requestAnimationFrame(() => {
      varsFrame = 0;
      if (!r.width || !r.height) return;
      const px = (pointer.x / r.width) * 100;
      const py = (pointer.y / r.height) * 100;
      panel.style.setProperty('--mx', `${px}%`);
      panel.style.setProperty('--my', `${py}%`);
      panel.style.setProperty('--px', `${(px - 50) / 50}`);
      panel.style.setProperty('--py', `${(py - 50) / 50}`);
    });
  };

  const onEnter = (): void => panel.classList.add('is-tracking');

  const onLeave = (): void => {
    panel.classList.remove('is-tracking');
    pointer.active = false;
    pointer.x = pointer.y = -9999;
    panel.style.setProperty('--px', '0');
    panel.style.setProperty('--py', '0');
  };

  // ---- Glyph field ----

  const spawn = (fromBottom: boolean): Glyph => {
    const roll = Math.random();
    const kind: GlyphKind = roll < 0.45 ? 'chip' : roll < 0.72 ? 'check' : 'dot';
    return {
      x: Math.random() * w,
      y: fromBottom ? h + Math.random() * 80 + 20 : Math.random() * h,
      vy: -(Math.random() * 0.22 + 0.10),
      size: kind === 'dot' ? Math.random() * 1.6 + 0.9
          : kind === 'check' ? Math.random() * 6 + 9
          : Math.random() * 10 + 20,
      alpha: kind === 'dot' ? Math.random() * 0.30 + 0.12 : Math.random() * 0.16 + 0.09,
      rot: (Math.random() - 0.5) * 0.5,
      spin: (Math.random() - 0.5) * 0.0022,
      sway: Math.random() * 14 + 6,
      phase: Math.random() * Math.PI * 2,
      kind,
      done: Math.random() < 0.5,
    };
  };

  const seed = (): void => {
    glyphs.length = 0;
    const count = Math.min(MAX_GLYPHS, Math.max(10, Math.round((w * h) / DENSITY)));
    for (let i = 0; i < count; i++) glyphs.push(spawn(false));
  };

  const resize = (): void => {
    const r = panel.getBoundingClientRect();
    w = r.width;
    h = r.height;
    // Panel is display:none below $bp-lg — park the loop until it's shown.
    if (!w || !h || !ctx) {
      if (loop) { cancelAnimationFrame(loop); loop = 0; }
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width  = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    if (!loop && !document.hidden) loop = requestAnimationFrame(draw);
  };

  // ---- Drawing ----

  const roundRect = (c: CanvasRenderingContext2D, x: number, y: number, rw: number, rh: number, r: number): void => {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + rw, y,      x + rw, y + rh, r);
    c.arcTo(x + rw, y + rh, x,      y + rh, r);
    c.arcTo(x,      y + rh, x,      y,      r);
    c.arcTo(x,      y,      x + rw, y,      r);
    c.closePath();
  };

  /** A miniature task row: checkbox + title line. */
  const drawChip = (c: CanvasRenderingContext2D, g: Glyph): void => {
    const cw = g.size;
    const ch = g.size * 0.62;
    const box = ch * 0.52;
    c.lineWidth = 1.1;
    roundRect(c, -cw / 2, -ch / 2, cw, ch, ch * 0.3);
    c.stroke();

    const bx = -cw / 2 + ch * 0.24;
    const by = -box / 2;
    roundRect(c, bx, by, box, box, box * 0.28);
    c.stroke();

    if (g.done) {
      c.lineWidth = 1.3;
      c.beginPath();
      c.moveTo(bx + box * 0.24, by + box * 0.54);
      c.lineTo(bx + box * 0.44, by + box * 0.74);
      c.lineTo(bx + box * 0.78, by + box * 0.28);
      c.stroke();
    }

    c.lineWidth = 1.1;
    c.beginPath();
    c.moveTo(bx + box + ch * 0.28, 0);
    c.lineTo(cw / 2 - ch * 0.26, 0);
    c.stroke();
  };

  const drawCheck = (c: CanvasRenderingContext2D, g: Glyph): void => {
    const s = g.size;
    c.lineWidth = Math.max(1.2, s * 0.16);
    c.beginPath();
    c.moveTo(-s * 0.42, 0);
    c.lineTo(-s * 0.10, s * 0.34);
    c.lineTo(s * 0.46, -s * 0.34);
    c.stroke();
  };

  const draw = (): void => {
    loop = requestAnimationFrame(draw);
    if (!ctx || !w || !h) return;

    const t = performance.now();
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const g of glyphs) {
      g.y += g.vy;
      g.rot += g.spin;
      let x = g.x + Math.sin(t * 0.00018 + g.phase) * g.sway;

      // Nudge away from the pointer.
      if (pointer.active) {
        const dx = x - pointer.x;
        const dy = g.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < POINTER_RADIUS * POINTER_RADIUS && d2 > 1) {
          const d = Math.sqrt(d2);
          const push = ((POINTER_RADIUS - d) / POINTER_RADIUS) * 26;
          x += (dx / d) * push;
          g.y += (dy / d) * push * 0.35;
        }
      }

      // Recycle from the bottom once it leaves the top.
      if (g.y < -60) {
        Object.assign(g, spawn(true));
        continue;
      }

      ctx.save();
      ctx.translate(x, g.y);
      ctx.rotate(g.rot);
      ctx.globalAlpha = g.alpha;
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#ffffff';

      if (g.kind === 'dot') {
        ctx.beginPath();
        ctx.arc(0, 0, g.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (g.kind === 'check') {
        drawCheck(ctx, g);
      } else {
        drawChip(ctx, g);
      }

      ctx.restore();
    }
  };

  // ---- Wiring ----

  const onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(loop);
      loop = 0;
    } else if (!loop && w && h) {
      loop = requestAnimationFrame(draw);
    }
  };

  const ro = new ResizeObserver(() => resize());
  ro.observe(panel);

  panel.addEventListener('pointermove', onMove);
  panel.addEventListener('pointerenter', onEnter);
  panel.addEventListener('pointerleave', onLeave);
  document.addEventListener('visibilitychange', onVisibility);

  resize();   // starts the loop once the panel actually has a size

  return () => {
    cancelAnimationFrame(loop);
    if (varsFrame) cancelAnimationFrame(varsFrame);
    ro.disconnect();
    panel.removeEventListener('pointermove', onMove);
    panel.removeEventListener('pointerenter', onEnter);
    panel.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
