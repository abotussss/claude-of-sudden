import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4423/';
const PTS = JSON.parse(process.argv[3] ?? '[[-37.3,18.7]]');
const R = Number(process.argv[4] ?? 5);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
await p.goto(`${URL}?capture=1&seed=7`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const out = await p.evaluate(([PTS, R]) => {
  const e = window.__ENGINE__;
  const m = new e.camera.matrixWorld.constructor();
  const w = new e.camera.matrixWorld.constructor();
  const res = PTS.map(() => []);
  e.ctx.scene.updateMatrixWorld(true);
  e.ctx.scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.name.startsWith('prop_')) return;
    for (let j = 0; j < o.count; j++) {
      o.getMatrixAt(j, m);
      w.multiplyMatrices(o.matrixWorld, m);
      const x = w.elements[12], y = w.elements[13], z = w.elements[14];
      for (let i = 0; i < PTS.length; i++) {
        const d = Math.hypot(x - PTS[i][0], z - PTS[i][1]);
        if (d < R) res[i].push({ name: o.name, slot: j, x: +x.toFixed(1), y: +y.toFixed(1), z: +z.toFixed(1), d: +d.toFixed(1) });
      }
    }
  });
  return res;
}, [PTS, R]);
console.log(JSON.stringify(out, null, 1));
await b.close();
