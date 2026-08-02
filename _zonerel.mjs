/**
 * TASK 1 PHOTOGRAPHY — a zone the player HOLDS and a zone he does NOT, from the
 * point and from far enough that only the marker is on screen.
 *   node _zonerel.mjs <url> <outDir>
 * Forces A = player's, B = enemy's, C (if present) = neutral, then stands the
 * player at a measured distance and photographs the marker, the compass and the
 * minimap in one frame.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.argv[2] ?? 'http://127.0.0.1:4380/?seed=7';
const OUT = process.argv[3] ?? 'shots/zonerel';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 8; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 180000 });
const setup = await page.evaluate(() => {
  const e = window.__ENGINE__; e.time.scale = 1;
  const ai = e.ctx.peek('ai'); ai.combatEnabled = false; ai.protect(e.ctx.peek('player'), 9999);
  const m = e.ctx.peek('match');
  const me = m.playerTeam;
  const out = [];
  m.sites.forEach((z, i) => {
    const own = i === 0 ? me : i === 1 ? 1 - me : -1;
    z.owner = own;
    m.marks?.setOwner(z, own);
    out.push({ id: z.id, owner: own, mine: own === me, pos: [+z.position.x.toFixed(1), +z.position.z.toFixed(1)] });
  });
  return { playerTeam: me, zones: out };
});
console.log('setup', JSON.stringify(setup));
await page.mouse.click(700, 400); await page.waitForTimeout(400);

/** Stand `d` metres from zone `id` on the level +X axis and look at it. */
async function shoot(id, d, tag) {
  const info = await page.evaluate(([zid, dist]) => {
    const e = window.__ENGINE__; const m = e.ctx.peek('match'); const p = e.ctx.peek('player');
    const ai = e.ctx.peek('ai'); const g = ai.grid;
    const z = m.sites.find((s) => s.id === zid); const V3 = z.position.constructor;
    // walk outward along +X from the zone until the nav grid has a cell at ~dist
    let best = null; let bestErr = 1e9;
    for (let a = 0; a < 32; a++) {
      const th = (a / 32) * Math.PI * 2;
      for (let r = dist - 6; r <= dist + 6; r += 1.5) {
        const x = z.position.x + Math.cos(th) * r;
        const zz = z.position.z + Math.sin(th) * r;
        const ci = g.nearest(x, zz, z.position.y, 3, 3);
        if (ci < 0) continue;
        const cx = g.worldX(ci % g.nx); const cz = g.worldZ((ci / g.nx) | 0);
        const real = Math.hypot(cx - z.position.x, cz - z.position.z);
        const err = Math.abs(real - dist);
        if (err < bestErr) { bestErr = err; best = { x: cx, y: g.floor[ci], z: cz, real }; }
      }
    }
    if (!best) return null;
    // movement._fwd is (-sin yaw, 0, -cos yaw) — @see src/player/movement.js
    p.movement.yaw = Math.atan2(-(z.position.x - best.x), -(z.position.z - best.z));
    p.movement.pitch = 0.02; p.movement.velocity.set(0, 0, 0);
    p.movement.teleport(best.x, best.y + 0.05, best.z);
    return { dist: +best.real.toFixed(1), owner: z.owner, me: m.playerTeam };
  }, [id, d]);
  if (!info) { console.log(`zone ${id} @${d}m — no nav cell`); return; }
  await page.waitForTimeout(1000);
  const path = `${OUT}/zone-${id}-${tag}.png`;
  await page.screenshot({ path });
  // read the live marker colours straight off the DOM, so the photograph is
  // corroborated numerically rather than trusted
  const dom = await page.evaluate(() => {
    const mk = [...document.querySelectorAll('.ow-mk')].filter((n) => n.style.display !== 'none')
      .map((n) => ({ l: n.querySelector('.ow-mk-letter')?.textContent, d: n.querySelector('.ow-mk-dist')?.textContent, c: n.style.color }));
    const cmp = [...document.querySelectorAll('.ow-compass-obj')].filter((n) => n.style.display !== 'none')
      .map((n) => ({ l: n.textContent, c: n.style.background }));
    return { mk, cmp };
  });
  console.log(`${path}  ${info.dist}M owner=${info.owner} me=${info.me}  markers=${JSON.stringify(dom.mk)}  compass=${JSON.stringify(dom.cmp)}`);
}

for (const [id, tag, d] of [['A', 'mine-close', 8], ['A', 'mine-far', 46], ['C', 'theirs-close', 8], ['C', 'theirs-far', 46]]) {
  await shoot(id, d, tag);
}
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 5));
await browser.close();
