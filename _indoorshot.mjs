/**
 * PICTURES OF BOTS INSIDE BUILDINGS.
 *
 *   node _indoorshot.mjs [--url=…] [--shots=4] [--scale=4]
 *
 * Runs a live match, waits until an alive bot is strictly inside an enterable
 * footprint, freezes the clock, puts the camera in the same room with line of
 * sight to him and presses the shutter. Writes shots/indoor-N.png and prints
 * who it caught, where, and what the nav grid says about the cell he is on —
 * so the picture can be checked against the number.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4216/';
const SHOTS = Number(args.shots ?? 4);
const SCALE = Number(args.scale ?? 4);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate((s) => { window.__ENGINE__.time.scale = s; }, SCALE);
await page.waitForFunction(
  () => window.__ENGINE__.ctx.peek('match').phase === 'live',
  null,
  { timeout: 180000 }
);

/** Hand the camera over once; the player system will not fight us for it. */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
});

const seen = new Set();
const taken = [];
for (let n = 0; n < SHOTS * 40 && taken.length < SHOTS; n++) {
  const found = await page.evaluate((already) => {
    const e = window.__ENGINE__;
    const world = e.ctx.peek('world');
    const ai = e.ctx.peek('ai');
    const phys = e.ctx.peek('physics');
    const g = ai.grid;
    const V3 = e.ctx.camera.position.constructor;
    const l = new V3(), from = new V3(), to = new V3();
    const B = world.layout.BUILDINGS.filter((b) => b.enterable);
    for (const a of ai.agents) {
      if (!a.alive) continue;
      world.worldToLevel(a.position.x, a.position.y, a.position.z, l);
      let hit = null;
      for (const b of B) {
        if (Math.abs(l.x - b.x) < b.w / 2 - 0.9 && Math.abs(l.z - b.z) < b.d / 2 - 0.9) { hit = b; break; }
      }
      if (!hit || already.includes(hit.id)) continue;
      // stand the camera off him along the line to the middle of his own floor
      const mid = world.levelToWorld(hit.x, a.position.y, hit.z, new V3());
      let dx = mid.x - a.position.x, dz = mid.z - a.position.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      to.set(a.position.x, a.position.y + 1.25, a.position.z);
      for (const d of [4.2, 3.4, 2.6, 5.0, 6.0]) {
        for (const side of [0, 0.7, -0.7]) {
          const cx = a.position.x + dx * d - dz * side;
          const cz = a.position.z + dz * d + dx * side;
          from.set(cx, a.position.y + 1.55, cz);
          if (!phys.checkCapsule(from, from, 0.3, phys.MASK.WORLD)) continue;
          if (!phys.lineOfSight(from, to, phys.MASK.SIGHT)) continue;
          const ci = g.nearest(a.position.x, a.position.z, a.position.y, 1, 1.0);
          return {
            name: a.name, team: a.team, building: hit.id,
            level: [+l.x.toFixed(1), +l.y.toFixed(2), +l.z.toFixed(1)],
            state: a.state, objective: a.objective?.mode ?? 'none',
            onCache: !!a._matchCache,
            navCell: ci >= 0 ? { flag: g.flags[ci], floor: +g.floor[ci].toFixed(2) } : null,
            cam: [cx, a.position.y + 1.55, cz],
            look: [to.x, to.y, to.z],
          };
        }
      }
    }
    return null;
  }, [...seen]);

  if (!found) {
    await page.waitForTimeout(400);
    continue;
  }
  // freeze the world, aim, let the frame settle, shoot
  await page.evaluate((f) => {
    const e = window.__ENGINE__;
    e.time.scale = 0.02;   // nearly frozen, but the actor LOD and the skinning still tick
    const cam = e.camera;
    cam.position.set(f.cam[0], f.cam[1], f.cam[2]);
    cam.lookAt(f.look[0], f.look[1], f.look[2]);
    cam.updateMatrixWorld(true);
    e.ctx.peek('player')?.teleport?.(cam.position, cam.rotation);
  }, found);
  await page.evaluate(() => new Promise((d) => {
    let i = 0;
    const t = () => (++i >= 30 ? d() : requestAnimationFrame(t));
    requestAnimationFrame(t);
  }));
  const path = `shots/indoor-${taken.length + 1}-${found.building}.png`;
  await page.screenshot({ path });
  seen.add(found.building);
  taken.push({ ...found, path });
  console.log(`[shot] ${path} — ${found.name} (team ${found.team}) inside ${found.building} ` +
    `at level ${found.level.join(', ')} · state ${found.state} · objective ${found.objective}` +
    `${found.onCache ? ' (cache leg)' : ''} · nav cell ${JSON.stringify(found.navCell)}`);
  await page.evaluate((s) => { window.__ENGINE__.time.scale = s; }, SCALE);
  await page.waitForTimeout(600);
}

console.log(`\n[shot] ${taken.length} of ${SHOTS} taken`);
if (errors.length) console.log('[shot] errors', errors.slice(0, 4));
await browser.close();
