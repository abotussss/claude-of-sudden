/**
 * A MAN IN A CUT LOOKS ROUND THE SKY — and anything black that is not attached
 * to the ground gets photographed.
 *
 *   node _nfskyscan.mjs [--n=26] [--pitch=52] [--yaws=8]
 *
 * A straight-up ray census (`_nftrenchceil.mjs`) answers "what is DIRECTLY over
 * his head", and the thing he is complaining about is not directly over his
 * head — the fuel bund hanging 40 m over the plain at (17.5, 3.25) is 33 m away
 * and 40 up, so a vertical ray from the trench misses it and his eye does not.
 *
 * So this looks instead. From the floor of every cut, at a standing and a
 * crouched eye, through a full turn, it finds connected near-black blobs that
 * TOUCH NO EDGE OF THE FRAME — a silhouette that runs off the bottom is the
 * tower or the parapet and is explained by itself; one floating in the middle of
 * the sky is not attached to anything and is exactly the complaint.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4616/?map=plains&capture=1';
const OUT = args.out ?? 'shots/skyscan';
const PITCH = Number(args.pitch ?? 52) * Math.PI / 180;
const N = Number(args.n ?? 26);
const YAWS = Number(args.yaws ?? 8);
const DARK = Number(args.dark ?? 20);
const MINPX = Number(args.minpx ?? 120);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level.id =', lvl);
if (lvl !== 'plains') { console.error('WRONG MAP'); await b.close(); process.exit(2); }

await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;   // control STAYS ON: the rig writes the camera
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
  // The viewmodel lives in `ctx.viewScene`, a SECOND scene composited over the
  // world — not under `engine.scene`, which is why hiding scene children never
  // took the gun out of the frame. It is a dark mass in the middle of every
  // shot and it is not what anybody is complaining about.
  e.ctx.viewScene?.traverse?.((o) => { if (o.isMesh || o.isInstancedMesh || o.isSprite) o.visible = false; });
});
const frames = (n) => p.evaluate((k) => new Promise((d) => {
  let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

const cuts = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const groundY = e.ctx.peek('world').level.groundY; const ph = e.ctx.peek('physics');
  const out = [];
  for (let x = -172; x <= 172; x += 2) for (let z = -172; z <= 172; z += 2) {
    if (x * x + z * z > 172 * 172) continue;
    const gy = ph.groundHeight(x, z); if (!isFinite(gy)) continue;
    if (groundY(x, z) - gy < 0.8) continue;
    if (!ph.checkCapsule({ x, y: gy + 0.4, z }, { x, y: gy + 1.4, z }, 0.35)) continue;
    out.push([x, z]);
  }
  return out;
});
const spots = [];
if (cuts.length) {
  spots.push(cuts[0]);
  while (spots.length < N) {
    let best = null, bd = -1;
    for (const c of cuts) {
      let d = Infinity;
      for (const s of spots) d = Math.min(d, (c[0] - s[0]) ** 2 + (c[1] - s[1]) ** 2);
      if (d > bd) { bd = d; best = c; }
    }
    if (!best || bd < 4) break;
    spots.push(best);
  }
}
console.log(`${cuts.length} cut cells; ${spots.length} viewpoints, ${YAWS} bearings each, stand+crouch`);

const place = (x, z, yaw, stance) => p.evaluate(([x, z, pitch, yaw, stance]) => {
  const e = window.__ENGINE__; const ph = e.ctx.peek('physics'); const pl = e.ctx.peek('player');
  pl.teleport({ x, y: ph.groundHeight(x, z) + 1.66, z }, { x: pitch, y: yaw });
  pl.movement.stanceWant = stance;
}, [x, z, PITCH, yaw, stance]);

/** Connected near-black blobs that touch no edge of the frame. */
function floaters(buf) {
  const g = PNG.sync.read(buf);
  const W = g.width, H = g.height;
  const lum = new Float32Array(W * H);
  for (let i = 0, k = 0; i < W * H; i++, k += 4) {
    lum[i] = 0.2126 * g.data[k] + 0.7152 * g.data[k + 1] + 0.0722 * g.data[k + 2];
  }
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || lum[s] >= DARK) continue;
    let sp = 0; stack[sp++] = s; seen[s] = 1;
    let n = 0, edge = false, x0 = W, x1 = 0, y0 = H, y1 = 0, sx = 0, sy = 0;
    while (sp) {
      const q = stack[--sp];
      const x = q % W, y = (q / W) | 0;
      n++; sx += x; sy += y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !seen[q - 1] && lum[q - 1] < DARK) { seen[q - 1] = 1; stack[sp++] = q - 1; }
      if (x < W - 1 && !seen[q + 1] && lum[q + 1] < DARK) { seen[q + 1] = 1; stack[sp++] = q + 1; }
      if (y > 0 && !seen[q - W] && lum[q - W] < DARK) { seen[q - W] = 1; stack[sp++] = q - W; }
      if (y < H - 1 && !seen[q + W] && lum[q + W] < DARK) { seen[q + W] = 1; stack[sp++] = q + W; }
    }
    if (!edge && n >= MINPX) out.push({ px: n, cx: Math.round(sx / n), cy: Math.round(sy / n), box: [x0, y0, x1, y1] });
  }
  return out.sort((a, c) => c.px - a.px);
}

const hits = [];
let shots = 0;
for (const [x, z] of spots) {
  for (const stance of ['stand', 'crouch']) {
    for (let k = 0; k < YAWS; k++) {
      const yaw = (k / YAWS) * Math.PI * 2;
      await place(x, z, yaw, stance);
      await frames(stance === 'crouch' && k === 0 ? 26 : 10);
      const buf = await p.screenshot(); shots++;
      const f = floaters(buf);
      if (!f.length) continue;
      const tag = `x${x}_z${z}_${stance}_y${k}`;
      writeFileSync(`${OUT}/${tag}.png`, buf);
      hits.push({ x, z, stance, yawDeg: Math.round(yaw * 180 / Math.PI), blobs: f.slice(0, 3), file: `${OUT}/${tag}.png` });
      console.log(`  ! ${tag}  ${f.slice(0, 3).map((q) => `${q.px}px @${q.cx},${q.cy}`).join('  ')}`);
    }
  }
}
console.log(`\n${shots} frames, ${hits.length} with a detached dark mass in them`);
writeFileSync(`${OUT}/skyscan.json`, JSON.stringify({ pitchDeg: PITCH * 180 / Math.PI, DARK, MINPX, spots, hits }, null, 1));
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
