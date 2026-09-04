import sharp from 'sharp';
import {
  computeStripLayout, computeSheetLayout, assertLayoutFits,
} from '../lib/print-layout.js';

// Must mirror BG_COLORS / BG_TEXT_COLORS in lib/config.js.
const BG = { white: '#F5F0E8', black: '#1A1714', pink: '#FFCCFF' };
const FG = { white: '#2A2520', black: '#F5F0E8', pink: '#2A2520' };

const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])
  );

const FETCH_TIMEOUT_MS = 30_000;
const MAX_FRAME_BYTES = 20 * 1024 * 1024;

function dataUrlToBuffer(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('Malformed data URL');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

/**
 * Frames arrive as https URLs pointing at Blob storage. Accepts a data
 * URL too so the dry-run harness can pass synthetic frames.
 */
async function loadFrame(source) {
  if (typeof source !== 'string') throw new Error('Frame is not a string');
  if (source.startsWith('data:')) return dataUrlToBuffer(source);

  if (!source.startsWith('https://')) {
    throw new Error('Frame URL must be https');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(source, { signal: controller.signal });
    if (!res.ok) throw new Error(`Frame fetch failed: ${res.status}`);

    // Guard against a pathological response exhausting memory on a
    // machine that also has to drive a printer.
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_FRAME_BYTES) throw new Error('Frame is too large');

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_FRAME_BYTES) throw new Error('Frame is too large');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Applies the same grade the app previews, but at full capture
 * resolution. Screen preview uses CSS filters; those do not exist here,
 * so the maths is reproduced with sharp's pipeline.
 */
function applyFilter(pipeline, filter) {
  if (filter === 'bw') {
    return pipeline.greyscale().linear(1.06, -0.06 * 128);
  }
  if (filter === 'sepia') {
    // Luminance, then tint. Matches the browser-side sepia constants.
    return pipeline.greyscale().tint({ r: 244, g: 222, b: 179 });
  }
  return pipeline.linear(1.03, -0.03 * 128);
}

/**
 * Renders one 2x6 strip at print geometry from the ORIGINAL frames.
 *
 * This is why the payload carries individual frames rather than the
 * screen composite: the composite is 680x1970 (1:2.897) with each frame
 * already downsampled to 600x450. Printing that onto 2x6 would both
 * distort it and throw away most of the captured detail. Composing here
 * from 1400x1050 sources keeps the full resolution and hits 1:3 exactly.
 */
export async function renderStrip({ frames, background, filter, dateText, dpi = 300 }) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error('No frames supplied');
  }

  const layout = computeStripLayout({ dpi, frameCount: frames.length });
  assertLayoutFits(layout);

  const bg = BG[background] || BG.white;
  const fg = FG[background] || FG.white;

  const composites = [];
  for (const [i, frame] of frames.entries()) {
    const box = layout.frames[i];
    const buf = await loadFrame(frame);
    const img = await applyFilter(sharp(buf), filter)
      // 'cover' preserves aspect and crops the overflow. The source is
      // already 4:3 from capture, so in practice nothing is cropped —
      // this only guards against a malformed frame.
      .resize(box.w, box.h, { fit: 'cover', position: 'centre' })
      .toBuffer();
    composites.push({ input: img, left: box.x, top: box.y });
  }

  {
    const {
      centerX, brandBaselineY, dateBaselineY, brandFontPx, dateFontPx,
    } = layout.caption;

    // Brand always prints; the date only if supplied. Matches the
    // on-screen strip so what the customer previews is what ships.
    const dateLine = dateText
      ? `<text x="${centerX}" y="${dateBaselineY}"
               font-family="Courier New, monospace" font-size="${dateFontPx}"
               font-weight="700" letter-spacing="${dateFontPx * 0.20}"
               fill="${fg}" fill-opacity="0.75"
               text-anchor="middle">${escapeXml(dateText.toUpperCase())}</text>`
      : '';

    const svg = Buffer.from(
      `<svg width="${layout.width}" height="${layout.height}">
         <text x="${centerX}" y="${brandBaselineY}"
               font-family="Courier New, monospace" font-size="${brandFontPx}"
               font-weight="700" letter-spacing="${brandFontPx * 0.22}"
               fill="${fg}" text-anchor="middle">VINTAGE STRIP CLUB</text>
         ${dateLine}
       </svg>`
    );
    composites.push({ input: svg, left: 0, top: 0 });
  }

  return sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 3,
      background: bg,
    },
  })
    .composite(composites)
    .jpeg({ quality: 96, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

/**
 * Places two copies of the strip on one 4x6 sheet. The DS620A cuts them
 * apart, so a single print cycle yields two strips — halving both media
 * cost and print time.
 */
export async function renderSheet(opts) {
  const stripBuf = await renderStrip(opts);
  const sheet = computeSheetLayout({ dpi: opts.dpi ?? 300, frameCount: opts.frames.length });

  return sharp({
    create: {
      width: sheet.width,
      height: sheet.height,
      channels: 3,
      background: BG[opts.background] || BG.white,
    },
  })
    .composite(sheet.slots.map((slot) => ({ input: stripBuf, left: slot.x, top: slot.y })))
    .jpeg({ quality: 96, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

/**
 * Fallback for orders that only carry the screen composite. Letterboxes
 * rather than stretches, so an older order still prints without
 * distortion — it just will not fill the strip edge to edge.
 */
export async function renderFromComposite({ stripImage, background, dpi = 300 }) {
  const layout = computeStripLayout({ dpi });
  const buf = await loadFrame(stripImage);
  return sharp(buf)
    .resize(layout.width, layout.height, {
      fit: 'contain',
      background: BG[background] || BG.white,
    })
    .jpeg({ quality: 96, chromaSubsampling: '4:4:4' })
    .toBuffer();
}
