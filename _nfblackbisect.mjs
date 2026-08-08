/**
 * BISECT THE BLACK CEILING BY HIDING ONE BATCH AT A TIME.
 *
 *   node _nfblackbisect.mjs [--port=4613] [--at=24,-123] [--yaw=…]
 *
 * `_nfblackid.mjs` could not name it: every candidate is a MERGED BATCH whose
 * bounding box spans the whole map, so an AABB test says "the mountain is over
 * everything", which is true and useless. So this takes the frame, then hides
 * each top-level batch in turn and takes it again, and reports the share of the
 * upper third of the frame that is near-black in each. The batch whose removal
 * moves that number is the thing in the photograph.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4613'}/?map=plains`;
const [AX, AZ] = String(args.at ?? '24.3,-123.2').split(',').map(Number);
const YAW = Number(args.yaw ?? 288);   // degrees, the OSTKEHLE frame
const OUT = args.out ?? 'shots/nfblackbisect';
mkdirSync(OUT, { recursive: true });

const br = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await br.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.debugState?.('clean');
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/**
 * RE-PLACED BEFORE EVERY FRAME. The first run of this probe took fifty shots
 * over four minutes, the round rolled over to PREPARE half way through, the
 * respawn moved the player and the camera went with him — so the frame that
 * "proved" the mountain was the culprit was taken from inside the mountain.
 */
const place = () => page.evaluate(([x, z, yaw]) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const m = e.ctx.peek('match');
  if (m) { m.roundClock = 1e6; m._checkWinConditions = () => {}; }
  const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD);
  e.camera.position.set(x, (h.hit ? h.point.y : 0) + 1.62, z);
  e.camera.rotation.set(-4 * Math.PI / 180, yaw * Math.PI / 180, 0, 'YXZ');
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
}, [AX, AZ, YAW]);
await place();

let names = await page.evaluate(() => {
  const out = [];
  window.__ENGINE__.scene.traverse((o) => {
    if (o.isMesh && o.visible && o.geometry) {
      const t = o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes?.position?.count ?? 0) / 3;
      const id = o.name || `(unnamed@${o.parent?.name ?? '?'})`;
      if (t > 300 && id.startsWith('world_')) out.push(id);
    }
  });
  return [...new Set(out)];
});
if (args.only) { const keep = String(args.only).split(','); names.length = 0; names.push(...keep); }
console.log(`candidates: ${names.join(', ')}`);

const dark = async (tag) => {
  await place();
  await frames(24);
  const path = `${OUT}/${tag}.png`;
  await page.screenshot({ path });
  return path;
};
console.log('baseline ->', await dark('00-baseline'));

for (const n of names) {
  const ok = await page.evaluate((name) => {
    let k = 0;
    window.__ENGINE__.scene.traverse((o) => {
      if (!o.isMesh) return;
      const id = o.name || `(unnamed@${o.parent?.name ?? '?'})`;
      if (id === name) { o.visible = false; k++; }
    });
    return k;
  }, n);
  const p = await dark(`hide-${n.replace(/[^a-z0-9_]+/gi, '')}`);
  console.log(`  hid ${ok} × ${n} -> ${p}`);
  await page.evaluate((name) => {
    window.__ENGINE__.scene.traverse((o) => {
      if (!o.isMesh) return;
      const id = o.name || `(unnamed@${o.parent?.name ?? '?'})`;
      if (id === name) o.visible = true;
    });
  }, n);
}
await br.close();
