/**
 * PER-BLOCK COVER STALENESS — `_coverstale.mjs`'s measure, taken per demolition
 * block and over MIXED states rather than only all-up / all-down.
 *
 *   node _coverblocks.mjs [--url=…]
 *
 * `world.demolitions` are six blocks that fire INDEPENDENTLY, so "all six down"
 * is one of sixty-four states and is not the interesting one. This fires every
 * LIVE cover point's own chest ray (the exact ray `CoverMap.build` used) against
 * the town in each state below, and buckets the answer by which block the point
 * stands on.
 *
 *   dead      no mass on the stored facing and none on any of the other seven.
 *   misfaced  the stored facing is empty but another direction is solid.
 *
 * The states are all-intact, each block alone, three mixed pairs/triples, the
 * two district salvos, and all six.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4257/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
console.log(`[coverblocks] booting ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const meta = await page.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('world');
  return (w?.demolitions ?? []).map((d) => ({
    id: d.id,
    zone: d.zone ?? '?',
    x: d.position.x,
    z: d.position.z,
    r: d.radius,
  }));
});
console.log(`[coverblocks] blocks: ${meta.map((d) => `${d.id}(${d.zone})`).join(' ')}`);

/** Put the six blocks into exactly `ids`, then let `ai` notice. */
const setState = (ids) =>
  page.evaluate((want) => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('world');
    const ai = e.ctx.peek('ai');
    for (const d of w.demolitions ?? []) w.demolish(d.id, want.includes(d.id));
    const t0 = performance.now();
    const changed = ai.syncCoverBlocks ? ai.syncCoverBlocks() : false;
    const ms = performance.now() - t0;
    return { changed, ms, live: ai.cover?.points.length ?? 0 };
  }, ids);

const probe = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const ai = e.ctx.peek('ai');
    const phys = e.ctx.peek('physics');
    const MASK = phys.MASK.WORLD;
    const REACH = 1.3;
    const DX = [1, -1, 0, 0, 1, 1, -1, -1];
    const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
    const S2 = Math.SQRT2;
    const g = ai.grid;
    const rows = [];
    for (const p of ai.cover?.points ?? []) {
      const h = phys.raycast(p.x, p.y + 0.55, p.z, p.dx, 0, p.dz, REACH, MASK);
      let any = h.hit;
      if (!any) {
        for (let d = 0; d < 8 && !any; d++) {
          const dx = DX[d] / (d < 4 ? 1 : S2);
          const dz = DZ[d] / (d < 4 ? 1 : S2);
          any = phys.raycast(p.x, p.y + 0.55, p.z, dx, 0, dz, REACH, MASK).hit;
        }
      }
      rows.push({
        x: p.x,
        z: p.z,
        own: h.hit ? 1 : 0,
        any: any ? 1 : 0,
        walk: g.walkable(g.cellX(p.x), g.cellZ(p.z)) ? 1 : 0,
      });
    }
    return rows;
  });

const STATES = [
  ['all intact', []],
  ...meta.map((d) => [`only ${d.id}`, [d.id]]),
  ['NW6+NW1', ['NW6', 'NW1']],
  ['WC6+EC6', ['WC6', 'EC6']],
  ['NW6+SE6+EC6', ['NW6', 'SE6', 'EC6']],
  ['DISTRICT-A salvo', ['NW6', 'NW1', 'WC6']],
  ['DISTRICT-B salvo', ['SE6', 'SE1', 'EC6']],
  ['ALL SIX DOWN', meta.map((d) => d.id)],
];

let worst = 0;
for (const [label, ids] of STATES) {
  const s = await setState(ids);
  const rows = await probe();
  const near = (p, d) => Math.hypot(p.x - d.x, p.z - d.z) <= d.r;
  const parts = [];
  let onBlocks = 0;
  let staleBlocks = 0;
  for (const d of meta) {
    let n = 0;
    let dead = 0;
    let mis = 0;
    for (const p of rows) {
      if (!near(p, d)) continue;
      n++;
      if (!p.own) (p.any ? (mis += 1) : (dead += 1));
    }
    parts.push(`${d.id} ${String(dead + mis).padStart(3)}/${String(n).padStart(3)}`);
  }
  for (const p of rows) {
    if (!meta.some((d) => near(p, d))) continue;
    onBlocks++;
    if (!p.own) staleBlocks++;
  }
  let mapStale = 0;
  let offGrid = 0;
  for (const p of rows) {
    if (!p.own) mapStale++;
    if (!p.walk) offGrid++;
  }
  worst = Math.max(worst, mapStale);
  console.log(
    `\n${label.padEnd(18)} live ${String(s.live).padStart(5)} · sync ${s.ms.toFixed(2)}ms` +
      ` · AIR on blocks ${String(staleBlocks).padStart(3)}/${String(onBlocks).padStart(3)}` +
      ` · AIR whole map ${String(mapStale).padStart(3)}` +
      ` · off-grid ${offGrid}`
  );
  console.log(`   ${parts.join('  ')}`);
}

await setState([]);
console.log(`\n[coverblocks] worst whole-map AIR count across every state tested: ${worst}`);
await browser.close();
if (errs.length) console.log('\npageerrors:', errs.slice(0, 5));
