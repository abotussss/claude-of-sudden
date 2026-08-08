/** ARE THE 3 365 CHUNKS ACTUALLY DRAWN? mesh.visible, mesh.count, the parent
 *  chain, and where the instances are, at t=0 / t=1.5 / settled. */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const snap = () => p.evaluate(() => {
  const e = window.__ENGINE__;
  const s = e.ctx.peek('match').airstrike.sites.find((k) => k.id === 'NF-TOWER');
  const rows = s.meshes.map((m) => {
    const a = m.instanceMatrix.array;
    let ymin = 1e9, ymax = -1e9;
    for (let i = 0; i < m.count; i++) { const y = a[i*16+13]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    let anc = m, inScene = false, hidden = null;
    while (anc) { if (!anc.visible && hidden === null) hidden = anc.name || anc.type; if (anc === e.ctx.scene) inScene = true; anc = anc.parent; }
    return { name: m.name, visible: m.visible, count: m.count, frustumCulled: m.frustumCulled,
      inScene, firstHiddenAncestor: hidden, instanceY: [+ymin.toFixed(1), +ymax.toFixed(1)],
      uT: +s.uniforms.uT.value.toFixed(2), baked: !!s.baked, struck: !!s.struck, t: +s.t.toFixed(2) };
  });
  return rows;
});
const until = (secs) => p.evaluate((secs) => new Promise((r) => {
  const s = window.__ENGINE__.ctx.peek('match').airstrike.sites.find((k) => k.id === 'NF-TOWER');
  const t = () => (s.t >= secs || s.t < 0 ? r(+s.t.toFixed(2)) : requestAnimationFrame(t));
  requestAnimationFrame(t);
}), secs);
console.log('BEFORE  ', JSON.stringify(await snap()));
await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike.callDemolition('NF-TOWER'));
await until(1.2); console.log('t=1.2   ', JSON.stringify(await snap()));
await until(4.0); console.log('t=4.0   ', JSON.stringify(await snap()));
// wait for `_bakeSettled` itself rather than for a clock: a ROUND RESET also
// drives `site.t` negative, and the first cut of this file read that as "settled"
// and reported the chunks gone when what had happened is the round ended.
await p.evaluate(() => new Promise((r) => {
  const s = window.__ENGINE__.ctx.peek('match').airstrike.sites.find((k) => k.id === 'NF-TOWER');
  let n = 0;
  const t = () => (s.baked || ++n > 3000 ? r(s.baked) : requestAnimationFrame(t));
  requestAnimationFrame(t);
}));
console.log('settled ', JSON.stringify(await snap()));
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
