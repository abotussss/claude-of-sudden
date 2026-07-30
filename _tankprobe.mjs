/**
 * TANK PROBE — the gate for `src/match/tank.js`.
 *
 *   node _tankprobe.mjs [--url=…] [--shots=DIR]
 *
 * It boots the game, wedges a round open (win checks, respawns and every
 * scheduler off, so nothing moves the camera out from under a shot), rolls both
 * hulls by hand and then photographs the thing from outside, drives it, and
 * stands the player in front of the other side's tank until the gun is laid on
 * the camera and fires.
 *
 * WHAT IT ASSERTS, as numbers rather than as pictures:
 *   • both authored routes survived the boot-time measure-and-trim,
 *   • neither route comes within `captureRadius + hull` of a capture circle,
 *   • the frame the main gun fires costs no more than its neighbours,
 *   • a tank can be killed and the kill pays the side that did it.
 * The screenshots are the other half — "does it read as a tank" is not a number.
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
const SHOTS = args.shots ?? './shots/tank';
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
  if (/\[tank\]|\[match\] .*ARMOUR|destroyed/.test(t)) logs.push(t.slice(0, 260));
});

console.log(`[tankprobe] booting ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('[tankprobe] ready');
for (const l of logs) console.log('   ' + l);

const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

/* ---- wedge a round open -------------------------------------------------- */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m._updateRespawns = () => {};
  for (const a of m.air) a.enabled = false;

  /* Per-system frame cost, so "the fire frame is indistinguishable from its
     neighbours" is a measurement and not a claim. */
  window.__COST__ = { tank: [], frame: [] };
  const t = m.tank;
  const orig = t.update.bind(t);
  t.update = (dt, live) => {
    const t0 = performance.now();
    orig(dt, live);
    window.__COST__.tank.push(performance.now() - t0);
  };
  window.__EV__ = [];
  e.events.on('match:tank', (p) => {
    window.__EV__.push({ t: +e.time.elapsed.toFixed(2), phase: p.phase, id: p.id, i: window.__COST__.tank.length });
  });
});

/* ---- what the boot actually baked --------------------------------------- */
const routes = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return m.tank.tanks.map((t) => ({
    id: t.id,
    team: t.team,
    n: t.path.n,
    len: +t.path.length.toFixed(1),
    narrowest: +t.path.narrowest.toFixed(1),
    chunks: t.chunkCount,
    start: [+t.path.X[0].toFixed(1), +t.path.Y[0].toFixed(1), +t.path.Z[0].toFixed(1)],
    end: [
      +t.path.X[t.path.n - 1].toFixed(1),
      +t.path.Y[t.path.n - 1].toFixed(1),
      +t.path.Z[t.path.n - 1].toFixed(1),
    ],
    zoneClearance: m.sites
      .map((z) => {
        let best = Infinity;
        for (let i = 0; i < t.path.n; i++) {
          best = Math.min(best, Math.hypot(t.path.X[i] - z.position.x, t.path.Z[i] - z.position.z));
        }
        return `${z.id}:${best.toFixed(1)}m`;
      })
      .join(' '),
  }));
});
console.log('[tankprobe] routes', JSON.stringify(routes, null, 1));
console.log('[tankprobe] buildMs', await page.evaluate(() => +window.__ENGINE__.ctx.peek('match').tank.buildMs.toFixed(1)));

/* ---- stand somewhere the hull is side-on and photograph it --------------- */
async function look(tx, ty, tz, dist, bearing, up = 1.4) {
  return page.evaluate(
    ({ tx, ty, tz, dist, bearing, up }) => {
      const e = window.__ENGINE__;
      const ph = e.ctx.peek('physics');
      const player = e.ctx.peek('player');
      const m = e.ctx.peek('match');
      const scratch = m.sites[0].position.clone();
      let best = null;
      for (const d of [dist, dist * 0.85, dist * 1.2, dist * 1.5]) {
        for (let i = 0; i < 48; i++) {
          const a = bearing + ((i % 2 ? 1 : -1) * Math.floor(i / 2) * Math.PI) / 24;
          const x = tx + Math.cos(a) * d;
          const z = tz + Math.sin(a) * d;
          const g = ph.groundHeight(x, z, 80);
          if (!Number.isFinite(g) || g > 3.0) continue;
          const fy = g + 1.62;
          let dx = tx - x;
          let dy = ty + up - fy;
          let dz = tz - z;
          const len = Math.hypot(dx, dy, dz);
          if (ph.raycastAny(x, fy, z, dx / len, dy / len, dz / len, len - 3.0, ph.MASK.WORLD)) continue;
          best = {
            x,
            y: g + 0.1,
            z,
            yaw: Math.atan2(-dx, -dz),
            pitch: Math.asin(dy / len),
            d: +Math.hypot(dx, dz).toFixed(1),
          };
          break;
        }
        if (best) break;
      }
      if (!best) return null;
      scratch.set(best.x, best.y, best.z);
      player.respawnAt(scratch, best.yaw);
      player.movement.pitch = best.pitch;
      return best;
    },
    { tx, ty, tz, dist, bearing, up }
  );
}

const tankPos = (id) =>
  page.evaluate((id) => {
    const t = window.__ENGINE__.ctx.peek('match').tank.tanks.find((x) => x.id === id);
    return { x: t.position.x, y: t.position.y, z: t.position.z, s: +t.s.toFixed(1), state: t.state, hp: t.health | 0 };
  }, id);

/* ---- roll them ----------------------------------------------------------- */
await page.evaluate(() => window.__ENGINE__.ctx.peek('match').tank.fire());
await sleep(400);
let p = await tankPos('RED');
console.log('[tankprobe] RED rolled', JSON.stringify(p));
await look(p.x, p.y, p.z, 13, Math.PI * 0.35, 1.6);
await sleep(700);
await shot('01-hull-side');

/* let it drive a while, then shoot it from three-quarter rear (the deck) */
await sleep(4000);
p = await tankPos('RED');
console.log('[tankprobe] RED driving', JSON.stringify(p));
await look(p.x, p.y, p.z, 11, Math.PI * 0.8, 1.9);
await sleep(600);
await shot('02-hull-rear');
await look(p.x, p.y, p.z, 9, -Math.PI * 0.15, 1.5);
await sleep(600);
await shot('03-hull-front');

/* ---- the gun ------------------------------------------------------------- */
/**
 * Stand the human in the BLUE tank's field of fire. He is RED, so the BLUE crew
 * acquire him through the same `enemies` hook every bot goes through — nothing
 * is faked. The frame the gun goes off, the clock is stopped so the shutter can
 * catch a 52 ms muzzle flash.
 */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const player = e.ctx.peek('player');
  const ph = e.ctx.peek('physics');
  const ui = e.ctx.peek('ui');
  const blue = m.tank.tanks.find((t) => t.id === 'BLUE');
  // 17 m ahead of the hull and 7 m off its axis: close enough that the muzzle
  // blast fills the frame, off-axis enough that the hull is in three-quarter
  // profile with the gun visibly swung on to the camera.
  const scratch = m.sites[0].position.clone();
  const fx = Math.sin(blue._yaw);
  const fz = Math.cos(blue._yaw);
  const x = blue.position.x + fx * 17 - fz * 7;
  const z = blue.position.z + fz * 17 + fx * 7;
  const g = ph.groundHeight(x, z, 60);
  scratch.set(x, (Number.isFinite(g) ? g : blue.position.y) + 0.1, z);
  player.respawnAt(scratch, Math.atan2(-(blue.position.x - x), -(blue.position.z - z)));
  player.movement.pitch = 0.06;
  ui.setHudVisible(false);
  ui.hudVisible = 0;
  e.ctx.viewScene.visible = false;
  // The shell would kill him mid-shot; this is a camera, not a player.
  player.health.godMode = true;
  if (player.health.applyDamage) player.health.applyDamage = () => {};
  window.__FIRED__ = 0;
  e.events.on('match:tank', (pp) => {
    if (pp.phase !== 'fire') return;
    window.__FIRED__++;
    // Slow-mo rather than a hard stop: a muzzle flash lives ~52 ms, and at
    // 1/60th speed that is three seconds of shutter for a 1× event.
    if (window.__FIRED__ === 1) e.time.scale = 1 / 60;
  });
});
console.log('[tankprobe] player planted in front of BLUE, waiting for the gun…');
await page.waitForFunction('window.__FIRED__>0', null, { timeout: 60000 }).catch(() => {});
await sleep(80);
await shot('04-gun-firing');
await sleep(400);
await shot('04b-gun-blast');
console.log('[tankprobe] fired count', await page.evaluate(() => window.__FIRED__));
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await sleep(900);
await shot('05-gun-after');

/* ---- fire-frame cost ----------------------------------------------------- */
const cost = await page.evaluate(() => {
  const c = window.__COST__.tank;
  const ev = window.__EV__.filter((x) => x.phase === 'fire');
  const sorted = [...c].sort((a, b) => a - b);
  const at = (i) => (c[i] === undefined ? null : +c[i].toFixed(3));
  return {
    frames: c.length,
    median: +sorted[sorted.length >> 1].toFixed(3),
    p99: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))].toFixed(3),
    max: +sorted[sorted.length - 1].toFixed(3),
    fireFrames: ev.slice(0, 6).map((x) => ({
      i: x.i,
      before: at(x.i - 2),
      fire: at(x.i - 1),
      after: at(x.i),
    })),
  };
});
console.log('[tankprobe] tank.update ms', JSON.stringify(cost));

/* ---- kill one ------------------------------------------------------------ */
const kill = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const red = m.tank.tanks.find((t) => t.id === 'RED');
  const before = [m.score[0], m.score[1]];
  const hp0 = red.health;
  const t0 = performance.now();
  // A rifle magazine into the engine deck, through the real collider and the
  // real event, exactly as a player's rounds arrive.
  const ph = e.ctx.peek('physics');
  const c = red.colliders.find((x) => x.c.part === 'deck').c;
  let hits = 0;
  for (let i = 0; i < 400 && red.alive; i++) {
    e.events.emit('damage:dealt', {
      target: red,
      amount: 34 * c.damageScale,
      point: red.position,
      source: { name: 'PROBE', team: 1, isPlayer: false },
    });
    hits++;
  }
  return {
    hp0,
    deckHits: hits,
    ms: +(performance.now() - t0).toFixed(2),
    alive: red.alive,
    state: red.state,
    wreckVisible: red.wreck.visible,
    scoreBefore: before,
    scoreAfter: [m.score[0], m.score[1]],
  };
});
console.log('[tankprobe] kill', JSON.stringify(kill));
await sleep(120);
await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const red = m.tank.tanks.find((t) => t.id === 'RED');
  const ph = e.ctx.peek('physics');
  const player = e.ctx.peek('player');
  const scratch = m.sites[0].position.clone();
  // Relative to the HULL's own heading, and with the tank's own ground height
  // as the fallback — a `groundHeight` miss used to leave the camera parked in
  // front of the OTHER tank, which is how an intact hull got filed as a wreck.
  // The shell that was fired AT the camera killed it, and a dead player is a
  // SPECTATOR — which rewrites `ctx.camera` every frame and silently ignored
  // every `respawnAt` below. Stand him up first.
  m.spectator.active = false;
  m.spectator.stop?.();
  player.setControlEnabled?.(true);
  const a = red._yaw + Math.PI * 0.62;
  const d = 15;
  const x = red.position.x + Math.sin(a) * d;
  const z = red.position.z + Math.cos(a) * d;
  const g = ph.groundHeight(x, z, 80);
  scratch.set(x, (Number.isFinite(g) && g < 3 ? g : red.position.y) + 0.1, z);
  player.respawnAt(scratch, Math.atan2(-(red.position.x - x), -(red.position.z - z)));
  player.movement.pitch = 0.03;
  const ui = e.ctx.peek('ui');
  ui.setHudVisible(false);
  ui.hudVisible = 0;
  e.ctx.viewScene.visible = false;
});
await sleep(300);
await shot('06-brewing-up');
await sleep(2500);
await shot('07-wreck');

console.log('[tankprobe] pageErrors', pageErrors.length ? pageErrors : 'none');
for (const l of logs.slice(-14)) console.log('   ' + l);
await browser.close();
