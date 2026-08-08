/**
 * THE SOIL SHEETS, FROM A MAN'S EYE, AT TWO RANGES — THE SAME TWO EVERY TIME.
 *
 *   node _nfsheetshot.mjs [--url=…] [--out=shots/sheet] [--tag=before|after]
 *                         [--at=51.3,144.6] [--at2=…]
 *
 * `_nffloatsheet.mjs` ranks the sheets and photographs the worst of whatever it
 * found, which is the right tool for finding one and the wrong one for a
 * before/after: the ranking MOVES when the defect is fixed, so the two runs
 * photograph different pieces of ground and prove nothing. This takes the target
 * as an argument and stands in exactly the same two places either side of the
 * change — 9 m, which is close enough that a rim off the ground is a step you
 * could trip on, and 22 m, which is where a 34 m sheet fills the frame.
 *
 * The plain is genuinely dark (50 % night, 12 % warm edge, 20 % fire pool), so
 * each shot also reports the distance to the nearest fire in `level.fires` and
 * that fire's irradiance relative to the moon. A black photograph 90 m from
 * every fire is the map working; a black photograph 12 m from one is not, and
 * without the number printed under it there is no way to tell them apart.
 *
 * The eye is `STANCE.stand` height, 1.62 m over the physics floor, and the
 * camera looks at the ground under the target rather than at the target's own
 * worst vertex: the whole question is whether that vertex is ON the ground.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4615/?map=plains&capture=1';
const OUT = args.out ?? 'shots/sheet';
const TAG = args.tag ?? 'x';
const TARGETS = [args.at ?? '51.3,144.6', args.at2 ?? '-86.1,80.6']
  .map((s) => String(s).split(',').map(Number));
mkdirSync(OUT, { recursive: true });

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('  level =', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
});
const frames = (n) => page.evaluate((k) => new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

for (const [tx, tz] of TARGETS) {
  for (const range of [9, 22]) {
    const info = await page.evaluate(([tx, tz, range]) => {
      const e = window.__ENGINE__, ph = e.ctx.peek('physics'), w = e.ctx.peek('world');
      /**
       * STAND OUTBOARD OF THE TARGET, on the ray from the map centre, so the
       * camera is always looking IN across the plain and the mountain is behind
       * the subject rather than filling the frame.
       */
      const a = Math.atan2(tz, tx);
      const cx = tx + Math.cos(a) * range, cz = tz + Math.sin(a) * range;
      const floor = (x, z) => { const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD); return h.hit ? h.point.y : 0; };
      const cy = floor(cx, cz) + 1.62;
      const V = e.camera.position.constructor;
      /**
       * TAKE THE CAMERA OFF THE PLAYER FIRST. `camera.position` set on its own
       * lasts until the next frame, when the player system writes its own
       * transform back over it — the first run of this probe photographed the
       * rim from wherever the player was standing and labelled it a soil sheet.
       * Same pattern as `src/dev/shots.js`: disable control, aim, teleport the
       * capsule under the camera, aim again.
       */
      const pl = e.ctx.peek('player');
      pl?.setControlEnabled?.(false);
      e.camera.position.set(cx, cy, cz);
      e.camera.lookAt(new V(tx, floor(tx, tz) + 0.35, tz));
      pl?.teleport?.(e.camera.position, e.camera.rotation);
      e.camera.position.set(cx, cy, cz);
      e.camera.lookAt(new V(tx, floor(tx, tz) + 0.35, tz));
      // nearest fire, and how bright it is here against the moon
      let best = null;
      for (const f of (w.level.fires ?? [])) {
        const p = f.light?.position ?? f.position;
        if (!p) continue;
        const d = Math.hypot(p.x - cx, p.z - cz);
        if (!best || d < best.d) best = { id: f.id, d, i: f.baseIntensity ?? f.light?.intensity ?? 0 };
      }
      return { cam: [+cx.toFixed(1), +cy.toFixed(2), +cz.toFixed(1)], fire: best ? { id: best.id, d: +best.d.toFixed(1), i: best.i } : null };
    }, [tx, tz, range]);
    await frames(24);
    // …and once more after the frames, so the last word on the transform is ours
    await page.evaluate(([tx, tz, range]) => {
      const e = window.__ENGINE__, ph = e.ctx.peek('physics');
      const a = Math.atan2(tz, tx);
      const cx = tx + Math.cos(a) * range, cz = tz + Math.sin(a) * range;
      const floor = (x, z) => { const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD); return h.hit ? h.point.y : 0; };
      const V = e.camera.position.constructor;
      e.camera.position.set(cx, floor(cx, cz) + 1.62, cz);
      e.camera.lookAt(new V(tx, floor(tx, tz) + 0.35, tz));
    }, [tx, tz, range]);
    await frames(2);
    const name = `${TAG}-${tx}_${tz}-${range}m.png`;
    await page.screenshot({ path: `${OUT}/${name}` });
    console.log(`  ${name}  eye ${info.cam.join(',')}  nearest fire ${info.fire ? `${info.fire.id} at ${info.fire.d} m (${info.fire.i} cd)` : 'none'}`);
  }
}
console.log(errs.length ? `PAGEERRORS: ${errs[0]}` : '0 pageerrors');
await br.close();
