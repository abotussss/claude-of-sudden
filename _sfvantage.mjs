import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 800, height: 500 } });
await p.goto(process.argv[2] ?? 'http://127.0.0.1:4630/?map=plains&capture=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const r = await p.evaluate(() => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const s = e.ctx.peek('match').crash._sky;
  const C = [s.centre.x, s.centre.y, s.centre.z];
  const cand = [[0,0],[-40,-80],[-40,60],[-60,70],[-30,30],[-20,-60],[-118,-104],[-128,86],[-150,-60],[-60,-90],[-40,-40],[-52,24],[-18,-22],[40,150],[-10,-110],[-70,90],[-100,90],[-95,-95],[-56,-6],[-140,-40]];
  const out = [];
  for (const [x,z] of cand) {
    const g = ph.groundHeight(x, z, 400);
    const from = { x, y: g + 1.7, z };
    const to = { x: C[0], y: C[1] + 8, z: C[2] };
    const los = ph.lineOfSight ? ph.lineOfSight(from, to, ph.MASK.WORLD) : null;
    const d = Math.hypot(x - C[0], z - C[2]);
    const inside = s._inside(x, z);
    out.push({ x, z, ground: +g.toFixed(2), dist: +d.toFixed(0), los, inside });
  }
  return { C: C.map((v)=>+v.toFixed(1)), out, spine: [s._sx.toFixed(1), s._sz.toFixed(1), s._sLen, Math.sqrt(s._r2)] };
});
console.log('region centre', r.C, 'spine', r.spine);
for (const o of r.out) console.log(`  (${String(o.x).padStart(5)}, ${String(o.z).padStart(5)})  ground ${String(o.ground).padStart(6)}  ${String(o.dist).padStart(4)} m  los=${o.los}  inside=${o.inside}`);
await b.close();
