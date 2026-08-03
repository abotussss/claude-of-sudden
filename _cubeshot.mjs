/**
 * THE CUBE IN FRONT OF THE CATHEDRAL, BEFORE AND AFTER A HULL GOES THROUGH IT.
 *
 *   node _cubeshot.mjs [--url=…] [--seed=7] [--shots=./shots/cube]
 *
 * 「大聖堂入り口目の前の破壊可能そうな立方体オブジェはなんで壊れないの？？」 — a
 * number saying 260 triangles were zeroed is not evidence that a 3.4 m masonry
 * pier stopped existing. Two photographs from the same camera are, and so is a
 * ray fired at where it was.
 *
 * Stands on the parvis outside the great portal, photographs `CATH south pier`,
 * fires `_breakBlocksAt` at it, photographs the same frame, and then proves the
 * mass is gone on BOTH halves: the drawn triangles (the picture) and the
 * collision (a raycast that used to stop at 2 m and now reaches the street).
 * Finally `reset()` and a third frame, so the round reset is exact.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true];
}));
const URL = args.url ?? 'http://127.0.0.1:4498/';
const SEED = args.seed ?? '7';
const SHOTS = args.shots ?? './shots/cube';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 200)); });
await page.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

/* ---- hold the match open, hide the HUD, stand everything down ---------- */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ui = e.ctx.peek('ui');
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m._updateRespawns = () => {};
  const ai = e.ctx.peek('ai');
  if (ai) ai.combatEnabled = false;
  m.tank.enemies = (_team, out) => out;
  for (const a of m.air ?? []) a.enabled = false;
  ui.setHudVisible?.(false);
  ui.hudVisible = 0;
  e.ctx.viewScene.visible = false;
});

/** The block nearest the cathedral's south front, and a camera on the axis. */
const target = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('world');
  const blocks = m.tank._blocks;
  if (!blocks) return { err: 'no block atlas' };
  const V3 = e.camera.position.constructor;
  const lc = w.worldToLevel(w.cathedral.cx, 0, w.cathedral.cz, new V3());
  const front = w.levelToWorld(lc.x, 0, lc.z - 22.5, new V3());
  let best = null;
  let bestD = Infinity;
  for (const b of blocks.list) {
    const d = Math.hypot(b.x - front.x, b.z - front.z);
    if (d < bestD) { bestD = d; best = b; }
  }
  return {
    ix: best.ix, x: +best.x.toFixed(2), z: +best.z.toFixed(2), y: +best.y.toFixed(2),
    top: +best.top.toFixed(2), tris: best.tris.length,
    drawn: best.draws.reduce((a, q) => a + q.off.length, 0),
    d: +bestD.toFixed(1), front: [+front.x.toFixed(2), +front.z.toFixed(2)],
  };
});
if (target.err) { console.log(target.err); await browser.close(); process.exit(2); }
console.log(`\n  nearest block to the south front: [${target.x}, ${target.z}] ` +
  `${target.top} m tall, ${target.d} m out, ${target.tris} collision + ${target.drawn} drawn triangles`);

async function look(from, at) {
  await page.evaluate(({ from, at }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const player = e.ctx.peek('player');
    const scratch = m.sites[0].position.clone();
    scratch.set(from[0], from[1], from[2]);
    const dx = at[0] - from[0];
    const dy = at[1] - (from[1] + 1.62);
    const dz = at[2] - from[2];
    const len = Math.hypot(dx, dy, dz);
    player.respawnAt(scratch, Math.atan2(-dx, -dz));
    player.movement.pitch = Math.asin(dy / len);
  }, { from, at });
  await sleep(450);
}

/** Stand on the parvis, 9 m behind the block on the line from the portal. */
const camPos = await page.evaluate(({ t }) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const dx = t.x - t.front[0];
  const dz = t.z - t.front[1];
  const l = Math.hypot(dx, dz) || 1;
  const x = t.x + (dx / l) * 9;
  const z = t.z + (dz / l) * 9;
  const g = ph.groundHeight(x, z, 60);
  return [x, (Number.isFinite(g) ? g : 0) + 0.1, z];
}, { t: target });
await look(camPos, [target.x, target.y + target.top * 0.5, target.z]);
await shot('1-before');

/** A ray at chest height straight at it, from the camera. */
const probe = () => page.evaluate(({ from, t }) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const V3 = e.camera.position.constructor;
  const o = new V3(from[0], t.y + 1.4, from[2]);
  const d = new V3(t.x - from[0], 0, t.z - from[2]).normalize();
  const h = ph.raycast(o, d, 40, ph.MASK.WORLD);
  const up = new V3(t.x, t.y + 30, t.z);
  const dn = new V3(0, -1, 0);
  const th = ph.raycast(up, dn, 45, ph.MASK.WORLD);
  return {
    hit: h?.hit ? +h.distance.toFixed(2) : null,
    surface: h?.surface ?? null,
    topOverRoad: th?.hit ? +(30 - th.distance).toFixed(2) : null,
  };
}, { from: camPos, t: target });

const before = await probe();
console.log(`  BEFORE  side ray stops at ${before.hit} m (${before.surface}), ` +
  `mass over the road at its centre: ${before.topOverRoad} m`);

/* ---- fire the hull's own eraser at it --------------------------------- */
const broke = await page.evaluate(({ t }) => {
  const m = window.__ENGINE__.ctx.peek('match');
  return m.tank._breakBlocksAt(t.x, t.y + 1.0, t.z, 2.0);
}, { t: target });
await sleep(500);
await shot('2-after');
const after = await probe();
console.log(`  BREAK   ${broke} block(s) erased`);
console.log(`  AFTER   side ray stops at ${after.hit} m (${after.surface}), ` +
  `mass over the road at its centre: ${after.topOverRoad} m`);

/* ---- and it all goes back up ------------------------------------------ */
await page.evaluate(() => window.__ENGINE__.ctx.peek('match').tank.reset());
await sleep(500);
await shot('3-reset');
const back = await probe();
console.log(`  RESET   side ray stops at ${back.hit} m (${back.surface}), ` +
  `mass over the road at its centre: ${back.topOverRoad} m`);

const ok = before.topOverRoad > 3 && after.topOverRoad < 0.4 &&
  Math.abs((back.topOverRoad ?? -9) - before.topOverRoad) < 0.05;
console.log(`\n  ${ok ? 'PASS' : 'FAIL'} — the cube stops existing and comes back exactly.`);
if (errs.length) console.log('  ERRORS:', errs.slice(0, 4));
await browser.close();
