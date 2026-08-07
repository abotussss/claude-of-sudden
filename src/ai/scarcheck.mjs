/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHO WALKS INTO THE FIRE, AND WHO DIES IN IT — the scar census
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node src/ai/scarcheck.mjs --url=http://127.0.0.1:4598/ --seeds=7,11,101
 *
 * `Crash` closed with "the burn hazard is measured as FIRING, not as BALANCED —
 * no AI-side awareness exists, and I did not measure bot deaths in the scar."
 * This is that measurement, and it is the gate on whether anything gets built:
 * if almost nobody walks into 157 m of burning plain, the honest answer is the
 * number and no machinery.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS COUNTED, AND WHY EACH OF THEM SEPARATELY
 * ───────────────────────────────────────────────────────────────────────────
 * The scar is a UNION OF 27 CIRCLES of `SEAR_R` = 7 m centred on `Crash._cx/
 * _cy/_cz` — about a 14 m corridor 157 m long — and there are three distinct
 * questions about it that a single number blurs together:
 *
 *   ENTRIES      how many times a live bot crossed into that corridor at all.
 *                Counted on the RISING EDGE per man, so a man who stands in it
 *                for a minute is one entry and not four hundred samples.
 *   DWELL        man-seconds inside it while the burn is still doing damage
 *                (`_searLeft > 0`). This is the exposure, and it is the thing
 *                a route change has to move.
 *   BURN KILLS   men whose `alive` went false INSIDE `applyDamage` on a blast
 *                this act emitted. That is attribution rather than correlation:
 *                `AiSystem`'s `explosion` handler does not forward `source`, so
 *                the probe tags the dispatch instead (`events.emit` is wrapped
 *                for the duration of one emit) and reads the flag in a wrapped
 *                `Agent.prototype.applyDamage`.
 *
 * The act's three blast kinds are kept apart because they are three different
 * events wearing one `source: 'crash'`: the IMPACT (r34 / 240), the 27 PLOUGH
 * lights (r9 / 70, five seconds, unavoidable by anybody — the wreck arrives
 * where it arrives), and the SEAR (r7 / 26, every 2.6 s for 70 s), which is the
 * only one of the three that an AI could ever have routed around. A fix that
 * moves the impact number is a fix that is measuring noise.
 *
 * DEATHS-IN-SCAR is reported alongside BURN KILLS and is deliberately not the
 * same number: it is every man who died while standing in the corridor, which
 * includes being shot there. Both matter — a fire that turns a corridor into a
 * killing field is a fire the AI should know about either way — but only the
 * first is caused by the fire.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE CLOCK
 * ───────────────────────────────────────────────────────────────────────────
 * The act is authored at about `progress` 0.54 of a 430-570 s match, i.e. it
 * fires around t=300 s and its damage window closes 75 s later. At `scale` 8
 * that whole span is under a minute of wall clock, and the sampler runs once
 * per rAF, which at scale 8 is a sample every ~0.13 sim-seconds — six times
 * finer than the 2.6 s between sear passes and fine enough that a man crossing
 * a 14 m corridor at a flat-out run is sampled about sixteen times inside it.
 *
 * The run ends when the fire stops burning, the round ends, or the wall clock
 * runs out — whichever is first — and it reports which.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IT MEASURED, AND WHY NOTHING WAS BUILT ON THE BACK OF IT
 * ───────────────────────────────────────────────────────────────────────────
 * 18 match-samples on `?map=plains&capture=1` — 12 at the authored beat
 * (t=269-363 s) and 6 with the act forced at t=60 s at full roster strength:
 *
 *   SEAR KILLS                3 in 18 matches   = 0.17 a match
 *   deaths a match           ~217               → 0.08 % of all deaths
 *   sear hits / blasts thrown  152 / 6318       = 2.4 % of blasts connect
 *   hp delivered a match      ~32 hp            spread across a 39-man roster
 *   IMPACT kills (r34)        8 in 18           = 0.44 a match
 *
 * THE PART A ROUTE COULD AVOID IS THE LEAST LETHAL PART OF THE ACT. The 34 m
 * impact blast — which arrives in thirteen seconds and which nobody can route
 * around — kills nearly THREE TIMES as often as the 70 s of burning ground
 * that an avoidance layer would have been built for.
 *
 * AND THE 26 DAMAGE IN `crash.js` IS NOT WHAT LANDS. `AiSystem`'s `explosion`
 * handler applies `damage × f²` with `f = 1 - d/radius`, and for a man standing
 * anywhere in a circle E[f²] = 1/6 — so the expected delivered hit is 26/6 =
 * 4.33 hp. MEASURED over 152 connections: **4.3 hp**. `SEAR_DMG` is a centre-
 * of-cell figure and the realised hazard is a sixth of its headline. To die of
 * it a man must take ~23 consecutive passes, i.e. stand in the fire for 60 of
 * its 70 seconds, and `TRACK` keeps the corridor 37 m clear of every capture
 * circle so there is nothing in there to stand for.
 *
 * FORCING IT EARLY DID NOT CHANGE THE ANSWER (1 kill in 6 at t=60 s against 2
 * in 12 at the authored beat), which rules out "safe only because it fires
 * late" — it is safe because of WHERE, exactly as the act's design note claimed.
 *
 * The ridge fires (`PLAINS.fires`) are not a second hazard: they are lit
 * boulders, embers and a `LightPool` slot on the rim at r=194-203 m, beyond
 * every objective (max ~158 m), and nothing in the codebase reads them for
 * damage. Grepped, not assumed.
 *
 * CONCLUSION: no hazard-avoidance machinery was built. It would have spent A*
 * budget on a 4.5 ms ration that already fails 35.7 % of solves, and risked the
 * one failure mode that matters (「占領しにいけ」 — a man who will not cross a
 * capture circle), to prevent one death every six matches.
 *
 * ONE CAVEAT ON READING THIS FILE'S OUTPUT: the sim is NOT reproducible across
 * runs at a given seed. `Engine.step` takes `rawDt` from `performance.now()`,
 * so frame pacing — i.e. machine load — feeds the integration, and the same
 * seed re-run gave dwell-hot of 1.7 and 71.6 man-s on two passes. Every run is
 * an independent SAMPLE; report totals over many, never a single seed.
 */
import { chromium } from 'playwright';

/* Split on the FIRST `=` only: a destructured `split('=')` truncates
 * `--url=http://…/?map=plains` to `--url=http://…/?map` and silently measures
 * the town. @see the same note in `tools/navcheck.mjs`. */
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4598/';
const SEEDS = String(args.seeds ?? args.seed ?? '7').split(',');
const MAP = args.map ?? 'plains';
/** Wall-clock seconds the in-page loop may run before it gives up. */
const WALL = +(args.wall ?? 150);
const SCALE = +(args.scale ?? 8);
const TAG = args.tag ?? '';
/**
 * SENSITIVITY: FIRE THE ACT EARLY, BY HAND, AT THIS MANY SECONDS INTO THE ROUND.
 *
 * The authored beat lands at about t=300-360 s, by which point both sides have
 * been grinding for five minutes. If the scar turns out to be harmless there,
 * the obvious objection is "harmless because of WHEN, not because of WHERE" —
 * so this fires the identical event at full roster strength, when traffic
 * across the map is at its highest and every man still has a long walk in front
 * of him. Same track, same cells, same 70 s of sear; only the clock differs.
 *
 * `MatchSystem` will still call its own `crash` beat later and `fire()` is
 * idempotent-ish (it just resets `_t`), so the window measured is the FIRST
 * one — the loop below stops when that fire goes out.
 */
const FORCE = args.force === undefined ? -1 : +args.force;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const rows = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${URL}?capture=1&map=${MAP}&seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 600000 });

  const out = await page.evaluate(async ({ WALL, SCALE, FORCE }) => {
    const e = window.__ENGINE__;
    const ctx = e.ctx;
    const m = ctx.peek('match');
    const ai = ctx.peek('ai');
    const pl = ctx.peek('player');
    const level = ctx.peek('world')?.level?.id ?? '?';
    e.input.frozen = true;
    e.input.enabled = false;
    pl?.setControlEnabled?.(false);
    const frame = () => new Promise((r) => requestAnimationFrame(r));

    const crash = m?.crash;
    if (!crash || crash.ready !== true) {
      return { level, err: 'this map bakes no crash track' };
    }

    /**
     * THE ROSTER DOES NOT EXIST AT `__READY__`. `AiSystem.agents` is empty
     * until the round begins, so `Object.getPrototypeOf(ai.agents[0])` threw
     * here. Everything below is installed once there is a man to read the
     * prototype off, which is 300 s of match before the act fires anyway.
     */
    e.time.scale = SCALE;
    while (m.phase !== 'live' || ai.agents.length === 0) await frame();

    /* ---- attribution: tag the dispatch, read it in applyDamage ---------- */
    const S = {
      level,
      hits: [0, 0, 0, 0], dmg: [0, 0, 0, 0], kills: [0, 0, 0, 0],
      burnedMen: new Set(),
      entries: 0, entriesByMan: new Set(),
      dwell: 0, dwellHot: 0,
      diedInScar: 0, deaths: 0,
      samples: 0, simT: 0,
      firedAt: -1, restAt: -1, endWhy: '?',
      roster: ai.agents.length,
      peakInScar: 0,
      /**
       * HOW MANY BLASTS THE FIRE ACTUALLY THREW, per kind. This is the
       * denominator the hit counts mean nothing without: `_searPass` emits
       * fourteen every 2.6 s for 70 s — about 364 a match — and "19 hits"
       * is a completely different sentence next to 364 than next to 19.
       */
      blasts: [0, 0, 0, 0],
      /** Worst cumulative sear damage on any ONE man, hp. */
      worstMan: 0,
    };
    const perMan = new Map();
    /** 0 = not a crash blast, 1 = impact, 2 = plough light, 3 = sear. */
    let tag = 0;
    const origEmit = ctx.events.emit.bind(ctx.events);
    ctx.events.emit = function (type, payload) {
      if (type === 'explosion' && payload && payload.source === 'crash') {
        tag = payload.radius > 20 ? 1 : payload.radius > 8 ? 2 : 3;
        S.blasts[tag]++;
        try { return origEmit(type, payload); } finally { tag = 0; }
      }
      return origEmit(type, payload);
    };
    const proto = Object.getPrototypeOf(ai.agents[0]);
    const origAD = proto.applyDamage;
    proto.applyDamage = function (amount, part, point, dir, source) {
      if (tag === 0) return origAD.call(this, amount, part, point, dir, source);
      const was = this.alive;
      const r = origAD.call(this, amount, part, point, dir, source);
      S.hits[tag]++;
      S.dmg[tag] += amount;
      if (tag === 3) {
        S.burnedMen.add(this.id);
        const c = (perMan.get(this.id) ?? 0) + amount;
        perMan.set(this.id, c);
        if (c > S.worstMan) S.worstMan = c;
      }
      if (was && !this.alive) S.kills[tag]++;
      return r;
    };

    /* ---- the corridor --------------------------------------------------- */
    const cx = crash._cx, cy = crash._cy, cz = crash._cz;
    const N = cx.length;
    const R = 7.0;         // SEAR_R
    const R2 = R * R;
    /** A man on the ridge above a cell is not standing in that cell's fire. */
    const DY = 4.0;

    const inScar = new Map();   // agent.id -> was inside last sample
    const wasAlive = new Map();

    for (const a of ai.agents) wasAlive.set(a.id, a.alive);

    const wall0 = performance.now();
    const t0 = e.time.elapsed;
    let forced = FORCE < 0;
    for (;;) {
      await frame();
      /** @see `FORCE` — the same act, at full roster strength. */
      if (!forced && e.time.elapsed - t0 >= FORCE) {
        forced = true;
        S.forcedFire = crash.fire();
      }
      const dt = e.time.dt;
      S.simT = e.time.elapsed - t0;
      if ((performance.now() - wall0) / 1000 > WALL) { S.endWhy = 'wall'; break; }
      if (m.phase !== 'live') { S.endWhy = 'round over'; break; }
      if (crash._t >= 0 && S.firedAt < 0) S.firedAt = S.simT;
      const burning = crash._burn > 0;
      const hot = crash._searLeft > 0;
      if (burning && S.restAt < 0) S.restAt = S.simT;
      if (S.restAt >= 0 && !burning) { S.endWhy = 'fire out'; break; }
      /**
       * ON A FORCED RUN, STOP WHEN THE DAMAGE STOPS, not when the fire does.
       *
       * The burn outlives the sear by 170 s, and on a forced run that tail runs
       * straight into `MatchSystem`'s OWN `crash` beat at the authored time —
       * which re-fires the act and would fold a second event's traffic into
       * this one's dwell. Every number that matters (`dwellHot`, the sear hits,
       * the burn kills) is closed by then, so the window ends with the hazard.
       */
      if (FORCE >= 0 && S.restAt >= 0 && !hot) { S.endWhy = 'sear over'; break; }
      if (!burning && crash._t < 0) continue;   // nothing on the ground yet

      S.samples++;
      let here = 0;
      for (let k = 0; k < ai.agents.length; k++) {
        const a = ai.agents[k];
        const alv = a.alive === true;
        const pw = wasAlive.get(a.id);
        const was = inScar.get(a.id) === true;
        if (!alv) {
          if (pw) {
            S.deaths++;
            if (was) S.diedInScar++;
          }
          wasAlive.set(a.id, false);
          inScar.set(a.id, false);
          continue;
        }
        wasAlive.set(a.id, true);
        const px = a.position.x, py = a.position.y, pz = a.position.z;
        let now = false;
        for (let i = 0; i < N; i++) {
          const dx = px - cx[i], dz = pz - cz[i];
          if (dx * dx + dz * dz > R2) continue;
          if (Math.abs(py - cy[i]) > DY) continue;
          now = true;
          break;
        }
        if (now) {
          here++;
          S.dwell += dt;
          if (hot) S.dwellHot += dt;
          if (!was) { S.entries++; S.entriesByMan.add(a.id); }
        }
        inScar.set(a.id, now);
      }
      if (here > S.peakInScar) S.peakInScar = here;
    }

    /* ---- put the engine back the way it was ----------------------------- */
    ctx.events.emit = origEmit;
    proto.applyDamage = origAD;
    e.time.scale = 1;

    return {
      ...S,
      burnedMen: S.burnedMen.size,
      entriesByMan: S.entriesByMan.size,
      phase: m.phase,
    };
  }, { WALL, SCALE, FORCE });

  out.seed = seed;
  out.pageerrors = errs.length;
  if (errs.length) out.firstError = errs[0];
  rows.push(out);
  await page.close();
  const n = (v) => (typeof v === 'number' ? v.toFixed(1) : v);
  if (out.err) {
    console.log(`seed ${seed}: ${out.err} (level=${out.level})`);
  } else {
    console.log(
      `seed ${seed} [${out.level}] fired@${n(out.firedAt)}s rest@${n(out.restAt)}s ` +
      `end=${out.endWhy} sim=${n(out.simT)}s err=${out.pageerrors}\n` +
      `   ENTRIES ${out.entries} (${out.entriesByMan}/${out.roster} men)  ` +
      `DWELL ${n(out.dwell)} man-s (${n(out.dwellHot)} while burning)  peak ${out.peakInScar} at once\n` +
      `   BURN kills sear=${out.kills[3]} plough=${out.kills[2]} impact=${out.kills[1]}  ` +
      `sear ${out.hits[3]} hits / ${out.blasts[3]} blasts on ${out.burnedMen} men, ` +
      `${n(out.dmg[3])} hp (worst man ${n(out.worstMan)})\n` +
      `   deaths in window ${out.deaths}, of which INSIDE the scar ${out.diedInScar}`
    );
    if (out.firstError) console.log('   first error:', out.firstError);
  }
}

await browser.close();

const tot = (f) => rows.filter((r) => !r.err).reduce((s, r) => s + f(r), 0);
const live = rows.filter((r) => !r.err);
console.log(`\n=== scar census${TAG ? ` [${TAG}]` : ''} · ${live.length} seed(s) ===`);
if (live.length) {
  console.log(
    `entries ${tot((r) => r.entries)}  men who entered ${tot((r) => r.entriesByMan)}  ` +
    `dwell ${tot((r) => r.dwell).toFixed(1)} man-s (${tot((r) => r.dwellHot).toFixed(1)} hot)\n` +
    `burn kills: sear ${tot((r) => r.kills[3])}  plough ${tot((r) => r.kills[2])}  ` +
    `impact ${tot((r) => r.kills[1])}\n` +
    `sear ${tot((r) => r.hits[3])} hits / ${tot((r) => r.blasts[3])} blasts for ` +
    `${tot((r) => r.dmg[3]).toFixed(0)} hp; ` +
    `deaths in scar ${tot((r) => r.diedInScar)} of ${tot((r) => r.deaths)} in window; ` +
    `pageerrors ${tot((r) => r.pageerrors)}`
  );
}
