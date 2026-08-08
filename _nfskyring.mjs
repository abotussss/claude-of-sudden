/**
 * RE-SCORE A SKYSCAN: a dark mass RINGED BY BRIGHT SKY, not a hole in a
 * silhouette.
 *
 *   node _nfskyring.mjs [shots/skyscan]
 *
 * `_nfskyscan.mjs`'s own filter — a connected near-black blob that touches no
 * edge of the frame — flags 296 of 384 frames, because the gaps BETWEEN boulders
 * in a terrain silhouette are also enclosed and also black. The discriminator
 * that works is the RING: dilate the blob by 4 px and average what is around it.
 * A boulder sits in a silhouette and its ring is dark; a slab hanging in the sky
 * is surrounded by sky and its ring is 45-95. On this map that cuts 296 frames
 * to a dozen, and every one of the dozen is the same object.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const DIR = process.argv[2] ?? 'shots/skyscan';
const DARK = 20, MIN = 250, RING = 42;
const rows = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.png'))) {
  const g = PNG.sync.read(readFileSync(`${DIR}/${f}`));
  const W = g.width, H = g.height;
  const lum = new Float32Array(W * H);
  for (let i = 0, k = 0; i < W * H; i++, k += 4) lum[i] = 0.2126 * g.data[k] + 0.7152 * g.data[k + 1] + 0.0722 * g.data[k + 2];
  const seen = new Uint8Array(W * H); const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || lum[s] >= DARK) continue;
    let sp = 0; stack[sp++] = s; seen[s] = 1;
    const px = []; let edge = false;
    while (sp) {
      const q = stack[--sp]; px.push(q);
      const x = q % W, y = (q / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      if (x > 0 && !seen[q - 1] && lum[q - 1] < DARK) { seen[q - 1] = 1; stack[sp++] = q - 1; }
      if (x < W - 1 && !seen[q + 1] && lum[q + 1] < DARK) { seen[q + 1] = 1; stack[sp++] = q + 1; }
      if (y > 0 && !seen[q - W] && lum[q - W] < DARK) { seen[q - W] = 1; stack[sp++] = q - W; }
      if (y < H - 1 && !seen[q + W] && lum[q + W] < DARK) { seen[q + W] = 1; stack[sp++] = q + W; }
    }
    if (edge || px.length < MIN) continue;
    // ring: pixels within 4 px of the blob that are not in it
    const set = new Set(px); let rs = 0, rn = 0;
    for (const q of px) {
      const x = q % W, y = (q / W) | 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = ny * W + nx; if (set.has(k)) continue; rs += lum[k]; rn++;
      }
    }
    const ring = rs / Math.max(1, rn);
    if (ring < RING) continue;
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (const q of px) { const x = q % W, y = (q / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    rows.push({ f, px: px.length, ring: +ring.toFixed(1), box: [x0, y0, x1, y1] });
  }
}
rows.sort((a, b) => b.px - a.px);
console.log(`${rows.length} dark masses ringed by sky (>= ${MIN} px, ring lum >= ${RING})`);
for (const r of rows.slice(0, 40)) console.log(`  ${String(r.px).padStart(6)} px  ring ${String(r.ring).padStart(5)}  box ${JSON.stringify(r.box)}  ${r.f}`);
