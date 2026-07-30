/**
 * TANK PORTRAIT — "does it read as a tank" is not a number, so it is a picture.
 *
 *   node _tankshot.mjs [--url=…] [--shots=DIR]
 *
 * Rolls one hull, HALTS it where the street is widest, hides the HUD and the
 * viewmodel, and orbits the camera round it at hull height. Three quarters,
 * side, front and a close-up of the running gear.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const URL = args.url ?? 'http://127.0.0.1:4251/';
const SHOTS = args.shots ?? './shots/tank';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push('console.error: ' + m.text().slice(0, 260));
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__READY__===true', null, { timeout: 240000 });
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

await page.evaluate(() => {
  const e = window.__ENGINE__;
  const m = e.ctx.peek('match');
  const ui = e.ctx.peek('ui');
  if (m.phase !== 'live') m._setPhase('live', 0);
  m.roundClock = 1e6;
  m._checkWinConditions = () => {};
  m._updateRespawns = () => {};
  for (const a of m.air) a.enabled = false;
  ui.setHudVisible(false);
  ui.hudVisible = 0;
  e.ctx.viewScene.visible = false;
  m.tank.fire();
});
/* Drive it 22 m out of the pocket, then halt it there for the portrait. */
await sleep(5200);
const at = await page.evaluate(() => {
  const t = window.__ENGINE__.ctx.peek('match').tank.tanks.find((x) => x.id === 'RED');
  t.state = 'hold';
  t.hold = 1e6;
  return { x: t.position.x, y: t.position.y, z: t.position.z, yaw: t._yaw, s: +t.s.toFixed(1) };
});
console.log('[tankshot] halted at', JSON.stringify(at));

/**
 * Camera at a bearing RELATIVE TO THE HULL, so "three-quarter front" means the
 * same thing whatever direction the street runs in.
 */
async function orbit(rel, dist, height, look = 1.7) {
  const r = await page.evaluate(
    ({ rel, dist, height, look }) => {
      const e = window.__ENGINE__;
      const ph = e.ctx.peek('physics');
      const player = e.ctx.peek('player');
      const m = e.ctx.peek('match');
      const t = m.tank.tanks.find((x) => x.id === 'RED');
      const a = t._yaw + rel;
      const x = t.position.x + Math.sin(a) * dist;
      const z = t.position.z + Math.cos(a) * dist;
      const g = ph.groundHeight(x, z, 60);
      const y = (Number.isFinite(g) ? g : t.position.y) + 0.1;
      const scratch = m.sites[0].position.clone();
      scratch.set(x, y, z);
      const dx = t.position.x - x;
      const dz = t.position.z - z;
      const dy = t.position.y + look - (y + 1.62);
      const len = Math.hypot(dx, dy, dz);
      player.respawnAt(scratch, Math.atan2(-dx, -dz));
      player.movement.pitch = Math.asin(dy / len);
      return { x: +x.toFixed(1), z: +z.toFixed(1), d: +Math.hypot(dx, dz).toFixed(1) };
    },
    { rel, dist, height, look }
  );
  await sleep(450);
  return r;
}

const views = [
  ['10-three-quarter-front', Math.PI * 0.28, 9.5, 0, 1.8],
  ['11-side', Math.PI * 0.5, 8.5, 0, 1.7],
  ['12-three-quarter-rear', Math.PI * 0.78, 9.0, 0, 1.8],
  ['13-front', 0.06, 9.0, 0, 1.7],
  ['14-running-gear', Math.PI * 0.5, 4.6, 0, 0.85],
  ['15-turret-close', Math.PI * 0.34, 5.4, 0, 2.1],
];
for (const [name, rel, dist, h, look] of views) {
  const r = await orbit(rel, dist, h, look);
  console.log(`   ${name} ${JSON.stringify(r)}`);
  await shot(name);
}

console.log('[tankshot] pageErrors', pageErrors.length ? pageErrors : 'none');
await browser.close();
