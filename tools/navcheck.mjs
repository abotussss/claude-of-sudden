/**
 * NAVIGATION GATE — run this after EVERY change to `src/world` or
 * `src/match/sites.js`, before believing the map works.
 *
 *   node tools/navcheck.mjs [--url=http://127.0.0.1:4173/]
 *
 * WHY IT EXISTS. A previous pass at this map left bomb site A walkable but
 * sealed into a courtyard with no route from the attacking spawns. A* returned
 * zero waypoints, six of thirteen bots were handed an objective they could not
 * path to, and `Agent._advance` did what it was told and stood still. From the
 * outside that reads as "the AI went brain-dead", and it took three rounds of
 * diagnosis to find. Walkable is not reachable, and nothing in the boot log
 * says the difference.
 *
 * So this asserts the invariant directly: EVERY spawn point of BOTH teams must
 * have an A* route to EVERY bomb site and to every site's hold point. Any zero
 * is a hard failure and the process exits non-zero.
 *
 * It also prints the route lengths, which is the map's balance in one table —
 * if the defence's shortest path to a site is longer than the attack's, the
 * site cannot be held.
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

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));
const warnings = [];
page.on('console', (m) => {
  const t = m.text();
  if (/not walkable|not reachable|no route|\[world\] built|\[ai\] nav|\[match\] site/.test(t)) {
    warnings.push(t.slice(0, 200));
  }
});

console.log(`[navcheck] booting ${URL} …`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const result = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const ai = e.ctx.peek('ai');
  const m = e.ctx.peek('match');
  const path = [];
  const rows = [];
  let failures = 0;

  /** Path length in metres, or -1 when A* finds no route at all. */
  const routeLen = (from, to) => {
    const n = ai.grid.findPath(from, to, path);
    if (n <= 0) return -1;
    let d = from.distanceTo(path[0]);
    for (let i = 1; i < n; i++) d += path[i - 1].distanceTo(path[i]);
    return +d.toFixed(1);
  };

  for (const site of m.sites) {
    for (const kind of ['attack', 'defend']) {
      const lens = m.spawns[kind].map((sp) => routeLen(sp.position, site.position));
      const bad = lens.filter((v) => v < 0).length;
      failures += bad;
      rows.push({
        target: `site ${site.id}`,
        from: kind,
        unreachableSpawns: bad,
        shortest: Math.min(...lens.filter((v) => v >= 0)),
        longest: Math.max(...lens),
        lens,
      });
    }
    // The hold point matters too: defenders are sent there every round.
    const holdLens = m.spawns.defend.map((sp) => routeLen(sp.position, site.hold));
    const badHold = holdLens.filter((v) => v < 0).length;
    failures += badHold;
    rows.push({
      target: `site ${site.id} hold`,
      from: 'defend',
      unreachableSpawns: badHold,
      shortest: Math.min(...holdLens.filter((v) => v >= 0)),
      longest: Math.max(...holdLens),
      lens: holdLens,
    });
  }

  return {
    failures,
    rows,
    world: e.ctx.peek('world').stats,
    nav: { walkable: ai.stats.walkable, cover: ai.stats.coverPts },
    sites: m.sites.map((s) => ({
      id: s.id,
      name: s.name,
      at: [+s.position.x.toFixed(1), +s.position.z.toFixed(1)],
    })),
  };
});

for (const w of [...new Set(warnings)]) console.log('  ' + w);
console.log('\n[navcheck] world', JSON.stringify(result.world));
console.log('[navcheck] nav  ', JSON.stringify(result.nav));
console.log('[navcheck] sites', JSON.stringify(result.sites));
console.log('\n  target                from      unreachable   shortest   longest');
for (const r of result.rows) {
  const flag = r.unreachableSpawns ? '  <-- FAIL' : '';
  console.log(
    `  ${r.target.padEnd(20)} ${r.from.padEnd(8)} ${String(r.unreachableSpawns).padStart(9)}` +
      `   ${String(r.shortest).padStart(8)}   ${String(r.longest).padStart(7)}${flag}`
  );
}

/**
 * Balance read: the defence must be able to reach a site before the attack
 * does, or it cannot be held. Reported, not enforced — a map can be deliberately
 * attacker-sided.
 */
console.log('');
for (const site of result.sites) {
  const a = result.rows.find((r) => r.target === `site ${site.id}` && r.from === 'attack');
  const d = result.rows.find((r) => r.target === `site ${site.id}` && r.from === 'defend');
  if (!a || !d) continue;
  const edge = +(a.shortest - d.shortest).toFixed(1);
  console.log(
    `  site ${site.id}: attack ${a.shortest} m vs defend ${d.shortest} m — ` +
      (edge > 0 ? `defence arrives first by ${edge} m` : `ATTACK arrives first by ${-edge} m`)
  );
}

if (pageErrors.length) console.log('\n[navcheck] page errors', pageErrors.slice(0, 6));
console.log(
  result.failures
    ? `\n[navcheck] FAIL — ${result.failures} spawn/target pairs have no route`
    : '\n[navcheck] PASS — every spawn reaches every site'
);
await browser.close();
process.exit(result.failures || pageErrors.length ? 1 : 0);
