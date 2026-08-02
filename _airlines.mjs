/**
 * WHERE THE BOMBER AND THE STRAFING RUNS ACTUALLY PUT THEIR MASS.
 *
 *   node _airlines.mjs [--url=…] [--seed=N]
 *
 * `shots/sky/live-*.png` show dozens of cubes hanging 14-15 m over the razed
 * cathedral, and `_skywhat.mjs` names them `bomber_*_debris` and
 * `strafe_*_grit` with NOTHING solid under them. Both of those systems probe
 * their impact plane ONCE, at boot, with a downward ray — and the middle of
 * this map is now a 29 m cathedral, so a line down the mid street or across
 * the cross street lands on its ROOF.
 *
 * `bomber.js` already prints a warning for exactly this ("the run is over
 * rooftops, not over a street. Re-author the line"). This collects that boot
 * console and then measures the same thing directly: every bomb impact and
 * every settled debris/grit instance, with the plane under it in BOTH
 * cathedral states.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4421/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const lines = [];
page.on('console', (m) => {
  const t = m.text();
  if (/bomber|strafe/i.test(t)) lines.push(`${m.type()}: ${t}`);
});
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL + (args.seed ? `?seed=${args.seed}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('world');
  const ph = e.ctx.peek('physics');
  const MASK = ph.MASK.WORLD;
  const k = w.cathedral;
  const vol = w.interiorVolumes.find((v) => v.building === k.id);
  const inCath = (x, z) => {
    const dx = x - vol.cx;
    const dz = z - vol.cz;
    const lu = dx * vol.c - dz * vol.s;
    const lv = dx * vol.s + dz * vol.c;
    return Math.abs(lu) <= k.hw + 2 && Math.abs(lv) <= k.hd + 2;
  };
  const rows = [];
  for (const run of m.bomber?.runs ?? []) {
    for (const b of run.bombs ?? []) {
      rows.push({
        sys: 'bomber', id: run.id,
        x: +b.impact.x.toFixed(1), y: +b.impact.y.toFixed(2), z: +b.impact.z.toFixed(1),
        overCath: inCath(b.impact.x, b.impact.z),
      });
    }
  }
  for (const run of m.strafe?.runs ?? []) {
    const pts = run.impacts ?? run.hits ?? [];
    for (const p of pts) {
      const q = p.point ?? p;
      if (!q || typeof q.x !== 'number') continue;
      rows.push({
        sys: 'strafe', id: run.id,
        x: +q.x.toFixed(1), y: +q.y.toFixed(2), z: +q.z.toFixed(1),
        overCath: inCath(q.x, q.z),
      });
    }
  }
  /** …and what the ground under each one becomes once the church is gone. */
  const razedPlane = [];
  const cath = w.cathedral;
  cath.setCollision(true, ph);
  for (const r of rows) {
    const h = ph.raycast(r.x, 40, r.z, 0, -1, 0, 60, MASK);
    razedPlane.push(h.hit ? +h.point.y.toFixed(2) : null);
  }
  cath.setCollision(false, ph);
  rows.forEach((r, i) => { r.razedY = razedPlane[i]; });
  return { rows, runs: (m.bomber?.runs ?? []).map((r) => r.id), strafeRuns: (m.strafe?.runs ?? []).map((r) => r.id) };
});
await browser.close();

console.log('\nAIRLINES — the boot console for bomber/strafe:');
for (const l of lines) console.log(`  ${l}`);
console.log(`\n  bomber runs: ${out.runs.join(', ')}   strafe runs: ${out.strafeRuns.join(', ')}`);
console.log('\n  sys      run     impact (x, y, z)            over the cathedral?   plane once razed   drop');
let bad = 0;
for (const r of out.rows) {
  const drop = r.razedY === null ? null : +(r.y - r.razedY).toFixed(2);
  const flag = r.y > 3 && drop !== null && drop > 2;
  if (flag) bad++;
  console.log(
    `  ${r.sys.padEnd(8)} ${String(r.id).padEnd(7)} ${String(r.x).padStart(7)}, ${String(r.y).padStart(6)}, ${String(r.z).padStart(7)}   ` +
      `${String(r.overCath).padEnd(20)} ${String(r.razedY).padStart(8)}   ${String(drop).padStart(6)}` +
      (flag ? '   <-- LEFT IN THE AIR BY THE RAZE' : '')
  );
}
console.log(`\n  impacts that end up hanging in clear air once the cathedral falls: ${bad}/${out.rows.length}`);
if (errs.length) console.log('  PAGE ERRORS', errs.slice(0, 3));
