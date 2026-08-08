/**
 * A CAMERA AT A STANDING MAN'S EYE, ANYWHERE, POINTED ANYWHERE.
 *
 *   node _nfview.mjs --out=shots/x --shots='[["name",[x,z],yawDeg,pitchDeg], …]'
 *   node _nfview.mjs --out=shots/x --spin='[["name",[x,z]], …]'      # 8 × 45°
 *
 * The complaint this exists for is 「平原に障害物が少なく」 and 「入る場所が
 * わからない」, and both are claims about what a man SEES while he turns on the
 * spot — not about a path between two points. So the eye is 1.62 m over
 * whatever `MASK.WORLD` finds under the point, the yaw is absolute (0 = +Z,
 * clockwise in degrees) and `--spin` walks it round in eight steps.
 *
 * `world.level.id` is checked at the far end: a screenshot of the wrong map is
 * the most convincing wrong evidence there is.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4613/?map=plains&capture=1';
const OUT = args.out ?? 'shots/nfview';
const EYE = Number(args.eye ?? 1.62);
const WAIT = Number(args.wait ?? 0);      // seconds of live match before shooting
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}  out=${OUT}  eye=${EYE}`);
if (level !== 'plains' && !args.anymap) { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ui')?.debugState?.('clean');
  const pl = e.ctx.peek('player');
  if (pl) pl.applyDamage = () => {};
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

// the round has to be LIVE or WARMUP keeps snapping the player back to a spawn
await page.evaluate(() => (window.__ENGINE__.time.scale = 6));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 300000 });
if (WAIT > 0) await page.waitForTimeout((WAIT / 6) * 1000);
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  window.__ENGINE__.time.scale = 1;
});
if (args.down) {
  const n = await page.evaluate((ids) => {
    const w = window.__ENGINE__.ctx.peek('world');
    let k = 0;
    for (const d of w.demolitions ?? []) {
      if (ids !== 'all' && !String(ids).split(',').includes(d.id)) continue;
      d.setDown?.(true); k++;
    }
    return k;
  }, args.down);
  console.log(`  (${n} works put down)`);
}

/** `yawDeg` may instead be a [x, y, z] world point to look AT. */
const place = (x, z, yawDeg, pitchDeg) => page.evaluate(([x, z, yaw, pitch, eye]) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const h = phys.raycast(x, 300, z, 0, -1, 0, 400, phys.MASK.WORLD);
  const y = (h.hit ? h.point.y : 0) + eye;
  e.camera.position.set(x, y, z);
  if (Array.isArray(yaw)) {
    const V3 = e.camera.position.constructor;
    e.camera.lookAt(new V3(yaw[0], yaw[1], yaw[2]));
  } else {
    e.camera.rotation.set(pitch * Math.PI / 180, yaw * Math.PI / 180, 0, 'YXZ');
  }
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return +y.toFixed(2);
}, [x, z, yawDeg, pitchDeg, EYE]);

const list = [];
if (args.shots) for (const s of JSON.parse(args.shots)) list.push(s);
if (args.spin) {
  for (const [name, at] of JSON.parse(args.spin)) {
    for (let k = 0; k < 8; k++) list.push([`${name}-${String(k * 45).padStart(3, '0')}`, at, k * 45, -3]);
  }
}

for (const [name, at, yaw, pitch] of list) {
  const y = await place(at[0], at[1], yaw ?? 0, pitch ?? 0);
  await frames(40);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  · ${name}.png  at (${at[0]}, ${at[1]}) eye y ${y} yaw ${yaw ?? 0}`);
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 4).join(' | ')}` : '\n0 pageerrors');
await b.close();
