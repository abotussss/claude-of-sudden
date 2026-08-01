/**
 * MY OWN blast-lethality probe — "爆撃の当たり判定が小さい" measured rather than
 * argued about.
 *
 * The question the player asked is not "what is `airstrikeRadius`", it is "how
 * many men does a bomb actually take off the board". Those are different numbers
 * because `src/ai`'s explosion handler is a HARD CUTOFF at `radius`, a QUADRATIC
 * falloff inside it (`damage * f²`, f = 1 - d/r) and a LINE OF SIGHT test against
 * `MASK.EXPLOSION` — so in a town a blast that reaches 15 m on paper reaches a
 * fraction of that arc in practice, and none of that is visible in rules.js.
 *
 * WHAT IT DOES. It listens to the canonical `explosion` event, and on the frame
 * one fires it snapshots every live actor within `radius * 1.15` (both sides,
 * plus the local player) with their health. Four frames later it reads the same
 * men back and reports how many were hurt and how many died. Attribution is by
 * `source` — 'airstrike' | 'bomber' | 'strafe' | 'tank' | null (the zone
 * bombardment and the cathedral barrage are `match`'s own) — and by radius, so a
 * route strike and a storey strike are separate rows.
 *
 * BOTH TEAMS ARE COUNTED SEPARATELY, because "空爆は敵味方関係なくダメージを喰らう
 * 仕様" is a claim that has to be measurable: if one column is always zero the
 * rule is not in force.
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
  const player = e.ctx.peek('player');
  e.input.frozen = true;
  e.input.enabled = false;
  player?.setControlEnabled?.(false);
  e.time.scale = 12;

  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const matchTime = m.roundClock;
  const t = () => +(matchTime - m.roundClock).toFixed(1);

  /* ---- the listener. The payload object is REUSED by every emitter, so every
     field is copied out synchronously and nothing is retained. ---- */
  const pending = [];
  const rows = new Map();
  const key = (src, r) => `${src ?? 'match'}@r${r}`;
  e.ctx.events.on('explosion', (ev) => {
    if (!ev || !ev.position) return;
    const r = ev.radius ?? 5;
    const px = ev.position.x, py = ev.position.y, pz = ev.position.z;
    const reach = r * 1.15;
    const men = [];
    for (const a of ai.agents) {
      if (!a.alive) continue;
      const dx = a.position.x - px, dy = a.position.y - py, dz = a.position.z - pz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > reach) continue;
      men.push({ a, team: a.team === 1 ? 1 : 0, hp: a.health, d });
    }
    pending.push({
      k: key(ev.source, r),
      radius: r,
      damage: ev.damage ?? 0,
      men,
      frames: 0,
      t: t(),
    });
  });

  const start = performance.now();
  while (performance.now() - start < SECS * 1000) {
    await new Promise((r) => requestAnimationFrame(r));
    /* settle the pending records: four frames is well past the frame the
       handler ran on, and `applyDamage` is synchronous inside it anyway. */
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (++p.frames < 4) continue;
      pending.splice(i, 1);
      let row = rows.get(p.k);
      if (!row) {
        row = {
          k: p.k, n: 0, radius: p.radius, damage: p.damage,
          inRange: [0, 0], hurt: [0, 0], killed: [0, 0], dmg: [0, 0],
        };
        rows.set(p.k, row);
      }
      row.n++;
      for (const men of p.men) {
        const lost = Math.max(0, men.hp - (men.a.alive ? men.a.health : 0));
        row.inRange[men.team]++;
        if (!men.a.alive) row.killed[men.team]++;
        else if (lost > 0.5) row.hurt[men.team]++;
        row.dmg[men.team] += lost;
      }
    }
    if (m.phase !== 'live') break;
    if (m.roundClock <= 0) break;
  }
  return {
    seed: e.levelSeed,
    end: t(),
    phase: m.phase,
    score: m.score.slice(),
    rows: [...rows.values()],
  };
}, SECS);

const pad = (s, n) => String(s).padEnd(n);
const rp = (s, n) => String(s).padStart(n);
console.log(
  `\n  seed ${res.seed} · match ended at t=${res.end}s in "${res.phase}" score ${JSON.stringify(res.score)}`
);
console.log(
  '  source@radius          blasts  inRange R/B   hurt R/B   KILLED R/B   kills/blast   dmg/blast'
);
let tk = 0, tb = 0;
for (const r of res.rows.sort((a, c) => c.n - a.n)) {
  const k = r.killed[0] + r.killed[1];
  const d = r.dmg[0] + r.dmg[1];
  tk += k;
  tb += r.n;
  console.log(
    `  ${pad(r.k, 21)} ${rp(r.n, 6)}  ${rp(r.inRange[0], 5)}/${pad(r.inRange[1], 5)} ` +
      `${rp(r.hurt[0], 4)}/${pad(r.hurt[1], 4)} ${rp(r.killed[0], 5)}/${pad(r.killed[1], 5)} ` +
      `${rp((k / r.n).toFixed(2), 11)}  ${rp((d / r.n).toFixed(1), 10)}`
  );
}
console.log(`  TOTAL ${tb} blasts · ${tk} kills · ${(tk / Math.max(1, tb)).toFixed(3)} kills/blast`);
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
