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
const OUT = `shots/reinaudit/seed${SEED}`;
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
  /**
   * THREE CAMERAS, BECAUSE THREE DIFFERENT THINGS HAVE TO BE LEGIBLE.
   *
   *  AIR — beside the run line rather than on it, at the aircraft's own
   *  altitude: from behind the target the helicopter is a dot for eight seconds
   *  and then it is overhead, and neither frame shows an aeroplane. Abeam at
   *  32 m it crosses the lens at the size it really is.
   *  WIDE — the same bearing, backed off and higher, so the whole stick of
   *  canopies is in one frame instead of the two nearest.
   *  GROUND — 15 m off the zone at head height, which is what a man standing on
   *  the point would see arrive.
   */
  const px = run.dir.z, pz = -run.dir.x;
  window.__CAMAIR__ = { x: c.x + px * 32 - run.dir.x * 10, y: c.y + 44, z: c.z + pz * 32 - run.dir.z * 10 };
  window.__CAMWIDE__ = { x: c.x + px * 62 - run.dir.x * 30, y: c.y + 34, z: c.z + pz * 62 - run.dir.z * 30 };
  window.__CAMLOW__ = { x: c.x + px * 15, y: c.y + 2.6, z: c.z + pz * 15 };
});

const place = (mode) =>
  page.evaluate((m2) => {
    const e = window.__ENGINE__;
    const V3 = e.camera.position.constructor;
    const r = e.ctx.peek('match').reinforce;
    const run = window.__RUN__;
    const c = run.centre;
    let tx = c.x, ty = c.y + 8, tz = c.z;
    const el = r.heli.matrix.elements;
    if ((m2 === 'heli' || m2 === 'wide') && r.run) {
      tx = el[12]; ty = el[13]; tz = el[14];
    }
    if (m2 === 'air' || (m2 === 'wide' && r.run?.out > 0)) {
      let n = 0, sx = 0, sy = 0, sz = 0;
      for (const t of r.troops)
        if (t.state === 'fall' || t.state === 'canopy') { n++; sx += t.at.x; sy += t.at.y; sz += t.at.z; }
      if (n) { tx = sx / n; ty = sy / n; tz = sz / n; }
    } else if (m2 === 'ground') {
      /**
       * AT THE MEN, NOT AT THE ZONE. They land on the zone's `stand` ring, which
       * is up to eight metres off the centre and in a rubble field is eight
       * metres of rubble — aiming at the middle of the point photographed the
       * masonry in front of them. The centroid of the ten is where they are.
       */
      const m = e.ctx.peek('match');
      let n = 0, sx = 0, sy = 0, sz = 0;
      for (const rec of m.roster)
        if (rec.reinforcement && rec.alive && rec.actor?.position) {
          n++; sx += rec.actor.position.x; sy += rec.actor.position.y; sz += rec.actor.position.z;
        }
      if (n) {
        tx = sx / n; ty = sy / n + 1.0; tz = sz / n;
        /**
         * ABOVE THE DEBRIS, NOT IN IT. At head height this camera ended up
         * buried inside the cathedral rubble field — ZONE D is a pile of
         * concrete and 1.6 m off the ground there is inside a slab. Three
         * metres up clears the wreckage and still reads as a man's eye rather
         * than a map view.
         */
        const px2 = run.dir.z, pz2 = -run.dir.x;
        window.__CAMLOW__ = { x: tx + px2 * 16, y: ty + 3.4, z: tz + pz2 * 16 };
      } else ty = c.y + 1.1;
    }
    const cam =
      m2 === 'ground' ? window.__CAMLOW__ : m2 === 'heli' ? window.__CAMAIR__ : window.__CAMWIDE__;
    e.camera.position.set(cam.x, cam.y, cam.z);
    e.camera.lookAt(new V3(tx, ty, tz));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    const aloft = r.troops.filter((t) => t.state === 'fall' || t.state === 'canopy').length;
    return {
      busy: !!r.run,
      out: r.run?.out ?? 0,
      landed: r.run?.landed ?? 0,
      aloft,
      heli: r.heli.visible,
      /** Metres from the air camera to the airframe — when to press the shutter. */
      heliDist: +Math.hypot(el[12] - window.__CAMAIR__.x, el[14] - window.__CAMAIR__.z).toFixed(1),
    };
  }, mode);

let shotHeli = false, shotAir = false, shotMid = false;
for (let i = 1; i <= 200; i++) {
  const s0 = await place(shotAir ? 'wide' : 'heli');
  await frames(4);
  if (!shotHeli && s0.busy && s0.heliDist < 42) {
    await place('heli');
    await frames(2);
    await page.screenshot({ path: `${OUT}/01-helicopter.png` });
    shotHeli = true;
    console.log(`  helicopter shot at ${s0.heliDist}m, out=${s0.out}`);
  }
  if (!shotAir && s0.aloft >= 6) {
    await place('wide');
    await frames(2);
    await page.screenshot({ path: `${OUT}/02-canopies.png` });
    shotAir = true;
    console.log(`  canopy shot with ${s0.aloft} in the air`);
  }
  if (!shotMid && s0.landed >= 2 && s0.aloft >= 3) {
    await place('wide');
    await frames(2);
    await page.screenshot({ path: `${OUT}/03-canopies-and-first-men-down.png` });
    shotMid = true;
  }
  if (s0.landed >= 9 && !s0.aloft) {
    await place('ground');
    await frames(2);
    await page.screenshot({ path: `${OUT}/04-men-on-ground.png` });
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
