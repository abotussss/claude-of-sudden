/**
 * DOES THE REINFORCEMENT DROP DO WHAT WAS ASKED FOR? One match per seed, run to
 * its natural end, and everything about every drop measured rather than read:
 *
 *   when it fired, for which side, the score at that instant, which trigger,
 *   how many men left the door, how many canopies were open at once, how many
 *   men were CREATED and how many were ALIVE a moment later, where each man
 *   landed and how far that is from the zone his side holds, and whether any of
 *   the ten ever came back after being killed.
 *
 *   node _reinaudit.mjs <url> <seed>
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4386/';
const SEED = process.argv[3] ?? '11';
const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = 12;
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const matchTime = m.roundClock;
  const t = () => +(matchTime - m.roundClock).toFixed(1);
  const R = m.reinforce;

  /* ---- the call: what match ASKED the aircraft to do ------------------- */
  const drops = [];
  const fire0 = R.fire.bind(R);
  R.fire = (o) => {
    const ok = fire0(o);
    if (ok) {
      drops.push({
        t: t(),
        team: o.team,
        label: o.label,
        score: m.score.slice(),
        /** What the guard believed when it let this one through. */
        lifeSaid: +m._matchLifeLeft().toFixed(1),
        centre: { x: +o.centre.x.toFixed(1), y: +o.centre.y.toFixed(1), z: +o.centre.z.toFixed(1) },
        approach: o.approach
          ? { x: +o.approach.x.toFixed(1), z: +o.approach.z.toFixed(1) }
          : null,
        landingsAsked: o.landings.length,
        landings: o.landings.map((p) => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) })),
        /** zone ownership at the instant of the call, straight off `sites`. */
        zoneOwner: (() => {
          const z = m.sites.find((s) => `ZONE ${s.id}` === o.label);
          return z ? z.owner : 'BASE';
        })(),
        released: [],
        touchdowns: [],
        created: [],
        heliSeen: 0,
        maxCanopies: 0,
        releaseY: [],
        rosterBefore: m.roster.length,
        aliveAfter: null,
        aliveAfterT: null,
      });
    }
    return ok;
  };

  /* ---- the man: what actually got put on the ground -------------------- */
  const land0 = R.onLand;
  const recs = [];
  R.onLand = (i, p, yaw) => {
    const d = drops[drops.length - 1];
    const n0 = m.roster.length;
    land0(i, p, yaw);
    const rec = m.roster.length > n0 ? m.roster[m.roster.length - 1] : null;
    if (rec) {
      recs.push(rec);
      rec.__i = i;
      rec.__aliveLog = [];
      rec.__respawned = 0;
      /**
       * TEN MEN ARRIVING TOGETHER IS A CROWDING EVENT, which is what wedged 22
       * of 29 men on nav islands the last time it went wrong. `stuckcheck`
       * cannot see this one — it samples the opening of a match and these men
       * do not exist yet — so the same rule is applied here to the ten
       * themselves: a position every second of GAME time from the moment his
       * boots are down, and the longest run of samples in which he wanted to
       * move and did not.
       */
      rec.__from = { x: p.x, y: p.y, z: p.z };
      rec.__samples = [];
      rec.__nextAt = e.time.elapsed;
    }
    d?.touchdowns.push({
      i,
      t: t(),
      at: { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) },
      created: !!rec,
      team: rec?.team ?? -1,
      name: rec?.name ?? '',
      noRespawn: rec?.noRespawn ?? null,
      /** Is the actor really in the AI system, alive, on the field? */
      inAi: rec ? !!ai.agents?.includes?.(rec.actor) : false,
      actorAt: rec?.actor?.position
        ? {
            x: +rec.actor.position.x.toFixed(1),
            y: +rec.actor.position.y.toFixed(1),
            z: +rec.actor.position.z.toFixed(1),
          }
        : null,
    });
  };

  /* ---- the flight, sampled per frame ----------------------------------- */
  const start = performance.now();
  let seenLastLand = -1;
  while (performance.now() - start < 900000) {
    await new Promise((r) => requestAnimationFrame(r));
    const d = drops[drops.length - 1];
    if (d && R.run) {
      if (R.heli.visible) d.heliSeen++;
      let open = 0;
      for (const tr of R.troops) if (tr.state === 'canopy' || tr.state === 'fall') open++;
      if (open > d.maxCanopies) d.maxCanopies = open;
      if (R.run.out > d.released.length) {
        for (let i = d.released.length; i < R.run.out; i++) {
          d.released.push(i);
          d.releaseY.push(+R.troops[i].from.y.toFixed(1));
        }
      }
    }
    /** A moment after the last man is down: who is actually standing there. */
    if (d && d.aliveAfter === null && d.touchdowns.length >= 10) {
      if (seenLastLand < 0) seenLastLand = t();
      else if (t() - seenLastLand > 3) {
        const mine = recs.filter((r) => r.team === d.team);
        d.aliveAfter = mine.filter((r) => r.alive && r.actor && !r.actor.dead).length;
        d.aliveAfterT = t();
        d.inAiAfter = mine.filter((r) => ai.agents?.includes?.(r.actor)).length;
        d.landDistToCentre = d.touchdowns.map((td) =>
          +Math.hypot(td.at.x - d.centre.x, td.at.z - d.centre.z).toFixed(1)
        );
        d.landErrToAsked = d.touchdowns.map((td, k) => {
          const want = d.landings[td.i] ?? d.landings[k];
          return want ? +Math.hypot(td.at.x - want.x, td.at.z - want.z).toFixed(2) : -1;
        });
        d.pairMin = (() => {
          let mn = Infinity;
          for (let a = 0; a < d.touchdowns.length; a++)
            for (let c = a + 1; c < d.touchdowns.length; c++)
              mn = Math.min(
                mn,
                Math.hypot(
                  d.touchdowns[a].at.x - d.touchdowns[c].at.x,
                  d.touchdowns[a].at.z - d.touchdowns[c].at.z
                )
              );
          return +mn.toFixed(2);
        })();
      }
    }
    /** 1 Hz of GAME time, per man, for as long as he is alive. */
    for (const r of recs) {
      if (!r.alive || !r.actor?.position || e.time.elapsed < r.__nextAt) continue;
      r.__nextAt = e.time.elapsed + 1;
      /** `wants` is `stuckcheck`'s own test, so the two numbers mean one thing. */
      r.__samples.push([
        +r.actor.position.x.toFixed(2),
        +r.actor.position.z.toFixed(2),
        (r.actor.desiredSpeed ?? r.actor.speed ?? 1) > 0.1 ? 1 : 0,
      ]);
    }
    /** RESPAWN WATCH: any reinforcement whose `alive` goes false -> true. */
    for (const r of recs) {
      const a = !!r.alive;
      const prev = r.__aliveLog.length ? r.__aliveLog[r.__aliveLog.length - 1] : true;
      if (a !== prev) {
        r.__aliveLog.push(a);
        if (a === true) r.__respawned++;
      }
      if (!r.__aliveLog.length) r.__aliveLog.push(a);
    }
    /** and the other way in: is one of them ever sitting in the queue? */
    for (const q of m._respawnQueue) if (q.rec?.reinforcement) m.__queuedRein = (m.__queuedRein ?? 0) + 1;
    if (m.phase !== 'live' || m.roundClock <= 0) break;
  }

  const rein = m.roster.filter((r) => r.reinforcement);
  /**
   * `stuckcheck`'s own rule, applied to the ten: five consecutive one-second
   * samples inside a metre is stuck. Reported with how far he got in total from
   * the cell he landed on, because a man who walks 200 m is not a man on an
   * island however he looked in any one window.
   */
  const walk = recs.map((r) => {
    const s = r.__samples;
    let worst = 0, run = 0, total = 0;
    for (let i = 1; i < s.length; i++) {
      const d = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      total += d;
      if (s[i][2] && d < 0.15) { run++; if (run > worst) worst = run; } else run = 0;
    }
    return { name: r.name, n: s.length, worst, total: +total.toFixed(1) };
  });
  return {
    insertion: +m.reinforce.insertionSeconds.toFixed(2),
    walk,
    /**
     * A man who is killed thirty seconds in has six samples and no chance to
     * walk anywhere; counting him as stuck would report the firefight rather
     * than the nav grid. Only men with `stuckcheck`'s own sample budget count.
     */
    stuck: walk.filter((w) => w.n >= 20 && w.worst >= 5).length,
    walkers: walk.filter((w) => w.n >= 20).length,
    seed: e.levelSeed,
    end: t(),
    phase: m.phase,
    score: m.score.slice(),
    winner: m.score[0] === m.score[1] ? -1 : m.score[0] > m.score[1] ? 0 : 1,
    stats: JSON.parse(JSON.stringify(m.reinforceStats)),
    drops,
    rosterTotal: m.roster.length,
    rein: rein.length,
    reinAlive: rein.filter((r) => r.alive).length,
    reinDeaths: rein.reduce((a, r) => a + r.deaths, 0),
    reinKills: rein.reduce((a, r) => a + r.kills, 0),
    allNoRespawn: rein.length ? rein.every((r) => r.noRespawn === true) : null,
    respawnedAny: recs.reduce((a, r) => a + (r.__respawned ?? 0), 0),
    queuedRein: m.__queuedRein ?? 0,
    perTeamRoster: [m._rosterSize?.(0) ?? -1, m._rosterSize?.(1) ?? -1],
  };
});

const T = ['RED', 'BLUE'];
console.log(`\n=== seed ${res.seed} · ${res.end}s · phase "${res.phase}" · score ${res.score[0]}-${res.score[1]} · winner ${res.winner < 0 ? 'DRAW' : T[res.winner]}`);
console.log(
  `  calls ${res.stats.calls} · qualifying polls R/B ${res.stats.windows[0]}/${res.stats.windows[1]} · ` +
    `stats.landed R/B ${res.stats.landed[0]}/${res.stats.landed[1]} · stats.lost R/B ${res.stats.lost[0]}/${res.stats.lost[1]}`
);
/**
 * THE GUARD. `lifeSaid` is what the estimate claimed at the call and
 * `lifeReal` is what the match actually had — the pair is the estimator's
 * error at the only instant where it is allowed to matter.
 */
console.log(
  `  GUARD: insertion ${res.insertion}s · refused ${res.stats.late} sortie(s)` +
    (res.stats.lateAt.length
      ? `: ${res.stats.lateAt
          .map((l) => `${T[l.team]} t=${l.t}s ${l.score[0]}-${l.score[1]} said ${l.life}s < ${l.need}s (really had ${(res.end - l.t).toFixed(1)}s)`)
          .join(' | ')}`
      : '')
);
for (const d of res.drops) {
  console.log(
    `  DROP ${T[d.team]} t=${d.t}s score ${d.score[0]}-${d.score[1]} · life said ${d.lifeSaid}s, really ${(res.end - d.t).toFixed(1)}s · ${d.label} owner=${
      d.zoneOwner === 'BASE' ? 'BASE' : d.zoneOwner === d.team ? `${T[d.team]} (OWN)` : `!!${d.zoneOwner}`
    }`
  );
  console.log(
    `    asked ${d.landingsAsked} landing pts · released ${d.released.length} · touchdowns ${d.touchdowns.length} · created ${d.touchdowns.filter((x) => x.created).length}` +
      ` · maxCanopiesAloft ${d.maxCanopies} · heliFrames ${d.heliSeen} · releaseY ${d.releaseY.join(',')}`
  );
  console.log(
    `    alive ${d.aliveAfterT ? `at t=${d.aliveAfterT}s` : '(n/a)'}: ${d.aliveAfter} · inAi ${d.inAiAfter} · noRespawn all=${d.touchdowns.every((x) => x.noRespawn === true)}`
  );
  if (d.landDistToCentre)
    console.log(
      `    dist to zone centre: ${d.landDistToCentre.join(', ')} m (max ${Math.max(...d.landDistToCentre)}) · err vs asked pt: max ${Math.max(...d.landErrToAsked)} m · closest pair ${d.pairMin} m`
    );
  console.log(`    touchdown t: ${d.touchdowns.map((x) => x.t).join(', ')}`);
}
console.log(
  `  roster ${res.rosterTotal} (per team ${JSON.stringify(res.perTeamRoster)}) · reinforcements ${res.rein}` +
    ` · alive at end ${res.reinAlive} · deaths ${res.reinDeaths} · kills ${res.reinKills}`
);
if (res.walk?.length)
  console.log(
    `  AFTER LANDING: ${res.stuck}/${res.walkers} stuck by stuckcheck's rule (>=5 samples wanting to move, <0.15 m each) · ` +
      `metres walked ${res.walk.map((w) => `${w.total}${w.n < 20 ? '*' : ''}`).join(', ')}  (* killed early)`
  );
console.log(
  `  NO-RESPAWN: allNoRespawn=${res.allNoRespawn} · alive false->true transitions ${res.respawnedAny} · frames with a reinforcement in the respawn queue ${res.queuedRein}`
);
console.log(errs.length ? `  [pageerror] ${errs.slice(0, 3).join(' | ')}` : '  [pageerror] none');
await b.close();
