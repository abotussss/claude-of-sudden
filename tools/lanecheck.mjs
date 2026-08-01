/**
 * LANE SEPARATION GATE — does this map have three routes, or one corridor?
 *
 *   node tools/lanecheck.mjs [--url=http://127.0.0.1:4173/]
 *
 * WHY IT EXISTS. `tools/navcheck.mjs` proves every spawn can *reach* every
 * site. It says nothing about whether the two routes are the SAME route, and on
 * a one-street map they are: the attack walks the same forty metres of tarmac
 * to site A as it does to site B and only splits in the last few strides. That
 * is a corridor with two labels on it, not a demolition layout, and no headless
 * number in this repo caught it.
 *
 * So this measures the thing directly. For every attacker spawn it A*s to site
 * A and to site B, resamples both polylines at 1 m, and reports the fraction of
 * the A route that has a B-route sample within `--near` metres (6 m by default,
 * i.e. "you can see and shoot the other lane from here"). Three separate lanes
 * score low; one street with two stubs on the end scores high.
 *
 * It also reports the defender rotation A -> B, because a three-lane map with
 * no connector is just three corridors: rotation should be walkable in roughly
 * 8-14 s, which at the player's 4.57 m/s stand speed is 37-64 m.
 */

import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    /**
     * SPLIT ON THE FIRST `=` ONLY. `split('=')` destructured to `[k, v]` threw
     * away everything after the second one, so `--url=…/?seed=12` reached the
     * page as `…/?seed`, `Number('')` became 0, and this gate measured seed 0
     * while reporting the seed it was asked for. It "passed" on the seed a
     * sweep failed 8 boots out of 8. A tool that silently measures something
     * other than what it was pointed at is worse than a tool that crashes.
     */
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4173/';
const NEAR = Number(args.near ?? 6);
/** Player stand speed, from src/player/tuning.js — used for the rotation clock. */
const WALK = 4.57;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

console.log(`[lanecheck] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const result = await page.evaluate((NEAR) => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  const world = e.ctx.peek('world');
  const buf = [];

  /** A* -> a polyline resampled every metre, as flat [x, z, x, z, …]. */
  const route = (from, to) => {
    const n = ai.grid.findPath(from, to, buf);
    if (n <= 0) return null;
    const pts = [from, ...buf.slice(0, n)];
    const out = [];
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      len += d;
      const steps = Math.max(1, Math.ceil(d));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        out.push(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      }
    }
    out.push(pts[pts.length - 1].x, pts[pts.length - 1].z);
    return { pts: out, len };
  };

  /** Fraction of `a`'s samples with a sample of `b` within NEAR metres. */
  const overlap = (a, b) => {
    let hit = 0;
    for (let i = 0; i < a.length; i += 2) {
      for (let j = 0; j < b.length; j += 2) {
        if (Math.hypot(a[i] - b[j], a[i + 1] - b[j + 1]) <= NEAR) {
          hit++;
          break;
        }
      }
    }
    return hit / (a.length / 2);
  };

  const A = m.sites.find((s) => s.id === 'A');
  const B = m.sites.find((s) => s.id === 'B');
  const rows = [];
  for (let i = 0; i < m.spawns.attack.length; i++) {
    const sp = m.spawns.attack[i].position;
    const ra = route(sp, A.position);
    const rb = route(sp, B.position);
    if (!ra || !rb) {
      rows.push({ i, bad: true });
      continue;
    }
    rows.push({
      i,
      lenA: +ra.len.toFixed(1),
      lenB: +rb.len.toFixed(1),
      aInB: +overlap(ra.pts, rb.pts).toFixed(3),
      bInA: +overlap(rb.pts, ra.pts).toFixed(3),
    });
  }

  // Defender rotation: site to site, and site to site the way a defender who
  // fell back through their own spawn would actually run it.
  const rot = route(A.position, B.position);
  const spawn0 = m.spawns.defend[0].position;
  const viaA = route(A.position, spawn0);
  const viaB = route(spawn0, B.position);
  const holdRot = route(A.hold, B.hold);

  const lv = (p) => {
    const q = world.worldToLevel(p.x, p.y, p.z, new (Object.getPrototypeOf(p).constructor)());
    return [+q.x.toFixed(1), +q.z.toFixed(1)];
  };

  return {
    rows,
    near: NEAR,
    rotation: rot ? +rot.len.toFixed(1) : -1,
    rotationViaSpawn: viaA && viaB ? +(viaA.len + viaB.len).toFixed(1) : -1,
    holdRotation: holdRot ? +holdRot.len.toFixed(1) : -1,
    siteA: lv(A.position),
    siteB: lv(B.position),
  };
}, NEAR);

console.log(
  `[lanecheck] site A level ${JSON.stringify(result.siteA)}   ` +
    `site B level ${JSON.stringify(result.siteB)}`
);
console.log(`\n  attacker spawn    route->A   route->B   A within ${result.near} m of B   B within A`);
let sum = 0;
let n = 0;
for (const r of result.rows) {
  if (r.bad) {
    console.log(`  ${String(r.i).padEnd(16)} NO ROUTE`);
    continue;
  }
  sum += (r.aInB + r.bInA) / 2;
  n++;
  console.log(
    `  ${String(r.i).padEnd(16)} ${String(r.lenA).padStart(8)}   ${String(r.lenB).padStart(8)}   ` +
      `${(r.aInB * 100).toFixed(1).padStart(15)}%   ${(r.bInA * 100).toFixed(1).padStart(9)}%`
  );
}
const mean = n ? sum / n : 1;
console.log(`\n  MEAN LANE OVERLAP  ${(mean * 100).toFixed(1)}%   (lower is more separate)`);
console.log(
  `  defender rotation A -> B   ${result.rotation} m ` +
    `(${(result.rotation / 4.57).toFixed(1)} s walking)   ` +
    `via defend spawn ${result.rotationViaSpawn} m   hold-to-hold ${result.holdRotation} m`
);
if (pageErrors.length) console.log('\n[lanecheck] page errors', pageErrors.slice(0, 6));
await browser.close();
process.exit(pageErrors.length ? 1 : 0);
