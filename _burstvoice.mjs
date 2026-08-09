/**
 * WHAT ONE BURST SOUNDS LIKE — 「敵味方連射しないね 単発を数回打つだけ」「音は？」
 *
 * `_plainguns.mjs` follows the far chain per MINUTE. That cannot answer the
 * question he is actually asking, which is about ONE BURST: a bot holds the
 * trigger for 39-79 rounds, and what he hears is "a few single shots". Per-minute
 * totals average that away. This probe counts a burst.
 *
 *   --mode=burst   ONE shooter, no war. `_onFire` is muted for everybody except
 *                  the probe, `_rateNext` and the bearing bins are reset, and a
 *                  known number of rounds is injected at a known rpm at a known
 *                  range. Answers: of N rounds, how many VOICES, when, how long
 *                  each one lasts, and where the rest went (rate / bin overflow /
 *                  field refusal / steal).
 *
 *   --mode=live    the real firefight, player driven into contact. Rounds fired
 *                  per second against gunshot voices reaching the mixer per
 *                  second — his ratio — plus the real per-burst cadence measured
 *                  off `ai.onAgentFire` (the event carries no shooter id; the
 *                  method does).
 *
 * The gate arithmetic under test: a burst is CLUMPED, and `_allow` is a strict
 * minimum interval with no burst allowance, so a source at just under the gate
 * rate loses every other event. 16.2 rounds/s against `_rate.shot` 16/s is 50 %
 * by construction, and the gate is shared by every shooter on the map.
 *
 *   node _burstvoice.mjs --mode=burst --map=plains
 *   node _burstvoice.mjs --mode=live  --map=plains --drive --seconds=60
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const MAP = args.map ?? 'plains';
const MODE = args.mode ?? 'burst';
const SECONDS = Number(args.seconds ?? 60);
const WARM = Number(args.warm ?? 40);
const PORT = args.port ?? '4633';
const URL = `http://127.0.0.1:${PORT}/?map=${MAP}${args.nocap ? '' : '&capture=1'}${args.seed ? `&seed=${args.seed}` : ''}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
if (args.clamp) await page.addInitScript((n) => { window.__CLAMP__ = n; }, Number(args.clamp));
if (args.depth1) await page.addInitScript(() => { window.__DEPTH1__ = true; });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 300000 });

await page.evaluate(async () => {
  const a = window.__ENGINE__.ctx.peek('audio');
  try { await a?.start?.(); } catch { /* reported below */ }
  window.__ENGINE__.ctx.time.scale = 8;
});
await page.waitForTimeout(WARM * 1000);

/* ================================================================== */
/* MODE: burst — one shooter, no war                                   */
/* ================================================================== */
if (MODE === 'burst') {
  const out = await page.evaluate(async () => {
    const e = window.__ENGINE__, ctx = e.ctx;
    const a = ctx.peek('audio'), f = a.field, b = a.battle;
    ctx.time.scale = 1;
    if (window.__CLAMP__) {
      f.cap = window.__CLAMP__;
      f._trackRender = () => { f.cap = window.__CLAMP__; };
    }

    const realOnFire = a._onFire.bind(a);
    // MUTE THE WAR. Every other shooter's rounds stop reaching the gate, the
    // bins and the pool, so what is measured below is the SHAPE of the limiter
    // on one burst rather than a contest between forty men.
    a._onFire = () => {};

    const R = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Fire `rounds` at `rpm` from `dist` metres due +X of the listener.
    async function burst(label, dist, rounds, rpm, profile) {
      // Reset every gate this burst will meet, so no earlier burst pays for it.
      // `_rateNext` is the pre-bucket limiter; `_tokens`/`_tokenAt` is the
      // bucket. Both are handled so the probe runs against either build.
      if (a._rateNext) for (const k of Object.keys(a._rateNext)) a._rateNext[k] = 0;
      if (a._tokens) {
        for (const k of Object.keys(a._tokens)) a._tokens[k] = a._burst[k];
        for (const k of Object.keys(a._tokenAt)) a._tokenAt[k] = a.actx.currentTime;
      }
      for (let i = 0; i < b._binN.length; i++) b._binN[i] = 0;
      b._farNext = 0;

      const M = {
        label, dist, rounds, rpm,
        offered: 0, ownPath: 0,
        allowPass: 0, allowDeny: 0,
        offerFarCalls: 0, offerFarTaken: 0,
        playAtCalls: 0, playAtOk: 0,
        playFarCalls: 0, playFarOk: 0,
        acqOk: 0, acqNull: 0, stolen: 0,
        farRoundsCarried: 0, farVoiceRounds: [], farVoiceSpacing: [],
        onsets: [], spans: [], sendArg: [], sendNode: [],
      };

      const alw = a._allow.bind(a);
      a._allow = (k) => {
        const r = alw(k);
        if (k === 'shot') { if (r) M.allowPass++; else M.allowDeny++; }
        return r;
      };
      const of = b.offerFar.bind(b);
      b.offerFar = (x, y, z, d, p) => {
        M.offerFarCalls++;
        const r = of(x, y, z, d, p);
        if (r) M.offerFarTaken++;
        return r;
      };
      const pf = a.playFar.bind(a);
      a.playFar = (x, y, z, o) => {
        M.playFarCalls++;
        const r = pf(x, y, z, o);
        if (r) {
          M.playFarOk++;
          M.farRoundsCarried += o.rounds ?? 0;
          M.farVoiceRounds.push(o.rounds ?? 0);
          M.farVoiceSpacing.push(+(o.spacing ?? 0).toFixed(4));
        }
        return r;
      };
      const pa = a._playAt.bind(a);
      a._playAt = (kind, x, y, z, o, bus, pri) => {
        const gun = kind === 'shot' || kind === 'far';
        if (gun) M.playAtCalls++;
        const ok = pa(kind, x, y, z, o, bus, pri);
        if (gun && ok) M.playAtOk++;
        return ok;
      };
      // ONLY THE GUNFIRE. `acquire` is global and the ambience bed, the wind and
      // the battle layer's own footsteps go through it too; counting those as
      // "voices this burst produced" is how a probe flatters itself.
      const mine = new Set();
      const ac = f.acquire.bind(f);
      f.acquire = (spec) => {
        const gun = spec.bus === 'weapons';
        const before = f.stats.stolen;
        const em = ac(spec);
        if (!em) { if (gun) M.acqNull++; return em; }
        if (!gun) return em;
        M.acqOk++;
        if (f.stats.stolen > before) M.stolen++;
        // The onset the player would hear: `when` already carries the
        // propagation delay, so this is the real arrival instant.
        M.onsets.push(+spec.when.toFixed(4));
        mine.add(em);
        return em;
      };
      const hold = f.hold.bind(f);
      f.hold = (em, node, end, send) => {
        const r = hold(em, node, end, send);
        // Voice LENGTH — the thing that decides whether two rounds overlap into
        // a roll or arrive as two taps. `end` is the voice's own last sample.
        if (mine.has(em)) {
          M.spans.push(+(end - (em.startAt ?? 0)).toFixed(4));
          /**
           * THE TAIL, AND HOW MUCH OF IT IS THE ROOM — 「銃声が鳴り響く感じは実装
           * していないの？」. `send` is the voice's own authored wetness after
           * `weaponShot` has multiplied it by the weapon's character, the
           * distance term and `echoBoost`; `sendGain.gain.value` is what
           * `_applySend` finally puts in front of the convolvers. The two
           * together say whether the plain has a room or only an IR nobody is
           * feeding.
           */
          M.sendArg.push(+(send ?? 0).toFixed(5));
          M.sendNode.push(+(em.sendGain?.gain?.value ?? -1).toFixed(5));
          mine.delete(em);
        }
        return r;
      };

      const lp = f.listenerPos;
      const origin = { x: lp.x + dist, y: lp.y, z: lp.z };
      const gap = 60 / rpm;
      const t0 = a.actx.currentTime;
      for (let i = 0; i < rounds; i++) {
        const due = t0 + i * gap;
        // Spin on the AUDIO clock, not on setTimeout: the gate is a minimum
        // interval on that same clock and timer jitter would be measuring the
        // browser rather than the limiter.
        while (a.actx.currentTime < due) await sleep(1);
        M.offered++;
        realOnFire({ weapon: profile, origin, firstPerson: false });
      }
      // Let the bins flush and the tails run out.
      await sleep(2500);

      a._allow = alw; b.offerFar = of; a.playFar = pf; a._playAt = pa;
      f.acquire = ac; f.hold = hold;

      const on = M.onsets.slice().sort((p, q) => p - q);
      const gaps = [];
      for (let i = 1; i < on.length; i++) gaps.push(+(on[i] - on[i - 1]).toFixed(4));
      const med = (x) => { if (!x.length) return null; const s = [...x].sort((p, q) => p - q); return s[s.length >> 1]; };
      const sum = (x) => x.reduce((s, n) => s + n, 0);
      M.voices = on.length;
      M.voiceGapMed = med(gaps);
      M.voiceSpanMed = med(M.spans);
      // OVERLAP: a voice that is still sounding when the next one starts is a
      // roll; one that has finished is a separate tap.
      M.overlapFrac = gaps.length
        ? +(gaps.filter((g, i) => g < (M.spans[i] ?? 0)).length / gaps.length).toFixed(3) : null;
      M.burstSeconds = +(rounds / (rpm / 60)).toFixed(3);
      M.voicesPerSec = +(on.length / Math.max(0.001, M.burstSeconds)).toFixed(2);
      M.roundsPerVoiceHeard = +(rounds / Math.max(1, on.length)).toFixed(2);
      M.spanTotal = +sum(M.spans).toFixed(2);
      M.sendArgMed = med(M.sendArg);
      M.sendNodeMed = med(M.sendNode);
      delete M.onsets; delete M.spans; delete M.sendArg; delete M.sendNode;
      R.push(M);
    }

    // 800 rpm = 13.3 rounds/s; the eyes-on median measured was 45 rounds over
    // 2784 ms = 16.2 rounds/s. Both are run, because the first sits just under
    // `_rate.shot` 16 and the second just over — the two sides of the cliff.
    await burst('near-30m-13.3rps', 30, 45, 800, 'ai_rifle');
    await burst('near-30m-16.2rps', 30, 45, 970, 'ai_rifle');
    await burst('near-55m-16.2rps', 55, 45, 970, 'ai_rifle');
    await burst('far-154m-16.2rps', 154, 45, 970, 'ai_rifle');
    await burst('far-200m-16.2rps', 200, 45, 970, 'ai_rifle');
    await burst('far-314m-16.2rps', 314, 45, 970, 'ai_rifle');
    await burst('far-200m-lmg-79r', 200, 79, 700, 'lmg');

    a._onFire = realOnFire;
    return {
      level: ctx.peek('world').level.id,
      phase: ctx.peek('match')?.phase ?? '?',
      rateShot: a._rate.shot, pool: f.emitters.length, cap: f.cap,
      space: { classified: a.stats.space, wetness: +a._wetness(a._space).toFixed(4),
        open: +(+a._space.open).toFixed(3), street: +(+a._space.street).toFixed(3) },
      bursts: R,
      audio: { errors: a.stats.errors, failed: !!a.failed },
    };
  });
  console.log(JSON.stringify(out, null, 1));
  console.log(`pageerrors=${errs.length}`);
  if (errs.length) console.log(' first:', errs[0]);
  await browser.close();
  process.exit(0);
}

/* ================================================================== */
/* MODE: live — the real firefight                                     */
/* ================================================================== */
const boot = await page.evaluate((drive) => {
  const e = window.__ENGINE__, ctx = e.ctx;
  const a = ctx.peek('audio'), f = a.field, b = a.battle;
  ctx.time.scale = 1;
  if (window.__CLAMP__) {
    f.cap = window.__CLAMP__;
    f._trackRender = () => { f.cap = window.__CLAMP__; };
  }
  /**
   * `--depth1` IS THE A/B CONTROL, in the spirit of `--nofloor` in
   * `_plainguns.mjs`: a token bucket of depth 1 refilling at `_rate` IS the
   * strict minimum interval `_allow` used to be, so this reproduces the shipped
   * behaviour before the bucket ON THE SAME BUILD, the same seed and the same
   * machine minute. Two separate builds would be two different matches and the
   * field-pressure numbers could not be compared between them.
   */
  if (window.__DEPTH1__ && a._burst) {
    for (const k of Object.keys(a._burst)) { a._burst[k] = 1; a._tokens[k] = 1; }
  }
  const ai = ctx.peek('ai'), pl = ctx.peek('player');

  const M = {
    t0: a.actx.currentTime,
    fired: 0, own: 0, remote: 0, near: 0, far: 0, beyond: 0,
    allow: {}, deny: {},
    shotVoices: 0, farVoices: 0, farRounds: 0,
    impactPlayed: 0, barkPlayed: 0, bodyfallPlayed: 0, shotSend: [],
    farRoundsBinned: 0, farRoundsDropped: 0,
    // per-shooter arrival stamps, for the real cadence
    perAgent: new Map(),
    bursts: [],
    nearestEnemy: [], teleports: 0,
  };
  window.__M__ = M;

  /* real cadence: the event carries no shooter, the method does */
  if (ai?.onAgentFire) {
    const oaf = ai.onAgentFire.bind(ai);
    ai.onAgentFire = (agent, origin, dir) => {
      const t = a.actx.currentTime;
      let s = M.perAgent.get(agent.id);
      if (!s) { s = { last: -9, n: 0, start: t }; M.perAgent.set(agent.id, s); }
      // > 350 ms of silence ends a burst. Bots cycle at 60-140 ms.
      if (t - s.last > 0.35) {
        if (s.n > 1) M.bursts.push({ n: s.n, ms: +((s.last - s.start) * 1000).toFixed(0) });
        s.n = 0; s.start = t;
      }
      s.n++; s.last = t;
      return oaf(agent, origin, dir);
    };
  }

  ctx.events.on('weapon:fire', (p) => {
    M.fired++;
    const lp = f.listenerPos;
    if (!p?.origin) { M.own++; return; }
    const d = Math.hypot(p.origin.x - lp.x, p.origin.y - lp.y, p.origin.z - lp.z);
    if (p.firstPerson || d < 2.6) { M.own++; return; }
    M.remote++;
    if (d < 60) M.near++; else if (d <= 320) M.far++; else M.beyond++;
  });

  /* ALL SEVEN KINDS — the limiter is shared, so a change to it must be
   * measured on every one of them, not only on gunshots. */
  const alw = a._allow.bind(a);
  a._allow = (k) => {
    const r = alw(k);
    if (r) M.allow[k] = (M.allow[k] ?? 0) + 1; else M.deny[k] = (M.deny[k] ?? 0) + 1;
    return r;
  };

  const of = b.offerFar.bind(b);
  b.offerFar = (x, y, z, d, p) => { const r = of(x, y, z, d, p); if (r) M.farRoundsBinned++; return r; };

  const pa = a._playAt.bind(a);
  a._playAt = (kind, x, y, z, o, bus, pri) => {
    const ok = pa(kind, x, y, z, o, bus, pri);
    if (ok && kind === 'shot') { M.shotVoices++; M.shotSend.push(+(o.echoBoost ?? -1).toFixed(4)); }
    if (ok && kind === 'far') { M.farVoices++; M.farRounds += o.rounds ?? 0; }
    if (ok && kind === 'impact') M.impactPlayed++;
    if (ok && kind === 'bark') M.barkPlayed++;
    if (ok && kind === 'bodyfall') M.bodyfallPlayed++;
    return ok;
  };

  /* ---- THE DAMAGE GATES: what they refuse and what they let through ----
   * A subtraction cannot be heard going wrong, so both sides are counted in a
   * live firefight rather than asserted at boot. */
  M.dmg = { calls: 0, relevant: 0, refused: 0, playerSource: 0, playerTarget: 0 };
  M.death = { calls: 0, played: 0, refusedFar: 0, byPlayer: 0 };
  M.flesh = { calls: 0, refusedFar: 0 };
  const rel = a._relevantDamage.bind(a);
  a._relevantDamage = (p) => {
    M.dmg.calls++;
    const r = rel(p);
    if (r) M.dmg.relevant++; else M.dmg.refused++;
    if (a._isPlayerActor(p?.source)) M.dmg.playerSource++;
    if (a._isPlayerActor(p?.target)) M.dmg.playerTarget++;
    return r;
  };
  const onDeath = a._onDeath.bind(a);
  a._onDeath = (p) => {
    M.death.calls++;
    const pt = p?.point;
    if (pt) {
      const d = a.field.distanceTo(pt.x, pt.y, pt.z);
      const mine = a._isPlayerActor(p?.by);
      if (mine) M.death.byPlayer++;
      if (d > 60 && !mine) M.death.refusedFar++; else M.death.played++;
    }
    return onDeath(p);
  };
  const onImp = a._onImpact.bind(a);
  a._onImpact = (p) => {
    if (p?.surface === 'flesh' && !p?.exit && p?.point) {
      M.flesh.calls++;
      const d = a.field.distanceTo(p.point.x, p.point.y, p.point.z);
      if (d <= 90 && d > 60 && !a._isPlayerActor(p.actor)) M.flesh.refusedFar++;
    }
    return onImp(p);
  };

  window.__IV__ = setInterval(() => {
    const lp = f.listenerPos;
    let nd = Infinity;
    for (const g of (ai?.agents ?? [])) {
      if (!g?.alive || !g.position) continue;
      const d = Math.hypot(g.position.x - lp.x, g.position.y - lp.y, g.position.z - lp.z);
      if (d < nd) nd = d;
    }
    if (Number.isFinite(nd)) M.nearestEnemy.push(+nd.toFixed(1));
    if (!drive || !pl) return;
    if (pl.health !== undefined && pl.health < 90) pl.health = 100;
    M._tele = (M._tele ?? 0) + 0.1;
    if (M._tele < 3) return;
    M._tele = 0;
    const hot = (ai?.agents ?? []).filter((g) => g?.alive && g.position && (g.hasTarget || g.target));
    if (!hot.length) return;
    const g = hot[(M.teleports * 7 + 3) % hot.length];
    try {
      pl.teleport({ x: g.position.x + 1.2, y: g.position.y + 1.62, z: g.position.z + 1.2 }, 0);
      M.teleports++;
    } catch { /* best effort */ }
  }, 100);

  return {
    level: ctx.peek('world').level.id, phase: ctx.peek('match')?.phase ?? '?',
    running: !!a.running, pool: f.emitters.length, agents: (ai?.agents ?? []).length,
  };
}, !!args.drive);
console.log('[burstvoice] boot:', JSON.stringify(boot));

await page.waitForTimeout(SECONDS * 1000);

const out = await page.evaluate(() => {
  clearInterval(window.__IV__);
  const M = window.__M__, e = window.__ENGINE__;
  const a = e.ctx.peek('audio'), f = a.field, b = a.battle;
  const secs = a.actx.currentTime - M.t0;
  const med = (x) => { if (!x.length) return null; const s = [...x].sort((p, q) => p - q); return s[s.length >> 1]; };
  const per = (n) => +(n / secs).toFixed(2);
  // flush any burst still open
  for (const s of M.perAgent.values()) if (s.n > 1) M.bursts.push({ n: s.n, ms: +((s.last - s.start) * 1000).toFixed(0) });
  const heard = M.shotVoices + M.farVoices;
  return {
    level: e.ctx.peek('world').level.id, phase: e.ctx.peek('match')?.phase ?? '?',
    seconds: +secs.toFixed(1), teleports: M.teleports,
    nearestEnemy: { median: med(M.nearestEnemy), min: Math.min(...M.nearestEnemy) },
    cadence: {
      bursts: M.bursts.length,
      roundsMed: med(M.bursts.map((x) => x.n)),
      msMed: med(M.bursts.map((x) => x.ms)),
      rpsMed: med(M.bursts.filter((x) => x.ms > 0).map((x) => +((x.n - 1) / (x.ms / 1000)).toFixed(1))),
    },
    ROUNDS: { fired: M.fired, own: M.own, remote: M.remote, near60: M.near, far: M.far, beyond320: M.beyond,
      remotePerSec: per(M.remote) },
    VOICES: { nearShot: M.shotVoices, farVoices: M.farVoices, farRoundsCarried: M.farRounds,
      gunshotVoicesPerSec: per(heard) },
    THE_RATIO: {
      roundsFiredPerSec: per(M.remote),
      voicesHeardPerSec: per(heard),
      roundsPerVoiceHeard: +(M.remote / Math.max(1, heard)).toFixed(2),
    },
    LIMITER_ALL_SEVEN: { allow: M.allow, deny: M.deny,
      denyPct: Object.fromEntries(Object.keys({ ...M.allow, ...M.deny }).map((k) => {
        const p = M.allow[k] ?? 0, d = M.deny[k] ?? 0;
        return [k, +(100 * d / Math.max(1, p + d)).toFixed(1)];
      })) },
    FAR: { binned: M.farRoundsBinned, carried: M.farRounds,
      lostInBinOverflow: M.farRoundsBinned - M.farRounds - [...b._binN].reduce((s, n) => s + n, 0),
      voices: b.stats.farVoices, rounds: b.stats.farRounds },
    FIELD: { stolen: f.stats.stolen, dropped: f.stats.dropped, cap: f.cap, pool: f.emitters.length },
    DAMAGE_GATES: {
      damageDealt: M.dmg, death: M.death, fleshImpact: M.flesh,
      impactVoices: M.impactPlayed, barkVoices: M.barkPlayed, bodyfallVoices: M.bodyfallPlayed,
    },
    /* THE ROOM THE PLAIN IS IN. `_wetness` is the ONLY space term in the gunshot
     * send chain, so this number times `profile.send` times 0.62 is the entire
     * reverb a shot gets. The blend says which of the five IRs is being used. */
    SPACE: {
      blend: Object.fromEntries(Object.entries(a._space).map(([k, v]) => [k, +(+v).toFixed(3)])),
      classified: a.stats.space,
      wetnessAtListener: +a._wetness(a._space).toFixed(4),
      echoBoostMedShot: med(M.shotSend.filter((v) => v >= 0)),
      irDecaySeconds: { open: 1.15, street: 1.45, room: 1.05, tight: 0.34, tunnel: 1.8 },
    },
    audio: { errors: a.stats.errors, failed: !!a.failed, restarts: a.restarts },
  };
});
console.log(JSON.stringify(out, null, 1));
console.log(`pageerrors=${errs.length}`);
if (errs.length) console.log(' first:', errs[0]);
await browser.close();
