/**
 * A WHOLE MATCH, AND WHAT KILLED THE ARMOUR IN IT — before and after.
 *
 * 「平原において戦車は最強すぎる」 is a claim about a number nobody had. This is the
 * number: over a full match on NACHTFELD, how many of the six hulls die, and to
 * WHAT — an anti-tank mine, another hull's main gun, or everything else put
 * together. Run it against a build with the change and against one without and
 * the two tables are the answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MINES ARE LAID BY THIS PROBE, AND THAT IS A STATED LIMIT OF THE RUN
 * ─────────────────────────────────────────────────────────────────────────────
 * `src/ai` belongs to another agent and is not edited by this change, so the
 * bot behaviour is SPECIFIED rather than written. What this file does is
 * execute that specification from outside: five men a side (`RULES`), two mines
 * each, laid through the same public `weapons.layMine` the spec routes, at the
 * same `match.tank.laneNear` lane points the spec names, on the same per-man
 * cooldown. It exercises the published API end to end and it measures what the
 * feature is worth; it does NOT prove that `Agent` can walk to the spot, which
 * is the half that lives in `src/ai`.
 *
 * Usage: BASE=http://127.0.0.1:4638/ MAP=plains node _dtankwar.mjs [seeds]
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:4638/';
const MAP = process.env.MAP ?? 'plains';
const SEEDS = (process.argv[2] ?? '7,12').split(',');
const SPEED = Number(process.argv[3] ?? 10);
/** '1' lays mines; '0' is the control, for a build that has them. */
const LAY = (process.env.LAY ?? '1') === '1';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});

for (const SEED of SEEDS) {
  const page = await b.newPage({ viewport: { width: 900, height: 600 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(`${BASE}?capture=1&map=${MAP}&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

  const res = await page.evaluate(async ({ SPEED, LAY }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const w = e.ctx.peek('weapons');
    const ai = e.ctx.peek('ai');
    e.input.frozen = true; e.input.enabled = false;
    e.ctx.peek('player')?.setControlEnabled?.(false);
    e.time.scale = SPEED;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    while (m.phase !== 'live') await frame();
    const armour = m.tank;
    const level = e.ctx.peek('world')?.level?.id;

    /* ---- the ration, exactly as the spec states it --------------------- */
    const BEARERS = 5;
    const PER_MAN = 2;
    const GAP = 25;          // seconds between one man's two mines
    const LANE_NEAR = 90;    // how far he will go to find a lane
    const bearers = new Map(); // agent -> { left, next }
    const pick = () => {
      for (const t of [0, 1]) {
        const side = ai?.agents?.filter?.((a) => a.team === t) ?? [];
        let n = 0;
        for (const a of side) {
          if (n >= BEARERS) break;
          if (!bearers.has(a)) bearers.set(a, { left: PER_MAN, next: 0 });
          n++;
        }
      }
    };
    pick();

    const per = {};
    for (const t of armour.tanks) per[t.id] = { rolled: null, died: null, ord: null, minH: t.health };
    // The BEFORE build has none of `laneCount`, `kills`, `lastOrd` or the two
    // new stat columns. Every read of them below is optional so ONE probe
    // answers for both trees and the two tables are strictly comparable.
    let laid = 0;
    const shotsAtArmour = { n: 0 };
    let framesArmourTargeted = 0;
    let framesBothLive = 0;
    let duelFrames = 0;
    const t0 = m.roundClock;
    const clock = () => +(t0 - m.roundClock).toFixed(1);

    const start = performance.now();
    while (performance.now() - start < 520000) {
      await frame();
      if (m.phase !== 'live') break;
      if (m.roundClock <= 0) break;

      /* ---- the spec, executed from outside ---------------------------- */
      if (LAY && w?.layMine && (armour.laneCount ?? 0) > 0) {
        for (const [a, st] of bearers) {
          if (st.left <= 0) continue;
          if (!a.alive) continue;
          if (clock() < st.next) continue;
          const ln = armour.laneNear(a.position.x, a.position.z, LANE_NEAR);
          if (!ln) continue;
          const y = e.ctx.peek('physics').groundHeight(ln.x, ln.z, a.position.y + 6);
          if (!Number.isFinite(y)) continue;
          if (w.layMine({ x: ln.x, y: y + 0.3, z: ln.z }, { team: a.team, owner: a })) {
            st.left--;
            st.next = clock() + GAP;
            laid++;
          }
        }
      }

      /* ---- the armour ------------------------------------------------- */
      let live = 0;
      let armourTargeted = 0;
      for (const t of armour.tanks) {
        const p = per[t.id];
        if (t.state !== 'parked' && p.rolled === null) p.rolled = clock();
        if (t.alive) { live++; p.minH = Math.min(p.minH, t.health); }
        if (t.state === 'dead' && p.died === null) { p.died = clock(); p.ord = t.lastOrd ?? null; }
        if (t.alive && t.target?.isTank === true) armourTargeted++;
      }
      if (armourTargeted) framesArmourTargeted++;
      if (armourTargeted >= 2) duelFrames++;
      if (live >= 2) framesBothLive++;
    }

    const byOrd = { ...(armour.kills ?? {}) };
    return {
      level, seed: null, laid, mineStats: w?.mineStats ? { ...w.mineStats } : null,
      lanes: armour.laneCount ?? 0,
      tanks: Object.entries(per).map(([id, p]) => ({ id, ...p, minH: Math.round(p.minH) })),
      byOrd,
      destroyed: Object.values(per).filter((p) => p.died !== null).length,
      framesArmourTargeted, duelFrames, framesBothLive,
      length: clock(), phase: m.phase, score: m.score.slice(),
      shots: shotsAtArmour.n,
      shellStats: armour.tanks.map((t) => ({ id: t.id, shells: t.stats.shells ?? 0, shellDmg: Math.round(t.stats.shellDmg ?? 0), mines: t.stats.mines ?? 0, mineDmg: Math.round(t.stats.mineDmg ?? 0) })),
    };
  }, { SPEED, LAY });

  console.log(`\n════ seed ${SEED} · map ${res.level} · ${res.length}s to "${res.phase}" · score ${JSON.stringify(res.score)} ════`);
  console.log(`  lanes ${res.lanes} pts · mines laid ${res.laid} · mineStats ${JSON.stringify(res.mineStats)}`);
  console.log(`  HULLS DESTROYED ${res.destroyed}/6 — by ordnance ${JSON.stringify(res.byOrd)}`);
  for (const t of res.tanks) {
    console.log(`    ${t.id.padEnd(7)} rolled ${String(t.rolled).padStart(6)}  died ${String(t.died).padStart(6)} (${t.ord ?? '—'})  min health ${t.minH}`);
  }
  console.log(`  TANK v TANK: frames with a hull laying on armour ${res.framesArmourTargeted}, both-ways ${res.duelFrames}, frames >=2 hulls live ${res.framesBothLive}`);
  console.log(`  per hull: ${res.shellStats.map((s) => `${s.id} ${s.shells}sh/${s.shellDmg} ${s.mines}mine/${s.mineDmg}`).join(' · ')}`);
  console.log(errs.length ? `  [pageerror] ${errs.length}: ${errs.slice(0, 2).join(' | ')}` : '  [pageerror] none');
  await page.close();
}
await b.close();
