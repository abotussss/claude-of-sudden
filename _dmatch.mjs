/**
 * A WHOLE MATCH OF DRONES, AND WHICH SIDE'S DIE IN DEAD AIR.
 *
 * The load-bearing question is "do the BOTS' drones go through the same gate as
 * the player's". The structural answer is that there is no such thing as a bot's
 * drone — `src/match/index.js:760` holds the only `new Drones(...)` in the tree
 * and `:808` hands `ai` that same array to SHOOT AT, `src/ai` has no drone
 * flight of any kind — but structure is an argument. This is the measurement:
 * a full match, both sides' launches counted, and the EMP kills attributed to
 * the side that launched them.
 *
 * The URL is assembled here rather than appended to, so `?map=plains` cannot
 * become `?map=plains?capture=1` and run the town. `level.id` is echoed.
 */
import { chromium } from 'playwright';

const MAP = process.argv[2] ?? 'plains';
const SEED = process.argv[3] ?? '7';
const SPEED = Number(process.argv[4] ?? 12);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`http://127.0.0.1:4579/?capture=1&map=${MAP}&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log('map', await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id), 'seed', SEED);

const out = await page.evaluate(async (SPEED) => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const dr = window.__DRONES__;
  e.time.scale = SPEED;
  /** Per side: launched, and how each of them ended. Attributed at the event. */
  const byTeam = [{ launched: 0, emp: 0, down: 0, boom: 0 }, { launched: 0, emp: 0, down: 0, boom: 0 }];
  const seen = new Set();
  e.ctx.events.on('match:drone', (p) => {
    const t = p.team === 1 ? 1 : 0;
    if (p.phase === 'launch') byTeam[t].launched++;
    else if (p.phase === 'emp') byTeam[t].emp++;
    else if (p.phase === 'down') byTeam[t].down++;
    else if (p.phase === 'boom') byTeam[t].boom++;
    seen.add(p.phase);
  });
  /**
   * WHAT STATE WAS IT IN WHEN THE FIELD TOOK IT — the decisive test of the
   * deflection. `empzone.js` argues that a CRUISING drone goes round a field
   * and only a COMMITTED one follows a man in, so a tally weighted toward
   * `lock`/`dive` means the deflection works and the field is counter-play;
   * a tally full of `hunt` means twenty drones a match are wandering into dead
   * air on their way somewhere else, which is the failure that argument names.
   * Wrapped here rather than instrumented in the file: `_empKill` is what
   * overwrites the state, so the last honest reading is on the way in.
   */
  const atKill = {};
  const inner = dr._empKill.bind(dr);
  dr._empKill = (d, z) => { atKill[d.state] = (atKill[d.state] ?? 0) + 1; return inner(d, z); };

  const start = performance.now();
  while (performance.now() - start < 600000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (m.phase === 'over' || m.phase === 'ended' || (m.roundClock ?? 1) <= 1) break;
  }
  e.time.scale = 1;
  return {
    phase: m.phase, clockLeft: +(m.roundClock ?? 0).toFixed(0),
    stats: JSON.parse(JSON.stringify(dr.stats)),
    byTeam, atKill, phases: [...seen].sort(),
    fields: (dr.emp?.zones ?? []).map((z) => ({ id: z.id, kills: z.kills })),
    playerTeam: dr.playerTeam,
  };
}, SPEED);

console.log(JSON.stringify(out, null, 1));
console.log(errs.length ? `PAGEERRORS(${errs.length}): ${errs.slice(0, 3).join(' | ')}` : 'pageerrors: none');
await browser.close();
