/**
 * IS THE OVERLAP THE BUG? One round, counted.
 *
 * The armour table documents the engine deck at 1.70 and `_tankttk.mjs`
 * measured the line at an effective 2.64. Either the table is wrong or one
 * round is being counted more than once. This fires ONE `physics.fireBullet`
 * along the classic deck line and prints every `damage:dealt` it produces.
 */
import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:4291/';
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal','--ignore-gpu-blocklist','--mute-audio'] });
const page = await b.newPage({ viewport: { width: 800, height: 500 } });
const errs=[]; page.on('pageerror',(e)=>errs.push(String(e.message).slice(0,200)));
await page.goto(`${URL}?capture=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const e = window.__ENGINE__, m = e.ctx.peek('match'), phys = e.ctx.peek('physics');
  const a = m.tank, V3 = e.camera.position.constructor;
  a.fire();
  const t = a.tanks[0];
  a._pose(t);
  const rows = [];
  const hits = [];
  const on = (ev) => { if (ev.target === t) hits.push({ part: ev.part, amount: +(ev.amount ?? 0).toFixed(1) }); };
  e.ctx.events.on('damage:dealt', on);
  const shots = [
    ['level from astern, deck height', new V3(0, 1.90, -14), new V3(0, 0, 1)],
    ['down onto the deck from a roof', new V3(0, 11, -9), null],
    ['level from ahead, glacis',       new V3(0, 1.20, 14), new V3(0, 0, -1)],
    ['level from the flank, hull',     new V3(14, 1.20, 0), new V3(-1, 0, 0)],
  ];
  for (const [name, off, dirLocal] of shots) {
    hits.length = 0;
    const o = off.clone().applyMatrix4(t.root.matrixWorld);
    const aim = new V3(t.position.x, t.position.y + (name.includes('deck') ? 1.9 : 1.2), t.position.z);
    const d = dirLocal ? aim.clone().sub(o).normalize() : aim.clone().sub(o).normalize();
    const hp = t.health;
    phys.fireBullet({ origin: o, dir: d, damage: 100, penetration: 2.0, maxDist: 60, mask: phys.MASK.BULLET, shooter: null });
    rows.push(`${name}: ${hits.length} damage events ${JSON.stringify(hits)} — health ${hp.toFixed(0)} -> ${t.health.toFixed(0)} (effective x${((hp - t.health) / 100).toFixed(2)})`);
  }
  e.ctx.events.off?.('damage:dealt', on);
  const boxes = t.colliders.map((c) => `${c.c.part} half(${c.c.hx},${c.c.hy},${c.c.hz}) at(${c.at}) turret=${c.turret}`);
  return rows.join('\n') + '\n  boxes: ' + boxes.join(' | ');
}));
console.log(errs.length ? `[pageerror] ${errs.slice(0,3).join(' | ')}` : '[pageerror] none');
await b.close();
