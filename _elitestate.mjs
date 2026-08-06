/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 「精鋭は動いてないのなんで？？固まってしゃがんでるだけなのやめろ」
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT STATE ARE THE TEN ACTUALLY IN, and how far do they move?
 *
 * The drop normally fires at t=463-505 s of a ~525 s match, so nobody has ever
 * watched these men for more than seventy seconds. This calls the REAL
 * `_callReinforcement` early — the same zone pick, the same landing points, the
 * same aircraft — and then watches for minutes.
 *
 * Reported, per elite and against a control sample of the ordinary men on the
 * same side at the same instant:
 *
 *   STATE / CROUCH   the state census and the crouch share. 固まってしゃがんでる
 *                    is a claim about two fields and both are read directly.
 *   THE ORDER        does he HAVE an objective, what verb, aimed at a zone his
 *                    own side already owns or at one it does not.
 *   MOVEMENT         metres travelled per man-minute, share of samples with
 *                    desiredSpeed > 0.1, and the mean distance to his own
 *                    fireteam centroid (the cohesion that may be the clumping).
 *   ARMOUR           how often a live hull is inside ELITE_TANK_R of him, which
 *                    is the condition `_tankDodge` turns into a detour.
 *
 *   node _elitestate.mjs --url=http://127.0.0.1:4512/ --seed=7 [--watch=150]
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4512/';
const SEED = args.seed ?? '7';
const WATCH = +(args.watch ?? 150);      // game seconds to watch after the drop

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { if (/REINFORCE|reinforcement/i.test(m.text())) errs.push('LOG ' + m.text().slice(0, 160)); });
await p.goto(`${URL}?seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const wait = (n) => p.evaluate((k) => new Promise((r) => {
  let i = 0; const t = () => (++i >= k ? r() : requestAnimationFrame(t)); requestAnimationFrame(t);
}), n);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 4; });
await p.waitForFunction(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return m && String(m.phase).toLowerCase() === 'live'
    && window.__ENGINE__.ctx.peek('ai').agents.length > 0;
}, null, { timeout: 180000 }).catch(() => {});
await wait(240); // let the match settle into a real shape first

// ---- fire the real drop, early -------------------------------------------
const called = await p.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const m = ctx.peek('match');
  const t = ctx.time.elapsed;
  // the trailing side, exactly as the cathedral trigger picks it
  const team = m.score[0] <= m.score[1] ? 0 : 1;
  const ok = m._callReinforcement(team, t);
  return { ok, team, score: m.score.slice() };
});
// the aircraft has a telegraph and a run before the boots are down
await p.waitForFunction(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  let n = 0; for (const a of ai.agents) if (a.elite === true) n++;
  return n >= 8;
}, null, { timeout: 120000 }).catch(() => {});
await wait(30);

await p.evaluate(() => {
  const ctx = window.__ENGINE__.ctx;
  const ai = ctx.peek('ai');
  const m = ctx.peek('match');
  const S = {
    t0: ctx.time.elapsed, lastT: ctx.time.elapsed,
    e: { n: 0, state: {}, crouch: 0, moving: 0, obj: {}, ordFoe: 0, ordMine: 0,
      ordNone: 0, dist: 0, cent: 0, centN: 0, hull: 0, inCircle: 0, sec: 0,
      post: 0, working: 0, hasTarget: 0, wantFire: 0, blocked: 0, divert: 0 },
    c: { n: 0, state: {}, crouch: 0, moving: 0, obj: {}, ordFoe: 0, ordMine: 0,
      ordNone: 0, dist: 0, cent: 0, centN: 0, hull: 0, inCircle: 0, sec: 0,
      post: 0, working: 0, hasTarget: 0, wantFire: 0, blocked: 0, divert: 0 },
    last: new Map(), team: -1, eliteNames: [],
  };
  window.__E__ = S;
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  for (const a of ai.agents) if (a.elite === true) { S.team = a.team; S.eliteNames.push(a.name); }
  const inside = (z, q) => {
    const dx = q.x - z.position.x, dz = q.z - z.position.z;
    return dx * dx + dz * dz <= z.radius * z.radius && Math.abs(q.y - z.position.y) < 3;
  };
  window.__T__ = () => {
    const now = ctx.time.elapsed;
    const dt = Math.max(0, now - S.lastT);
    S.lastT = now;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      const isE = a.elite === true;
      if (!isE && a.team !== S.team) continue; // control = ordinary men, SAME side
      const B = isE ? S.e : S.c;
      B.n++;
      B.sec += dt;
      bump(B.state, a.state);
      if (a.crouch) B.crouch++;
      if (a.desiredSpeed > 0.1) B.moving++;
      if (a.post) B.post++;
      if (a.working) B.working++;
      if (a.hasTarget) B.hasTarget++;
      if (a.wantFire) B.wantFire++;
      if (a.objectiveBlocked) B.blocked++;
      if (a.divert) B.divert++;
      bump(B.obj, a.objective ? a.objective.mode : 'NONE');
      const os = a.objective?.site;
      if (!os || typeof os.owner !== 'number') B.ordNone++;
      else if (os.owner === a.team) B.ordMine++;
      else B.ordFoe++;
      for (const z of m.sites) if (inside(z, a.position)) { B.inCircle++; break; }
      const ft = a.fireteam;
      if (ft && ft.centre && ft.members.length > 1) {
        B.cent += a.position.distanceTo(ft.centre); B.centN++;
      }
      const veh = ai.vehicles;
      if (veh) {
        for (const v of veh) {
          if (!v || v.alive !== true) continue;
          if (a.position.distanceTo(v.position) < 34) { B.hull++; break; }
        }
      }
      const prev = S.last.get(a.name);
      if (prev) B.dist += Math.hypot(a.position.x - prev.x, a.position.z - prev.z);
      S.last.set(a.name, { x: a.position.x, z: a.position.z });
    }
  };
});

const t0 = await p.evaluate(() => window.__ENGINE__.ctx.time.elapsed);
for (let i = 0; i < 2000; i++) {
  await wait(5);
  await p.evaluate(() => window.__T__());
  const el = await p.evaluate((s) => window.__ENGINE__.ctx.time.elapsed - s, t0);
  if (el > WATCH) break;
}

const out = await p.evaluate(() => {
  const S = window.__E__;
  const ai = window.__ENGINE__.ctx.peek('ai');
  let aliveE = 0; for (const a of ai.agents) if (a.elite === true && a.alive) aliveE++;
  const pct = (h, tot) => Object.fromEntries(Object.entries(h)
    .sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +((v / (tot || 1)) * 100).toFixed(1)]));
  const roll = (B, label) => ({
    label,
    manSamples: B.n,
    manMinutes: +(B.sec / 60).toFixed(2),
    metresPerManMinute: +(B.dist / Math.max(1e-6, B.sec / 60)).toFixed(1),
    movingPct: +((B.moving / (B.n || 1)) * 100).toFixed(1),
    crouchPct: +((B.crouch / (B.n || 1)) * 100).toFixed(1),
    statePct: pct(B.state, B.n),
    objectivePct: pct(B.obj, B.n),
    orderedAtEnemyZonePct: +((B.ordFoe / (B.n || 1)) * 100).toFixed(1),
    orderedAtOwnZonePct: +((B.ordMine / (B.n || 1)) * 100).toFixed(1),
    orderedAtNoZonePct: +((B.ordNone / (B.n || 1)) * 100).toFixed(1),
    insideAnyCirclePct: +((B.inCircle / (B.n || 1)) * 100).toFixed(1),
    meanDistToFireteamCentre_m: +(B.cent / Math.max(1, B.centN)).toFixed(2),
    hullWithin34mPct: +((B.hull / (B.n || 1)) * 100).toFixed(1),
    objectiveBlockedPct: +((B.blocked / (B.n || 1)) * 100).toFixed(1),
    divertedPct: +((B.divert / (B.n || 1)) * 100).toFixed(1),
    postPct: +((B.post / (B.n || 1)) * 100).toFixed(1),
    hasTargetPct: +((B.hasTarget / (B.n || 1)) * 100).toFixed(1),
    wantFirePct: +((B.wantFire / (B.n || 1)) * 100).toFixed(1),
  });
  return { team: S.team, eliteAliveAtEnd: aliveE, elites: roll(S.e, 'ELITE'),
    control: roll(S.c, 'ORDINARY, same side') };
});
console.log(JSON.stringify({ seed: SEED, called, notes: errs.slice(0, 4), ...out }, null, 1));
await b.close();
