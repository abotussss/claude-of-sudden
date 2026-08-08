/**
 * 「塹壕に入ると天井みたいな黒い壁が出てくる」 — IS IT THE COVER PASS'S SHEETS?
 *
 *   node _nfceiling.mjs                       # the map as it ships
 *   node _nfceiling.mjs --nocover             # …with `plains-cover` skipped
 *
 * The claim to test is not "something looks wrong": it is that going DOWN into
 * a cut puts a black surface OVERHEAD, everywhere on the plain. So the camera
 * goes onto the floor of six different bays on six different lines, at a
 * standing and a crouched eye, and LOOKS UP — and the same six frames are taken
 * with `?nocover`, which `buildCover` honours by returning before it lays one
 * sprite. Two builds of the same world differing in one file.
 *
 * The bay centres come from `plains-trench.js` itself, so a line that moves
 * moves its own photographs. The eye is placed at the TRENCH FLOOR + eye rather
 * than at whatever a downward ray finds, because a ray dropped over a cut can
 * land on the spoil berm beside it and photograph the wrong stance.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const PORT = args.port ?? '4613';
const NOCOVER = !!args.nocover;
const URL = `http://127.0.0.1:${PORT}/?map=plains${NOCOVER ? '&nocover=1' : ''}`;
const OUT = args.out ?? (NOCOVER ? 'shots/nfceiling-nocover' : 'shots/nfceiling');
mkdirSync(OUT, { recursive: true });

const { trenchBays } = await import('./src/world/levels/plains-trench.js');
/** One bay per line, the longest on each — six lines, spread over the plain. */
const byLine = new Map();
for (const b of trenchBays()) {
  const line = b.name;
  const cur = byLine.get(line);
  if (!cur || (b.s1 - b.s0) > (cur.s1 - cur.s0)) byLine.set(line, b);
}
const picks = [...byLine.values()].slice(0, 8);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}  url=${URL}  out=${OUT}`);
if (level !== 'plains') { console.error('NOT THE PLAIN'); await b.close(); process.exit(2); }
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.debugState?.('clean');
  const pl = e.ctx.peek('player'); if (pl) pl.applyDamage = () => {};
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await page.evaluate(() => (window.__ENGINE__.time.scale = 6));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.roundClock = 1e6; m._checkWinConditions = () => {};
  window.__ENGINE__.time.scale = 1;
});

for (const bay of picks) {
  const mid = bay.pts[bay.pts.length >> 1];
  const nxt = bay.pts[(bay.pts.length >> 1) + 1] ?? bay.pts[bay.pts.length - 1];
  const along = Math.atan2(nxt[0] - mid[0], nxt[1] - mid[1]);
  const name = bay.name.replace(/[^A-Za-z0-9]+/g, '');
  for (const [tag, eye, pitch] of [['up', 1.62, 62], ['stand', 1.62, 4], ['crouch', 1.05, 30]]) {
    const info = await page.evaluate(([x, z, eye, yaw, pitch]) => {
      const e = window.__ENGINE__, ph = e.ctx.peek('physics');
      const h = ph.raycast(x, 300, z, 0, -1, 0, 400, ph.MASK.WORLD);
      const floor = h.hit ? h.point.y : 0;
      e.camera.position.set(x, floor + eye, z);
      e.camera.rotation.set(-pitch * Math.PI / 180, yaw, 0, 'YXZ');
      e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
      // what is DIRECTLY OVERHEAD of the eye, and how far up
      const u = ph.raycast(x, floor + eye, z, 0, 1, 0, 60, ph.MASK.WORLD);
      return { floor: +floor.toFixed(2), over: u.hit ? +(u.point.y - floor - eye).toFixed(2) : null };
    }, [mid[0], mid[1], eye, along, pitch]);
    await frames(30);
    await page.screenshot({ path: `${OUT}/${name}-${tag}.png` });
    console.log(`  · ${name}-${tag}.png  (${mid[0].toFixed(0)}, ${mid[1].toFixed(0)}) floor ${info.floor}` +
      `  solid overhead: ${info.over === null ? 'none in 60 m' : `${info.over} m`}`);
  }
}
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '0 pageerrors');
await b.close();
