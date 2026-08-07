/**
 * ════════════════════════════════════════════════════════════════════════════
 * NACHTFELD'S THREE ACTS, PHOTOGRAPHED — before, during and after each
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _nfshots.mjs [--url=…] [--out=shots/nachtfeld] [--act=all|tower|fort|crash]
 *
 * 「大聖堂崩壊イベントは過激にそして激しく破壊し、大イベントにしてください」 is a
 * VISUAL requirement and no number tests it. Every other gate on this work
 * measures something — fire times, nav components, floating rubble — and not one
 * of them can tell a building that fell over from a building that was deleted.
 * The cathedral shipped as a hard cut with every number green.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IT DOES NOT FORCE THE ACTS AND IT DOES NOT MOVE THE MATCH ON
 * ────────────────────────────────────────────────────────────────────────────
 * The camera is placed and the shutter is pressed; everything else is the
 * schedule doing what it does. The act is watched for through `_nf.act`, so the
 * "during" frames land on the real beats rather than on a guess — and the
 * `--act` filter is about which CAMERA to use, not about which acts run.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AND `?map=plains&capture=1` RATHER THAN `?capture=1&map=plains`
 * ────────────────────────────────────────────────────────────────────────────
 * Several probes here carried a destructured `split('=')` that truncated
 * `--url=…/?map=plains` to `…/?map`. This one splits on the first `=` only AND
 * checks `world.level.id` at the far end, because a screenshot of the wrong map
 * is the one kind of evidence that looks completely convincing.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4578/?map=plains&capture=1';
const OUT = args.out ?? 'shots/nachtfeld';
const SCALE = Number(args.scale ?? 6);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.stack ?? e.message)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}  out=${OUT}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  /**
   * THE CAMERA MAY NOT BE KILLED. The first run of this probe lost Act II
   * entirely: a tank shot the camera-man between the "before" frame and the
   * "during" ones, `spectate` took the camera, and the three photographs of the
   * fortress are of somebody else's death 150 m away under a red screen filter.
   * A screenshot gate that can be shot is not a gate.
   *
   * Probe-side only — nothing in `src/player` is touched, `applyDamage` is just
   * stubbed on this one instance for the length of the run.
   */
  const pl = e.ctx.peek('player');
  if (pl) {
    pl.applyDamage = () => {};
    pl._nfHeal = setInterval(() => pl.heal?.(100), 250);
  }
});
const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

/**
 * Stand the camera at a world point and look at another, feet on whatever is
 * under it. `eye` is metres over the ground there — a man is 1.62, and a number
 * over that is a vantage rather than a lie about where a player can stand.
 */
const place = (from, at, eye = 1.62) => page.evaluate(([f, a, eye]) => {
  const e = window.__ENGINE__, phys = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const h = phys.raycast(f[0], 300, f[1], 0, -1, 0, 400, phys.MASK.WORLD);
  const y = (h.hit ? h.point.y : 0) + eye;
  e.camera.position.set(f[0], y, f[1]);
  e.camera.lookAt(new V3(a[0], a[1], a[2]));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
  return +y.toFixed(2);
}, [from, at, eye]);

const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log(`    · ${name}.png`); };

/* ── the three cameras. Each looks at the thing its act is about. ─────────── */
const CAM = {
  'NF-TOWER': { from: [-46, -70], at: [0, 26, -32], eye: 1.62 },
  'NF-FORT':  { from: [46, 96],   at: [0, 8, 48],   eye: 1.62 },
  'NF-CRASH': { from: [-2, 6],    at: [-70, 26, 40], eye: 2.4 },
};

await page.evaluate((s) => (window.__ENGINE__.time.scale = s), SCALE);
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  // The win check only; the SCHEDULE is left completely alone.
  m._checkWinConditions = () => {};
  m.airstrike.enabled = true;
});

const state = () => page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const w = window.__ENGINE__.ctx.peek('world');
  return {
    id: m._nf?.act?.spec?.id ?? null,
    t: m._nf?.t ?? -1,
    i: m._nf?.i ?? 0,
    clock: +(1200 - m.roundClock).toFixed(0),
    down: (w.demolitions ?? []).filter((d) => d.down).map((d) => d.id).join(','),
    crash: { t: m.crash?._t ?? -1, burn: +(m.crash?._burn ?? 0).toFixed(0), struck: m.crash?.struck ?? false },
  };
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const id of ['NF-TOWER', 'NF-FORT', 'NF-CRASH']) {
  const cam = CAM[id];
  console.log(`\n  waiting for ${id} …`);
  // BEFORE: parked on the camera, ahead of the act, at real speed so the
  // photograph is of a settled frame rather than a time-warped one.
  let seen = false;
  for (let k = 0; k < 4000; k++) {
    const s = await state();
    if (s.id === id) { seen = true; break; }
    if (k % 40 === 0) {
      await place(cam.from, cam.at, cam.eye);
      if (k === 0 || !(await page.evaluate(() => window.__SHOT_BEFORE__))) { /* noop */ }
    }
    await sleep(120);
  }
  if (!seen) { console.log(`  ! ${id} never opened`); continue; }
  const s0 = await state();
  console.log(`  ${id} open at t=${s0.clock}s`);
  await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
  await place(cam.from, cam.at, cam.eye);
  await frames(6);
  await shot(`${id}-1-before`);

  /* DURING — three frames spread over the act, on its own clock. */
  const marks = id === 'NF-CRASH' ? [6, 14, 19] : id === 'NF-TOWER' ? [8, 11, 14] : [10, 13, 17];
  let n = 0;
  for (const mark of marks) {
    await page.waitForFunction(
      (m) => (window.__ENGINE__.ctx.peek('match')._nf?.t ?? 1e9) >= m || (window.__ENGINE__.ctx.peek('match')._nf?.t ?? -1) < 0,
      mark, { timeout: 180000 }
    );
    await place(cam.from, cam.at, cam.eye);
    await frames(2);
    await shot(`${id}-2-during-${++n}`);
  }

  /* AFTER — the act spent, the map in the state it leaves. */
  await page.waitForFunction((i) => (window.__ENGINE__.ctx.peek('match')._nf?.i ?? 0) > i, s0.i, { timeout: 180000 });
  await frames(30);
  await place(cam.from, cam.at, cam.eye);
  await frames(10);
  await shot(`${id}-3-after`);
  const s1 = await state();
  console.log(`  ${id} spent at t=${s1.clock}s — down=[${s1.down}] crash=${JSON.stringify(s1.crash)}`);
  await page.evaluate((s) => (window.__ENGINE__.time.scale = s), SCALE);
}

/* ── and the plain, later, with the fire still on it ─────────────────────── */
console.log('\n  the scar, from three sides:');
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
for (const [tag, from, at, eye] of [
  ['east', [10, 40], [-70, 6, 40], 2.0],
  ['north', [-60, -110], [-75, 6, 60], 2.0],
  ['high', [40, 150], [-70, 10, 40], 26.0],
]) {
  await place(from, at, eye);
  await frames(8);
  await shot(`SCAR-${tag}`);
}
const fin = await state();
console.log(`\n  final: t=${fin.clock}s down=[${fin.down}] crash=${JSON.stringify(fin.crash)}`);
console.log(errs.length ? `\nPAGEERRORS(${errs.length}):\n  ${errs.slice(0, 3).join('\n  ')}` : '\n0 pageerrors');
await b.close();
