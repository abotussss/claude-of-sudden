/** Are the street props instanced, and can one instance be found by position? */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4290/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=7`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const inst = [];
  e.ctx.scene.traverse((o) => {
    if (o.isInstancedMesh) inst.push({ name: o.name, count: o.count, tris: (o.geometry?.index?.count ?? o.geometry?.attributes?.position?.count ?? 0) / 3 });
  });
  const A = w.A;
  return {
    instanced: inst,
    instTotal: inst.length,
    hasA: !!A,
    aKeys: A ? Object.keys(A).slice(0, 40) : [],
    protoKeys: A?.protos ? (A.protos instanceof Map ? [...A.protos.keys()].slice(0, 40) : Object.keys(A.protos).slice(0, 40)) : null,
    scopeKeys: A?.scopes ? (A.scopes instanceof Map ? [...A.scopes.keys()] : Object.keys(A.scopes)) : null,
    staticMeshKeys: A?.staticMeshes ? (A.staticMeshes instanceof Map ? [...A.staticMeshes.keys()].slice(0, 40) : Object.keys(A.staticMeshes).slice(0, 40)) : null,
  };
});
console.log('instanced meshes:', out.instTotal);
for (const i of out.instanced.slice(0, 40)) console.log(`   x${String(i.count).padStart(5)}  ${Math.round(i.tris)} tris  ${i.name}`);
console.log('\nA keys:', out.aKeys.join(', '));
console.log('\nscopes:', out.scopeKeys);
console.log('\nprotos:', out.protoKeys);
if (errs.length) console.log('PAGEERRORS', errs);
await b.close();
