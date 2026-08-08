/**
 * Is the advancing gait actually being played, and by whom?
 *
 * The clip change is the half of this pass a number cannot otherwise see: the
 * rounds are identical either way, so `burstcheck` is blind to it. This samples
 * every alive man every frame and reports, of the frames in which a man is
 * FIRING OR MEANS TO (`wantFire || burstLeft > 0`) with a live contact, which
 * locomotion clip he is playing — and the plant/press split at the same instant.
 */
import { chromium } from 'playwright';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''), i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const URL = args.url ?? 'http://127.0.0.1:4621/';
const MAP = args.map ?? 'plains';
const SEEDS = String(args.seeds ?? '7,11').split(',');
const WARM = +(args.warm ?? 120);
const WINDOW = +(args.window ?? 60);

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const tot = Object.create(null);
let firingFrames = 0, contactFrames = 0, level = '?';
let plant = 0, press = 0;
for (const seed of SEEDS) {
  const p = await b.newPage({ viewport: { width: 900, height: 520 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.message)));
  await p.goto(`${URL}?capture=1&map=${MAP}&seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__READY__===true', null, { timeout: 600000 });
  const out = await p.evaluate(async ({ WARM, WINDOW }) => {
    const e = window.__ENGINE__;
    const m = e.ctx.peek('match');
    const ai = e.ctx.peek('ai');
    const pl = e.ctx.peek('player');
    e.input.frozen = true; e.input.enabled = false;
    pl?.setControlEnabled?.(false);
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    e.time.scale = 12;
    while (m.phase !== 'live' || ai.agents.length === 0) await frame();
    const t0 = m.roundClock, t = () => t0 - m.roundClock;
    while (t() < WARM && m.phase === 'live') await frame();
    e.time.scale = 1;
    const S = { clips: {}, firing: 0, contact: 0, plant: 0, press: 0,
      level: e.ctx.peek('world')?.level?.id ?? '?' };
    while (t() < WARM + WINDOW && m.phase === 'live') {
      await frame();
      for (const a of ai.agents) {
        if (!a.alive) continue;
        if (a.hasTarget !== true) continue;
        S.contact++;
        if (!(a.wantFire || a.burstLeft > 0)) continue;
        S.firing++;
        S.clips[a.clip] = (S.clips[a.clip] ?? 0) + 1;
        if (a.speed > 2.0) S.press++; else S.plant++;
      }
    }
    return S;
  }, { WARM, WINDOW });
  level = out.level;
  firingFrames += out.firing; contactFrames += out.contact;
  plant += out.plant; press += out.press;
  for (const [k, v] of Object.entries(out.clips)) tot[k] = (tot[k] ?? 0) + v;
  if (errs.length) console.log('  pageerrors', errs.length, errs[0]);
  await p.close();
}
await b.close();
const pc = (a, n) => (n ? ((a / n) * 100).toFixed(1) + ' %' : '-');
console.log(`\n=== STANCE — ${level}, seeds ${SEEDS.join(',')} ===`);
console.log(`${contactFrames} man-frames with a live contact; ${firingFrames} of them firing or meaning to (${pc(firingFrames, contactFrames)})`);
console.log('locomotion clip while firing:');
for (const [k, v] of Object.entries(tot).sort((a, b2) => b2[1] - a[1])) {
  console.log(`  ${k.padEnd(11)} ${String(v).padStart(7)}  ${pc(v, firingFrames)}`);
}
console.log(`PRESS (>2 m/s) ${pc(press, firingFrames)}   PLANT ${pc(plant, firingFrames)}`);
