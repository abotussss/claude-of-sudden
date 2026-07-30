/**
 * SITE GATE — is a bomb site something you can DEFEND, or is it a circle drawn
 * on open ground?
 *
 *   node tools/sitecheck.mjs [--url=http://127.0.0.1:4173/] [--json=path]
 *
 * WHY IT EXISTS. `navcheck` says every spawn can reach every site. `lanecheck`
 * says the two routes there are different routes. A previous pass moved the
 * plant zone onto the defence's half of each courtyard and reported the
 * consequences of that with both tools: defence arrives ~19 m ahead, route
 * overlap 14.5 %, attack round-win rate 36 %. The player's verdict on the
 * result was "爆破サイトが剥き出しで、攻撃側有利すぎる" — the sites are BARE.
 *
 * Both sets of numbers can be true at once, because ARRIVAL TIME AND ROUTE
 * SEPARATION SAY NOTHING ABOUT WHETHER THERE IS ANYTHING TO FIGHT FROM. Getting
 * to an empty circle first is not an advantage; it is five men standing in the
 * open with nine seconds to think about it. Nothing in this repo measured the
 * inside of the site, so nothing in this repo could have caught that.
 *
 * So this measures the inside of the site, from real geometry and real
 * raycasts, and it reports five things per site:
 *
 *   1. OVERWATCH. Every place a PLAYER can stand more than 1.2 m above the
 *      plant zone within 26 m of it is found by dropping rays and fitting the
 *      real player capsule, and then asked what fraction of the plant zone it
 *      can actually see. A site whose authored balcony looks at the wrong half
 *      of the courtyard scores zero here and looks fine in every other tool.
 *   2. COVER ON THE ZONE. Occluding geometry standing 0.9-2.8 m above the plant
 *      zone's floor, as swept area, plus the engine's own cover points
 *      (`ai.cover.points`, which is what a bot will actually use) inside the
 *      zone and in the 8 m ring around it, split into standing and crouch.
 *   3. THE MOUTHS. Each courtyard's entries are FOUND, not authored here: the
 *      courtyard rect comes out of `ALLEYS`, its boundary is walked at 0.4 m,
 *      and a run of cells that is walkable on both sides of the line is a
 *      mouth. Width in metres, and the fraction of the mouth a defender can
 *      see — from the ground hold, and from the overwatch.
 *   4. ARRIVAL. The same A* `navcheck` uses, in metres and in seconds.
 *   5. RETAKE. Cover points on the defence's own side of the zone between 4 and
 *      14 m out — what a post-plant retake has to walk up behind.
 *
 * The thresholds at the bottom are the "not bare" line. They are deliberately
 * low: they are a floor, not a target.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4173/';
/** Player stand speed, from src/player/tuning.js. */
const WALK = 4.57;

/** The floor a site has to clear to count as defensible rather than bare. */
const MIN = {
  /** at least one player-reachable perch seeing this much of the plant zone */
  overwatchBest: 0.3,
  /** perches clearing 15 % — one lucky angle is not overwatch */
  overwatchCount: 2,
  /** standing cover points inside the plant zone */
  highCoverIn: 6,
  /** m² of 0.9-2.8 m mass standing inside the plant zone */
  coverAreaIn: 12,
  /** every attacker mouth must be at least this watched from the ground */
  mouthGroundSeen: 0.35,
  /**
   * The defence must have overwatch OF ITS OWN — a perch it provably reaches
   * before the attack does — that sees this much of the zone. Without this line
   * the check passes on a site whose only elevation is the attack's own roof.
   */
  defenceFirstPerch: 0.4,
  /**
   * And the defence's ground read of the zone must not be WORSE than the
   * attack's. Cover that hides the charge from both sides equally helps whoever
   * brings more bodies, which is the attack.
   */
  groundEdge: 0.0,
};

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

console.log(`[sitecheck] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const result = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const phys = e.ctx.peek('physics');
  const world = e.ctx.peek('world');
  const m = e.ctx.peek('match');
  const V3 = m.sites[0].position.constructor;
  const { RELIEF, ALLEYS } = world.layout;
  const SIGHT = phys.MASK.SIGHT;
  const WORLD = phys.MASK.WORLD;
  const CHAR = phys.MASK.CHARACTER;

  /** Player capsule, from src/player/tuning.js STANCE.stand. */
  const R = 0.32;
  const EYE = 1.62;
  const STEP = 0.42;
  const HEAD = 1.78;

  const L2W = (lx, lz, ly = 0) => world.levelToWorld(lx, ly, lz, new V3());
  const W2L = (p) => world.worldToLevel(p.x, p.y, p.z, new V3());

  /** Top solid surface under (wx, wz), searching down from `top`. */
  const topAt = (wx, wz, top) => {
    const h = phys.raycast(wx, top, wz, 0, -1, 0, top + 8, WORLD);
    return h.hit ? h.point.y : -Infinity;
  };

  /** Does the standing player capsule fit with its feet on `y` at (wx, wz)? */
  const _a = new V3();
  const _b = new V3();
  const fits = (wx, y, wz) => {
    _a.set(wx, y + STEP, wz);
    _b.set(wx, y + HEAD - R, wz);
    return phys.checkCapsule(_a, _b, R - 0.01, CHAR);
  };

  /** Nav-grid floor near (wx, wz) within `yTol` of `y`, or null. */
  const g = ai.grid;
  const navFloor = (wx, wz, y, rings = 2, yTol = 1.2) => {
    const ci = g.nearest(wx, wz, y, rings, yTol);
    return ci < 0 ? null : g.floor[ci];
  };

  const path = [];
  const routeLen = (from, to) => {
    const n = g.findPath(from, to, path);
    if (n <= 0) return -1;
    let d = from.distanceTo(path[0]);
    for (let i = 1; i < n; i++) d += path[i - 1].distanceTo(path[i]);
    return d;
  };

  const out = { sites: [], warnings: [] };

  for (const site of m.sites) {
    const C = site.position; // world space, on the ground
    const rad = site.radius;
    const lc = W2L(C);

    /* ------------------------------------------------- 0. the plant zone --
     * The zone is every cell inside `radius` that a charge could actually be
     * put on: walkable ground at roughly the site's height. `_siteAt` in
     * src/match/index.js accepts |dy| < 3, so the height window matches.
     */
    const zone = []; // world points at charge height
    const CELL = 1.0;
    for (let dz = -rad; dz <= rad + 1e-6; dz += CELL) {
      for (let dx = -rad; dx <= rad + 1e-6; dx += CELL) {
        if (dx * dx + dz * dz > rad * rad) continue;
        const w = L2W(lc.x + dx, lc.z + dz);
        const y = navFloor(w.x, w.z, C.y, 1, 1.5);
        if (y === null) continue;
        zone.push(new V3(w.x, y + 0.35, w.z));
      }
    }
    /** A coarse subset, for the thousands of candidate perches. */
    const zoneCoarse = zone.filter((_, i) => i % 3 === 0);

    /**
     * The courtyard rect, straight out of `ALLEYS`: the lane rect that contains
     * the site centre. Everything that needs to know where the site's edges are
     * — the mouth walk, the attacker's viewpoints, the plan view — derives them
     * from this rather than from a second copy of the numbers.
     */
    const rect = (ALLEYS ?? [])
      .map((a) => a.rect)
      .find((r) => lc.x >= r[0] - 0.5 && lc.x <= r[2] + 0.5 && lc.z >= r[1] - 0.5 && lc.z <= r[3] + 0.5);

    const seenFrac = (eye, pts) => {
      if (!pts.length) return 0;
      let n = 0;
      for (const p of pts) if (phys.lineOfSight(eye, p, SIGHT)) n++;
      return n / pts.length;
    };

    /* ---------------------------------------------- 1. ground defenders --
     * The hold point, plus the ring `Agent._pickHoldSpot` actually spreads the
     * defence over: walkable ground 4-11 m from the charge, on the defence's
     * side of it (level -Z, which is where their spawn is).
     */
    const groundEyes = [];
    const holdY = navFloor(site.hold.x, site.hold.z, site.hold.y, 3, 1.5) ?? site.hold.y;
    groundEyes.push({ tag: 'hold', at: [+W2L(site.hold).x.toFixed(1), +W2L(site.hold).z.toFixed(1)], y: 0, eye: new V3(site.hold.x, holdY + EYE, site.hold.z) });
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * Math.PI * 2;
      const r = 5 + (a % 3) * 2.5;
      const lx = lc.x + Math.cos(th) * r;
      const lz = lc.z + Math.sin(th) * r;
      if (lz > lc.z + 1) continue; // the defence's half
      const w = L2W(lx, lz);
      const y = navFloor(w.x, w.z, C.y, 1, 1.5);
      if (y === null || !fits(w.x, y, w.z)) continue;
      groundEyes.push({ tag: `ring${a}`, at: [+lx.toFixed(1), +lz.toFixed(1)], y: 0, eye: new V3(w.x, y + EYE, w.z) });
    }
    for (const ge of groundEyes) ge.seen = seenFrac(ge.eye, zone);

    /* -------------------------------------------------- 2. the overwatch --
     * Every place a PLAYER can stand above the zone within 26 m of it, found
     * by dropping a ray and fitting the real capsule. Nothing is authored
     * here on purpose: an authored balcony that looks at the wrong half of the
     * courtyard has to be able to score zero.
     */
    const perches = [];
    const SPAN = 26;
    const PS = 1.0;
    for (let dz = -SPAN; dz <= SPAN; dz += PS) {
      for (let dx = -SPAN; dx <= SPAN; dx += PS) {
        const lx = lc.x + dx;
        const lz = lc.z + dz;
        const w = L2W(lx, lz);
        const y = topAt(w.x, w.z, C.y + 16);
        if (!Number.isFinite(y)) continue;
        const rise = y - C.y;
        if (rise < 1.2 || rise > 14) continue;
        if (!fits(w.x, y, w.z)) continue;
        const eye = new V3(w.x, y + EYE, w.z);
        const f = seenFrac(eye, zoneCoarse);
        if (f <= 0.02) continue;
        perches.push({ at: [+lx.toFixed(1), +lz.toFixed(1)], rise: +rise.toFixed(1), seen: f, eye });
      }
    }
    perches.sort((a, b) => b.seen - a.seen);
    // Re-measure the leaders against the full-resolution zone.
    for (const p of perches.slice(0, 24)) p.seen = seenFrac(p.eye, zone);
    perches.sort((a, b) => b.seen - a.seen);
    const overwatch = perches.filter((p) => p.seen >= 0.15);

    /**
     * WHOSE PERCH IS IT? A perch both teams can reach, that the attack reaches
     * first, is not a defender's advantage — it is a second attacking lane with
     * a better angle. So price each of the leaders the same way `navcheck`
     * prices the site: A* from the nearest spawn of each side to the ground cell
     * the perch is mantled from. Positive `edge` means the defence gets there
     * first. A* cannot route ONTO a perch (a stacked deck deletes the nav cell
     * under it, by design) so this routes to its foot, which is the cell you
     * have to be standing on to climb.
     */
    const spawnRoute = (kind, to) => {
      let best = Infinity;
      for (const sp of m.spawns[kind]) {
        const d = routeLen(sp.position, to);
        if (d > 0 && d < best) best = d;
      }
      return Number.isFinite(best) ? best : -1;
    };
    for (const p of perches.slice(0, 14)) {
      const w = L2W(p.at[0], p.at[1]);
      const ci = g.nearest(w.x, w.z, C.y, 5, 6);
      if (ci < 0) continue;
      const foot = new V3(g.worldX(ci % g.nx), g.floor[ci], g.worldZ((ci / g.nx) | 0));
      const a = spawnRoute('attack', foot);
      const d = spawnRoute('defend', foot);
      if (a < 0 || d < 0) continue;
      p.attackM = +a.toFixed(1);
      p.defendM = +d.toFixed(1);
      p.edge = +(a - d).toFixed(1);
    }
    const priced = perches.filter((p) => p.edge !== undefined);
    const defFirst = priced.filter((p) => p.edge > 0);
    const atkFirst = priced.filter((p) => p.edge <= 0);

    /** The AUTHORED overwatch, named, so a deck that misses says so. */
    const decks = [];
    for (const d of RELIEF.decks ?? []) {
      const [x0, z0, x1, z1] = d.rect;
      if (Math.hypot((x0 + x1) / 2 - lc.x, (z0 + z1) / 2 - lc.z) > 30) continue;
      let best = 0;
      let bestAt = null;
      const n = 6;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const lx = x0 + (x1 - x0) * (z1 - z0 > x1 - x0 ? 0.5 : t);
        const lz = z0 + (z1 - z0) * (z1 - z0 > x1 - x0 ? t : 0.5);
        const w = L2W(lx, lz);
        const y = topAt(w.x, w.z, C.y + 16);
        if (!Number.isFinite(y)) continue;
        const f = seenFrac(new V3(w.x, y + EYE, w.z), zone);
        if (f > best) {
          best = f;
          bestAt = [+lx.toFixed(1), +lz.toFixed(1), +(y - C.y).toFixed(1)];
        }
      }
      decks.push({ id: d.id, seen: +best.toFixed(3), bestAt });
    }

    /** The eyes a mouth is checked against. */
    const owEyes = overwatch.slice(0, 6).map((p) => p.eye);
    const gEyes = groundEyes.map((p) => p.eye);

    /* ------------------------------------------- 2b. the attacker's view --
     * THE NUMBER THAT SAYS "DEFENDER-FAVOURED", and the one that was missing.
     * How much of the plant zone can the attack see from the ground it has to
     * come in over — its own lane mouth and the two connector-side steps into
     * the courtyard — versus how much the defence can see from its hold ring?
     * Cover that hides the charge from the defence as well as from the attack is
     * cover that helps the side with more bodies; the split is the point.
     */
    const attackEyes = [];
    for (let i = 0; i < 20; i++) {
      // Fan across the courtyard's +Z edge and up the lane behind it, plus the
      // connector's mouth: the attack's two authored ways in.
      const northX = lc.x + (i % 5 - 2) * 2.2;
      const northZ = (rect ? rect[3] : lc.z + 10) + Math.floor(i / 5) * 2.0;
      const connX = (rect ? (lc.x < 0 ? rect[2] : rect[0]) : lc.x) + (lc.x < 0 ? 1 : -1) * (i % 5) * 1.8;
      const connZ = lc.z + 4 + (i % 4) * 1.2;
      for (const [lx, lz] of [
        [northX, northZ],
        [connX, connZ],
      ]) {
        const w = L2W(lx, lz);
        const y = navFloor(w.x, w.z, C.y, 1, 1.5);
        if (y === null || !fits(w.x, y, w.z)) continue;
        attackEyes.push({ at: [+lx.toFixed(1), +lz.toFixed(1)], eye: new V3(w.x, y + EYE, w.z), seen: 0 });
      }
    }
    for (const ae of attackEyes) ae.seen = seenFrac(ae.eye, zone);

    /* ------------------------------------------------------- 3. the cover --
     * Swept area of mass standing 0.9-2.8 m over the zone floor. The upper
     * bound is what separates cover from a building: a courtyard wall or a
     * facade is not something you fight the plant from.
     */
    const coverArea = (r0, r1) => {
      const S = 0.5;
      let hit = 0;
      let tot = 0;
      for (let dz = -r1; dz <= r1 + 1e-6; dz += S) {
        for (let dx = -r1; dx <= r1 + 1e-6; dx += S) {
          const d = Math.hypot(dx, dz);
          if (d < r0 || d > r1) continue;
          const w = L2W(lc.x + dx, lc.z + dz);
          const y = topAt(w.x, w.z, C.y + 6);
          if (!Number.isFinite(y)) continue;
          tot++;
          const rise = y - C.y;
          if (rise >= 0.9 && rise <= 2.8) hit++;
        }
      }
      return { m2: +(hit * 0.25).toFixed(1), frac: tot ? +(hit / tot).toFixed(3) : 0 };
    };
    const coverIn = coverArea(0, rad);
    const coverRing = coverArea(rad, rad + 8);

    /** The engine's own cover points — what a bot will actually stand behind. */
    const pts = ai.cover?.points ?? [];
    const cp = { inHigh: 0, inLow: 0, ringHigh: 0, ringLow: 0, retake: 0 };
    for (const p of pts) {
      if (Math.abs(p.y - C.y) > 3) continue;
      const d = Math.hypot(p.x - C.x, p.z - C.z);
      if (d <= rad) p.high ? cp.inHigh++ : cp.inLow++;
      else if (d <= rad + 8) p.high ? cp.ringHigh++ : cp.ringLow++;
      // retake: the defence's own side, 4-14 m out, standing cover only
      if (d >= 4 && d <= 14 && p.high) {
        const lp = W2L(p);
        if (lp.z < lc.z) cp.retake++;
      }
    }

    /* ------------------------------------------------------ 4. the mouths --
     * The courtyard rect comes out of ALLEYS; the mouths are found by walking
     * its boundary and looking for runs that are walkable on both sides.
     */
    const mouths = [];
    if (rect) {
      const [x0, z0, x1, z1] = rect;
      const inner = lc.x < 0 ? 'xmax' : 'xmin';
      const edges = [
        { key: 'zmax', label: '+Z lane (ATTACK)', a: x0, b: x1, along: 'x', at: z1, nrm: [0, 1] },
        { key: 'zmin', label: '-Z lane (defence)', a: x0, b: x1, along: 'x', at: z0, nrm: [0, -1] },
        { key: 'xmax', label: x1 > 0 ? 'outer wall' : 'connector (mid)', a: z0, b: z1, along: 'z', at: x1, nrm: [1, 0] },
        { key: 'xmin', label: x0 < 0 ? 'outer wall' : 'connector (mid)', a: z0, b: z1, along: 'z', at: x0, nrm: [-1, 0] },
      ];
      for (const ed of edges) {
        if (ed.key !== 'zmax' && ed.key !== 'zmin' && ed.key !== inner) continue;
        const S = 0.4;
        const runs = [];
        let run = null;
        for (let t = ed.a; t <= ed.b + 1e-6; t += S) {
          const bx = ed.along === 'x' ? t : ed.at;
          const bz = ed.along === 'x' ? ed.at : t;
          let open = true;
          for (const s of [-1.4, 1.4]) {
            const w = L2W(bx + ed.nrm[0] * s, bz + ed.nrm[1] * s);
            if (navFloor(w.x, w.z, C.y, 1, 1.5) === null) open = false;
          }
          if (open) {
            if (!run) run = { from: t, to: t, pts: [] };
            run.to = t;
            const w = L2W(bx, bz);
            const y = navFloor(w.x, w.z, C.y, 1, 1.5);
            if (y !== null) run.pts.push(new V3(w.x, y + EYE, w.z));
          } else if (run) {
            runs.push(run);
            run = null;
          }
        }
        if (run) runs.push(run);
        for (const r of runs) {
          const width = r.to - r.from + S;
          if (width < 1.2) continue;
          const seenG = r.pts.length ? r.pts.filter((p) => gEyes.some((q) => phys.lineOfSight(q, p, SIGHT))).length / r.pts.length : 0;
          const seenA = r.pts.length ? r.pts.filter((p) => [...gEyes, ...owEyes].some((q) => phys.lineOfSight(q, p, SIGHT))).length / r.pts.length : 0;
          const midT = (r.from + r.to) / 2;
          mouths.push({
            edge: ed.label,
            at: ed.along === 'x' ? [+midT.toFixed(1), +ed.at.toFixed(1)] : [+ed.at.toFixed(1), +midT.toFixed(1)],
            width: +width.toFixed(1),
            seenGround: +seenG.toFixed(3),
            seenAll: +seenA.toFixed(3),
          });
        }
      }
    }

    /* ------------------------------------------------------ 5b. the plan --
     * An ASCII plan of the courtyard and 6 m of the ground around it, bucketed
     * by how far the top surface stands over the plant zone's floor. This is
     * the one output that shows you at a glance that a courtyard is an empty
     * pan: `.` is ankle-deep and nothing else, and a bare site is a rectangle
     * of dots.
     */
    const plan = [];
    {
      const X0 = (rect ? rect[0] : lc.x - 12) - 6;
      const X1 = (rect ? rect[2] : lc.x + 12) + 6;
      const Z0 = (rect ? rect[1] : lc.z - 12) - 6;
      const Z1 = (rect ? rect[3] : lc.z + 12) + 6;
      for (let lz = Z1; lz >= Z0; lz -= 1.5) {
        let row = '';
        for (let lx = X0; lx <= X1; lx += 1.0) {
          const w = L2W(lx, lz);
          const y = topAt(w.x, w.z, C.y + 20);
          const inZone = Math.hypot(lx - lc.x, lz - lc.z) <= rad;
          if (!Number.isFinite(y)) { row += ' '; continue; }
          const r = y - C.y;
          const ch =
            r < 0.35 ? (inZone ? '.' : ' ') :
            r < 0.9 ? 'l' :        // ankle/knee: litter, kerbs, sandbags
            r < 1.6 ? 'c' :        // CROUCH-to-CHEST cover you can shoot over
            r < 2.8 ? 'C' :        // full standing cover
            r < 4.2 ? '#' : 'B';   // wall / single storey / building
          row += ch;
        }
        plan.push(row);
      }
    }

    /* ----------------------------------------------------- 5. the arrival */
    const arr = {};
    for (const kind of ['attack', 'defend']) {
      const lens = m.spawns[kind].map((sp) => routeLen(sp.position, C)).filter((v) => v > 0);
      arr[kind] = lens.length ? +Math.min(...lens).toFixed(1) : -1;
    }

    out.sites.push({
      id: site.id,
      level: [+lc.x.toFixed(1), +lc.z.toFixed(1)],
      radius: rad,
      zoneCells: zone.length,
      rect: rect ? rect.map((v) => +v.toFixed(1)) : null,
      groundBest: +Math.max(...groundEyes.map((p) => p.seen)).toFixed(3),
      groundHold: +groundEyes[0].seen.toFixed(3),
      groundMean: +(groundEyes.reduce((s, p) => s + p.seen, 0) / groundEyes.length).toFixed(3),
      attackBest: attackEyes.length ? +Math.max(...attackEyes.map((p) => p.seen)).toFixed(3) : 0,
      attackMean: attackEyes.length
        ? +(attackEyes.reduce((s, p) => s + p.seen, 0) / attackEyes.length).toFixed(3)
        : 0,
      attackEyeCount: attackEyes.length,
      perchCount: perches.length,
      overwatchCount: overwatch.length,
      overwatchBest: perches.length ? +perches[0].seen.toFixed(3) : 0,
      overwatchTop: perches
        .slice(0, 6)
        .map((p) => ({ at: p.at, rise: p.rise, seen: +p.seen.toFixed(3), edge: p.edge ?? null })),
      defFirstBest: defFirst.length ? +defFirst[0].seen.toFixed(3) : 0,
      defFirstTop: defFirst.slice(0, 3).map((p) => ({ at: p.at, rise: p.rise, seen: +p.seen.toFixed(3), edge: p.edge })),
      atkFirstBest: atkFirst.length ? +atkFirst[0].seen.toFixed(3) : 0,
      atkFirstTop: atkFirst.slice(0, 3).map((p) => ({ at: p.at, rise: p.rise, seen: +p.seen.toFixed(3), edge: p.edge })),
      decks,
      coverIn,
      coverRing,
      coverPts: cp,
      mouths,
      plan,
      arrive: arr,
      arriveS: { attack: +(arr.attack / 4.57).toFixed(1), defend: +(arr.defend / 4.57).toFixed(1) },
    });
  }

  return out;
});

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

let fails = 0;
for (const s of result.sites) {
  console.log(`\n${'='.repeat(78)}\nSITE ${s.id}  level ${JSON.stringify(s.level)}  r=${s.radius}  ` +
    `courtyard ${JSON.stringify(s.rect)}  ${s.zoneCells} plantable cells`);

  console.log(`\n  ARRIVAL     attack ${s.arrive.attack} m (${s.arriveS.attack} s)   ` +
    `defence ${s.arrive.defend} m (${s.arriveS.defend} s)   ` +
    `defence ahead by ${(s.arrive.attack - s.arrive.defend).toFixed(1)} m`);

  console.log(`\n  ZONE SEEN FROM THE GROUND`);
  console.log(`    DEFENCE  hold ${pct(s.groundHold)}   best of the hold ring ${pct(s.groundBest)}   mean ${pct(s.groundMean)}`);
  console.log(`    ATTACK   best ${pct(s.attackBest)}   mean ${pct(s.attackMean)}   ` +
    `(${s.attackEyeCount} standable points on its two ways in)`);
  console.log(`    -> the defence sees ${(s.groundMean - s.attackMean >= 0 ? '+' : '') +
    ((s.groundMean - s.attackMean) * 100).toFixed(1)} points more of the zone than the attack`);

  console.log(`\n  OVERWATCH (player-reachable, >1.2 m over the zone, within 26 m)`);
  console.log(`    perches that see any of it: ${s.perchCount}    ` +
    `perches over 15 %: ${s.overwatchCount}    best: ${pct(s.overwatchBest)}`);
  console.log(`    ${pad('', 24)} ${num('rise', 6)} ${num('sees', 8)} ${num('atk m', 8)} ${num('def m', 8)}   arrives first`);
  for (const p of s.overwatchTop) {
    console.log(`      level ${num(p.at[0], 7)},${num(p.at[1], 7)}       ` +
      `+${num(p.rise, 5)} ${num(pct(p.seen), 8)} ` +
      (p.edge === null ? `${num('-', 8)} ${num('-', 8)}   -` : `${num('', 8)} ${num('', 8)}   ` +
        (p.edge > 0 ? `DEFENCE by ${p.edge} m` : `attack by ${-p.edge} m`)));
  }
  console.log(`    best perch the DEFENCE reaches first: ${pct(s.defFirstBest)}` +
    (s.defFirstTop[0] ? `  at level ${JSON.stringify(s.defFirstTop[0].at)} +${s.defFirstTop[0].rise} m (by ${s.defFirstTop[0].edge} m)` : ''));
  console.log(`    best perch the ATTACK  reaches first: ${pct(s.atkFirstBest)}` +
    (s.atkFirstTop[0] ? `  at level ${JSON.stringify(s.atkFirstTop[0].at)} +${s.atkFirstTop[0].rise} m (by ${-s.atkFirstTop[0].edge} m)` : ''));
  for (const d of s.decks) {
    console.log(`    authored ${pad(d.id, 14)} sees ${num(pct(d.seen), 7)}` +
      (d.bestAt ? `  best at level ${JSON.stringify(d.bestAt)}` : '') +
      (d.seen < 0.15 ? '   <-- does not watch the plant zone' : ''));
  }

  console.log(`\n  COVER`);
  console.log(`    0.9-2.8 m mass INSIDE the zone   ${num(s.coverIn.m2, 7)} m²  (${pct(s.coverIn.frac)} of the floor)`);
  console.log(`    …in the 8 m ring around it       ${num(s.coverRing.m2, 7)} m²  (${pct(s.coverRing.frac)})`);
  console.log(`    engine cover points  inside: ${s.coverPts.inHigh} standing / ${s.coverPts.inLow} crouch` +
    `   ring: ${s.coverPts.ringHigh} standing / ${s.coverPts.ringLow} crouch`);
  console.log(`    retake cover (defence side, 4-14 m, standing): ${s.coverPts.retake}`);

  console.log(`\n  MOUTHS`);
  console.log(`    ${pad('edge', 20)} ${pad('at', 16)} ${num('width', 7)}   seen(ground)   seen(+overwatch)`);
  for (const mo of s.mouths) {
    console.log(`    ${pad(mo.edge, 20)} ${pad(JSON.stringify(mo.at), 16)} ${num(mo.width + ' m', 7)}   ` +
      `${num(pct(mo.seenGround), 12)}   ${num(pct(mo.seenAll), 16)}`);
  }

  if (args.map) {
    console.log(`\n  PLAN  (+Z / the attack's lane is at the TOP, 1 m per column, 1.5 m per row)`);
    console.log(`        '.' plant zone floor   l <0.9m   c 0.9-1.6m   C 1.6-2.8m   # <4.2m   B building`);
    for (const row of s.plan) console.log('    ' + row);
  }

  // ------------------------------------------------------------- verdict --
  const bad = [];
  if (s.overwatchBest < MIN.overwatchBest) bad.push(`no perch sees ${pct(MIN.overwatchBest)} of the zone (best ${pct(s.overwatchBest)})`);
  if (s.overwatchCount < MIN.overwatchCount) bad.push(`only ${s.overwatchCount} perch(es) over 15 % (want ${MIN.overwatchCount})`);
  if (s.defFirstBest < MIN.defenceFirstPerch) {
    bad.push(
      `the best perch the DEFENCE reaches first sees only ${pct(s.defFirstBest)} of the zone ` +
        `(want ${pct(MIN.defenceFirstPerch)}) — the elevation over this site belongs to the attack`
    );
  }
  if (s.groundMean - s.attackMean < MIN.groundEdge) {
    bad.push(
      `the attack reads the zone BETTER from the ground than the defence does ` +
        `(${pct(s.attackMean)} vs ${pct(s.groundMean)})`
    );
  }
  if (s.coverPts.inHigh < MIN.highCoverIn) bad.push(`${s.coverPts.inHigh} standing cover points in the zone (want ${MIN.highCoverIn})`);
  if (s.coverIn.m2 < MIN.coverAreaIn) bad.push(`${s.coverIn.m2} m² of mass in the zone (want ${MIN.coverAreaIn})`);
  for (const mo of s.mouths) {
    if (/ATTACK|connector/.test(mo.edge) && mo.seenGround < MIN.mouthGroundSeen) {
      bad.push(`mouth "${mo.edge}" at ${JSON.stringify(mo.at)} only ${pct(mo.seenGround)} watched from the ground`);
    }
  }
  s.verdict = bad;
  fails += bad.length;
  console.log(bad.length ? `\n  SITE ${s.id} BARE:\n` + bad.map((b) => `    - ${b}`).join('\n') : `\n  SITE ${s.id} OK — defensible on every measure`);
}

if (args.json) writeFileSync(String(args.json), JSON.stringify(result, null, 2));
if (pageErrors.length) console.log('\n[sitecheck] page errors', pageErrors.slice(0, 6));
console.log(fails ? `\n[sitecheck] FAIL — ${fails} problems across ${result.sites.length} sites` : `\n[sitecheck] PASS — both sites are defensible`);
await browser.close();
process.exit(fails || pageErrors.length ? 1 : 0);
