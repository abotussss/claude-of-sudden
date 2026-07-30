/**
 * FRIEND OR FOE IN A REAL MATCH — not staged.
 *
 *   node _livefoe.mjs --port=4231
 *
 * Runs the match at 6x until men are actually shooting at each other, freezes,
 * puts the camera behind a live friendly looking down his line, and shoots.
 * Proves the brackets and the tick come up on bots `match` spawned and `ai`
 * drives, through the real spotting rule, rather than on two men a harness put
 * on the ground.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true];
}));
const PORT = Number(args.port ?? 4231);
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e.message)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
await page.evaluate(() => { window.__ENGINE__.time.scale = 6; });
await page.waitForFunction(() => window.__ENGINE__.ctx.peek('match').phase === 'live', null, { timeout: 240000 });
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('ai').protect(e.ctx.peek('player'), 99999);
});

const pump = (n) => page.evaluate((k) => new Promise((d) => {
  let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);

let taken = 0;
for (let n = 0; n < 200 && taken < 3; n++) {
  const shot = await page.evaluate(() => {
    const e = window.__ENGINE__, ctx = e.ctx;
    const ai = ctx.peek('ai'), phys = ctx.peek('physics'), player = ctx.peek('player');
    const V3 = ctx.camera.position.constructor;
    const now = ctx.time.elapsed;
    // a live hostile somebody's side genuinely has, and a friendly near him
    const host = ai.agents.filter((a) => a.alive && a.team !== ai.playerTeam && now - (a.spottedAt ?? -1e9) < 2);
    if (!host.length) return null;
    const h = host[0];
    const fr = ai.agents.filter((a) => a.alive && a.team === ai.playerTeam)
      .sort((a, x) => a.position.distanceToSquared(h.position) - x.position.distanceToSquared(h.position))[0];
    if (!fr) return null;
    const d = fr.position.distanceTo(h.position);
    if (d < 8 || d > 60) return null;
    // stand behind the friendly, looking past him at the hostile
    const dir = new V3().subVectors(h.position, fr.position).normalize();
    const eye = new V3(fr.position.x - dir.x * 6, fr.position.y + 1.7, fr.position.z - dir.z * 6);
    const aim = new V3(h.position.x, h.position.y + 1.1, h.position.z);
    if (!phys.lineOfSight(eye, aim, phys.MASK.SIGHT)) return null;
    e.time.scale = 0.02;
    const cam = ctx.camera;
    cam.position.copy(eye); cam.lookAt(aim); cam.updateMatrixWorld(true);
    player.teleport?.(cam.position, cam.rotation);
    return { range: +d.toFixed(1), hostiles: host.length, name: h.name };
  });
  if (!shot) { await page.waitForTimeout(350); continue; }
  await pump(40);
  const marks = await page.evaluate(() => {
    const ui = window.__ENGINE__.ctx.peek('ui');
    return { brackets: ui.markers.targetCount };
  });
  const path = `shots/teamread/live-${++taken}.png`;
  await page.screenshot({ path });
  console.log(`[live] ${path} range ${shot.range}m · ${shot.hostiles} live contacts · ${marks.brackets} brackets drawn`);
  await page.evaluate(() => { window.__ENGINE__.time.scale = 6; });
  await page.waitForTimeout(900);
}
if (errs.length) console.log('[live] ERRORS', errs.slice(0, 4));
else console.log('[live] no pageerror');
await b.close();
