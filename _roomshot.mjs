/**
 * THE SAME FOUR ROOMS, FROM THE SAME FOUR PLACES, BEFORE AND AFTER.
 *
 *   node _roomshot.mjs --url=http://127.0.0.1:4310/?seed=3 --tag=after
 *
 * Clearance can be satisfied legally and still look wrong — a wardrobe pushed
 * into the middle of the floor passes every gate and reads as a room nobody
 * lives in. So the furnishing pass has to be LOOKED AT, and looked at from a
 * fixed camera or the two pictures are not comparable.
 *
 * The camera is derived from the building spec, not authored: it stands in one
 * corner of the ground-floor plan at eye height and looks at the opposite one,
 * so the frame is the room's long diagonal — the doorways, the walls and
 * whatever is standing on the floor between them. Writes shots/room-<id>-<tag>.png.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4310/';
const TAG = args.tag ?? 'shot';
const WANT = (args.only ? String(args.only).split(',') : ['W1', 'E1', 'E3', 'EC8']);

const browser = await chromium.launch({ headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 660 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  const m = e.ctx.peek('match'); if (m) m.update = () => {};
  e.ctx.peek('ui')?.banner?.hide?.();
  const ai = e.ctx.peek('ai'); if (ai) { ai.combatEnabled = false; try { ai.clearAgents(); } catch { /* ok */ } }
});

const step = (n) => page.evaluate((n) => new Promise((r) => {
  let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

const seed = await page.evaluate(() => window.__ENGINE__.levelSeed);
for (const id of WANT) {
  const ok = await page.evaluate((id) => {
    const e = window.__ENGINE__, c = e.ctx, w = c.peek('world');
    const B = w.layout?.BUILDINGS ?? [];
    const bi = B.findIndex((b) => b.id === id);
    if (bi < 0) return null;
    const spec = B[bi], info = w.buildings[bi];
    const t = spec.t ?? 0.34;
    const iw = spec.w - t * 2, id_ = spec.d - t * 2;
    const y = (info.floorY?.[0] ?? 0) + 0.13;
    const V = c.camera.position.constructor;
    const from = w.levelToWorld(spec.x - iw / 2 + 0.7, y + 1.62, spec.z - id_ / 2 + 0.7, new V());
    const to = w.levelToWorld(spec.x + iw / 2 - 0.7, y + 1.0, spec.z + id_ / 2 - 0.7, new V());
    c.camera.position.copy(from);
    c.camera.lookAt(to);
    c.camera.fov = 78; c.camera.updateProjectionMatrix();
    const pl = c.peek('player');
    if (pl) { pl.movementLocked = true; pl.setControlEnabled?.(false); }
    return true;
  }, id);
  if (!ok) { console.log(`  ${id}: not in this layout`); continue; }
  await step(30);
  await page.screenshot({ path: `shots/room-${id}-${TAG}.png` });
  console.log(`  shots/room-${id}-${TAG}.png   (seed ${seed})`);
}
if (errs.length) console.log('[roomshot] page errors', errs.slice(0, 4));
await browser.close();
