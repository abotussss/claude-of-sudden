/**
 * WHAT IS STANDING IN THE OPEN BREACH? Four of the ten records report a solid
 * at wall-face + 0.34 m with the wall open. This asks what it is, and — the
 * question that actually matters — whether the real player capsule can get
 * through the hole once it is open.
 *
 *   node _breachwhy.mjs [--url=…] [--seed=N]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
  })
);
const BASE = args.url ?? 'http://127.0.0.1:4422/';
const url = BASE + (args.seed ? `?seed=${args.seed}` : '');

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 540 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const phys = e.ctx.peek('physics');
  w.breachAll(true);

  const rows = [];
  for (const b of w.breaches) {
    const r = { id: b.id, spec: `${b.holeW.toFixed(1)}x${b.holeH.toFixed(1)}` };
    /**
     * A SWEPT CAPSULE THROUGH THE HOLE, which is the only test that decides
     * whether this is a door or a window. 0.32 m radius is the player, walked
     * from 2.0 m outside to 1.6 m inside in 0.2 m steps at stance height.
     */
    let blocked = null;
    for (let s = -2.0; s <= 1.6 && blocked === null; s += 0.2) {
      const p = b.position.clone().addScaledVector(b.normal, -s);
      // feet on the spill; the capsule's own centre is 0.9 m up
      p.y = 0.145 + 0.9;
      if (phys.sphereCast ? phys.sphereCast(p, 0.32) : phys.overlapSphere?.(p, 0.32)) blocked = +s.toFixed(1);
    }
    r.capsuleBlockedAt = blocked;

    // …and what the obstruction actually is, on the ray the other probe fires.
    const from = b.position.clone().addScaledVector(b.normal, 3.0);
    from.y = 0.145 + 1.2;
    const hit = phys.raycast(from, b.normal.clone().negate(), 7.0, phys.MASK?.CHARACTER);
    r.hit = hit?.hit ? `${hit.distance.toFixed(2)} ${hit.surface ?? '?'}` : null;
    if (hit?.hit) {
      r.hitAt = [+hit.point.x.toFixed(2), +hit.point.y.toFixed(2), +hit.point.z.toFixed(2)];
      // level-space, so it can be read against layout.js
      const lv = w.worldToLevel(hit.point.x, hit.point.y, hit.point.z, hit.point.clone());
      const S = w.layout.SCALE;
      r.hitLevel = [+(lv.x / S).toFixed(1), +(lv.z / S).toFixed(1)];
    }
    // Is the ray clear a metre to either side of the opening's centre line?
    for (const off of [-1.6, 1.6]) {
      const f2 = b.position.clone().addScaledVector(b.normal, 3.0).addScaledVector(b.along, off);
      f2.y = 0.145 + 1.2;
      const h2 = phys.raycast(f2, b.normal.clone().negate(), 7.0, phys.MASK?.CHARACTER);
      r[`off${off}`] = h2?.hit ? h2.distance.toFixed(2) : 'clear';
    }
    rows.push(r);
  }
  return rows;
});
console.table(out);
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 4));
await browser.close();
