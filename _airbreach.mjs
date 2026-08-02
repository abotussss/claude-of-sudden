/**
 * DOES A BOMB OPEN A HOUSE? Fires a real `explosion` at each breachable wall at
 * the radius each weapon actually carries, and reports which of them took the
 * wall off — so the discrimination in `BREACH_BLAST_R` is measured rather than
 * argued. Then photographs one house breached by an airstrike.
 *
 *   node _airbreach.mjs [--url=…] [--seed=N] [--out=dir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)];
  })
);
const BASE = args.url ?? 'http://127.0.0.1:4422/';
const OUT = args.out ?? '/tmp/airbreach';
mkdirSync(OUT, { recursive: true });
const url = BASE + '?seed=' + (args.seed ?? 11);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
const breachLog = [];
page.on('console', (m) => {
  const t = m.text();
  if (/BLAST BREACHED|BREACHED/.test(t)) breachLog.push(t);
});
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

/**
 * WEAPON BY WEAPON, EACH ON ITS OWN WALL. Ten walls, so each weapon gets a
 * fresh one and no result is contaminated by a wall a previous shot opened.
 */
const table = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  w.breachAll(false);
  const WEAPONS = [
    ['airstrike', 24],
    ['zone bombard', 16],
    ['bomber stick', 15],
    ['cath barrage', 14],
    ['tank main (blast)', 9],
    ['strafe cannon', 8],
    ['grenade', 7.5],
  ];
  const rows = [];
  for (let i = 0; i < WEAPONS.length && i < w.breaches.length; i++) {
    const [name, radius] = WEAPONS[i];
    const b = w.breaches[i];
    // land it 1.5 m off the face, dead centre of the opening — a hit, not a miss
    const at = b.position.clone().addScaledVector(b.normal, 1.5);
    const before = b.down;
    e.ctx.events.emit('explosion', { position: at, radius, damage: 100, source: null });
    rows.push({ weapon: name, radius, wall: b.id, wasDown: before, nowDown: b.down,
                opened: !before && b.down });
  }
  return rows;
});
console.table(table);
for (const l of breachLog) console.log('  [console]', l);

/**
 * …AND THE PHOTOGRAPH. A real airstrike blast on a cache house, shot from
 * outside the hole it made and from inside the room behind it.
 */
const shots = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const w = e.ctx.peek('world');
  w.breachAll(false);
  // W3-S0: a full-height elevation with open street outside it
  const b = w.breaches.find((x) => x.id === 'W3-S0') ?? w.breaches[0];
  const at = b.position.clone().addScaledVector(b.normal, 1.5);
  e.ctx.events.emit('explosion', { position: at, radius: 24, damage: 300, source: null });
  const fx = e.ctx.peek('fx');
  fx?.explosion?.({ position: at, radius: 14 });
  return { id: b.id, down: b.down,
           pos: [+b.position.x.toFixed(1), +b.position.y.toFixed(1), +b.position.z.toFixed(1)] };
});
console.log('photographing', shots);

const POSES = [
  ['outside', 7.0, 1.2],
  ['close', 3.2, 1.0],
  ['inside', -3.4, 1.0],
];
for (const [label, dist, eye] of POSES) {
  await page.evaluate(([id, dist, eye]) => {
    const e = window.__ENGINE__;
    const w = e.ctx.peek('world');
    const p = e.ctx.peek('player');
    const ai = e.ctx.peek('ai');
    ai.combatEnabled = false;
    ai.protect(p, 9999);
    const b = w.breaches.find((x) => x.id === id);
    const at = b.position.clone().addScaledVector(b.normal, dist);
    p.movement.yaw = Math.atan2(b.position.x - at.x, -(b.position.z - at.z));
    p.movement.pitch = 0.04;
    p.movement.velocity.set(0, 0, 0);
    p.movement.teleport(at.x, b.position.y - b.holeH / 2 + eye, at.z);
  }, [shots.id, dist, eye]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/breach-${shots.id}-${label}.png` });
  console.log(`${OUT}/breach-${shots.id}-${label}.png`);
}
if (errs.length) console.log('PAGE ERRORS', errs.slice(0, 4));
await browser.close();
