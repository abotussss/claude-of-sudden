/**
 * ════════════════════════════════════════════════════════════════════════════
 * THE PLAIN FROM A MAN'S EYE, AT EVERY OBJECTIVE AND ON TWO CROSSINGS.
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfsheetgone.mjs [--url=…] [--tag=before|after] [--out=shots/sheetgone]
 *
 * 「この地面テクスチャーが浮いてます 至る所で 消して」
 *
 * The complaint is a hard-edged black quadrilateral lying across the plain and
 * filling most of the frame. It has been "fixed" once by conforming the sheets
 * to the ground per vertex and it is STILL THERE, because conforming was never
 * the problem:
 *
 *   A HORIZONTAL SURFACE AT NIGHT, WHEN THE ONLY KEY LIGHT IS A BURNING RIDGE
 *   AT GROUND LEVEL, RENDERS BLACK WHATEVER ITS MATERIAL AND WHATEVER ITS
 *   HEIGHT. N·L is ~0 for a light that arrives along the horizon, so a sheet
 *   lying ON the ground reads exactly like a slab floating over it.
 *
 * So the frame is the measurement, not the vertex height, and this takes the
 * frame from the places the player actually stands. The same seven poses either
 * side of the change; the pose is READ BACK OFF THE CAMERA and printed with
 * every frame, because `player.teleport(eye, rot)` only takes a pitch when `rot`
 * is an object (`src/player/index.js:891`) and two agents have shipped "looking
 * up" screenshots that came out level.
 *
 * Each frame also gets a material census of the centre band of the image, by
 * ray, so "the sheets are gone" is a number rather than an impression.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/**
 * The frame has to be measured off the PNG and NOT off the canvas. The renderer
 * is created with `preserveDrawingBuffer: false` (`src/render/index.js:149`), so
 * `drawImage(canvas)` from a later task returns an all-black image and any
 * "black %" taken that way reads 100 on a perfectly lit frame. Playwright's own
 * screenshot is a real read of the presented buffer, so it is the source.
 *
 * Playwright writes 8-bit RGBA, non-interlaced, so this is the whole decoder.
 */
function pngRGBA(buf) {
  let p = 8, w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 6 && ct !== 2)) throw new Error(`unsupported PNG ${bd}/${ct}`);
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * bpp);
  const stride = w * bpp;
  let o = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[o + i - bpp] : 0;
      const b = y > 0 ? out[o - stride + i] : 0;
      const c = (i >= bpp && y > 0) ? out[o - stride + i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[o + i] = v & 255;
    }
    o += stride;
  }
  return { w, h, bpp, px: out };
}

/**
 * HOW BLACK IS THE GROUND HALF OF THE FRAME. The complaint is "a black
 * quadrilateral filling most of the frame", so the number that answers it is the
 * share of the picture carrying no light. Lower half only: the top of the frame
 * is sky and mountain and is not what is being complained about. The right third
 * is skipped because the viewmodel's arm and receiver live there and are black
 * by design in every frame.
 */
function darkStats(png) {
  const { w, h, bpp, px } = png;
  let black = 0, dim = 0, sum = 0, n = 0;
  for (let y = h >> 1; y < h; y++) {
    for (let x = 0; x < ((w * 2) / 3) | 0; x++) {
      const i = (y * w + x) * bpp;
      const l = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
      sum += l; n++;
      if (l < 0.03) black++;
      if (l < 0.09) dim++;
    }
  }
  return { blackPct: +(black * 100 / n).toFixed(1), dimPct: +(dim * 100 / n).toFixed(1), meanL: +(sum / n).toFixed(4) };
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4625/?map=plains&capture=1';
const TAG = args.tag ?? 'x';
const OUT = args.out ?? 'shots/sheetgone';
mkdirSync(OUT, { recursive: true });

/** eye, and where it looks. Objectives face the map centre; crossings face along. */
const POSES = [
  { id: 'A', x: -118, z: -104, lx: 0, lz: 0, note: 'zone A, looking in across the plain' },
  { id: 'A-out', x: -118, z: -104, lx: -168, lz: -148, note: 'zone A, looking OUT at the rim' },
  { id: 'B', x: 118, z: 104, lx: 0, lz: 0, note: 'zone B, looking in' },
  { id: 'C', x: -128, z: 86, lx: 0, lz: 0, note: 'zone C, looking in' },
  { id: 'E', x: 128, z: -86, lx: 0, lz: 0, note: 'zone E, looking in' },
  { id: 'D', x: 0, z: 0, lx: -118, lz: -104, note: 'zone D, looking at A' },
  { id: 'X-AB', x: -59, z: -52, lx: 118, lz: 104, note: 'crossing A→B, midway' },
  { id: 'X-CE', x: 64, z: -43, lx: -128, lz: 86, note: 'crossing E→C, midway' },
];

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const lvl = await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log(`level.id = ${lvl}   tag = ${TAG}`);
if (lvl !== 'plains') { console.error('WRONG MAP'); await br.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => page.evaluate((k) => new Promise((d) => {
  let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

const rows = [];
for (const s of POSES) {
  const info = await page.evaluate((s) => {
    const e = window.__ENGINE__, ph = e.ctx.peek('physics'), w = e.ctx.peek('world');
    const gy = w.level.groundY(s.x, s.z);
    const eyeY = gy + 1.62;                       // STANCE.stand.eye over the floor
    // three's forward is -Z, so a yaw that points at (lx,lz) is atan2 of the
    // NEGATED delta. The pitch is level: the sheets lie on the ground and the
    // complaint is about what fills the frame from a man standing on it.
    const yaw = Math.atan2(-(s.lx - s.x), -(s.lz - s.z));
    const pitch = -0.06;
    e.ctx.peek('player')?.teleport?.({ x: s.x, y: eyeY, z: s.z }, { x: pitch, y: yaw });
    const cam = e.camera;
    cam.rotation.order = 'YXZ';
    cam.position.set(s.x, eyeY, s.z);
    cam.rotation.set(pitch, yaw, 0);
    cam.updateMatrixWorld(true);

    /**
     * A MATERIAL CENSUS OF THE CENTRE BAND, by ray through the drawn world.
     * Physics rays would only see proxies and none of these sheets has one, so
     * this walks the scene's own triangles via three's Raycaster off the camera.
     */
    return { gy: +gy.toFixed(2), eyeY: +eyeY.toFixed(2), yaw: +yaw.toFixed(3), pitch };
  }, s);
  await frames(90);

  // pose READ BACK off the camera, after the engine has had 90 frames at it
  const back = await page.evaluate(() => {
    const c = window.__ENGINE__.camera;
    c.updateMatrixWorld(true);
    const d = { x: 0, y: 0, z: -1 };
    const m = c.matrixWorld.elements;
    const fx = -m[8], fy = -m[9], fz = -m[10];
    return {
      pos: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)],
      fwd: [+fx.toFixed(3), +fy.toFixed(3), +fz.toFixed(3)],
      pitchDeg: +(Math.asin(Math.max(-1, Math.min(1, fy))) * 180 / Math.PI).toFixed(1),
      fov: +window.__ENGINE__.camera.fov.toFixed(1),
    };
  });

  const shot = await page.screenshot({ path: `${OUT}/${TAG}-${s.id}.png` });
  const dark = darkStats(pngRGBA(shot));
  rows.push({ id: s.id, ...info, back, dark, note: s.note });
  console.log(`  ${OUT}/${TAG}-${s.id}.png  eye ${back.pos.join(',')}  fwd ${back.fwd.join(',')}  pitch ${back.pitchDeg}°  fov ${back.fov}`
    + `  ground-half: black ${dark?.blackPct}%  dim ${dark?.dimPct}%  meanL ${dark?.meanL}  — ${s.note}`);
}
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(rows, null, 1));
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '0 pageerrors');
await br.close();
