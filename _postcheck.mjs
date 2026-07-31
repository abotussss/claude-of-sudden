/**
 * POST-EVERYTHING GATE — navcheck's own assertion, run on the map AFTER every
 * event in this change has fired.
 *
 *   node _postcheck.mjs [--url=…]
 *
 * `tools/navcheck.mjs` boots, measures and exits, so it only ever sees the
 * INTACT town — and the whole of this change is things that alter the town
 * mid-match. So the same assertion is re-run here with the cathedral down, D
 * open, both tanks out and every remaining strike site collapsed and settled:
 * every spawn of both sides must still A* to every zone AND to every hold
 * point, INCLUDING D, which navcheck itself never sees because it is locked at
 * boot.
 *
 * Then the match is run on a time scale with a full roster, and what is counted
 * is the thing the brief is actually about: bots inside the ruin.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4251/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push('console.error: ' + m.text().slice(0, 260));
});

console.log(`[postcheck] booting ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const sleep = (ms) => page.waitForTimeout(ms);

/** navcheck's routeLen assertion, over whatever zones are live right now. */
const routes = () =>
  page.evaluate(() => {
    const e = window.__ENGINE__;
    const ai = e.ctx.peek('ai');
    const m = e.ctx.peek('match');
    const path = [];
    const len = (a, b) => {
      const n = ai.grid.findPath(a, b, path);
      if (n <= 0) return -1;
      let d = a.distanceTo(path[0]);
      for (let i = 1; i < n; i++) d += path[i - 1].distanceTo(path[i]);
      return +d.toFixed(1);
    };
    const rows = [];
    let failures = 0;
    // `allZones`, so D is asserted whether it is live yet or not.
    for (const z of m.allZones) {
      for (const kind of ['attack', 'defend']) {
        const l = m.spawns[kind].map((sp) => len(sp.position, z.position));
        const bad = l.filter((v) => v < 0).length;
        failures += bad;
        rows.push({
          t: `${z.id}${z.locked ? '*' : ''}`,
          from: kind,
          bad,
          min: Math.min(...l.filter((v) => v >= 0)),
          max: Math.max(...l),
        });
      }
      const h = m.spawns.defend.map((sp) => len(sp.position, z.hold));
      const badH = h.filter((v) => v < 0).length;
      failures += badH;
      rows.push({ t: `${z.id} hold`, from: 'defend', bad: badH, min: Math.min(...h.filter((v) => v >= 0)), max: Math.max(...h) });
    }
    return { failures, rows, live: m.sites.map((z) => z.id).join('/') };
  });

const show = (label, r) => {
  console.log(`\n--- ${label} --- live zones ${r.live}`);
  for (const x of r.rows) {
    console.log(`  ${String(x.t).padEnd(10)} ${x.from.padEnd(7)} unreachable ${x.bad}   ${String(x.min).padStart(7)} .. ${String(x.max).padStart(7)} m`);
  }
  console.log(`  failures ${r.failures}`);
  return r.failures;
};

let fails = show('INTACT (what navcheck sees)', await routes());

/* ---- fire everything ----------------------------------------------------- */
// Let the match START on its own — WARMUP -> FREEZE -> LIVE is what spawns the
// thirty men, and forcing the phase skips `_beginRound` and leaves an empty map.
await page.evaluate(() => (window.__ENGINE__.time.scale = 8));
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 120000 });
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await sleep(500);
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m.airstrike.enabled = true;
  m._cathedralCalled = true;
  m.airstrike.callCathedralCollapse();
  // AND THE SHELL. Forcing `_cathedralCalled` skips the branch that arms
  // `_razeIn`, so without this the routes below are measured on a map where the
  // cathedral is still standing — which is the exact class of half-measured
  // state this file exists to catch. @see MatchSystem._razeCathedral.
  m._razeCathedral();
  m._cathedralPending = 7.4;
  m.tank.fire();
  e.time.scale = 4;
});
await sleep(6000);
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._finalCalled = true;
  m.airstrike.callEverything(0.4);
});
// 4.4 s lead + 11 * 0.4 s roll + 6.5 s settle, at 4x.
await sleep(9000);
await page.evaluate(() => (window.__ENGINE__.time.scale = 1));
await sleep(1500);

const after = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  return {
    cathedralRazed: window.__ENGINE__.ctx.peek('world').cathedral?.razed ?? null,
    struck: m.airstrike.sites.filter((s) => s.struck).length,
    settled: m.airstrike.sites.filter((s) => s.baked).length,
    total: m.airstrike.sites.length,
    dLive: m.sites.some((z) => z.id === 'D'),
  };
});
console.log('\n[postcheck] town state', JSON.stringify(after));
fails += show('AFTER EVERYTHING HAS FIRED', await routes());

/* ---- and then play it, with a roster, and count bodies in the ruin ------- */
const play = await page.evaluate(async () => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const d = m.allZones.find((z) => z.id === 'D');
  window.__RUIN__ = { samples: 0, insideD: 0, anyInsideD: 0 };
  const R = window.__RUIN__;
  const sampler = () => {
    R.samples++;
    let n = 0;
    for (const list of m._botsByTeam) {
      for (const a of list) {
        if (!a.alive) continue;
        const dx = a.position.x - d.position.x;
        const dz = a.position.z - d.position.z;
        if (dx * dx + dz * dz <= d.radius * d.radius && Math.abs(a.position.y - d.position.y) < 3) n++;
      }
    }
    R.insideD += n;
    if (n > 0) R.anyInsideD++;
  };
  const step = e.step.bind(e);
  e.step = (now) => {
    step(now);
    sampler();
  };
  e.time.scale = 10;
  return { armed: true, dOwner: d.owner, dLive: m.sites.includes(d) };
});
console.log('[postcheck] playing…', JSON.stringify(play));
await sleep(45000);
const result = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const d = m.allZones.find((z) => z.id === 'D');
  e.time.scale = 1;
  return {
    zones: m.sites.map((z) => `${z.id}:${z.owner < 0 ? 'neutral' : ['RED', 'BLUE'][z.owner]}`).join(' '),
    score: [m.score[0], m.score[1]],
    captures: m.capture.stats.captures,
    dOwner: d.owner,
    dCounts: [d.counts[0], d.counts[1]],
    aliveBots: m._botsByTeam.flat().filter((a) => a.alive).length,
  };
});
console.log('[postcheck] after play', JSON.stringify(result));
const ruin = await page.evaluate(() => {
  const r = window.__RUIN__;
  return {
    samples: r.samples,
    meanBotsInsideD: +(r.insideD / Math.max(1, r.samples)).toFixed(2),
    framesWithABotInsideD: `${((100 * r.anyInsideD) / Math.max(1, r.samples)).toFixed(1)}%`,
  };
});
console.log('[postcheck] BOTS IN THE RUIN', JSON.stringify(ruin));
console.log('\n[postcheck] total route failures', fails);
console.log('[postcheck] pageErrors', pageErrors.length ? pageErrors.slice(0, 6) : 'none');
console.log(fails === 0 && pageErrors.length === 0 ? '[postcheck] PASS' : '[postcheck] FAIL');
await browser.close();
process.exit(fails === 0 && pageErrors.length === 0 ? 0 : 1);
