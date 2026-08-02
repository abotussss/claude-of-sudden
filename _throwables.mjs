/**
 * THE FOUR THINGS IN THE POUCH — does the page boot with them, and does each
 * one actually leave the hand and do its own thing?
 *
 *   node _throwables.mjs [--url=…]
 *
 * Deliberately shallow: the bar for this pass is "it compiles and the page
 * boots without a pageerror". This is the boot, plus one throw of each kind
 * driven through the real cook/release path so a def that crashes on
 * detonation cannot hide behind a clean build.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4424/';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const pump = (n) =>
  page.evaluate(
    (n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }),
    n
  );

const ids = await page.evaluate(() => {
  const wp = window.__ENGINE__.ctx.peek('weapons');
  return { all: wp.weaponIds, throwables: wp.throwableIds, sidearms: wp.sidearmIds, primaries: wp.primaryIds };
});
console.log('[throwables] weaponIds  ', ids.all.join(', '));
console.log('[throwables] primaries  ', ids.primaries.join(', '));
console.log('[throwables] sidearms   ', ids.sidearms.join(', '));
console.log('[throwables] throwables ', ids.throwables.join(', '));

console.log('\n=== ONE THROW OF EACH, through cook + release ===');
for (const id of ids.throwables) {
  const before = await page.evaluate((id) => {
    const wp = window.__ENGINE__.ctx.peek('weapons');
    wp.debugMode = null;
    wp.locked = false;
    wp.resetAmmo();
    wp.setWeaponImmediate(id);
    const s = wp.states.get(id);
    return { mag: s.mag, kind: s.def.throwKind, fuse: s.def.fuse, thrown: wp.thrown.stats.thrown, det: wp.thrown.stats.detonated };
  }, id);

  await page.evaluate(() => window.__ENGINE__.ctx.peek('weapons').startCook('over'));
  await pump(20);
  await page.evaluate(() => window.__ENGINE__.ctx.peek('weapons').releaseThrow());
  // Long enough for the longest fuze (smoke 2.2 s) plus a mine's arm + trip.
  await pump(260);

  const after = await page.evaluate((id) => {
    const wp = window.__ENGINE__.ctx.peek('weapons');
    const t = wp.thrown;
    let armed = 0, tripped = 0, beams = 0;
    for (const g of t.pool) { if (g.armed) armed++; if (g.tripped) tripped++; }
    for (const b of t._beams) if (b.visible) beams++;
    return {
      mag: wp.states.get(id).mag,
      thrown: t.stats.thrown, det: t.stats.detonated, live: t.stats.live,
      armed, tripped, beams,
    };
  }, id);

  console.log(
    `  ${id.padEnd(10)} kind=${String(before.kind).padEnd(6)} fuse ${before.fuse}s   ` +
      `pouch ${before.mag} -> ${after.mag}   thrown ${after.thrown - before.thrown}   ` +
      `detonated ${after.det - before.det}   live ${after.live}` +
      (id === 'mine' ? `   armed ${after.armed} beams ${after.beams} tripped ${after.tripped}` : '') +
      (after.thrown === before.thrown ? '   <-- NOTHING LEFT THE HAND' : '')
  );
}

/* The mine's whole point: a body in the beam trips it and it warns. Drive that
 * by throwing one and then walking the camera into its beam. */
console.log('\n=== THE MINE TRIPS ON A BODY AND WARNS ===');
const mine = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const wp = e.ctx.peek('weapons');
  const heard = [];
  const audio = e.ctx.peek('audio');
  if (audio?.play) {
    const orig = audio.play.bind(audio);
    audio.play = (kind, pos, o) => { heard.push(kind); return orig(kind, pos, o); };
  }
  const events = [];
  e.ctx.events.on('weapon:mine', (p) => events.push(p.phase));
  wp.resetAmmo();
  wp.setWeaponImmediate('mine');
  wp.startCook('over');
  await new Promise((r) => { let i = 0; const t = () => (++i >= 20 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  wp.releaseThrow();
  await new Promise((r) => { let i = 0; const t = () => (++i >= 150 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  const g = wp.thrown.pool.find((p) => p.live && p.kind === 'mine');
  if (!g) return { ok: false, why: 'no live mine' };
  const armed = g.armed;
  // Stand the PLAYER in the beam, 2 m down it. Moving the camera is useless:
  // the player system rewrites it every frame from his own feet.
  const pl = e.ctx.peek('player');
  pl.teleport({ x: g.pos.x + g.dir.x * 2, y: g.pos.y + 1.5, z: g.pos.z + g.dir.z * 2 }, 0);
  const heardBefore = heard.length;
  await new Promise((r) => { let i = 0; const t = () => (++i >= 12 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  const tripped = g.tripped;
  const trig = +g.trig.toFixed(2);
  await new Promise((r) => { let i = 0; const t = () => (++i >= 120 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  return {
    ok: true, armed, tripped, trigAtTrip: trig,
    voices: heard.slice(heardBefore),
    events,
    detonated: wp.thrown.stats.detonated,
    stillLive: wp.thrown.pool.filter((p) => p.live).length,
  };
});
console.log('  ' + JSON.stringify(mine));

console.log(`\npageerrors: ${errs.length}`);
for (const e of errs.slice(0, 8)) console.log('  ' + e);
await browser.close();
process.exit(errs.length ? 1 : 0);
