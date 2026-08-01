/**
 * DOES AN AIRSTRIKE KILL A TANK? — 「戦車は空爆で破壊される仕様にして」
 *
 *   node _tankair.mjs [--url=…] [--seed=N] [--shots=DIR]
 *
 * Three answers, in increasing order of how much they are worth:
 *
 *   1. THE CURVE. The exact `explosion` payload `Airstrike._spectacle` emits —
 *      `RULES.airstrikeRadius` / `RULES.airstrikeDamage` / `source:'airstrike'` —
 *      delivered at 0, ¼, ½, ¾ and 1 blast radii from a full-health hull, one
 *      fresh hull per sample. This is the rule, measured: what does a bomb take
 *      off, and where does it stop killing?
 *   2. THE REAL EVENT. The strike site whose own blast lands nearest a tank
 *      ROUTE is found, the hull is driven to the point on its route closest to
 *      it, and that site is FIRED — the whole telegraph, the mass, the blast.
 *      No payload is synthesised and nothing is called directly.
 *   3. FRIENDLY FIRE. 「空爆は敵味方関係なくダメージを喰らう仕様にして」 — the same
 *      strike is run against a hull of each team and both have to die.
 *
 * …and a photograph of the hull, alive in the street and then burning, because
 * "the tank exists" is not something a player who has never seen one will take
 * on a counter.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const BASE = args.url ?? 'http://127.0.0.1:4275/';
const SHOTS = args.shots ?? './shots/tankair';
const URL = args.seed ? `${BASE}${BASE.includes('?') ? '&' : '?'}seed=${args.seed}` : BASE;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
const logs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => {
  const t = m.text();
  if (/\[tank\]|\[airstrike\] (SALVO|STRIKE)|destroyed/.test(t)) logs.push(t);
  if (m.type() === 'error') errs.push('console: ' + t.slice(0, 200));
});
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const sleep = (ms) => page.waitForTimeout(ms);

const levelSeed = await page.evaluate(() => window.__ENGINE__?.levelSeed ?? null);

/** Take the match off its own clock so nothing ends underneath the probe. */
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  e.input.frozen = true;
  e.input.enabled = false;
});

/* ========================================================================== */
/* 1. THE CURVE                                                               */
/* ========================================================================== */
const curve = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const R = window.__RULES__ ?? null;
  const armour = m.tank;
  const rows = [];
  // The payload `Airstrike._spectacle` emits, to the metre and to the point.
  const radius = m.airstrike?.sites?.[0]?.radius ?? 15;
  const damage = m.airstrike?.sites?.[0]?.damage ?? 260;
  for (const f of [0, 0.25, 0.5, 0.75, 1.0]) {
    armour.reset();
    armour.fire();
    const t = armour.tanks[0];
    const h0 = t.health;
    const at = t.position.clone();
    at.y += 1.4;
    at.x += radius * f;
    e.ctx.events.emit('explosion', { position: at, radius, damage, source: 'airstrike' });
    rows.push({
      d: +(radius * f).toFixed(2),
      took: +(h0 - Math.max(0, t.health)).toFixed(0),
      of: h0,
      dead: !t.alive,
    });
  }
  armour.reset();
  return { radius, damage, rows, health: R?.tankHealth ?? null };
});

/* ========================================================================== */
/* 2. THE REAL EVENT — which site is nearest which route, and fire it         */
/* ========================================================================== */
const reach = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const R = window.__RULES__ ?? {};
  /**
   * EVERY PIECE OF AIR ORDNANCE ON THIS MAP, against every sample of every tank
   * route. All three systems are authored against fixed geography and baked at
   * boot, so this is a closed question rather than a sampling one: either some
   * bomb's blast circle covers some point a tank can be standing on, or the
   * rule can never fire in a real round however lethal it is.
   */
  const points = [];
  for (const s of m.airstrike.sites) {
    if (s.demo) continue; // a whole building coming down, not a bomb in a street
    points.push({ kind: 'airstrike', id: s.id, index: s.index, p: s.position, r: s.radius });
  }
  for (const r of m.bomber?.runs ?? []) {
    for (let i = 0; i < r.bombs.length; i++) {
      points.push({ kind: 'bomber', id: `${r.id}#${i}`, index: -1, p: r.bombs[i].impact, r: R.bomberRadius ?? r.radius ?? 9 });
    }
  }
  for (const r of m.strafe?.runs ?? []) {
    for (let i = 0; i < r.impacts.length; i++) {
      if (!r.impacts[i].damage) continue;
      points.push({ kind: 'strafe', id: `${r.id}#${i}`, index: -1, p: r.impacts[i].at, r: R.strafeRadius ?? 5.5 });
    }
  }

  const best = {};
  let overall = null;
  for (const tank of m.tank.tanks) {
    const path = tank.path;
    for (const q of points) {
      for (let i = 0; i < path.n; i++) {
        const d = Math.hypot(path.X[i] - q.p.x, path.Z[i] - q.p.z);
        const row = { tank: tank.id, team: tank.team, kind: q.kind, id: q.id, index: q.index, d, r: q.r, s: path.S[i] };
        const k = `${tank.id}:${q.kind}`;
        if (!best[k] || d < best[k].d) best[k] = row;
        /**
         * The one to actually fire: something whose blast circle really covers a
         * point a tank can stand on, and A BOMB FOR PREFERENCE. `strafe` is in
         * this table because the sweep has to be complete, but it is a cannon
         * and stays on the ordinary blast multiplier — picking it would measure
         * the rule that was NOT asked for. @see `AIR_ORDNANCE` in tank.js.
         */
        const rank = { airstrike: 0, bomber: 1, strafe: 2 };
        if (d <= q.r && (!overall || rank[q.kind] < rank[overall.kind] ||
            (rank[q.kind] === rank[overall.kind] && d < overall.d))) overall = row;
      }
    }
  }
  for (const k in best) best[k].d = +best[k].d.toFixed(2);
  if (overall) overall.d = +overall.d.toFixed(2);
  return { best: Object.values(best), overall, points: points.length };
});
/** What to actually fire. Prefer something that genuinely reaches; else the
 *  nearest authored strike site, so the report says how far short it falls. */
const pick =
  reach.overall ??
  reach.best.filter((b) => b.kind === 'airstrike').sort((a, b) => a.d - b.d)[0];

/**
 * Park BOTH hulls at the point on their own route closest to that site, so the
 * friendly-fire half of the rule is measured on the same bomb rather than
 * asserted. One is the strike's own side, the other is not.
 */
const parked = await page.evaluate((pick) => {
  const m = window.__ENGINE__.ctx.peek('match');
  const a = m.tank;
  a.reset();
  a.fire();
  /** Where the ordnance this run is going to fire actually lands. */
  const at = (() => {
    if (pick.kind === 'airstrike') return m.airstrike.sites[pick.index]?.position ?? null;
    const [runId, i] = String(pick.id).split('#');
    if (pick.kind === 'bomber') return m.bomber.runs.find((r) => r.id === runId)?.bombs[+i]?.impact ?? null;
    return m.strafe.runs.find((r) => r.id === runId)?.impacts[+i]?.at ?? null;
  })();
  const out = [];
  for (const t of a.tanks) {
    const p = t.path;
    let bi = 0;
    let bd = Infinity;
    if (at) {
      for (let i = 0; i < p.n; i++) {
        const d = Math.hypot(p.X[i] - at.x, p.Z[i] - at.z);
        if (d < bd) { bd = d; bi = i; }
      }
    }
    t.s = p.S[bi];
    t.state = 'hold';
    t.hold = 1e6;
    a._pose(t);
    out.push({ id: t.id, team: t.team, toBlast: +bd.toFixed(2), health: t.health, alive: t.alive });
  }
  return { where: at ? [+at.x.toFixed(1), +at.z.toFixed(1)] : null, rows: out };
}, pick);

/* ---- photograph it alive, from a bystander's eye ------------------------- */
/**
 * A BYSTANDER'S EYE, AND THE LINE OF SIGHT IS PROVED RATHER THAN HOPED.
 *
 * The first version of this put the camera on one authored bearing and the
 * photograph came back as a wall with a wheelbarrow in front of it — which is
 * the same "I looked and it seemed fine" failure mode this whole session is
 * about. So the bearings are a search: stand where a man could stand, fire the
 * real `MASK.SIGHT` ray at the hull, and take the first standing that can
 * actually see it.
 */
async function look(tankId, dist, look = 1.8) {
  const r = await page.evaluate(
    ({ tankId, dist, look }) => {
      const e = window.__ENGINE__;
      const ph = e.ctx.peek('physics');
      const player = e.ctx.peek('player');
      const m = e.ctx.peek('match');
      const t = m.tank.tanks.find((x) => x.id === tankId) ?? m.tank.tanks[0];
      const at = m.sites[0].position.clone();
      /**
       * NINE POINTS ON THE HULL, not one. A single ray at turret height is
       * "clear" from behind a chest-high wall that hides everything the player
       * would recognise, which is how the first photograph came back as a street
       * with a dark smudge in it. The bearing that shows the most of the vehicle
       * wins, and the score is printed so the picture can be argued with.
       */
      const marks = [];
      const c = Math.cos(t._yaw);
      const s2 = Math.sin(t._yaw);
      for (const along of [-2.6, 0, 2.6]) {
        // THE RUNNING GEAR IS WORTH TWO OF THE TURRET. A bearing that shows the
        // turret over a barrier scores the same as one that shows the whole
        // vehicle unless the low marks count for more, and the turret alone is
        // what the unusable first photographs all had in them.
        for (const [up, w] of [[0.4, 2], [1.3, 1], [2.2, 1]]) {
          marks.push([t.position.x + s2 * along, t.position.y + up, t.position.z + c * along, w]);
        }
      }
      const total = marks.reduce((n, mk) => n + mk[3], 0);
      let best = null;
      for (const d of [dist, dist * 0.7, dist * 1.4, dist * 0.5, dist * 1.9]) {
        for (let k = 0; k < 24; k++) {
          const a = t._yaw + (k / 24) * Math.PI * 2;
          const x = t.position.x + Math.sin(a) * d;
          const z = t.position.z + Math.cos(a) * d;
          const g = ph.groundHeight(x, z, 60);
          if (!Number.isFinite(g)) continue;
          // STAND IN THE STREET THE TANK IS IN. A downward ray eight metres to
          // one side of a hull in a narrow lane lands on a ROOF, and the
          // photograph then looks down on the town from three storeys up with
          // the tank's aerial in the corner of it.
          if (Math.abs(g - t.position.y) > 2.5) continue;
          const eye = g + 1.62;
          let seen = 0;
          for (const [mx, my, mz, w] of marks) {
            const dx = mx - x;
            const dy = my - eye;
            const dz = mz - z;
            const len = Math.hypot(dx, dy, dz);
            if (len < 3) continue;
            if (!ph.raycastAny(x, eye, z, dx / len, dy / len, dz / len, len - 0.5, ph.MASK.SIGHT)) seen += w;
          }
          if (!best || seen > best.seen) best = { x, z, g, eye, seen, k, d };
          if (seen === total) break;
        }
        if (best?.seen === total) break;
      }
      if (!best) return { clear: false };
      const dx = t.position.x - best.x;
      const dy = t.position.y + look - best.eye;
      const dz = t.position.z - best.z;
      at.set(best.x, best.g + 0.05, best.z);
      player.respawnAt(at, Math.atan2(-dx, -dz));
      player.movement.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      return {
        bearing: +((best.k / 24) * 360).toFixed(0),
        dist: +best.d.toFixed(1),
        visible: `${best.seen}/${total}`,
      };
    },
    { tankId, dist, look }
  );
  await sleep(500);
  return r;
}

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.ctx.peek('ui').setHudVisible(false);
  e.ctx.viewScene.visible = false;
});
/**
 * THE PORTRAIT IS NOT TAKEN AT THE BOMB.
 *
 * The point on the route nearest a bomb is wherever the bomb happens to be, and
 * at ?seed=7 that is a slot between a block wall and a building — a photograph
 * of the hull from there is a photograph of masonry with a road wheel in it,
 * and the end of the route is worse (it is up against the cathedral's own end
 * wall). A third of the way along is the open street `_tankshot.mjs` already
 * halts at for the same reason. It is put back on the bomb afterwards.
 */
const stood = await page.evaluate((tankId) => {
  const m = window.__ENGINE__.ctx.peek('match');
  const a = m.tank;
  const t = a.tanks.find((x) => x.id === tankId) ?? a.tanks[0];
  const keep = t.s;
  t.s = t.path.length * 0.32;
  a._pose(t);
  return { keep, at: [+t.position.x.toFixed(1), +t.position.z.toFixed(1)] };
}, pick.tank);
const eye1 = await look(pick.tank, 12);
await page.screenshot({ path: `${SHOTS}/20-alive.png` });
await page.evaluate(
  ({ tankId, keep }) => {
    const a = window.__ENGINE__.ctx.peek('match').tank;
    const t = a.tanks.find((x) => x.id === tankId) ?? a.tanks[0];
    t.s = keep;
    a._pose(t);
  },
  { tankId: pick.tank, keep: stood.keep }
);

/* ---- and fire the site for real ----------------------------------------- */
await page.evaluate((pick) => {
  const m = window.__ENGINE__.ctx.peek('match');
  const [runId] = String(pick.id).split('#');
  for (const a of m.air) a.enabled = true;
  // The real telegraph, the real ordnance, the real blast. Nothing synthesised.
  if (pick.kind === 'airstrike') m.airstrike.call(pick.index);
  else if (pick.kind === 'bomber') m.bomber.fire(runId);
  else m.strafe.fire(runId);
}, pick);
// Whichever it is, the telegraph is the longest part: 4.4 s of jet for a
// strike, 2.4 s of aeroplane plus 1.7 s of fall for a bomber run.
await sleep(9000);
await page.screenshot({ path: `${SHOTS}/21-struck.png` });
await sleep(2500);
const eye2 = await look(pick.tank, 13, 1.2);
await page.screenshot({ path: `${SHOTS}/22-wreck.png` });

const after = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return m.tank.tanks.map((t) => ({
    id: t.id, team: t.team, alive: t.alive, state: t.state,
    health: Math.round(Math.max(0, t.health)),
    wreck: !!t.wreck?.visible,
  }));
});

await browser.close();

/* -------------------------------------------------------------------------- */
console.log(`\nTANKAIR  ${URL}  levelSeed=${levelSeed}`);
console.log(`\n1. THE CURVE — one bomb, radius ${curve.radius} m, damage ${curve.damage}, on ${curve.health} of health`);
console.log('   distance   damage taken   destroyed');
for (const r of curve.rows) {
  console.log(`   ${String(r.d).padStart(6)} m   ${String(r.took).padStart(12)}   ${r.dead ? 'YES' : 'no'}`);
}
console.log(`\n2. WHAT CAN ACTUALLY REACH A TANK — ${reach.points} baked impact points, against every route sample`);
console.log('   tank   weapon      nearest impact   distance   its blast radius   in range?');
for (const b of reach.best.sort((a, c) => (a.tank + a.kind).localeCompare(c.tank + c.kind))) {
  console.log(
    `   ${b.tank.padEnd(6)} ${b.kind.padEnd(11)} ${String(b.id).padEnd(16)} ${String(b.d).padStart(8)} m` +
      `   ${String(b.r).padStart(16)} m   ${b.d <= b.r ? 'YES' : 'no'}`
  );
}
console.log(
  reach.overall
    ? `   -> ${reach.overall.kind} ${reach.overall.id} reaches ${reach.overall.tank} at ${reach.overall.d} m`
    : '   -> NOTHING REACHES. No baked bomb on this map lands inside its own blast radius of any tank route.'
);
console.log(`\n   THE REAL EVENT — firing ${pick.kind} ${pick.id}, blast radius ${pick.r} m`);
console.log(`   the ordnance lands at ${JSON.stringify(parked.where)}; both hulls parked at their own route's closest point:`);
for (const r of parked.rows) console.log(`     ${r.id} team${r.team}  ${r.toBlast} m from the blast, ${r.health} health`);
console.log('   after the strike:');
for (const r of after) console.log(`     ${r.id} team${r.team}  alive=${r.alive} state=${r.state} health=${r.health} wreck=${r.wreck}`);
console.log(`\n   shots in ${SHOTS}/ — alive from ${JSON.stringify(eye1)}, wreck from ${JSON.stringify(eye2)}`);
console.log('\n   console:');
for (const l of logs) console.log('     ' + l);
console.log(errs.length ? `   PAGE ERRORS: ${errs.slice(0, 5).join(' | ')}` : '   pageerrors: none');
