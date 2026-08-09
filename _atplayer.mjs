/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BURST LENGTH OF FIRE AIMED AT THE HUMAN — 「まだ敵味方連射しないね」(5th time)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node _atplayer.mjs --url=http://127.0.0.1:4632/ --map=plains --seeds=7,11
 *                      [--warm=120] [--window=150] [--drive=plant|strafe]
 *
 * EVERY BURST NUMBER THIS REPO HAS EVER PRODUCED IS BOT-VERSUS-BOT.
 * `burstcheck`, `_engage` and `_aimed` all sample the whole roster fighting
 * itself with the local player frozen at spawn, where an idle probe player was
 * measured taking ZERO rounds inside 60 m. He is not a bot. He is the one man
 * on the map with a camera behind his eyes, and the only fire he can testify
 * about is the fire pointed at him.
 *
 * So this drives the player INTO CONTACT and measures the pulls whose target
 * is HIM — `agent.targetActor === player`, read at the instant the barrel goes
 * off, which is the same pointer `pickVisibleHostile` scored him with.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE PULL DEFINITION IS BURSTCHECK'S, VERBATIM, AND THAT IS THE POINT
 * ───────────────────────────────────────────────────────────────────────────
 * Same per-man `gapFor` (2.2 round-intervals, floored at 0.30 s — a flat 0.30
 * once scored a 170 rpm revolver at one round per pull and manufactured the
 * bug), same chop ladder re-armed on every round (it once latched one frame
 * after the FIRST round and filed three frames in four of a healthy carbine
 * burst as a chop), same `shooter killed` case. If the at-player number differs
 * from the bot-versus-bot number in this run, the difference is the PLAYER and
 * not the instrument, because the instrument is byte-identical and both
 * populations come out of the SAME 150 seconds of the SAME match.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT "IN CONTACT" MEANS, AND WHY HE IS KEPT ALIVE
 * ───────────────────────────────────────────────────────────────────────────
 * He is teleported to a spot ~22 m from the densest live enemy cluster with a
 * clear line to it, faced at the nearest enemy, and re-placed whenever nobody
 * has had eyes on him for `RELOCATE` seconds. He is healed to full every frame.
 * That is not a fair fight and it is not meant to be one: it is the MOST
 * GENEROUS case for burst length — a stationary, permanently visible, never-
 * dying target in the open. A pull that is short against THIS man is short
 * against any man, and the 「単発を数回打つだけ」 reading would be confirmed
 * rather than explained away.
 *
 * `--drive=strafe` is the honest counterweight: the same man walking, which is
 * what a player actually does, and which lets `contact lost` chop pulls the way
 * his own movement really chops them.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ROUNDS AT BARRELS, NOT ROUNDS AT EARS
 * ───────────────────────────────────────────────────────────────────────────
 * EVERY NUMBER IN THIS FILE COUNTS ROUNDS LEAVING BARRELS. Whether the mixer
 * lets him HEAR them is a different measurement on a different budget (a shot
 * limiter shared by every shooter on the map turns 13.3 rounds/s into however
 * many voices it has left). `perceptible` below is the closest this file gets:
 * rounds whose ray passed within 2 m of his head, i.e. rounds with a whip-crack
 * he is entitled to hear. It is an upper bound on what he can perceive, not a
 * claim that he perceived it.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4632/';
const SEEDS = String(args.seeds ?? args.seed ?? '7').split(',');
const MAP = args.map ?? 'plains';
const WARM = +(args.warm ?? 120);
const WINDOW = +(args.window ?? 150);
const DRIVE = args.drive ?? 'plant';
const TAG = args.tag ?? '';
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHICH CLOCK THE AI IS RUNNING ON — `--nocap` DROPS `capture=1`
 * ═══════════════════════════════════════════════════════════════════════════
 * The audio pass found `?capture=1` forces `rawDt` to EXACTLY 1/60 every frame
 * (@see the `fake` clock in `src/dev/shots.js`), so headless at ~9 fps advances
 * the simulation at 0.147x wall clock — and every gate in `src/audio` is carried
 * on `actx.currentTime`, which is real. Those gates were under-stressed sevenfold
 * and that finding is correct.
 *
 * IT DOES NOT TRANSFER TO THIS FILE, AND THE REASON IS WORTH WRITING DOWN.
 * `Engine.step` calls `update(t.dt)` ONCE per frame — only `fixedUpdate`
 * substeps — and `t.dt = rawDt * scale`, `t.elapsed += t.dt`. So `src/ai` is
 * driven by, and this probe measures in, ONE clock: scaled simulation time.
 * Under `capture=1` that clock ticks at a clean 60 Hz, which is the condition
 * the player actually plays in. Without it, headless dt clamps to 0.1 s and the
 * AI is run as a TEN FRAME PER SECOND game — `_shoot`'s `fired < 12` cap and its
 * cooldown-shedding line start binding at dt=0.1 in a way they never do at 60.
 *
 * So for a burst measurement `capture=1` is the FAITHFUL harness and `--nocap`
 * is the distorted one — the exact opposite of the audio case. Both are run and
 * both are reported, because the claim above is an argument and the numbers are
 * evidence. `simSpeed`, mean dt and effective fps are printed for each so the
 * harness condition is never again something a reader has to take on trust.
 */
const NOCAP = args.nocap === true || args.nocap === 'true';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

const runs = [];
for (const seed of SEEDS) {
  const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${URL}?${NOCAP ? '' : 'capture=1&'}map=${MAP}&seed=${seed}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 900000 });

  const out = await page.evaluate(async ({ WARM, WINDOW, DRIVE, NOCAP }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    const pl = e.ctx.peek('player');
    const phys = e.ctx.peek('physics');
    const level = e.ctx.peek('world')?.level?.id ?? '?';
    e.input.frozen = true;           // no real mouse fights the driver
    e.input.enabled = false;         // …and no real keyboard either
    const frame = () => new Promise((r) => requestAnimationFrame(r));

    /**
     * THE WARM SCALE IS 1 WITHOUT `capture=1`, AND IT HAS TO BE. `t.dt =
     * rawDt * scale` with `rawDt` clamped to 0.1, so scale 12 on a headless
     * frame is a ONE POINT TWO SECOND AI step — the warm-up would not be a
     * fast-forward of the match, it would be a different game.
     */
    e.time.scale = NOCAP ? 1 : 12;
    while (m.phase !== 'live' || ai.agents.length === 0) await frame();
    const t0 = m.roundClock;
    const t = () => t0 - m.roundClock;
    /* He is parked out of the way while the match warms — the fight that forms
     * has to be the roster's own, not one shaped around a stationary human. */
    pl?.setControlEnabled?.(false);
    while (t() < WARM && m.phase === 'live') await frame();
    e.time.scale = 1;
    await frame(); await frame(); await frame();

    /* movement has to be live for `--drive=strafe`; the driver owns yaw. */
    pl?.setControlEnabled?.(true);

    /* ── burstcheck's definitions, verbatim ── */
    const gapFor = (a) => Math.max(0.30, 2.2 / Math.max(0.5, a.fireRate ?? 10));
    const MOVING = 2.0;
    /** Seconds with nobody's eyes on him before he is re-placed. */
    const RELOCATE = 2.5;
    /** How far from the man he is dropped. Inside every weapon's range. */
    const STANDOFF = 22;

    const S = {
      level, drive: DRIVE,
      pulls: [],        // { n, eyesOn, atPlayer, weapon, dur, chopped, why, movingShare }
      rounds: 0, eyesOnRounds: 0, moving: 0, atPlayerRounds: 0,
      manSecs: 0,
      hitsMoving: 0, hitsStill: 0,
      /* the human's own exposure */
      windowSecs: 0, seenSecs: 0, aimedAtSecs: 0,
      shooters: 0, relocations: 0, deaths: 0,
      perceptible: 0,   // enemy rounds passing within 2 m of his head
      playerHits: 0,    // rounds that actually connected with him
      /**
       * THE HARNESS CONDITION ITSELF, measured rather than assumed. `raw` is
       * `Engine.step`'s unscaled wall clock and `elapsed` is the scaled sim
       * clock, so `simSpeed` is sim seconds per wall second and `frames /
       * simSecs` is the frame rate the AI was actually stepped at. A burst
       * number taken at 10 Hz is not a burst number for a game played at 60.
       */
      wallSecs: 0, frames: 0, dtMax: 0,
      /** Distinct enemies who ever had him as their target. */
      everAimed: 0,
    };
    const aimedIds = new Set();

    /**
     * ────────────────────────────────────────────────────────────────────────
     * AND THE STRICTER MEASURE, WHICH IS THE ONE HE IS ACTUALLY DESCRIBING
     * ────────────────────────────────────────────────────────────────────────
     * A pull tagged "at the human" because ONE of its thirty rounds was at him
     * is not thirty rounds at him. What arrives at a player is a RUN OF
     * CONSECUTIVE rounds with him as the target, ended by the same clock gap, by
     * the shooter switching to somebody else, or by the shooter dying. That run
     * is what he counts when he says 「単発を数回打つだけ」, so it is measured
     * separately and reported beside the pull.
     */
    const seg = new Map();
    const segs = [];
    const closeSeg = (id, why) => {
      const s = seg.get(id);
      seg.delete(id);
      if (s && s.n > 0) {
        segs.push({
          n: s.n, dur: s.last - s.first, weapon: s.weapon, why: why ?? s.why,
          /**
           * DID HE HAVE EYES ON THE HUMAN WHILE HE SHOT AT HIM. The same split
           * `burstcheck` makes between an aimed pull and a `BLIND_BURST` into a
           * last-known, made on the population that matters. A 3-5 round tap
           * from a man who cannot see him is `BLIND_BURST` doing its job; the
           * same tap from a man looking straight at him is the defect.
           */
          eyesOn: s.eyes > 0,
          eyesShare: s.eyes / s.n,
          /** Rounds in the gun when the run opened — the "he arrived with a
           *  half-empty magazine" reading has to show up here or not at all. */
          ammo0: s.ammo0, mag: s.mag,
        });
      }
    };

    const open = new Map();
    const closeOut = (id, st) => {
      if (!st || st.n === 0) return;
      S.pulls.push({
        n: st.n, eyesOn: st.eyesOn, atPlayer: st.atPlayer, weapon: st.weapon,
        dur: st.last - st.first, chopped: st.burstLeft > 0, why: st.why ?? '?',
        movingShare: st.movingRounds / st.n,
      });
      open.delete(id);
    };

    const MEN = new WeakSet();
    for (const a of ai.agents) MEN.add(a);
    const onDmg = (ev) => {
      if (!ev) return;
      const src = ev.source;
      if (!src || !MEN.has(src)) return;
      const atMe = ev.target === pl || ev.target === 'player';
      if (!MEN.has(ev.target) && !atMe) return;
      if (atMe) S.playerHits++;
      if ((src.speed ?? 0) > MOVING) S.hitsMoving++; else S.hitsStill++;
    };
    e.ctx.events.on('damage:dealt', onDmg);

    const fire0 = ai.onAgentFire.bind(ai);
    const _p = new (e.ctx.camera.position.constructor)();
    ai.onAgentFire = (a, o, d) => {
      const now = e.time.elapsed;
      const eyes = a.targetVisible === true && a.hasTarget === true;
      const onFeet = a.speed > MOVING;
      /**
       * THE ONE NEW BIT. `targetActor` is the pointer `pickVisibleHostile`
       * chose, and the player is in `hostilesOf` on exactly the same terms as a
       * bot (@see the `ctx.peek('player')` push there), so this is not a
       * parallel code path — it is the same one, asked who it picked.
       */
      const atMe = a.targetActor === pl;
      S.rounds++;
      if (eyes) S.eyesOnRounds++;
      if (onFeet) S.moving++;
      if (atMe) { S.atPlayerRounds++; aimedIds.add(a.id); }
      /* the consecutive run of rounds with HIM as the target — @see `seg` */
      if (!atMe) closeSeg(a.id, 'switched target');
      else {
        let sg = seg.get(a.id);
        if (sg && now - sg.last > gapFor(a)) { closeSeg(a.id, 'gap'); sg = undefined; }
        if (!sg) {
          sg = {
            n: 0, first: now, last: now, weapon: a.weaponId, why: 'gap', eyes: 0,
            ammo0: a.ammo, mag: a.magSize,
          };
          seg.set(a.id, sg);
        }
        sg.n++;
        sg.last = now;
        if (eyes) sg.eyes++;
      }
      /* …and whether the round came near enough to be heard going past. */
      if (!pl?.dead && ai.teamOf(a) !== ai.teamOf(pl ?? 'player')) {
        ai.playerPosition(_p);
        const px = _p.x - o.x, py = _p.y - o.y, pz = _p.z - o.z;
        const tt = px * d.x + py * d.y + pz * d.z;
        if (tt >= 0.5 && tt <= 200) {
          const miss = Math.hypot(px - d.x * tt, py - d.y * tt, pz - d.z * tt);
          if (miss <= 2.0) S.perceptible++;
        }
      }
      let st = open.get(a.id);
      if (st && now - st.last > gapFor(a)) { closeOut(a.id, st); st = undefined; }
      if (!st) {
        st = {
          n: 0, eyesOn: eyes, atPlayer: atMe, weapon: a.weaponId, first: now,
          last: now, burstLeft: 0, why: '?', movingRounds: 0,
        };
        open.set(a.id, st);
      }
      if (onFeet) st.movingRounds++;
      st.n++;
      st.last = now;
      st.burstLeft = a.burstLeft;
      st.why = '?';
      if (eyes) st.eyesOn = true;
      if (atMe) st.atPlayer = true;
      a.__firedFrame = e.time.frame;
      return fire0(a, o, d);
    };

    /* ────────────────────────────────────────────────────────────────────
     * THE DRIVER — put a living human where the shooting is
     * ──────────────────────────────────────────────────────────────────── */
    const myTeam = ai.teamOf(pl ?? 'player');
    const foes = () => ai.agents.filter((a) => a.alive && ai.teamOf(a) !== myTeam);
    const V = _p.constructor;
    const eye = new V();
    const tgt = new V();

    /** The live enemy with the most live friends within 25 m of him. */
    const densest = () => {
      const list = foes();
      let best = null, bestN = -1;
      for (const a of list) {
        let n = 0;
        for (const b of list) {
          if (b === a) continue;
          if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) < 25) n++;
        }
        if (n > bestN) { bestN = n; best = a; }
      }
      return best;
    };

    /** Drop him STANDOFF metres off `man`, on ground, with a clear line to him. */
    const place = (man) => {
      if (!man) return false;
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const x = man.position.x + Math.cos(ang) * STANDOFF;
        const z = man.position.z + Math.sin(ang) * STANDOFF;
        const gy = ai.groundAt(x, z, man.position.y + 30);
        if (!Number.isFinite(gy)) continue;
        eye.set(x, gy + 1.6, z);
        tgt.set(man.position.x, man.position.y + 1.4, man.position.z);
        if (phys && !phys.lineOfSight(eye, tgt, phys.MASK.SIGHT)) continue;
        const yaw = Math.atan2(tgt.x - eye.x, tgt.z - eye.z);
        pl.teleport(eye, yaw);
        S.relocations++;
        return true;
      }
      return false;
    };

    place(densest());
    let dry = 0;      // seconds since anybody last had eyes on him
    let strafeT = 0;
    const raw0 = e.time.raw;

    while (t() < WARM + WINDOW && m.phase === 'live') {
      await frame();
      const dt = e.time.dt;
      const now = e.time.elapsed;
      S.windowSecs += dt;
      S.frames++;
      if (dt > S.dtMax) S.dtMax = dt;

      /* HE DOES NOT DIE. He is an instrument, not a competitor — a probe that
       * lets him fall over measures the roster's marksmanship, not its bursts. */
      if (pl?.dead) { S.deaths++; pl.health.dead = false; }
      pl?.heal?.(999);

      /* who has him */
      let seen = 0, aimedAt = 0, nearest = null, nd = 1e9;
      for (const a of foes()) {
        if (a.targetActor === pl) {
          aimedAt++;
          if (a.targetVisible === true && a.hasTarget === true) seen++;
        }
        const d = Math.hypot(a.position.x - pl.position.x, a.position.z - pl.position.z);
        if (d < nd) { nd = d; nearest = a; }
      }
      if (seen > 0) S.seenSecs += dt;
      if (aimedAt > 0) S.aimedAtSecs += dt;
      dry = seen > 0 ? 0 : dry + dt;
      if (dry > RELOCATE) { place(densest()); dry = 0; }

      /* face the nearest man, so he reads as a human looking at the fight */
      if (nearest && pl?.movement) {
        pl.movement.yaw = Math.atan2(
          nearest.position.x - pl.position.x, nearest.position.z - pl.position.z);
        pl.movement.pitch = 0;
      }
      /* …and walk, if that is the variant being measured */
      if (DRIVE === 'strafe') {
        strafeT += dt;
        const left = Math.sin(strafeT * 0.55) > 0;
        e.input.down.delete(left ? 'KeyD' : 'KeyA');
        e.input.down.add(left ? 'KeyA' : 'KeyD');
      }

      for (let i = 0; i < ai.agents.length; i++) {
        const a = ai.agents[i];
        MEN.add(a);
        if (!a.alive) {
          const dst = open.get(a.id);
          if (dst && dst.why === '?') dst.why = 'shooter killed';
          closeOut(a.id, dst);
          closeSeg(a.id, 'shooter killed');
          continue;
        }
        S.manSecs += dt;
        /* a run of fire at the human ends on the same clock a pull does, and
         * the reason is read off the same ladder at the same frame */
        const sg = seg.get(a.id);
        if (sg && a.__firedFrame !== e.time.frame && now - sg.last > gapFor(a)) {
          closeSeg(a.id, a.targetActor !== pl ? 'switched target'
            : a.animator?.reloading === true ? 'reloading'
              : a.ammo <= 0 ? 'magazine empty'
                : a.hasTarget !== true ? 'contact lost'
                  : !a.wantFire ? 'wantFire false'
                    : a.burstLeft > 0 ? 'cooldown/other' : 'burst spent');
        }
        const st = open.get(a.id);
        if (!st) continue;
        if (a.__firedFrame === e.time.frame) continue;
        if (a.burstLeft > 0 && (st.why === '?' || st.why === 'cooldown/other')) {
          st.why = a.animator?.reloading === true ? 'reloading'
            : a.ammo <= 0 ? 'magazine empty'
              : a.state === 'suppressed' ? 'SUPPRESSED'
                : a.hasTarget !== true ? 'contact lost'
                  : a.state === 'dead' ? 'dead'
                    : !a.wantFire ? 'wantFire false'
                      : 'cooldown/other';
        }
        if (now - st.last > gapFor(a)) closeOut(a.id, st);
      }
    }
    for (const [id, st] of [...open]) closeOut(id, st);
    for (const [id] of [...seg]) closeSeg(id, 'window ended');
    S.segs = segs;
    ai.onAgentFire = fire0;
    e.ctx.events.off?.('damage:dealt', onDmg);
    e.input.down.clear();
    S.everAimed = aimedIds.size;
    S.wallSecs = e.time.raw - raw0;
    return S;
  }, { WARM, WINDOW, DRIVE, NOCAP });

  out.seed = seed;
  out.pageerrors = errs.length;
  runs.push(out);
  await page.close();
}
await browser.close();

/* ---------------- report ---------------- */
const all = runs.flatMap((r) => r.pulls);
const atMe = all.filter((p) => p.atPlayer);
const botBot = all.filter((p) => !p.atPlayer && p.eyesOn);
const manMin = runs.reduce((s, r) => s + r.manSecs / 60, 0);
const rounds = runs.reduce((s, r) => s + r.rounds, 0);
const eyesRounds = runs.reduce((s, r) => s + r.eyesOnRounds, 0);
const moving = runs.reduce((s, r) => s + r.moving, 0);
const sum = (k) => runs.reduce((s, r) => s + (r[k] ?? 0), 0);
const pc = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)} %` : '—');
const med = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
const dist = (ps) => {
  const b = { 1: 0, 2: 0, '3-5': 0, '6-10': 0, '11+': 0 };
  for (const p of ps) {
    if (p.n === 1) b['1']++;
    else if (p.n === 2) b['2']++;
    else if (p.n <= 5) b['3-5']++;
    else if (p.n <= 10) b['6-10']++;
    else b['11+']++;
  }
  return b;
};
const block = (label, ps) => {
  if (!ps.length) { console.log(`\n${label}: NO PULLS`); return; }
  const n = ps.length;
  const d = dist(ps);
  console.log(`\n${label}: ${n} pulls, median ${med(ps.map((p) => p.n))} rounds, ` +
    `mean ${(ps.reduce((s, p) => s + p.n, 0) / n).toFixed(1)}, ` +
    `mean duration ${(ps.reduce((s, p) => s + p.dur, 0) / n * 1000).toFixed(0)} ms`);
  console.log('  rounds per pull:  ' + Object.entries(d)
    .map(([k, v]) => `${k}:${pc(v, n)}`).join('   '));
  console.log(`  ONE OR TWO ROUNDS: ${pc(d['1'] + d['2'], n)}  ◄── 「単発を数回打つだけ」`);
  const chop = ps.filter((p) => p.chopped);
  console.log(`  CHOPPED (burstLeft still owed): ${pc(chop.length, n)}`);
  const why = Object.create(null);
  for (const p of chop) why[p.why] = (why[p.why] ?? 0) + 1;
  for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(18)} ${pc(v, chop.length).padStart(7)}`);
  }
};

console.log(`\n═══ FIRE AT THE HUMAN${TAG ? ` [${TAG}]` : ''} — ${runs[0].level}, ` +
  `drive=${runs[0].drive}, seeds ${runs.map((r) => r.seed).join(',')}, ` +
  `${NOCAP ? 'NO capture=1' : 'capture=1'} ═══`);
{
  const w = runs.reduce((s, r) => s + (r.wallSecs ?? 0), 0);
  const simS = runs.reduce((s, r) => s + r.windowSecs, 0);
  const fr = runs.reduce((s, r) => s + (r.frames ?? 0), 0);
  console.log(`HARNESS: ${simS.toFixed(0)} s of simulation in ${w.toFixed(0)} s of wall clock ` +
    `(simSpeed ${(simS / Math.max(1e-9, w)).toFixed(3)}x) · ${fr} AI frames = ` +
    `${(fr / Math.max(1e-9, simS)).toFixed(1)} Hz of simulated time · ` +
    `worst single AI step ${(Math.max(...runs.map((r) => r.dtMax ?? 0)) * 1000).toFixed(0)} ms`);
  console.log('  Every number below is in SIMULATION time — the one clock `src/ai` is stepped on.');
}
console.log(`${manMin.toFixed(1)} man-minutes · ${rounds} rounds (${(rounds / manMin).toFixed(1)}/man-min) · ` +
  `AIMED ${pc(eyesRounds, rounds)} (${(eyesRounds / manMin).toFixed(1)}/man-min) · ` +
  `MOVING ${moving} abs (${(moving / manMin).toFixed(1)}/man-min, ${pc(moving, rounds)})`);

const win = sum('windowSecs');
console.log(`\nTHE HUMAN: ${win.toFixed(0)} s in the window · ` +
  `somebody had EYES ON him ${pc(sum('seenSecs'), win)} of it · ` +
  `somebody had him as TARGET ${pc(sum('aimedAtSecs'), win)} · ` +
  `${sum('everAimed')} distinct men ever shot at him · ` +
  `${sum('relocations')} relocations · ${sum('deaths')} deaths denied`);
console.log(`  rounds AT HIM ${sum('atPlayerRounds')} (${(sum('atPlayerRounds') / win * 60).toFixed(1)}/min) · ` +
  `rounds passing within 2 m of his head ${sum('perceptible')} ` +
  `(${(sum('perceptible') / win).toFixed(2)}/s) · rounds that hit him ${sum('playerHits')}`);
console.log('  (ROUNDS LEAVING BARRELS. Whether the mixer lets him hear them is not measured here.)');

block('AT THE HUMAN — whole pull, if ANY round of it was at him', atMe);
block('bot-versus-bot, eyes-on (same window, same instrument)', botBot);

/**
 * THE RUN OF CONSECUTIVE ROUNDS AT HIM. @see `seg` in the page. This is the
 * number the complaint is about: not "how long was the pull that happened to
 * include me" but "how many rounds came at me in a row before it stopped".
 */
const segments = runs.flatMap((r) => r.segs ?? []);
if (segments.length) {
  const n = segments.length;
  const d = dist(segments);
  console.log(`\nCONSECUTIVE ROUNDS AT HIM (the burst he actually receives): ${n} runs, ` +
    `median ${med(segments.map((p) => p.n))} rounds, ` +
    `mean ${(segments.reduce((s, p) => s + p.n, 0) / n).toFixed(1)}, ` +
    `mean duration ${(segments.reduce((s, p) => s + p.dur, 0) / n * 1000).toFixed(0)} ms`);
  console.log('  rounds per run:  ' + Object.entries(d)
    .map(([k, v]) => `${k}:${pc(v, n)}`).join('   '));
  console.log(`  ONE OR TWO ROUNDS: ${pc(d['1'] + d['2'], n)}  ◄── 「単発を数回打つだけ」`);
  const why = Object.create(null);
  for (const p of segments) why[p.why] = (why[p.why] ?? 0) + 1;
  console.log('  what ended the run:');
  for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(18)} ${pc(v, n).padStart(7)}`);
  }
  /**
   * AND THE SPLIT THAT SAYS WHETHER THIS IS A DEFECT OR A DESIGN.
   * `BLIND_BURST` rations a pull at a last-known to a handful of rounds ON
   * PURPOSE — 「弾を消費すればいいわけではない」 bought that ration. A short run
   * from a man who could not see him is that ration working. A short run from a
   * man LOOKING AT HIM is the complaint.
   */
  console.log('\n  …split by whether the shooter could SEE him:');
  for (const [label, ps] of [
    ['EYES ON HIM', segments.filter((p) => p.eyesOn)],
    ['blind (last-known)', segments.filter((p) => !p.eyesOn)],
  ]) {
    if (!ps.length) { console.log(`    ${label.padEnd(20)} —`); continue; }
    const k = ps.length;
    const d = dist(ps);
    console.log(`    ${label.padEnd(20)} ${String(k).padStart(4)} runs (${pc(k, n)})  ` +
      `median ${String(med(ps.map((p) => p.n))).padStart(3)}  ` +
      `mean ${(ps.reduce((s, p) => s + p.n, 0) / k).toFixed(1).padStart(5)}  ` +
      `mean dur ${(ps.reduce((s, p) => s + p.dur, 0) / k * 1000).toFixed(0).padStart(5)} ms  ` +
      `3-5 rounds ${pc(d['3-5'], k)}  1-2 ${pc(d['1'] + d['2'], k)}`);
    const am = ps.filter((p) => Number.isFinite(p.ammo0) && p.mag > 0);
    if (am.length) {
      console.log(`      rounds in the gun when the run opened: median ` +
        `${med(am.map((p) => p.ammo0))} of ${med(am.map((p) => p.mag))}  ` +
        `(opened below half a magazine: ${pc(am.filter((p) => p.ammo0 < p.mag / 2).length, am.length)})`);
    }
  }
} else {
  console.log('\nCONSECUTIVE ROUNDS AT HIM: NONE — nobody shot at the human at all.');
}

console.log('\nAT-THE-HUMAN pulls, per weapon:');
const byW = Object.create(null);
for (const p of atMe) (byW[p.weapon] ??= []).push(p.n);
for (const [w, ns] of Object.entries(byW).sort((a, b) => b[1].length - a[1].length)) {
  const d = dist(ns.map((n) => ({ n })));
  console.log(`  ${w.padEnd(9)} ${String(ns.length).padStart(5)} pulls  median ${String(med(ns)).padStart(3)}  ` +
    `mean ${(ns.reduce((s, x) => s + x, 0) / ns.length).toFixed(1).padStart(5)}  ` +
    `1-2 rounds ${pc(d['1'] + d['2'], ns.length)}`);
}

const hitsMov = sum('hitsMoving'), hitsStl = sum('hitsStill');
console.log(`\nHIT RATE by the shooter's own feet: ON FEET ${hitsMov}/${moving} = ${pc(hitsMov, moving)}   ` +
  `PLANTED ${hitsStl}/${rounds - moving} = ${pc(hitsStl, rounds - moving)}`);
console.log(`\npageerrors ${runs.reduce((s, r) => s + r.pageerrors, 0)}`);
