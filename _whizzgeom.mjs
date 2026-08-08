/**
 * CRACK-PAST GEOMETRY, PROVED ON CRAFTED IMPACTS.
 *
 * The live probe can only measure the near misses the bots happen to produce
 * against an idle player. This drives `_maybeWhizz` directly with
 * `bullet:impact` payloads of known geometry and checks each gate: the
 * came-past test, both ends of the miss window, the backtrack bound, the
 * own-fire lockout, and the rate limit that coalesces a multi-layer round.
 *
 *   node _whizzgeom.mjs
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto('http://127.0.0.1:4594/?map=town', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(async () => {
  const e = window.__ENGINE__, ctx = e.ctx;
  const a = ctx.peek('audio');
  await a.start();
  ctx.time.scale = 0;                       // freeze the world; only our events run

  let whizz = 0;
  const pa = a._playAt.bind(a);
  a._playAt = (k, x, y, z, o, bus, pri) => {
    if (k === 'whizz') { whizz++; window.__LAST__ = { miss: +o.miss.toFixed(3), pri, bus }; }
    return pa(k, x, y, z, o, bus, pri);
  };

  const lp = a.field.listenerPos;
  /** Round travelling +x, passing `miss` metres to the listener's side, stopping `back` m past him. */
  const shot = (miss, back) => ({
    point: { x: lp.x + back, y: lp.y, z: lp.z + miss },
    incident: { x: 1, y: 0, z: 0 },
    exit: false, surface: 'concrete', damage: 30,
  });
  const run = (label, payload, opts = {}) => {
    a._rateNext.whizz = 0;                  // isolate each case from the shared bucket
    if (opts.ownFire) a._lastOwnFire = a.actx.currentTime;
    else a._lastOwnFire = -99;
    const before = whizz;
    a._onImpact(payload);
    return { label, whizz: whizz - before, miss: window.__LAST__?.miss ?? null };
  };

  const cases = [];
  cases.push(run('miss 1.0 m, 10 m past      -> CRACK', shot(1.0, 10)));
  cases.push(run('miss 3.0 m, 25 m past      -> CRACK', shot(3.0, 25)));
  cases.push(run('miss 4.9 m, 5 m past       -> CRACK', shot(4.9, 5)));
  cases.push(run('miss 5.6 m  (outside 5 m)  -> silent', shot(5.6, 10)));
  cases.push(run('miss 0.20 m (a HIT, <0.45) -> silent', shot(0.20, 10)));
  // Stopped 10 m SHORT of the listener while still closing on him: it never
  // came past, so there is nothing to crack. (`s` is negative.)
  cases.push(run('stopped short, still closing -> silent', {
    point: { x: lp.x - 10, y: lp.y, z: lp.z + 1 }, incident: { x: 1, y: 0, z: 0 },
    exit: false, surface: 'concrete', damage: 30 }));
  // ...and the mirror image: same stopping point, travelling the other way, so
  // it DID pass him at 1 m. Confirms the test is sensitive to direction.
  cases.push(run('same point, came past      -> CRACK', {
    point: { x: lp.x - 10, y: lp.y, z: lp.z + 1 }, incident: { x: -1, y: 0, z: 0 },
    exit: false, surface: 'concrete', damage: 30 }));
  cases.push(run('60 m past (>40 backtrack)  -> silent', shot(1.0, 60)));
  cases.push(run('exit face                  -> silent', { ...shot(1.0, 10), exit: true }));
  cases.push(run('own round, inside lockout  -> silent', shot(1.0, 10), { ownFire: true }));

  // Coalescing: one round through three walls = three entry impacts, one crack.
  a._rateNext.whizz = 0; a._lastOwnFire = -99;
  const b4 = whizz;
  a._onImpact(shot(1.2, 8)); a._onImpact(shot(1.2, 12)); a._onImpact(shot(1.2, 16));
  cases.push({ label: '3 layers, same round       -> 1 crack', whizz: whizz - b4, miss: null });

  return { cases, errors: a.stats.errors, failed: !!a.failed,
    priority: window.__LAST__?.pri, bus: window.__LAST__?.bus };
});

let bad = 0;
for (const c of out.cases) {
  const want = c.label.includes('CRACK') ? 1 : c.label.includes('1 crack') ? 1 : 0;
  const ok = c.whizz === want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.label}   voices=${c.whizz}${c.miss != null ? ` miss=${c.miss}` : ''}`);
}
console.log(`\nvoice bus=${out.bus} priority=${out.priority}  audioErrors=${out.errors} failed=${out.failed}`);
console.log(bad ? `GEOMETRY: ${bad} FAILED` : 'GEOMETRY: PASS');
console.log('pageerrors=' + errs.length); if (errs.length) console.log(errs[0]);
await browser.close();
