/**
 * MY OWN event timeline. Run the match at speed to its natural end and stamp
 * every big event against the live clock — the player's question was literally
 * "いつ起きるの？", so the answer has to be measured, not read off the rules.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4260/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const res = await page.evaluate(async () => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), w = e.ctx.peek('world');
  e.input.frozen = true; e.input.enabled = false;
  e.ctx.peek('player')?.setControlEnabled?.(false);
  e.time.scale = 12; // NOT `e.timeScale`/`e.speed` — neither exists, so the old
  // line was a no-op and every "12x" run in this file was real time.
  
  // Wait for the warm-up to hand over; my first run broke out of the loop on
  // frame one because "not live" was already true before the match had begun.
  while (m.phase !== 'live') await new Promise((r) => requestAnimationFrame(r));
  const RULES_matchTime = m.roundClock;
  let wasLive = true;
  const seen = {}, log = [];
  const t = () => +(RULES_matchTime - m.roundClock).toFixed(1);
  const mark = (k) => { if (!seen[k]) { seen[k] = true; log.push([k, t(), m.score ? m.score.slice() : null]); } };
  const start = performance.now();
  while (performance.now() - start < 560000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (wasLive && m.phase !== 'live') { log.push(['MATCH END (' + m.phase + ')', t(), m.score ? m.score.slice() : null]); break; }
    const cath = e.ctx.peek('world')?.cathedral;
    if (cath?.razed) mark('CATHEDRAL RAZED');
    if (m._cathedralCalled || m.cathedralCalled) mark('cathedral salvo called');
    for (const d of w.demolitions ?? []) if (d.down) mark('block down: ' + d.id);
    if (m.sites?.some?.((s) => s.id === 'D')) mark('SITE D live');
    /**
     * `m.tank` IS THE `Armour` INSTANCE AND IT IS TRUTHY FROM BOOT, so the old
     * test stamped "tank" at t=0 in every run and said nothing at all about a
     * sortie. What a sortie is, is a hull whose `state` has left 'parked'.
     */
    for (const tk of m.tank?.tanks ?? []) {
      if (tk.state !== 'parked') mark('TANK ' + tk.id + ' rolling');
      if (tk.state === 'dead') mark('TANK ' + tk.id + ' destroyed');
    }
    if (m.roundClock <= 0) { log.push(['CLOCK EXPIRED', t(), m.score]); break; }
  }
  return { log, finalScore: m.score, phase: m.phase, clockLeft: +m.roundClock.toFixed(1), matchTime: RULES_matchTime };
});

console.log(`  match clock ${res.matchTime}s, ended in phase "${res.phase}" with ${res.clockLeft}s left, score ${JSON.stringify(res.finalScore)}`);
console.log('  event                          t(s)   score');
for (const [k, tt, s] of res.log) console.log(`  ${String(k).padEnd(28)} ${String(tt).padStart(6)}   ${JSON.stringify(s)}`);
console.log(errs.length ? `[pageerror] ${errs.slice(0,3).join(' | ')}` : '[pageerror] none');
await b.close();
