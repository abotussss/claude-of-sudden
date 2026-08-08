/**
 * WHAT THE TANK STILL DESTROYS — the counterweight to the floor mask.
 *   node _zzdestroy.mjs [--url=…] [--run=420] [--scale=8] [--seed=…]
 * Plays a match and reports every eraser's output: piles ploughed and the
 * instances and triangles they took, prop instances shelled off by the raze
 * atlas, free-standing blocks broken, and the triangles each removed.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = (args.url ?? 'http://127.0.0.1:4627/?map=plains') + (args.seed ? `&seed=${args.seed}` : '');
const RUN = Number(args.run ?? 420);
const SCALE = Number(args.scale ?? 8);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
const logs = [];
p.on('console', (m) => { const t = m.text(); if (/\[tank\]/.test(t)) logs.push(t); });
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id=' + await p.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id));
for (const l of logs) console.log('  ' + l);
await p.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, SCALE);
await p.waitForTimeout(Math.ceil((RUN / SCALE) * 1000));
const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const t = e.ctx.peek('match')?.tank;
  const hulls = (t?.tanks ?? []).map((h) => {
    let fired = 0, inst = 0, tris = 0;
    for (const q of h.plough ?? []) if (q.fired) { fired++; inst += q.inst.length; tris += q.tris?.length ?? 0; }
    return { id: h.id, alive: h.alive, piles: h.plough?.length ?? 0, ploughed: fired, instances: inst, tris, stats: h.stats ?? null };
  });
  const a = t?._atlas;
  let razeTris = 0;
  for (const r of a?.fired ?? []) razeTris += r.tris?.length ?? 0;
  const bl = t?._blocks;
  let blockFired = 0, blockTris = 0, blockDrawn = 0;
  for (const x of bl?.list ?? []) if (x.fired) { blockFired++; blockTris += x.tris?.length ?? 0; blockDrawn += (x.draws ?? []).reduce((s, d) => s + d.off.length, 0); }
  return {
    phase: e.ctx.peek('match')?.phase ?? '?',
    hulls,
    razeRecs: a?.recs?.length ?? 0, razeFired: a?.fired?.length ?? 0, razeTris,
    blocks: bl?.list?.length ?? 0, blockFired, blockTris, blockDrawn,
    stats: t?.stats ?? null,
  };
});
console.log(`\n  phase=${out.phase}`);
for (const h of out.hulls) console.log(`    ${h.id.padEnd(7)} alive=${h.alive}  ${h.ploughed}/${h.piles} piles ploughed, ${h.instances} instances, ${h.tris} collision triangles`);
console.log(`    raze atlas: ${out.razeFired} of ${out.razeRecs} prop instances shelled off, ${out.razeTris} collision triangles`);
console.log(`    blocks:     ${out.blockFired} of ${out.blocks} broken, ${out.blockTris} collision + ${out.blockDrawn} drawn triangles`);
console.log('    tank.stats: ' + JSON.stringify(out.stats));
console.log(errs.length ? `\n[pageerror] ${errs.length}: ${errs[0]}` : '\n[pageerror] none');
await b.close();
