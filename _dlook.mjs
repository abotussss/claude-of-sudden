/**
 * STAND IN D AND LOOK. Nothing else.
 *
 * D has been reported fixed three times and the player has rejected it three
 * times, most recently with the reason the numbers never captured: 「瓦礫による
 * 視認性の悪さが問題」 — you are in a canyon and cannot see out. The last pass
 * measured sightlines and moved them, but took no photographs at all.
 *
 * So: boot with the cathedral razed, put an eye at 1.62 m at the centre of D
 * and at four points near its rim, look out along the cardinal bearings, and
 * ALSO measure what the eye can actually reach on each of those bearings. A
 * picture says whether it reads as buried; the ray says whether the picture is
 * representative.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4490/';
const OUT = 'shots/dlook';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&cath=down`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
});
await page.evaluate(() => {
  /* the round was restarting mid-shoot and respawning the camera into the
   * warm-up pen: three of the first pass's frames were a boundary wall in the
   * sand. Nail the clock down the way `_dsight.mjs` does before framing. */
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  m.roundClock = 1e6;
  if (m.score) m.score[0] = 999;
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

const info = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const d = (m.allZones ?? m.sites).find((z) => z.id === 'D');
  return d ? { at: [d.position.x, d.position.y, d.position.z], r: d.radius ?? 8 } : null;
});
console.log('D at', JSON.stringify(info));

/** Park the eye at an offset from D's centre and look along `bearing`. */
const shoot = (dx, dz, bearing, tag) => page.evaluate(([c, dx, dz, bearing]) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const x = c[0] + dx, z = c[2] + dz;
  const h = phys.raycast(x, c[1] + 30, z, 0, -1, 0, 60, phys.MASK.WORLD);
  const y = (h.hit ? h.point.y : c[1]) + 1.62;
  const a = (bearing * Math.PI) / 180;
  e.camera.position.set(x, y, z);
  e.camera.lookAt(new V3(x + Math.sin(a) * 40, y - 1.0, z + Math.cos(a) * 40));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  // How far can this eye actually see along this bearing?
  const r = phys.raycast(x, y, z, Math.sin(a), 0, Math.cos(a), 40, phys.MASK.WORLD);
  return { eyeY: +y.toFixed(2), reach: r.hit ? +r.distance.toFixed(1) : 40 };
}, [info.at, dx, dz, bearing]);

/**
 * FIVE EYES, EIGHT BEARINGS EACH. The centre answers "is the point a pit"; the
 * four rim stations answer the question the centre cannot, which is whether the
 * ring of debris that three passes pushed OUT of the circle is a revetment when
 * you are standing against it. Eight bearings because four can be lucky.
 */
const RIM = 6.8;
const stations = [
  ['centre', 0, 0],
  ['rimN', 0, -RIM],
  ['rimE', RIM, 0],
  ['rimS', 0, RIM],
  ['rimW', -RIM, 0],
];
const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
for (const [name, dx, dz] of stations) {
  const line = [];
  for (const bg of BEARINGS) {
    const r = await shoot(dx, dz, bg);
    await frames(30);
    await page.screenshot({ path: `${OUT}/${name}-${String(bg).padStart(3, '0')}.png` });
    line.push(`${bg}° ${r.reach}m`);
  }
  console.log(`  ${name.padEnd(7)} ${line.join('  ')}`);
}
console.log(errs.length ? `[pageerror] ${errs.slice(0,2).join(' | ')}` : '[pageerror] none');
await b.close();
