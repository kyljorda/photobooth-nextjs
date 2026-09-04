// ─────────────────────────────────────────────────────────────
// PRINT GEOMETRY
//
// The screen strip and the printed strip are NOT the same artifact.
// The screen version is sized for a phone; the printed one must match
// the physical media exactly or the printer stretches it or leaves a
// white edge. Everything here is derived from real inches and DPI.
//
// DNP DS620A prints 2x6 strips two-up on a 4x6 sheet and cuts them.
// ─────────────────────────────────────────────────────────────

// Deliberately dependency-free. The Node print agent runs this file
// directly with no bundler, so it cannot use the '@/' alias or
// extensionless imports that config.js relies on. These two defaults
// must stay in step with PHOTO_COUNT and FRAME_ASPECT in config.js;
// assertMatchesConfig() below enforces that at startup.
export const DEFAULT_FRAME_COUNT = 4;
export const DEFAULT_FRAME_ASPECT = 4 / 3;

export const PRINT_DPI = 300;

// Physical media. STRIP is the finished product; SHEET is what the
// printer actually receives (two strips side by side).
export const STRIP_IN = { w: 2, h: 6 };
export const SHEET_IN = { w: 4, h: 6 };

// Margins in inches. The caption band holds the date and must stay
// clear of frames — dye-sub has no bleed, so keep art off the edge.
const DEFAULTS = {
  sideMarginIn: 0.15,
  topMarginIn: 0.13,
  captionIn: 0.62,
  gapIn: 0.08,
  // Dye-sub printers lose a sliver at the edges. Keeping content
  // inside this inset avoids clipped frames.
  safeInsetIn: 0.04,
};

export const inchesToPx = (inches, dpi = PRINT_DPI) => Math.round(inches * dpi);

/**
 * Solves the frame box for a strip so that N frames at a fixed aspect
 * ratio fit the media exactly. If the frames would overflow, they are
 * scaled down and the block is re-centred rather than cropped.
 *
 * Returns pixel geometry — no canvas, no DOM, so it runs identically in
 * the browser preview and in the Node print agent.
 */
export function computeStripLayout(opts = {}) {
  const {
    dpi = PRINT_DPI,
    widthIn = STRIP_IN.w,
    heightIn = STRIP_IN.h,
    frameCount = DEFAULT_FRAME_COUNT,
    frameAspect = DEFAULT_FRAME_ASPECT,
    sideMarginIn = DEFAULTS.sideMarginIn,
    topMarginIn = DEFAULTS.topMarginIn,
    captionIn = DEFAULTS.captionIn,
    gapIn = DEFAULTS.gapIn,
    safeInsetIn = DEFAULTS.safeInsetIn,
  } = opts;

  const W = inchesToPx(widthIn, dpi);
  const H = inchesToPx(heightIn, dpi);
  const side = inchesToPx(sideMarginIn, dpi);
  const top = inchesToPx(topMarginIn, dpi);
  const caption = inchesToPx(captionIn, dpi);
  const gap = inchesToPx(gapIn, dpi);
  const safe = inchesToPx(safeInsetIn, dpi);

  // Width is the binding constraint under normal margins.
  let frameW = W - side * 2;
  let frameH = Math.round(frameW / frameAspect);

  const totalGaps = gap * (frameCount - 1);
  let blockH = frameH * frameCount + totalGaps;
  let available = H - top - caption;

  // If the natural frame size overflows the media, shrink to fit.
  // Never crop here: cropping already happened at capture time, and
  // cropping twice throws away the composition the user framed.
  if (blockH > available) {
    frameH = Math.floor((available - totalGaps) / frameCount);
    frameW = Math.round(frameH * frameAspect);
    blockH = frameH * frameCount + totalGaps;
  }

  const offsetX = Math.round((W - frameW) / 2);
  // Distribute any slack so the block sits optically centred in the
  // area above the caption.
  const slack = available - blockH;
  const offsetY = top + Math.round(slack / 2);

  const frames = Array.from({ length: frameCount }, (_, i) => ({
    x: offsetX,
    y: offsetY + i * (frameH + gap),
    w: frameW,
    h: frameH,
  }));

  const lastFrame = frames[frames.length - 1];
  const captionTop = lastFrame.y + lastFrame.h;

  return {
    dpi,
    width: W,
    height: H,
    frames,
    gap,
    safeInset: safe,
    caption: {
      // Two lines: brand above, date below.
      centerX: Math.round(W / 2),
      top: captionTop,
      brandBaselineY: Math.round(captionTop + (H - captionTop) * 0.42),
      dateBaselineY: Math.round(captionTop + (H - captionTop) * 0.78),
      maxWidth: W - side * 2,
      // Scale type with DPI so it is legible at any resolution.
      brandFontPx: Math.max(9, Math.round(0.050 * dpi)),
      dateFontPx: Math.max(8, Math.round(0.041 * dpi)),
    },
    // Anything outside this rect risks being trimmed by the cutter.
    safeArea: { x: safe, y: safe, w: W - safe * 2, h: H - safe * 2 },
  };
}

/**
 * Two-up sheet: the same strip printed twice side by side on 4x6.
 * This is how photo booths halve both cost and print time — one cycle
 * yields two strips, and the DS620A cuts them apart.
 */
export function computeSheetLayout(opts = {}) {
  const { dpi = PRINT_DPI, widthIn = SHEET_IN.w, heightIn = SHEET_IN.h } = opts;
  const strip = computeStripLayout({ ...opts, dpi });
  const W = inchesToPx(widthIn, dpi);
  const H = inchesToPx(heightIn, dpi);

  return {
    dpi,
    width: W,
    height: H,
    strip,
    // Where each copy of the strip is placed on the sheet.
    slots: [
      { x: 0, y: 0 },
      { x: W - strip.width, y: 0 },
    ],
    // The cutter separates the two strips down the middle.
    cutLineX: Math.round(W / 2),
  };
}

/**
 * Guards against silently shipping a mis-proportioned print. Call this
 * in tests and at agent startup — a layout that does not fit the media
 * should fail loudly, not print wrong on a paid order.
 */
export function assertLayoutFits(layout) {
  const problems = [];
  for (const [i, f] of layout.frames.entries()) {
    if (f.x < 0 || f.y < 0) problems.push(`frame ${i} has negative origin`);
    if (f.x + f.w > layout.width) problems.push(`frame ${i} overflows width`);
    if (f.y + f.h > layout.height) problems.push(`frame ${i} overflows height`);
  }
  const last = layout.frames[layout.frames.length - 1];
  if (last && last.y + last.h > layout.caption.top) {
    problems.push('frames overlap the caption band');
  }
  if (problems.length) {
    throw new Error(`Print layout invalid: ${problems.join('; ')}`);
  }
  return true;
}

/**
 * Fails fast if the app's config drifts from the print defaults. Call
 * from the API route and the print agent so a mismatch surfaces at
 * startup rather than as a wrongly-proportioned print on a paid order.
 */
export function assertMatchesConfig(photoCount, frameAspect) {
  if (photoCount !== DEFAULT_FRAME_COUNT) {
    throw new Error(
      `Frame count drift: config says ${photoCount}, print layout assumes ${DEFAULT_FRAME_COUNT}. Update lib/print-layout.js.`
    );
  }
  if (Math.abs(frameAspect - DEFAULT_FRAME_ASPECT) > 1e-6) {
    throw new Error(
      `Frame aspect drift: config says ${frameAspect}, print layout assumes ${DEFAULT_FRAME_ASPECT}.`
    );
  }
  return true;
}
