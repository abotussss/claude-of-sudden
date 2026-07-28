/**
 * INDOOR GATE — can a PLAYER actually get inside the buildings marked
 * `enterable: true`?
 *
 *   node tools/indoorcheck.mjs [--url=…]
 *
 * WHY. The map declares eight enterable buildings with rooms, stairs and doors,
 * and the player reports "屋内も入れない" — you cannot get in. `navcheck` cannot
 * catch this: it tests the BOT nav grid, which is a 2.5D height field that has
 * no idea whether a doorway is wide enough for the player capsule or whether a
 * prop has been dressed across it. Nothing else in the repo tests the player's
 * own collision against the interiors at all.
 *
 * So this drives the real player controller: stand outside each enterable
 * building, walk at the wall on the bearing of each of its doors, and report
 * whether the capsule finished INSIDE the footprint. A building nobody can walk
 * into is a failure, however good its interior looks in a screenshot.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const URL = args.url ?? 'http://127.0.0.1:4173/';

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const step = (n) => page.evaluate((n) => new Promise((r) => {
  let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

const list = await page.evaluate(() => {
  const w = window.__ENGINE__.ctx.peek('world');
  const B = w.layout?.BUILDINGS;
  if (!B || !w.buildings) return null;
  /**
   * Walk at the DOORS, not at the middle of each wall.
   *
   * The first version of this tool approached the centre of all four faces and
   * reported 8/8 unenterable. That was the tool's fault, not the map's: the
   * doors are authored per bay (`doorBays: { 1: 2, 3: 0 }`), so the middle of a
   * face is usually solid wall, and the capsule was correctly stopping against
   * it. `WorldSystem.buildings[i].doors` carries the real world position of
   * every door the builder actually cut.
   */
  return B.map((b, i) => ({
    id: b.id, enterable: !!b.enterable, x: b.x, z: b.z, w: b.w, d: b.d,
    doors: (w.buildings[i]?.doors ?? []).map((d) => ({ side: d.side, wp: d.wp })),
  })).filter((b) => b.enterable);
});
if (!list) {
  console.log('[indoorcheck] world does not expose layout/buildings');
  await browser.close(); process.exit(2);
}

await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 20; });
await step(140);
await page.evaluate(() => { window.__ENGINE__.ctx.time.scale = 1; });

const rows = [];
for (const b of list) {
  const tries = [];
  for (const door of b.doors) {
    await page.evaluate(([b, door]) => {
      const e = window.__ENGINE__, pl = e.ctx.peek('player'), w = e.ctx.peek('world');
      const V = e.ctx.peek('match').sites[0].position.constructor;
      const centre = w.levelToWorld(b.x, 0, b.z, new V());
      const d = new V(door.wp[0], door.wp[1], door.wp[2]);
      // stand 3 m outside, on the line from the building centre through the door
      const out = d.clone().sub(centre).setY(0).normalize().multiplyScalar(3).add(d);
      pl.respawnAt({ x: out.x, y: d.y + 0.2, z: out.z });
      // movement.yaw is the basis; forward is (-sin yaw, -cos yaw). There is no
      // setYaw() — writing player.yaw alone does nothing, which is what made the
      // first run of this tool meaningless.
      const yaw = Math.atan2(-(centre.x - out.x), -(centre.z - out.z));
      pl.movement.yaw = yaw;
      pl.yaw = yaw;
    }, [b, door]);
    await page.keyboard.down('KeyW');
    await step(110);
    await page.keyboard.up('KeyW');
    const r = await page.evaluate(([b]) => {
      const e = window.__ENGINE__, pl = e.ctx.peek('player'), w = e.ctx.peek('world');
      const q = pl.position ?? pl.camera.position;
      const l = w.worldToLevel(q.x, q.y, q.z, new q.constructor());
      return { in: Math.abs(l.x - b.x) < b.w / 2 - 0.3 && Math.abs(l.z - b.z) < b.d / 2 - 0.3,
               lx: +l.x.toFixed(1), lz: +l.z.toFixed(1) };
    }, [b]);
    tries.push({ ok: r.in, at: [r.lx, r.lz], side: door.side });
    if (r.in) break;
  }
  rows.push({ id: b.id, doors: b.doors.length, entered: tries.some((t) => t.ok),
              tried: tries.length, last: tries[tries.length - 1] ?? null, centre: [b.x, b.z] });
}

console.log('\n  building   enterable?   doors tried');
let fail = 0;
for (const r of rows) {
  if (!r.entered) fail++;
  console.log(`  ${r.id.padEnd(10)} ${(r.entered ? 'YES' : 'NO ').padEnd(12)} ${r.tried}/${r.doors}` +
    (r.entered ? '' : `   <-- CANNOT GET IN (ended ${r.last ? r.last.at : 'n/a'}, centre ${r.centre})`));
}
if (errs.length) console.log('\n[indoorcheck] page errors', errs.slice(0, 4));
console.log(fail ? `\n[indoorcheck] FAIL — ${fail}/${rows.length} enterable buildings cannot be entered`
                 : `\n[indoorcheck] PASS — all ${rows.length} enterable buildings can be walked into`);
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
