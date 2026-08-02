/**
 * THE SKY OVER MID, BEFORE AND AFTER ITS HOST FALLS.
 *
 * Drives the one order that a boot-time or fire-time bake cannot see — the
 * site is struck, its rubble settles, and only THEN does the building under
 * part of it stop existing — and photographs the airspace at both ends of it.
 *
 *   node _hostshot.mjs --url=http://127.0.0.1:4390/ --seed=7 --out=shots/hostnew
 *
 * Two shots per run: `up` (host standing, the rubble on its roof, which must
 * not change) and `down` (host razed, which is the bug).
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const BASE = args.url ?? 'http://127.0.0.1:4390/';
const SEED = args.seed ?? '7';
const OUT = args.out ?? 'shots/host';
const SITE = args.site ?? 'MID';
mkdirSync(OUT, { recursive: true });

/**
 * The airspace the sweep named — `(25.8, 12.7, 11.2)` is the worst of MID's
 * chunks on the cathedral's aisle roof.
 *
 * THE EYE IS FOUND, NOT AUTHORED, and the first version of this file is why:
 * two hand-picked street positions both landed INSIDE a building and
 * photographed the inside of a wall. `_findEye` marches away from the target
 * along each candidate bearing and keeps the first one with clear line of
 * sight, so the camera is somewhere the chunks are actually visible from
 * whether or not the cathedral is standing.
 */
/**
 * THE SUBJECT IS THE CLUSTER, FOUND THE SAME WAY IN BOTH BUILDS. Selecting it
 * by `site.hostVariants` would only exist on one side of the comparison, so the
 * frame is defined geometrically: MID's settled chunks within `FOCUS_R` of the
 * plan point the sweep named. Both builds photograph exactly the same mass.
 */
const FOCUS = [25.8, 11.2];
const FOCUS_R = 22;
/**
 * …AND ONLY THE HIGH ONES. A circle round the plan point catches 900 of MID's
 * 923 chunks, which is the whole mound; the mass in question is the handful
 * thrown clear and left standing on a roof, so the frame is "above the street"
 * as well as "over there". Height, not membership of a variant list, so the
 * two builds select the same chunks.
 */
const FOCUS_Y = 6.0;
const POSES = [
  /** Level with the mass and close, so the ground under it is in frame. */
  { id: 'level', elev: 0.05, range: 13, bearings: 36 },
  /** From below, so the backdrop is sky and a gap reads as a gap. */
  { id: 'under', elev: -0.42, range: 15, bearings: 36 },
];

const AIM = `(id, fx, fz, fr, fy) => {
  const air = window.__ENGINE__.ctx.peek('match').airstrike;
  const s = air.sites.find((x) => x.id === id);
  let n = 0, sx = 0, sy = 0, sz = 0, lo = 1e9, hi = -1e9;
  for (const mesh of s.meshes) {
    const a = mesh.userData.settled;
    for (let k = 0; k < a.length / 16; k++) {
      const x = a[k * 16 + 12], y = a[k * 16 + 13], z = a[k * 16 + 14];
      if ((x - fx) * (x - fx) + (z - fz) * (z - fz) > fr * fr) continue;
      if (y < fy) continue;
      n++; sx += x; sy += y; sz += z;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  if (!n) return null;
  return { n, c: [+(sx / n).toFixed(2), +(sy / n).toFixed(2), +(sz / n).toFixed(2)],
           lo: +lo.toFixed(2), hi: +hi.toFixed(2) };
}`;

const FIND_EYE = `(t, elev, range, bearings) => {
  const e = window.__ENGINE__;
  const ph = e.ctx.peek('physics');
  const M = ph.MASK.WORLD;
  let best = null;
  for (let b = 0; b < bearings; b++) {
    const a = (b / bearings) * Math.PI * 2;
    const dx = Math.cos(a) * Math.cos(elev);
    const dz = Math.sin(a) * Math.cos(elev);
    const dy = Math.sin(elev);
    const h = ph.raycast(t[0], t[1], t[2], dx, dy, dz, range, M);
    const d = h.hit ? h.distance - 1.4 : range;
    if (d < 6) continue;
    const ex = t[0] + dx * d, ey = t[1] + dy * d, ez = t[2] + dz * d;
    // OUTDOORS, or the "eye" is a room with a window in it — that is exactly
    // what the first two versions of this file photographed.
    const up = ph.raycast(ex, ey, ez, 0, 1, 0, 40, M);
    if (up.hit) continue;
    // …and the target has to be visible FROM there, not merely reachable TO it.
    const back = ph.raycast(ex, ey, ez, -dx, -dy, -dz, d, M);
    if (back.hit && back.distance < d - 0.6) continue;
    if (!best || d > best.d) best = { d, dx, dy, dz };
  }
  if (!best) return null;
  return [
    +(t[0] + best.dx * best.d).toFixed(2),
    +(t[1] + best.dy * best.d).toFixed(2),
    +(t[2] + best.dz * best.d).toFixed(2),
  ];
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--force-color-profile=srgb'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${BASE}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match')?.phase === 'live', null, { timeout: 180000 });
await sleep(400);
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  m.airstrike.enabled = false;
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m._cathedralCalled = true;
  m._finalCalled = true;
  e.time.scale = 6;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.ctx.peek('ui')?.debugState?.('clean');
  // The subject is the airspace, not the HUD or the player's own hands.
  const hud = document.querySelector('.ow-hud');
  if (hud) hud.style.display = 'none';
  for (const c of e.viewScene.children) c.visible = false;
});

const settled = () =>
  page.waitForFunction(
    (i) => {
      const s = window.__ENGINE__.ctx.peek('match').airstrike.sites.find((x) => x.id === i);
      return !!s && s.struck && s.baked;
    },
    SITE,
    { timeout: 120000 }
  );

/**
 * ONE CAMERA FOR BOTH FRAMES. The eyes are solved on the FIRST shot — the
 * host still standing, which is the state both builds agree on — and then
 * pinned, because a before/after taken from two different positions is not a
 * before/after. It also makes the four PNGs from the two BUILDS comparable:
 * their "up" states are identical, so they solve the same camera.
 */
let PINNED = null;

const shoot = async (tag) => {
  // Still frame: the shot must be of settled rubble, not of a shader mid-curve.
  await page.evaluate(() => { window.__ENGINE__.time.scale = 0.0001; });
  const aim = await page.evaluate(`(${AIM})(${JSON.stringify(SITE)}, ${FOCUS[0]}, ${FOCUS[1]}, ${FOCUS_R}, ${FOCUS_Y})`);
  console.log(
    aim
      ? `  focus: ${aim.n} chunk(s) over ${FOCUS_Y} m, centroid ${aim.c.join(', ')}, y ${aim.lo}..${aim.hi} m`
      : `  focus: no chunk over ${FOCUS_Y} m in the circle — nothing is left in the sky`
  );
  if (!PINNED) {
    if (!aim) {
      await page.evaluate(() => { window.__ENGINE__.time.scale = 6; });
      return;
    }
    PINNED = { look: aim.c, eyes: {} };
    for (const p of POSES) {
      PINNED.eyes[p.id] = await page.evaluate(
        `(${FIND_EYE})(${JSON.stringify(aim.c)}, ${p.elev}, ${p.range}, ${p.bearings})`
      );
    }
  }
  for (const p of POSES) {
    const eye = PINNED.eyes[p.id];
    if (!eye) {
      console.log(`  ${p.id}: no clear vantage`);
      continue;
    }
    await page.evaluate(
      (pose) => {
        const e = window.__ENGINE__;
        const V3 = e.camera.position.constructor;
        e.camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
        e.camera.lookAt(new V3(pose.to[0], pose.to[1], pose.to[2]));
        e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
        const hud = document.querySelector('.ow-hud');
        if (hud) hud.style.display = 'none';
        for (const c of e.viewScene.children) c.visible = false;
      },
      { eye, to: PINNED.look }
    );
    await page.waitForTimeout(1100);
    const file = `${OUT}/${p.id}-${tag}.png`;
    await page.screenshot({ path: file });
    console.log(`  ${file}   eye ${eye.join(', ')}`);
  }
  await page.evaluate(() => { window.__ENGINE__.time.scale = 6; });
};

const report = async (tag) => {
  const r = await page.evaluate((i) => {
    const air = window.__ENGINE__.ctx.peek('match').airstrike;
    const s = air.sites.find((x) => x.id === i);
    let hi = -1e9;
    for (const mesh of s.meshes) {
      const a = mesh.userData.settled;
      for (let k = 0; k < a.length / 16; k++) if (a[k * 16 + 13] > hi) hi = a[k * 16 + 13];
    }
    return {
      razed: !!window.__ENGINE__.ctx.peek('world').cathedral?.razed,
      highest: +hi.toFixed(2),
      variants: (s.hostVariants ?? []).map((v) => `${v.host.id}:${v.applied ? 'DOWN' : 'up'}`),
    };
  }, SITE);
  console.log(`  [${tag}] cathedral razed=${r.razed}  highest settled chunk=${r.highest} m  variants=${r.variants.join(',') || '-'}`);
};

console.log(`\nHOSTSHOT  site=${SITE}  seed=${SEED}  -> ${OUT}\n`);
await page.evaluate((i) => window.__ENGINE__.ctx.peek('match').airstrike.fire(i), SITE);
await settled();
/**
 * AND THEN WAIT FOR THE DUST. `_salvoDust` and the site's own spectacle occlude
 * this lane for about twenty seconds, which is a feature of the event and a
 * ruined photograph — the first frames of this file were of smoke.
 */
await sleep(9000);
await report('host up');
await shoot('up');

await page.evaluate(() => window.__ENGINE__.ctx.peek('match')._razeCathedral());
await sleep(12000);
await report('host down');
await shoot('down');

if (errs.length) console.log('\n  PAGE ERRORS', errs.slice(0, 6));
await browser.close();
