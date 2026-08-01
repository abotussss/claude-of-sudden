#!/usr/bin/env node
/**
 * DEV ONLY — drives `src/ai/gait.html`.
 *
 * Two things come out of it, and both are needed, because a run cycle cannot be
 * judged by a number alone and cannot be fixed by an eye alone:
 *
 *   --mode=strip    one stride laid out as a strip of columns, as a PNG
 *   --mode=record   the numbers: foot slide, duty factor, flight time, stride
 *                   length against distance covered, pelvis and head travel
 *
 *   node src/ai/gaitcheck.mjs --mode=record --clip=run --speed=4.2
 *   node src/ai/gaitcheck.mjs --mode=strip  --clip=run --speed=4.2 --out=/tmp/run.png
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import net from 'node:net';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const PORT = Number(args.port ?? 5219);
const MODE = args.mode ?? 'record';
const CFG = {
  clip: args.clip ?? 'run',
  speed: Number(args.speed ?? 4.2),
  aim: Number(args.aim ?? 0.85),
  cycles: Number(args.cycles ?? 3),
  cols: Number(args.cols ?? 12),
  width: Number(args.width ?? 2400),
  height: Number(args.height ?? 620),
  view: args.view ?? 'side',
  dist: Number(args.dist ?? 2),
  az: Number(args.az ?? 22),
  fill: Number(args.fill ?? 0.62),
  variant: args.variant ?? 'vanguard',
  footIk: Number(args.footik ?? 1),
  ph0: Number(args.ph0 ?? 0),
  phSpan: Number(args.phspan ?? 1),
};
const OUT = resolve(args.out ?? `/tmp/gait-${MODE}.png`);

const portOpen = (port) =>
  new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => (s.destroy(), res(true)));
    s.on('error', () => res(false));
    s.setTimeout(400, () => (s.destroy(), res(false)));
  });

const root = resolve(import.meta.dirname, '../..');
let server = null;
if (!(await portOpen(PORT))) {
  server = spawn(resolve(root, 'node_modules/.bin/vite'), ['--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, OW_NO_HMR: '1' },
  });
  let up = false;
  for (let i = 0; i < 160 && !up; i++) {
    await new Promise((r) => setTimeout(r, 250));
    up = await portOpen(PORT);
  }
  if (!up) {
    server.kill();
    throw new Error('vite failed to start');
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--hide-scrollbars'],
});
const page = await browser.newPage({
  viewport: { width: Math.min(2400, CFG.width), height: CFG.height + 20 },
  deviceScaleFactor: 1,
});
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

let failed = null;
try {
  await page.goto(`http://127.0.0.1:${PORT}/src/ai/gait.html?variant=${CFG.variant}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: 240000 });

  if (MODE === 'strip' || MODE === 'still') {
    const info = await page.evaluate(
      ([mode, cfg]) => (mode === 'strip' ? window.__gait.strip(cfg) : window.__gait.still(cfg)),
      [MODE, CFG]
    );
    await page.setViewportSize({ width: info.W, height: info.H });
    await page.evaluate(
      ([mode, cfg]) => (mode === 'strip' ? window.__gait.strip(cfg) : window.__gait.still(cfg)),
      [MODE, CFG]
    );
    mkdirSync(dirname(OUT), { recursive: true });
    await page.locator('#c').screenshot({ path: OUT });
    console.log(JSON.stringify({ ok: true, out: OUT, ...info, cfg: CFG }));
  } else {
    const rec = await page.evaluate((cfg) => window.__gait.record(cfg), CFG);
    const stats = await page.evaluate(() => window.__gait.stats);
    console.log(JSON.stringify(analyse(rec, CFG, stats), null, 1));
  }
} catch (e) {
  failed = e;
}
if (failed || args.verbose) console.error(logs.slice(-30).join('\n'));
await browser.close();
if (server) server.kill();
if (failed) {
  console.error(JSON.stringify({ ok: false, error: failed.message }));
  process.exit(1);
}

/* ------------------------------------------------------------------ */

function analyse(rec, cfg, stats) {
  const S = rec.samples;
  const dt = rec.dt;
  // A foot is on the ground when its sole is: the ankle bone sits 0.088 m above
  // the sole in the bind pose, so the ankle is at 0.088 when planted. 25 mm of
  // slack covers ankle roll and the IK's own 1 mm bias.
  const PLANT = 0.088 + 0.025;
  const TOE_PLANT = 0.03 + 0.03;

  /** Is this foot's sole touching? The one contact test everything below uses. */
  const down = (s, f) => s[`heel${f}`][1] <= 0.02 || s[`toe${f}`][1] <= 0.02;

  const per = {};
  for (const foot of ['R', 'L']) {
    const key = `Foot${foot}`;
    const toe = `Toe${foot}`;
    // The contact POINT migrates heel -> flat -> toe across a stance, so the
    // ankle is ALLOWED to move while the foot rolls over the sole. Slide is
    // therefore measured on whichever end of the sole is on the ground, and
    // "on the ground" is decided by that point's own height, not the ankle's.
    const heel = `heel${foot}`;
    const soleToe = `toe${foot}`;
    const GROUND = 0.02;
    const onHeel = S.map((s) => s[heel][1] <= GROUND);
    const onToeS = S.map((s) => s[soleToe][1] <= GROUND);
    const contact = S.map((s, i) => onHeel[i] || onToeS[i]);
    const refOf = (i) => (onHeel[i] ? heel : soleToe);
    void key;
    void toe;
    // slide: world movement of the foot while it is planted
    let slideSum = 0;
    let slidePeak = 0;
    let n = 0;
    const runs = [];
    let cur = null;
    for (let i = 1; i < S.length; i++) {
      if (!contact[i] || !contact[i - 1]) {
        if (cur) {
          runs.push(cur);
          cur = null;
        }
        continue;
      }
      const ref = refOf(i) === refOf(i - 1) ? refOf(i) : null;
      if (!ref) continue;
      const dx = S[i][ref][0] - S[i - 1][ref][0];
      const dz = S[i][ref][2] - S[i - 1][ref][2];
      const d = Math.hypot(dx, dz);
      slideSum += d;
      n++;
      const v = d / dt;
      if (v > slidePeak) slidePeak = v;
      if (!cur) cur = { start: i - 1, z0: S[i - 1][key][2], d: 0 };
      cur.d += d;
      cur.end = i;
      cur.z1 = S[i][key][2];
    }
    if (cur) runs.push(cur);
    // stride length: distance between the world plant points of successive
    // contacts of the SAME foot
    const plants = runs.filter((r) => (r.end - r.start) * dt > 0.03);
    const strides = [];
    for (let i = 1; i < plants.length; i++) {
      strides.push(((plants[i].z0 + plants[i].z1) - (plants[i - 1].z0 + plants[i - 1].z1)) / 2);
    }
    per[foot] = {
      dutyFactor: +(contact.filter(Boolean).length / contact.length).toFixed(3),
      slidePerContact_m: plants.length ? +(slideSum / plants.length).toFixed(3) : null,
      slideMean_mps: n ? +(slideSum / (n * dt)).toFixed(3) : null,
      slidePeak_mps: +slidePeak.toFixed(3),
      strideLength_m: strides.length
        ? +(strides.reduce((a, b) => a + b, 0) / strides.length).toFixed(3)
        : null,
      contacts: plants.length,
    };
  }

  // Flight and double support have to be read off the same contact test the
  // duty factors use — the SOLE, not the ankle bone, which is airborne through
  // a perfectly good toe-off.
  const bothOff = S.filter((s) => !down(s, 'R') && !down(s, 'L')).length;
  const bothOn = S.filter((s) => down(s, 'R') && down(s, 'L')).length;
  void PLANT;
  void TOE_PLANT;

  const range = (f) => {
    let mn = Infinity;
    let mx = -Infinity;
    for (const s of S) {
      const v = f(s);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return { min: +mn.toFixed(3), max: +mx.toFixed(3), range: +(mx - mn).toFixed(3) };
  };

  /**
   * The phase table is the diagnosis. For 16 bins of one cycle:
   *   y     foot height (0.088 = planted)
   *   dz    foot position along the direction of travel, RELATIVE to the root
   *   vz    foot world velocity along travel — must be 0 whenever y says planted
   * A run whose vz is +speed while y is at its minimum has its stance phase in
   * the wrong half of the cycle, and no amount of tuning amplitudes fixes it.
   */
  const BINS = 16;
  const bins = [];
  for (let i = 0; i < BINS; i++) bins.push({ n: 0, y: 0, dz: 0, vz: 0, hy: 0, ty: 0, cv: 0 });
  for (let i = 1; i < S.length; i++) {
    const b = bins[Math.min(BINS - 1, Math.floor(S[i].phase * BINS))];
    b.n++;
    b.y += S[i].FootR[1];
    b.hy += S[i].heelR[1];
    b.ty += S[i].toeR[1];
    b.hip = (b.hip ?? 0) + S[i].Hips[1];
    b.down = (b.down ?? 0) + (down(S[i], 'R') || down(S[i], 'L') ? 1 : 0);
    b.dz += S[i].FootR[2] - S[i].rootZ;
    b.vz += (S[i].FootR[2] - S[i - 1].FootR[2]) / dt;
    const ref = S[i].heelR[1] < S[i].toeR[1] ? 'heelR' : 'toeR';
    b.cv += Math.hypot(S[i][ref][0] - S[i - 1][ref][0], S[i][ref][2] - S[i - 1][ref][2]) / dt;
  }
  const table = bins.map((b, i) => ({
    ph: +(i / BINS).toFixed(2),
    y: +(b.y / b.n).toFixed(3),
    heel: +(b.hy / b.n).toFixed(3),
    toe: +(b.ty / b.n).toFixed(3),
    dz: +(b.dz / b.n).toFixed(3),
    vz: +(b.vz / b.n).toFixed(2),
    cv: +(b.cv / b.n).toFixed(2),
    hip: +(b.hip / b.n).toFixed(3),
    onGround: +(b.down / b.n).toFixed(2),
  }));

  // The two-bone solver silently clamps at full extension, and a clamped leg is
  // a foot that did not go where the clip asked — i.e. it slides. Reach is the
  // early-warning number for that: over 0.99 and the knee is locked straight.
  const LEG = 0.857;
  let reachMax = 0;
  let sink = 0;
  for (const s of S) {
    for (const f of ['R', 'L']) {
      const r = Math.hypot(
        s[`Foot${f}`][0] - s[`UpLeg${f}`][0],
        s[`Foot${f}`][1] - s[`UpLeg${f}`][1],
        s[`Foot${f}`][2] - s[`UpLeg${f}`][2]
      );
      if (r > reachMax) reachMax = r;
      const under = 0.088 - s[`Foot${f}`][1];
      if (under > sink) sink = under;
    }
  }

  const expectedStride = cfg.speed / rec.strideHz;
  return {
    footRphaseTable: table,
    legReachFrac: +(reachMax / LEG).toFixed(3),
    ankleBelowPlant_m: +sink.toFixed(3),
    cfg,
    tris: stats?.triangles,
    strideHz: +rec.strideHz.toFixed(3),
    expectedStrideLength_m: +expectedStride.toFixed(3),
    foot: per,
    flightFraction: +(bothOff / S.length).toFixed(3),
    doubleSupportFraction: +(bothOn / S.length).toFixed(3),
    hipsY: range((s) => s.Hips[1]),
    headY: range((s) => s.Head[1]),
    headX: range((s) => s.Head[0]),
    footRy: range((s) => s.FootR[1]),
    heelRy: range((s) => s.heelR[1]),
    toeRy: range((s) => s.toeR[1]),
    handRy: range((s) => s.HandR[1]),
    hipLocalY: range((s) => s.hipLocalY),
  };
}
