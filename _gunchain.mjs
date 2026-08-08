/**
 * GUNSHOT CHAIN PROBE — 「敵味方全ての銃声をもっと鳴らして」
 *
 * Follows one bot round from the trigger to a voice in the field and reports
 * where they are lost:
 *
 *   weapon:fire  ->  _onFire  ->  dist gate  ->  _allow('shot')  ->  _playAt
 *                ->  field.acquire  ->  held voice
 *
 * Plus the same for whizz, and what the pool is doing while it happens.
 *
 *   node _gunchain.mjs [--map=town] [--seconds=45] [--scale=6]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'town';
const SECONDS = Number(args.seconds ?? 45);
const SCALE = Number(args.scale ?? 6);
const SEED = args.seed ?? null;
const URL = `http://127.0.0.1:4594/?map=${MAP}${SEED ? `&seed=${SEED}` : ''}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
if (args.shotrate) {
  await page.addInitScript((r) => { window.__SHOTRATE__ = r; }, Number(args.shotrate));
}
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const boot = await page.evaluate(async (scale) => {
  const e = window.__ENGINE__, ctx = e.ctx;
  const a = ctx.peek('audio');
  try { await a?.start?.(); } catch { /* boot reported below */ }
  // Controlled A/B on ONE build: the shipped rate unless overridden.
  if (a && window.__SHOTRATE__) a._rate.shot = window.__SHOTRATE__;

  const M = {
    fireEvents: 0, fireRemote: 0, fireOwn: 0,
    distBands: { d0_20: 0, d20_40: 0, d40_60: 0, d60_80: 0, d80_120: 0, d120p: 0 },
    offeredFar: 0, shotDeniedByRate: 0, shotPlayAt: 0, shotAcquired: 0, shotRefused: 0,
    whizzPlayAt: 0, whizzAcquired: 0, whizzDeniedByRate: 0, tracerEvents: 0,
    acquireByBus: {}, refuseByBus: {},
    occSamples: [], gainSamples: [],
    peakVoices: 0, peakField: 0, samples: [],
  };
  window.__M__ = M;
  const bandOf = (d) => d < 20 ? 'd0_20' : d < 40 ? 'd20_40' : d < 60 ? 'd40_60'
    : d < 80 ? 'd60_80' : d < 120 ? 'd80_120' : 'd120p';

  // ---- the trigger end -------------------------------------------------
  ctx.events.on('weapon:fire', (p) => {
    M.fireEvents++;
    if (p?.firstPerson || !p?.origin) { M.fireOwn++; return; }
    M.fireRemote++;
    const lp = a?.field?.listenerPos;
    if (lp) {
      const d = Math.hypot(p.origin.x - lp.x, p.origin.y - lp.y, p.origin.z - lp.z);
      M.distBands[bandOf(d)]++;
    }
  });
  ctx.events.on('bullet:tracer', () => { M.tracerEvents++; });

  if (a) {
    if (a.battle?.offerFar) {
      const of = a.battle.offerFar.bind(a.battle);
      a.battle.offerFar = (...ar) => { M.offeredFar++; return of(...ar); };
    }
    const al = a._allow.bind(a);
    a._allow = (k) => {
      const r = al(k);
      if (!r && k === 'shot') M.shotDeniedByRate++;
      if (!r && k === 'whizz') M.whizzDeniedByRate++;
      return r;
    };
    // _playAt is the single funnel; count offers and successes per kind.
    const pa = a._playAt.bind(a);
    a._playAt = (kind, x, y, z, o, bus, pri) => {
      if (kind === 'shot') M.shotPlayAt++;
      if (kind === 'whizz') M.whizzPlayAt++;
      const ok = pa(kind, x, y, z, o, bus, pri);
      if (kind === 'shot') { if (ok) M.shotAcquired++; else M.shotRefused++; }
      if (kind === 'whizz' && ok) M.whizzAcquired++;
      return ok;
    };
    // field.acquire tells us who is refused and what the occlusion looked like.
    const f = a.field;
    if (f?.acquire) {
      const ac = f.acquire.bind(f);
      f.acquire = (spec) => {
        const em = ac(spec);
        const b = spec.bus ?? '?';
        const t = em ? M.acquireByBus : M.refuseByBus;
        t[b] = (t[b] ?? 0) + 1;
        if (em && b === 'weapons' && M.occSamples.length < 4000) {
          M.occSamples.push(+(em.occ ?? em.occlusion ?? -1));
          M.gainSamples.push(+(spec.gain ?? 1));
        }
        return em;
      };
    }
  }

  setInterval(() => {
    const au = ctx.peek('audio'); if (!au) return;
    const v = au.stats.voices ?? 0;
    if (v > M.peakVoices) M.peakVoices = v;
    const f = au.field;
    const used = f ? f.emitters.reduce((s, x) => s + (x.free ? 0 : 1), 0) : 0;
    if (used > M.peakField) M.peakField = used;
    M.samples.push({ t: +ctx.time.elapsed.toFixed(1), v, used,
      cap: f?.cap ?? null, deficit: f?.stats.deficit ?? null, behind: f?.stats.behind ?? null,
      stolen: au.stats.stolen, drop: au.stats.dropped });
  }, 250);

  ctx.time.scale = scale;
  return {
    running: a?.running ?? null, state: a?.actx?.state ?? 'none', battle: !!a?.battle,
    fieldCapacity: a?.field?.emitters?.length ?? a?.field?.stats?.capacity ?? null,
    script: document.querySelector('script[src*="assets/"]')?.getAttribute('src') ?? null,
  };
}, SCALE);
console.log('[gunchain] boot:', JSON.stringify(boot));

await page.waitForTimeout(SECONDS * 1000);

const out = await page.evaluate(() => {
  const e = window.__ENGINE__, M = window.__M__;
  const a = e.ctx.peek('audio');
  const avg = (x) => x.length ? +(x.reduce((s, n) => s + n, 0) / x.length).toFixed(3) : null;
  const occ = M.occSamples.filter((n) => n >= 0);
  return {
    level: e.ctx.peek('world').level.id,
    phase: e.ctx.peek('match')?.phase ?? '?',
    gameSeconds: +e.ctx.time.elapsed.toFixed(1),
    chain: {
      '1_weaponFire_total': M.fireEvents,
      '2_remote': M.fireRemote, '2_own': M.fireOwn,
      '3_distBands': M.distBands,
      '4_offeredToFarLayer': M.offeredFar,
      '5_deniedByShotRate': M.shotDeniedByRate,
      '6_playAt_shot': M.shotPlayAt,
      '7_acquired_shot': M.shotAcquired,
      '7_refused_shot': M.shotRefused,
    },
    whizz: {
      tracerEvents: M.tracerEvents, deniedByRate: M.whizzDeniedByRate,
      playAt: M.whizzPlayAt, acquired: M.whizzAcquired,
    },
    pool: {
      capacity: a?.field?.emitters?.length ?? null,
      peakVoices: M.peakVoices, peakFieldUsed: M.peakField,
      stolen: a?.stats.stolen ?? 0, dropped: a?.stats.dropped ?? 0,
      errors: a?.stats.errors ?? 0, failed: !!a?.failed,
    },
    acquireByBus: M.acquireByBus, refuseByBus: M.refuseByBus,
    weaponsOcclusion: { n: occ.length, mean: avg(occ), fullyOccluded: occ.filter((n) => n > 0.95).length },
    weaponsGain: { mean: avg(M.gainSamples) },
    governor: {
      cap_mean: avg(M.samples.map((s) => s.cap)),
      cap_min: Math.min(...M.samples.map((s) => s.cap)),
      cap_max: Math.max(...M.samples.map((s) => s.cap)),
      atFloor_pct: +(100 * M.samples.filter((s) => s.cap <= 24).length / Math.max(1, M.samples.length)).toFixed(1),
      deficit_mean: avg(M.samples.map((s) => s.deficit)),
      behind_mean: avg(M.samples.map((s) => s.behind)),
      behind_max: Math.max(...M.samples.map((s) => s.behind)),
    },
  };
});

const mins = out.gameSeconds / 60;
console.log(`\n=== ${MAP}  ${out.gameSeconds}s game time (${mins.toFixed(1)} min)  phase=${out.phase} ===`);
console.log(JSON.stringify(out, null, 2));
const c = out.chain;
console.log(`\nremote rounds/min      : ${(c['2_remote'] / mins).toFixed(1)}`);
console.log(`shot voices/min        : ${(c['7_acquired_shot'] / mins).toFixed(1)}`);
console.log(`SHOTS HEARD / FIRED    : ${(100 * c['7_acquired_shot'] / Math.max(1, c['2_remote'])).toFixed(1)}%`);
console.log(`whizz voices/min       : ${(out.whizz.acquired / mins).toFixed(1)}`);
console.log(`pageerrors=${errs.length}`); if (errs.length) console.log('  first:', errs[0]);
console.log('SUMMARY ' + JSON.stringify({
  denied: c['5_deniedByShotRate'], played: c['7_acquired_shot'], refused: c['7_refused_shot'],
  near60: c['3_distBands'].d0_20 + c['3_distBands'].d20_40 + c['3_distBands'].d40_60,
  peakField: out.pool.peakFieldUsed, stolen: out.pool.stolen, dropped: out.pool.dropped,
  errors: out.pool.errors, whizz: out.whizz.acquired, capFloorPct: out.governor.atFloor_pct,
  secs: out.gameSeconds, pageerrors: errs.length,
}));
await browser.close();
