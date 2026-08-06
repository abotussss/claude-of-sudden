/**
 * DID THE ROOF TAKE ITS CLUTTER WITH IT?
 *
 *   node _roofclutter.mjs [--url=…]
 *
 * `world.roofs` claims the deck, the parapet, the stair hut and everything the
 * dressing pass bolts to a roof into ONE scope, so that a deck that comes in
 * cannot leave a water tank in the sky — the failure mode `_floatcheck` was
 * written for and the one the player has raised most often. The drawn half of
 * `_floatcheck` reports wall-mounted dressing without judging it, so it cannot
 * answer this on its own. This does: it counts the VISIBLE instances of every
 * roof-borne prototype standing over each breakable roof, intact and then with
 * `?roof=down`, and the count over a broken roof has to be zero.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4572/';

const ROOFY = ['water_tank', 'sat_dish', 'ac_unit', 'roof_vent', 'stool', 'crate_a', 'crate_b',
  'barrel_rust', 'tyre', 'sign_hang', 'shrub', 'planter', 'mattress', 'pallet'];

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });

async function sweep(down) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('pageerror', (e) => console.log('  pageerror', String(e.message).slice(0, 160)));
  await page.goto(down ? `${BASE}?roof=down` : BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
  const out = await page.evaluate((ROOFY) => {
    const w = window.__ENGINE__.ctx.peek('world');
    const rows = [];
    const V = w.root.position.constructor;
    const p = new V();
    for (const rec of w.roofs ?? []) {
      /**
       * OVER THE HOLE, NOT OVER THE ROOF. The rim survives on purpose — that is
       * the whole design — so a tank standing on the edge of the deck is still
       * standing on something. What may not survive is anything over the piece
       * that fell, and the hole is authored in LEVEL space, so the instance is
       * taken back onto the level's own axes rather than the rect into world.
       */
      const h = rec.hole;
      let above = 0;
      w.root.traverse((o) => {
        if (!o.isInstancedMesh || !o.visible) return;
        if (!ROOFY.some((k) => String(o.name).includes(k))) return;
        const M = new o.matrixWorld.constructor();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, M);
          const e = M.elements;
          // A hidden instance is collapsed to a degenerate scale by setScopeVisible.
          const sx = Math.hypot(e[0], e[1], e[2]);
          if (sx < 1e-4) continue;
          p.set(e[12], e[13], e[14]).applyMatrix4(o.matrixWorld);
          if (p.y < rec.position.y - 0.6) continue;
          const L = w.worldToLevel(p.x, p.y, p.z, new V());
          if (L.x < h.x0 || L.x > h.x1 || L.z < h.z0 || L.z > h.z1) continue;
          above++;
        }
      });
      rows.push({ id: rec.id, down: !!rec.down, above });
    }
    return rows;
  }, ROOFY);
  await page.close();
  return out;
}

const up = await sweep(false);
const dn = await sweep(true);
await browser.close();

console.log(`\n  roof-borne instances standing over each breakable deck\n`);
console.log(`  ${'roof'.padEnd(12)} ${'intact'.padStart(8)} ${'?roof=down'.padStart(11)}`);
let bad = 0;
for (let i = 0; i < up.length; i++) {
  const a = up[i], b = dn[i];
  if (b.above > 0) bad++;
  console.log(`  ${a.id.padEnd(12)} ${String(a.above).padStart(8)} ${String(b.above).padStart(11)}` +
    (b.above > 0 ? '   <-- LEFT IN THE SKY' : ''));
}
console.log(bad ? `\n  FAIL — ${bad} deck(s) left roof clutter hanging\n`
  : `\n  OK — every deck took its clutter with it\n`);
process.exit(bad ? 1 : 0);
