/**
 * THE CLIMB, THE STORES AND THE FORTRESS, PHOTOGRAPHED FROM A MAN'S EYE.
 *
 *   node _nfclimb.mjs [--url=…] [--out=shots/nfclimb] [--only=tag,tag]
 *
 * `_nfshots.mjs` photographs the three destruction ACTS from 50 m away. This
 * one stands where a player stands — at the foot of a flight, half way up it,
 * on each floor that has been given a reason to exist, and inside the fortress —
 * because "why would I ever go there" is not a question a wide shot answers.
 *
 * Cameras are authored in LEVEL space, which on this map is world space, and
 * `world.level.id` is echoed before a single shutter: several probes here have
 * carried a truncating `split('=')` that silently photographed the town.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const s = a.replace(/^--/, ''); const i = s.indexOf('=');
  return i < 0 ? [s, true] : [s.slice(0, i), s.slice(i + 1)];
}));
const BASE = args.url ?? 'http://127.0.0.1:4607/?map=plains&capture=1';
const OUT = args.out ?? 'shots/nfclimb';
const ONLY = args.only ? String(args.only).split(',') : null;
mkdirSync(OUT, { recursive: true });

/**
 * [tag, from(x,z), lookAt(x,y,z), eye]
 * `eye` is metres above whatever solid is under `from`; 1.62 is a man's.
 * Where a camera stands on a deck the ray finds the deck, so `eye` stays 1.62.
 */
const SHOTS = [
  // ── the climb ────────────────────────────────────────────────────────────
  ['stair-foot-N', [23, -44], [23, 8, -30], 1.62],
  ['stair-foot-S', [-23, -20], [-23, 8, -34], 1.62],
  ['stair-mid-E', [23, -36], [21, 8, -32], 1.62],
  ['stair-head-E', [22.5, -32], [8, 10, -32], 1.62],
  ['stair-second-E', [17, -32], [4, 12, -32], 1.62],
  ['approach-from-D', [0, -8], [0, 20, -32], 1.62],
  ['approach-from-N', [0, -70], [0, 20, -32], 1.62],
  // ── the tiers that were given a reason ───────────────────────────────────
  ['deck-P1-E', [16, -32], [0, 8, -32], 1.62],
  ['deck-P2-E', [10, -32], [0, 9, -32], 1.62],
  ['room-inside', [0, -35.5], [0, 8.2, -28], 1.62],
  ['room-door-N', [0, -40], [0, 8.6, -32], 1.62],
  ['shaft-rack', [2.6, -34.4], [-1.5, 22.5, -31], 1.62],
  ['cab-vantage', [3.4, -33.6], [0, 20, 10], 1.62],
  // ── the fortress ─────────────────────────────────────────────────────────
  ['fort-outside-N', [0, 8], [0, 8, 48], 1.62],
  ['fort-outside-NE', [34, 16], [4, 8, 46], 1.62],
  ['fort-gate-N', [0, 30], [0, 4, 52], 1.62],
  ['fort-yard', [0, 60], [0, 4, 44], 1.62],
  ['fort-dump', [14, 56], [4, 3, 50], 1.62],
  ['fort-mag-door', [0, 56], [0, 3.4, 44], 1.62],
  ['fort-walk-N', [0, 22.6], [14, 6, 34], 1.62],
  ['fort-aid', [-13, 56], [-13, 3.4, 60], 1.62],
  ['fort-inside-wide', [-20, 66], [16, 8, 30], 1.62],
];

const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.stack ?? e.message)));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });

const level = await page.evaluate(() => window.__ENGINE__.ctx.peek('world')?.level?.id ?? null);
console.log(`level=${level}  out=${OUT}`);
if (level !== 'plains') { console.error('NOT THE PLAIN — aborting.'); await b.close(); process.exit(2); }

await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.input.frozen = true; e.input.enabled = false;
  const pl = e.ctx.peek('player');
  if (pl) { pl.setControlEnabled?.(false); pl.applyDamage = () => {}; }
  e.ctx.peek('ui')?.debugState?.('clean');
});
await page.waitForFunction("window.__ENGINE__.ctx.peek('match').phase==='live'", null, { timeout: 240000 });
await page.evaluate(() => { const m = window.__ENGINE__.ctx.peek('match'); m._checkWinConditions = () => {}; m.airstrike.enabled = false; });

const frames = (n) => page.evaluate((k) =>
  new Promise((d) => { let i = 0; const t = () => (++i >= k ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

for (const [tag, from, at, eye] of SHOTS) {
  if (ONLY && !ONLY.includes(tag)) continue;
  const y = await page.evaluate(([f, a, eye]) => {
    const e = window.__ENGINE__, phys = e.ctx.peek('physics');
    const V3 = e.camera.position.constructor;
    const h = phys.raycast(f[0], 300, f[1], 0, -1, 0, 400, phys.MASK.WORLD);
    const y = (h.hit ? h.point.y : 0) + eye;
    e.camera.position.set(f[0], y, f[1]);
    e.camera.lookAt(new V3(a[0], a[1], a[2]));
    e.ctx.peek('player')?.teleport?.(e.camera.position, e.camera.rotation);
    return +y.toFixed(2);
  }, [from, at, eye]);
  await frames(8);
  await page.evaluate(([f, a]) => {
    const e = window.__ENGINE__;
    const V3 = e.camera.position.constructor;
    e.camera.lookAt(new V3(a[0], a[1], a[2]));
  }, [from, at]);
  await page.screenshot({ path: `${OUT}/${tag}.png` });
  console.log(`  · ${tag}.png  (eye y=${y})`);
}

console.log(`\n${errs.length} pageerrors`);
if (errs.length) console.log('  first:', errs[0]);
await b.close();
