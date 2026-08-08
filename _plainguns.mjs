/**
 * THE GUNFIRE CHAIN, END TO END, ON A 200 m MAP — 「敵味方全ての銃声をもっと鳴らして」
 *
 * `_gunchain.mjs` follows the NEAR half (inside 60 m). On NACHTFELD the zones are
 * 154-314 m apart, so essentially every round is outside 60 m and the near half is
 * empty by construction: the whole war goes to the coalescing far layer in
 * `src/audio/battle.js`. This probe measures THAT path, at every arrow:
 *
 *   weapon:fire (remote)
 *     -> _onFire dist gate            (<60 near, 60-230 far, >230 thrown away)
 *     -> battle.offerFar              (binned by bearing)
 *     -> _updateFar                   (BIN_WINDOW / BIN_ROUNDS / FAR_RATE / _room)
 *     -> audio.playFar
 *     -> _playAt('far')               (maxDist)
 *     -> field.acquire                (bus quota, render cap, steal or drop)
 *     -> a held emitter with a gain   (what actually arrives)
 *
 * and separately the crack-past: bullet:tracer -> _onTracer geometry -> rate ->
 * _playAt('whizz') -> acquire.
 *
 * --drive PUTS THE PLAYER IN THE FIREFIGHT. The predecessor's plains run measured
 * an idle probe standing on its spawn: 0 rounds inside 60 m across runs, so the
 * near path and the crack-past were both unverifiable. Here the player is
 * repeatedly placed on a live friendly who currently has a target, and his health
 * is topped up so a respawn does not walk him back out of the fight.
 *
 *   node _plainguns.mjs --map=plains --seconds=90 --drive
 *   node _plainguns.mjs --map=town   --seconds=90            (the regression)
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'plains';
const SECONDS = Number(args.seconds ?? 90);
const WARM = Number(args.warm ?? 45);
const PORT = args.port ?? '4620';
const URL = `http://127.0.0.1:${PORT}/?map=${MAP}&capture=1${args.seed ? `&seed=${args.seed}` : ''}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
if (args.nofloor) await page.addInitScript(() => { window.__NOFLOOR__ = true; });
if (args.clamp) await page.addInitScript((n) => { window.__CLAMP__ = n; }, Number(args.clamp));
if (args.whizzrate) await page.addInitScript((n) => { window.__WHIZZRATE__ = n; }, Number(args.whizzrate));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

/* ---- warm the match up fast, so men are deployed and shooting ------- */
await page.evaluate(async (w) => {
  const a = window.__ENGINE__.ctx.peek('audio');
  try { await a?.start?.(); } catch { /* reported below */ }
  window.__ENGINE__.ctx.time.scale = 8;
}, WARM);
await page.waitForTimeout(WARM * 1000);

const boot = await page.evaluate((drive) => {
  const e = window.__ENGINE__, ctx = e.ctx;
  const a = ctx.peek('audio');
  ctx.time.scale = 1;             // audio rate gates are WALL clock; measure at 1x

  const M = {
    fire: 0, own: 0, remote: 0,
    band: { under60: 0, b60_90: 0, b90_130: 0, b130_180: 0, b180_230: 0, over230: 0 },
    offerCalls: 0, offerTaken: 0, offerTooNear: 0, offerTooFar: 0,
    roomCalls: 0, roomNo: 0, roomNoWeapons: 0, roomNoFoley: 0,
    playFarCalls: 0, playFarOk: 0,
    playAt: {}, playAtOk: {},
    acqOk: {}, acqNull: {},
    stolenFrom: {}, stoleFor: {},
    farGains: [], farDists: [], shotGains: [], shotOcc: [],
    tracer: 0, whizzGeomPass: 0, whizzRateNo: 0, whizzPlayAt: 0, whizzOk: 0,
    whizzMiss: [],
    peakField: 0, peakWeapons: 0, peakFar: 0, farCutAt: [],
    nearestEnemy: [], samples: [],
    teleports: 0,
  };
  window.__M__ = M;
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

  ctx.events.on('weapon:fire', (p) => {
    M.fire++;
    const lp = a?.field?.listenerPos;
    if (!p?.origin || !lp) { M.own++; return; }
    const d = Math.hypot(p.origin.x - lp.x, p.origin.y - lp.y, p.origin.z - lp.z);
    if (p.firstPerson || d < 2.6) { M.own++; return; }
    M.remote++;
    M.band[d < 60 ? 'under60' : d < 90 ? 'b60_90' : d < 130 ? 'b90_130'
      : d < 180 ? 'b130_180' : d < 230 ? 'b180_230' : 'over230']++;
  });
  ctx.events.on('bullet:tracer', () => { M.tracer++; });

  const b = a.battle;
  /**
   * `--nofloor` IS THE A/B CONTROL, in the spirit of `--off` and `--legacy` in
   * tools/audiotest.mjs: it puts `_farRoom` back to the bare `_room` share test
   * the layer used before `FAR_FLOOR_SLOTS`, on the SAME build and the SAME
   * seed. Without it the "before" and "after" runs are two different matches
   * and the render deficit cannot be compared between them.
   */
  if (window.__NOFLOOR__) b._farRoom = () => b._room('weapons', 0.85);
  /**
   * `--clamp=N` PINS THE RENDER GOVERNOR, exactly as `tools/audiotest.mjs
   * --battle --clamp` does. Without it a `--nofloor` A/B is worthless: the term
   * under test is what happens AT THE POOL FLOOR, and whether a given run
   * reaches the floor is decided by how loaded the machine was that minute —
   * measured, one pair of same-seed runs came out at pool 65 and pool 24.
   */
  /**
   * `--whizzrate=N` overrides `_rate.whizz` (shipped 2/s) at runtime, so the
   * question "is 2 a second still right now that a burst is 39-79 rounds over
   * 2-3 s" can be answered with two runs of one build instead of an opinion.
   */
  if (window.__WHIZZRATE__) a._rate.whizz = window.__WHIZZRATE__;
  if (window.__CLAMP__) {
    a.field.cap = window.__CLAMP__;
    a.field._trackRender = () => { a.field.cap = window.__CLAMP__; };
  }
  const of = b.offerFar.bind(b);
  b.offerFar = (x, y, z, dist, prof) => {
    M.offerCalls++;
    const r = of(x, y, z, dist, prof);
    if (r) M.offerTaken++;
    else if (dist < 60) M.offerTooNear++;
    else M.offerTooFar++;
    return r;
  };
  const room = b._room.bind(b);
  b._room = (bus, share) => {
    M.roomCalls++;
    const r = room(bus, share);
    if (!r) { M.roomNo++; if (bus === 'weapons') M.roomNoWeapons++; else M.roomNoFoley++; }
    return r;
  };
  const pf = a.playFar.bind(a);
  a.playFar = (x, y, z, o) => {
    M.playFarCalls++;
    const r = pf(x, y, z, o);
    if (r) M.playFarOk++;
    return r;
  };
  const al = a._allow.bind(a);
  a._allow = (k) => {
    const r = al(k);
    if (!r && k === 'whizz') M.whizzRateNo++;
    return r;
  };
  const pa = a._playAt.bind(a);
  a._playAt = (kind, x, y, z, o, bus, pri) => {
    bump(M.playAt, kind);
    if (kind === 'whizz') { M.whizzPlayAt++; if (M.whizzMiss.length < 400) M.whizzMiss.push(+(o?.miss ?? -1).toFixed(2)); }
    const ok = pa(kind, x, y, z, o, bus, pri);
    if (ok) bump(M.playAtOk, kind);
    if (kind === 'whizz' && ok) M.whizzOk++;
    return ok;
  };

  /* ---- the field: who got a slot, who was refused, who was robbed ---- */
  const f = a.field;
  const ac = f.acquire.bind(f);
  const pre = new Array(f.emitters.length);
  const preStart = new Float64Array(f.emitters.length);
  const preSpan = new Float64Array(f.emitters.length);
  f.acquire = (spec) => {
    for (let i = 0; i < f.emitters.length; i++) {
      const em = f.emitters[i];
      pre[i] = em.free ? null : (em.kindTag ?? em.busName ?? '?');
      preStart[i] = em.startAt ?? 0;
      preSpan[i] = (em.endTime ?? 0) - (em.startAt ?? 0);
    }
    const before = f.stats.stolen;
    const em = ac(spec);
    const key = `${spec.bus ?? '?'}:${spec.tag ?? '-'}`;
    if (!em) { bump(M.acqNull, key); return em; }
    bump(M.acqOk, key);
    if (f.stats.stolen > before) {
      const idx = f.emitters.indexOf(em);
      bump(M.stolenFrom, pre[idx] ?? '?');
      bump(M.stoleFor, key);
      /**
       * HOW FAR INTO ITS BURST THE VICTIM WAS. A far voice cut at 95 % is a
       * tail nobody misses; one cut at 20 % is a burst that stops dead, and
       * `Emitter.detach` disconnects a running signal rather than releasing
       * it, so what that costs is a discontinuity and not merely brevity.
       * Recorded BEFORE `acquire` overwrites the slot's timings.
       */
      if (pre[idx] === 'far' && preSpan[idx] > 0 && M.farCutAt.length < 2000) {
        /**
         * SIGNED, AND THE SIGN IS THE WHOLE POINT. `startAt` is `when`, which
         * for a far voice is one propagation delay in the FUTURE (0.58 s at
         * 200 m). A NEGATIVE number here means the slot was stolen while the
         * burst was still in flight — the voice never made a sample and the
         * `farVoices` counter is over-reporting what the player hears. A
         * positive one is an honest truncation. Clamping it, as the first
         * version of this probe did, hides exactly that distinction.
         */
        M.farCutAt.push({
          into: +(f.actx.currentTime - preStart[idx]).toFixed(3),
          dur: +preSpan[idx].toFixed(3),
        });
      }
    }
    // The real level this voice will be played at: distGain is scheduled in the
    // future (propagation delay), so read the arithmetic rather than `.value`.
    const atten = f.attenuation(em.dist) * (1 - 0.62 * (em.occ ?? 0));
    const g = Math.min(4, atten * (spec.gain ?? 1));
    if (spec.tag === 'far' && M.farGains.length < 3000) {
      M.farGains.push(+g.toFixed(5)); M.farDists.push(+em.dist.toFixed(1));
    }
    if (spec.bus === 'weapons' && spec.tag !== 'far' && M.shotGains.length < 3000) {
      M.shotGains.push(+g.toFixed(5)); M.shotOcc.push(+(em.occ ?? 0).toFixed(2));
    }
    return em;
  };

  /* ---- 10 Hz census + optional driving ------------------------------- */
  const ai = ctx.peek('ai'), pl = ctx.peek('player'), match = ctx.peek('match');
  let tele = 0;
  window.__IV__ = setInterval(() => {
    const used = f.emitters.reduce((s, x) => s + (x.free ? 0 : 1), 0);
    let wep = 0, far = 0;
    for (const em of f.emitters) {
      if (em.free) continue;
      if (em.busName === 'weapons') wep++;
      if (em.kindTag === 'far') far++;
    }
    if (used > M.peakField) M.peakField = used;
    if (wep > M.peakWeapons) M.peakWeapons = wep;
    if (far > M.peakFar) M.peakFar = far;
    M.samples.push({ used, wep, far, cap: f.cap, wcap: f.busCap('weapons'),
      def: +(f.stats.deficit ?? 0).toFixed(3), beh: +(f.behind ?? 0).toFixed(3) });

    const lp = f.listenerPos;
    const agents = ai?.agents ?? [];
    let nd = Infinity;
    for (const g of agents) {
      if (!g?.alive || !g.position) continue;
      const d = Math.hypot(g.position.x - lp.x, g.position.y - lp.y, g.position.z - lp.z);
      if (d < nd) nd = d;
    }
    if (Number.isFinite(nd)) M.nearestEnemy.push(+nd.toFixed(1));

    if (!drive || !pl) return;
    // Stay alive: a respawn walks the probe back out of the fight.
    if (pl.health !== undefined && pl.health < 90) pl.health = 100;
    tele += 0.1;
    if (tele < 3) return;
    tele = 0;
    // Stand on a man who is CURRENTLY in contact. That is where the shooting is,
    // and it is the only way this probe hears a round crack past it.
    const hot = agents.filter((g) => g?.alive && g.position && (g.hasTarget || g.target));
    if (!hot.length) return;
    // Deterministic, so a --nofloor A/B on one seed is the same two matches.
    const g = hot[(M.teleports * 7 + 3) % hot.length];
    try {
      pl.teleport({ x: g.position.x + 1.2, y: g.position.y + 1.62, z: g.position.z + 1.2 }, 0);
      M.teleports++;
    } catch { /* teleport is best-effort */ }
  }, 100);

  return {
    level: ctx.peek('world').level.id,
    phase: match?.phase ?? '?',
    running: !!a.running, state: a.actx?.state, battle: !!a.battle,
    agents: (ai?.agents ?? []).length,
    pool: f.emitters.length,
  };
}, !!args.drive);
console.log('[plainguns] boot:', JSON.stringify(boot));

await page.waitForTimeout(SECONDS * 1000);

const out = await page.evaluate((secs) => {
  clearInterval(window.__IV__);
  const M = window.__M__, e = window.__ENGINE__;
  const a = e.ctx.peek('audio'), f = a.field, b = a.battle;
  const mean = (x) => x.length ? +(x.reduce((s, n) => s + n, 0) / x.length).toFixed(5) : null;
  const med = (x) => { if (!x.length) return null; const s = [...x].sort((p, q) => p - q); return s[s.length >> 1]; };
  const mins = secs / 60;
  const per = (n) => +(n / mins).toFixed(1);
  return {
    level: e.ctx.peek('world').level.id,
    phase: e.ctx.peek('match')?.phase ?? '?',
    teleports: M.teleports,
    nearestEnemy: { median: med(M.nearestEnemy), min: Math.min(...M.nearestEnemy), n: M.nearestEnemy.length },
    A_roundsFired: { total: M.fire, own: M.own, remote: M.remote, remotePerMin: per(M.remote) },
    B_range: M.band,
    C_offerFar: { calls: M.offerCalls, taken: M.offerTaken, tooNear: M.offerTooNear, tooFar: M.offerTooFar },
    D_farLayer: {
      roomCalls: M.roomCalls, roomRefused: M.roomNo, roomRefusedWeapons: M.roomNoWeapons,
      playFarCalls: M.playFarCalls, playFarOk: M.playFarOk,
      voices: b.stats.farVoices, voicesPerMin: per(b.stats.farVoices),
      rounds: b.stats.farRounds, roundsPerMin: per(b.stats.farRounds),
      binsHeldAtEnd: [...b._binN].reduce((s, n) => s + n, 0),
    },
    E_playAt: { offered: M.playAt, acquired: M.playAtOk },
    F_field: {
      acquiredByBusTag: M.acqOk, refusedByBusTag: M.acqNull,
      stolenFrom: M.stolenFrom, stoleFor: M.stoleFor,
      stolen: f.stats.stolen, dropped: f.stats.dropped,
      peakUsed: M.peakField, peakWeapons: M.peakWeapons, peakFar: M.peakFar,
      weaponsCapMean: mean(M.samples.map((s) => s.wcap)),
      weaponsLoadMean: mean(M.samples.map((s) => s.wep)),
      farLoadMean: mean(M.samples.map((s) => s.far)),
      poolCapMean: mean(M.samples.map((s) => s.cap)),
      deficitMean: mean(M.samples.map((s) => s.def)),
      behindMean: mean(M.samples.map((s) => s.beh)),
      behindMax: Math.max(...M.samples.map((s) => s.beh)),
    },
    G_levels: {
      farGainMean: mean(M.farGains), farGainMed: med(M.farGains), farN: M.farGains.length,
      farDistMed: med(M.farDists),
      nearShotGainMean: mean(M.shotGains), nearShotN: M.shotGains.length,
      nearShotOccMean: mean(M.shotOcc),
      nearShotOccluded90pct: M.shotOcc.filter((o) => o > 0.9).length,
    },
    H_whizz: {
      tracers: M.tracer, playAt: M.whizzPlayAt, rateRefused: M.whizzRateNo, acquired: M.whizzOk,
      missMed: med(M.whizzMiss.filter((m) => m >= 0)),
      rate: a._rate.whizz,
    },
    I_farStolen: {
      n: M.farCutAt.length,
      /** Stolen BEFORE it started sounding: never made a sample. */
      beforeItSounded: M.farCutAt.filter((v) => v.into <= 0).length,
      /** Truncated mid-burst: a real cut, and the only case an ear can hear. */
      truncated: M.farCutAt.filter((v) => v.into > 0).length,
      intoMed: med(M.farCutAt.map((v) => v.into)),
      intoMin: M.farCutAt.length ? Math.min(...M.farCutAt.map((v) => v.into)) : null,
      durMed: med(M.farCutAt.map((v) => v.dur)),
      truncatedFractionMed: med(M.farCutAt.filter((v) => v.into > 0).map((v) => +(v.into / v.dur).toFixed(3))),
    },
    audio: { errors: a.stats.errors, failed: !!a.failed, restarts: a.restarts },
  };
}, SECONDS);

console.log(JSON.stringify(out, null, 1));
console.log(`pageerrors=${errs.length}`);
if (errs.length) console.log(' first:', errs[0]);
await browser.close();
