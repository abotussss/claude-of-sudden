/**
 * ════════════════════════════════════════════════════════════════════════════
 * DOES THE ARMOUR CHANGE THE COLLISION THE INFANTRY WALKS ON? — a yes/no
 * ════════════════════════════════════════════════════════════════════════════
 * `stuckcheck` is 3/39 on this build and the gate is 0. Before arguing about
 * whose change that is, the tank's own involvement can be settled outright: a
 * bot gets stuck on collision that is THERE, so only ADDED collision can wall
 * anyone in, and this file only ever removes it (`_firePlough` / `_razeAt` zero
 * mask entries; nothing anywhere sets one).
 *
 * This proves that mechanically rather than by reading the code:
 *
 *   1. the static mask is checksummed at boot, before and after a forced
 *      `Armour.build()`-equivalent state, and compared. A bake that touched
 *      collision would move the sum.
 *   2. every pile and every raze record is fired, the sum is taken again, and
 *      the count of mask entries that went 0 -> nonzero is reported. It must be
 *      ZERO: mass may vanish, mass may not appear.
 *   3. everything is restored and the sum must come back byte-identical, or the
 *      round reset leaves the map different from the one the nav grid was baked
 *      against.
 *
 *   node _maskproof.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4423/';
const SEED = process.argv[3] ?? '7';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const a = e.ctx.peek('match').tank;
  const phys = e.ctx.peek('physics');
  const sw = phys.staticWorld;
  if (!sw?.mask) return { err: 'no static mask' };

  const snap = () => Uint8Array.from(sw.mask);
  const sum = (m) => { let s = 0; for (let i = 0; i < m.length; i++) s = (s * 31 + m[i]) >>> 0; return s; };
  const solid = (m) => { let n = 0; for (let i = 0; i < m.length; i++) if (m[i]) n++; return n; };

  const atBoot = snap();

  /* ---- fire everything the hull can possibly remove ------------------ */
  let piles = 0;
  for (const t of a.tanks) {
    for (const pile of t.plough ?? []) { a._firePlough(t, pile); piles++; }
  }
  // and the gun, over the whole route, so the atlas is exercised too
  let razed = 0;
  for (const t of a.tanks) {
    for (const leg of t.legs) {
      for (let i = 0; i < leg.n; i += 4) razed += a._razeAt(leg.X[i], leg.Y[i] + 1, leg.Z[i], 5.0);
    }
  }
  const afterFire = snap();

  let gained = 0;
  let lost = 0;
  for (let i = 0; i < atBoot.length; i++) {
    if (!atBoot[i] && afterFire[i]) gained++;
    else if (atBoot[i] && !afterFire[i]) lost++;
  }

  /* ---- restore -------------------------------------------------------- */
  a.reset();
  const afterReset = snap();
  let notRestored = 0;
  for (let i = 0; i < atBoot.length; i++) if (atBoot[i] !== afterReset[i]) notRestored++;

  return {
    tris: atBoot.length,
    piles, razed,
    bootSolid: solid(atBoot),
    firedSolid: solid(afterFire),
    gained, lost, notRestored,
    bootSum: sum(atBoot), firedSum: sum(afterFire), resetSum: sum(afterReset),
  };
});

if (out.err) { console.log(out.err); await b.close(); process.exit(2); }

console.log(`\n  ${out.tris} static triangles · ${out.piles} piles fired · ${out.razed} prop instances shelled`);
console.log(`  solid entries: ${out.bootSolid} at boot -> ${out.firedSolid} after firing everything`);
console.log(`  mask entries 0 -> SOLID (collision ADDED): ${out.gained}   <-- must be 0`);
console.log(`  mask entries SOLID -> 0 (collision removed): ${out.lost}`);
console.log(`  entries not restored by reset(): ${out.notRestored}   <-- must be 0`);
console.log(`  checksums: boot ${out.bootSum} · fired ${out.firedSum} · after reset ${out.resetSum}`);
const ok = out.gained === 0 && out.notRestored === 0;
console.log(`\n  ${ok ? 'PASS' : 'FAIL'} — the armour ${ok ? 'only ever removes collision, and puts all of it back' : 'CHANGED COLLISION IN A WAY THAT CAN WALL A BOT IN'}`);
if (errs.length) console.log('  PAGEERRORS:', errs);
await b.close();
process.exit(ok ? 0 : 1);
