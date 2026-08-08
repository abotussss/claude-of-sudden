/**
 * FREE CAMERA — look at a thing from outside it.
 *
 *   node _nffreecam.mjs --at=17.5,43.5,3.25 --r=22 --out=shots/freecam
 *
 * `Player.update` writes the camera only under `if (this.controlEnabled)`, so
 * with control OFF nothing in the engine touches `camera` and a transform set
 * from the driver simply stays. That is the opposite of the standing-eye probes,
 * which need control ON for the rig to place the eye — both facts matter and
 * both are easy to get backwards.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4616/?map=plains&capture=1';
const AT = (args.at ?? '17.5,43.5,3.25').split(',').map(Number);
const RAD = Number(args.r ?? 22);
const UP = Number(args.up ?? 6);
const OUT = args.out ?? 'shots/freecam';
const TAG = args.tag ?? 'obj';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const lvl = await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id);
console.log('level.id =', lvl);
if (lvl !== 'plains') { console.error('WRONG MAP'); await b.close(); process.exit(2); }

await p.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  const ui = e.ctx.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
  // The viewmodel lives in `ctx.viewScene`, a SECOND scene composited over the
  // world — not under `engine.scene` and not under `camera.children`. It covers
  // the centre-bottom of the frame, which is exactly where `lookAt` puts the
  // subject.
  e.ctx.viewScene?.traverse?.((o) => { if (o.isMesh || o.isInstancedMesh || o.isSprite) o.visible = false; });
});
const frames = (n) => p.evaluate((k) => new Promise((d) => {
  let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

const put = (px, py, pz, tx, ty, tz) => p.evaluate(([px, py, pz, tx, ty, tz]) => {
  const c = window.__ENGINE__.camera;
  c.position.set(px, py, pz);
  c.lookAt(tx, ty, tz);
  c.updateMatrixWorld(true);
  return [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)];
}, [px, py, pz, tx, ty, tz]);

for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  const px = AT[0] + Math.cos(a) * RAD, pz = AT[2] + Math.sin(a) * RAD;
  const py = AT[1] + UP;
  const got = await put(px, py, pz, AT[0], AT[1], AT[2]);
  await frames(6);
  await p.screenshot({ path: `${OUT}/${TAG}_a${i}.png` });
  console.log(`  · ${TAG}_a${i}.png  from ${JSON.stringify(got)}`);
}
// from below, the way a man in a trench sees it
await put(AT[0] - 30, AT[1] - 42, AT[2] - 6, AT[0], AT[1], AT[2]);
await frames(6);
await p.screenshot({ path: `${OUT}/${TAG}_frombelow.png` });
// straight down on it
await put(AT[0], AT[1] + 34, AT[2] + 0.01, AT[0], AT[1], AT[2]);
await frames(6);
await p.screenshot({ path: `${OUT}/${TAG}_plan.png` });
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
