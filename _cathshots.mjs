/**
 * THE RUIN, PHOTOGRAPHED FROM WHERE IT IS FOUGHT.
 *
 *   node _cathshots.mjs --out=shots/cathruin --url=http://127.0.0.1:4270/
 *   node _cathshots.mjs --intact           …the same poses with the church up
 *
 * Every gate in this repo is a number and no number in it can say "跡地がしょぼい".
 * Somebody has to look, so these are `tools/eyeshot.mjs`'s machinery pointed at
 * the cathedral in its SECOND state: standing in the nave, standing on site D,
 * off the parvis, and from far enough down the mid street to see the skyline.
 * The URL carries `?cath=down` unless `--intact`, so the ruin is what boots.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const BASE = args.url ?? 'http://127.0.0.1:4270/';
const URL = `${BASE}?capture=1${args.intact ? '' : '&cath=down'}`;
const OUT = resolve(String(args.out ?? 'shots/cathruin'));
const W = Number(args.w ?? 1280);
const H = Number(args.h ?? 720);
const ONLY = args.only ? String(args.only).split(',') : null;

/** Level space. The cathedral is centred on (0, -1) and is 30 x 45 m. */
const POSES = [
  { id: '1-nave', from: [0, -15], look: [0, 14], lookY: 2.4, doc: 'in the nave, looking up the church at the crossing and the apse' },
  { id: '2-crossing', from: [0, -1], look: [0, -23], lookY: 4.0, doc: 'standing ON site D, looking back down the nave at the front and the tower' },
  { id: '3-parvis', from: [0, -34], look: [0, -19], lookAbs: 5.5, doc: 'off the parvis, the south front and the great portal arch' },
  { id: '4-skyline', from: [0, -58], atY: 2.2, look: [0, -6], lookAbs: 9.0, doc: 'from the defence approach, far enough back for the silhouette' },
  { id: '5-transept', from: [-25, -1], look: [4, -1], lookY: 2.4, doc: 'in through the west transept portal, across the crossing' },
  { id: '6-aisle', from: [-11, -9], look: [-11, 14], lookY: 2.0, doc: 'down the west aisle lane, past the arcade stumps' },
  { id: '7-tower', from: [-4, -19], look: [-13, -21], lookAbs: 7.0, doc: 'the campanile stump from the nave floor' },
  { id: '8-choir', from: [0, 16], look: [0, -18], lookY: 3.0, doc: 'from the apse door, the whole length of it' },
  { id: '9-drone', from: [0, -52], atY: 40, look: [0, -3], lookAbs: 3.0, doc: 'the whole plan from above, so the mass reads as a plan' },
  { id: 'a-tower-sw', from: [-24, -34], atY: 6, look: [-11.3, -19.4], lookAbs: 7.0, doc: 'the campanile stump square on, from outside the south-west corner' },
  { id: 'b-tower-ne', from: [4, -6], atY: 3, look: [-11.3, -19.4], lookAbs: 7.0, doc: 'the campanile from inside the church' },
  { id: 'c-flank-e', from: [34, -1], atY: 5, look: [0, -1], lookAbs: 4.0, doc: 'the whole east flank against the sky' },
  { id: 'd-flank-n', from: [0, 40], atY: 5, look: [0, -6], lookAbs: 4.0, doc: 'the apse end and the length of it against the sky' },
];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--force-color-profile=srgb', '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
console.log(`[cathshots] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 480000 });
console.log('[cathshots] razed:', await page.evaluate(() => window.__ENGINE__.ctx.peek('world').cathedral.razed));

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
});

mkdirSync(OUT, { recursive: true });
for (const p of POSES) {
  if (ONLY && !ONLY.includes(p.id)) continue;
  const info = await page.evaluate((pose) => {
    const e = window.__ENGINE__;
    const world = e.ctx.peek('world');
    const phys = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    const floor = (lx, lz) => {
      const w = world.levelToWorld(lx, 0, lz, new V3());
      const h = phys.raycast(w.x, 40, w.z, 0, -1, 0, 70, phys.MASK.WORLD);
      w.y = h.hit ? h.point.y : 0;
      return w;
    };
    const from = floor(pose.from[0], pose.from[1]);
    const to = floor(pose.look[0], pose.look[1]);
    if (pose.lookAbs !== undefined) to.y = pose.lookAbs - (pose.lookY ?? 1.2);
    const cam = e.camera;
    cam.position.set(from.x, pose.atY !== undefined ? pose.atY : from.y + (pose.dy ?? 1.62), from.z);
    cam.lookAt(new V3(to.x, to.y + (pose.lookY ?? 1.2), to.z));
    e.ctx.peek('player')?.teleport?.(cam.position, cam.rotation);
    return { floorY: +from.y.toFixed(2), targetY: +to.y.toFixed(2) };
  }, p);
  await page.evaluate((n) => new Promise((d) => { let i = 0; const t = () => (++i >= n ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), 60);
  await page.screenshot({ path: `${OUT}/${p.id}.png`, type: 'png' });
  console.log(`  ${p.id.padEnd(12)} floor y ${String(info.floorY).padStart(6)}  ${p.doc}`);
}
if (errs.length) console.log('[cathshots] page errors', errs.slice(0, 6));
await browser.close();
process.exit(errs.length ? 1 : 0);
