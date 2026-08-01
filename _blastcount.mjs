/**
 * MY OWN blast-lethality probe — "爆撃の当たり判定が小さい" measured rather than
 * argued about.
 *
 * The question the player asked is not "what is `airstrikeRadius`", it is "how
 * many men does a bomb actually take off the board". Those are different numbers
 * because `src/ai`'s explosion handler is a HARD CUTOFF at `radius`, a QUADRATIC
 * falloff inside it (`damage * f²`, f = 1 - d/r) and a LINE OF SIGHT test against
 * `MASK.EXPLOSION` — so in a town a blast that reaches 24 m on paper reaches a
 * fraction of that arc in practice, and none of that is visible in rules.js.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PROBE HAD FIRST, WHICH IS WHY IT IS WRITTEN THIS WAY
 * ──────────────────────────────────────────────────────────────────────────────
 * The obvious version reads each man's health inside the `explosion` listener.
 * That is WRONG and it undercounts by construction: `ai` registered its own
 * listener at `ai.init` and this one registers at probe time, so `ai` has
 * ALREADY applied the damage by the time this runs. Worse, a man the blast
 * killed is `alive === false` on the same frame and was being skipped entirely —
 * the probe could not see the kills it existed to count.
 *
 * So the "before" is a snapshot taken at the TOP of every frame, keyed on the
 * Agent itself, and the blast is scored against that. A man who dies is still in
 * the snapshot, which is the whole point.
 *
 * WHAT IT PRINTS. Per source and radius: how many men were inside the circle,
 * how many of those had the occlusion ray BLOCKED (the gate that was eating
 * everything), how many were hurt, how many DIED, and the split by team —
 * because "空爆は敵味方関係なくダメージを喰らう仕様" is a claim that has to be
 * measurable, and a column that is always zero would disprove it.
 *
 *   node _blastcount.mjs [url] [seed] [seconds]
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4294/';
const SEED = process.argv[3] ?? '11';
const SECS = Number(process.argv[4] ?? 900);
const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async (SECS) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ai = e.ctx.peek('ai');
  const phys = e.ctx.peek('physics');
  e.input.frozen = true;
  e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = 12;
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const matchTime = m.roundClock;
  const t = () => +(matchTime - m.roundClock).toFixed(1);

  /** Health at the top of this frame, keyed on the Agent. The "before". */
  let before = new Map();
  const rows = new Map();
  const srcOf = (ev) =>
    typeof ev.source === 'string' ? ev.source : ev.source ? 'tank' : 'match';

  e.ctx.events.on('explosion', (ev) => {
    if (!ev || !ev.position) return;
    const r = ev.radius ?? 5;
    const k = `${srcOf(ev)}@r${r}`;
    let row = rows.get(k);
    if (!row) {
      row = {
        k, n: 0, radius: r, damage: ev.damage ?? 0,
        inR: [0, 0], blocked: [0, 0], hurt: [0, 0], killed: [0, 0], dmg: [0, 0],
      };
      rows.set(k, row);
    }
    row.n++;
    const px = ev.position.x, py = ev.position.y, pz = ev.position.z;
    for (const [a, hp0] of before) {
      const dx = a.position.x - px, dy = a.position.y - py, dz = a.position.z - pz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > r) continue;
      const team = a.team === 1 ? 1 : 0;
      row.inR[team]++;
      // Asked BEFORE `ai` has moved anything: the same call `ai` itself makes.
      const clear = !phys || phys.lineOfSight(ev.position, a.eye, phys.MASK.EXPLOSION);
      if (!clear) { row.blocked[team]++; continue; }
      // `ai`'s listener runs before this one, so the damage is already applied.
      const now = a.alive ? a.health : 0;
      const lost = Math.max(0, hp0 - now);
      row.dmg[team] += lost;
      if (!a.alive && hp0 > 0) row.killed[team]++;
      else if (lost > 0.5) row.hurt[team]++;
    }
  });

  const start = performance.now();
  while (performance.now() - start < SECS * 1000) {
    // Re-snapshot at the TOP of the frame, before any event can fire in it.
    before = new Map();
    for (const a of ai.agents) if (a.alive) before.set(a, a.health);
    await new Promise((r) => requestAnimationFrame(r));
    if (m.phase !== 'live' || m.roundClock <= 0) break;
  }
  return {
    seed: e.levelSeed, end: t(), phase: m.phase, score: m.score.slice(),
    rows: [...rows.values()],
  };
}, SECS);

const pad = (s, n) => String(s).padEnd(n);
const rp = (s, n) => String(s).padStart(n);
console.log(
  `\n  seed ${res.seed} · match ended at t=${res.end}s in "${res.phase}" score ${JSON.stringify(res.score)}`
);
console.log(
  '  source@radius       blasts  inR R/B    LOS-blk   hurt R/B   KILLED R/B   kills/blast  dmg/blast'
);
let tk = 0, tb = 0, tr = 0, tbl = 0;
for (const r of res.rows.sort((a, c) => c.n - a.n)) {
  const k = r.killed[0] + r.killed[1];
  const d = r.dmg[0] + r.dmg[1];
  tk += k; tb += r.n;
  tr += r.inR[0] + r.inR[1];
  tbl += r.blocked[0] + r.blocked[1];
  console.log(
    `  ${pad(r.k, 19)} ${rp(r.n, 5)} ${rp(r.inR[0], 4)}/${pad(r.inR[1], 4)} ` +
      `${rp(r.blocked[0] + r.blocked[1], 8)}  ${rp(r.hurt[0], 4)}/${pad(r.hurt[1], 4)} ` +
      `${rp(r.killed[0], 5)}/${pad(r.killed[1], 5)} ${rp((k / r.n).toFixed(2), 10)} ` +
      `${rp((d / r.n).toFixed(1), 10)}`
  );
}
console.log(
  `  TOTAL ${tb} blasts · ${tr} men in radius (${tbl} occluded, ` +
    `${(100 * tbl / Math.max(1, tr)).toFixed(0)}%) · ${tk} kills · ` +
    `${(tk / Math.max(1, tb)).toFixed(3)} kills/blast`
);
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
