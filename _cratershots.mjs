/**
 * WHAT BOMBED GROUND LOOKS LIKE, AND FOR HOW LONG.
 *
 *   node _cratershots.mjs [--port=4637] [--out=shots/craters]
 *
 * The REAL line bombardment — `__BOMBER__.fire()`, the run whose line was
 * proved open at boot — photographed from 30, 100 and 200 m at four ages: the
 * sortie landing, and the same ground 10, 30 and 60 s later. Then the same
 * again beside one of the plain's burning wrecks, because grey smoke reads
 * differently with a key light under it than on a dark plain with none.
 *
 * TWO TRAPS THIS PROBE EXISTS TO AVOID, both of which have already caught
 * somebody on this project:
 *
 *  · `Ambience._scan` runs on a 2 s timer and the plain's six permanent banks
 *    do not exist until ~11.5 s after `__READY__`. Nothing here starts before
 *    then, so the craters are always measured against a ring already paying
 *    1 346 sprites for scenery.
 *  · WALL TIME IS NOT MATCH TIME. `Engine.step` clamps `rawDt` to 0.1 s, so a
 *    headless box rendering at 1.5 fps advances the simulation at a SEVENTH of
 *    real time — a screenshot taken sixty wall-seconds after the bombs fell was
 *    of nine-second-old craters. Every wait here is on the field's own oldest
 *    `age`, and the age it actually got is burnt into the frame.
 *
 * Every frame carries its pose, the crater age and the field's live cost in the
 * corner, because several agents on this project have photographed a frame they
 * thought was somewhere else.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('='); return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = `http://127.0.0.1:${args.port ?? '4637'}/?map=plains&capture=1`;
const OUT = args.out ?? 'shots/craters';
const SCALE = Number(args.scale ?? 5);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1152, height: 648 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log(`level=${await page.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id)}`);
await page.waitForTimeout(14000);

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const ui = e.ctx.peek('ui');
  ui?.setHudVisible?.(false);
  if (e.ctx.viewScene) e.ctx.viewScene.visible = false;   // no weapon in frame
  const m = e.ctx.peek('match');
  if (m) { m.roundClock = 1e6; m._checkWinConditions = () => {}; }
  const pl = e.ctx.peek('player'); if (pl) pl.applyDamage = () => {};
  const d = document.createElement('div');
  d.id = 'craterhud';
  d.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;font:11px/1.4 monospace;' +
    'color:#fff;background:rgba(0,0,0,.66);padding:5px 9px;white-space:pre;pointer-events:none';
  document.body.appendChild(d);
  window.__HUD__ = (t) => { d.textContent = t; };
});

const banks = await page.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('world');
  const out = [];
  w.root.traverse((o) => { if (o.name === 'nf-smoke') out.push([+o.position.x.toFixed(1), +o.position.z.toFixed(1)]); });
  return out;
});
console.log(`nf-smoke banks: ${banks.map((p) => `(${p[0]},${p[1]})`).join(' ')}`);

/** The bomber's runs, with the line each stick walks and its distance to fire. */
const runs = await page.evaluate((banks) => {
  const bm = window.__BOMBER__;
  if (!bm) return [];
  return (bm.runs ?? []).map((r, i) => {
    const a = r.bombs[0].impact, z = r.bombs[r.bombs.length - 1].impact;
    const mx = (a.x + z.x) / 2, mz = (a.z + z.z) / 2;
    let d = 1e9;
    for (const p of banks) d = Math.min(d, Math.hypot(mx - p[0], mz - p[1]));
    return { i, id: r.id, n: r.bombs.length, a: [+a.x.toFixed(1), +a.z.toFixed(1)],
      b: [+z.x.toFixed(1), +z.z.toFixed(1)], mid: [+mx.toFixed(1), +mz.toFixed(1)], fire: +d.toFixed(0) };
  });
}, banks);
for (const r of runs) console.log(`  run ${r.i} ${r.id}: ${r.n} bombs ${r.a} -> ${r.b}, mid ${r.mid}, nearest fire ${r.fire} m`);
const pick = runs.slice().sort((x, y) => y.fire - x.fire)[0];
if (!pick) { console.log('NO BOMBER RUNS'); await b.close(); process.exit(1); }
console.log(`FAR run: ${pick.id} mid ${pick.mid} — nearest fire ${pick.fire} m`);

const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
const scale = (v) => page.evaluate((s) => { window.__ENGINE__.ctx.time.scale = s; }, v);

/** Stand `dist` m off the middle of the line, square to it, at a standing eye. */
async function pose(cx, cz, dist, bearing, look = 6) {
  return page.evaluate(([cx, cz, dist, bearing, look]) => {
    const e = window.__ENGINE__, ph = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    const x = cx + Math.cos(bearing) * dist, z = cz + Math.sin(bearing) * dist;
    const g = ph.groundHeight(x, z, 400);
    const cy = (Number.isFinite(g) ? g : 0) + 1.62;
    const gt = ph.groundHeight(cx, cz, 400);
    e.camera.position.set(x, cy, z);
    e.camera.lookAt(new V3(cx, (Number.isFinite(gt) ? gt : 0) + look, cz));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    return { x: +x.toFixed(1), y: +cy.toFixed(2), z: +z.toFixed(1),
      yaw: +(e.camera.rotation.y * 180 / Math.PI).toFixed(1), pitch: +(e.camera.rotation.x * 180 / Math.PI).toFixed(1) };
  }, [cx, cz, dist, bearing, look]);
}

const fireRun = (i) => page.evaluate((k) => {
  const bm = window.__BOMBER__;
  const r = bm.runs[k];
  r.flown = false; r.active = false;
  return bm.fire(k);
}, i);

/** Ten bombs through the real `explosion` event, for the beside-a-fire case. */
const stick = (cx, cz) => page.evaluate(([cx, cz]) => {
  const e = window.__ENGINE__, ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  let i = 0;
  const drop = () => {
    if (i >= 10) return;
    const t = (i - 4.5) * 14; i++;
    const x = cx + t, z = cz + (i % 2 ? 3 : -3);
    const h = ph.groundHeight(x, z, 400);
    e.ctx.events.emit('explosion', {
      position: new V3(x, (Number.isFinite(h) ? h : 0) + 1.7, z), radius: 15, damage: 0, source: 'bomber',
    });
    setTimeout(drop, 380);
  };
  drop();
}, [cx, cz]);

const oldest = () => page.evaluate(() => {
  const cf = window.__ENGINE__.ctx.peek('fx').craters;
  let a = 0; for (const c of cf.craters) if (c.active && c.age > a) a = c.age;
  return { age: a, live: cf.stats.live };
});

/** Wait until the field's oldest crater reaches `t` MATCH seconds. */
async function ageTo(t, capWallMs = 420000) {
  const t0 = Date.now();
  for (;;) {
    const o = await oldest();
    if (o.age >= t || o.live === 0) return o;
    if (Date.now() - t0 > capWallMs) { console.log(`    ! gave up waiting for age ${t}s (got ${o.age.toFixed(1)}s)`); return o; }
    await page.waitForTimeout(400);
  }
}

async function shoot(name, p, label) {
  await scale(1);
  await frames(8);
  const s = await page.evaluate(([p, label]) => {
    const fx = window.__ENGINE__.ctx.peek('fx');
    const cf = fx.craters;
    let age = 0; for (const c of cf.craters) if (c.active && c.age > age) age = c.age;
    window.__HUD__(`${label}\npose  x ${p.x}  y ${p.y}  z ${p.z}   yaw ${p.yaw}  pitch ${p.pitch}\n` +
      `craters ${cf.stats.live}   oldest ${age.toFixed(1)} s   field ${cf.stats.sprites}/${cf.cap} sprites ` +
      `= ${(cf.stats.sprites / fx.lit.capacity * 100).toFixed(1)} % of fx.lit (${fx.lit.capacity})   split x${cf.stats.scale.toFixed(2)}`);
    return { age: +age.toFixed(1), live: cf.stats.live, sprites: cf.stats.sprites };
  }, [p, label]);
  await frames(3);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  · ${name}.png  age ${s.age}s  craters ${s.live}  ${s.sprites} sprites`);
  await scale(SCALE);
}

async function series(tag, mid, dist, bearing, start) {
  const p = await pose(mid[0], mid[1], dist, bearing, dist < 60 ? 6 : 12);
  await scale(SCALE);
  await page.waitForTimeout(1500);
  await start();
  // the stick takes a few match-seconds to walk: shoot while it is still landing
  await ageTo(2.5);
  await shoot(`${tag}-${dist}m-landing`, p, `${tag} · ${dist} m · SORTIE LANDING`);
  for (const t of [10, 30, 60]) {
    await ageTo(t);
    await shoot(`${tag}-${dist}m-t${t}`, p, `${tag} · ${dist} m · +${t} s`);
  }
  await page.evaluate(() => window.__ENGINE__.ctx.peek('fx').craters.clear());
  await page.waitForTimeout(1200);
}

// bearing square to the run line, so the whole stick is across the frame
const dir = Math.atan2(pick.b[1] - pick.a[1], pick.b[0] - pick.a[0]) + Math.PI / 2;
for (const d of [30, 100, 200]) await series('far', pick.mid, d, dir, () => fireRun(pick.i));

if (banks.length) {
  const site = [banks[0][0] + 26, banks[0][1] + 12];
  console.log(`fire site ${site} — 28 m off the bank at (${banks[0]})`);
  const toBank = Math.atan2(banks[0][1] - site[1], banks[0][0] - site[0]);
  for (const d of [30, 100]) await series('fire', site, d, toBank + Math.PI * 0.62, () => stick(site[0], site[1]));
}

await scale(1);
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs[0]}` : '0 pageerrors');
await b.close();
