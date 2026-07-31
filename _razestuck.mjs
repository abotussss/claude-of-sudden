/**
 * STUCKCHECK, RUN ON THE MAP AFTER THE CATHEDRAL IS DOWN.
 *
 *   node _razestuck.mjs [--url=…]
 *
 * `tools/stuckcheck.mjs` boots, measures and exits, so it only ever sees the
 * INTACT town — and the cathedral's ruin puts new collision on the map in the
 * middle of a match. The nav grid is baked at boot and is NOT rebuilt, so any
 * ruin collider standing on ground the height field calls walkable is an
 * invisible wall that A* routes thirty men straight into. `cathedral.js` keeps
 * every collider on the shell's own footprint precisely so that cannot happen,
 * and this is the measurement that says whether that held.
 *
 * Same assertion as `stuckcheck`: per agent, the longest run of samples in which
 * he wanted to move and travelled less than a metre.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4253/';
const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(URL, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 480000 });

// Reach LIVE on its own, then take the cathedral down on the real path and wait
// for D — measuring before D exists would measure the intact map again.
await p.evaluate(() => (window.__ENGINE__.time.scale = 10));
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await p.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  m._checkWinConditions = () => {};
  m.roundClock = 1e6;
  m.score[0] = 999; // over `cathedralOpenProgress` by any measure
});
await p.waitForFunction("window.__ENGINE__.ctx.peek('match').sites.some((z)=>z.id==='D')", null, { timeout: 180000 });
const state = await p.evaluate(() => ({
  razed: window.__ENGINE__.ctx.peek('world').cathedral.razed,
  zones: window.__ENGINE__.ctx.peek('match').sites.map((z) => z.id).join('/'),
}));
console.log('[razestuck] map state', JSON.stringify(state));

const wait = (n) =>
  p.evaluate((n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);
await p.evaluate(() => { window.__ENGINE__.ctx.time.scale = 8; });
await wait(200);
await p.evaluate(() => {
  const ai = window.__ENGINE__.ctx.peek('ai');
  const m = window.__ENGINE__.ctx.peek('match');
  const d = m.allZones.find((z) => z.id === 'D');
  window.__ST__ = { last: new Map(), stuck: new Map(), worst: new Map(), moved: new Map(), samples: 0, inD: 0 };
  window.__TICK__ = () => {
    const S = window.__ST__; S.samples++;
    for (const a of (ai.agents ?? ai.actors ?? [])) {
      if (!a.alive) continue;
      const q = a.position ?? a.pos; if (!q) continue;
      const k = a.name ?? String(a.id ?? 0);
      const prev = S.last.get(k);
      const wants = (a.desiredSpeed ?? a.speed ?? 1) > 0.1;
      if (prev) {
        const dd = Math.hypot(q.x - prev.x, q.z - prev.z);
        S.moved.set(k, (S.moved.get(k) ?? 0) + dd);
        if (wants && dd < 0.15) S.stuck.set(k, (S.stuck.get(k) ?? 0) + 1);
        else S.stuck.set(k, 0);
      }
      S.last.set(k, { x: q.x, z: q.z });
      S.worst.set(k, Math.max(S.worst.get(k) ?? 0, S.stuck.get(k) ?? 0));
      const dx = q.x - d.position.x, dz = q.z - d.position.z;
      if (dx * dx + dz * dz <= d.radius * d.radius) S.inD++;
    }
  };
});
for (let i = 0; i < 40; i++) { await wait(8); await p.evaluate(() => window.__TICK__()); }
const r = await p.evaluate(() => {
  const S = window.__ST__;
  const rows = [...S.worst.entries()].map(([k, v]) => ({ name: k, stuck: v, moved: +(S.moved.get(k) ?? 0).toFixed(1) }));
  rows.sort((a, c) => c.stuck - a.stuck);
  return { samples: S.samples, rows, inD: S.inD };
});
const hard = r.rows.filter((x) => x.stuck >= 5);
const barely = r.rows.filter((x) => x.moved < 15);
console.log(`\n  ${r.rows.length} live bots, ${r.samples} samples, ON THE RAZED MAP`);
console.log('  name        longest stuck run   total distance moved');
for (const x of r.rows.slice(0, 12)) console.log(`  ${x.name.padEnd(11)} ${String(x.stuck).padStart(13)}   ${String(x.moved).padStart(18)} m`);
console.log(`\n  bots stuck >=5 consecutive samples: ${hard.length} / ${r.rows.length}`);
console.log(`  bots that barely moved at all (<15 m): ${barely.length} / ${r.rows.length}`);
console.log(`  bot-samples inside D (the ruin): ${r.inD}`);
console.log('  pageErrors', errs.length ? errs.slice(0, 4) : 'none');
await b.close();
process.exit(hard.length > r.rows.length * 0.25 ? 1 : 0);
