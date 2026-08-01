/**
 * DOES IT STAY? 「戦車は登場したら帰さないで 試合終了まで滞在させること」
 *
 * Drives the armour by hand for five simulated minutes with the match's own
 * round machinery out of the way, and asserts the hull is still standing at the
 * end of its route. This is deliberately NOT a match run: in a live match the
 * round eventually resets and calls `armour.reset()`, which parks every hull by
 * design, and that reset is indistinguishable from a withdrawal in a log. Here
 * nothing but `Armour.update` runs, so "still holding after 300 s" can only
 * mean the withdrawal is gone.
 *
 * Usage: node _tankstay.mjs [url] [seed]
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const SEED = process.argv[3] ?? '7';

const b = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await b.newPage({ viewport: { width: 640, height: 400 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(`${URL}?capture=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const out = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const a = e.ctx.peek('match').tank;
  if (!a?.ready) return { error: 'no armour' };
  const events = [];
  e.ctx.events.on('match:tank', (ev) => events.push(`${ev.id}:${ev.phase}`));

  a.reset();
  a.fire();
  const track = [];
  const MIN = 60 * 60; // one simulated minute of 60 Hz steps
  for (let m = 1; m <= 5; m++) {
    for (let i = 0; i < MIN; i++) a.update(1 / 60, false);
    track.push({
      minute: m,
      tanks: a.tanks.map((t) => ({
        id: t.id, state: t.state, alive: t.alive,
        s: +t.s.toFixed(1), len: +t.path.length.toFixed(1),
        hold: +t.hold.toFixed(0),
      })),
    });
  }
  return { track, events };
});

if (out.error) console.log('ERROR', out.error);
else {
  for (const row of out.track) {
    const s = row.tanks.map((t) => `${t.id} ${t.state}${t.alive ? '' : '(not alive)'} s=${t.s}/${t.len} hold=${t.hold}`).join('   ');
    console.log(`  t=${row.minute}min  ${s}`);
  }
  console.log(`\n  events: ${out.events.join(' ') || 'none'}`);
  const last = out.track[out.track.length - 1].tanks;
  const ok = last.every((t) => t.state === 'hold' && t.alive && Math.abs(t.s - t.len) < 0.2);
  const noClear = !out.events.includes('RED:clear') && !out.events.includes('BLUE:clear');
  console.log(`\n${ok && noClear ? 'PASS' : 'FAIL'} — after 5 simulated minutes both hulls are ${ok ? 'still holding at the end of their route' : 'NOT holding'}${noClear ? ', and neither ever emitted `clear`' : ', and a `clear` was emitted'}`);
}
if (errs.length) console.log('PAGEERRORS:', errs.slice(0, 3));
await b.close();
