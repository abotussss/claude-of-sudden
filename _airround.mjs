/**
 * AIR ROUND — one round at REAL TIME (no clock scaling), reporting every air
 * event with the HUD state at that instant, plus the fire-frame cost.
 *
 *   node _airround.mjs [--url=…] [--seconds=150]
 *
 * WHY REAL TIME. `tools/matchtest.mjs` runs the match on `time.scale` to get
 * through rounds quickly, and that is the right tool for the round machine — but
 * this feature's whole claim is about what a player perceives in the seconds
 * around an event, and a 6x clock changes the telegraph, the frame budget and
 * the HUD's own damping. So this one waits.
 *
 * THE ASSERTION is the HUD columns. A run where `banner` and `strip` are null at
 * every event is the bug this work exists to fix, whatever the event log says.
 *
 * FIRE-FRAME COST is measured the way the existing air work measures it: the
 * per-frame wall time is sampled in a ring, and the frame an event lands on is
 * printed against the median of its neighbours.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4206/';
const SECONDS = Number(args.seconds ?? 150);
/** `--noair` is the control: the same round with all three air systems off, so
 *  the frame-time drift over a long round can be attributed or cleared. */
const NOAIR = !!args.noair;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') pageErrors.push('console.error: ' + t.slice(0, 240));
  if (/IMPACT|RUN |SALVO|dust:/.test(t)) console.log('   ' + t.slice(0, 200));
});

console.log(`[airround] booting ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('[airround] ready — running %ds at time.scale 1', SECONDS);

await page.evaluate((noair) => {
  const e = window.__ENGINE__;
  const ui = e.ctx.peek('ui');
  const m = e.ctx.peek('match');
  e.time.scale = 1;
  if (noair) for (const a of m.air) a.enabled = false;

  /* ---- per-frame cost ring ------------------------------------------- */
  window.__FR__ = [];
  const cost = [];
  const orig = e.step?.bind(e);
  let last = performance.now();
  const spy = () => {
    const now = performance.now();
    cost.push(+(now - last).toFixed(2));
    if (cost.length > 900) cost.shift();
    last = now;
    requestAnimationFrame(spy);
  };
  requestAnimationFrame(spy);
  window.__COST__ = cost;
  void orig;

  /* ---- every air event, with what the HUD said ------------------------ */
  window.__LOG__ = [];
  const at = () => +e.time.elapsed.toFixed(2);
  const hud = () => {
    const b = ui.banner;
    const s = ui.airAlertStrip;
    return {
      banner: b.t < 1 ? b.title.textContent : null,
      bannerSub: b.t < 1 ? b.sub.textContent : null,
      strip: s.text,
      stripVisible: s.visible,
      markers: ui.markers.dangerCount,
      range: +s.range.toFixed(0),
    };
  };
  // The frame cost AT the event: the ring's last sample is the frame that just
  // ran, and the ten before it are the neighbours to judge it against.
  const frame = () => {
    const n = cost.length;
    const here = cost[n - 1] ?? 0;
    const near = cost.slice(Math.max(0, n - 12), n - 1).slice().sort((x, y) => x - y);
    return { ms: here, median: near.length ? near[near.length >> 1] : 0, max: near[near.length - 1] ?? 0 };
  };
  const push = (ev, id) => window.__LOG__.push({ t: at(), ev, id, ...hud(), frame: frame() });
  e.events.on('match:airstrike', (p) => push('strike:' + p.phase, p.site));
  e.events.on('match:bomber', (p) => push('bomber:' + p.phase, p.run));
  e.events.on('match:strafe', (p) => push('strafe:' + p.phase, p.run));
  e.events.on('match:round', (p) => window.__LOG__.push({ t: at(), ev: 'round', id: String(p.round) }));
  e.events.on('match:result', (p) => window.__LOG__.push({ t: at(), ev: 'result', id: p.reason }));
  /* ---- frame time in 20 s buckets, so drift is visible ----------------- */
  window.__BUCKETS__ = [];
  setInterval(() => {
    const c = cost.slice().sort((a, b) => a - b);
    window.__BUCKETS__.push({
      t: +e.time.elapsed.toFixed(0),
      median: c[c.length >> 1] ?? 0,
      p95: c[Math.floor(c.length * 0.95)] ?? 0,
    });
    cost.length = 0;
  }, 20000);
}, NOAIR);

const t0 = Date.now();
let lastN = 0;
while ((Date.now() - t0) / 1000 < SECONDS) {
  await page.waitForTimeout
    ? await page.waitForTimeout(2000)
    : null;
  const log = await page.evaluate(() => window.__LOG__);
  for (let i = lastN; i < log.length; i++) {
    const r = log[i];
    if (r.ev === 'round' || r.ev === 'result') {
      console.log(`t=${String(r.t).padStart(6)}  ${r.ev} ${r.id}`);
      continue;
    }
    console.log(
      `t=${String(r.t).padStart(6)}  ${r.ev.padEnd(16)} ${String(r.id).padEnd(10)} ` +
        `banner=${JSON.stringify(r.banner)} strip=${JSON.stringify(r.strip)} ` +
        `markers=${r.markers} range=${r.range}m ` +
        `frame=${r.frame.ms}ms (neighbours median ${r.frame.median}ms, max ${r.frame.max}ms)`
    );
  }
  lastN = log.length;
}

const summary = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const cost = window.__COST__.slice().sort((a, b) => a - b);
  const log = window.__LOG__;
  const kinds = {};
  for (const r of log) kinds[r.ev] = (kinds[r.ev] ?? 0) + 1;
  const announced = log.filter((r) => /inbound/.test(r.ev));
  const withHud = announced.filter((r) => r.banner || r.strip);
  return {
    elapsed: +e.time.elapsed.toFixed(1),
    phase: m.phase,
    round: m.round,
    frameMedian: cost[cost.length >> 1],
    frameP95: cost[Math.floor(cost.length * 0.95)],
    frameMax: cost[cost.length - 1],
    kinds,
    announced: announced.length,
    announcedWithHud: withHud.length,
    strikesFired: m.airstrike._fired,
    salvos: m.airstrike._salvoed,
    bombers: m.bomber._flown,
    strafes: m.strafe._flown,
    focus: m.airstrike.focusValid
      ? [+m.airstrike.focus.x.toFixed(1), +m.airstrike.focus.z.toFixed(1)]
      : null,
  };
});
console.log('[airround] frame time, 20 s buckets:',
  JSON.stringify(await page.evaluate(() => window.__BUCKETS__)));
console.log('[airround] summary', JSON.stringify(summary, null, 2));
console.log('[airround] pageErrors:', pageErrors.length ? pageErrors.slice(0, 6) : 'none');
await browser.close();
