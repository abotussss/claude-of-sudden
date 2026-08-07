/**
 * NACHTFELD'S ACTS, FIRED AND MEASURED.
 *
 *   node _nfact.mjs [--url=…] [--scale=8] [--acts=3] [--shots=1] [--seed=N]
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT IT MEASURES AND WHY IT DOES NOT FORCE ANYTHING
 * ────────────────────────────────────────────────────────────────────────────
 * 「大イベントの発火時刻を実測し、後半3〜5分に寄せる」. A fire time READ OFF THE
 * SCHEDULE is not a measurement: `_matchProgress` is
 * `max(elapsed/matchTime, leader/scoreTarget)` and the score term routinely
 * overtakes the clock term, so a `progress: 0.46` threshold is NOT 0.46*1200 s.
 * The only way to know when an act fires is to let a match run and watch it.
 *
 * So this probe forces nothing about WHEN. It holds the round clock and the win
 * check open — otherwise a domination match ends on `scoreTarget` before the
 * later acts are due and the run measures nothing — runs the clock at
 * `--scale`, and records, per act:
 *
 *   t          seconds on the 1200 s match clock, `matchTime - roundClock`
 *   p          `_matchProgress()` at the moment it was called
 *   beats      every beat of the sheet with the offset it actually played at
 *   standing   `world.demolitions[].down` for every record, after
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE TRAP THIS FILE DOES NOT FALL INTO
 * ────────────────────────────────────────────────────────────────────────────
 * Several probes here carried a destructured `split('=')`, which truncated
 * `--url=…/?map=plains` to `…/?map` — a level id `getLevel` silently falls back
 * to the TOWN for. Every such run measured the town while printing "plains".
 * Split on the FIRST `=` only, and PROVE the map at the other end rather than
 * trusting the string: the boot report below prints `world.level.id`.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const s = a.replace(/^--/, '');
    const i = s.indexOf('=');
    return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
  })
);
const BASE = args.url ?? 'http://127.0.0.1:4578/?map=plains';
const SCALE = Number(args.scale ?? 8);
const WANT = Number(args.acts ?? 3);
const SEED = args.seed;

const url = SEED === undefined ? BASE : `${BASE}${BASE.includes('?') ? '&' : '?'}seed=${SEED}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
const errs = [];
const logs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => {
  const s = m.text();
  if (/\[match\]|\[airstrike\]|\[world\] nachtfeld|\[bomber\]|\[strafe\]|\[tank\]/.test(s)) logs.push(s);
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

/* ---- prove the map, and report what baked -------------------------------- */
const boot = await page.evaluate(() => {
  const E = window.__ENGINE__;
  const w = E.ctx.peek('world');
  const m = E.ctx.peek('match');
  return {
    level: w?.level?.id ?? null,
    seed: E.levelSeed ?? null,
    demos: (w?.demolitions ?? []).map((d) => ({
      id: d.id, x: +d.position.x.toFixed(1), z: +d.position.z.toFixed(1),
      top: +(d.top ?? 0).toFixed(1), r: +(d.radius ?? 0).toFixed(1), down: !!d.down,
    })),
    acts: (m?._acts ?? []).map((a) => ({ id: a.spec.id, p: a.spec.progress, beats: a.spec.beats.length })),
    locked: m?.lockedZone?.id ?? null,
    zones: m?.sites?.map((z) => z.id) ?? [],
    all: m?.allZones?.map((z) => z.id) ?? [],
  };
});
console.log(`BOOT level=${boot.level} seed=${boot.seed}`);
console.log(`  demolitions: ${boot.demos.map((d) => `${d.id}@(${d.x},${d.z}) top${d.top} r${d.r}`).join(' · ') || 'NONE'}`);
console.log(`  acts baked : ${boot.acts.map((a) => `${a.id}@p${a.p} (${a.beats} beats)`).join(' · ') || 'NONE'}`);
console.log(`  locked zone: ${boot.locked}  live=${boot.zones.join('')}  all=${boot.all.join('')}`);
if (boot.level !== 'plains') {
  console.error('NOT THE PLAIN — the url did not select ?map=plains. Aborting.');
  await browser.close();
  process.exit(2);
}

/* ---- let the match start on its own, then hold it open -------------------- */
await page.evaluate((s) => (window.__ENGINE__.time.scale = s), SCALE);
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  /**
   * HOLD THE MATCH OPEN, AND ONLY THAT. `roundClock` is what `_matchProgress`'s
   * clock term reads, so it is NOT pinned — it is left to run and only the WIN
   * on it is suppressed, by keeping the check from ending the round. Otherwise
   * a domination match reaches `scoreTarget` 1000 and ends before act III.
   */
  m._checkWinConditions = () => {};
  m.airstrike.enabled = true;
  /** WATCH, do not drive. One tap per act, recording the clock as it happens. */
  window.__NF__ = { acts: [], beats: [] };
  const beginAct = m._beginAct.bind(m);
  m._beginAct = function (a, t, p) {
    window.__NF__.acts.push({
      id: a.spec.id,
      name: a.spec.name,
      t: +t.toFixed(1),
      p: +p.toFixed(3),
      clock: +(window.__ENGINE__.ctx.peek('match').roundClock).toFixed(1),
      wall: +window.__ENGINE__.time.elapsed.toFixed(1),
      score: [...m.score],
    });
    return beginAct(a, t, p);
  };
  const actBeat = m._actBeat.bind(m);
  m._actBeat = function (a, kind) {
    window.__NF__.beats.push({
      id: a.spec.id, kind, at: +m._nf.t.toFixed(2),
      standing: (window.__ENGINE__.ctx.peek('world').demolitions ?? []).filter((d) => !d.down).map((d) => d.id),
    });
    return actBeat(a, kind);
  };
});

/* ---- wait it out --------------------------------------------------------- */
const T0 = Date.now();
let last = 0;
while (Date.now() - T0 < 600000) {
  const st = await page.evaluate(() => {
    const m = window.__ENGINE__.ctx.peek('match');
    const w = window.__ENGINE__.ctx.peek('world');
    return {
      n: window.__NF__.acts.length,
      i: m._nf?.i ?? -1,
      running: m._nf?.t ?? -1,
      t: +(1200 - m.roundClock).toFixed(0),
      p: +m._matchProgress().toFixed(3),
      score: [...m.score],
      live: m.sites.map((z) => z.id).join(''),
      down: (w.demolitions ?? []).filter((d) => d.down).map((d) => d.id),
      phase: m.phase,
    };
  });
  if (st.n !== last) {
    last = st.n;
    console.log(`  … act ${st.n} began at t=${st.t}s p=${st.p} score=${st.score}`);
  }
  if (st.n >= WANT && st.running < 0) break;
  if (st.phase === 'matchover' || st.phase === 'over') {
    console.log(`  ! match ended (phase=${st.phase}) at t=${st.t}s with ${st.n} act(s) fired`);
    break;
  }
  await sleep(700);
}

const out = await page.evaluate(() => {
  const m = window.__ENGINE__.ctx.peek('match');
  const w = window.__ENGINE__.ctx.peek('world');
  return {
    acts: window.__NF__.acts,
    beats: window.__NF__.beats,
    demos: (w.demolitions ?? []).map((d) => ({ id: d.id, down: !!d.down })),
    live: m.sites.map((z) => z.id),
    t: +(1200 - m.roundClock).toFixed(1),
    p: +m._matchProgress().toFixed(3),
    score: [...m.score],
    tank: { armed: m.tank?.armed ?? null, sorties: m.tank?.sorties ?? null },
  };
});

console.log('\n──── MEASURED ────');
for (const a of out.acts) {
  console.log(`${a.id} "${a.name}"  t=${a.t}s of 1200  p=${a.p}  score=${a.score}`);
  for (const b of out.beats.filter((b) => b.id === a.id)) {
    console.log(`      +${b.at.toFixed(2).padStart(6)}s  ${b.kind.padEnd(10)} standing: ${b.standing.join(',') || '—'}`);
  }
}
console.log(`\nend: t=${out.t}s p=${out.p} score=${out.score} live=${out.live.join('')}`);
console.log(`demolitions: ${out.demos.map((d) => `${d.id}=${d.down ? 'DOWN' : 'standing'}`).join(' ')}`);
console.log(`tank: armed=${out.tank.armed} sorties=${out.tank.sorties}`);
console.log(`pageerrors: ${errs.length}${errs.length ? '\n  ' + errs.join('\n  ') : ''}`);
console.log('\n──── LOG ────');
for (const l of logs) console.log('  ' + l);

await browser.close();
process.exit(errs.length ? 1 : 0);
