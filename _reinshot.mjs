/**
 * PHOTOGRAPH A DROP THE MATCH ITSELF CALLED. No forced call: run the match at
 * speed until `_updateReinforcements` fires on its own, then drop to real time,
 * park a camera on the zone's ground on the far side from the approach, and
 * shoot the helicopter, the canopies in the air, and the men on the ground.
 *
 *   node _reinshot.mjs [url] [seed]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4386/';
const SEED = process.argv[3] ?? '11';
const OUT = 'shots/reinaudit';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (/REINFORCE/i.test(t)) logs.push(t);
});
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const frames = (n) =>
  page.evaluate(
    (k) =>
      new Promise((d) => {
        let i = 0;
        const t = () => (++i >= k ? d() : requestAnimationFrame(t));
        requestAnimationFrame(t);
      }),
    n
  );

/** Run forward until the poll calls one of its own accord. */
const call = await page.evaluate(
  () =>
    new Promise((done) => {
      const e = window.__ENGINE__;
      const m = e.ctx.peek('match');
      e.input.frozen = true;
      e.input.enabled = false;
      e.ctx.peek('player')?.setControlEnabled?.(false);
      e.time.scale = 10;
      const R = m.reinforce;
      const t = () => {
        if (m.phase === 'over' || m.roundClock <= 0) return done({ ok: false });
        if (R.run) {
          e.time.scale = 1;
          const run = R.run;
          window.__RUN__ = run;
          return done({
            ok: true,
            t: +(600 - m.roundClock).toFixed(1),
            team: run.team,
            label: run.label,
            score: m.score.slice(),
            centre: [+run.centre.x.toFixed(1), +run.centre.y.toFixed(1), +run.centre.z.toFixed(1)],
            dir: [+run.dir.x.toFixed(2), +run.dir.z.toFixed(2)],
          });
        }
        requestAnimationFrame(t);
      };
      t();
    })
);
console.log('natural call:', JSON.stringify(call));
if (!call.ok) {
  console.log('no drop this seed');
  await b.close();
  process.exit(0);
}

/**
 * ABOVE THE ROOFLINE, BACKED OFF ALONG THE RUN. Every eye-level camera in this
 * repo's history ended up against a courtyard wall — the zones ARE courtyards.
 * 18 m up and 46 m past the zone on the flight bearing sees the aircraft come
 * at the lens and the whole descent with nothing in front of it.
 */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.ctx.peek('ui')?.debugState?.('clean');
  const run = window.__RUN__;
  const c = run.centre;
  window.__CAM__ = { x: c.x + run.dir.x * 46, y: c.y + 18, z: c.z + run.dir.z * 46 };
  window.__CAMLOW__ = { x: c.x + run.dir.x * 21, y: c.y + 6.5, z: c.z + run.dir.z * 21 };
});

const place = (mode) =>
  page.evaluate((m2) => {
    const e = window.__ENGINE__;
    const V3 = e.camera.position.constructor;
    const r = e.ctx.peek('match').reinforce;
    const run = window.__RUN__;
    const c = run.centre;
    let tx = c.x, ty = c.y + 8, tz = c.z;
    if (m2 === 'heli' && r.run) {
      const el = r.heli.matrix.elements;
      tx = el[12]; ty = el[13]; tz = el[14];
    } else if (m2 === 'air') {
      let n = 0, sx = 0, sy = 0, sz = 0;
      for (const t of r.troops)
        if (t.state === 'fall' || t.state === 'canopy') { n++; sx += t.at.x; sy += t.at.y; sz += t.at.z; }
      if (n) { tx = sx / n; ty = sy / n; tz = sz / n; }
    } else if (m2 === 'ground') {
      ty = c.y + 1.2;
    }
    const cam = m2 === 'ground' ? window.__CAMLOW__ : window.__CAM__;
    e.camera.position.set(cam.x, cam.y, cam.z);
    e.camera.lookAt(new V3(tx, ty, tz));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    const aloft = r.troops.filter((t) => t.state === 'fall' || t.state === 'canopy').length;
    return { busy: !!r.run, out: r.run?.out ?? 0, landed: r.run?.landed ?? 0, aloft, heli: r.heli.visible };
  }, mode);

let shotHeli = false, shotAir = false, shotMid = false;
for (let i = 1; i <= 200; i++) {
  const s0 = await place(shotAir ? 'air' : 'heli');
  await frames(5);
  if (!shotHeli && s0.busy && s0.out === 0 && s0.heli) {
    await place('heli');
    await frames(2);
    await page.screenshot({ path: `${OUT}/01-helicopter.png` });
    shotHeli = true;
    console.log(`  helicopter shot at out=${s0.out}`);
  }
  if (!shotAir && s0.aloft >= 6) {
    await place('air');
    await frames(2);
    await page.screenshot({ path: `${OUT}/02-canopies.png` });
    shotAir = true;
    console.log(`  canopy shot with ${s0.aloft} in the air`);
  }
  if (!shotMid && s0.landed >= 1 && s0.aloft >= 4) {
    await place('air');
    await frames(2);
    await page.screenshot({ path: `${OUT}/03-canopies-and-first-men-down.png` });
    shotMid = true;
  }
  console.log(`  t${i} busy=${s0.busy} out=${s0.out} landed=${s0.landed} aloft=${s0.aloft}`);
  if (!s0.busy && i > 3) break;
}

await place('ground');
await frames(4);
await page.screenshot({ path: `${OUT}/04-men-on-ground.png` });
await frames(120);
await place('ground');
await page.screenshot({ path: `${OUT}/05-men-moving-off.png` });

const res = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const rein = m.roster.filter((r) => r.reinforcement);
  return {
    stats: JSON.parse(JSON.stringify(m.reinforceStats)),
    reinforcements: rein.length,
    alive: rein.filter((r) => r.alive).length,
    allNoRespawn: rein.every((r) => r.noRespawn === true),
    names: rein.map((r) => r.name),
  };
});
console.log(logs.join('\n'));
console.log(JSON.stringify(res));
console.log(errs.length ? `[pageerror] ${errs.slice(0, 4).join(' | ')}` : '[pageerror] none');
await b.close();
