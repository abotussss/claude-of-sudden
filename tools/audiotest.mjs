/**
 * Headless audio watchdog.
 *
 * The report was "the sound bugs out and then disappears". `src/audio/index.js`
 * has exactly that failure mode wired in on purpose — `_error()` counts throws
 * and calls `_teardown()` on the fortieth, permanently — so the question is not
 * whether audio can die but WHICH voice is throwing, and whether the voice pool
 * starves before that.
 *
 * This runs a real match with a real AudioContext and samples the audio stats
 * every second, printing the first errors verbatim and flagging the moment
 * `failed` flips or the emitter pool saturates.
 *
 *   node tools/audiotest.mjs [--url=…] [--seconds=180] [--scale=6]
 */

import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4173/';
const SECONDS = Number(args.seconds ?? 180);
const SCALE = Number(args.scale ?? 6);

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    // A real graph, not a muted stub, and no gesture requirement — otherwise the
    // context stays suspended and update() returns before it can fail.
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[audio]')) console.log('  console:', t.slice(0, 300));
});

console.log(`[audiotest] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

// Capture what _error() logs, including the stack, which the subsystem itself
// only prints for the first five.
const boot = await page.evaluate(async (scale) => {
  const e = window.__ENGINE__;
  const a = e.ctx.peek('audio');
  window.__AUDIO_ERRS__ = [];
  if (a) {
    const orig = a._error.bind(a);
    a._error = (err) => {
      window.__AUDIO_ERRS__.push({
        msg: String(err?.message ?? err),
        stack: String(err?.stack ?? '').split('\n').slice(0, 4).join(' | '),
      });
      return orig(err);
    };
    try { await a.start?.(); } catch { /* reported below */ }
  }
  e.time.scale = scale;
  return {
    present: !!a,
    running: a?.running ?? null,
    state: a?.actx?.state ?? 'none',
    emitters: a?.field?.emitters?.length ?? a?.field?.stats?.capacity ?? null,
  };
}, SCALE);
console.log('[audiotest] audio at boot:', JSON.stringify(boot));

const sample = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const a = e.ctx.peek('audio');
    const m = e.ctx.peek('match');
    if (!a) return null;
    return {
      t: +e.time.elapsed.toFixed(0),
      state: a.actx?.state ?? 'none',
      running: a.running,
      failed: !!a.failed,
      errors: a.stats.errors,
      events: a.stats.events,
      voices: a.stats.voices,
      dropped: a.stats.dropped,
      stolen: a.stats.stolen,
      phase: m?.phase,
      bomb: m?.bomb?.state,
      newErrs: window.__AUDIO_ERRS__.splice(0),
    };
  });

let announced = false;
const t0 = Date.now();
let prev = null;
while ((Date.now() - t0) / 1000 < SECONDS) {
  const s = await sample();
  if (!s) break;
  for (const err of s.newErrs) console.log('  !! audio error:', err.msg, '\n     at', err.stack);
  if (!prev || s.failed !== prev.failed || s.errors !== prev.errors ||
      Math.abs(s.voices - prev.voices) > 3 || s.phase !== prev.phase || s.bomb !== prev.bomb) {
    console.log(
      `t=${String(s.t).padStart(4)}s ${s.phase ?? '-'} bomb=${s.bomb ?? '-'} | ` +
      `ctx=${s.state} running=${s.running} failed=${s.failed} | ` +
      `errors=${s.errors} voices=${s.voices} dropped=${s.dropped} stolen=${s.stolen} events=${s.events}`
    );
  }
  if (s.failed && !announced) {
    announced = true;
    console.log('\n*** AUDIO DISABLED ITSELF at t=' + s.t + 's ***\n');
  }
  prev = s;
  await page.waitForTimeout(1000);
}

const final = await sample();
console.log('\n[audiotest] final', JSON.stringify(final, null, 2));
console.log('[audiotest] page errors', pageErrors.slice(0, 8));
await browser.close();
process.exit(final?.failed ? 1 : 0);
