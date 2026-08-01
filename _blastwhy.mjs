/**
 * WHY A BOMB DOES NOTHING. `_blastcount.mjs` measured 166 blasts and 2 kills
 * across a whole match; this asks which of the three gates in `src/ai`'s
 * explosion handler is eating them.
 *
 * The handler is, verbatim:
 *     if (d > radius) continue;
 *     if (!lineOfSight(e.position, a.eye, MASK.EXPLOSION)) continue;
 *     f = 1 - d/radius;  applyDamage(damage * f * f)
 *
 * so there are exactly three ways a man in the blast takes nothing: he is
 * outside the radius, the ray from the DETONATION POINT to his EYE is blocked,
 * or f² is small enough that the damage rounds to nothing. This prints all
 * three per source, plus the mean height of the detonation point above the men
 * it is being measured against — because a charge that goes off ON a roof or ON
 * the deck is a charge whose own ground plane is the occluder.
 *
 *   node _blastwhy.mjs [url] [seed] [seconds]
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

  const rows = new Map();
  const src = (ev) => (typeof ev.source === 'string' ? ev.source : ev.source ? 'tank' : 'match');
  e.ctx.events.on('explosion', (ev) => {
    if (!ev || !ev.position) return;
    const r = ev.radius ?? 5;
    const k = `${src(ev)}@r${r}`;
    let row = rows.get(k);
    if (!row) {
      row = { k, n: 0, inR: 0, losBlocked: 0, losClear: 0, dmgSum: 0, dySum: 0, dySamples: 0, lethal: 0 };
      rows.set(k, row);
    }
    row.n++;
    const px = ev.position.x, py = ev.position.y, pz = ev.position.z;
    for (const a of ai.agents) {
      if (!a.alive) continue;
      const dx = a.position.x - px, dy = a.position.y - py, dz = a.position.z - pz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > r) continue;
      row.inR++;
      row.dySum += py - a.position.y;
      row.dySamples++;
      const clear = !phys || phys.lineOfSight(ev.position, a.eye, phys.MASK.EXPLOSION);
      if (!clear) { row.losBlocked++; continue; }
      row.losClear++;
      const f = 1 - d / r;
      const dmg = (ev.damage ?? 100) * f * f;
      row.dmgSum += dmg;
      if (dmg >= a.health) row.lethal++;
    }
  });

  const start = performance.now();
  while (performance.now() - start < SECS * 1000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (m.phase !== 'live' || m.roundClock <= 0) break;
  }
  return { seed: e.levelSeed, rows: [...rows.values()], score: m.score.slice() };
}, SECS);

const pad = (s, n) => String(s).padEnd(n);
const rp = (s, n) => String(s).padStart(n);
console.log(`\n  seed ${res.seed} · score ${JSON.stringify(res.score)}`);
console.log('  source@radius        blasts   inR   LOS-blocked  LOS-clear   lethal   mean dmg/man-in-LOS   mean (blastY - manY)');
for (const r of res.rows.sort((a, c) => c.n - a.n)) {
  console.log(
    `  ${pad(r.k, 20)} ${rp(r.n, 6)} ${rp(r.inR, 5)} ${rp(r.losBlocked, 13)} ${rp(r.losClear, 10)} ` +
      `${rp(r.lethal, 8)} ${rp(r.losClear ? (r.dmgSum / r.losClear).toFixed(1) : '-', 20)} ` +
      `${rp(r.dySamples ? (r.dySum / r.dySamples).toFixed(2) : '-', 22)}`
  );
}
console.log(errs.length ? `[pageerror] ${errs.slice(0, 3).join(' | ')}` : '[pageerror] none');
await b.close();
