// Renders a print-geometry sheet from synthetic frames and writes it to
// disk WITHOUT touching the printer. Use this to verify geometry, colour
// and the date band before any hardware arrives.
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { renderStrip, renderSheet } from './compose.js';
import { computeStripLayout, computeSheetLayout } from '../lib/print-layout.js';

const DPI = Number(process.env.VSC_DPI || 300);

async function fakeFrame(i) {
  const hues = [[196,58,43],[212,168,83],[74,155,110],[58,58,58]];
  const [r,g,b] = hues[i % hues.length];
  const buf = await sharp({
    create: { width: 1400, height: 1050, channels: 3, background: { r, g, b } },
  })
    .composite([{
      input: Buffer.from(
        `<svg width="1400" height="1050"><text x="700" y="600"
           font-family="monospace" font-size="360" font-weight="700"
           fill="#ffffff" text-anchor="middle">${i + 1}</text></svg>`
      ),
      top: 0, left: 0,
    }])
    .jpeg({ quality: 92 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

const frames = await Promise.all([0,1,2,3].map(fakeFrame));
const dateText = new Date().toLocaleDateString('en-US',
  { month: 'long', day: 'numeric', year: 'numeric' });

for (const bg of ['white','black','pink']) {
  const strip = await renderStrip({ frames, background: bg, filter: 'original', dateText, dpi: DPI });
  await fs.writeFile(`./dryrun-strip-${bg}.jpg`, strip);
}
const sheet = await renderSheet({ frames, background: 'white', filter: 'original', dateText, dpi: DPI });
await fs.writeFile('./dryrun-sheet-4x6.jpg', sheet);

const s = computeStripLayout({ dpi: DPI });
const sh = computeSheetLayout({ dpi: DPI });
console.log(`strip : ${s.width}x${s.height}px  (${(s.width/DPI).toFixed(2)}x${(s.height/DPI).toFixed(2)}in, 1:${(s.height/s.width).toFixed(3)})`);
console.log(`sheet : ${sh.width}x${sh.height}px  (${(sh.width/DPI).toFixed(2)}x${(sh.height/DPI).toFixed(2)}in)`);
console.log('wrote dryrun-strip-{white,black,pink}.jpg and dryrun-sheet-4x6.jpg');
