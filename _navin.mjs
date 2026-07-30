import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
await page.goto('http://127.0.0.1:4214/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match'); const world = e.ctx.peek('world'); const ai = e.ctx.peek('ai');
  const g = ai.grid; const V3 = m.sites[0].position.constructor; const s = new V3();
  const B = world.layout.BUILDINGS.filter(b=>b.enterable);
  const per = {}; const ys = {}; const pts = {};
  for (const b of B) { per[b.id]=0; ys[b.id]=[]; pts[b.id]=[]; }
  for (let iz=0; iz<g.nz; iz++) for (let ix=0; ix<g.nx; ix++) {
    const ci = iz*g.nx+ix;
    if (!g.flags[ci]) continue;
    const wx=g.worldX(ix), wz=g.worldZ(iz), wy=g.floor[ci];
    const l = world.worldToLevel(wx, wy, wz, s);
    for (const b of B) {
      if (l.x>b.x-b.w/2+0.6 && l.x<b.x+b.w/2-0.6 && l.z>b.z-b.d/2+0.6 && l.z<b.z+b.d/2-0.6) {
        per[b.id]++; ys[b.id].push(+wy.toFixed(1)); pts[b.id].push(new V3(wx,wy,wz)); break;
      }
    }
  }
  const path=[]; const out=[];
  for (const b of B) {
    const n=per[b.id];
    const hs={}; for(const y of ys[b.id]) hs[y]=(hs[y]??0)+1;
    let low = pts[b.id].filter(p=>p.y<2.5);
    let routes=0;
    if (low.length) { const q=low[(low.length/2)|0];
      for (const k of ['attack','defend']) for (const sp of m.spawns[k]) if (g.findPath(sp.position,q,path)>0) routes++; }
    out.push(`${b.id.padEnd(4)} cells=${String(n).padStart(4)}  ground(<2.5m)=${String(low.length).padStart(4)} (${(low.length*0.64).toFixed(0)} m2)  routes ${routes}/30  yhist=${JSON.stringify(hs).slice(0,90)}`);
  }
  return out.join('\n');
}));
await browser.close();
