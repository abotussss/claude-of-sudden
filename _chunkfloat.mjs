/**
 * WHAT THE PLAYER CAN SEE HANGING IN THE SKY — NOT WHAT A TANK CAN DRIVE ON.
 *
 * `_floatcheck.mjs` reconstructs the PHYSICS world and asks what is underneath.
 * That is the right question for 「物理判定あるので戦車が空中に登ってしまいます」 and
 * it is the wrong one for 「宙にうく物体はまだ大聖堂の上に残ってますよ」, because
 * `Airstrike`'s rubble chunks ARE NOT SOLID — the collision is a handful of mound
 * proxy boxes and the several thousand chunks round them are pure picture. A
 * chunk that settles ten metres up is invisible to a probe that only casts rays
 * at colliders, and every "floating object" the player has reported since the
 * mound proxies were fixed is one of these.
 *
 * So this walks the SETTLED POSE of every instance of every site — the same
 * `mesh.userData.settled` matrices `_bakeSettled` hands back to `instanceMatrix`
 * — turns each into a world position and a half-height, and drops one ray from
 * its underside. Anything with more than `--tol` metres of open air under it is
 * a chunk in the sky.
 *
 *   node _chunkfloat.mjs [--url=…] [--tol=1.2] [--seed=N] [--fire=cath|all]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const BASE = args.url ?? 'http://127.0.0.1:4305/';
const TOL = Number(args.tol ?? 1.2);
const FIRE = args.fire === true ? 'cath' : (args.fire ?? 'cath');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(BASE + (args.seed ? `?seed=${args.seed}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const levelSeed = await page.evaluate(() => window.__ENGINE__?.levelSeed ?? null);

await page.evaluate(() => (window.__ENGINE__.time.scale = 8));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 180000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await sleep(400);

/**
 * THE REAL EVENT, NOT ITS PIECES. `callCathedralCollapse()` is the three
 * aisle-roof bays; the BUILDING coming down is the `raze` beat. Driving
 * `_beginCathedralEvent` plays the whole sheet on its own clock.
 */
await page.evaluate((fire) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m.airstrike.enabled = true;
  m._beginCathedralEvent(e.ctx.time.elapsed, 0.99);
  if (fire === 'all') m.airstrike.callEverything(0.4);
  e.time.scale = 4;
}, FIRE);
await sleep(30000);
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await sleep(1500);

const out = await page.evaluate((TOL) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const m = e.ctx.peek('match');
  const MASK = ph.MASK.WORLD;
  const THREE = { M4: e.camera.matrixWorld.constructor, V3: e.camera.position.constructor };
  const mat = new THREE.M4();
  const pos = new THREE.V3();
  const sc = new THREE.V3();
  const q = e.camera.quaternion.clone();
  const rows = [];
  for (const s of m.airstrike.sites) {
    if (!s.struck) continue;
    let worst = 0;
    let n = 0;
    let air = 0;
    let hiY = 0;
    let at = null;
    for (const mesh of s.meshes) {
      const arr = mesh.userData.settled;
      if (!arr) continue;
      for (let i = 0; i < arr.length; i += 16) {
        mat.fromArray(arr, i);
        mat.decompose(pos, q, sc);
        /**
         * THE RAY STARTS ABOVE THE CHUNK, NOT UNDER IT. Fired from the chunk's
         * own underside it starts BELOW THE TERRAIN for anything lying on the
         * ground — the first version did exactly that and reported 297 chunks
         * "with 60 m of air under them" at y = 0.4, which is a probe measuring
         * its own start point. The chunks are not solid, so a ray from over one
         * passes straight through it to whatever it is resting on.
         */
        const half = Math.max(sc.x, sc.y, sc.z) * 0.5;
        const under = pos.y - half;
        if (under < 0.6) continue; // lying on the map; nothing to ask
        const h = ph.raycast(pos.x, pos.y + 0.15, pos.z, 0, -1, 0, 80, MASK);
        const gap = h.hit ? under - h.point.y : under;
        if (gap > TOL) {
          n++;
          air += gap;
          if (gap > worst) worst = gap;
          if (pos.y > hiY) { hiY = pos.y; at = [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)]; }
        }
      }
    }
    rows.push({ id: s.id, kind: s.kind, chunks: s.chunkCount, floating: n, worst: +worst.toFixed(2), meanAir: n ? +(air / n).toFixed(2) : 0, highest: at });
  }
  return { rows, razed: !!e.ctx.peek('world').cathedral?.razed };
}, TOL);

await browser.close();
console.log(`\nCHUNKFLOAT  tol=${TOL}m  levelSeed=${levelSeed}  razed=${out.razed}`);
console.log('  site        kind    chunks  in-the-sky   worst air   mean air   highest (x,y,z)');
let tot = 0;
for (const r of out.rows) {
  tot += r.floating;
  console.log(
    `  ${r.id.padEnd(10)} ${String(r.kind).padEnd(7)} ${String(r.chunks).padStart(6)}  ` +
      `${String(r.floating).padStart(10)}  ${String(r.worst).padStart(10)}  ${String(r.meanAir).padStart(9)}   ${r.highest ? r.highest.join(', ') : '-'}`
  );
}
console.log(`  TOTAL ${tot} chunks with more than ${TOL} m of open air under them\n`);
if (errs.length) console.log(`  ${errs.length} PAGE ERROR(S): ${errs.slice(0, 3).join(' | ')}`);
process.exit(tot > 0 ? 1 : 0);
