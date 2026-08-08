/**
 * EACH CAPTURE ZONE, FROM 150 m AND FROM ITS OWN CIRCLE, in the dark build.
 *
 * The zone positions are the RESOLVED ones off `match.allZones` (or `match.sites`
 * plus the locked one) — never an authored copy, because `ensureReachable` may
 * relocate a zone up to 35 m and say nothing.
 *
 *   node _sitescape.mjs <tag>      writes shots/sites-<tag>/<zone>-{far,in}.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const TAG = process.argv[2] ?? 'x';
const PORT = process.argv[3] ?? '4614';
const DIR = `shots/sites-${TAG}`;
mkdirSync(DIR, { recursive: true });
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`http://127.0.0.1:${PORT}/?map=plains&capture=1`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));
// freeze the match so nothing walks into frame, and take the HUD off
await p.evaluate(() => {
  const c = window.__ENGINE__.ctx;
  const m = c.peek('match'); if (m) m.update = () => {};
  const ui = c.peek('ui'); if (ui?.root) ui.root.style.display = 'none';
});
const zones = await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const all = m.allZones ?? m.sites ?? [];
  return all.map((z) => ({ id: z.id, name: z.name, x: +z.position.x.toFixed(1), y: +z.position.y.toFixed(2), z: +z.position.z.toFixed(1) }));
});
console.log('resolved zones:', JSON.stringify(zones));
const wait = (n) => p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
for (const zn of zones) {
  for (const mode of ['far', 'in']) {
    await p.evaluate(({ zn, mode }) => {
      const c = window.__ENGINE__.ctx, w = c.peek('world'), pl = c.peek('player');
      // FAR: 150 m from the zone, INBOARD — along the bearing from the zone
      // toward the map centre, which is the approach a player actually crosses
      // and the only side with 150 m of map on it (a zone is 157-176 m out and
      // the rim is at r 178, so stepping outboard puts the camera in the
      // mountain — that is what the first cut of this probe photographed).
      // D IS the centre, so it takes the north approach on a fixed bearing.
      // …AND SWUNG 35° OFF IT, because the inward bearing from a corner zone
      // passes through D: A is 157 m from the origin, so 150 m inboard stands
      // the camera 7 m from the centre, i.e. inside the fortress, and the first
      // cut of this probe photographed the fortress wall five times.
      const len = Math.hypot(zn.x, zn.z);
      let ux = len > 1 ? -zn.x / len : 1, uz = len > 1 ? -zn.z / len : 0;
      if (len > 1) {
        const c = Math.cos(0.61), s = Math.sin(0.61);
        [ux, uz] = [ux * c - uz * s, ux * s + uz * c];
      }
      const R = mode === 'far' ? 150 : 12;
      const ex = zn.x + ux * R, ez = zn.z + uz * R;
      const y = w.level.groundY(ex, ez) + (mode === 'far' ? 3.2 : 1.65);
      const dx = zn.x - ex, dz = zn.z - ez;
      const yaw = Math.atan2(dx, dz) + Math.PI;   // three's forward is -Z
      const pitch = mode === 'far' ? -0.015 : 0.02;
      pl.teleport?.({ x: ex, y, z: ez }, yaw);
      if (pl.movement?.teleport) { pl.movement.teleport(ex, y, ez); pl.movement.yaw = yaw; pl.movement.pitch = pitch; }
      c.camera.rotation.order = 'YXZ';
      c.camera.position.set(ex, y, ez);
      c.camera.rotation.y = yaw; c.camera.rotation.x = pitch; c.camera.rotation.z = 0;
    }, { zn, mode });
    // Long, because the auto-exposure on this map is an EYE: 90 frames left the
    // far shots black and the near ones blown out, which is the camera adapting
    // rather than the map changing.
    await wait(260);
    await p.screenshot({ path: `${DIR}/${zn.id}-${mode}.png` });
  }
  console.log(`  ${zn.id} ${zn.name} @ ${zn.x},${zn.z}`);
}
console.log('pageerrors', errs.length, errs.slice(0, 3));
await b.close();
