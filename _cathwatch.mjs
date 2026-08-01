/**
 * THE CATHEDRAL EVENT, WATCHED IN A REAL MATCH — timeline, chunk sweep, photos.
 *
 *   node _cathwatch.mjs --url=http://127.0.0.1:4382/ [--seed=N] [--out=shots/cath]
 *                       [--shots=0] [--settle=60]
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AND `_floatcheck --fire=cath` DOES NOT REPLACE IT
 * ────────────────────────────────────────────────────────────────────────────
 * `_floatcheck`'s `--fire` path forces the beats by hand — it sets
 * `_cathedralCalled`, calls the salvo and `_razeCathedral()` on the SAME frame —
 * so it never plays the schedule the player plays, and its drawn-mass pass reads
 * `mesh.userData.settled`, which is what a chunk is SUPPOSED to end up as rather
 * than what is on the screen. Both were reported OK while the player was looking
 * at rubble in the sky.
 *
 * So this one:
 *   1. lets the match reach `live` on its own and then drives progress until
 *      `_updateCathedralEvent` starts ITSELF — no forced flags;
 *   2. records every beat, every `match:airstrike` phase and every raze with a
 *      wall-clock stamp, so "the shell went down before the event" is a fact
 *      with a number on it rather than an impression;
 *   3. sweeps the LIVE `instanceMatrix` of every struck site — the pose actually
 *      being drawn — at three moments: in flight, at the settle, and a minute
 *      later; and
 *   4. photographs the sky over the ruin from eight bearings AFTER the dust.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4382/';
const OUT = args.out ?? 'shots/cathwatch';
const SHOTS = args.shots !== '0' && args.shots !== false;
const LATE = Number(args.settle ?? 60);
/** Metres of open air under a DRAWN chunk before it is called floating. */
const CAIR = Number(args.cair ?? 1.5);

const q = ['capture=1'];
if (args.seed) q.push(`seed=${args.seed}`);
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
const logs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => {
  const t = m.text();
  if (/\[match\]|\[airstrike\]|cathedral|CATHEDRAL|SITE D/i.test(t)) logs.push(t.slice(0, 220));
});
await page.goto(`${URL}?${q.join('&')}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const levelSeed = await page.evaluate(() => window.__ENGINE__?.levelSeed ?? null);

/* ---- instrument: record every beat and every phase, in match time -------- */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('world');
  const T = () => +e.ctx.time.elapsed.toFixed(2);
  const rec = (window.__CW__ = { events: [], razeAt: null, beats: [] });

  const beat = m._cathBeat.bind(m);
  m._cathBeat = (kind) => {
    rec.beats.push({ t: T(), kind, p: +m._matchProgress().toFixed(3) });
    return beat(kind);
  };
  const begin = m._beginCathedralEvent.bind(m);
  m._beginCathedralEvent = (t, p) => {
    rec.events.push({ t: T(), what: 'EVENT BEGINS', p: +p.toFixed(3) });
    return begin(t, p);
  };
  const setr = m._setCathedralRazed.bind(m);
  m._setCathedralRazed = (down) => {
    const r = setr(down);
    if (down && r) {
      rec.razeAt = T();
      rec.events.push({ t: T(), what: 'SHELL RAZED', stack: new Error().stack.split('\n').slice(2, 5).join(' | ') });
    }
    return r;
  };
  // The one thing the player actually sees go away: the shell being drawn.
  const k = w.cathedral;
  const sv = k.setVisual.bind(k);
  k.setVisual = (down) => {
    rec.events.push({ t: T(), what: `shell setVisual(${down})` });
    return sv(down);
  };
  e.ctx.events.on('match:airstrike', (ev) => {
    if (!/CATH/.test(ev.site)) return;
    rec.events.push({ t: T(), what: `${ev.site} ${ev.phase}` });
  });
});

/* ---- let the match run itself to the event ------------------------------- */
await page.evaluate(() => (window.__ENGINE__.time.scale = 8));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
// Progress is max(elapsed/matchTime, leader/scoreTarget); at 8x the clock alone
// reaches `cathedralOpenProgress` in well under a minute of wall time, and the
// event then starts on its own schedule with nothing forced.
await page.waitForFunction("window.__ENGINE__.ctx.peek('match')._cathedralCalled===true", null, { timeout: 300000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));

const sweep = () =>
  page.evaluate(({ CAIR }) => {
    const e = window.__ENGINE__;
    const ph = e.ctx.peek('physics');
    const sites = e.ctx.peek('match')?.airstrike?.sites ?? [];
    const MASK = ph.MASK.WORLD;
    const M4 = e.camera.matrixWorld.constructor;
    const V3 = e.camera.position.constructor;
    const mat = new M4();
    const pos = new V3();
    const sc = new V3();
    const q = e.camera.quaternion.clone();
    const rows = [];
    for (const s of sites) {
      if (!s.struck) continue;
      let n = 0;
      let worst = 0;
      let at = null;
      let drawn = 0;
      for (const mesh of s.meshes) {
        if (!mesh.visible) continue;
        // THE POSE ON THE SCREEN, not `userData.settled`.
        const arr = mesh.instanceMatrix.array;
        for (let i = 0; i < arr.length; i += 16) {
          mat.fromArray(arr, i);
          mat.decompose(pos, q, sc);
          drawn++;
          const under = pos.y - Math.max(sc.x, sc.y, sc.z) * 0.5;
          if (under < 0.6) continue;
          const h = ph.raycast(pos.x, pos.y + 0.15, pos.z, 0, -1, 0, 90, MASK);
          const gap = h.hit ? under - h.point.y : under;
          if (gap <= CAIR) continue;
          n++;
          if (gap > worst) {
            worst = +gap.toFixed(2);
            at = [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)];
          }
        }
      }
      if (n) rows.push({ id: s.id, kind: s.kind, baked: s.baked, drawn, n, worst, at });
    }
    return {
      t: +e.ctx.time.elapsed.toFixed(1),
      razed: e.ctx.peek('world').cathedral?.razed,
      struck: sites.filter((s) => s.struck).map((s) => `${s.id}${s.baked ? '' : '(unsettled)'}`).join(' '),
      rows,
    };
  }, { CAIR });

const marks = [];
marks.push({ label: 'IN FLIGHT (+3s from the event beginning)', ...(await (async () => { await sleep(3000); return sweep(); })()) });
await sleep(14000);
marks.push({ label: 'AT THE SETTLE (+17s)', ...(await sweep()) });
await sleep(LATE * 1000);
marks.push({ label: `A MINUTE LATER (+${17 + LATE}s)`, ...(await sweep()) });

const rec = await page.evaluate(() => window.__CW__);

/* ---- photograph the sky over the ruin ------------------------------------ */
if (SHOTS) {
  await page.evaluate(() => {
    const e = window.__ENGINE__;
    e.input.frozen = true;
    e.input.enabled = false;
    e.ctx.peek('player')?.setControlEnabled?.(false);
    e.ctx.peek('ui')?.debugState?.('clean');
  });
  const centre = await page.evaluate(() => {
    const w = window.__ENGINE__.ctx.peek('world');
    const k = w.cathedral;
    const v = w.interiorVolumes.find((x) => x.building === k.id);
    return { x: v.cx, z: v.cz, y: k.floorY ?? 0 };
  });
  const poses = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    poses.push({
      id: `ring${i}`,
      from: [centre.x + Math.cos(a) * 62, centre.y + 20, centre.z + Math.sin(a) * 62],
      to: [centre.x, centre.y + 9, centre.z],
    });
  }
  poses.push({ id: 'over', from: [centre.x, centre.y + 78, centre.z + 1], to: [centre.x, centre.y, centre.z] });
  poses.push({ id: 'inside_up', from: [centre.x, centre.y + 1.7, centre.z], to: [centre.x + 18, centre.y + 16, centre.z] });
  poses.push({ id: 'low_n', from: [centre.x, centre.y + 2.2, centre.z - 46], to: [centre.x, centre.y + 11, centre.z] });
  poses.push({ id: 'low_e', from: [centre.x + 46, centre.y + 2.2, centre.z], to: [centre.x, centre.y + 11, centre.z] });
  for (const p of poses) {
    await page.evaluate((pose) => {
      const e = window.__ENGINE__;
      const V3 = e.camera.position.constructor;
      e.camera.position.set(pose.from[0], pose.from[1], pose.from[2]);
      e.camera.lookAt(new V3(pose.to[0], pose.to[1], pose.to[2]));
      e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    }, p);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${p.id}.png` });
  }
  console.log(`  photographs: ${OUT}/ring0..7, over, inside_up, low_n, low_e`);
}

await browser.close();

console.log(`\nCATHWATCH  levelSeed=${levelSeed}`);
console.log('\n─── the beats, as the schedule played them ───');
for (const ev of rec.events) console.log(`  t=${String(ev.t).padStart(7)}  ${ev.what}${ev.stack ? `\n        ${ev.stack}` : ''}`);
console.log('\n─── _cathBeat ───');
for (const b of rec.beats) console.log(`  t=${String(b.t).padStart(7)}  p=${b.p}  ${b.kind}`);
for (const m of marks) {
  console.log(`\n─── ${m.label} — t=${m.t}, razed=${m.razed} ───`);
  console.log(`  struck: ${m.struck || 'none'}`);
  if (!m.rows.length) console.log('  no drawn chunk with more than 1.5 m of air under it');
  for (const r of m.rows) {
    console.log(
      `  ${r.id.padEnd(10)} ${r.kind.padEnd(6)} baked=${String(r.baked).padEnd(5)} drawn ${String(r.drawn).padStart(5)}` +
        ` · ${String(r.n).padStart(5)} floating · worst ${r.worst} m at ${JSON.stringify(r.at)}`
    );
  }
}
console.log('\n─── console ───');
for (const l of logs) console.log(`  ${l}`);
console.log('\n  pageErrors', errs.length ? errs.slice(0, 5) : 'none');
