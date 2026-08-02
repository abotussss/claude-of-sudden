/**
 * THE SKY OVER THE RUIN WITH EVERY BOMBER AND STRAFING RUN ON THE GROUND.
 *
 *   node _runshot.mjs [--url=…] [--seed=N] [--out=shots/runsky] [--label=after]
 *
 * `_skyshots.mjs` photographs the state a REAL match leaves, which is the right
 * acceptance test and is at the mercy of two dice: which of the four bomber
 * lines and which of the four strafing lines the schedulers happened to draw
 * before the cathedral came down. The two that matter — MAIN and CROSS, the
 * only two that cross the church — may not have flown at all.
 *
 * So this is the same photograph with the coverage nailed down: the real
 * scheduled collapse (`_floatcheck --fire`'s own recipe), then every one of the
 * eight drawn-only lines fired serially over the ruin and waited out to
 * `settled`, then the eight camera poses — and a census, per run, of how many of
 * its drawn instances are in OPEN SKY, which is the number the PNGs are checked
 * against.
 *
 * "In open sky" is the same two-ray test `_floatcheck`'s drawn sweep uses: more
 * than `--cair` metres of nothing under the instance's own underside AND nothing
 * solid over its head, so a rest pose buried under the road is not counted as a
 * floating object.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4452/';
const OUT = args.out ?? 'shots/runsky';
const LABEL = args.label ?? 'after';
const CAIR = Number(args.cair ?? 1.5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
const boot = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => {
  const t = m.text();
  if (/^\[(bomber|strafe)\]/.test(t)) boot.push(t);
});
await page.goto(URL + (args.seed ? `?seed=${args.seed}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const levelSeed = await page.evaluate(() => window.__ENGINE__?.levelSeed ?? null);

/* ---- the real scheduled collapse, exactly as _floatcheck --fire runs it -- */
await page.evaluate(() => (window.__ENGINE__.time.scale = 8));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 180000 });
await sleep(400);
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m.airstrike.enabled = true;
  window.__ENGINE__.time.scale = 8;
});
await page.waitForFunction("window.__ENGINE__.ctx.peek('match')._cathedralCalled===true", null, { timeout: 300000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 4));
await page.waitForFunction(
  () => {
    const e = window.__ENGINE__;
    const cath = e.ctx.peek('match').airstrike.sites.filter((x) => /^CATH/.test(x.id));
    return (
      e.ctx.peek('world').cathedral?.razed === true &&
      cath.length >= 4 && cath.every((x) => x.struck && x.baked)
    );
  },
  null,
  { timeout: 300000 }
);
await sleep(8000);

/* ---- and then every drawn-only line, over the ruin ----------------------- */
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m.airstrike.enabled = false;
  if (m.bomber) m.bomber.enabled = false;
  if (m.strafe) m.strafe.enabled = false;
});
const flown = [];
for (const sys of ['bomber', 'strafe']) {
  const ids = await page.evaluate(
    (s) => (window.__ENGINE__.ctx.peek('match')[s]?.runs ?? []).map((r) => r.id),
    sys
  );
  for (const id of ids) {
    const already = await page.evaluate(([s, i]) => window.__ENGINE__.ctx.peek('match')[s].flown(i), [sys, id]);
    if (!already) {
      await page.evaluate(([s, i]) => window.__ENGINE__.ctx.peek('match')[s].fire(i), [sys, id]);
    }
    await page.waitForFunction(
      (s) => !window.__ENGINE__.ctx.peek('match')[s].busy,
      sys,
      { timeout: 120000 }
    );
    flown.push(`${sys}:${id}${already ? ' (already flown by the schedule)' : ''}`);
  }
}
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await sleep(2000);

/* ---- quiesce the cameraman without freezing the world ------------------- */
// @see the note in _skyshots.mjs: stubbing `match.update` freezes anything in
// flight and manufactures the very bug being photographed.
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  const pl = e.ctx.peek('player');
  const ui = e.ctx.peek('ui');
  if (m) {
    m.roundClock = 1e6;
    m._checkWinConditions = () => {};
    if (m.airstrike) m.airstrike.enabled = false;
    if (m.bomber) m.bomber.enabled = false;
    if (m.strafe) m.strafe.enabled = false;
    if (m.tank) m.tank.enabled = false;
  }
  if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
  if (pl) {
    pl.alive = true;
    pl.movementLocked = false;
    if (pl.movement) pl.movement.movementLocked = false;
    pl.health?.heal?.(999);
  }
  e.input.frozen = true;
  e.input.enabled = false;
  pl?.setControlEnabled?.(false);
  ui?.debugState?.('clean');
  if (ui?.root) ui.root.style.display = 'none';
  for (const o of e.ctx.viewScene?.children ?? []) o.visible = false;
});
await sleep(1200);

/* ---- the census, per run ------------------------------------------------ */
const census = await page.evaluate(({ CAIR }) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const m = e.ctx.peek('match');
  const MASK = ph.MASK.WORLD;
  const M4 = e.camera.matrixWorld.constructor;
  const V3 = e.camera.position.constructor;
  const mat = new M4();
  const pos = new V3();
  const sc = new V3();
  const q = e.camera.quaternion.clone();
  const SKY = 60;
  const rows = [];
  for (const [sys, family, key] of [
    [m.bomber, 'bomber', 'debris'],
    [m.strafe, 'strafe', 'grit'],
  ]) {
    for (const run of sys?.runs ?? []) {
      const mesh = run[key];
      const arr = mesh?.instanceMatrix?.array;
      if (!arr) continue;
      mesh.updateWorldMatrix(true, false);
      let sky = 0;
      let shelter = 0;
      let worst = 0;
      let hi = null;
      const n = arr.length / 16;
      for (let i = 0; i < n * 16; i += 16) {
        mat.fromArray(arr, i);
        mat.premultiply(mesh.matrixWorld);
        mat.decompose(pos, q, sc);
        const half = Math.max(sc.x, sc.y, sc.z) * 0.5;
        const under = pos.y - half;
        if (under < 0.6) continue;
        const h = ph.raycast(pos.x, pos.y + 0.15, pos.z, 0, -1, 0, 80, MASK);
        const gap = h.hit ? under - h.point.y : under;
        if (gap <= CAIR) continue;
        const up = ph.raycast(pos.x, SKY, pos.z, 0, -1, 0, SKY + 20, MASK);
        if (up.hit && up.point.y > pos.y + half) { shelter++; continue; }
        sky++;
        if (gap > worst) { worst = +gap.toFixed(2); hi = [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)]; }
      }
      rows.push({
        id: `${family}:${run.id}`, drawn: n, flown: !!run.flown, baked: !!run.baked,
        variants: (run.hostVariants ?? []).map((v) => `${v.host.id}=${v.applied}`).join(','),
        sky, shelter, worst, hi,
      });
    }
  }
  return { rows, razed: e.ctx.peek('world').cathedral?.razed ?? null };
}, { CAIR });

/* ---- the photographs, the same eight poses ------------------------------ */
const POSES = [
  { id: 'south-street', u: 0, v: -34, up: 9, tu: 0, tv: 0 },
  { id: 'crossing-north', u: 0, v: -2, up: 11, tu: 0, tv: 18 },
  { id: 'crossing-south', u: 0, v: 2, up: 11, tu: 0, tv: -18 },
  { id: 'west-flank', u: -24, v: 4, up: 9, tu: -8, tv: -14 },
  { id: 'east-flank', u: 24, v: -4, up: 9, tu: -6, tv: 2 },
  { id: 'north-apse', u: 2, v: 33, up: 9, tu: 0, tv: -6 },
  { id: 'crossing-steep', u: 0, v: -4, up: 26, tu: 0, tv: 4 },
  { id: 'west-steep', u: -20, v: -8, up: 24, tu: -4, tv: 2 },
];
for (const p of POSES) {
  const info = await page.evaluate((pose) => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('world');
    const ph = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    const k = w.cathedral;
    const eye = w.levelToWorld(k.level.x + pose.u, 0, k.level.z + pose.v, new V3());
    const h = ph.raycast(eye.x, 44, eye.z, 0, -1, 0, 60, ph.MASK.WORLD);
    eye.y = (h.hit ? h.point.y : 0) + 1.62;
    const at = w.levelToWorld(k.level.x + pose.tu, 0, k.level.z + pose.tv, new V3());
    at.y = pose.up;
    e.camera.position.copy(eye);
    e.camera.lookAt(at);
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    return { eye: [+eye.x.toFixed(1), +eye.y.toFixed(1), +eye.z.toFixed(1)] };
  }, p);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${LABEL}-${p.id}.png` });
  console.log(`${OUT}/${LABEL}-${p.id}.png  eye ${info.eye.join(', ')}`);
}

console.log(`\nRUNSHOT  levelSeed=${levelSeed}  label=${LABEL}  cathedral.razed=${census.razed}`);
console.log('  boot lines:');
for (const l of boot) console.log(`    ${l}`);
console.log(`  fired: ${flown.join(' · ')}`);
console.log(`\n  per run — drawn instances in OPEN SKY (air > ${CAIR} m, nothing overhead):`);
console.log('    run             drawn  flown  baked  hostVariants        in sky  sheltered  worst  highest');
for (const r of census.rows) {
  console.log(
    `    ${r.id.padEnd(14)} ${String(r.drawn).padStart(5)}  ${String(r.flown).padEnd(5)}  ` +
      `${String(r.baked).padEnd(5)}  ${(r.variants || '-').padEnd(18)} ${String(r.sky).padStart(6)}  ` +
      `${String(r.shelter).padStart(9)}  ${String(r.worst).padStart(5)}  ${r.hi ? r.hi.join(', ') : ''}`
  );
}
const bad = census.rows.reduce((s, r) => s + r.sky, 0);
console.log(`\n  TOTAL drawn instances in open sky: ${bad}`);
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 4));
await browser.close();
process.exit(bad ? 1 : 0);
