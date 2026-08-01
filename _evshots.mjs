/**
 * PHOTOGRAPH THE CATHEDRAL EVENT AND THE TANK THAT FOLLOWS IT.
 *
 *   node _evshots.mjs [url]
 *
 * The real event, on the real clock, from a player-height eye standing in the
 * mid street where somebody would actually be watching it from — telegraph,
 * ordnance arriving, mid-collapse, settled — and then the armour that rolls in
 * afterwards, photographed side-on in the street and from the ruin it is
 * shelling. Waits for `m.phase === 'live'` first: fired during the warm-up the
 * round reset stands the church back up again.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4272/';
const OUT = 'shots/cathevent';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

/** Stand at authored (lx, lz) looking at `at`, at eye height. */
const stand = (lx, lz, at, dy = 8) =>
  page.evaluate(([lx, lz, at, dy]) => {
    const e = window.__ENGINE__, w = e.ctx.peek('world'), ph = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    const p = w.levelToWorld(lx * 1.5, 0, lz * 1.5, new V3());
    const h = ph.raycast(p.x, 60, p.z, 0, -1, 0, 90, ph.MASK.WORLD);
    e.camera.position.set(p.x, (h?.hit ? h.point.y : 0) + 1.62, p.z);
    e.camera.lookAt(new V3(at[0], dy, at[1]));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  }, [lx, lz, at, dy]);

/** Follow a tank from `back` metres behind and `side` to its right. */
const watchTank = (id, back, side, up) =>
  page.evaluate(([id, back, side, up]) => {
    const e = window.__ENGINE__, m = e.ctx.peek('match');
    const V3 = e.camera.position.constructor;
    const t = m.tank.tanks.find((x) => x.id === id);
    if (!t) return null;
    const yaw = t._yaw ?? 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    e.camera.position.set(t.position.x - fx * back + fz * side, t.position.y + up, t.position.z - fz * back - fx * side);
    e.camera.lookAt(new V3(t.position.x, t.position.y + 1.6, t.position.z));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    return { state: t.state, s: +t.s.toFixed(1), pos: [+t.position.x.toFixed(1), +t.position.z.toFixed(1)], visible: t.root.visible, hp: Math.round(t.health) };
  }, [id, back, side, up]);

const live = () => page.evaluate(() => new Promise((d) => {
  const m = window.__ENGINE__.ctx.peek('match');
  const t = () => (m.phase === 'live' ? d() : requestAnimationFrame(t));
  t();
}));
const wait = (s) => page.evaluate((s) => new Promise((d) => {
  const e = window.__ENGINE__;
  const t0 = e.time.elapsed;
  const t = () => (e.time.elapsed - t0 >= s ? d() : requestAnimationFrame(t));
  t();
}), s);
const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('  shot', name); };

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
});
await live();
// A spectator's seat in the mid street, ~50 m north of the cathedral, looking
// straight down the nave axis at the building that is about to stop existing.
await stand(0, 34, [0, 0], 12);
await wait(1.2);
await shot('00-before');

const t0 = await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match');
  m._beginCathedralEvent(0, 0.44);
  return +e.time.elapsed.toFixed(1);
});
console.log('event begun at engine t =', t0);

const beats = [
  [2.0, '01-telegraph'],
  [6.5, '02-warning-and-first-shells'],
  [8.8, '03-first-shells'],
  [11.2, '04-ordnance-arriving'],
  [12.6, '05-shell-going'],
  [15.0, '06-mid-collapse'],
  [19.0, '06b-bombardment'],
  [24.0, '07-settling'],
  [31.0, '08-settled'],
];
let at = 0;
for (const [t, name] of beats) {
  await wait(t - at);
  at = t;
  await stand(0, 34, [0, 0], 12);
  await shot(name);
}
console.log(await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), w = e.ctx.peek('world');
  return `razed=${!!w.cathedral?.razed} D live=${!!m.sites?.some?.((s) => s.id === 'D')} cath.t=${m._cath.t.toFixed(1)} beat=${m._cath.beat} shells=${m._cath.shot}`;
}));

/* ---- and the armour it called in ------------------------------------- */
console.log(await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return `tank _next=${m.tank._next.toFixed(1)} pending=${m.tank._pending.toFixed(1)} ignoreCoBusy=${m.tank._ignoreCoBusy}`;
}));
await page.evaluate(() => new Promise((d) => {
  const m = window.__ENGINE__.ctx.peek('match');
  const t = () => (m.tank.tanks.some((x) => x.state !== 'parked') ? d() : requestAnimationFrame(t));
  t();
}));
console.log('  a hull is rolling');
for (const [t, name, back, side, up] of [
  [1.0, '10-tank-leaves-spawn', 16, 7, 3.2],
  [8.0, '11-tank-in-the-street', 15, 11, 3.0],
  [15.0, '12-tank-closing', 4, 15, 3.4],
  [23.0, '13-tank-at-the-ruin', -6, 17, 3.6],
]) {
  await wait(t);
  const info = await watchTank('RED', back, side, up);
  console.log('   RED', JSON.stringify(info));
  await shot(name);
}
// …and from where a man standing in D would see it.
await stand(0, 8, [0, 0], 2);
await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match');
  const V3 = e.camera.position.constructor;
  const t = m.tank.tanks.find((x) => x.id === 'RED');
  if (t) { e.camera.lookAt(new V3(t.position.x, t.position.y + 1.4, t.position.z)); e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation); }
});
await wait(0.3);
await shot('14-tank-from-the-ruin');
const both = await page.evaluate(() => window.__ENGINE__.ctx.peek('match').tank.tanks.map((t) => ({ id: t.id, state: t.state, hp: Math.round(t.health), pos: [+t.position.x.toFixed(1), +t.position.z.toFixed(1)], visible: t.root.visible })));
console.log('  tanks:', JSON.stringify(both));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
