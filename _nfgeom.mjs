import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 700, height: 420 } });
await p.goto('http://127.0.0.1:4578/?map=plains', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(JSON.stringify(await p.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('world');
  const m = window.__ENGINE__.ctx.peek('match');
  return {
    demos: (w.demolitions??[]).map(d=>({id:d.id, px:d.position.x, py:d.position.y, pz:d.position.z, baseY:d.baseY, top:d.top, radius:d.radius, halfW:d.halfW, halfD:d.halfD, opens:d.opens, zone:d.zone})),
    aim: (m._acts??[]).map(a=>({id:a.spec.id, y:[...a.aim.y].map(v=>+v.toFixed(1)), x:[...a.aim.x].map(v=>+v.toFixed(1)), z:[...a.aim.z].map(v=>+v.toFixed(1))})),
    fires: (w.level?.fires ?? w.fires ?? []).map(f=>({id:f.id, x:+(f.x??f.position?.x??0).toFixed(0), z:+(f.z??f.position?.z??0).toFixed(0), r:f.radius})),
  };
}), null, 1));
await b.close();
