/** How much of the static world is `prop_*`, and how tall the props stand. */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const out = await page.evaluate(() => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const sw = phys.staticWorld;
  const byObj = new Map();
  for (let t = 0; t < sw.triCount; t++) {
    const oid = sw.object[t];
    byObj.set(oid, (byObj.get(oid) ?? 0) + 1);
  }
  const rows = [];
  let propTris = 0, propObjs = 0;
  for (const [oid, n] of byObj) {
    const o = sw.objects[oid];
    const nm = o?.mesh?.name ?? o?.name ?? '?';
    rows.push(`${nm} ${n} tris mask=${o.mask} inst=${o.mesh?.isInstancedMesh ? o.mesh.count : '-'}`);
    if (nm.startsWith('prop_')) { propTris += n; propObjs++; }
  }
  let inst = 0;
  e.ctx.scene.traverse((o) => { if (o.isInstancedMesh && o.name.startsWith('prop_')) inst += o.count; });
  return { triCount: sw.triCount, objects: sw.objects.length, propTris, propObjs, inst, rows: rows.sort() };
});
console.log(`static world: ${out.triCount} tris in ${out.objects} objects`);
console.log(`prop_* : ${out.propTris} tris in ${out.propObjs} objects, ${out.inst} instances`);
console.log(out.rows.join('\n'));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
