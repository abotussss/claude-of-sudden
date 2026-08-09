/**
 * ════════════════════════════════════════════════════════════════════════════
 * 「またドローンはちゃんとEMPドームで壊れるようになってる？」 — MEASURED, NOT ASSERTED
 * ════════════════════════════════════════════════════════════════════════════
 *
 *   node _dempkill.mjs [--url=…] [--seed=7] [--scale=14] [--secs=1200]
 *
 * A real NACHTFELD match at `time.scale`, with three of `Drones`' own methods
 * wrapped so the whole life of every airframe is on one line:
 *
 *   _launch      where it came off the rail, and whether `emp.bites()` already
 *                said that point was dead air — the 7-of-20 defect
 *                `_clearOfDeadAir` exists for.
 *   _empKill     which field took it, in which state, with how much life left,
 *                and — the tell the whole feature rests on — whether the field
 *                DISCHARGED and whether the airframe still had a collider (a
 *                warhead) after the frame it died in.
 *   _detonate    every OTHER end of a drone goes off. If an id appears here as
 *                well as in `_empKill`, the one silent death in the system is
 *                not silent and the feature is broken.
 *
 * The split by TEAM is the point of the second half: `src/ai` has no drone
 * flight, no launch and no mention of `emp` — the bots' drones are the player's
 * code with a different index on them — so a number that differs by team is a
 * bug in this file and not a balance decision.
 */
import { chromium } from 'playwright';
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4636/?map=plains&capture=1';
const SEED = args.seed ?? '7';
const SCALE = Number(args.scale ?? 14);
const SECS = Number(args.secs ?? 1200);

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e.message)));
await p.goto(`${URL}&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction('window.__READY__===true', null, { timeout: 300000 });
console.log('level.id =', await p.evaluate(() => window.__ENGINE__.ctx.peek('world').level.id));

await p.evaluate((scale) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const dr = window.__DRONES__ ?? m.drones;
  window.__D__ = { launches: [], emp: [], boom: new Set(), crash: [], fields: dr.emp.zones.map((z) => ({ id: z.id, r: z.r, x: z.position.x, z: z.position.z })) };
  const D = window.__D__;
  const L = dr._launch.bind(dr);
  dr._launch = (t) => {
    const d = L(t);
    if (d) {
      const z = dr.emp.bites(d.position);
      D.launches.push({ id: d.id, team: d.team, inField: z ? z.id : null,
        at: [+d.position.x.toFixed(1), +d.position.y.toFixed(1), +d.position.z.toFixed(1)] });
    }
    return d;
  };
  const K = dr._empKill.bind(dr);
  dr._empKill = (d, z) => {
    const before = z.flash;
    // the flight state it was in WHEN IT CROSSED — `_empKill` sets it to `fall`
    const was = d.state;
    const alt = d.position.y - d.groundY;
    const r = K(d, z);
    D.emp.push({ id: d.id, team: d.team, state: was, alt0: +alt.toFixed(1), zone: z.id, zoneR: z.r,
      life: +d.life.toFixed(1),
      alt: +alt.toFixed(1),
      flashed: z.flash > before, kills: z.kills,
      colliderGone: d.collider === null, rotorRate: d.rotorRate,
      protectedFromAi: d.aiProtectedUntil === Infinity,
      warheadArmed: !!d.collider });
    return r;
  };
  const B = dr._detonate.bind(dr);
  dr._detonate = (d) => { D.boom.add(d.id); return B(d); };
  const C = dr._crash.bind(dr);
  dr._crash = (d) => {
    D.crash.push({ id: d.id, team: d.team, fell: +(d.position.y).toFixed(1), fallT: +d.fallT.toFixed(2),
      rotorRate: +d.rotorRate.toFixed(2), silent: !D.boom.has(d.id) });
    return C(d);
  };
  e.ctx.time.scale = scale;
}, SCALE);

const deadline = Date.now() + 420000;
for (;;) {
  await p.evaluate(() => new Promise((r) => { let i = 0; const t = () => (++i >= 120 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
  const st = await p.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    return { t: +(1200 - m.roundClock).toFixed(0), over: m.phase === 'matchover' || m.phase === 'over' };
  });
  if (st.over || st.t >= SECS || Date.now() > deadline) break;
}

const out = await p.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const dr = window.__DRONES__ ?? m.drones;
  const D = window.__D__;
  return {
    playerTeam: m.playerTeam,
    fields: D.fields.length,
    stats: dr.stats,
    launches: D.launches,
    emp: D.emp,
    crash: D.crash,
    boomIds: [...D.boom],
    fieldKills: dr.emp.zones.filter((z) => z.kills).map((z) => `${z.id}(r${z.r}):${z.kills}`),
  };
});

const per = (rows, t) => rows.filter((r) => r.team === t).length;
const T = ['team0', 'team1'];
console.log(`\n  playerTeam = ${out.playerTeam} · ${out.fields} EMP fields`);
console.log(`  launched ${out.launches.length} (${T.map((n, i) => `${n} ${per(out.launches, i)}`).join(', ')})`);
const bad = out.launches.filter((l) => l.inField);
console.log(`  launched INSIDE a field: ${bad.length}${bad.length ? '  <-- FAIL ' + JSON.stringify(bad.slice(0, 4)) : '  (0 of ' + out.launches.length + ')'}`);
console.log(`\n  taken by a field: ${out.emp.length} (${T.map((n, i) => `${n} ${per(out.emp, i)}`).join(', ')})`);
const byState = {};
for (const r of out.emp) byState[r.state] = (byState[r.state] ?? 0) + 1;
console.log(`  by state: ${JSON.stringify(byState)}`);
console.log(`  by field: ${out.fieldKills.join(' ') || '(none)'}`);
console.log(`  field discharged on every kill: ${out.emp.every((r) => r.flashed) ? 'YES' : 'NO <-- FAIL'}`);
console.log(`  warhead removed on every kill:  ${out.emp.every((r) => r.colliderGone) ? 'YES' : 'NO <-- FAIL'}`);
console.log(`  taken off the bots' target list: ${out.emp.every((r) => r.protectedFromAi) ? 'YES' : 'NO <-- FAIL'}`);
const empIds = new Set(out.emp.map((r) => r.id));
const exploded = out.boomIds.filter((i) => empIds.has(i));
console.log(`  EMP deaths that ALSO exploded: ${exploded.length}${exploded.length ? ' <-- FAIL ' + exploded : '  (the one silent death holds)'}`);
console.log(`\n  reached the ground: ${out.crash.length} (${T.map((n, i) => `${n} ${per(out.crash, i)}`).join(', ')})`);
console.log(`  silent on landing:  ${out.crash.filter((c) => c.silent).length} of ${out.crash.length}`);
console.log(`  rotors stopped:     ${out.crash.filter((c) => c.rotorRate < 0.6).length} of ${out.crash.length} (rate < 0.6 rad/s at touchdown)`);
console.log(`\n  drone stats: ${JSON.stringify(out.stats)}`);
if (out.emp.length) {
  console.log('\n  id  team  state   field  r   life  alt(m)');
  for (const r of out.emp) console.log(`  ${String(r.id).padStart(3)}  ${r.team}     ${r.state.padEnd(7)} ${String(r.zone).padEnd(5)} ${String(r.zoneR).padStart(2)}  ${String(r.life).padStart(5)} ${String(r.alt).padStart(6)}`);
}
console.log(errs.length ? `\nPAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : '\n0 pageerrors');
await b.close();
