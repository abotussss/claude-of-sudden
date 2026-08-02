/**
 * THE SKY OVER THE RUIN, FROM THE PLAYER'S EYE, AFTER THE REAL COLLAPSE.
 *
 *   node _skyshots.mjs [--url=…] [--seed=N] [--out=shots/sky] [--label=pre]
 *
 * 「大聖堂破壊されてから浮遊物が全然残ってます」 — and `_chunkfloat` at tol=1.2
 * says nothing floats. The two have disagreed before and the gate was wrong
 * both times, so this is the eyeball run the gate is checked AGAINST rather
 * than a replacement for it:
 *
 *   1. the REAL schedule plays the cathedral event (`_floatcheck --fire`'s own
 *      recipe: hold the clock and the win check open, let `_matchProgress`
 *      carry the match to `cathedralOpenProgress`, wait for razed + all CATH-*
 *      sites struck AND baked);
 *   2. the dust is given time to clear (the salvo's wall runs ~20 s);
 *   3. the player's eye is put at ground positions around and inside the ruin,
 *      looking across and up at the volume the shell used to occupy, and each
 *      frame is written to a PNG to be READ BACK;
 *   4. and the same settled poses the pictures show are censused numerically —
 *      every chunk over 2.0 m of world height, what the ray under it hits, and
 *      how much air is under its underside — so a chunk "supported" by a wall
 *      crest eight metres up is a row in a table, not a judgement call.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4421/';
const OUT = args.out ?? 'shots/sky';
const LABEL = args.label ?? 'pre';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL + (args.seed ? `?seed=${args.seed}` : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const levelSeed = await page.evaluate(() => window.__ENGINE__?.levelSeed ?? null);

/* ---- the real scheduled event, exactly as _floatcheck --fire runs it ----- */
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
      cath.length >= 4 &&
      cath.every((x) => x.struck && x.baked)
    );
  },
  null,
  { timeout: 300000 }
);
// Let the dust wall live and die at 4x, then settle to real time.
await sleep(10000);
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await sleep(2500);

/**
 * ──────────────────────────────────────────────────────────────────────────
 * QUIESCE — AND THE FIRST RUN OF THIS FILE PROVES WHY IT IS NOT OPTIONAL
 * ──────────────────────────────────────────────────────────────────────────
 * A REAL scheduled match has twenty men in it and they shoot the cameraman.
 * The first six frames this script wrote were the SPECTATOR's: the banner
 * read ELIMINATED / SPECTATING ZENITH, `MatchSystem`'s own spectator camera
 * had taken `ctx.camera` back the frame after every `teleport`, and the shot
 * was the inside of a rubble pile. That is the same defect the commit
 * "The ground camera was inside the rubble" fixed on another harness.
 *
 * AND THE MATCH IS NOT STOPPED, WHICH IS THE SECOND HALF OF THE LESSON.
 * The obvious quiesce is `tools/floorcheck.mjs`'s — stub `match.update` — and
 * on THIS subject it manufactures the very bug being photographed:
 * `Airstrike.update` is driven from `match.update`, so a site that is still
 * in the air on the frame the stub lands is frozen there for ever and the
 * photograph is a sky full of chunks that the running game would have settled.
 * A gate has already been fooled twice on this defect; a harness fooling
 * itself the same way would be the third.
 *
 * So the cameraman is protected instead of the world being frozen: the agents
 * are cleared (nobody left to shoot him), no NEW strike may be called
 * (`airstrike.enabled = false`), the clock keeps running so everything in the
 * air lands, and the HUD and the viewmodel come out of frame.
 */
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
  // The HUD is a DOM overlay; the weapon is its own scene drawn over the world.
  if (ui?.root) ui.root.style.display = 'none';
  for (const o of e.ctx.viewScene?.children ?? []) o.visible = false;
});
/**
 * …and then WAIT FOR EVERY SITE THAT HAS FIRED TO HAVE SETTLED, by the
 * engine's own flag, rather than by a sleep. This is the check that says
 * whether a chunk in the sky is a bug or a frame.
 */
const settleState = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const sites = () => m.airstrike?.sites ?? [];
  const pending = () => sites().filter((s) => s.struck && !s.baked);
  const t0 = performance.now();
  while (pending().length && performance.now() - t0 < 20000) {
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    struck: sites().filter((s) => s.struck).length,
    baked: sites().filter((s) => s.baked).length,
    stillFlying: pending().map((s) => s.id),
    anim: sites().filter((s) => s.struck && s.uniforms?.uAnim?.value !== 0).map((s) => s.id),
  };
});
console.log(
  `  settle state: ${settleState.baked}/${settleState.struck} struck sites baked` +
    `${settleState.stillFlying.length ? ` — STILL IN THE AIR: ${settleState.stillFlying.join(', ')}` : ''}` +
    `${settleState.anim.length ? ` — still animating: ${settleState.anim.join(', ')}` : ''}`
);

/* ---- the census: every settled chunk off the ground, and what holds it --- */
const census = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const w = e.ctx.peek('world');
  const m = e.ctx.peek('match');
  const MASK = ph.MASK.WORLD;
  const V3 = e.camera.position.constructor;
  const M4 = e.camera.matrixWorld.constructor;
  const mat = new M4();
  const pos = new V3();
  const sc = new V3();
  const q = e.camera.quaternion.clone();
  const k = w.cathedral;
  const vol = w.interiorVolumes.find((v) => v.building === k.id);
  const rows = [];
  const hist = { y2_4: 0, y4_6: 0, y6_9: 0, y9up: 0 };
  let total = 0;
  for (const s of m.airstrike.sites) {
    if (!s.struck) continue;
    for (const mesh of s.meshes) {
      const arr = mesh.userData.settled;
      if (!arr) continue;
      for (let i = 0; i < arr.length; i += 16) {
        total++;
        mat.fromArray(arr, i);
        mat.decompose(pos, q, sc);
        const half = Math.max(sc.x, sc.y, sc.z) * 0.5;
        const y = pos.y;
        if (y < 2.0) continue;
        // Only the cathedral neighbourhood: the towers of other ruins are not
        // this complaint.
        const dx = pos.x - vol.cx;
        const dz = pos.z - vol.cz;
        const lu = dx * vol.c - dz * vol.s;
        const lv = dx * vol.s + dz * vol.c;
        if (Math.abs(lu) > k.hw + 8 || Math.abs(lv) > k.hd + 8) continue;
        const h = ph.raycast(pos.x, y + 0.15, pos.z, 0, -1, 0, 80, MASK);
        const under = y - half;
        const floorY = h.hit ? h.point.y : -99;
        const air = under - floorY;
        if (y < 4) hist.y2_4++;
        else if (y < 6) hist.y4_6++;
        else if (y < 9) hist.y6_9++;
        else hist.y9up++;
        rows.push({
          site: s.id,
          x: +pos.x.toFixed(1), y: +y.toFixed(2), z: +pos.z.toFixed(1),
          half: +half.toFixed(2),
          restsOn: +floorY.toFixed(2),
          air: +air.toFixed(2),
        });
      }
    }
  }
  rows.sort((a, b) => b.y - a.y);
  return { total, hist, high: rows.slice(0, 30), nHigh: rows.length };
});

/* ---- the photographs ----------------------------------------------------- */
// Poses in LEVEL space relative to the cathedral centre, resolved in-page.
const POSES = [
  // Down the mid street from the south, at the great portal: the defence's view.
  { id: 'south-street', u: 0, v: -34, up: 9, tu: 0, tv: 0 },
  // Standing on D, looking north up the nave axis at the sky over the apse.
  { id: 'crossing-north', u: 0, v: -2, up: 11, tu: 0, tv: 18 },
  // Standing on D, looking south at the sky over the front and the portal.
  { id: 'crossing-south', u: 0, v: 2, up: 11, tu: 0, tv: -18 },
  // The west flank street, looking across the ruin at the tower stump.
  { id: 'west-flank', u: -24, v: 4, up: 9, tu: -8, tv: -14 },
  // The east flank street, looking across at the arcade line.
  { id: 'east-flank', u: 24, v: -4, up: 9, tu: -6, tv: 2 },
  // The north end, looking south down the whole plan.
  { id: 'north-apse', u: 2, v: 33, up: 9, tu: 0, tv: -6 },
  // …and two that put nothing but sky in the frame, because a mass 20 m up
  // over the middle of a 45 m ruin is invisible from every horizontal pose.
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

console.log(`\nSKYSHOTS  levelSeed=${levelSeed}  label=${LABEL}`);
console.log(`  settled chunks total: ${census.total}`);
console.log(`  chunks in the cathedral neighbourhood with centre over 2 m: ${census.nHigh}`);
console.log(`  by height: 2-4 m ${census.hist.y2_4} · 4-6 m ${census.hist.y4_6} · 6-9 m ${census.hist.y6_9} · 9+ m ${census.hist.y9up}`);
console.log('  the 30 highest — site, (x,y,z), half-extent, the plane the ray under it hits, air under the underside:');
for (const r of census.high) {
  console.log(
    `   ${r.site.padEnd(10)} ${String(r.x).padStart(7)}, ${String(r.y).padStart(6)}, ${String(r.z).padStart(7)}  ` +
      `half ${String(r.half).padStart(5)}  on ${String(r.restsOn).padStart(6)}  air ${String(r.air).padStart(6)}`
  );
}
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 4));
await browser.close();
