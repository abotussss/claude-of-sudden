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

  const per = {};
  for (const foot of ['R', 'L']) {
    const key = `Foot${foot}`;
    const toe = `Toe${foot}`;
    const contact = S.map((s) => s[key][1] <= PLANT || s[toe][1] <= TOE_PLANT);
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
      const dx = S[i][key][0] - S[i - 1][key][0];
      const dz = S[i][key][2] - S[i - 1][key][2];
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

  const bothOff = S.filter(
    (s) =>
      s.FootR[1] > PLANT && s.ToeR[1] > TOE_PLANT && s.FootL[1] > PLANT && s.ToeL[1] > TOE_PLANT
  ).length;
  const bothOn = S.filter(
    (s) =>
      (s.FootR[1] <= PLANT || s.ToeR[1] <= TOE_PLANT) &&
      (s.FootL[1] <= PLANT || s.ToeL[1] <= TOE_PLANT)
  ).length;

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
  for (let i = 0; i < BINS; i++) bins.push({ n: 0, y: 0, dz: 0, vz: 0 });
  for (let i = 1; i < S.length; i++) {
    const b = bins[Math.min(BINS - 1, Math.floor(S[i].phase * BINS))];
    b.n++;
    b.y += S[i].FootR[1];
    b.dz += S[i].FootR[2] - S[i].rootZ;
    b.vz += (S[i].FootR[2] - S[i - 1].FootR[2]) / dt;
  }
  const table = bins.map((b, i) => ({
    ph: +(i / BINS).toFixed(2),
    y: +(b.y / b.n).toFixed(3),
    dz: +(b.dz / b.n).toFixed(3),
    vz: +(b.vz / b.n).toFixed(2),
  }));

  const expectedStride = cfg.speed / rec.strideHz;
  return {
    footRphaseTable: table,
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
    handRy: range((s) => s.HandR[1]),
    hipLocalY: range((s) => s.hipLocalY),
  };
}
