/**
 * CATHEDRAL PROBE — can anything stand in it, and can A* get there?
 *
 * Everything the D-site question turns on, measured rather than assumed:
 * whether the nave floor is in the height field at all, what the collapse
 * changes about it, and whether a spawn can path to the middle of the building
 * before and after.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4251/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (/\[airstrike\]|\[match\] site|interiorVolumes|cathedral/i.test(t)) console.log('  ' + t.slice(0, 220));
});
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const survey = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('world');
    const ai = e.ctx.peek('ai');
    const ph = e.ctx.peek('physics');
    const m = e.ctx.peek('match');
    const g = ai.grid;
    const P = (lx, lz) => w.levelToWorld(lx, 0, lz, m.sites[0].position.clone());
    const rows = [];
    // The cathedral is authored level x -10..10, z -16..14 (times 1.5).
    for (const [lx, lz] of [
      [0, -1], [0, -12], [0, 10], [-9, -1], [9, -1], [0, -21], [0, 19], [-16, -1], [16, -1],
    ]) {
      const p = P(lx * 1.5, lz * 1.5);
      const ix = g.cellX(p.x);
      const iz = g.cellZ(p.z);
      const i = g.index(ix, iz);
      rows.push({
        level: [lx, lz],
        world: [+p.x.toFixed(1), +p.z.toFixed(1)],
        flag: g.flags[i],
        floor: +g.floor[i].toFixed(2),
        enc: g.enclosure[i],
        groundY: +ph.groundHeight(p.x, p.z, 60).toFixed(2),
      });
    }
    // A* from the attack spawn to the nave centre.
    const out = [];
    const centre = P(0, -1.5);
    centre.y = g.floor[g.index(g.cellX(centre.x), g.cellZ(centre.z))] ?? 0;
    const from = m.spawns.attack[7].position;
    const len = g.findPath(from, centre, out);
    return {
      grid: { nx: g.nx, nz: g.nz, cell: g.cell ?? g.cellSize },
      interiors: (w.interiorVolumes ?? []).map((v) => v.building),
      rows,
      pathToNave: +len.toFixed(1),
    };
  });

console.log('--- INTACT ---');
console.log(JSON.stringify(await survey(), null, 1));

await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  for (const a of m.air) a.enabled = false;
  m.airstrike.enabled = true;
  m.airstrike.callCathedralCollapse();
});
await page.waitForTimeout(16000);
console.log('--- AFTER THE COLLAPSE ---');
console.log(JSON.stringify(await survey(), null, 1));
await browser.close();
