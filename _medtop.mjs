/**
 * THE MEDICAL ZONE FROM ABOVE. `_medshot.mjs` proved the dressing is built and
 * where it says it is (bounding box x ∓59..62, y 0.03..2.55) and proved the med
 * kit heals — but every eye-level bearing it tried put a building corner between
 * the camera and the post, so what was photographed was a wall.
 *
 * A camera straight over the post cannot be occluded by anything except the
 * post, which is the whole point of shooting it this way: it is the picture of
 * the GROUND PAINT, which is the cue that says "medical zone" rather than
 * "another crate". Both posts, in turn.
 *
 *   node _medtop.mjs [url] [seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4294/';
const SEED = process.argv[3] ?? '11';
const OUT = 'shots/verify';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const frames = (n) =>
  page.evaluate(
    (k) =>
      new Promise((d) => {
        let i = 0;
        const t = () => (++i >= k ? d() : requestAnimationFrame(t));
        requestAnimationFrame(t);
      }),
    n
  );
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
});

for (const [i, h, back] of [[0, 13, 0.5], [1, 13, 0.5]]) {
  const info = await page.evaluate(
    ([idx, height, lean]) => {
      const e = window.__ENGINE__;
      const m = e.ctx.peek('match');
      const V3 = e.camera.position.constructor;
      const c = m.caches.list.filter((x) => x.kind === 'medic')[idx];
      if (!c) return null;
      const p = c.position;
      // Almost straight down, leaned back a little so the standard is not a dot.
      e.camera.position.set(p.x, p.y + height, p.z + height * lean);
      e.camera.lookAt(new V3(p.x, p.y, p.z));
      e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
      return { id: c.id, at: [+p.x.toFixed(1), +p.y.toFixed(2), +p.z.toFixed(1)] };
    },
    [i, h, back]
  );
  await frames(34);
  await page.screenshot({ path: `${OUT}/medtop-${i}.png` });
  console.log(`post ${i}:`, JSON.stringify(info));
}
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
