/**
 * DOES ANYTHING STAY LIT OVER A BUILDING THAT NO LONGER EXISTS?
 *
 *   BASE=http://127.0.0.1:4626/ node _tzlights.mjs
 *
 * `Assembler.setScopeVisible` switches merged triangle ranges and instance
 * slots. It does NOT touch `A.lights` — those are `THREE.PointLight`s added
 * straight to the level root in `finalize` — so a lamp authored inside a shell
 * scope keeps burning after the shell is gone. This lists every punctual light
 * within 40 m of the tower with its height over the plain, before and after.
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4626/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${BASE}?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  const rec = w.demolitions.find((r) => r.id === 'NF-TOWER');
  const T = rec.position;
  const scan = () => {
    const rows = [];
    e.ctx.scene.traverse((o) => {
      if (!o.isPointLight) return;
      const p = o.getWorldPosition(new (o.position.constructor)());
      if (Math.hypot(p.x - T.x, p.z - T.z) > 40) return;
      rows.push({
        at: [+p.x.toFixed(1), +p.y.toFixed(2), +p.z.toFixed(1)],
        overPlain: +(p.y - w.groundHeight(p.x, p.z)).toFixed(2),
        intensity: +o.intensity.toFixed(1), distance: +o.distance.toFixed(0),
        visible: o.visible,
      });
    });
    rows.sort((a, c) => c.at[1] - a.at[1]);
    return rows;
  };
  // A FRAME BETWEEN THE SWITCH AND THE READ. `render._cullLights` is what
  // writes `light.visible` and `light.intensity`, and it runs inside
  // `render.render()` — so a scan taken in the same tick as `setDown` reports
  // the flags of the frame BEFORE the switch and says nothing about the state
  // being tested. Two frames, so the cull that adopts the new intensity has
  // also been applied.
  const settle = () => new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)));
  await settle();
  const before = scan();
  rec.setDown(true);
  await settle();
  const after = scan();
  rec.setDown(false);
  await settle();
  const restored = scan();
  /**
   * AND THE ROSTER THE RECORD ACTUALLY SWITCHES. Every lamp authored inside
   * the shell scope has to be on `rec.lights` or it is still the bug — and the
   * distance-culled ones all read intensity 0 from a camera at spawn whatever
   * happens to them, so the scan above cannot tell a switched lamp from a
   * faded one. This reads the switch itself.
   */
  const roster = (rec.lights ?? []).map((l) => ({
    at: [+l.position.x.toFixed(1), +l.position.y.toFixed(1), +l.position.z.toFixed(1)],
    authored: l.userData.owAuthoredIntensity ?? null,
    downTo: null,
  }));
  rec.setDown(true);
  (rec.lights ?? []).forEach((l, i) => { roster[i].downTo = l.intensity; });
  rec.setDown(false);
  (rec.lights ?? []).forEach((l, i) => { roster[i].upTo = l.intensity; });
  return { before, after, restored, roster };
});
console.log('--- INTACT');
for (const r of out.before) console.log('   ', JSON.stringify(r));
console.log('--- RAZED');
for (const r of out.after) console.log('   ', JSON.stringify(r));
console.log('--- REBUILT (the round reset\'s setDown(false))');
for (const r of out.restored) console.log('   ', JSON.stringify(r));
console.log(`--- THE RECORD'S OWN LAMP ROSTER (${out.roster.length} lamps)`);
for (const r of out.roster) console.log('   ', JSON.stringify(r));
console.log('pageerrors', errs.length, errs[0] ?? '');
await b.close();
