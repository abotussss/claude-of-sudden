/**
 * WHAT THE DARK SPECKS OVER THE RUIN ACTUALLY ARE.
 *
 *   node _skygrit.mjs [--url=…]
 *
 * `_cathwatch.mjs`'s scene census names the owners of the mass hanging over the
 * razed cathedral and finds `bomber_*_debris` / `strafe_*_grit` — not
 * `airstrike` chunks, which is why the float gate has been reporting OK. This
 * asks the follow-up: are those instances DRAWN, or are they spent particles
 * parked at their last pose with a zero scale and no alpha, which would look
 * like a bug in a census and like nothing at all on screen?
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4382/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate(() => (window.__ENGINE__.time.scale = 8));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  // The two runs the cathedral event calls as beats, on their own, over the
  // middle of the map — nothing else has to happen for this question.
  m.bomber?.fire?.('MAIN');
  m.strafe?.fire?.('MAIN');
  window.__ENGINE__.time.scale = 1;
});

const look = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const V3 = e.camera.position.constructor;
    const M4 = e.camera.matrixWorld.constructor;
    const wp = new V3();
    const ws = new V3();
    const wq = e.camera.quaternion.clone();
    const m4 = new M4();
    const out = [];
    e.scene.updateMatrixWorld(true);
    e.scene.traverse((o) => {
      if (!/debris|grit|bombs/.test(o.name)) return;
      const row = {
        name: o.name,
        visible: o.visible,
        parentsVisible: (() => { let p = o.parent; while (p) { if (!p.visible) return false; p = p.parent; } return true; })(),
        count: o.isInstancedMesh ? o.count : 1,
        opacity: o.material?.opacity ?? null,
        transparent: o.material?.transparent ?? null,
        zeroScale: 0,
        drawnAbove8: 0,
        hi: -Infinity,
      };
      if (o.isInstancedMesh) {
        const arr = o.instanceMatrix.array;
        for (let i = 0; i < Math.min(arr.length, o.count * 16); i += 16) {
          m4.fromArray(arr, i).premultiply(o.matrixWorld);
          m4.decompose(wp, wq, ws);
          const s = Math.max(ws.x, ws.y, ws.z);
          if (s < 1e-3) { row.zeroScale++; continue; }
          if (wp.y > 8) row.drawnAbove8++;
          if (wp.y > row.hi) row.hi = +wp.y.toFixed(1);
        }
      }
      out.push(row);
    });
    return { t: +e.ctx.time.elapsed.toFixed(1), out };
  });

const a = await look();
await page.waitForTimeout(6000);
const b = await look();
await page.waitForTimeout(30000);
const c = await look();
await browser.close();

for (const [label, s] of [['first look', a], ['+6 s', b], ['+36 s', c]]) {
  console.log(`\n─── ${label} — t=${s.t} ───`);
  console.log('  name                       vis  parentVis  count  zeroScale  drawn>8m  highest  opacity');
  for (const r of s.out) {
    console.log(
      `  ${r.name.padEnd(26)} ${String(r.visible).padEnd(5)} ${String(r.parentsVisible).padEnd(9)} ` +
        `${String(r.count).padStart(5)} ${String(r.zeroScale).padStart(10)} ${String(r.drawnAbove8).padStart(9)} ` +
        `${String(r.hi === -Infinity ? '-' : r.hi).padStart(8)} ${String(r.opacity)}`
    );
  }
}
console.log('\n  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
