/**
 * WHAT THE WHOLE CATHEDRAL EVENT COSTS, FRAME BY FRAME, against its neighbours.
 *
 *   node _cathcost.mjs [--url=…]
 *
 * The discipline is "bake at boot, swap at fire time", and the only thing that
 * proves it is the length of the frames the event lands on measured against the
 * frames either side. This runs the REAL event — `_beginCathedralEvent` and then
 * `_updateCathedralEvent` off the engine's own clock — and stamps every frame on
 * which something fired: the salvo's three bays, each of the twenty barrage
 * shells, the aeroplanes, the shell swap and D opening.
 *
 * Neighbourhood is the MEDIAN of the ten frames either side, so one heavy frame
 * does not raise its own baseline.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4272/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const w = e.ctx.peek('world');
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  // The event only runs inside a LIVE round; fired during the warm-up the round
  // reset stands the church back up. Same reason `_salvoshot.mjs` waits.
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  // Park the camera in the mid street looking at the cathedral, so the frames
  // being timed are frames that are actually DRAWING the event.
  const V3 = e.camera.position.constructor;
  const from = w.levelToWorld(0, 0, 54, new V3());
  const ph = e.ctx.peek('physics');
  const h = ph.raycast(from.x, 60, from.z, 0, -1, 0, 90, ph.MASK.WORLD);
  e.camera.position.set(from.x, (h?.hit ? h.point.y : 0) + 1.62, from.z);
  e.camera.lookAt(new V3(0, 8, 0));
  e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);

  const frames = [];
  const marks = [];
  let n = 0;
  let last = performance.now();
  // Wrap the two things that fire, so a mark is the frame index they ran on.
  const shell = m._cathShell.bind(m);
  m._cathShell = (i) => { marks.push([n, 'barrage shell ' + (i + 1)]); return shell(i); };
  const beat = m._cathBeat.bind(m);
  m._cathBeat = (k) => { marks.push([n, 'BEAT ' + k]); return beat(k); };
  const fire = m.airstrike.fire.bind(m.airstrike);
  m.airstrike.fire = (i, g) => { marks.push([n, 'SALVO SITE ' + (m.airstrike.sites[i]?.id ?? i)]); return fire(i, g); };

  await new Promise((res) => {
    const tick = () => {
      const now = performance.now();
      frames.push(+(now - last).toFixed(2));
      last = now;
      n++;
      if (n === 60) m._beginCathedralEvent(0, 0.44);
      if (n >= 60 + 60 * 26) return res();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return { frames, marks, razed: !!w.cathedral?.razed, dLive: !!m.sites?.some?.((s) => s.id === 'D') };
});
await browser.close();

const f = out.frames;
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return +(s[s.length >> 1] ?? 0).toFixed(1);
};
const around = (i) => median([...f.slice(Math.max(0, i - 10), i), ...f.slice(i + 1, i + 11)]);
console.log(`[cathcost] ${f.length} frames sampled; cathedral razed=${out.razed}, D live=${out.dLive}`);
console.log('  frame   ms     neighbourhood median   what fired');
const byFrame = new Map();
for (const [i, what] of out.marks) {
  if (!byFrame.has(i)) byFrame.set(i, []);
  byFrame.get(i).push(what);
}
let worst = 0;
let worstAt = -1;
for (const [i, whats] of [...byFrame.entries()].sort((a, b) => a[0] - b[0])) {
  const ms = f[i] ?? 0;
  if (ms > worst) { worst = ms; worstAt = i; }
  console.log(`  ${String(i).padStart(5)}  ${String(ms).padStart(6)}  ${String(around(i)).padStart(14)}          ${whats.join(' + ')}`);
}
const quiet = median(f.slice(10, 55));
console.log(`[cathcost] quiet-frame median before the event: ${quiet} ms`);
console.log(`[cathcost] heaviest event frame: ${worst} ms at frame ${worstAt} (neighbourhood median ${around(worstAt)} ms)`);
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
