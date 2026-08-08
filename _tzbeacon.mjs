/** The razed site with the sky above it in frame — does the masthead beacon
 *  still burn over nothing? @see `_tzlights.mjs` for the numbers. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('shots/tzraze', { recursive: true });
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
await p.evaluate(() => { const c = window.__ENGINE__.ctx; const m = c.peek('match'); if (m) m.update = () => {};
  const ui = c.peek('ui'); if (ui?.root) ui.root.style.display = 'none'; });
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i=0; const t=()=>(++i>=n?r():requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
const pose = (x,z,at,eye=1.62,from=80) => p.evaluate(({x,z,at,eye,from}) => {
  const c=window.__ENGINE__.ctx, ph=c.peek('physics'), pl=c.peek('player');
  let f=ph.groundHeight(x,z,from); if(!Number.isFinite(f)) f=c.peek('world').groundHeight(x,z);
  const ey=f+eye, dx=at[0]-x, dy=at[1]-ey, dz=at[2]-z;
  pl.teleport({x,y:ey,z},{x:Math.atan2(dy,Math.hypot(dx,dz)), y:Math.atan2(-dx,-dz)});
},{x,z,at,eye,from});
const shot = async (n,note) => { await wait(80);
  const c = await p.evaluate(()=>{const k=window.__ENGINE__.ctx.camera; k.rotation.order='YXZ';
    return {x:+k.position.x.toFixed(2),y:+k.position.y.toFixed(2),z:+k.position.z.toFixed(2),yaw:+k.rotation.y.toFixed(3),pitch:+k.rotation.x.toFixed(3)};});
  await p.screenshot({path:`shots/tzraze/${n}.png`}); console.log(`  ${n}.png camera ${JSON.stringify(c)} — ${note}`); };
await p.evaluate(() => window.__ENGINE__.ctx.peek('match').airstrike.callDemolition('NF-TOWER'));
await wait(500);
await pose(0,0,[0,42,-32]); await shot('B1-razed-look-up-from-D','razed — from zone D, looking at where the masthead beacon was');
await pose(0,-60,[0,42,-32]); await shot('B2-razed-look-up-close','razed — 28 m north of the site, looking up at 42 m');
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
