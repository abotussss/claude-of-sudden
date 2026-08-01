/**
 * EYE-LEVEL PHOTOGRAPHY OF THE COURTYARD PAIR — E against C.
 *
 * E is authored as ρ(C) and every gate in this repo is a number; no number can
 * say whether the point reads as a place to fight over. So: four frames from ON
 * each point and one from the lane mouth, plus one frame of the HUD with all
 * five zones live, because a fifth chip that overflows the strip is a bug you
 * shipped.
 *
 * Poses are derived from the RESOLVED zone centre, so they follow the point
 * rather than repeating an authored number that may have moved.
 *
 *   node _eshot.mjs <url> <outDir>
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4271/';
const OUT = process.argv[3] ?? 'shots/esite';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.time.scale = 1;
  const ai = e.ctx.peek('ai');
  ai.combatEnabled = false;
  ai.protect(e.ctx.peek('player'), 9999);
});
await page.mouse.click(700, 400);
await page.waitForTimeout(400);

console.log('live zones:', await page.evaluate(() => window.__ENGINE__.ctx.peek('match').sites.map((s) => s.id)));

/** [label, standing offset in LEVEL units from the centre, aim offset] */
const POSES = [
  ['on-point-lookN', [0, 0], [0, 14]],
  ['on-point-lookE', [0, 0], [14, 0]],
  ['on-point-lookS', [0, 0], [0, -14]],
  ['on-point-lookW', [0, 0], [-14, 0]],
  ['from-lane-north', [0, 9], [0, -16]],
];

for (const id of (process.argv[4] ?? 'E,C').split(',')) {
  for (const [label, off, aim] of POSES) {
    const info = await page.evaluate(([zid, off, aim]) => {
      const e = window.__ENGINE__;
      const m = e.ctx.peek('match');
      const p = e.ctx.peek('player');
      const w = e.ctx.peek('world');
      const g = e.ctx.peek('ai').grid;
      const z = (m.allZones ?? m.sites).find((s) => s.id === zid);
      if (!z) return { missing: true };
      const V3 = z.position.constructor;
      const S = w.layout.SCALE;
      const lc = w.worldToLevel(z.position.x, z.position.y, z.position.z, new V3());
      const at = w.levelToWorld(lc.x + off[0] * S, 0, lc.z + off[1] * S, new V3());
      const to = w.levelToWorld(lc.x + (off[0] + aim[0]) * S, 0, lc.z + (off[1] + aim[1]) * S, new V3());
      const ci = g.nearest(at.x, at.z, z.position.y, 4, 3);
      const eye = ci >= 0 ? new V3(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0)) : at;
      p.movement.yaw = Math.atan2(to.x - eye.x, -(to.z - eye.z));
      p.movement.pitch = 0.02;
      p.movement.velocity.set(0, 0, 0);
      p.movement.teleport(eye.x, eye.y + 0.05, eye.z);
      return {
        world: [+z.position.x.toFixed(1), +z.position.z.toFixed(1)],
        level: [+(lc.x / S).toFixed(1), +(lc.z / S).toFixed(1)],
        stand: z.stand?.length ?? 0,
      };
    }, [id, off, aim]);
    if (info.missing) { console.log(`zone ${id}: NOT IN THE LIST`); break; }
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/zone-${id}-${label}.png` });
    console.log(`${OUT}/zone-${id}-${label}.png  world ${JSON.stringify(info.world)} level ${JSON.stringify(info.level)} · ${info.stand} standing points`);
  }
}

/**
 * THE HUD WITH EVERY ZONE LIVE. `MAX_ZONES` in src/ui/round.js is 5 and the
 * fifth live zone is D, which only arrives when the cathedral comes down — so
 * the strip is forced open here rather than waited for.
 */
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const d = (m.allZones ?? []).find((z) => z.id === 'D');
  if (d && !m.sites.includes(d)) m._setZoneLive(d, true);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/hud-five-zones.png` });
console.log(`${OUT}/hud-five-zones.png  live: ${await page.evaluate(() => window.__ENGINE__.ctx.peek('match').sites.map((s) => s.id).join(','))}`);

if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 5));
await browser.close();
