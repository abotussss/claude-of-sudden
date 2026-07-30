/**
 * SITE D PROBE — the cathedral becomes a capture point by being destroyed.
 *
 *   node _dprobe.mjs [--url=…] [--shots=DIR]
 *
 * Boots, wedges a match open, and then drives the three scheduled map events by
 * hand in the order the clock would have run them:
 *
 *   1. the cathedral BEFORE — D is not a zone, its paint is not on the floor
 *   2. the collapse firing, and the wreckage
 *   3. D LIVE in the ruin: on the HUD, in the objective plan, and — the
 *      assertion the whole thing turns on — the human walks on to it and the
 *      capture bar fills to a flip
 *   4. bots pathing INTO the ruin, measured as A* solves and as bodies inside
 *   5. the artillery on A/B, and the final city-wide collapse
 *
 * Every number printed is read off the live systems; the screenshots are for
 * the two questions that are not numbers.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4251/';
const SHOTS = args.shots ?? './shots/dsite';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + String(e.message)));
const logs = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') pageErrors.push('console.error: ' + t.slice(0, 300));
  if (/SITE D|cathedral|FINAL COLLAPSE|BOMBARDMENT|zone D/i.test(t)) logs.push(t.slice(0, 240));
});

console.log(`[dprobe] booting ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('[dprobe] ready');
for (const l of logs) console.log('   ' + l);

const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  // Everything is driven by hand below; nothing schedules itself.
  for (const a of m.air) a.enabled = false;
  m._cathedralCalled = true;
  m._finalCalled = true;
  m._bombardIn = 1e6;
  window.__COST__ = [];
  const orig = m.update.bind(m);
  m.update = (dt, ctx) => {
    const t0 = performance.now();
    orig(dt, ctx);
    window.__COST__.push(performance.now() - t0);
  };
  window.__MARK__ = () => window.__COST__.length;
});

const state = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const g = e.ctx.peek('ai').grid;
    const d = m.lockedZone;
    const i = g.index(g.cellX(d.position.x), g.cellZ(d.position.z));
    // How many of D's circle is walkable right now, and can A* still get there?
    const out = [];
    let ok = 0;
    for (const sp of m.spawns.attack) if (g.findPath(sp.position, d.position, out) > 0) ok++;
    let cells = 0;
    const r = d.radius;
    for (let dz = -r; dz <= r; dz += 0.8) {
      for (let dx = -r; dx <= r; dx += 0.8) {
        if (dx * dx + dz * dz > r * r) continue;
        const ci = g.index(g.cellX(d.position.x + dx), g.cellZ(d.position.z + dz));
        if (g.flags[ci] > 0) cells++;
      }
    }
    return {
      liveZones: m.sites.map((z) => z.id).join('/'),
      hudZones: m._hud.zones.map((z) => z.id).join('/'),
      planZones: m._plan.map((p) => p.zone.id).join('/'),
      dInSites: m.sites.includes(d),
      dCentreFlag: g.flags[i],
      dCentreFloor: +g.floor[i].toFixed(2),
      dCircleWalkable: cells,
      attackSpawnsThatReachD: `${ok}/${m.spawns.attack.length}`,
      cathStruck: m.airstrike.sites.filter((s) => s.struck).map((s) => s.id).join('+') || 'none',
      score: [m.score[0], m.score[1]],
    };
  });

/**
 * Stand the camera at an explicit world point, looking at the cathedral.
 *
 * NOT a search. The mid street runs the full length of the map past the
 * cathedral's north and south ends, and the two points used below are the ends
 * of the tank routes — measured, on the ground, with a clear run at the
 * building. Every LOS-scoring version of this put the camera in an alley,
 * because a ray aimed at the middle of a 30 x 45 m building enters that
 * building long before it gets there and every open spot scores zero.
 */
async function standAt(x, z, lookY) {
  return page.evaluate(
    ({ x, z, lookY }) => {
      const e = window.__ENGINE__;
      const ph = e.ctx.peek('physics');
      const player = e.ctx.peek('player');
      const m = e.ctx.peek('match');
      const d = m.lockedZone;
      // A dead player is a SPECTATOR, and the spectator rewrites `ctx.camera`
      // every frame — every `respawnAt` after the artillery lands is otherwise
      // silently ignored.
      m.spectator.active = false;
      m.spectator.stop?.();
      player.setControlEnabled?.(true);
      const g = ph.groundHeight(x, z, 60);
      const y = (Number.isFinite(g) && g < 6 ? g : 0) + 0.1;
      const s = m.sites[0].position.clone();
      s.set(x, y, z);
      const dx = d.position.x - x;
      const dz = d.position.z - z;
      const dy = d.position.y + lookY - (y + 1.72);
      player.respawnAt(s, Math.atan2(-dx, -dz));
      player.movement.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      return { x: +x.toFixed(1), z: +z.toFixed(1), range: +Math.hypot(dx, dz).toFixed(1) };
    },
    { x, z, lookY }
  );
}

/**
 * Stand in the FLANK STREET the aisle roofs fall into, looking down it.
 *
 * The three cathedral strike sites are anchored on the outer aisle walls with
 * `face` pointing out over the flanking street, so the mass lands in that
 * street and the only view that shows it is from along the street. Derived from
 * the sites' own baked mounds — no coordinates repeated.
 */
async function standInFlank(back) {
  return page.evaluate(
    ({ back }) => {
      const e = window.__ENGINE__;
      const ph = e.ctx.peek('physics');
      const player = e.ctx.peek('player');
      const m = e.ctx.peek('match');
      const w = m.airstrike.sites.find((x) => x.id === 'CATH-W');
      const ee = m.airstrike.sites.find((x) => x.id === 'CATH-E');
      let ax = ee.mound.x - w.mound.x;
      let az = ee.mound.z - w.mound.z;
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;
      const x = ee.mound.x + ax * back;
      const z = ee.mound.z + az * back;
      const g = ph.groundHeight(x, z, 60);
      const y = (Number.isFinite(g) && g < 6 ? g : 0) + 0.1;
      const s = m.sites[0].position.clone();
      s.set(x, y, z);
      // Look back down the street at the middle of the three masses.
      const tx = (w.mound.x + ee.mound.x) * 0.5;
      const tz = (w.mound.z + ee.mound.z) * 0.5;
      const dx = tx - x;
      const dz = tz - z;
      const dy = ee.mound.y + 5 - (y + 1.72);
      player.respawnAt(s, Math.atan2(-dx, -dz));
      player.movement.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      return { x: +x.toFixed(1), z: +z.toFixed(1), range: +Math.hypot(dx, dz).toFixed(1) };
    },
    { back }
  );
}

const hideHud = (on) =>
  page.evaluate((on) => {
    const e = window.__ENGINE__;
    const ui = e.ctx.peek('ui');
    ui.setHudVisible(!on);
    ui.hudVisible = on ? 0 : 1;
    e.ctx.viewScene.visible = !on;
  }, on);

/* ---- 1. BEFORE ----------------------------------------------------------- */
console.log('\n=== BEFORE ===');
console.log(JSON.stringify(await state(), null, 0));
console.log('  camera', JSON.stringify(await standAt(31.1, 19.6, 13)));
await hideHud(true);
await sleep(700);
await shot('01-cathedral-before');

/* ---- 2. THE COLLAPSE ----------------------------------------------------- */
const t0 = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  m.airstrike.enabled = true;
  m._cathedralCalled = false;
  m.roundClock = 1e6 - 0; // t is derived from RULES.matchTime - roundClock
  // Force the trigger without waiting 210 s of game time.
  m._cathedralCalled = true;
  const fired = m.airstrike.callCathedralCollapse();
  m._cathedralPending = 7.4;
  return { fired, i: window.__MARK__() };
});
console.log('collapse called', JSON.stringify(t0));
await sleep(1200);
console.log('  camera(flank)', JSON.stringify(await standInFlank(26)));
await sleep(3400);
await shot('02-cathedral-collapsing');
await sleep(1600);
await shot('03-cathedral-during');
await sleep(6000);
await shot('04-cathedral-after');

console.log('\n=== AFTER THE COLLAPSE ===');
const afterCollapse = await state();
console.log(JSON.stringify(afterCollapse, null, 0));
for (const l of logs.slice(-8)) console.log('   ' + l);

/* ---- 3. D LIVE, AND THE BAR ---------------------------------------------- */
await hideHud(false);
const stand = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const player = e.ctx.peek('player');
  const d = m.lockedZone;
  const p = d.stand[0] ?? d.position;
  const s = m.sites[0].position.clone();
  s.copy(p);
  player.respawnAt(s, 1.2);
  player.movement.pitch = 0.02;
  // Nobody else in the circle, so the bar is the human's alone.
  return { at: [+p.x.toFixed(1), +p.z.toFixed(1)], radius: d.radius };
});
console.log('\n=== THE PLAYER STANDS ON D ===', JSON.stringify(stand));
const bar = [];
for (let i = 0; i < 14; i++) {
  await sleep(900);
  const b = await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    const d = m.lockedZone;
    return {
      t: +window.__ENGINE__.time.elapsed.toFixed(1),
      progress: +d.progress.toFixed(3),
      capTeam: d.capTeam,
      owner: d.owner,
      counts: [d.counts[0], d.counts[1]],
      rate: +d.rate.toFixed(3),
      score: [m.score[0], m.score[1]],
    };
  });
  bar.push(b);
  console.log('   ' + JSON.stringify(b));
  if (i === 6) await shot('05-d-capturing');
  if (b.owner >= 0) {
    await shot('06-d-captured');
    break;
  }
}

/* ---- 4. BOTS IN THE RUIN ------------------------------------------------- */
const bots = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  const d = m.lockedZone;
  const g = ai.grid;
  const out = [];
  let solved = 0;
  let n = 0;
  for (const list of m._botsByTeam) {
    for (const a of list) {
      if (!a.alive) continue;
      n++;
      if (g.findPath(a.position, d.position, out) > 0) solved++;
    }
  }
  m._assignObjectives();
  let tasked = 0;
  for (const list of m._botsByTeam) for (const a of list) if (a.alive && a.objectiveSite === d) tasked++;
  return { liveBots: n, canPathToD: solved, taskedToD: tasked };
});
console.log('\n=== BOTS ===', JSON.stringify(bots));

/* ---- 5. THE ARTILLERY ---------------------------------------------------- */
console.log('\n=== ARTILLERY ON A/B ===');
const art = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ui = e.ctx.peek('ui');
  // Give one of the two an owner and a long hold so it is worth shelling.
  const a = m.sites.find((z) => z.id === 'A');
  a.owner = m.playerTeam;
  a.ownedSince = e.time.elapsed - 90;
  const player = e.ctx.peek('player');
  const s = m.sites[0].position.clone().copy(a.stand[0] ?? a.position);
  player.respawnAt(s, 0);
  player.health.godMode = true;
  m._bombardIn = 0;
  m._callZoneBombard();
  return {
    zone: m._bombard.zone?.id ?? null,
    lead: +m._bombard.t.toFixed(1),
    strip: ui.airAlertStrip.text,
    stripVisible: ui.airAlertStrip.visible,
    markers: ui.markers.dangerCount,
    banner: ui.banner.title.textContent,
  };
});
console.log('   called', JSON.stringify(art));
await sleep(2500);
await shot('07-artillery-warning');
await sleep(9000);
await shot('08-artillery-impact');
console.log(
  '   after',
  JSON.stringify(
    await page.evaluate(() => {
      const m = window.__ENGINE__.ctx.peek('match');
      const ui = window.__ENGINE__.ctx.peek('ui');
      return { shot: m._bombard.shot, zone: m._bombard.zone?.id ?? 'done', strip: ui.airAlertStrip.text };
    })
  )
);

/* ---- 6. THE FINAL COLLAPSE ----------------------------------------------- */
console.log('\n=== FINAL COLLAPSE ===');
console.log('  camera', JSON.stringify(await standAt(55.1, 66.2, 16)));
await hideHud(true);
await sleep(600);
await shot('09-city-before');
const fin = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const i0 = window.__COST__.length;
  m._finalCalled = false;
  m.roundClock = 1e6;
  const t = 0;
  // Trigger directly rather than waiting out the clock.
  m._finalCalled = true;
  const n = m.airstrike.callEverything(0.55);
  window.__FINAL_I__ = i0;
  return { sites: n, i0 };
});
console.log('   armed', JSON.stringify(fin));
await sleep(4600);
await shot('10-city-collapsing');
await sleep(2200);
await shot('11-city-collapsing-2');
await sleep(9000);
await shot('12-city-after');

const cost = await page.evaluate(() => {
  const c = window.__COST__;
  const s = [...c].sort((a, b) => a - b);
  const win = c.slice(window.__FINAL_I__, window.__FINAL_I__ + 700);
  const ws = [...win].sort((a, b) => a - b);
  return {
    frames: c.length,
    matchUpdateMedian: +s[s.length >> 1].toFixed(3),
    matchUpdateP99: +s[Math.floor(s.length * 0.99)].toFixed(3),
    matchUpdateMax: +s[s.length - 1].toFixed(3),
    finalWindowMedian: ws.length ? +ws[ws.length >> 1].toFixed(3) : null,
    finalWindowMax: ws.length ? +ws[ws.length - 1].toFixed(3) : null,
  };
});
console.log('\n=== match.update cost (ms) ===', JSON.stringify(cost));
console.log('\n=== FINAL STATE ===', JSON.stringify(await state(), null, 0));
console.log('\n[dprobe] pageErrors', pageErrors.length ? pageErrors : 'none');
for (const l of logs.slice(-14)) console.log('   ' + l);
await browser.close();
