/**
 * AIR PROBE — the gate for the three air weapons and their announcement.
 *
 *   node _airprobe.mjs [--url=…] [--shots=DIR]
 *
 * It boots the game, holds a round open (win conditions and the schedulers off,
 * so nothing respawns the camera out from under the shot), and for each of the
 * four events — single strike, block salvo, bomber stick, strafing run — puts
 * the player somewhere with a clear line of sight to the impact, fires it, and
 * photographs the telegraph, the impact and the aftermath while recording what
 * the HUD said at each of those moments.
 *
 * WHAT IT IS FOR. The whole of the bug it was written for was "the events fire
 * and the player cannot perceive any of it", so a run where the banner or the
 * warning strip is null AT AN EVENT is a FAILURE even though every event fired.
 * The banner/strip/markers columns are the actual assertion; the screenshots are
 * the other half, because "does it read as a city block being destroyed" is not
 * a number.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4206/';
const SHOTS = args.shots ?? './shots/air';
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
  if (m.type() === 'error') pageErrors.push('console.error: ' + t.slice(0, 260));
  if (/\[airstrike\]|\[bomber\]|\[strafe\]/.test(t)) logs.push(t.slice(0, 240));
});

console.log(`[airprobe] booting ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('[airprobe] ready');
for (const l of logs) console.log('   ' + l);

/* ---- hold a round open -------------------------------------------------- */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ui = e.ctx.peek('ui');
  // Get to LIVE, then wedge it there: no win checks, no respawns, no scheduler.
  // Everything below is fired by hand.
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m._updateRespawns = () => {};
  for (const a of m.air) a.enabled = false;

  window.__AIR__ = [];
  const snap = (ev, extra) => {
    const b = ui.banner;
    const s = ui.airAlertStrip;
    window.__AIR__.push({
      t: +e.time.elapsed.toFixed(2),
      ev,
      ...extra,
      banner: b.t < 1 ? b.title.textContent : null,
      bannerSub: b.t < 1 ? b.sub.textContent : null,
      strip: s.text,
      stripVisible: s.visible,
      markers: ui.markers.dangerCount,
    });
  };
  e.events.on('match:airstrike', (p) => snap('airstrike:' + p.phase, { id: p.site }));
  e.events.on('match:bomber', (p) => snap('bomber:' + p.phase, { id: p.run }));
  e.events.on('match:strafe', (p) => snap('strafe:' + p.phase, { id: p.run }));
});

const st = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const ui = e.ctx.peek('ui');
    const s = ui.airAlertStrip;
    const b = ui.banner;
    return {
      t: +e.time.elapsed.toFixed(2),
      phase: e.ctx.peek('match').phase,
      banner: b.t < 1 ? b.title.textContent : null,
      strip: s.text,
      stripVisible: s.visible,
      bearing: +s.bearing.toFixed(0),
      range: +s.range.toFixed(1),
      markers: ui.markers.dangerCount,
    };
  });

const sleep = (ms) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

/**
 * Stand somewhere the EVENT ITSELF is visible from, and look at it.
 *
 * A shot of a building coming down from behind another building proves nothing,
 * and neither does a ground-height probe: half the open ground on this map is
 * under a market awning, and awnings have no collision, so "the ray to the sky
 * is clear" cannot find them. So the score is the thing that actually matters —
 * how many of the event's OWN impact points this spot can see — and the best
 * scoring spot wins, nearest to `prefer` (the direction the mass overhangs) on a
 * tie.
 */
async function look(target, dist, up, prefer, probes) {
  return page.evaluate(
    ({ tx, ty, tz, dist, up, prefer, probes }) => {
      const e = window.__ENGINE__;
      const ph = e.ctx.peek('physics');
      const player = e.ctx.peek('player');
      const m = e.ctx.peek('match');
      const scratch = m.sites[0].position.clone();
      const sees = (x, fy, z, p) => {
        let dx = p.x - x;
        let dy = p.y - fy;
        let dz = p.z - z;
        const len = Math.hypot(dx, dy, dz);
        if (len < 4) return true;
        dx /= len;
        dy /= len;
        dz /= len;
        return !ph.raycastAny(x, fy, z, dx, dy, dz, len - 2.5, ph.MASK.WORLD);
      };
      const base = prefer ? Math.atan2(prefer.z, prefer.x) : 0;
      let best = null;
      for (const d of [dist, dist * 0.8, dist * 1.2, dist * 0.65, dist * 1.45]) {
        for (let i = 0; i < 72; i++) {
          const a = (i / 72) * Math.PI * 2;
          const x = tx + Math.cos(a) * d;
          const z = tz + Math.sin(a) * d;
          const g = ph.groundHeight(x, z, 80);
          if (!Number.isFinite(g) || g > 2.5) continue; // must be at street level
          const fy = g + 1.62;
          let seen = 0;
          for (const p of probes) if (sees(x, fy, z, p)) seen++;
          if (!seen) continue;
          let off = a - base;
          while (off > Math.PI) off -= Math.PI * 2;
          while (off < -Math.PI) off += Math.PI * 2;
          const score = seen * 100 - Math.abs(off) * 8 - Math.abs(d - dist) * 2.5;
          if (!best || score > best.score) {
            let dyy = ty + up - fy;
            const len = Math.hypot(tx - x, dyy, tz - z);
            best = {
              x,
              y: g + 0.1,
              z,
              // Three.js camera forward is -Z, so yaw y gives (-sin y, 0, -cos y).
              yaw: Math.atan2(-(tx - x), -(tz - z)),
              pitch: Math.asin(dyy / len),
              score,
              seen,
            };
          }
        }
      }
      if (!best) return null;
      scratch.set(best.x, best.y, best.z);
      player.respawnAt(scratch, best.yaw);
      player.movement.pitch = best.pitch;
      return {
        seen: best.seen + '/' + probes.length,
        range: +Math.hypot(best.x - tx, best.z - tz).toFixed(1),
        pitch: +best.pitch.toFixed(2),
      };
    },
    { ...target, dist, up, prefer, probes }
  );
}

const rows = [];
async function drive(name, fire, marks) {
  const before = await page.evaluate(() => window.__AIR__.length);
  await fire();
  for (const [label, ms, nohud] of marks) {
    await sleep(ms);
    const s = await st();
    rows.push({ name, label, ...s });
    console.log(
      `   ${name}/${label} t=${s.t} banner=${JSON.stringify(s.banner)} ` +
        `strip=${JSON.stringify(s.strip)} markers=${s.markers} bearing=${s.bearing} range=${s.range}`
    );
    await shot(`${name}-${label}`);
    if (nohud) {
      // The same instant without the overlay: "does it read as a block being
      // destroyed" is a question about the world, not about the HUD.
      await page.evaluate(() => {
        const ui = window.__ENGINE__.ctx.peek('ui');
        ui.setHudVisible(false);
        ui.hudVisible = 0;
      });
      await sleep(60);
      await shot(`${name}-${label}-nohud`);
      await page.evaluate(() => {
        const ui = window.__ENGINE__.ctx.peek('ui');
        ui.setHudVisible(true);
        ui.hudVisible = 1;
      });
    }
  }
  const evs = await page.evaluate((n) => window.__AIR__.slice(n), before);
  for (const r of evs) console.log('   ev ' + JSON.stringify(r));
}

/* ---- 1. one route strike ------------------------------------------------ */
const r1 = await page.evaluate(() => {
  const s = window.__STRIKE__.sites.find((x) => x.id === 'R2');
  const P = (v) => ({ x: v.x, y: v.y, z: v.z });
  return {
    id: s.id,
    tx: s.position.x,
    ty: s.position.y,
    tz: s.position.z,
    prefer: { x: s.u.x, z: s.u.z },
    probes: [P(s.blast), P(s.mound)],
  };
});
console.log('[airprobe] strike view', JSON.stringify(await look(r1, 28, 7, r1.prefer, r1.probes)));
await sleep(600);
await drive('strike', () => page.evaluate((id) => window.__STRIKE__.call(id), r1.id), [
  ['telegraph', 1400],
  ['whistle', 2100],
  ['impact', 1300, true],
  ['collapse', 1100, true],
]);

/* ---- 2. the block salvo ------------------------------------------------- */
const sv = await page.evaluate(() => {
  const g = window.__STRIKE__.salvos.find((x) => x.sites.every((y) => !y.struck)) ?? null;
  if (!g) return null;
  // Aim at the MIDDLE OF THE FRONTAGE at street level — the mounds are in the
  // lane, so a street-level line of sight to them exists, which is not true of
  // the group centroid (that is inside the block).
  const a = g.sites[0].mound;
  const b = g.sites[g.sites.length - 1].mound;
  // and view it from the mean of the directions the three masses overhang.
  let ux = 0;
  let uz = 0;
  for (const s of g.sites) {
    ux += s.u.x;
    uz += s.u.z;
  }
  const l = Math.hypot(ux, uz) || 1;
  const P = (v) => ({ x: v.x, y: v.y, z: v.z });
  return {
    id: g.id,
    tx: (a.x + b.x) / 2,
    ty: (a.y + b.y) / 2,
    tz: (a.z + b.z) / 2,
    prefer: { x: ux / l, z: uz / l },
    probes: g.sites.map((s) => P(s.blast)),
  };
});
if (sv) {
  console.log('[airprobe] salvo view', JSON.stringify(await look(sv, 26, 10, sv.prefer, sv.probes)));
  await sleep(600);
  await drive('salvo', () => page.evaluate((id) => window.__STRIKE__.callSalvo(id), sv.id), [
    ['telegraph', 1500],
    ['whistle', 2000],
    ['impact', 1100, true],
    ['collapse', 1400, true],
    ['dust', 3500, true],
    ['dust2', 5000, true],
  ]);
}

/* ---- 3. the bomber stick ------------------------------------------------ */
const bm = await page.evaluate(() => {
  const r = window.__BOMBER__.runs.find((x) => !x.flown) ?? window.__BOMBER__.runs[0];
  const P = (v) => ({ x: v.x, y: v.y + 1.5, z: v.z });
  return {
    id: r.id,
    tx: r.position.x,
    ty: r.position.y,
    tz: r.position.z,
    probes: r.bombs.map((b) => P(b.impact)),
  };
});
console.log('[airprobe] bomber view', JSON.stringify(await look(bm, 26, 6, null, bm.probes)));
await sleep(600);
await drive('bomber', () => page.evaluate((id) => window.__BOMBER__.fire(id), bm.id), [
  ['telegraph', 1000],
  ['falling', 1300],
  ['impact', 1100, true],
  ['stick', 1500, true],
]);

/* ---- 4. the strafing run ------------------------------------------------ */
const sf = await page.evaluate(() => {
  const r = window.__STRAFE__.runs.find((x) => !x.flown) ?? window.__STRAFE__.runs[0];
  const P = (v) => ({ x: v.x, y: v.y + 1.5, z: v.z });
  const n = r.impacts.length;
  return {
    id: r.id,
    tx: r.position.x,
    ty: r.position.y,
    tz: r.position.z,
    probes: [0, (n / 4) | 0, (n / 2) | 0, ((3 * n) / 4) | 0, n - 1].map((i) => P(r.impacts[i].at)),
  };
});
console.log('[airprobe] strafe view', JSON.stringify(await look(sf, 24, 5, null, sf.probes)));
await sleep(600);
await drive('strafe', () => page.evaluate((id) => window.__STRAFE__.fire(id), sf.id), [
  ['telegraph', 1500],
  ['inbound', 1500],
  ['gunfire', 500, true],
  ['gunfire2', 400, true],
  ['after', 900, true],
]);

console.log('[airprobe] pageErrors:', pageErrors.length ? pageErrors.slice(0, 8) : 'none');
await browser.close();
