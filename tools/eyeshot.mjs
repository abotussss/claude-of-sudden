/**
 * EYE-LEVEL SITE PHOTOGRAPHY — look at the map from where it is fought.
 *
 *   node tools/eyeshot.mjs --out=/tmp/site --url=http://127.0.0.1:4205/
 *   node tools/eyeshot.mjs --out=/tmp/site --only=A-attack-north
 *
 * `src/dev/shots.js` holds the canonical hero/lighting frames and its poses are
 * fixed there. This is the gameplay equivalent and its poses are LEVEL-SPACE
 * and AUTHORED HERE, because they have to move when the sites move: stand at
 * each courtyard's attacker mouth looking in, stand on the defence's hold
 * looking out, and stand on the overwatch looking down at the plant spot. The
 * camera is dropped onto whatever the physics says the floor is at that point,
 * so a pose cannot silently end up buried in a terrace or floating over a deck.
 *
 * Why it exists: every gate in this repo is a number, and no number in it could
 * tell you a bomb site was bare. Somebody has to look.
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
const URL = args.url ?? 'http://127.0.0.1:4173/';
const OUT = resolve(String(args.out ?? 'shots/site'));
const W = Number(args.w ?? 1280);
const H = Number(args.h ?? 720);
const ONLY = args.only ? String(args.only).split(',') : null;

/**
 * Poses, in LEVEL space (the coordinates src/world/layout.js authors in, AFTER
 * its 1.5x — i.e. what `world.worldToLevel` returns).
 *
 *   from:  [x, z]  where the eye stands; the floor under it is measured
 *   look:  [x, z]  what it is pointed at, at `lookY` above that floor
 *   dy:    lift the eye off the floor by this (1.62 = standing eye)
 */
const POSES = [
  // ---- SITE A, plant zone at level (-42, -10.5) ---------------------------
  { id: 'A-attack-north', from: [-40, 3], look: [-42, -10.5], doc: "the attacker's own lane mouth, walking in from the north" },
  { id: 'A-attack-conn', from: [-31, -6], look: [-42, -10.5], doc: 'the connector mouth from mid — the flank' },
  { id: 'A-plant', from: [-42, -10.5], look: [-42, 4], doc: 'standing ON the plant spot, looking back up the attack lane' },
  { id: 'A-defend-hold', from: [-36, -18], look: [-42, -8], doc: "the defence's ground hold, looking at the plant zone" },
  { id: 'A-overwatch', from: [-52, -9], look: [-42, -10.5], dy: 2.9 + 1.62, doc: 'the A-deck, looking down at the plant spot' },
  // ---- SITE B, plant zone at level (42, -10.5) ---------------------------
  { id: 'B-attack-north', from: [40, 3], look: [42, -10.5], doc: "the attacker's own lane mouth, walking in from the north" },
  { id: 'B-attack-conn', from: [31, -6], look: [42, -10.5], doc: 'the connector mouth from mid — the flank' },
  { id: 'B-plant', from: [42, -10.5], look: [42, 4], doc: 'standing ON the plant spot, looking back up the attack lane' },
  { id: 'B-defend-hold', from: [36, -18], look: [42, -8], doc: "the defence's ground hold, looking at the plant zone" },
  { id: 'B-overwatch', from: [52, -5], look: [42, -10.5], dy: 2.9 + 1.62, doc: 'the B-deck, looking down at the plant spot' },
  { id: 'B-south-overwatch', from: [32.3, -19.6], look: [42, -10.5], dy: 3.0 + 1.62, doc: "the defence's own south catwalk" },
  { id: 'A-south-overwatch', from: [-32.3, -19.6], look: [-42, -10.5], dy: 3.0 + 1.62, doc: "the defence's own south catwalk" },
  /**
   * Close range, for judging the masonry rather than the layout. The SITEWORKS
   * table authors in unscaled level space and these are in scaled — the
   * coordinates `world.worldToLevel` hands back — so each is 1.5x its entry:
   * the A south plinth is authored at (-26.8, -9.8) and stands at (-40.2, -14.7).
   */
  { id: 'A-close-plinth', from: [-40.2, -19.4], look: [-40.2, -14.7], lookY: 0.7, doc: 'the south plinth at 4.7 m' },
  { id: 'A-close-spine', from: [-42.1, -9.6], look: [-42.1, -6.0], lookY: 0.9, doc: 'the spine wall at 3.6 m' },
  { id: 'A-close-gate', from: [-38.4, 9.6], look: [-43.8, 4.8], lookY: 1.8, doc: 'the north gatehouse at 7 m' },
];

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=metal',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--force-color-profile=srgb',
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--mute-audio',
  ],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

console.log(`[eyeshot] booting ${URL} …`);
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

// Hand the camera over once: freeze input and take the player off the controls,
// exactly as __APPLY_SHOT__ does, so nothing walks the camera between frames.
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
      const h = phys.raycast(w.x, 30, w.z, 0, -1, 0, 60, phys.MASK.WORLD);
      w.y = h.hit ? h.point.y : 0;
      return w;
    };
    const from = floor(pose.from[0], pose.from[1]);
    const to = floor(pose.look[0], pose.look[1]);
    const cam = e.camera;
    cam.position.set(from.x, from.y + (pose.dy ?? 1.62), from.z);
    cam.lookAt(new V3(to.x, to.y + (pose.lookY ?? 1.2), to.z));
    e.ctx.peek('player')?.teleport?.(cam.position, cam.rotation);
    return { floorY: +from.y.toFixed(2), targetY: +to.y.toFixed(2) };
  }, p);

  await page.evaluate(
    (n) => new Promise((done) => { let i = 0; const t = () => (++i >= n ? done() : requestAnimationFrame(t)); requestAnimationFrame(t); }),
    Number(args.settle ?? 60)
  );
  await page.screenshot({ path: `${OUT}/${p.id}.png`, type: 'png' });
  console.log(`  ${p.id.padEnd(18)} floor y ${String(info.floorY).padStart(6)}  -> ${OUT}/${p.id}.png   ${p.doc}`);
}

if (pageErrors.length) console.log('[eyeshot] page errors', pageErrors.slice(0, 6));
await browser.close();
process.exit(pageErrors.length ? 1 : 0);
